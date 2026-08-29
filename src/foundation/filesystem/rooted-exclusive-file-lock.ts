import { setTimeout as delay } from "node:timers/promises";
import { types } from "node:util";
import { threadId } from "node:worker_threads";

import type { Sha256Digest } from "../crypto/sha256.js";
import {
  renderDeterministicJsonDocument,
  DeterministicJsonDocumentError,
} from "../data/deterministic-json-document.js";
import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import {
  createUuidV4,
  parseUuidV4,
  UuidV4Error,
  type UuidV4Factory,
} from "../identity/uuid-v4.js";
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
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
} from "./durable-atomic-file-write.js";
import {
  DURABLE_ATOMIC_FILE_STAGE_MAXIMUM_TARGET_SCOPE,
  recoverDurableAtomicFileStagesForTargets,
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
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  splitPortableResourcePath,
  type PortableResourcePath,
} from "./portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "./rooted-directory.js";
import { StableFileReadError } from "./stable-file-read.js";
import { StrictTextFileError } from "./strict-text-file.js";

/**
 * Wakeflow Foundation / Filesystem：根作用域内的短生命周期独占文件锁。
 *
 * 锁记录通过 `DurableAtomicFileCreate` 的操作系统不替换边界完整发布。竞争者只等待
 * 并复验已有目标是权限位 `0600` 的单链接普通文件；持有者可以跨 `await` 执行有界
 * 临界区，最后根据创建回执绑定的指定 inode 删除锁文件并同步父目录。
 *
 * 本层故意不自动打破失效锁。Node.js 没有暴露支持比较后删除的 `unlinkat` 或
 * `renameat2`；根据修改时间或进程号猜测后删除路径，可能在旧职责所有者释放锁、
 * 新职责所有者创建锁的窗口中误删新锁。崩溃残留必须由了解业务意图记录和进程事实的
 * 显式恢复职责所有者处理。本锁也不是分布式锁，不适用于不可靠的共享网络文件系统。
 * 同一 Node.js 进程和线程的职责所有者状态由内存活动令牌精确判断；其他线程或进程
 * 只能根据进程是否存在作保守判断，不能据此自动夺锁。
 */

const ROOTED_EXCLUSIVE_LOCK_DEFAULT_TIMEOUT_MILLISECONDS = 2_000;
const ROOTED_EXCLUSIVE_LOCK_DEFAULT_RETRY_MILLISECONDS = 25;
const ROOTED_EXCLUSIVE_LOCK_MAXIMUM_RECORD_BYTES = 4 * 1024;

export interface RootedExclusiveFileLockOptions {
  readonly acquireTimeoutMilliseconds?: number;
  readonly retryDelayMilliseconds?: number;
  readonly signal?: AbortSignal;
  /** 仅供需要把领域 operation 与锁 token 关联的内部 owner 注入。 */
  readonly tokenUuidFactory?: UuidV4Factory;
}

export interface RootedExclusiveFileLockResidueRetirementOptions {
  readonly relatedTargetResourcePaths?: readonly PortableResourcePath[];
}

export interface RootedExclusiveFileLockRecord {
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
  readonly tokenUuidFactory: UuidV4Factory | undefined;
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
    "tokenUuidFactory",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    fail("input", "$options");
  }
  if (record.signal !== undefined && !isAbortSignal(record.signal)) {
    fail("input", "$options.signal");
  }
  if (
    record.tokenUuidFactory !== undefined
    && (
      typeof record.tokenUuidFactory !== "function"
      || types.isProxy(record.tokenUuidFactory)
    )
  ) {
    fail("input", "$options.tokenUuidFactory");
  }
  return Object.freeze({
    acquireTimeoutMilliseconds: parsePositiveMilliseconds(
      record.acquireTimeoutMilliseconds === undefined
        ? ROOTED_EXCLUSIVE_LOCK_DEFAULT_TIMEOUT_MILLISECONDS
        : record.acquireTimeoutMilliseconds,
      "$options.acquireTimeoutMilliseconds",
    ),
    retryDelayMilliseconds: parsePositiveMilliseconds(
      record.retryDelayMilliseconds === undefined
        ? ROOTED_EXCLUSIVE_LOCK_DEFAULT_RETRY_MILLISECONDS
        : record.retryDelayMilliseconds,
      "$options.retryDelayMilliseconds",
    ),
    signal: record.signal,
    tokenUuidFactory: record.tokenUuidFactory as UuidV4Factory | undefined,
  });
}

function parseRetirementTargets(
  lockPath: PortableResourcePath,
  value: unknown,
): readonly PortableResourcePath[] {
  let record: Readonly<Record<string, unknown>>;
  let relatedValues: readonly unknown[];
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
    if (
      Object.keys(record).some((key) => key !== "relatedTargetResourcePaths")
    ) {
      fail("input", "$options");
    }
    relatedValues = parseDenseArray(
      record.relatedTargetResourcePaths === undefined
        ? []
        : record.relatedTargetResourcePaths,
      DURABLE_ATOMIC_FILE_STAGE_MAXIMUM_TARGET_SCOPE - 1,
      "$options.relatedTargetResourcePaths",
    );
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  const targets: PortableResourcePath[] = [lockPath];
  for (const [index, value] of relatedValues.entries()) {
    let target: PortableResourcePath;
    try {
      target = parsePortableResourcePath(
        value,
        `$options.relatedTargetResourcePaths/${index}`,
      );
    } catch (error: unknown) {
      if (error instanceof PortableResourcePathError) {
        fail("input", `$options.relatedTargetResourcePaths/${index}`);
      }
      throw error;
    }
    if (targets.includes(target)) {
      fail("input", `$options.relatedTargetResourcePaths/${index}`);
    }
    targets.push(target);
  }
  const lockParent = splitPortableResourcePath(lockPath).slice(0, -1).join("/");
  if (targets.some((target) => (
    splitPortableResourcePath(target).slice(0, -1).join("/") !== lockParent
  ))) {
    fail("input", "$options.relatedTargetResourcePaths");
  }
  return Object.freeze(targets);
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

function createLockCandidate(
  tokenUuidFactory: UuidV4Factory | undefined,
): Readonly<LockCandidate> {
  let tokenUuid: string;
  try {
    tokenUuid = tokenUuidFactory === undefined
      ? createUuidV4()
      : createUuidV4(tokenUuidFactory);
  } catch {
    fail("acquire-failure", "$lock");
  }
  const record: Readonly<RootedExclusiveFileLockRecord> = Object.freeze({
    kind: "WakeflowExclusiveFileLock" as const,
    pid: process.pid,
    threadId,
    token: `${process.pid}-${threadId}-${tokenUuid}`,
    version: 1 as const,
  });
  let bytes: Uint8Array;
  try {
    bytes = encodeUtf8(
      renderDeterministicJsonDocument(record, "$lockRecord"),
      "$lockRecord",
    );
  } catch {
    fail("acquire-failure", "$lock");
  }
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
  return Object.freeze({
    kind: "WakeflowExclusiveFileLock",
    pid: record.pid,
    threadId: record.threadId,
    token: record.token,
    version: 1,
  });
}

/** 稳定观察锁记录；记录内容和令牌只供进程内恢复使用，不得进入公共结果。 */
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
      // 打开、读取、关闭或摘要计算失败可能发生在旧持有者释放、新持有者获取的短窗口；
      // 锁竞争方只重试并受获取截止时间限制，绝不据此删除路径名。
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
    || (
      typeof process.geteuid === "function"
      && read.node.userId !== BigInt(process.geteuid())
    )
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
 * 显式退休已经证明持有者不再活动，且仍与指定观察结果一致的锁残留。
 *
 * 调用方必须先持有自己的领域恢复证据；本函数不读取恢复意图记录，不根据
 * `mtime` 猜测锁是否过期，也不接受自行构造的观察结果。调用方声明的相关目标与
 * lockPath 必须位于同一父目录；发现集合外 stage 时保持锁和该 stage 不变。
 */
export async function retireRootedExclusiveFileLockResidue(
  root: RootedDirectory,
  lockPath: PortableResourcePath,
  observation: RootedExclusiveFileLockObservation,
  options?: RootedExclusiveFileLockResidueRetirementOptions,
): Promise<void> {
  assertRoot(root);
  const retirementTargets = parseRetirementTargets(lockPath, options);
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
    const stageRecovery = await recoverDurableAtomicFileStagesForTargets(
      root,
      retirementTargets,
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
      // 首次 lstat 后锁文件被并发删除时，真实路径检查只能报告观察失败；
      // 返回 contended 后 assertSafeExistingLock 会立即重新执行完整安全检查。
      if (error.reason === "inspection-failure") return true;
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
  tokenUuidFactory: UuidV4Factory | undefined,
): Promise<Readonly<AcquiredLock> | null> {
  // 竞争热点路径先执行一次不跟随符号链接的目标观察，避免每轮重试都扫描父目录。
  if (await lockTargetExists(root, lockPath)) return null;
  const candidate = createLockCandidate(tokenUuidFactory);
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
    fail("acquire-failure", "$lock");
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
    const acquired = await tryAcquire(
      root,
      lockPath,
      options.signal,
      options.tokenUuidFactory,
    );
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

/** 在指定根作用域锁记录存续期间执行异步临界区。 */
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
