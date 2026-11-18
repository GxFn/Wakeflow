import { types } from "node:util";

import { parseSha256Digest, SHA256_DIGEST_PREFIX, type Sha256Digest } from "../crypto/sha256.js";
import { PassiveOwnDataError, parsePlainRecord } from "../data/passive-own-data.js";
import { RootedDirectory, RootedDirectoryError } from "../filesystem/rooted-directory.js";
import { isAbortSignal } from "../node/abort-signal.js";
import { decodeUtf8, Utf8Error } from "../text/utf8.js";
import {
  GitReadOnlyProcessError,
  type GitReadOnlyQuery,
  type GitReadOnlyResult,
  runGitReadOnly,
} from "./git-read-only-process.js";

/**
 * Wakeflow Foundation / Git：只读的提交观察（ADR-0028）。
 *
 * 对一个仓库检出与一个提交号，取这些事实：它是否存在且是提交对象；它的树与父提交；相对第一父
 * 提交（根提交相对空树）改动的路径与状态，不做重命名推断；补丁的字节数与 SHA-256，补丁正文在
 * 保留上限之内时一并给出。另一个入口回答"一个提交是否是另一个的祖先"。
 *
 * 本能力不读工作区是否干净、不读未提交的内容、不解析引用名（只接受完整的十六进制对象号）、不联网、
 * 不写仓库，也不解释观察结果的业务含义。进程协议与防护在 `git-read-only-process.ts`。
 */

const GIT_COMMIT_OBSERVATION_LIMITS = Object.freeze({
  /** 观察结果里保留的改动路径条数；超出时仍给出总数并标记截断。 */
  maximumChangedPaths: 2000,
  maximumParents: 64,
} as const);

export type GitChangedPathStatus = "added" | "modified" | "deleted" | "type-changed" | "other";

export interface GitChangedPath {
  readonly status: GitChangedPathStatus;
  readonly path: string;
}

export interface GitCommitPatch {
  readonly digest: Sha256Digest;
  readonly bytes: number;
  /** 补丁正文；超过保留上限时为 null。 */
  readonly content: Uint8Array | null;
}

export type GitCommitObservation =
  | Readonly<{ status: "missing"; commitOid: string }>
  | Readonly<{ status: "not-a-commit"; commitOid: string; objectType: string }>
  | Readonly<{
      status: "observed";
      commitOid: string;
      treeOid: string;
      parents: readonly string[];
      changedPaths: readonly Readonly<GitChangedPath>[];
      changedPathCount: number;
      changedPathsTruncated: boolean;
      patch: Readonly<GitCommitPatch>;
    }>;

export interface GitCommitObservationOptions {
  readonly signal?: AbortSignal;
}

export type GitCommitObservationErrorReason =
  | "input"
  | "root-scope"
  | "git-unavailable"
  | "query-failure"
  | "timeout"
  | "output-limit"
  | "protocol"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Git commit observation input is invalid.",
  "root-scope": "Git commit observation could not establish its rooted scope.",
  "git-unavailable": "Git commit observation could not start Git.",
  "query-failure": "Git commit observation query failed.",
  timeout: "Git commit observation exceeded its execution deadline.",
  "output-limit": "Git commit observation exceeded its output budget.",
  protocol: "Git commit observation returned an invalid machine record.",
  aborted: "Git commit observation was aborted.",
} as const satisfies Readonly<Record<GitCommitObservationErrorReason, string>>;

/** 提交观察失败的稳定、脱敏错误。 */
export class GitCommitObservationError extends Error {
  override readonly name = "GitCommitObservationError";
  readonly code = "wakeflow-git-commit-observation" as const;
  readonly reason: GitCommitObservationErrorReason;
  readonly path: string;

  constructor(reason: GitCommitObservationErrorReason, path: string, options?: ErrorOptions) {
    super(ERROR_MESSAGES[reason], options);
    this.reason = reason;
    this.path = path;
  }
}

const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const OBJECT_TYPE_PATTERN = /^[a-z]{1,16}$/u;

const CHANGE_STATUSES: Readonly<Record<string, GitChangedPathStatus>> = Object.freeze({
  A: "added",
  M: "modified",
  D: "deleted",
  T: "type-changed",
});

function fail(reason: GitCommitObservationErrorReason, path: string, cause?: unknown): never {
  throw new GitCommitObservationError(reason, path, cause === undefined ? undefined : { cause });
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

function parseSignal(value: unknown): AbortSignal | undefined {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options", error);
    throw error;
  }
  if (
    Object.keys(record).some((key) => key !== "signal") ||
    (record.signal !== undefined && !isAbortSignal(record.signal))
  ) {
    fail("input", "$options");
  }
  return record.signal as AbortSignal | undefined;
}

function parseObjectId(value: unknown, path: string): string {
  if (typeof value !== "string" || !OBJECT_ID_PATTERN.test(value)) fail("input", path);
  return value;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$options.signal");
}

async function assertRootCurrent(root: RootedDirectory): Promise<void> {
  try {
    await root.assertCurrent("$root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root", error);
    throw error;
  }
}

async function query(
  request: GitReadOnlyQuery,
  signal: AbortSignal | undefined,
): Promise<Readonly<GitReadOnlyResult>> {
  try {
    return await runGitReadOnly(request, signal);
  } catch (error: unknown) {
    if (error instanceof GitReadOnlyProcessError) fail(error.reason, error.path, error);
    throw error;
  }
}

function retainedOutput(result: Readonly<GitReadOnlyResult>): Buffer {
  if (result.stdout === null) fail("output-limit", "$git.stdout");
  return result.stdout;
}

function decode(bytes: Uint8Array, path: string): string {
  try {
    return decodeUtf8(bytes, path);
  } catch (error: unknown) {
    if (error instanceof Utf8Error) fail("protocol", path, error);
    throw error;
  }
}

interface CommitObject {
  readonly treeOid: string;
  readonly parents: readonly string[];
}

/** `cat-file --batch` 的一条回答：`<oid> missing`，或 `<oid> <type> <size>` 后跟正文。 */
function parseBatchAnswer(
  output: Buffer,
  commitOid: string,
): Readonly<{ status: "missing" } | { status: "not-a-commit"; objectType: string } | CommitObject> {
  const headerEnd = output.indexOf(0x0a);
  if (headerEnd < 0) fail("protocol", "$git.stdout");
  const header = decode(output.subarray(0, headerEnd), "$git.stdout").split(" ");
  if (header[0] !== commitOid) fail("protocol", "$git.stdout");
  if (header.length === 2 && header[1] === "missing") return { status: "missing" };
  const objectType = header[1];
  const size = Number(header[2]);
  if (
    header.length !== 3 ||
    objectType === undefined ||
    !OBJECT_TYPE_PATTERN.test(objectType) ||
    !Number.isSafeInteger(size) ||
    size < 0
  ) {
    fail("protocol", "$git.stdout");
  }
  if (objectType !== "commit") return { status: "not-a-commit", objectType };
  const body = output.subarray(headerEnd + 1, headerEnd + 1 + size);
  if (body.byteLength !== size) fail("protocol", "$git.stdout");
  return parseCommitHeaders(body);
}

/** 提交对象头部到第一个空行为止；只取 `tree` 与 `parent` 两种行。 */
function parseCommitHeaders(body: Buffer): Readonly<CommitObject> {
  const blank = body.indexOf("\n\n");
  const headers = decode(blank < 0 ? body : body.subarray(0, blank), "$git.stdout").split("\n");
  let treeOid: string | null = null;
  const parents: string[] = [];
  for (const line of headers) {
    if (line.startsWith("tree ")) treeOid = line.slice(5);
    else if (line.startsWith("parent ")) parents.push(line.slice(7));
  }
  if (
    treeOid === null ||
    !OBJECT_ID_PATTERN.test(treeOid) ||
    parents.length > GIT_COMMIT_OBSERVATION_LIMITS.maximumParents ||
    parents.some((parent) => !OBJECT_ID_PATTERN.test(parent))
  ) {
    fail("protocol", "$git.stdout");
  }
  return Object.freeze({ treeOid, parents: Object.freeze(parents) });
}

/** `diff-tree --name-status -z` 的输出：状态与路径交替，各以 NUL 结尾。 */
function parseChangedPaths(output: Buffer): Readonly<{
  paths: readonly Readonly<GitChangedPath>[];
  count: number;
}> {
  const fields = decode(output, "$git.stdout").split("\u0000");
  if (fields.at(-1) !== "" || fields.length % 2 !== 1) fail("protocol", "$git.stdout");
  const count = (fields.length - 1) / 2;
  const paths: GitChangedPath[] = [];
  for (let index = 0; index < count; index += 1) {
    const status = fields[index * 2];
    const path = fields[index * 2 + 1];
    if (status === undefined || status.length === 0 || path === undefined || path.length === 0) {
      fail("protocol", "$git.stdout");
    }
    if (index < GIT_COMMIT_OBSERVATION_LIMITS.maximumChangedPaths) {
      paths.push(Object.freeze({ status: CHANGE_STATUSES[status] ?? "other", path }));
    }
  }
  return { paths: Object.freeze(paths), count };
}

function patchOf(result: Readonly<GitReadOnlyResult>): Readonly<GitCommitPatch> {
  return Object.freeze({
    digest: parseSha256Digest(`${SHA256_DIGEST_PREFIX}${result.outputSha256Hex}`, "$git.stdout"),
    bytes: result.outputBytes,
    content: result.stdout === null ? null : new Uint8Array(result.stdout),
  });
}

/**
 * 观察一个提交。`missing` 与 `not-a-commit` 是正常的观察结果，不是错误；拿不到结论（Git 不可用、
 * 超时、不是仓库、输出越界）才抛出带稳定分类的错误。
 */
export async function observeGitCommit(
  rootValue: RootedDirectory,
  commitOidValue: string,
  optionsValue?: GitCommitObservationOptions,
): Promise<GitCommitObservation> {
  assertRoot(rootValue, "$root");
  const signal = parseSignal(optionsValue);
  const commitOid = parseObjectId(commitOidValue, "$commitOid");
  assertNotAborted(signal);
  await assertRootCurrent(rootValue);
  const repositoryRoot = rootValue.absolutePath;
  const answer = parseBatchAnswer(
    retainedOutput(await query({ kind: "commit-object", repositoryRoot, commitOid }, signal)),
    commitOid,
  );
  if ("status" in answer) return Object.freeze({ ...answer, commitOid });
  const baseOid = answer.parents[0] ?? null;
  const changed = parseChangedPaths(
    retainedOutput(
      await query({ kind: "changed-paths", repositoryRoot, baseOid, commitOid }, signal),
    ),
  );
  const patch = patchOf(await query({ kind: "patch", repositoryRoot, baseOid, commitOid }, signal));
  await assertRootCurrent(rootValue);
  assertNotAborted(signal);
  return Object.freeze({
    status: "observed",
    commitOid,
    treeOid: answer.treeOid,
    parents: answer.parents,
    changedPaths: changed.paths,
    changedPathCount: changed.count,
    changedPathsTruncated: changed.count > changed.paths.length,
    patch,
  });
}

/**
 * 只问一个对象号是不是仓库里的提交：一次查询，不取改动路径与补丁。结果与 `observeGitCommit` 的状态
 * 同名——`observed` 表示它存在并且是提交。
 */
export async function observeGitCommitKind(
  rootValue: RootedDirectory,
  commitOidValue: string,
  optionsValue?: GitCommitObservationOptions,
): Promise<GitCommitObservation["status"]> {
  assertRoot(rootValue, "$root");
  const signal = parseSignal(optionsValue);
  const commitOid = parseObjectId(commitOidValue, "$commitOid");
  assertNotAborted(signal);
  await assertRootCurrent(rootValue);
  const answer = parseBatchAnswer(
    retainedOutput(
      await query(
        { kind: "commit-object", repositoryRoot: rootValue.absolutePath, commitOid },
        signal,
      ),
    ),
    commitOid,
  );
  await assertRootCurrent(rootValue);
  assertNotAborted(signal);
  return "status" in answer ? answer.status : "observed";
}

/** 一个提交是否是另一个的祖先（相同的提交算祖先）。两个提交都必须存在，否则是查询失败。 */
export async function observeGitAncestry(
  rootValue: RootedDirectory,
  ancestorOidValue: string,
  descendantOidValue: string,
  optionsValue?: GitCommitObservationOptions,
): Promise<"ancestor" | "not-ancestor"> {
  assertRoot(rootValue, "$root");
  const signal = parseSignal(optionsValue);
  const ancestorOid = parseObjectId(ancestorOidValue, "$ancestorOid");
  const descendantOid = parseObjectId(descendantOidValue, "$descendantOid");
  assertNotAborted(signal);
  await assertRootCurrent(rootValue);
  const result = await query(
    { kind: "is-ancestor", repositoryRoot: rootValue.absolutePath, ancestorOid, descendantOid },
    signal,
  );
  await assertRootCurrent(rootValue);
  assertNotAborted(signal);
  return result.exitCode === 0 ? "ancestor" : "not-ancestor";
}
