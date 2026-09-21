import { hrtime } from "node:process";
const ERROR_MESSAGES = {
    "clock-type": "Monotonic clock must be a function.",
    "clock-failure": "Monotonic clock failed while reading a moment.",
    "clock-result": "Monotonic clock must return non-negative nanoseconds as bigint.",
};
/**
 * monotonic clock 来源或结果失败的稳定错误。
 *
 * 错误不会透传注入函数的消息、调用栈、原因链或返回值，也不会把任意原点
 * 数值写入诊断文本。
 */
export class MonotonicClockError extends Error {
    name = "MonotonicClockError";
    code = "wakeflow-monotonic-clock";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new MonotonicClockError(reason, path);
}
/**
 * Node.js 默认单调时钟来源，其精度和原点由 `process.hrtime.bigint()` 决定。
 * 本函数不缓存或转换读数。
 */
const systemMonotonicClock = () => hrtime.bigint();
/**
 * 读取一次单调时钟，并把非负 `bigint` 授予 `MonotonicMoment` 品牌类型。
 *
 * 注入函数恰好调用一次；本层无法也不会凭单个读数证明多次调用的递增关系。
 */
export function readMonotonicClock(clock = systemMonotonicClock) {
    if (typeof clock !== "function")
        fail("clock-type", "$clock");
    let value;
    try {
        value = clock();
    }
    catch {
        fail("clock-failure", "$clock");
    }
    if (typeof value !== "bigint" || value < 0n) {
        fail("clock-result", "$clockResult");
    }
    return value;
}
