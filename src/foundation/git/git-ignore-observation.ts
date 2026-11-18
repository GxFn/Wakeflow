import { Buffer } from "node:buffer";
import { types } from "node:util";

import {
  PassiveOwnDataError,
  parseDenseArray,
  parsePlainRecord,
} from "../data/passive-own-data.js";
import {
  type PortableResourcePath,
  PortableResourcePathError,
  parsePortableResourcePath,
} from "../filesystem/portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError } from "../filesystem/rooted-directory.js";
import { decodeUtf8, Utf8Error } from "../text/utf8.js";
import { isAbortSignal } from "../node/abort-signal.js";
import { GitReadOnlyProcessError, runGitReadOnly } from "./git-read-only-process.js";

/**
 * Wakeflow Foundation / Git：根作用域 Git ignore 语义观察。
 *
 * 本模块把一组 `PortableResourcePath` 交给 Git 自身的 `check-ignore` 机器协议，
 * 返回最终命中模式及 Git 判定。它限制路径数量与输入；固定的只读参数、清除 `GIT_*`
 * 环境变量、输出与执行时间的上限在共享的 `git-read-only-process.ts` 里（ADR-0028：
 * 提交观察成为第二个进程协议消费者之后提取的封闭 runner，不接受任意 argv）。
 *
 * 本能力不解释哪个 ignore 来源属于业务权威，也不生成 Wakeflow 规则、读取 managed
 * envelope、修改 `.gitignore` 或执行任意 Git 命令。
 */

const GIT_IGNORE_OBSERVATION_LIMITS = Object.freeze({
  maximumProbePaths: 512,
  maximumInputBytes: 256 * 1024,
} as const);

/** Git 为一个路径选出的最终 ignore 模式；negated 表示该模式把路径重新纳入。 */
interface GitIgnorePatternDecision {
  /** Git 原始来源；可能是本机绝对路径，只供当前进程判断，不得进入可移植记录。 */
  readonly source: string;
  readonly lineNumber: number;
  readonly pattern: string;
  readonly negated: boolean;
}

/** 一个输入路径的 Git ignore 观察；没有命中模式时 decision 为 null。 */
export interface GitIgnorePathObservation {
  readonly path: PortableResourcePath;
  readonly ignored: boolean;
  readonly decision: Readonly<GitIgnorePatternDecision> | null;
}

/** 与一次批量 Git 调用绑定、保持输入顺序的冻结观察。 */
interface GitIgnoreObservation {
  readonly paths: readonly Readonly<GitIgnorePathObservation>[];
}

export interface GitIgnoreObservationOptions {
  readonly signal?: AbortSignal;
}

export type GitIgnoreObservationErrorReason =
  | "input"
  | "root-scope"
  | "git-unavailable"
  | "query-failure"
  | "timeout"
  | "output-limit"
  | "protocol"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Git ignore observation input is invalid.",
  "root-scope": "Git ignore observation could not establish its rooted scope.",
  "git-unavailable": "Git ignore observation could not start Git.",
  "query-failure": "Git ignore observation query failed.",
  timeout: "Git ignore observation exceeded its execution deadline.",
  "output-limit": "Git ignore observation exceeded its output budget.",
  protocol: "Git ignore observation returned an invalid machine record.",
  aborted: "Git ignore observation was aborted.",
} as const satisfies Readonly<Record<GitIgnoreObservationErrorReason, string>>;

/** Git ignore 观察失败的稳定、脱敏错误。 */
export class GitIgnoreObservationError extends Error {
  override readonly name = "GitIgnoreObservationError";
  readonly code = "wakeflow-git-ignore-observation" as const;
  readonly reason: GitIgnoreObservationErrorReason;
  readonly path: string;

  constructor(reason: GitIgnoreObservationErrorReason, path: string, options?: ErrorOptions) {
    super(ERROR_MESSAGES[reason], options);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedGitIgnoreObservationOptions {
  readonly signal: AbortSignal | undefined;
}

interface GitCheckIgnoreResult {
  readonly exitCode: 0 | 1;
  readonly stdout: Buffer;
}

function fail(reason: GitIgnoreObservationErrorReason, path: string, cause?: unknown): never {
  throw new GitIgnoreObservationError(reason, path, cause === undefined ? undefined : { cause });
}

function assertRoot(value: unknown, path: string): asserts value is RootedDirectory {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    !(value instanceof RootedDirectory)
  ) {
    fail("input", path);
  }
}

function parseOptions(value: unknown): Readonly<ParsedGitIgnoreObservationOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options", error);
    throw error;
  }
  const keys = Object.keys(record);
  if (
    keys.some((key) => key !== "signal") ||
    (record.signal !== undefined && !isAbortSignal(record.signal))
  ) {
    fail("input", "$options");
  }
  return Object.freeze({
    signal: record.signal as AbortSignal | undefined,
  });
}

function parseProbePaths(value: unknown): readonly PortableResourcePath[] {
  let members: readonly unknown[];
  try {
    members = parseDenseArray(
      value,
      GIT_IGNORE_OBSERVATION_LIMITS.maximumProbePaths,
      "$probePaths",
    );
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$probePaths", error);
    throw error;
  }
  if (members.length === 0) fail("input", "$probePaths");

  const seen = new Set<string>();
  const paths: PortableResourcePath[] = [];
  let inputBytes = 0;
  for (const [index, member] of members.entries()) {
    let path: PortableResourcePath;
    try {
      path = parsePortableResourcePath(member, `$probePaths/${index}`);
    } catch (error: unknown) {
      if (error instanceof PortableResourcePathError) {
        fail("input", `$probePaths/${index}`, error);
      }
      throw error;
    }
    if (seen.has(path)) fail("input", `$probePaths/${index}`);
    seen.add(path);
    inputBytes += Buffer.byteLength(path, "utf8") + 1;
    if (inputBytes > GIT_IGNORE_OBSERVATION_LIMITS.maximumInputBytes) {
      fail("input", "$probePaths");
    }
    paths.push(path);
  }
  return Object.freeze(paths);
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$options.signal");
}

async function assertRootCurrent(root: RootedDirectory, path: string): Promise<void> {
  try {
    await root.assertCurrent(path);
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root-scope", path, error);
    throw error;
  }
}

async function runGitCheckIgnore(
  repositoryRoot: RootedDirectory,
  workTreeRoot: RootedDirectory,
  probePaths: readonly PortableResourcePath[],
  signal: AbortSignal | undefined,
): Promise<Readonly<GitCheckIgnoreResult>> {
  let input: Buffer;
  try {
    input = Buffer.from(`${probePaths.join("\u0000")}\u0000`, "utf8");
  } catch {
    throw new GitIgnoreObservationError("query-failure", "$git");
  }
  try {
    const result = await runGitReadOnly(
      {
        kind: "check-ignore",
        repositoryRoot: repositoryRoot.absolutePath,
        workTreeRoot: workTreeRoot.absolutePath,
        input,
      },
      signal,
    );
    if (result.stdout === null) fail("output-limit", "$git.stdout");
    return Object.freeze({ exitCode: result.exitCode === 0 ? 0 : 1, stdout: result.stdout });
  } catch (error: unknown) {
    if (error instanceof GitReadOnlyProcessError) fail(error.reason, error.path, error);
    throw error;
  }
}

function parseOutput(
  result: Readonly<GitCheckIgnoreResult>,
  probePaths: readonly PortableResourcePath[],
): Readonly<GitIgnoreObservation> {
  let output: string;
  try {
    output = decodeUtf8(result.stdout, "$git.stdout");
  } catch (error: unknown) {
    if (error instanceof Utf8Error) fail("protocol", "$git.stdout", error);
    throw error;
  }
  const fields = output.split("\u0000");
  if (fields.length !== probePaths.length * 4 + 1 || fields.at(-1) !== "") {
    fail("protocol", "$git.stdout");
  }

  const paths: GitIgnorePathObservation[] = [];
  for (const [index, expectedPath] of probePaths.entries()) {
    const offset = index * 4;
    const source = fields[offset];
    const line = fields[offset + 1];
    const pattern = fields[offset + 2];
    const pathname = fields[offset + 3];
    if (
      source === undefined ||
      line === undefined ||
      pattern === undefined ||
      pathname !== expectedPath
    ) {
      fail("protocol", "$git.stdout");
    }
    if (source === "" && line === "" && pattern === "") {
      paths.push(
        Object.freeze({
          path: expectedPath,
          ignored: false,
          decision: null,
        }),
      );
      continue;
    }
    if (source.length === 0 || pattern.length === 0 || !/^[1-9][0-9]*$/u.test(line)) {
      fail("protocol", "$git.stdout");
    }
    const lineNumber = Number(line);
    if (!Number.isSafeInteger(lineNumber)) fail("protocol", "$git.stdout");
    const negated = pattern.startsWith("!");
    paths.push(
      Object.freeze({
        path: expectedPath,
        ignored: !negated,
        decision: Object.freeze({
          source,
          lineNumber,
          pattern,
          negated,
        }),
      }),
    );
  }
  // `--verbose` 下 Git 把否定的最后匹配模式也计为匹配并以 0 退出。
  const anyMatched = paths.some((entry) => entry.decision !== null);
  if ((result.exitCode === 0) !== anyMatched) {
    fail("protocol", "$git.stdout");
  }
  return Object.freeze({
    paths: Object.freeze(paths),
  });
}

/**
 * 以一次批量、只读 Git 调用观察全部路径，并返回与输入顺序一一对应的最终模式判定。
 */
export async function observeGitIgnorePaths(
  rootValue: RootedDirectory,
  probePathValues: readonly PortableResourcePath[],
  optionsValue?: GitIgnoreObservationOptions,
): Promise<Readonly<GitIgnoreObservation>> {
  return observeGitIgnorePathsInWorkTreeInternal(
    rootValue,
    rootValue,
    probePathValues,
    optionsValue,
    "$root",
    "$root",
  );
}

async function observeGitIgnorePathsInWorkTreeInternal(
  repositoryRootValue: RootedDirectory,
  workTreeRootValue: RootedDirectory,
  probePathValues: readonly PortableResourcePath[],
  optionsValue: GitIgnoreObservationOptions | undefined,
  repositoryRootPath: string,
  workTreeRootPath: string,
): Promise<Readonly<GitIgnoreObservation>> {
  assertRoot(repositoryRootValue, repositoryRootPath);
  assertRoot(workTreeRootValue, workTreeRootPath);
  const options = parseOptions(optionsValue);
  assertNotAborted(options.signal);
  const probePaths = parseProbePaths(probePathValues);
  await assertRootCurrent(repositoryRootValue, repositoryRootPath);
  if (workTreeRootValue !== repositoryRootValue) {
    await assertRootCurrent(workTreeRootValue, workTreeRootPath);
  }
  assertNotAborted(options.signal);
  const result = await runGitCheckIgnore(
    repositoryRootValue,
    workTreeRootValue,
    probePaths,
    options.signal,
  );
  await assertRootCurrent(repositoryRootValue, repositoryRootPath);
  if (workTreeRootValue !== repositoryRootValue) {
    await assertRootCurrent(workTreeRootValue, workTreeRootPath);
  }
  assertNotAborted(options.signal);
  return parseOutput(result, probePaths);
}

/**
 * 使用 repositoryRoot 发现 Git 元数据，但在独立 workTreeRoot 中解释 ignore 文件。
 *
 * 该入口仍只执行 `check-ignore --no-index`。它用于验证尚未发布的 worktree 候选，
 * 不会把 workTreeRoot 注册为 Git worktree，也不读取或修改 index。
 */
export async function observeGitIgnorePathsInWorkTree(
  repositoryRootValue: RootedDirectory,
  workTreeRootValue: RootedDirectory,
  probePathValues: readonly PortableResourcePath[],
  optionsValue?: GitIgnoreObservationOptions,
): Promise<Readonly<GitIgnoreObservation>> {
  return observeGitIgnorePathsInWorkTreeInternal(
    repositoryRootValue,
    workTreeRootValue,
    probePathValues,
    optionsValue,
    "$repositoryRoot",
    "$workTreeRoot",
  );
}
