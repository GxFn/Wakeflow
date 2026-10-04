import fs, {globSync} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {sourceIndex, testIndex, documentParts, diagramBlocks, fingerprintInputs} from '../../scripts/atlas-validation.mjs';

// This aggregates authored semantic ledgers. It never invents review prose from an AST.
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const atlas = 'wakeflow-architecture-atlas';
const oldDirectory = `${atlas}/plans/review-2026-10-03`;
const directory = `${atlas}/plans/review-2026-10-03-rc4`;
const observedOn = '2026-10-03';
const full = relative => path.join(repositoryRoot, relative);
const read = relative => fs.readFileSync(full(relative), 'utf8');
const json = relative => JSON.parse(read(relative));
const hash = relative => crypto.createHash('sha256').update(fs.readFileSync(full(relative))).digest('hex');
const files = pattern => globSync(pattern, {cwd: repositoryRoot}).filter(p => fs.statSync(full(p)).isFile()).sort();
const oldCoveragePath = `${oldDirectory}/review-coverage.json`;
const previous = json(oldCoveragePath);
const baseline = json(`${directory}/source-baseline-final.json`);
const sourceVersion = json('assets/release/version.json').version;
const executionInventoryPath = `${directory}/execution-evidence-inventory.json`;
const executionInventory = json(executionInventoryPath);
const baselineByPath = new Map(baseline.files.map(entry => [entry.path, entry]));
const previousByPath = new Map(previous.handwritten.map((entry, index) => [entry.path, {entry, recordNumber: index + 1}]));
const currentLedgers = [
  {id: 'PR05', file: 'privacy-evidence-files.json', label: '隐私分类、需求消费者与证据准入', expected: 4},
  {id: 'CB05', file: 'callback-files.json', label: '回调提示与提交身份消费者', expected: 2},
  {id: 'RW05', file: 'concurrency-files.json', label: '并发准入、观察竞争与许可交接', expected: 1},
];
const problems = {
  missing: [], duplicates: [], outsideHandwrittenInventory: [], staleSourceHashes: [], nonSemanticRecords: [],
  malformedRecords: [], previousLedgerDrift: [], previousCoverageMismatch: [], baselineDrift: [],
  missingSchemaPairs: [], invalidTestAssociations: [], inventoryCountMismatch: [],
  previousCoverageDrift: [], invalidInheritanceChains: [], finalEvidenceDrift: [], executionEvidenceDrift: [],
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
// Read nearest coverage first so a ledger keeps its existing display ID across many rounds.
// Raw history is immutable; selecting a record always uses its real path and array position.
const coverageByPath = new Map();
const coverageInventory = [];
function loadCoverageChain(coveragePath, expectedSha256) {
  const actualSha256 = hash(coveragePath);
  if (expectedSha256 !== undefined && actualSha256 !== expectedSha256)
    problems.previousCoverageDrift.push({path: coveragePath, expectedSha256, actualSha256});
  if (coverageByPath.has(coveragePath)) return;
  const coverage = json(coveragePath);
  coverageByPath.set(coveragePath, coverage);
  coverageInventory.push({path: coveragePath, sha256: actualSha256, verifiedAt: coverage.verifiedAt, handwrittenCount: coverage.handwritten.length});
  if (!coverage.ok) problems.previousCoverageMismatch.push({path: coveragePath, reason: 'previous-coverage-not-passing'});
  const seen = new Set();
  for (const row of coverage.handwritten) {
    if (seen.has(row.path)) problems.previousCoverageMismatch.push({path: row.path, coveragePath, reason: 'duplicate-previous-covered-path'});
    seen.add(row.path);
  }
  for (const priorLedger of coverage.ledgerInventory) {
    const ledgerHash = hash(priorLedger.path);
    if (ledgerHash !== priorLedger.sha256) problems.previousLedgerDrift.push({path: priorLedger.path, coveragePath, recordedSha256: priorLedger.sha256, currentSha256: ledgerHash});
    if (ledgerRows.has(priorLedger.path)) continue;
    const rows = json(priorLedger.path);
    if (rows.length !== priorLedger.recordCount) problems.inventoryCountMismatch.push({kind: 'historical-ledger', path: priorLedger.path, expected: priorLedger.recordCount, actual: rows.length});
    ledgerRows.set(priorLedger.path, rows);
    ledgerInventory.push({...priorLedger, observedReview: priorLedger.observedReview ?? coverage.verifiedAt, selectedRecordCount: 0});
  }
  if (coverage.previousCoverage !== undefined) loadCoverageChain(coverage.previousCoverage.path, coverage.previousCoverage.sha256);
}
loadCoverageChain(oldCoveragePath, baseline.previousCoverage.sha256);
if (sourceVersion !== baseline.sourceVersion) problems.baselineDrift.push({path: 'assets/release/version.json', reason: 'version-changed-after-final-baseline'});
for (const ref of [baseline.initialBaseline, ...baseline.reviewedLedgers]) {
  if (hash(ref.path) !== ref.sha256) problems.finalEvidenceDrift.push({path: ref.path, baselineSha256: ref.sha256, currentSha256: hash(ref.path)});
}
for (const ref of executionInventory.evidence) {
  if (hash(ref.path) !== ref.sha256) problems.executionEvidenceDrift.push({path: ref.path, recordedSha256: ref.sha256, currentSha256: hash(ref.path)});
}
function traceInheritedRecord(sourcePath, actualSha256, coveragePath, recordNumber, seen = new Set()) {
  const key = `${coveragePath}#${recordNumber}`;
  const failChain = reason => { problems.invalidInheritanceChains.push({path: sourcePath, coveragePath, recordNumber, reason}); return null; };
  if (seen.has(key)) return failChain('cycle');
  seen.add(key);
  const coverage = coverageByPath.get(coveragePath);
  const entry = coverage?.handwritten[recordNumber - 1];
  if (!entry || entry.path !== sourcePath || entry.sha256 !== actualSha256 || entry.records.length !== 1) return failChain('coverage-entry-mismatch');
  const reference = entry.records[0];
  const record = ledgerRows.get(reference.ledgerPath)?.[reference.recordNumber - 1];
  if (!record || record.path !== sourcePath || record.sha256 !== actualSha256 || reference.recordedSha256 !== actualSha256) return failChain('original-ledger-record-mismatch');
  if (!semanticValid(record, {ledgerPath: reference.ledgerPath, recordNumber: reference.recordNumber, path: sourcePath})) return failChain('record-not-semantic');
  const step = {coveragePath, coverageSha256: coverageInventory.find(row => row.path === coveragePath).sha256, coverageRecordNumber: recordNumber, sourceSha256: entry.sha256,
    selectedLedgerPath: reference.ledgerPath, selectedRecordNumber: reference.recordNumber, originalLedgerId: reference.ledgerId, reviewStatus: entry.reviewStatus};
  const chain = [step];
  if (entry.reviewStatus === 'inherited-unchanged-semantic') {
    const prior = entry.previousReview;
    if (!prior || !prior.sameSourceBytes || prior.sha256 !== actualSha256) return failChain('missing-same-byte-predecessor');
    const ancestry = traceInheritedRecord(sourcePath, actualSha256, prior.coveragePath, prior.coverageRecordNumber, seen);
    if (ancestry === null) return null;
    if (ancestry.source.ledgerPath !== reference.ledgerPath || ancestry.source.recordNumber !== reference.recordNumber) return failChain('selected-record-changed-in-inheritance');
    chain.push(...ancestry.chain);
  }
  const ledger = ledgerInventory.find(row => row.path === reference.ledgerPath);
  return {record, source: {...reference, ledgerId: ledger.id}, chain};
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
const oldAssociations = new Map(previous.auxiliaryInventories.tests.flatMap(entry => (entry.associations ?? []).map(association => [association.handwrittenPath + '\0' + association.anchor, association])));
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
    const inherited = traceInheritedRecord(sourcePath, actualSha256, oldCoveragePath, prior.recordNumber);
    if (inherited === null) continue;
    selected = {...inherited, reviewStatus: 'inherited-unchanged-semantic'};
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
      const anchor = testPath + (symbol ? `#${symbol}` : '');
      const oldAssociation = oldAssociations.get(sourcePath + '\0' + anchor);
      const priorRestriction = oldAssociation?.assertionReview?.startsWith('source-review-inherited-but-changed-test-assertions-not-inherited') === true;
      const cannotInheritAssertions = sourceWasInherited && (testChange !== 'unchanged' || priorRestriction);
      const association = {
        handwrittenPath: sourcePath, anchor, testPath,
        symbol: symbol ?? null, currentTestSha256, testChange,
        locatorValidation: symbol ? 'AST-symbol-present' : 'file-association-only-no-symbol-claim',
        source: selected.source,
        inheritedAssertionRestrictionCarriedForward: sourceWasInherited && priorRestriction,
        assertionReview: cannotInheritAssertions
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
    inheritanceChain: selected.chain ?? [],
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
const countChecks = {runtime: [baseline.counts.runtime, runtime.length], tooling: [baseline.counts.tooling, tooling.length],
  handwritten: [baseline.counts.runtime + baseline.counts.tooling, handwrittenPaths.length],
  currentReviews: [currentLedgers.reduce((sum, entry) => sum + entry.expected, 0), reviewedNow],
  schemas: [baseline.counts.schema, schemaPaths.length], generated: [baseline.counts.generated, generatedPaths.length], tests: [baseline.counts.test, testPaths.length]};
for (const [kind, [expected, actual]] of Object.entries(countChecks)) if (expected !== actual) problems.inventoryCountMismatch.push({kind, expected, actual});
const allInventoryPaths = [...new Set([...handwrittenPaths, ...generatedPaths, ...schemaPaths, ...testPaths,
  ...files('assets/agent-text/**/*.md'), 'assets/release/version.json', 'package.json'])].sort();
for (const file of allInventoryPaths) {
  const frozen = baselineByPath.get(file);
  if (frozen?.sha256 !== hash(file) && !problems.baselineDrift.some(entry => entry.path === file))
    problems.baselineDrift.push({path: file, baselineSha256: frozen?.sha256 ?? null, currentSha256: hash(file)});
}
for (const entry of baseline.files) if (!allInventoryPaths.includes(entry.path) && !problems.baselineDrift.some(row => row.path === entry.path))
  problems.baselineDrift.push({path: entry.path, reason: 'file-removed-after-final-snapshot'});
const inputPaths = [...new Set([...allInventoryPaths, ...ledgerInventory.map(entry => entry.path), ...coverageInventory.map(entry => entry.path),
  baseline.initialBaseline.path, executionInventoryPath, ...executionInventory.evidence.map(entry => entry.path),
  `${directory}/source-baseline-final.json`, `${directory}/refresh-review-coverage.mjs`, `${directory}/freeze-source-baseline.mjs`])].sort();
const inputFingerprint = fingerprintInputs({sourcePaths: inputPaths}, repositoryRoot).digest;
const report = {
  kind: 'WakeflowArchitectureReviewCoverage', verifiedAt: observedOn, baselineCommit: baseline.baselineCommit, truthKind: 'in-progress-worktree',
  sourceVersion, reviewSnapshot: 'plans/review-2026-10-03-rc4',
  finalBaseline: {path: `${directory}/source-baseline-final.json`, sha256: hash(`${directory}/source-baseline-final.json`)},
  method: `合并本轮${currentLedgers.length}份人工语义台账；仅当生产源码SHA与rc.3选中的实际记录一致时继承，并递归复验历史coverage引用和原始ledgerPath/recordNumber/SHA。独立枚举源码、生成文件、Schema与tests，机械检查只验证集合和定位，不生成语义结论。`,
  semanticAuthority: 'responsibility/branches/effects/consumers/tests由各原始人工记录拥有；汇总保留原ledger路径、数组条目号与SHA。AST仅验证导入或符号存在。',
  previousCoverage: {path: oldCoveragePath, sha256: hash(oldCoveragePath)},
  previousCoverageChain: coverageInventory,
  executionEvidenceInventory: {path: executionInventoryPath, sha256: hash(executionInventoryPath), semantics: 'separate from source/test baseline; receipt presence is not a new test execution by this aggregation step'},
  ok: Object.values(problems).every(values => values.length === 0),
  summary: {
    inventoryExpectationSource: 'source-baseline-final.json; source/test quantities are enumerated, never assumed',
    expectedRuntime: baseline.counts.runtime, actualRuntime: runtime.length, expectedTooling: baseline.counts.tooling, actualTooling: tooling.length,
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
    inheritedSourceAssociationsToChangedTests: associations.filter(entry => entry.assertionReview.startsWith('source-review-inherited') && entry.testChange !== 'unchanged').length,
    inheritedAssociationRestrictionsCarriedForward: associations.filter(entry => entry.inheritedAssertionRestrictionCarriedForward).length,
    inheritedSourceAssociationsWithUnrevalidatedAssertions: associations.filter(entry => entry.assertionReview.startsWith('source-review-inherited')).length,
    maximumInheritanceHops: Math.max(0, ...handwritten.map(entry => entry.inheritanceChain.length)),
    explicitTestBoundaryDeclarations: testDeclarations.length,
    fullLineSemanticTestReviewClaimed: false, generatedSemanticReviewClaimed: false,
  },
  ledgerInventory, problems, handwritten, testDeclarations, auxiliaryInventories,
  testLocatorSemantics: '现有tests/path#symbol锚点全部按当前AST复验；无符号路径只算文件关联。源文件未变但测试已变时，只继承源码语义记录，不继承新测试断言或执行结果。前一轮已标记的断言不可继承限制向后保留，不因本轮测试字节未变而洗成已审断言。明确未覆盖/间接说明保留为边界声明。',
  scopeAccounting: {changedFileSemanticReviews: reviewedNow, sameByteInheritedReviews: inherited, additionalCrossReadsCountedAgain: false, changePhases: baseline.changePhases},
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
    reviewSnapshot: 'plans/review-2026-10-03-rc4',
    sourcePaths: ['src/**/*.ts', 'tooling/**/*.ts'], schemaPaths: ['src/contracts/schemas/**/*.json'], testPaths: ['tests/**/*.ts'],
    refreshTriggers: [...ledgerInventory.map(entry => entry.path), ...coverageInventory.map(entry => entry.path), `${directory}/source-baseline.json`, `${directory}/source-baseline-final.json`, `${directory}/review-coverage.json`, `${directory}/refresh-review-coverage.mjs`, 'assets/release/version.json'],
  };
  metadata.sourceFingerprint = fingerprintInputs(metadata, repositoryRoot).digest;
  const cell = value => String(value).replaceAll('|', '\\|').replace(/\r?\n/gu, ' ');
  const frontmatter = '---\n' + Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n') + '\n---\n';
  const lines = [frontmatter,
    `# 逐文件审阅索引：${handwrittenPaths.length}个手写文件与当前来源闭合`, '',
    `${observedOn} 工作树，当前版本输入 **${sourceVersion}**：**${runtime.length}个运行时手写文件＋${tooling.length}个工具文件＝${handwrittenPaths.length}个唯一路径**。其中 **${reviewedNow}个变更文件本轮完整语义重审，${inherited}个文件按相同字节继承rc.3实际选中的历史记录**。继承沿coverage引用递归核对原ledger路径、条目号与SHA，不是本轮再次全文审阅的声明。`, '',
    `本轮目录保留起始rc.4名称，最终快照记录rc.5真实版本输入。起始${baseline.changePhases.initiallyChangedHandwritten.length}个手写变更，修复期间又改变${baseline.changePhases.newlyChangedConsumersDuringReview.length}个消费者：\`src/capabilities/requirement/service.ts\` 与 \`src/capabilities/result-review/decide.ts\`，均有本轮记录。额外交叉深读用于核实边界，不重复计入${reviewedNow}个完整重审或全量库存。`, '',
    '每行职责与首项分支摘自人工台账；完整分支、效果、消费者和断言范围由原记录拥有。记录号是JSON数组从1开始的位置，代号只用于查阅来源；历史台账和修复前后证据保持原样，不以AST或文件同名生成审阅结论。', '',
    '[覆盖与SHA报告](../plans/review-2026-10-03-rc4/review-coverage.json) · [可重跑汇总脚本](../plans/review-2026-10-03-rc4/refresh-review-coverage.mjs) · [静态导入库存](../plans/review-2026-10-03-rc4/import-graph.json)。', '',
    '## 范围与证据层次', '',
    '| 对象 | 当前数量 | 本页证明的范围 | 不主张 |', '| --- | ---: | --- | --- |',
    `| 手写运行时TypeScript | ${runtime.length} | 每条当前SHA与唯一semantic记录相符 | 每个分支都已执行测试 |`,
    `| 手写工具TypeScript | ${tooling.length} | 同上；单独保留构建/测试工具副作用 | 库存或构建等于发布成功 |`,
    `| 本轮完整语义复核 | ${reviewedNow} | ${report.summary.changedSincePreviousReview}个旧文件变化与${report.summary.addedSincePreviousReview}个新增文件有当前记录 | 仅刷指纹即复核 |`,
    `| 字节未变继承 | ${inherited} | 当前文件、选中覆盖和原台账的SHA一致 | 本轮重新逐行审阅全部继承文件 |`,
    `| 生成TypeScript / JSON Schema | ${generatedPaths.length} / ${schemaPaths.length} | 路径、SHA与一一配对 | 全部生成文件或Schema逐行语义审查 |`,
    `| tests内TypeScript | ${testPaths.length} | tests/fixture/support库存及既有记录关联 | 所有测试文件全部逐行审查或真实宿主验证 |`, '',
    '## 测试定位与继承边界', '',
    `当前复验${report.summary.anchoredTestAssociations}条带符号的测试关联，${report.summary.fileOnlyTestAssociations}条仅文件关联；${report.summary.testFilesWithExistingAssociations}个测试/fixture/support文件被台账关联。${report.summary.explicitTestBoundaryDeclarations}条明确未覆盖或间接覆盖说明原样保留。所有实际符号锚点当前存在，失效锚点为0。`, '',
    `其中${report.summary.inheritedSourceAssociationsToChangedTests}条关联是“源码继承、测试本轮已变”；另有${report.summary.inheritedAssociationRestrictionsCarriedForward}条沿用前轮已标记的断言不可继承限制，二者可以重叠。合计${report.summary.inheritedSourceAssociationsWithUnrevalidatedAssertions}条关联只重新确认定位，不继承未复核的断言或执行成功。测试本轮字节未变，也不能清除前轮留下的断言限制。AST符号存在只证明可定位；执行结果由统一验证记录另列。`, '',
    '## 台账来源', '', '| 代号 | 原记录数 | 本次选用数 | 复核日期与范围 | 原始记录 |', '| --- | ---: | ---: | --- | --- |',
    ...ledgerInventory.map(entry => `| ${entry.id} | ${entry.recordCount} | ${entry.selectedRecordCount} | ${entry.observedReview} · ${cell(entry.label)} | [${path.basename(entry.path)}](${path.posix.relative(`${atlas}/maps`, entry.path)}) |`), '',
    `历史${coverageInventory.length}轮覆盖及其原始台账保持原样；本轮逐路径优先使用${reviewedNow}条当前记录，其余${inherited}条追溯到真实选中记录，最长继承${report.summary.maximumInheritanceHops}级coverage引用。覆盖检查无重复、缺项、越界、非semantic或摘要漂移。Schema生成门仍由 \`tooling/codegen/schema-types.ts\` 拥有，本汇总不执行或替代 \`schema:check\`。`, '',
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
  lines.push('[图谱入口](./README.md) · [逐图台账](./01-diagram-review-ledger.md) · [最终来源快照](../plans/review-2026-10-03-rc4/source-baseline-final.json) · [保留的起始快照](../plans/review-2026-10-03-rc4/source-baseline.json)。', '');
  fs.writeFileSync(full(`${atlas}/maps/02-file-review-index.md`), lines.join('\n'));
  const diagramFiles = files(`${atlas}/maps/**/*.md`);
  const diagramRows = [];
  for (const file of diagramFiles) {
    const {metadata: meta, body} = documentParts(read(file));
    for (const block of diagramBlocks(body)) diagramRows.push({path: file.slice(`${atlas}/maps/`.length), index: block.index, title: block.title, viewType: meta.viewType ?? 'standard', reviewDepth: meta.reviewDepth ?? '—', truthKind: meta.truthKind ?? 'standard'});
  }
  const status = {'in-progress-worktree': '工作树快照', 'current-code': '当前代码', historical: '历史', stale: '待复核', 'target-design': '目标设计', standard: '绘图规范'};
  const ledger = ['# 逐图核验台账', '',
    `${observedOn} 工作树，版本输入${sourceVersion}：共有 **${diagramRows.length}张实际Mermaid图**，分布于${new Set(diagramRows.map(row => row.path)).size}份含图文档。每行按当前maps中的accTitle列出一张图；静态导入、调用、状态与恢复保持各自语义。图的列举不证明渲染或源码验证通过。`, '',
    '结构/符号/测试锚点/来源指纹由图谱检查器核验；[当前浏览器渲染回执](../plans/evidence/current-mermaid-render.json)须匹配每张图的最新源码摘要才有效。旧日期的测试或FigJam记录不能自动证明本轮更新通过。', '',
    '| 文档 | 图号与中文标题 | 视图 / 深度 | 来源状态 |', '| --- | --- | --- | --- |',
    ...diagramRows.map(row => `| [${row.path}](./${row.path}) | ${row.index} · ${cell(row.title)} | ${row.viewType} / ${row.reviewDepth} | ${status[row.truthKind] ?? cell(row.truthKind)} |`), '',
    '[逐文件审阅索引](./02-file-review-index.md) · [绘图标准](./00-agentic-diagram-standard.md) · [当前覆盖报告](../plans/review-2026-10-03-rc4/review-coverage.json)。', ''];
  fs.writeFileSync(full(`${atlas}/maps/01-diagram-review-ledger.md`), ledger.join('\n'));
  console.log(JSON.stringify({ok: true, summary: report.summary, modules: importGraph.moduleCount, staticImports: importGraph.relationCount, diagrams: diagramRows.length, diagramDocuments: new Set(diagramRows.map(row => row.path)).size}, null, 2));
}
