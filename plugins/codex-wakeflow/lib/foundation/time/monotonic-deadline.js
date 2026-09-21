const ERROR_MESSAGES = {
    "moment-type": "Monotonic moment must be non-negative nanoseconds as bigint.",
    "duration-type": "Monotonic duration must be non-negative nanoseconds as bigint.",
    "deadline-type": "Monotonic deadline must be non-negative nanoseconds as bigint.",
};
/**
 * 截止时刻构造或查询输入失败时返回的稳定错误。
 *
 * 错误只暴露能力代码、失败分类和参数路径，不回显原点、时刻、截止时刻或时长数值。
 */
export class MonotonicDeadlineError extends Error {
    name = "MonotonicDeadlineError";
    code = "wakeflow-monotonic-deadline";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new MonotonicDeadlineError(reason, path);
}
function parseNonNegativeBigint(value, reason, path) {
    if (typeof value !== "bigint" || value < 0n)
        fail(reason, path);
    return value;
}
/**
 * 从 `start` 和 `duration` 构造精确截止时刻。
 *
 * 零时长合法并产生立即到期的截止时刻；`bigint` 加法不会产生 `number` 溢出。
 */
export function monotonicDeadlineAfter(start, duration) {
    const startNanoseconds = parseNonNegativeBigint(start, "moment-type", "$start");
    const durationNanoseconds = parseNonNegativeBigint(duration, "duration-type", "$duration");
    return (startNanoseconds + durationNanoseconds);
}
/** `now` 等于或晚于截止时刻时返回 `true`；本函数不读取时钟。 */
export function isMonotonicDeadlineReached(deadline, now) {
    const deadlineNanoseconds = parseNonNegativeBigint(deadline, "deadline-type", "$deadline");
    const nowNanoseconds = parseNonNegativeBigint(now, "moment-type", "$now");
    return nowNanoseconds >= deadlineNanoseconds;
}
/**
 * 返回 `now` 到截止时刻的精确剩余时长；已经到期时固定返回零。
 *
 * 归零只表达“无需继续等待”，不决定调用方应报错、重试还是执行下一动作。
 */
export function monotonicDeadlineRemaining(deadline, now) {
    const deadlineNanoseconds = parseNonNegativeBigint(deadline, "deadline-type", "$deadline");
    const nowNanoseconds = parseNonNegativeBigint(now, "moment-type", "$now");
    return (nowNanoseconds >= deadlineNanoseconds
        ? 0n
        : deadlineNanoseconds - nowNanoseconds);
}
