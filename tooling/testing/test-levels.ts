import { opendirSync, readFileSync } from "node:fs";
import path from "node:path";
import { testSourcesDependingOn } from "./impacted-tests.js";
import { LOAD_SENSITIVE_TAG_PATH, loadTestDurations } from "./run-typescript-tests.js";

/**
 * Wakeflow Tooling / Testing：按测试开发标准（docs/standards/testing-standard.md §2）给每个测试文件归级，
 * 并对照级别预算、负载标签与 `.load` 后缀报告偏差。只读；级别来自静态事实（目录、导入、调用），
 * 耗时来自签入的耗时表，不跑任何测试。它是维护者的清理清单，不是门的一部分。
 */

export type TestLevel = 0 | 1 | 2 | 3 | 4 | 5;

export const TEST_LEVEL_NAMES: Readonly<Record<TestLevel, string>> = Object.freeze({
  0: "pure",
  1: "component",
  2: "capability",
  3: "public-tool",
  4: "tooling",
  5: "artifact",
});

/** 单文件预算（毫秒，分道负载下的墙钟），标准 §2；场景链与 `.load` 文件另算。 */
export const TEST_LEVEL_BUDGETS_MS: Readonly<Record<TestLevel, number>> = Object.freeze({
  0: 1_000,
  1: 20_000,
  2: 90_000,
  3: 30_000,
  4: 360_000,
  5: 30_000,
});
export const CHAIN_BUDGET_MS = 600_000;
export const LOAD_FILE_BUDGET_MS = 360_000;

export interface TestLevelRecord {
  readonly file: string;
  readonly level: TestLevel;
  readonly chain: boolean;
  /** 归级依据：目录或命中的静态事实。 */
  readonly reason: string;
  readonly testCalls: number;
  readonly tagged: number;
  /** 静态导入闭包到达 `tests/support/load-sensitive.ts`。 */
  readonly loadSensitive: boolean;
  readonly loadSuffix: boolean;
  readonly header: boolean;
  readonly durationMs: number | null;
  readonly budgetMs: number;
}

export interface TestLevelsReport {
  readonly kind: "WakeflowTestLevels";
  readonly schemaVersion: 1;
  readonly status: "passed";
  readonly levels: readonly Readonly<{
    level: TestLevel;
    name: string;
    files: number;
    timedFiles: number;
    durationMs: number;
  }>[];
  readonly overBudget: readonly Readonly<{ file: string; durationMs: number; budgetMs: number }>[];
  /** 带标签的用例只占一部分的文件：按标准 §3 拆成两个文件。 */
  readonly mixed: readonly Readonly<{ file: string; tagged: number; testCalls: number }>[];
  readonly suffixProblems: readonly Readonly<{
    file: string;
    problem: "load-suffix-without-tag" | "fully-tagged-without-load-suffix";
  }>[];
  readonly missingHeader: Readonly<{ count: number; sample: readonly string[] }>;
  readonly untimed: readonly string[];
  readonly files: readonly TestLevelRecord[];
}

const MCP_PATTERN =
  /wakeflow-public-mcp-server\.fixture\.js|createCodexWakeflowMcpServer|createClaudeCodeWakeflowMcpServer/u;
const FILESYSTEM_PATTERN =
  /mkdtempSync|disposableRoot\(|createPreparedWorkspaceStore|DISPOSABLE_ROOT_OPTIONS|useDisposableDurability\(\)|RootedDirectory\.open\(|\.fixture\.js"/u;
const PROCESS_PATTERN = /from "node:child_process"|runGit\(|writeFakeCli\(/u;
const TEST_CALL_PATTERN = /^\s*(?:test|it)\(/gmu;
const TAG_PATTERN = /loadSensitive\(/gu;
const CAPABILITY_DIRECTORIES = /^tests\/(?:capabilities|workspace|hosts|configuration)\//u;

function collectTestSources(root: string): readonly string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    const handle = opendirSync(directory);
    try {
      for (;;) {
        const entry = handle.readSync();
        if (entry === null) break;
        if (entry.isSymbolicLink()) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(absolute);
        else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
          files.push(path.relative(root, absolute).split(path.sep).join("/"));
        }
      }
    } finally {
      handle.closeSync();
    }
  };
  visit(path.join(root, "tests"));
  return files.sort();
}

function classify(file: string, text: string): Readonly<{ level: TestLevel; reason: string }> {
  if (file.startsWith("tests/scenarios/")) return { level: 3, reason: "scenario chain" };
  if (file.startsWith("tests/tooling/")) return { level: 4, reason: "tooling directory" };
  if (/^tests\/(?:artifacts|codegen|release)\//u.test(file)) {
    return { level: 5, reason: "artifact directory" };
  }
  if (file.startsWith("tests/entrypoints/") || MCP_PATTERN.test(text)) {
    return { level: 3, reason: "public tools through an MCP client" };
  }
  const filesystem = FILESYSTEM_PATTERN.test(text);
  const subprocess = PROCESS_PATTERN.test(text);
  if (!filesystem && !subprocess) return { level: 0, reason: "no filesystem or process facts" };
  const facts = [filesystem ? "disposable filesystem" : null, subprocess ? "subprocess" : null]
    .filter((fact) => fact !== null)
    .join(" + ");
  if (CAPABILITY_DIRECTORIES.test(file))
    return { level: 2, reason: `${facts} in a capability directory` };
  return { level: 1, reason: `${facts} in a component directory` };
}

function hasHeader(text: string): boolean {
  const firstTest = text.search(TEST_CALL_PATTERN);
  const header = text.startsWith("/**") ? 0 : text.indexOf("\n/**");
  return header >= 0 && (firstTest < 0 || header < firstTest);
}

function budgetFor(level: TestLevel, chain: boolean, loadSuffix: boolean): number {
  if (chain) return CHAIN_BUDGET_MS;
  if (loadSuffix) return LOAD_FILE_BUDGET_MS;
  return TEST_LEVEL_BUDGETS_MS[level];
}

function recordFor(
  root: string,
  file: string,
  loadSensitive: ReadonlySet<string>,
  durations: ReadonlyMap<string, number>,
): TestLevelRecord {
  const text = readFileSync(path.join(root, file), "utf8");
  const { level, reason } = classify(file, text);
  const chain = file.startsWith("tests/scenarios/");
  const loadSuffix = file.endsWith(".load.test.ts");
  return Object.freeze({
    file,
    level,
    chain,
    reason,
    testCalls: (text.match(TEST_CALL_PATTERN) ?? []).length,
    tagged: (text.match(TAG_PATTERN) ?? []).length,
    loadSensitive: loadSensitive.has(file),
    loadSuffix,
    header: hasHeader(text),
    durationMs: durations.get(file) ?? null,
    budgetMs: budgetFor(level, chain, loadSuffix),
  });
}

function suffixProblemOf(
  record: TestLevelRecord,
): TestLevelsReport["suffixProblems"][number]["problem"] | null {
  if (record.loadSuffix && !record.loadSensitive) return "load-suffix-without-tag";
  if (
    !record.loadSuffix &&
    record.loadSensitive &&
    record.testCalls > 0 &&
    record.tagged === record.testCalls
  )
    return "fully-tagged-without-load-suffix";
  return null;
}

export function reportTestLevels(rootInput: string): Readonly<TestLevelsReport> {
  const root = path.resolve(rootInput);
  const loadSensitive = testSourcesDependingOn(root, LOAD_SENSITIVE_TAG_PATH);
  const durations = loadTestDurations(root);
  const files = collectTestSources(root).map((file) =>
    recordFor(root, file, loadSensitive, durations),
  );
  const levels = ([0, 1, 2, 3, 4, 5] as const).map((level) => {
    const own = files.filter((record) => record.level === level);
    return Object.freeze({
      level,
      name: TEST_LEVEL_NAMES[level],
      files: own.length,
      timedFiles: own.filter((record) => record.durationMs !== null).length,
      durationMs: own.reduce((sum, record) => sum + (record.durationMs ?? 0), 0),
    });
  });
  const missing = files.filter((record) => !record.header).map((record) => record.file);
  return Object.freeze({
    kind: "WakeflowTestLevels",
    schemaVersion: 1,
    status: "passed",
    levels: Object.freeze(levels),
    overBudget: Object.freeze(
      files
        .filter((record) => record.durationMs !== null && record.durationMs > record.budgetMs)
        .map((record) => ({
          file: record.file,
          durationMs: record.durationMs ?? 0,
          budgetMs: record.budgetMs,
        })),
    ),
    mixed: Object.freeze(
      files
        .filter(
          (record) => !record.loadSuffix && record.tagged > 0 && record.tagged < record.testCalls,
        )
        .map((record) => ({
          file: record.file,
          tagged: record.tagged,
          testCalls: record.testCalls,
        })),
    ),
    suffixProblems: Object.freeze(
      files.flatMap((record) => {
        const problem = suffixProblemOf(record);
        return problem === null ? [] : [{ file: record.file, problem }];
      }),
    ),
    missingHeader: Object.freeze({
      count: missing.length,
      sample: Object.freeze(missing.slice(0, 10)),
    }),
    untimed: Object.freeze(files.filter((record) => record.durationMs === null).map((r) => r.file)),
    files: Object.freeze(files),
  });
}
