import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {diagramBlocks, documentParts} from '../../scripts/atlas-validation.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const atlas = path.resolve(directory, '../..');
const previous = JSON.parse(fs.readFileSync(path.join(atlas, 'plans/review-2026-10-03/figjam-payloads.json'), 'utf8'));
const previousManifest = JSON.parse(fs.readFileSync(path.join(atlas, 'plans/review-2026-10-03/figjam-derivation.json'), 'utf8'));
const digest = value => 'sha256:' + crypto.createHash('sha256').update(value).digest('hex');
const added = [
  ['13 · 需求隐私与摘要', 'maps/13-requirement/privacy-preview.md', 0, ['先分析', '过滤路径', '保留事实', '合并头部', '有界诊断', '独立标志', '隐藏摘要', '显示摘要'], 'privacyHit 独立于64项诊断；站内路由先过滤。'],
  ['14 · 证据内容检查', 'maps/14-evidence/privacy-and-source-consistency.md', 0, ['解码成功', '解码失败', '扫描分类', '保留引用', '必须阻塞', '比较策略', '拒绝策略', '策略允许'], '有效 UTF-8 即使有控制字符仍扫描；二进制确认不证明内部内容安全。'],
  ['15 · 回调数据边界', 'maps/07-review-rework-completion/callback-trust-and-review.md', 0, ['提取字段', '限长展示', '引用数据', '固定入口', '冻结回调'], '自由文本是展示数据；回调不携带评审授权，提交摘要保留算法与完整值。'],
  ['16 · 回调状态判定', 'maps/07-review-rework-completion/callback-trust-and-review.md', 1, ['已有决定', '读取观察', '找到落地', '缺少落地', '严格超时', '尚未超时'], 'acknowledged 优先；恰好十分钟仍 pending；silent 不自动重发。'],
  ['17 · 许可交接与清理', 'maps/02-foundation/admission-races-and-recovery.md', 1, ['再次检查', '立即持有', '随后结算', '准入检查', '业务执行', '入场失败', '总会结算', '释放成功', '释放失败', '锁结算失败', '保护替换'], '先保存 lease 再释放 latch；清理失败可覆盖原错误，未知替换者必须保留。'],
];
const items = previous.map((item, i) => ({...item, previous: previousManifest.modules[i]}));
items.push(...added.map(([name, file, index, shortLabels, note]) => ({name, path: file, index, shortLabels, note})));
const extraLabels = {'E-RWS-13':'重观测','E-RWS-14':'重试','E-RWS-15':'保留未知','E-TST02-08':'用户已回答'};
const output = items.map((item, i) => {
  const raw = fs.readFileSync(path.join(atlas, item.path), 'utf8');
  const {metadata, body} = documentParts(raw);
  const block = diagramBlocks(body)[item.index];
  if (!block) throw new Error('Missing selected graph: ' + item.path);
  const changed = !item.sourceDigest || digest(block.source) !== item.sourceDigest;
  if (i < 12 && changed && i !== 2 && i !== 7) throw new Error('Unexpected canonical change requires review: ' + item.path);
  const nodes = Object.fromEntries([...block.source.matchAll(/^\s*(?!subgraph\b)([A-Za-z]\w*)\s*(?:\["([^"]+)"\]|\{"([^"]+)"\})\s*$/gmu)].map(m=>[m[1],m[2]??m[3]]));
  const edges = [...block.source.matchAll(/^\s*([A-Za-z]\w*)\s*-->\|"(E-[A-Z0-9-]+)\s+([^"]+)"\|\s*([A-Za-z]\w*)\s*$/gmu)].map((m,n)=>{
    const old = item.edges?.find(e=>e.id===m[2]);
    const short = ['E-RWS-13','E-RWS-14'].includes(m[2]) ? m[2].split('-').at(-1) : old?.short ?? `${m[2].split('-').at(-1)} ${extraLabels[m[2]] ?? item.shortLabels?.[n] ?? ''}`.trim();
    return {from:m[1],to:m[4],id:m[2],full:m[3],short};
  });
  if (!Object.keys(nodes).length || edges.some(e=>!nodes[e.from]||!nodes[e.to])) throw new Error('Incomplete graph extraction: '+item.path);
  if (!changed && JSON.stringify(nodes)!==JSON.stringify(item.nodes)) throw new Error('Inherited node mismatch: '+item.path);
  const nodeAliases = item.previous?.nodeAliases ?? (i === 15 ? {C:{source:nodes.C,display:'摘要匹配且不早于签发？'}} : {});
  let mermaidSyntax = block.source.replace(/^\s*acc(?:Title|Descr):[^\n]*\n/gmu,'');
  for (const edge of edges) mermaidSyntax = mermaidSyntax.replace(`|"${edge.id} ${edge.full}"|`, `|"${edge.short}"|`);
  for (const [node,alias] of Object.entries(nodeAliases)) mermaidSyntax = mermaidSyntax.replace(`"${nodes[node]}"`, `"${typeof alias === 'string' ? alias : alias.display}"`);
  return {name:item.name,path:item.path,index:item.index,title:block.title,canonicalSource:block.source,sourceDigest:digest(block.source),documentDigest:digest(raw),sourceFingerprint:metadata.sourceFingerprint,nodes,nodeAliases,edges,mermaidSyntax,note:item.note??null,action:changed?'generate':'inherit-identical-diagram',previousDiagramId:item.previous?.diagramId??null,previousPanelId:item.previous?.panelId??null,previousLegendId:item.previous?.legendId??null};
});
fs.writeFileSync(path.join(directory,'figjam-payloads.json'), JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({diagrams:output.length,generate:output.filter(i=>i.action==='generate').map(i=>i.name),inherited:output.filter(i=>i.action!=='generate').length,nodes:output.reduce((n,i)=>n+Object.keys(i.nodes).length,0),edges:output.reduce((n,i)=>n+i.edges.length,0)},null,2));
