import { parseUtcInstant, UtcInstantError, } from "./utc-instant.js";
const ERROR_MESSAGES = {
    "clock-type": "UTC wall clock must be a function.",
    "clock-failure": "UTC wall clock failed while reading the current time.",
    "clock-result": "UTC wall clock returned an invalid UTC instant.",
};
/**
 * UTC wall clock 来源或结果失败的稳定错误。
 *
 * 错误不会透传注入函数的消息、调用栈、原因链或返回值。领域职责所有者可以根据
 * 失败分类把错误映射为自己的记录或公共错误。
 */
export class UtcWallClockError extends Error {
    name = "UtcWallClockError";
    code = "wakeflow-utc-wall-clock";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new UtcWallClockError(reason, path);
}
/**
 * Node.js 系统墙上时钟的默认来源。
 *
 * `Date` 只生成当前 UTC 毫秒文本，最终仍交给 `utc-instant` 授予品牌类型。函数不
 * 缓存 `Date` 或上一次结果，因此每次调用都是一次新的系统时间观察。
 */
const systemUtcWallClock = () => (parseUtcInstant(new Date().toISOString(), "$systemUtcWallClock"));
/**
 * 读取一次 UTC 墙上时钟，并对可注入来源实行稳定错误映射和结果复验。
 *
 * 注入函数是明确允许执行的依赖；本函数恰好调用一次。有效但早于前次调用的
 * 结果会原样返回，严格递增策略必须由了解领域历史的职责所有者另行决定。
 */
export function readUtcWallClock(clock = systemUtcWallClock) {
    if (typeof clock !== "function")
        fail("clock-type", "$clock");
    let value;
    try {
        value = clock();
    }
    catch {
        fail("clock-failure", "$clock");
    }
    try {
        return parseUtcInstant(value, "$clockResult");
    }
    catch (error) {
        if (error instanceof UtcInstantError) {
            fail("clock-result", "$clockResult");
        }
        throw error;
    }
}
