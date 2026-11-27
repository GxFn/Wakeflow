import { Buffer } from "node:buffer";

import { type Fail, failWith, ModuleError } from "../error/module-error.js";
import type { PortableResourcePath } from "../filesystem/portable-resource-path.js";
import { type RootedDirectory, RootedDirectoryError } from "../filesystem/rooted-directory.js";
import { decodeUtf8, Utf8Error } from "../text/utf8.js";
import { throwIfAborted } from "../node/abort-signal.js";
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
  | "protocol";

/** Git ignore 观察失败的稳定、脱敏错误。 */
export class GitIgnoreObservationError extends ModuleError<GitIgnoreObservationErrorReason> {
  static override readonly code = "wakeflow-git-ignore-observation";
}

interface GitCheckIgnoreResult {
  readonly exitCode: 0 | 1;
  readonly stdout: Buffer;
}

const fail: Fail<GitIgnoreObservationErrorReason> = failWith(GitIgnoreObservationError);

/**
 * 路径条数与送进 Git 标准输入的总字节数有上限（容量，不是类型检查）；路径本身是类型化的资源路径，
 * 不再逐个复验。
 */
function assertProbeCapacity(probePaths: readonly PortableResourcePath[]): void {
  if (probePaths.length > GIT_IGNORE_OBSERVATION_LIMITS.maximumProbePaths) {
    fail("input", "$probePaths");
  }
  let inputBytes = 0;
  for (const path of probePaths) {
    inputBytes += Buffer.byteLength(path, "utf8") + 1;
    if (inputBytes > GIT_IGNORE_OBSERVATION_LIMITS.maximumInputBytes) {
      fail("input", "$probePaths");
    }
  }
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
  probePaths: readonly PortableResourcePath[],
  options: GitIgnoreObservationOptions = {},
): Promise<Readonly<GitIgnoreObservation>> {
  return observeGitIgnorePathsInWorkTreeInternal(
    rootValue,
    rootValue,
    probePaths,
    options,
    "$root",
    "$root",
  );
}

async function observeGitIgnorePathsInWorkTreeInternal(
  repositoryRootValue: RootedDirectory,
  workTreeRootValue: RootedDirectory,
  probePaths: readonly PortableResourcePath[],
  options: GitIgnoreObservationOptions,
  repositoryRootPath: string,
  workTreeRootPath: string,
): Promise<Readonly<GitIgnoreObservation>> {
  throwIfAborted(options.signal);
  assertProbeCapacity(probePaths);
  await assertRootCurrent(repositoryRootValue, repositoryRootPath);
  if (workTreeRootValue !== repositoryRootValue) {
    await assertRootCurrent(workTreeRootValue, workTreeRootPath);
  }
  throwIfAborted(options.signal);
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
  throwIfAborted(options.signal);
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
  probePaths: readonly PortableResourcePath[],
  options: GitIgnoreObservationOptions = {},
): Promise<Readonly<GitIgnoreObservation>> {
  return observeGitIgnorePathsInWorkTreeInternal(
    repositoryRootValue,
    workTreeRootValue,
    probePaths,
    options,
    "$repositoryRoot",
    "$workTreeRoot",
  );
}
