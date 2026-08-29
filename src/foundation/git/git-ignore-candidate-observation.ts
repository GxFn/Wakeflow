import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";
import { types } from "node:util";

import {
  computeSha256Digest,
  type Sha256Digest,
} from "../crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import {
  createFileCandidateDurably,
  DurableFileCandidateError,
} from "../filesystem/durable-file-candidate.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../filesystem/rooted-directory.js";
import {
  parseByteCount,
  type ByteCount,
} from "../numeric/byte-count.js";
import {
  GitIgnoreObservationError,
  observeGitIgnorePathsInWorkTree,
  type GitIgnoreObservationOptions,
  type GitIgnorePathObservation,
} from "./git-ignore-observation.js";

/**
 * Wakeflow Foundation / Git：尚未发布的 Gitignore 文件候选语义观察。
 *
 * 本模块把候选字节写入一个由当前操作独占的临时 worktree，再复用真实 repository 的
 * Git 元数据执行 `check-ignore --no-index`。临时 worktree 不注册、不读取 index，也不
 * 修改调用方根目录；观察完成后无论成功或失败都必须精确移除。
 *
 * 结果绑定候选字节摘要并保留 Git 的最终模式来源，但不判断 `.gitignore` 是否属于某个
 * 业务权威，也不决定候选能否发布。临时目录只是进程内验证介质，不是可恢复 stage。
 */

export const GIT_IGNORE_CANDIDATE_MAXIMUM_BYTES = parseByteCount(
  2 * 1024 * 1024,
  "$candidateBytes",
);

const GITIGNORE_RESOURCE_PATH = parsePortableResourcePath(".gitignore");
const TEMPORARY_WORK_TREE_PREFIX = "wakeflow-git-ignore-candidate-";

export interface GitIgnoreCandidateObservation {
  readonly kind: "GitIgnoreCandidateObservation";
  readonly candidateByteCount: ByteCount;
  readonly candidateDigest: Sha256Digest;
  readonly paths: readonly Readonly<GitIgnorePathObservation>[];
}

export type GitIgnoreCandidateObservationErrorReason =
  | "input"
  | "capacity"
  | "root-scope"
  | "isolation-failure"
  | "observation-failure"
  | "cleanup-failure"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Git ignore candidate observation input is invalid.",
  capacity: "Git ignore candidate exceeds its byte budget.",
  "root-scope": "Git ignore candidate lost its repository root scope.",
  "isolation-failure": "Git ignore candidate worktree could not be isolated.",
  "observation-failure": "Git ignore candidate semantics could not be observed.",
  "cleanup-failure": "Git ignore candidate worktree could not be removed exactly.",
  aborted: "Git ignore candidate observation was aborted.",
} as const satisfies Readonly<Record<
  GitIgnoreCandidateObservationErrorReason,
  string
>>;

/** Gitignore 候选隔离观察失败的稳定、脱敏错误。 */
export class GitIgnoreCandidateObservationError extends Error {
  override readonly name = "GitIgnoreCandidateObservationError";
  readonly code = "wakeflow-git-ignore-candidate-observation" as const;
  readonly reason: GitIgnoreCandidateObservationErrorReason;
  readonly path: string;

  constructor(
    reason: GitIgnoreCandidateObservationErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface CandidateInput {
  readonly bytes: Buffer;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
}

interface ParsedOptions {
  readonly signal: AbortSignal | undefined;
}

function fail(
  reason: GitIgnoreCandidateObservationErrorReason,
  path: string,
): never {
  throw new GitIgnoreCandidateObservationError(reason, path);
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    fail("input", "$repositoryRoot");
  }
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal;
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (
    Object.keys(record).some((key) => key !== "signal")
    || (record.signal !== undefined && !isAbortSignal(record.signal))
  ) {
    fail("input", "$options");
  }
  return Object.freeze({
    signal: record.signal as AbortSignal | undefined,
  });
}

function snapshotCandidate(value: unknown): Readonly<CandidateInput> {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !ArrayBuffer.isView(value)
    || !(value instanceof Uint8Array)
    || value.buffer instanceof SharedArrayBuffer
  ) {
    fail("input", "$candidateBytes");
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(value);
  } catch {
    fail("input", "$candidateBytes");
  }
  const byteCount = parseByteCount(bytes.byteLength, "$candidateBytes");
  if (byteCount > GIT_IGNORE_CANDIDATE_MAXIMUM_BYTES) {
    fail("capacity", "$candidateBytes");
  }
  return Object.freeze({
    bytes,
    byteCount,
    digest: computeSha256Digest(bytes, "$candidateBytes"),
  });
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$options.signal");
}

async function assertRepositoryRootCurrent(
  root: RootedDirectory,
): Promise<void> {
  try {
    await root.assertCurrent("$repositoryRoot");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      fail("root-scope", "$repositoryRoot");
    }
    throw error;
  }
}

async function createTemporaryWorkTree(): Promise<Readonly<{
  readonly root: RootedDirectory;
}>> {
  let createdPath: string;
  try {
    createdPath = await mkdtemp(nodePath.join(
      os.tmpdir(),
      TEMPORARY_WORK_TREE_PREFIX,
    ));
  } catch {
    fail("isolation-failure", "$candidateWorkTree");
  }
  try {
    const root = await RootedDirectory.open(
      createdPath,
      "$candidateWorkTree",
    );
    return Object.freeze({ root });
  } catch (error: unknown) {
    try {
      await rm(createdPath, { recursive: true, force: false });
    } catch {
      fail("cleanup-failure", "$candidateWorkTree");
    }
    if (error instanceof RootedDirectoryError) {
      fail("isolation-failure", "$candidateWorkTree");
    }
    throw error;
  }
}

async function materializeCandidate(
  workTreeRoot: RootedDirectory,
  candidate: Readonly<CandidateInput>,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await createFileCandidateDurably(
      workTreeRoot,
      GITIGNORE_RESOURCE_PATH,
      candidate.bytes,
      {
        mode: 0o600,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DurableFileCandidateError) {
      if (error.reason === "aborted") fail("aborted", "$options.signal");
      fail("isolation-failure", "$candidateWorkTree");
    }
    throw error;
  }
}

async function observeCandidate(
  repositoryRoot: RootedDirectory,
  workTreeRoot: RootedDirectory,
  probePaths: readonly PortableResourcePath[],
  signal: AbortSignal | undefined,
) {
  try {
    return await observeGitIgnorePathsInWorkTree(
      repositoryRoot,
      workTreeRoot,
      probePaths,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof GitIgnoreObservationError) {
      if (error.reason === "aborted") fail("aborted", "$options.signal");
      if (
        error.reason === "root-scope"
        && error.path === "$repositoryRoot"
      ) {
        fail("root-scope", "$repositoryRoot");
      }
      fail("observation-failure", "$git");
    }
    throw error;
  }
}

/**
 * 在独立临时 worktree 中观察候选 `.gitignore`，并返回与候选摘要绑定的 Git 判定。
 */
export async function observeGitIgnoreCandidate(
  repositoryRootValue: RootedDirectory,
  candidateBytesValue: Uint8Array,
  probePathValues: readonly PortableResourcePath[],
  optionsValue?: GitIgnoreObservationOptions,
): Promise<Readonly<GitIgnoreCandidateObservation>> {
  assertRoot(repositoryRootValue);
  const candidate = snapshotCandidate(candidateBytesValue);
  const options = parseOptions(optionsValue);
  assertNotAborted(options.signal);
  await assertRepositoryRootCurrent(repositoryRootValue);
  assertNotAborted(options.signal);

  const temporary = await createTemporaryWorkTree();
  let operationError: unknown;
  let paths: readonly Readonly<GitIgnorePathObservation>[] | undefined;
  try {
    await materializeCandidate(temporary.root, candidate, options.signal);
    const observation = await observeCandidate(
      repositoryRootValue,
      temporary.root,
      probePathValues,
      options.signal,
    );
    paths = observation.paths;
  } catch (error: unknown) {
    operationError = error;
  }

  try {
    await temporary.root.close();
  } catch {
    if (operationError === undefined) {
      operationError = new GitIgnoreCandidateObservationError(
        "isolation-failure",
        "$candidateWorkTree",
      );
    }
  }
  try {
    await rm(temporary.root.absolutePath, {
      recursive: true,
      force: false,
    });
  } catch {
    fail("cleanup-failure", "$candidateWorkTree");
  }
  if (operationError !== undefined) throw operationError;
  if (paths === undefined) fail("observation-failure", "$git");
  return Object.freeze({
    kind: "GitIgnoreCandidateObservation",
    candidateByteCount: candidate.byteCount,
    candidateDigest: candidate.digest,
    paths,
  });
}
