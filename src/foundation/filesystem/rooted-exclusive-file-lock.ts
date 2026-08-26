import { setTimeout as delay } from "node:timers/promises";
import { types } from "node:util";
import { threadId } from "node:worker_threads";

import type { Sha256Digest } from "../crypto/sha256.js";
import {
  renderDeterministicJsonDocument,
  DeterministicJsonDocumentError,
} from "../data/deterministic-json-document.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import { createUuidV4 } from "../identity/uuid-v4.js";
import { parseUuidV4, UuidV4Error } from "../identity/uuid-v4.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import { parseByteCount, type ByteCount } from "../numeric/byte-count.js";
import { encodeUtf8 } from "../text/utf8.js";
import {
  readMonotonicClock,
  type MonotonicMoment,
} from "../time/monotonic-clock.js";
import {
  isMonotonicDeadlineReached,
  monotonicDeadlineAfter,
  monotonicDeadlineRemaining,
  type MonotonicDeadline,
} from "../time/monotonic-deadline.js";
import {
  monotonicDurationFromMilliseconds,
  type MonotonicDuration,
} from "../time/monotonic-duration.js";
import { parseUtcInstant, UtcInstantError, type UtcInstant } from "../time/utc-instant.js";
import { readUtcWallClock } from "../time/wall-clock.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
} from "./durable-atomic-file-write.js";
import {
  recoverDurableAtomicFileStagesInTargetParent,
  DurableAtomicFileStageRecoveryError,
} from "./durable-atomic-file-stage-recovery.js";
import { readDeterministicJsonFile } from "./deterministic-json-file.js";
import {
  unlinkRegularFileExactly,
  ExactRegularFileUnlinkError,
} from "./exact-regular-file-unlink.js";
import {
  sameFileNodeSnapshot,
  type FileNodeSnapshot,
} from "./file-node-snapshot.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "./rooted-directory.js";
import { StableFileReadError } from "./stable-file-read.js";
import { StrictTextFileError } from "./strict-text-file.js";

/**
 * Wakeflow Foundation / Filesystem：根作用域内的短生命周期 exclusive file lock。
 *
 * lock record 通过 DurableAtomicFileCreate 的 OS no-replace 边界完整发布；竞争者只
 * 等待并复验现存 target 为单链接 0600 regular file，持有者可以跨 await 执行一个
 * 有界 critical section，最终按创建 receipt 的 exact inode 删除并同步 parent。
 *
 * 本层故意不自动打破 stale lock。Node 没有 unlinkat/renameat2 compare-and-delete，
 * 根据 mtime/pid 猜测后删除 pathname 可能在旧 owner 释放、新 owner 创建的窗口误删
 * 新锁。crash residue 必须由了解业务 journal 和进程事实的显式恢复 owner 处理。
 * 本锁也不是分布式锁，不适用于不可靠共享网络文件系统。
 * 同一 Node process/thread 的 owner 状态由内存 active token 精确判断；其他线程或
 * 进程只用 process existence 做保守判断，不能据此自动夺锁。
 */

export const ROOTED_EXCLUSIVE_LOCK_DEFAULT_TIMEOUT_MILLISECONDS = 2_000;
export const ROOTED_EXCLUSIVE_LOCK_DEFAULT_RETRY_MILLISECONDS = 25;
export const ROOTED_EXCLUSIVE_LOCK_MAXIMUM_RECORD_BYTES = 4 * 1024;

export interface RootedExclusiveFileLockOptions {
  readonly acquireTimeoutMilliseconds?: number;
  readonly retryDelayMilliseconds?: number;
  readonly signal?: AbortSignal;
}

export interface RootedExclusiveFileLockRecord {
  readonly createdAt: UtcInstant;
  readonly kind: "WakeflowExclusiveFileLock";
  readonly pid: number;
  readonly threadId: number;
  readonly token: string;
  readonly version: 1;
}

export type RootedExclusiveFileLockOwnerState =
  | "active"
  | "inactive"
  | "unknown";

export type RootedExclusiveFileLockObservation =
  | Readonly<{
      status: "absent";
    }>
  | Readonly<{
      status: "held";
      record: Readonly<RootedExclusiveFileLockRecord>;
      node: Readonly<FileNodeSnapshot>;
      byteCount: ByteCount;
      digest: Sha256Digest;
      ownerState: RootedExclusiveFileLockOwnerState;
    }>;

export type RootedExclusiveFileLockErrorReason =
  | "input"
  | "root-scope"
  | "parent"
  | "unsafe-lock"
  | "acquire-failure"
  | "timeout"
  | "aborted"
  | "release-failure"
  | "owner-active"
  | "residue-changed";

const ERROR_MESSAGES = {
  "input": "Rooted exclusive file lock input is invalid.",
  "root-scope": "Rooted exclusive file lock lost its root scope.",
  "parent": "Rooted exclusive file lock parent is unavailable or unsafe.",
  "unsafe-lock": "Existing rooted exclusive lock target is not a safe lock record.",
  "acquire-failure": "Rooted exclusive file lock could not be acquired safely.",
  "timeout": "Rooted exclusive file lock acquisition timed out.",
  "aborted": "Rooted exclusive file lock acquisition was aborted.",
  "release-failure": "Rooted exclusive file lock could not release its exact record.",
  "owner-active": "Rooted exclusive file lock owner is still active or unverifiable.",
  "residue-changed": "Rooted exclusive file lock residue changed before retirement.",
} as const satisfies Readonly<Record<
  RootedExclusiveFileLockErrorReason,
  string
>>;

/** exclusive lock 生命周期失败的稳定、脱敏错误。 */
export class RootedExclusiveFileLockError extends Error {
  override readonly name = "RootedExclusiveFileLockError";
  readonly code = "wakeflow-rooted-exclusive-file-lock" as const;
  readonly reason: RootedExclusiveFileLockErrorReason;
  readonly path: string;

  constructor(reason: RootedExclusiveFileLockErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedOptions {
  readonly acquireTimeoutMilliseconds: number;
  readonly retryDelayMilliseconds: number;
  readonly signal: AbortSignal | undefined;
}

interface AcquiredLock {
  readonly node: Readonly<FileNodeSnapshot>;
  readonly token: string;
}

interface LockCandidate {
  readonly record: Readonly<RootedExclusiveFileLockRecord>;
  readonly bytes: Uint8Array;
}

const ISSUED_LOCK_OBSERVATIONS = new WeakSet<object>();
const ACTIVE_LOCK_TOKENS = new Set<string>();
const LOCK_RECORD_FIELDS = Object.freeze([
  "createdAt",
  "kind",
  "pid",
  "threadId",
  "token",
  "version",
] as const);
const LOCK_TOKEN_PATTERN = /^([1-9][0-9]*)-(0|[1-9][0-9]*)-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const MAXIMUM_NODE_TIMER_DELAY_MILLISECONDS = 2_147_483_647;

function fail(
  reason: RootedExclusiveFileLockErrorReason,
  path: string,
): never {
  throw new RootedExclusiveFileLockError(reason, path);
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
}

function parsePositiveMilliseconds(value: unknown, path: string): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value <= 0
  ) {
    fail("input", path);
  }
  return value;
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
  const allowed = new Set([
    "acquireTimeoutMilliseconds",
    "retryDelayMilliseconds",
    "signal",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    fail("input", "$options");
  }
  if (record.signal !== undefined && !isAbortSignal(record.signal)) {
    fail("input", "$options.signal");
  }
  return Object.freeze({
    acquireTimeoutMilliseconds: parsePositiveMilliseconds(
      record.acquireTimeoutMilliseconds
        ?? ROOTED_EXCLUSIVE_LOCK_DEFAULT_TIMEOUT_MILLISECONDS,
      "$options.acquireTimeoutMilliseconds",
    ),
    retryDelayMilliseconds: parsePositiveMilliseconds(
      record.retryDelayMilliseconds
        ?? ROOTED_EXCLUSIVE_LOCK_DEFAULT_RETRY_MILLISECONDS,
      "$options.retryDelayMilliseconds",
    ),
    signal: record.signal,
  });
}

function assertOperation<Result>(
  value: unknown,
): asserts value is () => Result | Promise<Result> {
  if (typeof value !== "function" || types.isProxy(value)) {
    fail("input", "$operation");
  }
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$signal");
}

function readLockMonotonicClock(): MonotonicMoment {
  try {
    return readMonotonicClock();
  } catch {
    fail("acquire-failure", "$lock");
  }
}

function lockDeadline(timeoutMilliseconds: number): MonotonicDeadline {
  try {
    return monotonicDeadlineAfter(
      readLockMonotonicClock(),
      monotonicDurationFromMilliseconds(timeoutMilliseconds),
    );
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) throw error;
    fail("acquire-failure", "$lock");
  }
}

function createLockCandidate(): Readonly<LockCandidate> {
  const record: Readonly<RootedExclusiveFileLockRecord> = Object.freeze({
    createdAt: readUtcWallClock(),
    kind: "WakeflowExclusiveFileLock" as const,
    pid: process.pid,
    threadId,
    token: `${process.pid}-${threadId}-${createUuidV4()}`,
    version: 1 as const,
  });
  const bytes = encodeUtf8(
    renderDeterministicJsonDocument(record, "$lockRecord"),
    "$lockRecord",
  );
  if (bytes.byteLength > ROOTED_EXCLUSIVE_LOCK_MAXIMUM_RECORD_BYTES) {
    fail("acquire-failure", "$lock");
  }
  return Object.freeze({ record, bytes });
}

function observeOwnerState(
  record: Readonly<RootedExclusiveFileLockRecord>,
): RootedExclusiveFileLockOwnerState {
  if (record.pid === process.pid) {
    if (record.threadId !== threadId) return "unknown";
    return ACTIVE_LOCK_TOKENS.has(record.token) ? "active" : "inactive";
  }
  try {
    process.kill(record.pid, 0);
    return "active";
  } catch (error: unknown) {
    const code = readNodeSystemErrorCode(error);
    if (code === "ESRCH") return "inactive";
    return "unknown";
  }
}

function parseLockRecord(value: unknown): Readonly<RootedExclusiveFileLockRecord> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$lock");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("unsafe-lock", "$lock");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== LOCK_RECORD_FIELDS.length
    || keys.some((key, index) => key !== LOCK_RECORD_FIELDS[index])
    || record.kind !== "WakeflowExclusiveFileLock"
    || record.version !== 1
    || typeof record.pid !== "number"
    || !Number.isSafeInteger(record.pid)
    || record.pid <= 0
    || typeof record.threadId !== "number"
    || !Number.isSafeInteger(record.threadId)
    || record.threadId < 0
    || typeof record.token !== "string"
  ) {
    fail("unsafe-lock", "$lock");
  }
  const token = LOCK_TOKEN_PATTERN.exec(record.token);
  if (
    token === null
    || Number(token[1]) !== record.pid
    || Number(token[2]) !== record.threadId
  ) {
    fail("unsafe-lock", "$lock");
  }
  try {
    parseUuidV4(token[3], "$lock/token");
  } catch (error: unknown) {
    if (error instanceof UuidV4Error) fail("unsafe-lock", "$lock");
    throw error;
  }
  let createdAt: UtcInstant;
  try {
    createdAt = parseUtcInstant(record.createdAt, "$lock/createdAt");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("unsafe-lock", "$lock");
    throw error;
  }
  return Object.freeze({
    createdAt,
    kind: "WakeflowExclusiveFileLock",
    pid: record.pid,
    threadId: record.threadId,
    token: record.token,
    version: 1,
  });
}

/** 稳定观察 lock record；record/token 只供进程内 recovery，不得进入公共结果。 */
export async function inspectRootedExclusiveFileLock(
  root: RootedDirectory,
  lockPath: PortableResourcePath,
): Promise<RootedExclusiveFileLockObservation> {
  assertRoot(root);
  let read;
  try {
    read = await readDeterministicJsonFile(root, lockPath, {
      maximumBytes: parseByteCount(ROOTED_EXCLUSIVE_LOCK_MAXIMUM_RECORD_BYTES),
    });
  } catch (error: unknown) {
    if (
      error instanceof StableFileReadError
      && error.reason === "not-found"
    ) {
      const absent = Object.freeze({ status: "absent" as const });
      ISSUED_LOCK_OBSERVATIONS.add(absent);
      return absent;
    }
    if (
      error instanceof StableFileReadError
      && error.reason === "source-changed"
    ) {
      fail("residue-changed", "$lock");
    }
    if (error instanceof StableFileReadError) {
      if (
        error.reason === "symlink"
        || error.reason === "not-file"
        || error.reason === "too-large"
      ) {
        fail("unsafe-lock", "$lock");
      }
      if (error.reason === "input") fail("input", error.path);
      if (
        error.reason === "root-scope"
        || error.reason === "unsupported-platform"
      ) {
        fail("root-scope", "$root");
      }
      if (error.reason === "aborted") fail("aborted", "$signal");
      // open/read/close 与 hash 失败可能发生在 owner release/new-acquire 的短窗口；
      // contender 只重试并受 acquisition deadline 限制，绝不据此删除 pathname。
      fail("residue-changed", "$lock");
    }
    if (error instanceof StrictTextFileError) {
      fail("unsafe-lock", "$lock");
    }
    if (error instanceof DeterministicJsonDocumentError) {
      fail("unsafe-lock", "$lock");
    }
    throw error;
  }
  if (
    read.node.kind !== "file"
    || (read.node.linkCount !== 1n && read.node.linkCount !== 2n)
    || read.node.permissionBits !== 0o600
  ) {
    fail("unsafe-lock", "$lock");
  }
  const record = parseLockRecord(read.value);
  if (renderDeterministicJsonDocument(record, "$lock") !== read.text) {
    fail("unsafe-lock", "$lock");
  }
  const observation = Object.freeze({
    status: "held" as const,
    record,
    node: read.node,
    byteCount: read.byteCount,
    digest: read.digest,
    ownerState: observeOwnerState(record),
  });
  ISSUED_LOCK_OBSERVATIONS.add(observation);
  return observation;
}

/**
 * 显式退休一个已证明 owner inactive 且仍匹配 exact observation 的 lock residue。
 *
 * 调用方必须先持有自己的 domain recovery evidence；本函数不读取 journal、不根据
 * mtime 猜测 stale，也不接受自造 observation。
 */
export async function retireRootedExclusiveFileLockResidue(
  root: RootedDirectory,
  lockPath: PortableResourcePath,
  observation: RootedExclusiveFileLockObservation,
): Promise<void> {
  assertRoot(root);
  if (
    typeof observation !== "object"
    || observation === null
    || !Object.isFrozen(observation)
    || !ISSUED_LOCK_OBSERVATIONS.has(observation)
    || observation.status !== "held"
  ) {
    fail("input", "$observation");
  }
  if (observation.ownerState !== "inactive") fail("owner-active", "$lock");
  try {
    const stageRecovery = await recoverDurableAtomicFileStagesInTargetParent(
      root,
      lockPath,
    );
    if (
      stageRecovery.activeStageCount !== 0
      || stageRecovery.unknownStageCount !== 0
    ) {
      fail("residue-changed", "$lock");
    }
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) throw error;
    if (error instanceof DurableAtomicFileStageRecoveryError) {
      fail("residue-changed", "$lock");
    }
    throw error;
  }
  const current = await inspectRootedExclusiveFileLock(root, lockPath);
  if (
    current.status !== "held"
    || current.ownerState !== "inactive"
    || current.record.token !== observation.record.token
    || current.digest !== observation.digest
    || !sameFileNodeSnapshot(current.node, observation.node)
  ) {
    fail("residue-changed", "$lock");
  }
  try {
    await unlinkRegularFileExactly(root, lockPath, {
      expectedNode: observation.node,
    });
  } catch (error: unknown) {
    if (error instanceof ExactRegularFileUnlinkError) {
      fail("residue-changed", "$lock");
    }
    throw error;
  }
}

function mapCreateError(error: DurableAtomicFileWriteError): "contended" {
  if (error.reason === "target-exists") return "contended";
  if (error.reason === "input") fail("input", error.path);
  if (error.reason === "root-scope") fail("root-scope", "$root");
  if (
    error.reason === "parent-not-found"
    || error.reason === "parent-symlink"
    || error.reason === "parent-not-directory"
    || error.reason === "parent-open-failure"
    || error.reason === "parent-changed"
  ) {
    fail("parent", "$lock");
  }
  if (error.reason === "aborted") fail("aborted", "$signal");
  fail("acquire-failure", "$lock");
}

async function lockTargetExists(
  root: RootedDirectory,
  lockPath: PortableResourcePath,
): Promise<boolean> {
  try {
    await root.inspectExistingResource(lockPath, "$lock");
    return true;
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      if (error.reason === "resource-not-found") return false;
      if (error.reason === "resource-changed") return true;
      if (error.reason === "resource-path") fail("input", "$lockPath");
      if (
        error.reason === "ancestor-symlink"
        || error.reason === "ancestor-type"
      ) {
        fail("parent", "$lock");
      }
      fail("root-scope", "$root");
    }
    throw error;
  }
}

async function tryAcquire(
  root: RootedDirectory,
  lockPath: PortableResourcePath,
  signal: AbortSignal | undefined,
): Promise<Readonly<AcquiredLock> | null> {
  // Contended hot path 先做一次 no-follow target observation，避免每轮重试扫描 parent。
  if (await lockTargetExists(root, lockPath)) return null;
  const candidate = createLockCandidate();
  ACTIVE_LOCK_TOKENS.add(candidate.record.token);
  try {
    const created = await createFileAtomically(root, lockPath, candidate.bytes, {
      mode: 0o600,
      ...(signal === undefined ? {} : { signal }),
    });
    return Object.freeze({
      node: created.node,
      token: candidate.record.token,
    });
  } catch (error: unknown) {
    ACTIVE_LOCK_TOKENS.delete(candidate.record.token);
    if (error instanceof DurableAtomicFileWriteError) {
      if (mapCreateError(error) === "contended") return null;
    }
    throw error;
  }
}

async function assertSafeExistingLock(
  root: RootedDirectory,
  lockPath: PortableResourcePath,
): Promise<void> {
  try {
    await inspectRootedExclusiveFileLock(root, lockPath);
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      if (error.reason === "residue-changed") return;
      if (error.reason === "root-scope") {
        try {
          await root.assertCurrent("$root");
          return;
        } catch {
          throw error;
        }
      }
      throw error;
    }
    if (error instanceof RootedDirectoryError) {
      if (
        error.reason === "resource-not-found"
        || error.reason === "resource-changed"
      ) return;
      if (
        error.reason === "ancestor-symlink"
        || error.reason === "ancestor-type"
      ) {
        fail("parent", "$lock");
      }
      fail("root-scope", "$root");
    }
    throw error;
  }
}

async function waitForRetry(
  milliseconds: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await delay(
      milliseconds,
      undefined,
      signal === undefined ? {} : { signal },
    );
  } catch (error: unknown) {
    if (signal?.aborted === true) {
      fail("aborted", "$signal");
    }
    throw error;
  }
}

function remainingRetryDelayMilliseconds(
  deadline: MonotonicDeadline,
  retryDelayMilliseconds: number,
): number {
  const now = readLockMonotonicClock();
  if (isMonotonicDeadlineReached(deadline, now)) fail("timeout", "$lock");
  const remaining = monotonicDeadlineRemaining(deadline, now);
  const oneMillisecond = 1_000_000n;
  let retry: MonotonicDuration;
  let maximumTimer: MonotonicDuration;
  try {
    retry = monotonicDurationFromMilliseconds(retryDelayMilliseconds);
    maximumTimer = monotonicDurationFromMilliseconds(
      MAXIMUM_NODE_TIMER_DELAY_MILLISECONDS,
    );
  } catch {
    fail("input", "$options.retryDelayMilliseconds");
  }
  const bounded = remaining < retry ? remaining : retry;
  const timerBounded = bounded < maximumTimer ? bounded : maximumTimer;
  return Number((timerBounded + oneMillisecond - 1n) / oneMillisecond);
}

async function acquire(
  root: RootedDirectory,
  lockPath: PortableResourcePath,
  options: Readonly<ParsedOptions>,
): Promise<Readonly<AcquiredLock>> {
  const deadline = lockDeadline(options.acquireTimeoutMilliseconds);
  while (true) {
    assertNotAborted(options.signal);
    if (isMonotonicDeadlineReached(deadline, readLockMonotonicClock())) {
      fail("timeout", "$lock");
    }
    const acquired = await tryAcquire(root, lockPath, options.signal);
    if (acquired !== null) return acquired;
    await assertSafeExistingLock(root, lockPath);
    await waitForRetry(
      remainingRetryDelayMilliseconds(
        deadline,
        options.retryDelayMilliseconds,
      ),
      options.signal,
    );
  }
}

async function release(
  root: RootedDirectory,
  lockPath: PortableResourcePath,
  acquired: Readonly<AcquiredLock>,
): Promise<void> {
  try {
    await unlinkRegularFileExactly(root, lockPath, {
      expectedNode: acquired.node,
      settlement: "replacement-allowed",
    });
  } catch (error: unknown) {
    if (error instanceof ExactRegularFileUnlinkError) {
      fail("release-failure", `$lock/${error.reason}`);
    }
    throw error;
  }
}

/** 在一个 exact rooted lock record 存续期间执行 async critical section。 */
export async function withRootedExclusiveFileLock<Result>(
  root: RootedDirectory,
  lockPath: PortableResourcePath,
  operation: () => Result | Promise<Result>,
  options?: RootedExclusiveFileLockOptions,
): Promise<Result> {
  assertRoot(root);
  assertOperation<Result>(operation);
  const parsed = parseOptions(options);
  const acquired = await acquire(root, lockPath, parsed);

  let result: Result | undefined;
  let operationError: unknown;
  let operationFailed = false;
  try {
    result = await operation();
  } catch (error: unknown) {
    operationFailed = true;
    operationError = error;
  }
  try {
    await release(root, lockPath, acquired);
  } finally {
    ACTIVE_LOCK_TOKENS.delete(acquired.token);
  }
  if (operationFailed) throw operationError;
  return result as Result;
}
