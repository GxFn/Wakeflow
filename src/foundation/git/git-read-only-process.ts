import { spawn } from "node:child_process";
import { createHash, type Hash } from "node:crypto";
import path from "node:path";

import { OperationAbortedError } from "../node/abort-signal.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";

/**
 * Wakeflow Foundation / Git：封闭的只读 Git 进程 runner（ADR-0028）。
 *
 * `foundation/git` 下的具体观察能力（ignore 判定、提交观察）共用这一个进程协议。调用方只能
 * 从下面的查询种类里选一种并给出数据成员；参数数组由本模块按种类写死，没有接收任意 argv 的入口，
 * 所以它不是通用的 Git 客户端。
 *
 * 每次启动都：只继承非 `GIT_*` 的环境并关掉系统与全局配置、交互提示与可选锁，并且不向给定的根之上
 * 寻找仓库；在命令行上关闭仓库
 * 配置里可执行的两处——文件系统监视器与钩子目录（实测 `diff-tree` 会执行 `core.fsmonitor` 指向的
 * 程序）；涉及 diff 的查询再关闭外部 diff 驱动与 textconv。不联网、不写仓库。输出有硬上限与保留
 * 上限：超过保留上限时不再保留正文，但字节数与 SHA-256 仍然完整；超过硬上限即失败。
 *
 * 失败只给稳定分类，不暴露 Git 的标准错误、平台错误消息或路径。
 */

export type GitReadOnlyFailureReason =
  | "git-unavailable"
  | "query-failure"
  | "timeout"
  | "output-limit";

/** 进程结局的失败分类：中止另抛 `OperationAbortedError`。 */
type RunFailure = GitReadOnlyFailureReason | "aborted";

const ERROR_MESSAGES = {
  "git-unavailable": "The read-only Git query could not start Git.",
  "query-failure": "The read-only Git query failed.",
  timeout: "The read-only Git query exceeded its execution deadline.",
  "output-limit": "The read-only Git query exceeded its output budget.",
} as const satisfies Readonly<Record<GitReadOnlyFailureReason, string>>;

const FAILURE_PATHS = {
  "git-unavailable": "$git",
  "query-failure": "$git",
  timeout: "$git",
  "output-limit": "$git.stdout",
} as const satisfies Readonly<Record<GitReadOnlyFailureReason, string>>;

/** 只读 Git 查询失败的稳定、脱敏错误。 */
export class GitReadOnlyProcessError extends Error {
  override readonly name = "GitReadOnlyProcessError";
  readonly code = "wakeflow-git-read-only-process" as const;
  readonly reason: GitReadOnlyFailureReason;
  readonly path: string;

  constructor(reason: GitReadOnlyFailureReason) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = FAILURE_PATHS[reason];
  }
}

/** 封闭的查询种类；每一种的参数数组都写在本模块里。 */
export type GitReadOnlyQuery =
  | Readonly<{
      kind: "check-ignore";
      repositoryRoot: string;
      workTreeRoot: string;
      input: Buffer;
    }>
  | Readonly<{ kind: "commit-object"; repositoryRoot: string; commitOid: string }>
  | Readonly<{
      kind: "changed-paths";
      repositoryRoot: string;
      baseOid: string | null;
      commitOid: string;
    }>
  | Readonly<{
      kind: "patch";
      repositoryRoot: string;
      baseOid: string | null;
      commitOid: string;
    }>
  | Readonly<{
      kind: "is-ancestor";
      repositoryRoot: string;
      ancestorOid: string;
      descendantOid: string;
    }>;

export interface GitReadOnlyResult {
  readonly exitCode: number;
  /** 保留下来的标准输出；超过该查询的保留上限时为 null。 */
  readonly stdout: Buffer | null;
  readonly outputBytes: number;
  readonly outputSha256Hex: string;
}

interface QuerySpec {
  readonly arguments: readonly string[];
  readonly input: Buffer | null;
  readonly acceptedExitCodes: readonly number[];
  readonly maximumOutputBytes: number;
  readonly retainOutputBytes: number;
  readonly maximumOutputChunks: number;
  readonly timeoutMilliseconds: number;
}

const KIBIBYTE = 1024;
const MEBIBYTE = 1024 * KIBIBYTE;
const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/** 补丁正文随证据保存的上限；超过时只留摘要与字节数（ADR-0028 决定 5）。 */
export const GIT_PATCH_RETAINED_BYTES_MAXIMUM = MEBIBYTE;

function nullDevicePath(): string {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}

function objectId(value: string): string {
  if (!OBJECT_ID_PATTERN.test(value)) throw new GitReadOnlyProcessError("query-failure");
  return value;
}

function commonArguments(repositoryRoot: string, workTreeRoot: string | null): readonly string[] {
  return [
    "-C",
    repositoryRoot,
    ...(workTreeRoot === null ? [] : [`--work-tree=${workTreeRoot}`]),
    "--no-pager",
    "--no-optional-locks",
    "-c",
    "core.fsmonitor=false",
    "-c",
    `core.hooksPath=${nullDevicePath()}`,
  ];
}

/** 相对 base 的两棵树比较；没有 base（根提交）时用 `--root` 的单提交形式。 */
function treeComparison(baseOid: string | null, commitOid: string): readonly string[] {
  return baseOid === null
    ? ["--root", "--no-commit-id", objectId(commitOid)]
    : [objectId(baseOid), objectId(commitOid)];
}

const DIFF_GUARDS = Object.freeze(["--no-ext-diff", "--no-textconv", "--no-renames"]);

function checkIgnoreSpec(
  query: Extract<GitReadOnlyQuery, { kind: "check-ignore" }>,
): Readonly<QuerySpec> {
  return {
    arguments: [
      ...commonArguments(query.repositoryRoot, query.workTreeRoot),
      "-c",
      `core.excludesFile=${nullDevicePath()}`,
      "-c",
      `core.worktree=${query.workTreeRoot}`,
      "-c",
      "core.bare=false",
      "check-ignore",
      "--no-index",
      "--verbose",
      "--non-matching",
      "--stdin",
      "-z",
    ],
    input: query.input,
    acceptedExitCodes: [0, 1],
    maximumOutputBytes: MEBIBYTE,
    retainOutputBytes: MEBIBYTE,
    maximumOutputChunks: 2048,
    timeoutMilliseconds: 5_000,
  };
}

function commitObjectSpec(
  query: Extract<GitReadOnlyQuery, { kind: "commit-object" }>,
): Readonly<QuerySpec> {
  return {
    arguments: [...commonArguments(query.repositoryRoot, null), "cat-file", "--batch"],
    input: Buffer.from(`${objectId(query.commitOid)}\n`, "utf8"),
    acceptedExitCodes: [0],
    maximumOutputBytes: 256 * KIBIBYTE,
    retainOutputBytes: 256 * KIBIBYTE,
    maximumOutputChunks: 2048,
    timeoutMilliseconds: 5_000,
  };
}

function changedPathsSpec(
  query: Extract<GitReadOnlyQuery, { kind: "changed-paths" }>,
): Readonly<QuerySpec> {
  return {
    arguments: [
      ...commonArguments(query.repositoryRoot, null),
      "diff-tree",
      "-r",
      "-z",
      "--name-status",
      ...DIFF_GUARDS,
      ...treeComparison(query.baseOid, query.commitOid),
    ],
    input: null,
    acceptedExitCodes: [0],
    maximumOutputBytes: 4 * MEBIBYTE,
    retainOutputBytes: 4 * MEBIBYTE,
    maximumOutputChunks: 8192,
    timeoutMilliseconds: 10_000,
  };
}

function patchSpec(query: Extract<GitReadOnlyQuery, { kind: "patch" }>): Readonly<QuerySpec> {
  return {
    arguments: [
      ...commonArguments(query.repositoryRoot, null),
      "diff-tree",
      "-p",
      ...DIFF_GUARDS,
      "--no-color",
      "--full-index",
      "--unified=3",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      ...treeComparison(query.baseOid, query.commitOid),
    ],
    input: null,
    acceptedExitCodes: [0],
    maximumOutputBytes: 64 * MEBIBYTE,
    retainOutputBytes: GIT_PATCH_RETAINED_BYTES_MAXIMUM,
    maximumOutputChunks: 65_536,
    timeoutMilliseconds: 20_000,
  };
}

function isAncestorSpec(
  query: Extract<GitReadOnlyQuery, { kind: "is-ancestor" }>,
): Readonly<QuerySpec> {
  return {
    arguments: [
      ...commonArguments(query.repositoryRoot, null),
      "merge-base",
      "--is-ancestor",
      objectId(query.ancestorOid),
      objectId(query.descendantOid),
    ],
    input: null,
    acceptedExitCodes: [0, 1],
    maximumOutputBytes: 4 * KIBIBYTE,
    retainOutputBytes: 4 * KIBIBYTE,
    maximumOutputChunks: 16,
    timeoutMilliseconds: 5_000,
  };
}

function specOf(query: GitReadOnlyQuery): Readonly<QuerySpec> {
  switch (query.kind) {
    case "check-ignore":
      return checkIgnoreSpec(query);
    case "commit-object":
      return commitObjectSpec(query);
    case "changed-paths":
      return changedPathsSpec(query);
    case "patch":
      return patchSpec(query);
    case "is-ancestor":
      return isAncestorSpec(query);
  }
}

/**
 * Git 可以通过环境变量重定向 repository、worktree、配置和标准流。只继承非 Git 环境，并显式关闭
 * 系统与全局配置、交互提示和可选锁，使只读观察保持可预测。
 */
function gitObservationEnvironment(repositoryRoot: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = Object.create(null) as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.toUpperCase().startsWith("GIT_")) {
      environment[key] = value;
    }
  }
  const nullDevice = nullDevicePath();
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = nullDevice;
  environment.GIT_CONFIG_SYSTEM = nullDevice;
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_TERMINAL_PROMPT = "0";
  // 不向上找：给定的根自己不是仓库时就是"不是仓库"，不拿包着它的那个仓库来回答。
  environment.GIT_CEILING_DIRECTORIES = path.dirname(repositoryRoot);
  return Object.freeze(environment);
}

/** 一次查询的输出累计：字节数与摘要始终完整，正文只保留到保留上限。 */
class OutputAccumulator {
  readonly hash: Hash = createHash("sha256");
  byteCount = 0;
  chunkCount = 0;
  retained: Buffer[] | null = [];

  /** 返回 false 表示超过硬上限。 */
  accept(chunk: Buffer, spec: Readonly<QuerySpec>): boolean {
    this.byteCount += chunk.byteLength;
    this.chunkCount += 1;
    if (this.byteCount > spec.maximumOutputBytes || this.chunkCount > spec.maximumOutputChunks) {
      return false;
    }
    this.hash.update(chunk);
    if (this.retained !== null) {
      if (this.byteCount > spec.retainOutputBytes) this.retained = null;
      else this.retained.push(chunk);
    }
    return true;
  }

  result(exitCode: number): Readonly<GitReadOnlyResult> {
    return Object.freeze({
      exitCode,
      stdout: this.retained === null ? null : Buffer.concat(this.retained, this.byteCount),
      outputBytes: this.byteCount,
      outputSha256Hex: this.hash.digest("hex"),
    });
  }
}

interface RunState {
  settled: boolean;
  aborted: boolean;
  timedOut: boolean;
  outputExceeded: boolean;
}

/** 进程结束或出错时的失败分类；没有失败返回 null。 */
function failureOf(state: Readonly<RunState>): RunFailure | null {
  if (state.aborted) return "aborted";
  if (state.timedOut) return "timeout";
  if (state.outputExceeded) return "output-limit";
  return null;
}

function spawnFailure(state: Readonly<RunState>, error: Error): RunFailure {
  return (
    failureOf(state) ??
    (readNodeSystemErrorCode(error) === "ENOENT" ? "git-unavailable" : "query-failure")
  );
}

function closeOutcome(
  state: Readonly<RunState>,
  spec: Readonly<QuerySpec>,
  output: OutputAccumulator,
  code: number | null,
): Readonly<GitReadOnlyResult> | RunFailure {
  const failure = failureOf(state);
  if (failure !== null) return failure;
  if (code === null || !spec.acceptedExitCodes.includes(code)) return "query-failure";
  try {
    return output.result(code);
  } catch {
    return "output-limit";
  }
}

function runProcess(
  repositoryRoot: string,
  spec: Readonly<QuerySpec>,
  signal: AbortSignal | undefined,
): Promise<Readonly<GitReadOnlyResult>> {
  return new Promise((resolve, reject) => {
    const state: RunState = {
      settled: false,
      aborted: false,
      timedOut: false,
      outputExceeded: false,
    };
    const output = new OutputAccumulator();
    const child = spawn("git", spec.arguments, {
      cwd: repositoryRoot,
      env: gitObservationEnvironment(repositoryRoot),
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    const terminate = () => {
      try {
        child.kill("SIGKILL");
      } catch {
        // 最终失败分类由 error/close 事件给出，不暴露平台 kill 细节。
      }
    };
    const onAbort = () => {
      state.aborted = true;
      terminate();
    };
    const timer = setTimeout(() => {
      state.timedOut = true;
      terminate();
    }, spec.timeoutMilliseconds);
    const finish = (outcome: Readonly<GitReadOnlyResult> | RunFailure) => {
      if (state.settled) return;
      state.settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (outcome === "aborted") reject(new OperationAbortedError());
      else if (typeof outcome === "string") reject(new GitReadOnlyProcessError(outcome));
      else resolve(outcome);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      if (state.outputExceeded || output.accept(chunk, spec)) return;
      state.outputExceeded = true;
      terminate();
    });
    child.stdout.once("error", () => {
      terminate();
      finish(state.outputExceeded ? "output-limit" : "query-failure");
    });
    child.stdin.on("error", () => {
      // Git 可能在读取全部输入前退出；最终分类统一由 error/close 事件完成。
    });
    child.once("error", (error: Error) => finish(spawnFailure(state, error)));
    child.once("close", (code) => finish(closeOutcome(state, spec, output, code)));

    if (signal !== undefined) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    try {
      child.stdin.end(spec.input ?? Buffer.alloc(0));
    } catch {
      terminate();
      finish("query-failure");
    }
  });
}

/** 执行一个封闭的只读查询。调用方负责先确认 `repositoryRoot` 是它有权读取的根。 */
export function runGitReadOnly(
  query: GitReadOnlyQuery,
  signal?: AbortSignal,
): Promise<Readonly<GitReadOnlyResult>> {
  let spec: Readonly<QuerySpec>;
  try {
    spec = specOf(query);
  } catch (error: unknown) {
    return Promise.reject(error);
  }
  return runProcess(query.repositoryRoot, spec, signal);
}
