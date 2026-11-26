import { AsyncLocalStorage } from "node:async_hooks";
import { constants as fileSystemConstants } from "node:fs";
import { type FileHandle, lstat } from "node:fs/promises";
import { join as joinPath } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { types } from "node:util";
import { PassiveOwnDataError, parsePlainRecord } from "../data/passive-own-data.js";
import { isAbortSignal } from "../node/abort-signal.js";
import { advisoryLockFlagsOrNull } from "../node/advisory-lock-flags.js";
import { ownedByAnotherUser } from "../node/current-user.js";
import { filesystemMutation } from "./filesystem-mutation.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import { readMonotonicClock } from "../time/monotonic-clock.js";
import {
  isMonotonicDeadlineReached,
  type MonotonicDeadline,
  monotonicDeadlineAfter,
} from "../time/monotonic-deadline.js";
import { monotonicDurationFromMilliseconds } from "../time/monotonic-duration.js";
import {
  type PortableResourcePath,
  PortableResourcePathError,
  splitPortableResourcePath,
} from "./portable-resource-path.js";
import { isRootedDirectory, type RootedDirectory } from "./rooted-directory.js";

/**
 * Wakeflow Foundation / Filesystem：根作用域内的内核咨询锁（ADR-0033）。
 *
 * 锁是在一个常驻文件上持有的内核咨询锁：打开文件的同时取得，关闭即释放，持有者死掉时由内核收走。
 * 磁盘上因此没有"锁的状态"——没有属主记录，没有残留，没有要判断死活的持有者。锁文件只建不删：
 * 锁跟的是文件节点而不是路径，删掉之后新建的同名文件可以在旧节点仍被持有时被另一个进程拿到。
 *
 * 等待是非阻塞的轮询：被别人持有时等一小会儿再试，到期报 `timeout`。拿到之后核对一次——手里的节点
 * 必须是路径现在指向的那个普通文件、属主是当前用户；路径被换过就关掉重来。打开时不跟随符号链接。
 *
 * 每个进程对每个卷自测一次：手里拿着锁再独占地开一次，第二次必须被拒。打开报"不支持"或第二次居然
 * 成功，都报 `unsupported`，不退回别的互斥办法。
 *
 * 同一条异步调用链里再次获取同一把锁是程序错误（内核会让它一直等到超时），当场报 `reentered`。
 * 同一个进程里互不相干的两次调用照常排队。
 *
 * 锁文件是空文件，建出来之后没有人再写它：持有与否不改变磁盘上的任何字节。本锁不是分布式锁。
 */

const DEFAULT_ACQUIRE_TIMEOUT_MILLISECONDS = 2_000;
const DEFAULT_RETRY_DELAY_MILLISECONDS = 25;
const MAXIMUM_ACQUIRE_TIMEOUT_MILLISECONDS = 300_000;
const MAXIMUM_RETRY_DELAY_MILLISECONDS = 1_000;
const LOCK_FILE_MODE = 0o600;

export type KernelFileLockMode = "shared" | "exclusive";

export interface KernelFileLockOptions {
  readonly acquireTimeoutMilliseconds?: number;
  readonly retryDelayMilliseconds?: number;
  readonly signal?: AbortSignal;
}

export type KernelFileLockErrorReason =
  | "input"
  | "aborted"
  | "timeout"
  | "unsupported"
  | "unsafe-lock"
  | "parent"
  | "reentered"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Kernel file lock input is invalid.",
  aborted: "Kernel file lock acquisition was aborted.",
  timeout: "Kernel file lock is held by another owner.",
  unsupported: "This volume or platform does not provide kernel advisory locks.",
  "unsafe-lock": "Kernel file lock path is not a regular file owned by the current user.",
  parent: "Kernel file lock directory does not exist.",
  reentered: "Kernel file lock is already held by this call chain.",
  "operation-failure": "Kernel file lock operation failed.",
} as const satisfies Readonly<Record<KernelFileLockErrorReason, string>>;

/** 内核咨询锁失败的稳定、脱敏错误。 */
export class KernelFileLockError extends Error {
  override readonly name = "KernelFileLockError";
  readonly code = "wakeflow-kernel-file-lock" as const;
  readonly reason: KernelFileLockErrorReason;
  readonly path: string;
  /** 只有等不到锁（`timeout`）才值得原样再试；没有被调用方说成自己的拒绝时，边界层据此报成并发冲突。 */
  readonly retryable: boolean;

  constructor(reason: KernelFileLockErrorReason, path: string, options?: ErrorOptions) {
    super(ERROR_MESSAGES[reason], options);
    this.reason = reason;
    this.path = path;
    this.retryable = reason === "timeout";
  }
}

function fail(reason: KernelFileLockErrorReason, path: string, cause?: unknown): never {
  throw new KernelFileLockError(reason, path, cause === undefined ? undefined : { cause });
}

interface ParsedOptions {
  readonly acquireTimeoutMilliseconds: number;
  readonly retryDelayMilliseconds: number;
  readonly signal: AbortSignal | undefined;
}

function boundedMilliseconds(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    fail("input", "$options");
  }
  return value;
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value ?? {}, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options", error);
    throw error;
  }
  const known = ["acquireTimeoutMilliseconds", "retryDelayMilliseconds", "signal"];
  if (Object.keys(record).some((key) => !known.includes(key))) fail("input", "$options");
  if (record.signal !== undefined && !isAbortSignal(record.signal)) fail("input", "$options");
  return {
    acquireTimeoutMilliseconds: boundedMilliseconds(
      record.acquireTimeoutMilliseconds,
      DEFAULT_ACQUIRE_TIMEOUT_MILLISECONDS,
      MAXIMUM_ACQUIRE_TIMEOUT_MILLISECONDS,
    ),
    retryDelayMilliseconds: boundedMilliseconds(
      record.retryDelayMilliseconds,
      DEFAULT_RETRY_DELAY_MILLISECONDS,
      MAXIMUM_RETRY_DELAY_MILLISECONDS,
    ),
    signal: record.signal as AbortSignal | undefined,
  };
}

function lockPathOf(root: RootedDirectory, lockRef: PortableResourcePath): string {
  if (!isRootedDirectory(root)) fail("input", "$root");
  try {
    return joinPath(root.absolutePath, ...splitPortableResourcePath(lockRef));
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) fail("input", "$lock", error);
    throw error;
  }
}

function lockFlag(mode: KernelFileLockMode): number {
  const flags = advisoryLockFlagsOrNull();
  if (flags === null) fail("unsupported", "$lock");
  return mode === "shared" ? flags.shared : flags.exclusive;
}

const BUSY_CODES: ReadonlySet<string> = new Set(["EAGAIN", "EWOULDBLOCK"]);
const UNSUPPORTED_CODES: ReadonlySet<string> = new Set(["ENOTSUP", "EOPNOTSUPP", "ENOLCK"]);
const UNSAFE_CODES: ReadonlySet<string> = new Set(["ELOOP", "EISDIR", "ENOTDIR"]);

/** 打开锁文件失败的归类：锁目录不在、平台或卷不支持、路径上不是普通文件，其余是操作失败。 */
function failOpen(error: unknown): never {
  const code = readNodeSystemErrorCode(error) ?? "";
  if (code === "ENOENT") fail("parent", "$lock", error);
  if (UNSUPPORTED_CODES.has(code)) fail("unsupported", "$lock", error);
  if (UNSAFE_CODES.has(code)) fail("unsafe-lock", "$lock", error);
  fail("operation-failure", "$lock", error);
}

/**
 * 非阻塞地打开并上锁；被别人持有返回 null。`create` 为假时文件不在也返回 null。总是只读地打开：
 * 锁文件是空文件，没有人往里写。
 */
async function tryOpenLocked(
  lockPath: string,
  mode: KernelFileLockMode,
  create: boolean,
): Promise<FileHandle | null> {
  const flags =
    fileSystemConstants.O_RDONLY |
    (create ? fileSystemConstants.O_CREAT : 0) |
    fileSystemConstants.O_NOFOLLOW |
    fileSystemConstants.O_NONBLOCK |
    lockFlag(mode);
  try {
    return await filesystemMutation.openLockFile(lockPath, flags, LOCK_FILE_MODE);
  } catch (error: unknown) {
    const code = readNodeSystemErrorCode(error) ?? "";
    if (BUSY_CODES.has(code) || (code === "ENOENT" && !create)) return null;
    failOpen(error);
  }
}

/** 这个卷上已经自测通过的进程内记录（按设备号）。 */
const VERIFIED_DEVICES = new Set<bigint>();

/**
 * 核对手里的句柄：普通文件、属主是当前用户、仍是路径现在指向的节点；路径被换过返回 false（调用方关掉
 * 重来）。首次用到一个卷时自测内核确实在执行这把锁。
 */
async function admitHeldHandle(handle: FileHandle, lockPath: string): Promise<boolean> {
  let held: Awaited<ReturnType<FileHandle["stat"]>>;
  let current: Awaited<ReturnType<typeof lstat>>;
  try {
    held = await handle.stat({ bigint: true });
    current = await lstat(lockPath, { bigint: true });
  } catch (error: unknown) {
    if (readNodeSystemErrorCode(error) === "ENOENT") return false;
    fail("operation-failure", "$lock", error);
  }
  if (!held.isFile() || ownedByAnotherUser(held.uid)) fail("unsafe-lock", "$lock");
  if (held.dev !== current.dev || held.ino !== current.ino) return false;
  if (!VERIFIED_DEVICES.has(held.dev)) {
    const second = await tryOpenLocked(lockPath, "exclusive", false);
    if (second !== null) {
      await second.close();
      fail("unsupported", "$lock");
    }
    VERIFIED_DEVICES.add(held.dev);
  }
  return true;
}

async function closeQuietly(handle: FileHandle): Promise<void> {
  try {
    await handle.close();
  } catch {
    // 关闭一个本进程打开的本地文件不会留下锁：句柄已经作废，内核在进程退出时收走其余的。
  }
}

async function waitBeforeRetry(
  options: Readonly<ParsedOptions>,
  deadline: MonotonicDeadline,
): Promise<void> {
  if (isMonotonicDeadlineReached(deadline, readMonotonicClock())) fail("timeout", "$lock");
  try {
    await delay(
      options.retryDelayMilliseconds,
      undefined,
      options.signal === undefined ? {} : { signal: options.signal },
    );
  } catch (error: unknown) {
    fail("aborted", "$signal", error);
  }
}

async function acquire(
  lockPath: string,
  mode: KernelFileLockMode,
  options: Readonly<ParsedOptions>,
): Promise<FileHandle> {
  const deadline = monotonicDeadlineAfter(
    readMonotonicClock(),
    monotonicDurationFromMilliseconds(options.acquireTimeoutMilliseconds),
  );
  for (;;) {
    if (options.signal?.aborted === true) fail("aborted", "$signal");
    const handle = await tryOpenLocked(lockPath, mode, true);
    if (handle !== null) {
      let admitted = false;
      try {
        admitted = await admitHeldHandle(handle, lockPath);
      } finally {
        if (!admitted) await closeQuietly(handle);
      }
      if (admitted) return handle;
    }
    await waitBeforeRetry(options, deadline);
  }
}

/** 一把已经拿到的锁；`release` 只在第一次调用时关闭句柄。 */
export interface KernelFileLockLease {
  release(): Promise<void>;
}

async function acquireLease(
  lockPath: string,
  mode: KernelFileLockMode,
  options: Readonly<ParsedOptions>,
): Promise<Readonly<KernelFileLockLease>> {
  const handle = await acquire(lockPath, mode, options);
  let released = false;
  return Object.freeze({
    async release() {
      if (released) return;
      released = true;
      await closeQuietly(handle);
    },
  });
}

/**
 * 拿到 `lockRef` 这把锁并把它交给调用方，由调用方稍后 `release`。只给需要让一把锁活过另一把锁的临界区
 * 的组合用（读写作用域的"门"与"作用域"）；别处用 `withKernelFileLock`。不做重入检查。
 */
export async function acquireKernelFileLock(
  root: RootedDirectory,
  lockRef: PortableResourcePath,
  mode: KernelFileLockMode,
  optionsValue?: KernelFileLockOptions,
): Promise<Readonly<KernelFileLockLease>> {
  if (mode !== "shared" && mode !== "exclusive") fail("input", "$mode");
  return acquireLease(lockPathOf(root, lockRef), mode, parseOptions(optionsValue));
}

/** 这条异步调用链此刻持有的锁文件路径。 */
const HELD_IN_CHAIN = new AsyncLocalStorage<ReadonlySet<string>>();
const NOTHING_HELD: ReadonlySet<string> = new Set();

/**
 * 在 `lockRef` 这把锁内执行 `operation`。`shared` 与别的共享持有者并存，`exclusive` 与任何持有者互斥。
 * 操作的结果或错误就是这次调用的结果；锁在操作结束时释放。
 */
export async function withKernelFileLock<Result>(
  root: RootedDirectory,
  lockRef: PortableResourcePath,
  mode: KernelFileLockMode,
  operation: () => Promise<Result>,
  optionsValue?: KernelFileLockOptions,
): Promise<Result> {
  if (mode !== "shared" && mode !== "exclusive") fail("input", "$mode");
  if (typeof operation !== "function" || types.isProxy(operation)) fail("input", "$operation");
  const options = parseOptions(optionsValue);
  const lockPath = lockPathOf(root, lockRef);
  const chain = HELD_IN_CHAIN.getStore() ?? NOTHING_HELD;
  if (chain.has(lockPath)) fail("reentered", "$lock");
  const lease = await acquireLease(lockPath, mode, options);
  try {
    return await HELD_IN_CHAIN.run(new Set([...chain, lockPath]), operation);
  } finally {
    await lease.release();
  }
}

/**
 * 建出锁文件（已在则什么都不改），不取得锁。初始化时把一组固定的锁文件一次建齐用：此后锁目录的内容
 * 不再变化。
 */
export async function ensureKernelFileLockFile(
  root: RootedDirectory,
  lockRef: PortableResourcePath,
): Promise<void> {
  const lockPath = lockPathOf(root, lockRef);
  let handle: FileHandle;
  try {
    handle = await filesystemMutation.openLockFile(
      lockPath,
      fileSystemConstants.O_RDONLY | fileSystemConstants.O_CREAT | fileSystemConstants.O_NOFOLLOW,
      LOCK_FILE_MODE,
    );
  } catch (error: unknown) {
    failOpen(error);
  }
  await closeQuietly(handle);
}

/**
 * 只读地问一次：这把锁此刻是否被独占持有。不创建锁文件，不写任何东西；锁文件不在即没有人持有。
 * 它自己短暂地持有一把共享锁，所以只适合从不以共享方式获取的锁（例如维护的门）。
 */
export async function isKernelFileLockHeldExclusively(
  root: RootedDirectory,
  lockRef: PortableResourcePath,
): Promise<boolean> {
  const lockPath = lockPathOf(root, lockRef);
  let existed = true;
  try {
    await lstat(lockPath);
  } catch (error: unknown) {
    if (readNodeSystemErrorCode(error) !== "ENOENT") fail("operation-failure", "$lock", error);
    existed = false;
  }
  if (!existed) return false;
  const handle = await tryOpenLocked(lockPath, "shared", false);
  if (handle === null) return true;
  await closeQuietly(handle);
  return false;
}
