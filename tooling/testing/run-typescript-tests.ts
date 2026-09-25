import { lstatSync, opendirSync, readFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import { spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Wakeflow Tooling / Testing：由当前 `.test.ts` 源清单启动编译后测试。
 *
 * TypeScript 增量构建不会自动删除源文件移除后遗留的 `.build/tests/*.js`，因此测试门
 * 不能使用 glob 枚举编译目录。本入口只枚举当前测试源文件、映射对应的编译输出、
 * 复验普通文件并把清单交给 Node.js 测试运行器。无参数模式运行全部当前源；显式
 * `--focused` 模式只接受调用方列出的当前 `.test.ts` 源文件。旧输出不会被误执行，
 * 不存在、越界、重复或非测试路径也不能制造虚假的测试覆盖。
 *
 * 清单顺序只影响排程，不影响任何一个测试的行为：Node 每个文件一个进程，先派发的
 * 文件先开始。按已知耗时降序派发（LPT）让最长的文件最早开始，整套墙钟由“最长文件”
 * 而不是“最后才开始的长文件”决定。耗时表是 `tooling/testing/test-durations.json`，
 * 只是排程提示：表缺席时全部文件视为未知、退回与旧版一致的路径升序；表存在但内容
 * 非法（绝对路径、越界路径、非法毫秒）时立即失败，避免错表悄悄削掉排程收益。
 */

const MAXIMUM_TEST_FILES = 512;

function fail(message: string): never {
  throw new Error(`Wakeflow TypeScript test runner failed: ${message}`);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertRealDirectoryChain(root: string, directory: string, message: string): void {
  const relative = nodePath.relative(root, directory);
  if (
    relative === ".." ||
    relative.startsWith(`..${nodePath.sep}`) ||
    nodePath.isAbsolute(relative)
  ) {
    fail(message);
  }
  let current = root;
  for (const segment of ["", ...relative.split(nodePath.sep).filter(Boolean)]) {
    if (segment.length > 0) current = nodePath.join(current, segment);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat === undefined || stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(message);
    }
  }
}

function collectTestSources(root: string): readonly string[] {
  assertRealDirectoryChain(root, root, "tests root must be one real directory");
  const result: string[] = [];
  function visit(directory: string): void {
    const handle = opendirSync(directory);
    const entries: Dirent[] = [];
    try {
      while (true) {
        const entry = handle.readSync();
        if (entry === null) break;
        entries.push(entry);
      }
    } finally {
      handle.closeSync();
    }
    entries.sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const entry of entries) {
      const absolute = nodePath.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail("tests source cannot contain symlinks");
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
        result.push(absolute);
        if (result.length > MAXIMUM_TEST_FILES) {
          fail(`test file count exceeds ${MAXIMUM_TEST_FILES}`);
        }
      }
    }
  }
  visit(root);
  if (result.length === 0) fail("no .test.ts source files were found");
  return Object.freeze(result);
}

function assertCurrentTestSource(sourceRoot: string, value: string): string {
  const source = nodePath.resolve(value);
  const relative = nodePath.relative(sourceRoot, source);
  if (
    relative.length === 0 ||
    relative === ".." ||
    relative.startsWith(`..${nodePath.sep}`) ||
    nodePath.isAbsolute(relative) ||
    !relative.endsWith(".test.ts")
  ) {
    fail("focused test source must be one .test.ts file below tests/");
  }
  assertRealDirectoryChain(
    sourceRoot,
    nodePath.dirname(source),
    "focused test source parent chain must contain only real directories",
  );
  const stat = lstatSync(source, { throwIfNoEntry: false });
  if (stat === undefined || stat.isSymbolicLink() || !stat.isFile()) {
    fail("focused test source must be one current regular file");
  }
  return source;
}

function selectedTestSources(
  repositoryRoot: string,
  focusedValues?: readonly string[],
): readonly string[] {
  const sourceRoot = nodePath.join(repositoryRoot, "tests");
  if (focusedValues === undefined) return collectTestSources(sourceRoot);
  if (focusedValues.length === 0) {
    fail("focused mode requires at least one test source");
  }
  const seen = new Set<string>();
  const sources = focusedValues.map((value) => {
    const source = assertCurrentTestSource(sourceRoot, nodePath.resolve(repositoryRoot, value));
    if (seen.has(source)) fail("focused test sources cannot contain duplicates");
    seen.add(source);
    return source;
  });
  // Final order is decided only by orderTestSourcesByCost in compiledTypeScriptTests.
  return Object.freeze(sources);
}

export const TEST_DURATION_TABLE_PATH = "tooling/testing/test-durations.json";

/**
 * 排程用的纯函数：未知耗时的文件排在最前，其余按耗时降序，同耗时按仓库相对路径升序。
 *
 * 未知文件放前而不是放后，是因为“未知”通常意味着刚加进来、还没有被任何一次全量门测量过；
 * 把它放在队尾，一旦它其实很长，它就会在所有工作线程都快收工时才开始，直接变成新的尾巴。
 * 放在队首最坏只是让一个短文件早开始几秒。耗时表整体缺席时全部文件都未知，顺序退回路径
 * 升序，也就是本次改动之前的顺序。
 */
export function orderTestSourcesByCost(
  relativePaths: readonly string[],
  durations: ReadonlyMap<string, number>,
): readonly string[] {
  return Object.freeze(
    [...relativePaths].sort((left, right) => {
      const leftCost = durations.get(left);
      const rightCost = durations.get(right);
      if (leftCost === undefined || rightCost === undefined) {
        if (leftCost === rightCost) return compareCodeUnits(left, right);
        return leftCost === undefined ? -1 : 1;
      }
      if (leftCost !== rightCost) return rightCost - leftCost;
      return compareCodeUnits(left, right);
    }),
  );
}

function assertDurationEntry(key: string, value: unknown): number {
  if (
    key.length === 0 ||
    !key.startsWith("tests/") ||
    !key.endsWith(".test.ts") ||
    key.includes("\\") ||
    key.includes("//") ||
    key.split("/").includes("..")
  ) {
    fail(`test duration table key must be one repository-relative tests/ path: ${key}`);
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(`test duration table value must be a non-negative integer millisecond count: ${key}`);
  }
  return value;
}

/** 读取签入的耗时表；缺席即“全部未知”，存在但非法则立即失败。 */
export function loadTestDurations(repositoryRoot: string): ReadonlyMap<string, number> {
  const tablePath = nodePath.join(repositoryRoot, ...TEST_DURATION_TABLE_PATH.split("/"));
  const stat = lstatSync(tablePath, { throwIfNoEntry: false });
  if (stat === undefined) return new Map();
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail("test duration table must be one regular file");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(tablePath, "utf8"));
  } catch {
    fail("test duration table is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    fail("test duration table must be one JSON object");
  }
  const table = (parsed as { readonly durationsMs?: unknown }).durationsMs;
  if (typeof table !== "object" || table === null || Array.isArray(table)) {
    fail("test duration table must carry one durationsMs object");
  }
  const durations = new Map<string, number>();
  for (const [key, value] of Object.entries(table)) {
    durations.set(key, assertDurationEntry(key, value));
  }
  return durations;
}

function compiledOutputFor(outputRoot: string, sourceRoot: string, source: string): string {
  const relative = nodePath.relative(sourceRoot, source);
  if (
    relative.length === 0 ||
    relative === ".." ||
    relative.startsWith(`..${nodePath.sep}`) ||
    nodePath.isAbsolute(relative)
  ) {
    fail("test source escaped the tests root");
  }
  const output = nodePath.join(outputRoot, relative.replace(/\.ts$/u, ".js"));
  assertRealDirectoryChain(
    outputRoot,
    nodePath.dirname(output),
    "compiled test parent chain must contain only real directories",
  );
  const stat = lstatSync(output, { throwIfNoEntry: false });
  if (stat === undefined || stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
    fail("a current test source has no regular compiled output");
  }
  return output;
}

/** 把当前源清单映射为已经存在的编译输出，不枚举 `.build/tests`，并按已知耗时降序派发。 */
export function compiledTypeScriptTests(
  repositoryRootInput: string,
  focusedValues?: readonly string[],
): readonly string[] {
  const repositoryRoot = nodePath.resolve(repositoryRootInput);
  const sourceRoot = nodePath.join(repositoryRoot, "tests");
  const outputRoot = nodePath.join(repositoryRoot, ".build", "tests");
  const outputs = new Map<string, string>();
  for (const source of selectedTestSources(repositoryRoot, focusedValues)) {
    const key = `tests/${nodePath.relative(sourceRoot, source).split(nodePath.sep).join("/")}`;
    outputs.set(key, compiledOutputFor(outputRoot, sourceRoot, source));
  }
  const durations = loadTestDurations(repositoryRoot);
  return Object.freeze(
    orderTestSourcesByCost([...outputs.keys()], durations).map((key) => {
      const output = outputs.get(key);
      if (output === undefined) fail("scheduling dropped one selected test source");
      return output;
    }),
  );
}

function parseInvocation(values: readonly string[]): readonly string[] | undefined {
  if (values.length === 0) return undefined;
  if (values[0] !== "--focused") {
    fail("the only supported runner option is --focused");
  }
  return values.slice(1);
}

/**
 * 显式并发度：每个逻辑核一个工作进程。
 *
 * Node 的默认值是 `availableParallelism() - 1`，给交互式使用留出一核；测试门是批处理，
 * 那一核没有理由空着。再往上超订没有收益：这套测试的时间几乎全花在 fsync、rename 和
 * spawn 出去的子进程上，瓶颈是同一块盘而不是核，进程越多只会把单个文件拖得越慢。
 * 显式写出来还有一个好处：Node 以后改默认值，也不会悄悄改变这里的排程前提。
 */
function testConcurrency(): number {
  return Math.max(1, availableParallelism());
}

function run(): void {
  const repositoryRoot = process.cwd();
  const files = compiledTypeScriptTests(repositoryRoot, parseInvocation(process.argv.slice(2)));
  const options = ["--test", `--test-concurrency=${testConcurrency()}`];
  const result = spawnSync(process.execPath, [...options, ...files], {
    cwd: repositoryRoot,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });
  if (result.error !== undefined) fail("Node test runner could not start");
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

function isMainModule(): boolean {
  const invoked = process.argv[1];
  return invoked !== undefined && nodePath.resolve(invoked) === fileURLToPath(import.meta.url);
}

if (isMainModule()) run();
