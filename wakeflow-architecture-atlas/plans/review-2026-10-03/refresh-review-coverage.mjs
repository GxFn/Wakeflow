import fs, {globSync} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {sourceIndex, testIndex, documentParts, diagramBlocks, fingerprintInputs} from '../../scripts/atlas-validation.mjs';

// This aggregates authored semantic ledgers. It never invents review prose from an AST.
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const atlas = 'wakeflow-architecture-atlas';
const oldDirectory = `${atlas}/plans/review-2026-10-02`;
const directory = `${atlas}/plans/review-2026-10-03`;
const observedOn = '2026-10-03';
const full = relative => path.join(repositoryRoot, relative);
const read = relative => fs.readFileSync(full(relative), 'utf8');
const json = relative => JSON.parse(read(relative));
const hash = relative => crypto.createHash('sha256').update(fs.readFileSync(full(relative))).digest('hex');
const files = pattern => globSync(pattern, {cwd: repositoryRoot}).filter(p => fs.statSync(full(p)).isFile()).sort();
const oldCoveragePath = `${oldDirectory}/review-coverage.json`;
const previous = json(oldCoveragePath);
const baseline = json(`${directory}/source-baseline.json`);
const baselineByPath = new Map(baseline.files.map(entry => [entry.path, entry]));
const previousByPath = new Map(previous.handwritten.map((entry, index) => [entry.path, {entry, recordNumber: index + 1}]));
const currentLedgers = [
  {id: 'FC03', file: 'foundation-contracts-tooling-files.json', label: '基础边界、当前配置协议与工具', expected: 5},
  {id: 'WH03', file: 'hosts-workspace-files.json', label: '工作区、宿主、入口与文本', expected: 23},
  {id: 'DD03', file: 'demand-delivery-files.json', label: 'Demand、任务、投递与评审', expected: 13},
  {id: 'CE03', file: 'coordination-files.json', label: 'Kernel、协调与观察', expected: 17},
];
const problems = {
  missing: [], duplicates: [], outsideHandwrittenInventory: [], staleSourceHashes: [], nonSemanticRecords: [],
  malformedRecords: [], previousLedgerDrift: [], previousCoverageMismatch: [], baselineDrift: [],
  missingSchemaPairs: [], invalidTestAssociations: [], inventoryCountMismatch: [],
};
const ledgerInventory = [];
const ledgerRows = new Map();
const records = new Map();
const hasAuthoredProse = value => typeof value === 'string' ? value.trim().length > 0 : Array.isArray(value) && value.every(item => typeof item === 'string');
const semanticValid = (record, location) => {
  const malformed = !record || typeof record.path !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256 ?? '') ||
    typeof record.responsibility !== 'string' || !record.responsibility.trim() ||
    ['branches', 'effects'].some(field => !hasAuthoredProse(record[field])) ||
    ['consumers', 'tests'].some(field => !Array.isArray(record[field]));
  if (malformed) problems.malformedRecords.push(location);
  if (record?.reviewDepth !== 'semantic') problems.nonSemanticRecords.push(location);
  return !malformed && record.reviewDepth === 'semantic';
};
for (const priorLedger of previous.ledgerInventory) {
  if (hash(priorLedger.path) !== priorLedger.sha256) problems.previousLedgerDrift.push(priorLedger.path);
  const rows = json(priorLedger.path);
  ledgerRows.set(priorLedger.path, rows);
  ledgerInventory.push({...priorLedger, id: `${priorLedger.id}02`, observedReview: '2026-10-02', selectedRecordCount: 0});
}
for (const spec of currentLedgers) {
  const ledgerPath = `${directory}/${spec.file}`;
  const rows = json(ledgerPath);
  ledgerRows.set(ledgerPath, rows);
  ledgerInventory.push({id: spec.id, path: ledgerPath, label: spec.label, sha256: hash(ledgerPath), recordCount: rows.length, observedReview: observedOn, selectedRecordCount: 0});
  if (rows.length !== spec.expected) problems.inventoryCountMismatch.push({kind: spec.id, expected: spec.expected, actual: rows.length});
  rows.forEach((record, index) => {
    const location = {ledgerPath, recordNumber: index + 1, path: record?.path};
    semanticValid(record, location);
    if (!record || typeof record.path !== 'string') return;
    const source = {ledgerId: spec.id, ledgerPath, recordNumber: index + 1, recordedSha256: record.sha256, reviewDepth: record.reviewDepth};
    if (records.has(record.path)) problems.duplicates.push({path: record.path, sources: [records.get(record.path).source, source]});
    else records.set(record.path, {record, source, reviewStatus: 're-reviewed-current-semantic'});
  });
}
const runtime = files('src/**/*.ts').filter(p => !p.startsWith('src/contracts/generated/'));
const tooling = files('tooling/**/*.ts');
const handwrittenPaths = [...runtime, ...tooling].sort();
const handwrittenSet = new Set(handwrittenPaths);
for (const [p, entry] of records) if (!handwrittenSet.has(p)) problems.outsideHandwrittenInventory.push({path: p, source: entry.source});
const currentTests = testIndex(repositoryRoot);
const oldTestInventory = new Map(previous.auxiliaryInventories.tests.map(entry => [entry.path, entry]));
const associations = [];
const testDeclarations = [];
const handwritten = [];
for (const sourcePath of handwrittenPaths) {
  const actualSha256 = hash(sourcePath);
  const prior = previousByPath.get(sourcePath);
  const currentBaseline = baselineByPath.get(sourcePath);
  if (currentBaseline?.sha256 !== actualSha256) problems.baselineDrift.push({path: sourcePath, baselineSha256: currentBaseline?.sha256 ?? null, currentSha256: actualSha256});
  let selected = records.get(sourcePath);
  if (selected === undefined) {
    if (prior === undefined || prior.entry.sha256 !== actualSha256) {
      problems.missing.push({path: sourcePath, reason: prior === undefined ? 'no-semantic-record' : 'changed-without-current-review'});
      continue;
    }
    if (prior.entry.records.length !== 1) {
      problems.previousCoverageMismatch.push({path: sourcePath, reason: 'not-one-previous-record'});
      continue;
    }
    const oldReference = prior.entry.records[0];
    const record = ledgerRows.get(oldReference.ledgerPath)?.[oldReference.recordNumber - 1];
    semanticValid(record, {ledgerPath: oldReference.ledgerPath, recordNumber: oldReference.recordNumber, path: sourcePath});
    if (record?.path !== sourcePath || record?.sha256 !== actualSha256) {
      problems.previousCoverageMismatch.push({path: sourcePath, reason: 'previous-ledger-record-mismatch'});
      continue;
    }
    selected = {record, source: {...oldReference, ledgerId: `${oldReference.ledgerId}02`}, reviewStatus: 'inherited-unchanged-semantic'};
    records.set(sourcePath, selected);
  }
  if (selected.record.sha256 !== actualSha256) problems.staleSourceHashes.push({path: sourcePath, actualSha256, recordedSha256: selected.record.sha256, source: selected.source});
  const countOwner = ledgerInventory.find(entry => entry.path === selected.source.ledgerPath);
  countOwner.selectedRecordCount += 1;
  const sourceWasInherited = selected.reviewStatus === 'inherited-unchanged-semantic';
  const testLinks = [];
  for (const declaration of selected.record.tests) {
    const text = typeof declaration === 'string' ? declaration : declaration?.anchor;
    if (typeof text !== 'string') {
      problems.invalidTestAssociations.push({path: sourcePath, source: selected.source, reason: 'unsupported-test-declaration'});
      continue;
    }
    const references = [...text.matchAll(/\b(tests\/[A-Za-z0-9_.\/-]+\.ts)(?:#([A-Za-z_$][A-Za-z0-9_.$]*))?/gu)];
    if (references.length === 0) {
      if (/^(?:未覆盖|间接覆盖)[：:]/u.test(text)) testDeclarations.push({path: sourcePath, declaration: text, source: selected.source, validation: 'retained-scope-declaration-not-an-anchor'});
      else problems.invalidTestAssociations.push({path: sourcePath, declaration: text, source: selected.source, reason: 'not-an-anchor-or-explicit-boundary'});
      continue;
    }
    for (const [, testPath, symbol] of references) {
      const exists = fs.existsSync(full(testPath));
      const symbolPresent = !symbol || currentTests.get(testPath)?.symbols.has(symbol) === true;
      if (!exists || !symbolPresent) {
        problems.invalidTestAssociations.push({path: sourcePath, anchor: testPath + (symbol ? `#${symbol}` : ''), source: selected.source, reason: !exists ? 'file-missing' : 'symbol-missing'});
        continue;
      }
      const previousTest = oldTestInventory.get(testPath);
      const currentTestSha256 = hash(testPath);
      const testChange = previousTest === undefined ? 'added' : previousTest.sha256 === currentTestSha256 ? 'unchanged' : 'changed';
      const association = {
        handwrittenPath: sourcePath, anchor: testPath + (symbol ? `#${symbol}` : ''), testPath,
        symbol: symbol ?? null, currentTestSha256, testChange,
        locatorValidation: symbol ? 'AST-symbol-present' : 'file-association-only-no-symbol-claim',
        source: selected.source,
        assertionReview: sourceWasInherited && testChange !== 'unchanged'
          ? 'source-review-inherited-but-changed-test-assertions-not-inherited; locator-revalidated-only'
          : sourceWasInherited ? 'previous-ledger-test-scope-inherited; no-new-execution-claim'
            : 'current-ledger-declaration-retained; exact-assertion-scope-owned-by-authored-record',
      };
      associations.push(association);
      testLinks.push(association);
    }
  }
  handwritten.push({
    path: sourcePath, kind: sourcePath.startsWith('tooling/') ? 'tooling' : 'runtime', sha256: actualSha256,
    lines: read(sourcePath).split(/\r?\n/u).length - (read(sourcePath).endsWith('\n') ? 1 : 0),
    reviewStatus: selected.reviewStatus, records: [selected.source],
    previousReview: prior === undefined ? null : {coveragePath: oldCoveragePath, coverageRecordNumber: prior.recordNumber, sha256: prior.entry.sha256, sameSourceBytes: prior.entry.sha256 === actualSha256},
    testAssociationCount: testLinks.length,
    changedTestLocatorCount: testLinks.filter(entry => entry.testChange !== 'unchanged').length,
  });
}
for (const entry of baseline.files) {
  if ((entry.path.startsWith('src/') && entry.path.endsWith('.ts') && !entry.path.startsWith('src/contracts/generated/')) || entry.path.startsWith('tooling/') && entry.path.endsWith('.ts')) {
    if (!handwrittenSet.has(entry.path)) problems.baselineDrift.push({path: entry.path, reason: 'file-removed-since-update-baseline'});
  }
}
const generatedPaths = files('src/contracts/generated/**/*.ts');
const schemaPaths = files('src/contracts/schemas/**/*.json');
const testPaths = files('tests/**/*.ts');
const auxiliaryInventories = {
  generated: generatedPaths.map(p => {
    const pairedSchema = p.replace('src/contracts/generated/', 'src/contracts/schemas/').replace(/\.generated\.ts$/u, '.schema.json');
    if (!schemaPaths.includes(pairedSchema)) problems.missingSchemaPairs.push({generated: p, pairedSchema});
    return {path: p, sha256: hash(p), pairedSchema, reviewClassification: 'derived-inventory-and-source-link-only'};
  }),
  schemas: schemaPaths.map(p => {
    const pairedGenerated = p.replace('src/contracts/schemas/', 'src/contracts/generated/').replace(/\.schema\.json$/u, '.generated.ts');
    if (!generatedPaths.includes(pairedGenerated)) problems.missingSchemaPairs.push({schema: p, pairedGenerated});
    return {path: p, sha256: hash(p), pairedGenerated, reviewClassification: 'inventory-and-module-contract-review-not-full-semantic-claim'};
  }),
  tests: testPaths.map(p => {
    const linked = associations.filter(entry => entry.testPath === p);
    const previousTest = oldTestInventory.get(p);
    const currentSha256 = hash(p);
    return {path: p, sha256: currentSha256, kind: p.endsWith('.test.ts') ? 'test' : p.endsWith('.fixture.ts') ? 'fixture' : 'support',
      changeSincePreviousReview: previousTest === undefined ? 'added' : previousTest.sha256 === currentSha256 ? 'unchanged' : 'changed',
      associationCount: linked.length, associations: linked.map(({testPath: _testPath, currentTestSha256: _sha, ...entry}) => entry),
      reviewClassification: 'inventory-and-authored-ledger-associations-not-line-by-line-test-review'};
  }),
};
const reviewedNow = handwritten.filter(entry => entry.reviewStatus === 're-reviewed-current-semantic').length;
const inherited = handwritten.filter(entry => entry.reviewStatus === 'inherited-unchanged-semantic').length;
const countChecks = {runtime: [360, runtime.length], tooling: [10, tooling.length], handwritten: [370, handwrittenPaths.length], currentReviews: [58, reviewedNow], inheritedReviews: [312, inherited], schemas: [95, schemaPaths.length], generated: [95, generatedPaths.length], tests: [297, testPaths.length]};
for (const [kind, [expected, actual]] of Object.entries(countChecks)) if (expected !== actual) problems.inventoryCountMismatch.push({kind, expected, actual});
const inputPaths = [...new Set([...handwrittenPaths, ...generatedPaths, ...schemaPaths, ...testPaths, ...ledgerInventory.map(entry => entry.path), oldCoveragePath, `${directory}/source-baseline.json`, `${directory}/refresh-review-coverage.mjs`])].sort();
const inputFingerprint = fingerprintInputs({sourcePaths: inputPaths}, repositoryRoot).digest;
const report = {
  kind: 'WakeflowArchitectureReviewCoverage', verifiedAt: observedOn, baselineCommit: baseline.baselineCommit, truthKind: 'in-progress-worktree',
  method: '合并本轮4份人工语义台账；仅当生产源码SHA与旧覆盖及旧原始记录均相同时继承旧语义记录。独立枚举源码、生成文件、Schema与tests，机械检查只验证覆盖/定位，不生成语义结论。',
  semanticAuthority: 'responsibility/branches/effects/consumers/tests由各原始人工记录拥有；汇总保留原ledger路径、数组条目号与SHA。AST仅验证导入或符号存在。',
  previousCoverage: {path: oldCoveragePath, sha256: hash(oldCoveragePath)},
  ok: Object.values(problems).every(values => values.length === 0),
  summary: {
    expectedRuntime: 360, actualRuntime: runtime.length, expectedTooling: 10, actualTooling: tooling.length,
    handwrittenSourceFiles: handwrittenPaths.length, uniqueReviewedPaths: handwritten.length, currentSemanticRecords: handwritten.length,
    newlyReviewedSemanticRecords: reviewedNow, inheritedUnchangedSemanticRecords: inherited,
    addedSincePreviousReview: handwritten.filter(entry => entry.previousReview === null).length,
    changedSincePreviousReview: handwritten.filter(entry => entry.previousReview !== null && !entry.previousReview.sameSourceBytes).length,
    handwrittenLines: handwritten.reduce((total, entry) => total + entry.lines, 0),
    generatedFiles: generatedPaths.length, schemaFiles: schemaPaths.length, testFiles: testPaths.length,
    testFilesWithExistingAssociations: auxiliaryInventories.tests.filter(entry => entry.associationCount > 0).length,
    anchoredTestAssociations: associations.filter(entry => entry.symbol !== null).length,
    fileOnlyTestAssociations: associations.filter(entry => entry.symbol === null).length,
    changedOrAddedTestAssociations: associations.filter(entry => entry.testChange !== 'unchanged').length,
    inheritedSourceAssociationsToChangedTests: associations.filter(entry => entry.assertionReview.startsWith('source-review-inherited')).length,
    explicitTestBoundaryDeclarations: testDeclarations.length,
    fullLineSemanticTestReviewClaimed: false, generatedSemanticReviewClaimed: false,
  },
  ledgerInventory, problems, handwritten, testDeclarations, auxiliaryInventories,
  testLocatorSemantics: '现有tests/path#symbol锚点全部按当前AST复验；无符号路径只算文件关联。源文件未变但测试已变时，只继承源码语义记录，不继承新测试断言或执行结果。旧台账中的明确未覆盖/间接说明保留为边界声明。',
  generationGate: {commands: ['npm run schema:build', 'npm run schema:check'], owner: 'tooling/codegen/schema-types.ts', executedByThisCoverageStep: false, meaning: 'Schema/生成TS配对与字节库存不代替生成漂移门；主代理另行运行。'},
  executionEvidence: {testsExecutedByThisStep: false, realHostSessionVerified: false}, inputFingerprint, inputPaths,
};
if (!report.ok) {
  console.error(JSON.stringify({ok: false, summary: report.summary, problems}, null, 2));
  process.exitCode = 1;
} else {
  const writeJson = (p, data) => fs.writeFileSync(full(p), JSON.stringify(data, null, 2) + '\n');
  writeJson(`${directory}/review-coverage.json`, report);
  const modules = sourceIndex(repositoryRoot);
  const importGraph = {
    kind: 'WakeflowAtlasStaticImportGraph', observedOn, parser: 'SWC/sourceIndex',
    semantics: '源码直接静态import与re-export，包含type-only；只含仓库内src/tooling模块，不表示运行时调用、顺序或副作用。',
    moduleCount: modules.size, relationCount: [...modules.values()].reduce((n, entry) => n + entry.imports.size, 0),
    modules: [...modules].map(([p, entry]) => ({path: p, sha256: hash(p), imports: [...entry.imports].sort()})),
  };
  writeJson(`${directory}/import-graph.json`, importGraph);
  const metadata = {
    diagramId: 'ts-file-review-index', viewType: 'evidence', truthKind: 'in-progress-worktree', reviewDepth: 'L5', verifiedAt: observedOn,
    baselineCommit: baseline.baselineCommit, audience: ['maintainer', 'reviewer'], documentationOwner: 'Wakeflow Architecture Atlas', generatedBy: 'mixed', testEvidence: 'anchored',
    sourcePaths: ['src/**/*.ts', 'tooling/**/*.ts'], schemaPaths: ['src/contracts/schemas/**/*.json'], testPaths: ['tests/**/*.ts'],
    refreshTriggers: [...ledgerInventory.map(entry => entry.path), oldCoveragePath, `${directory}/source-baseline.json`, `${directory}/review-coverage.json`, `${directory}/refresh-review-coverage.mjs`],
  };
  metadata.sourceFingerprint = fingerprintInputs(metadata, repositoryRoot).digest;
  const cell = value => String(value).replaceAll('|', '\\|').replace(/\r?\n/gu, ' ');
  const frontmatter = '---\n' + Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n') + '\n---\n';
  const lines = [frontmatter,
    '# 逐文件审阅索引：370个手写文件与当前来源闭合', '',
    '2026-10-03 工作树：**360个运行时手写文件＋10个工具文件＝370个唯一路径**。其中 **58个变化/新增文件重新语义审阅，312个文件因源码字节未变而继承2026-10-02记录**。继承同时核对旧覆盖、旧原始台账条目与当前SHA；它不是本轮重复阅读全文的声明。', '',
    '每行职责与首项分支摘自人工台账；完整分支、效果、消费者和断言范围由原记录拥有。记录号是JSON数组从1开始的位置，`02`/`03`分别标识两次审阅；不以AST或测试文件同名生成审阅结论。', '',
    '[覆盖与SHA报告](../plans/review-2026-10-03/review-coverage.json) · [可重跑汇总脚本](../plans/review-2026-10-03/refresh-review-coverage.mjs) · [静态导入库存](../plans/review-2026-10-03/import-graph.json)。', '',
    '## 范围与证据层次', '',
    '| 对象 | 当前数量 | 本页证明的范围 | 不主张 |', '| --- | ---: | --- | --- |',
    '| 手写运行时TypeScript | 360 | 每条当前SHA与唯一semantic记录相符 | 每个分支都已执行测试 |',
    '| 手写工具TypeScript | 10 | 同上；单独保留构建/测试工具副作用 | 库存或构建等于发布成功 |',
    '| 本轮语义复核 | 58 | 51个旧文件变化与7个新增文件有本轮记录 | 仅刷指纹即复核 |',
    '| 字节未变继承 | 312 | 当前文件、旧覆盖、旧台账的SHA一致 | 本轮重新逐行审阅了312文件 |',
    '| 生成TypeScript / JSON Schema | 95 / 95 | 路径、SHA与一一配对 | 全部生成文件或Schema逐行语义审查 |',
    '| tests内TypeScript | 297 | tests/fixture/support库存及既有记录关联 | 297文件全部逐行审查或真实宿主验证 |', '',
    '## 测试定位与继承边界', '',
    `当前复验${report.summary.anchoredTestAssociations}条带符号的测试关联，${report.summary.fileOnlyTestAssociations}条仅文件关联；${report.summary.testFilesWithExistingAssociations}个测试/fixture/support文件被台账关联。${report.summary.explicitTestBoundaryDeclarations}条明确未覆盖或间接覆盖说明原样保留。所有实际符号锚点当前存在，失效锚点为0。`, '',
    `其中${report.summary.inheritedSourceAssociationsToChangedTests}条关联属于“源码未变、关联测试已变”：本轮只重新确认定位，不继承新断言的语义或执行成功。AST符号存在只证明可定位，不能证明调用一定走过或断言充分。旧测试结果也不覆盖当前变化；执行结果由统一验证记录另列。`, '',
    '## 台账来源', '', '| 代号 | 原记录数 | 本次选用数 | 复核日期与范围 | 原始记录 |', '| --- | ---: | ---: | --- | --- |',
    ...ledgerInventory.map(entry => `| ${entry.id} | ${entry.recordCount} | ${entry.selectedRecordCount} | ${entry.observedReview} · ${cell(entry.label)} | [${path.basename(entry.path)}](${path.posix.relative(`${atlas}/maps`, entry.path)}) |`), '',
    '旧台账363条保持原样；本轮选用其中312条，其余51条由Oct3重新审阅记录替代。当前覆盖无重复、缺项、越界、非semantic或摘要漂移。Schema生成门仍由 `tooling/codegen/schema-types.ts` 拥有，本汇总不执行或替代 `schema:check`。', '',
  ];
  const categories = [
    ['src/foundation', 'Foundation：物理与通用原语'], ['src/contracts', 'Contracts：手写合同与词汇'], ['src/kernel', 'Kernel：公共调用与工作区协调'],
    ['src/configuration', 'Configuration：配置权威'], ['src/workspace', 'Workspace：物化与运行窗口'], ['src/governance', 'Governance：领域事实与规则'],
    ['src/capabilities', 'Capabilities：公共纵切'], ['src/hosts', 'Hosts：宿主差异'], ['src/entrypoints', 'Entrypoints：进程与公共装配'], ['tooling', 'Tooling：源码工具链'],
  ];
  for (const [prefix, heading] of categories) {
    const selectedPaths = handwrittenPaths.filter(p => p.startsWith(`${prefix}/`));
    if (!selectedPaths.length) continue;
    lines.push(`## ${heading}`, '');
    const directories = [...new Set(selectedPaths.map(p => path.posix.dirname(p)))].sort();
    for (const dir of directories) {
      const group = selectedPaths.filter(p => path.posix.dirname(p) === dir);
      lines.push(`### ${dir}（${group.length}）`, '', '| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |', '| --- | --- | --- | --- |');
      for (const sourcePath of group) {
        const selected = records.get(sourcePath);
        const record = selected.record;
        const firstBranch = typeof record.branches === 'string' ? record.branches : record.branches[0];
        const description = record.responsibility + (firstBranch ? `；${firstBranch}` : '');
        lines.push(`| \`${path.posix.basename(sourcePath)}\` | ${cell(description)} | ${selected.reviewStatus === 'inherited-unchanged-semantic' ? '字节未变继承' : '本轮语义复核'} | [${selected.source.ledgerId} · ${selected.source.recordNumber}](${path.posix.relative(`${atlas}/maps`, selected.source.ledgerPath)}) |`);
      }
      lines.push('');
    }
  }
  lines.push('[图谱入口](./README.md) · [逐图台账](./01-diagram-review-ledger.md) · [本轮范围](../plans/review-2026-10-03/source-baseline.json)。', '');
  fs.writeFileSync(full(`${atlas}/maps/02-file-review-index.md`), lines.join('\n'));
  const diagramFiles = files(`${atlas}/maps/**/*.md`);
  const diagramRows = [];
  for (const file of diagramFiles) {
    const {metadata: meta, body} = documentParts(read(file));
    for (const block of diagramBlocks(body)) diagramRows.push({path: file.slice(`${atlas}/maps/`.length), index: block.index, title: block.title, viewType: meta.viewType ?? 'standard', reviewDepth: meta.reviewDepth ?? '—', truthKind: meta.truthKind ?? 'standard'});
  }
  const status = {'in-progress-worktree': '工作树快照', 'current-code': '当前代码', historical: '历史', stale: '待复核', 'target-design': '目标设计', standard: '绘图规范'};
  const ledger = ['# 逐图核验台账', '',
    `2026-10-03 工作树共有 **${diagramRows.length}张实际Mermaid图**，分布于${new Set(diagramRows.map(row => row.path)).size}份含图文档。每行按当前maps中的accTitle列出一张图；静态导入、调用、状态与恢复保持各自语义。图的列举不证明渲染或源码验证通过。`, '',
    '结构/符号/测试锚点/来源指纹由图谱检查器核验；[当前浏览器渲染回执](../plans/evidence/current-mermaid-render.json)须匹配每张图的最新源码摘要才有效。旧日期的测试或FigJam记录不能自动证明本轮更新通过。', '',
    '| 文档 | 图号与中文标题 | 视图 / 深度 | 来源状态 |', '| --- | --- | --- | --- |',
    ...diagramRows.map(row => `| [${row.path}](./${row.path}) | ${row.index} · ${cell(row.title)} | ${row.viewType} / ${row.reviewDepth} | ${status[row.truthKind] ?? cell(row.truthKind)} |`), '',
    '[逐文件审阅索引](./02-file-review-index.md) · [绘图标准](./00-agentic-diagram-standard.md) · [当前覆盖报告](../plans/review-2026-10-03/review-coverage.json)。', ''];
  fs.writeFileSync(full(`${atlas}/maps/01-diagram-review-ledger.md`), ledger.join('\n'));
  console.log(JSON.stringify({ok: true, summary: report.summary, modules: importGraph.moduleCount, staticImports: importGraph.relationCount, diagrams: diagramRows.length, diagramDocuments: new Set(diagramRows.map(row => row.path)).size}, null, 2));
}
