import { throwIfAborted } from "../node/abort-signal.js";
import { readMonotonicClock } from "../time/monotonic-clock.js";
import {
  isMonotonicDeadlineReached,
  type MonotonicDeadline,
  monotonicDeadlineAfter,
  monotonicDeadlineRemaining,
} from "../time/monotonic-deadline.js";
import { monotonicDurationFromMilliseconds } from "../time/monotonic-duration.js";
import {
  acquireKernelFileLock,
  KernelFileLockError,
  type KernelFileLockLease,
  type KernelFileLockMode,
} from "./kernel-file-lock.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import type { RootedDirectory } from "./rooted-directory.js";

/**
 * Wakeflow Foundation / Filesystem：跨进程的读写作用域，写者优先（ADR-0017，ADR-0033 决定 4）。
 *
 * 两把内核咨询锁，"门"与"作用域"：
 *
 * - 共享（普通操作）：对门拿共享、执行 `beforeEnter`、对作用域拿共享、放开门、执行操作、放开作用域。
 * - 独占（维护）：对门拿独占并一直持有、执行 `beforeEnter`、等作用域的独占拿到、执行操作、全部放开。
 *
 * 门被独占持有时新的共享者进不来，在场的共享者走完之后作用域的独占才拿得到，所以一个等待中的写者不会被
 * 源源不断的读者饿死。共享者拿着门的时候没有写者持有或等待作用域，那一步因此不会等。持有者死掉时内核
 * 收走它的锁，磁盘上没有要清理的东西。
 *
 * 业务意图不归这里管：`beforeEnter` 由调用方用来在准入被串行化的那一刻核对自己的保留条件。
 */

export type RootedReadWriteMode = "shared" | "exclusive";

export interface RootedReadWriteScopeLocks {
  readonly gate: PortableResourcePath;
  readonly scope: PortableResourcePath;
}

export interface RootedReadWriteScopeOptions {
  readonly signal?: AbortSignal;
  readonly acquireTimeoutMilliseconds?: number;
  /** A bounded owner-specific reservation check, called while admission is serialized. */
  readonly beforeEnter?: () => Promise<void>;
}

export class RootedReadWriteScopeError extends Error {
  override readonly name = "RootedReadWriteScopeError";
  readonly code = "rooted-read-write-scope";
  readonly path = "$scope";
  readonly reason: "input" | "unsafe" | "unsupported" | "timeout";
  constructor(reason: RootedReadWriteScopeError["reason"], options?: ErrorOptions) {
    super(`Read/write admission failed: ${reason}.`, options);
    this.reason = reason;
  }
}

const DEFAULT_ACQUIRE_TIMEOUT_MILLISECONDS = 30_000;

function fail(reason: RootedReadWriteScopeError["reason"], cause?: unknown): never {
  throw new RootedReadWriteScopeError(reason, cause === undefined ? undefined : { cause });
}

/** 锁原语的失败说成作用域的失败；别的错误原样上抛。 */
function failFromLock(error: unknown): never {
  if (!(error instanceof KernelFileLockError)) throw error;
  if (error.reason === "timeout" || error.reason === "unsupported") {
    fail(error.reason, error);
  }
  fail(error.reason === "input" ? "input" : "unsafe", error);
}

/** 在两次获取共用的期限之内拿一把锁。 */
async function acquireWithin(
  root: RootedDirectory,
  lockRef: PortableResourcePath,
  mode: KernelFileLockMode,
  deadline: MonotonicDeadline,
  signal: AbortSignal | undefined,
): Promise<Readonly<KernelFileLockLease>> {
  const now = readMonotonicClock();
  if (isMonotonicDeadlineReached(deadline, now)) fail("timeout");
  const remaining = monotonicDeadlineRemaining(deadline, now);
  try {
    return await acquireKernelFileLock(root, lockRef, mode, {
      acquireTimeoutMilliseconds: Math.max(1, Number((remaining + 999_999n) / 1_000_000n)),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    failFromLock(error);
  }
}

/**
 * 在读写作用域里执行 `operation`。操作的结果或错误就是这次调用的结果；准入失败报
 * `RootedReadWriteScopeError`，`beforeEnter` 的错误原样上抛。等待预算只是转交：两次获取共用的期限由
 * 单调时长的构造器准入，每一次获取的毫秒数由锁原语断言范围。
 */
export async function withRootedReadWriteScope<Result>(
  root: RootedDirectory,
  locks: Readonly<RootedReadWriteScopeLocks>,
  mode: RootedReadWriteMode,
  operation: () => Promise<Result>,
  options: RootedReadWriteScopeOptions = {},
): Promise<Result> {
  const {
    signal,
    acquireTimeoutMilliseconds = DEFAULT_ACQUIRE_TIMEOUT_MILLISECONDS,
    beforeEnter,
  } = options;
  throwIfAborted(signal);
  const deadline = monotonicDeadlineAfter(
    readMonotonicClock(),
    monotonicDurationFromMilliseconds(acquireTimeoutMilliseconds),
  );
  const gate = await acquireWithin(root, locks.gate, mode, deadline, signal);
  let scope: Readonly<KernelFileLockLease>;
  try {
    await beforeEnter?.();
    scope = await acquireWithin(root, locks.scope, mode, deadline, signal);
  } catch (error: unknown) {
    await gate.release();
    throw error;
  }
  // 共享者到这里就放开门；独占者留着它，新的共享者因此进不来。
  if (mode === "shared") await gate.release();
  try {
    return await operation();
  } finally {
    await scope.release();
    await gate.release();
  }
}
