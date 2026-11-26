import { types } from "node:util";
import { parsePlainRecord } from "../data/passive-own-data.js";
import { readMonotonicClock } from "../time/monotonic-clock.js";
import { isMonotonicDeadlineReached, monotonicDeadlineAfter, monotonicDeadlineRemaining, } from "../time/monotonic-deadline.js";
import { monotonicDurationFromMilliseconds } from "../time/monotonic-duration.js";
import { acquireKernelFileLock, KernelFileLockError, } from "./kernel-file-lock.js";
export class RootedReadWriteScopeError extends Error {
    name = "RootedReadWriteScopeError";
    code = "rooted-read-write-scope";
    path = "$scope";
    reason;
    constructor(reason, options) {
        super(`Read/write admission failed: ${reason}.`, options);
        this.reason = reason;
    }
}
const DEFAULT_ACQUIRE_TIMEOUT_MILLISECONDS = 30_000;
const MAXIMUM_ACQUIRE_TIMEOUT_MILLISECONDS = 300_000;
function fail(reason, cause) {
    throw new RootedReadWriteScopeError(reason, cause === undefined ? undefined : { cause });
}
function optionsOf(value) {
    const record = parsePlainRecord(value, "$options");
    if (Object.keys(record).some((key) => !["signal", "acquireTimeoutMilliseconds", "beforeEnter"].includes(key)))
        fail("input");
    const budget = record.acquireTimeoutMilliseconds ?? DEFAULT_ACQUIRE_TIMEOUT_MILLISECONDS;
    if (typeof budget !== "number" ||
        !Number.isSafeInteger(budget) ||
        budget <= 0 ||
        budget > MAXIMUM_ACQUIRE_TIMEOUT_MILLISECONDS)
        fail("input");
    if (record.signal !== undefined &&
        (types.isProxy(record.signal) || !(record.signal instanceof AbortSignal)))
        fail("input");
    if (record.beforeEnter !== undefined &&
        (typeof record.beforeEnter !== "function" || types.isProxy(record.beforeEnter)))
        fail("input");
    return {
        acquireTimeoutMilliseconds: budget,
        ...(record.signal === undefined ? {} : { signal: record.signal }),
        ...(record.beforeEnter === undefined
            ? {}
            : { beforeEnter: record.beforeEnter }),
    };
}
/** 锁原语的失败说成作用域的失败；别的错误原样上抛。 */
function failFromLock(error) {
    if (!(error instanceof KernelFileLockError))
        throw error;
    if (error.reason === "timeout" || error.reason === "aborted" || error.reason === "unsupported") {
        fail(error.reason, error);
    }
    fail(error.reason === "input" ? "input" : "unsafe", error);
}
/** 在两次获取共用的期限之内拿一把锁。 */
async function acquireWithin(root, lockRef, mode, deadline, signal) {
    const now = readMonotonicClock();
    if (isMonotonicDeadlineReached(deadline, now))
        fail("timeout");
    const remaining = monotonicDeadlineRemaining(deadline, now);
    try {
        return await acquireKernelFileLock(root, lockRef, mode, {
            acquireTimeoutMilliseconds: Math.max(1, Number((remaining + 999999n) / 1000000n)),
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        failFromLock(error);
    }
}
/**
 * 在读写作用域里执行 `operation`。操作的结果或错误就是这次调用的结果；准入失败报
 * `RootedReadWriteScopeError`，`beforeEnter` 的错误原样上抛。
 */
export async function withRootedReadWriteScope(root, locks, mode, operation, value = {}) {
    if ((mode !== "shared" && mode !== "exclusive") ||
        typeof operation !== "function" ||
        types.isProxy(operation))
        fail("input");
    const options = optionsOf(value);
    if (options.signal?.aborted === true)
        fail("aborted");
    const deadline = monotonicDeadlineAfter(readMonotonicClock(), monotonicDurationFromMilliseconds(options.acquireTimeoutMilliseconds));
    const gate = await acquireWithin(root, locks.gate, mode, deadline, options.signal);
    let scope;
    try {
        await options.beforeEnter?.();
        scope = await acquireWithin(root, locks.scope, mode, deadline, options.signal);
    }
    catch (error) {
        await gate.release();
        throw error;
    }
    // 共享者到这里就放开门；独占者留着它，新的共享者因此进不来。
    if (mode === "shared")
        await gate.release();
    try {
        return await operation();
    }
    finally {
        await scope.release();
        await gate.release();
    }
}
