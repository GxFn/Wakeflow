import fs, { globSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Freeze once after the authored semantic ledgers agree with current source bytes.
// A later source change must be reviewed explicitly; rerunning never overwrites this evidence.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const directory = 'wakeflow-architecture-atlas/plans/review-2026-10-03-rc4';
const initialPath = `${directory}/source-baseline.json`;
const previousPath = 'wakeflow-architecture-atlas/plans/review-2026-10-03/review-coverage.json';
const previousBaselinePath = 'wakeflow-architecture-atlas/plans/review-2026-10-03/source-baseline.json';
const target = `${directory}/source-baseline-final.json`;
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const json = file => JSON.parse(read(file));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const files = pattern => globSync(pattern, { cwd: root }).filter(file => fs.statSync(path.join(root, file)).isFile()).sort();
if (fs.existsSync(path.join(root, target))) throw new Error('Final baseline already exists; review drift instead of overwriting it.');
const initial = json(initialPath);
const previous = json(previousPath);
if (!previous.ok) throw new Error('The previous coverage is not a passing coverage record.');
const initialByPath = new Map(initial.files.map(row => [row.path, row]));
const previousByPath = new Map(json(previousBaselinePath).files.map(row => [row.path, row]));
for (const row of [...previous.handwritten, ...Object.values(previous.auxiliaryInventories).flat()]) previousByPath.set(row.path, row);
const ledgerPaths = ['privacy-evidence-files.json', 'callback-files.json', 'concurrency-files.json'].map(file => `${directory}/${file}`);
const reviewed = new Map();
for (const file of ledgerPaths) for (const [index, row] of json(file).entries()) {
  if (reviewed.has(row.path)) throw new Error(`Duplicate current semantic record: ${row.path}`);
  if (row.reviewDepth !== 'semantic' || row.sha256 !== hash(row.path)) throw new Error(`Current ledger does not close source: ${row.path}`);
  reviewed.set(row.path, { ledgerPath: file, recordNumber: index + 1, sha256: row.sha256 });
}
const inventory = [...new Set([
  ...files('src/**/*.ts'), ...files('src/contracts/schemas/**/*.json'),
  ...files('tooling/**/*.ts'), ...files('tests/**/*.ts'),
  ...files('assets/agent-text/**/*.md'), 'assets/release/version.json', 'package.json',
])].sort();
const kindOf = file => file.startsWith('src/contracts/generated/') ? 'generated'
  : file.startsWith('src/contracts/schemas/') ? 'schema'
    : file.startsWith('src/') ? 'runtime' : file.startsWith('tooling/') ? 'tooling'
      : file.startsWith('tests/') ? 'test' : file.startsWith('assets/agent-text/') ? 'agent-text' : 'metadata';
const rows = inventory.map(file => {
  const sha256 = hash(file), prior = previousByPath.get(file), start = initialByPath.get(file);
  const kind = kindOf(file);
  const change = prior === undefined ? 'added' : prior.sha256 === sha256 ? 'unchanged' : 'changed';
  if ((kind === 'runtime' || kind === 'tooling') && change !== 'unchanged' && !reviewed.has(file)) {
    throw new Error(`Changed source lacks authored review: ${file}`);
  }
  return { path: file, kind, sha256, lines: read(file).split(/\r?\n/u).length - (read(file).endsWith('\n') ? 1 : 0),
    previousSha256: prior?.sha256 ?? null, change,
    initialSha256: start?.sha256 ?? null,
    changeSinceInitialBaseline: start === undefined ? 'added' : start.sha256 === sha256 ? 'unchanged' : 'changed',
    semanticRecord: reviewed.get(file) ?? null };
});
const handwritten = rows.filter(row => row.kind === 'runtime' || row.kind === 'tooling');
const initiallyChanged = initial.files.filter(row => (row.kind === 'runtime' || row.kind === 'tooling') && row.change !== 'unchanged').map(row => row.path);
const newlyChanged = handwritten.filter(row => row.change !== 'unchanged' && initialByPath.get(row.path)?.change === 'unchanged').map(row => row.path);
const counts = Object.fromEntries([...new Set(rows.map(row => row.kind))].map(kind => [kind, rows.filter(row => row.kind === kind).length]));
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const [ahead, behind] = git(['rev-list', '--left-right', '--count', 'HEAD...origin/main']).split(/\s/u).map(Number);
const baseline = {
  kind: 'WakeflowAtlasFinalSourceBaseline', observedOn: '2026-10-03',
  sourceVersion: json('assets/release/version.json').version,
  baselineCommit: git(['rev-parse', 'HEAD']), truthKind: 'in-progress-worktree',
  initialBaseline: { path: initialPath, sha256: hash(initialPath), sourceVersion: initial.sourceVersion },
  previousCoverage: { path: previousPath, sha256: hash(previousPath) },
  previousBaseline: { path: previousBaselinePath, sha256: hash(previousBaselinePath), fallbackFor: 'agent-text/metadata only; code/test/schema/generated comparison uses selected rc.3 coverage bytes' },
  semantics: '独立保存本轮最终源库存；最初rc.4快照及修复前后证据不改写。代码变化必须有人工semantic记录，库存和SHA相等不生成新的语义结论。目录名保留起始轮次，最终版本由真实version输入记录。',
  rootState: { branch: git(['branch', '--show-current']), aheadOfOriginMain: ahead, behindOriginMain: behind, worktreeContainsUncommittedChanges: git(['status', '--porcelain']).length > 0 },
  counts,
  changePhases: {
    initiallyChangedHandwritten: initiallyChanged,
    newlyChangedConsumersDuringReview: newlyChanged,
    furtherChangedInitialHandwritten: handwritten.filter(row => initiallyChanged.includes(row.path) && row.changeSinceInitialBaseline !== 'unchanged').map(row => row.path),
    totalChangedHandwritten: handwritten.filter(row => row.change !== 'unchanged').map(row => row.path),
    explanation: '起始5个手写变更；修复时又改变 requirement/service 和 result-review/decide 两个消费者，全部落到本轮7个完整语义记录。交叉深读不重复计数。',
  },
  reviewedLedgers: ledgerPaths.map(file => ({ path: file, sha256: hash(file), recordCount: json(file).length })),
  executionEvidenceBoundary: 'Probe receipts and validation logs have a separate execution-evidence inventory; their reruns do not redefine this source/test baseline.',
  removedSinceInitialBaseline: initial.files.filter(row => !inventory.includes(row.path)).map(row => row.path),
  files: rows,
};
fs.writeFileSync(path.join(root, target), JSON.stringify(baseline, null, 2) + '\n');
console.log(JSON.stringify({ target, version: baseline.sourceVersion, counts, changePhases: baseline.changePhases }, null, 2));
