import fs, {globSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {documentParts, diagramBlocks, fingerprintInputs, sourceIndex, truthKinds, validateEdges, validateImports, validateLinks, validateReferences} from './atlas-validation.mjs';
const atlasRoot = fileURLToPath(new URL('..', import.meta.url));
const repositoryRoot = path.dirname(atlasRoot.replace(/\/$/u, ''));
const requireCurrent = process.argv.includes('--require-current');
const modules = sourceIndex(repositoryRoot);
const errors = [], staleFingerprints = [], documents = [];
const ids = new Set();
let diagrams = 0, fingerprints = 0, importEdges = 0, evidenceEdges = 0, symbolReferences = 0, links = 0;
for (const relative of globSync('maps/**/*.md', {cwd: atlasRoot}).sort()) {
  const absolute = path.join(atlasRoot, relative);
  const raw = fs.readFileSync(absolute, 'utf8');
  let parts;
  try {parts = documentParts(raw);} catch(error) {errors.push(relative + ': ' + error.message);continue;}
  const {metadata, body} = parts;
  if (metadata.truthKind !== undefined && !truthKinds.has(metadata.truthKind)) errors.push(relative + ': invalid truthKind');
  if (metadata.diagramId) {
    if(ids.has(metadata.diagramId)) errors.push(relative + ': duplicate diagramId');
    ids.add(metadata.diagramId);
  }
  const blocks = diagramBlocks(body);
  diagrams += blocks.length;
  for (const block of blocks) {const e=validateEdges(block);evidenceEdges+=e.ids.length;errors.push(...e.errors.map(x=>relative+'#'+block.index+': '+x));}
  if (relative.endsWith('/file-dependencies.md')) {const r=validateImports(body,modules);importEdges+=r.count;errors.push(...r.errors.map(x=>relative+': '+x));}
  const refs=validateReferences(raw,repositoryRoot,modules);symbolReferences+=refs.symbols;errors.push(...refs.errors.map(x=>relative+': '+x));
  const link=validateLinks(raw,path.dirname(absolute));links+=link.count;errors.push(...link.errors.map(x=>relative+': '+x));
  if (metadata.sourceFingerprint !== undefined) {
    fingerprints++;
    const f=fingerprintInputs(metadata,repositoryRoot);
    errors.push(...f.missing.map(x=>relative+': unmatched source input '+x));
    if(f.digest!==metadata.sourceFingerprint) {staleFingerprints.push(relative);if(metadata.truthKind!=='stale'||requireCurrent)errors.push(relative+': source fingerprint drift');}
    else if(metadata.truthKind==='stale') errors.push(relative+': matching fingerprint still stale');
  } else if(blocks.length && relative!=='maps/00-agentic-diagram-standard.md') errors.push(relative+': missing sourceFingerprint');
  documents.push({path:relative,diagramId:metadata.diagramId??null,truthKind:metadata.truthKind??'guide',diagrams:blocks.map(b=>({title:b.title,index:b.index}))});
}
const relativeAtlas=path.relative(repositoryRoot,atlasRoot).replace(/\/$/u,'');
const rootPackage=JSON.parse(fs.readFileSync(path.join(repositoryRoot,'package.json'),'utf8'));
const ignore=fs.readFileSync(path.join(repositoryRoot,'.gitignore'),'utf8');
const isolation={rootWorkspaceMember:(rootPackage.workspaces??[]).some(x=>String(x).includes(relativeAtlas)),rootScriptReference:Object.values(rootPackage.scripts??{}).some(x=>String(x).includes(relativeAtlas)),integrationMentions:['tsconfig.json','.dependency-cruiser.cjs'].filter(f=>fs.readFileSync(path.join(repositoryRoot,f),'utf8').includes(relativeAtlas)),buildOutputIgnored:ignore.split('\n').includes('.build/'),nestedDependenciesIgnored:ignore.split('\n').includes('node_modules/')};
if(isolation.rootWorkspaceMember||isolation.rootScriptReference||isolation.integrationMentions.length||!isolation.buildOutputIgnored||!isolation.nestedDependenciesIgnored)errors.push('atlas isolation violated');
for(const f of ['AGENTS.md','CLAUDE.md'])if(!fs.existsSync(path.join(atlasRoot,f)))errors.push('missing '+f);
if(!fs.readFileSync(path.join(atlasRoot,'CLAUDE.md'),'utf8').includes('AGENTS.md'))errors.push('CLAUDE must reference AGENTS');
// Coverage is tied to reader questions and real owners, not a minimum diagram count.
const required=['01-overall-architecture','02-foundation','03-configuration-workspace','04-governance-event-sourcing','05-tasking-slice','06-implementation-delivery-review','07-review-rework-completion','08-real-environment-testing','09-public-mcp-host-seams','10-end-to-end-business-flow','11-kernel','12-endpoint','13-requirement','14-evidence','15-pod'];
for(const area of required)if(!documents.some(d=>d.path==='maps/'+area+'/README.md'&&d.diagrams.length))errors.push('missing capability overview '+area);
const report={ok:errors.length===0,documents:documents.length,mermaidBlocks:diagrams,fingerprints,allFingerprintsCurrent:staleFingerprints.length===0,staleFingerprints,directImportEdgesChecked:importEdges,adjacentEvidenceRowsChecked:evidenceEdges,symbolReferencesChecked:symbolReferences,linksChecked:links,mermaidRendering:'separate check:diagrams',semanticReview:'documented manual source review; not inferred from imports',isolation,errors};
process.stdout.write(JSON.stringify(report,null,2)+'\n');
if(errors.length)process.exitCode=1;
