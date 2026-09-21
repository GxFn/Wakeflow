import { isWakeflowErrorCode, } from "../contracts/vocabulary/wakeflow-error-code.js";
/**
 * Wakeflow Kernel / Error：整个运行时唯一的错误类型（ADR-0013 决定 D）。
 *
 * 一个错误由封闭错误码、短的 kebab-case 原因、结构路径和可重试标记组成，
 * 可选地附带少量短标识 `details`（例如恢复所需的 operationId）。
 * 这些字段都是稳定且可公开的：不含原始异常消息、绝对路径、句柄或用户文本；
 * `details` 的键与值都限定在短标识字符集内，写不进路径与自由文本。
 * 原始异常只保留在 `cause` 上供本地诊断，从不进入公共结果。
 */
const REASON_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const REASON_MAXIMUM_LENGTH = 64;
const PATH_PATTERN = /^\$[A-Za-z0-9_.[\]$/-]*$/u;
const PATH_MAXIMUM_LENGTH = 256;
const DETAIL_KEY_PATTERN = /^[a-z][A-Za-z0-9]{0,31}$/u;
const DETAIL_VALUE_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/u;
const DETAIL_MAXIMUM_ENTRIES = 8;
function assertDetails(details) {
    if (details === undefined)
        return null;
    if (typeof details !== "object" || details === null || Array.isArray(details)) {
        throw new TypeError("WakeflowError details must be a plain record.");
    }
    const entries = Object.entries(details);
    if (entries.length === 0)
        return null;
    if (entries.length > DETAIL_MAXIMUM_ENTRIES) {
        throw new TypeError("WakeflowError details carry too many entries.");
    }
    for (const [key, value] of entries) {
        if (!DETAIL_KEY_PATTERN.test(key) ||
            typeof value !== "string" ||
            !DETAIL_VALUE_PATTERN.test(value)) {
            throw new TypeError("WakeflowError details must map short camelCase keys to short identifier values.");
        }
    }
    return Object.freeze(Object.fromEntries(entries));
}
function assertReason(reason) {
    if (reason.length === 0 ||
        reason.length > REASON_MAXIMUM_LENGTH ||
        !REASON_PATTERN.test(reason)) {
        throw new TypeError("WakeflowError reason must be a short kebab-case token.");
    }
    return reason;
}
function assertPath(path) {
    if (path.length > PATH_MAXIMUM_LENGTH || !PATH_PATTERN.test(path)) {
        throw new TypeError("WakeflowError path must be a structural $-path.");
    }
    return path;
}
export class WakeflowError extends Error {
    name = "WakeflowError";
    code;
    reason;
    path;
    retryable;
    details;
    constructor(code, reason, path = "$", options = {}) {
        if (!isWakeflowErrorCode(code)) {
            throw new TypeError("WakeflowError code must come from the closed table.");
        }
        const admittedReason = assertReason(reason);
        const admittedPath = assertPath(path);
        const admittedDetails = assertDetails(options.details);
        super(`${code}: ${admittedReason} at ${admittedPath}`, {
            cause: options.cause,
        });
        this.code = code;
        this.reason = admittedReason;
        this.path = admittedPath;
        this.retryable = options.retryable === true;
        this.details = admittedDetails;
        Object.freeze(this);
    }
    /** 可进入公共结果与 MCP 错误信封的四个稳定字段。 */
    toPublicDetails() {
        return Object.freeze({
            code: this.code,
            reason: this.reason,
            path: this.path,
            retryable: this.retryable,
            ...(this.details === null ? {} : { details: this.details }),
        });
    }
}
export function isWakeflowError(value) {
    return value instanceof WakeflowError;
}
/** 抛出一个 `WakeflowError`；作为 `never` 表达式用在校验分支里。 */
export function fail(code, reason, path = "$", options = {}) {
    throw new WakeflowError(code, reason, path, options);
}
/**
 * 把任意异常收敛为 `WakeflowError`：已是内核错误则原样返回，否则包成
 * `unexpected`，原始异常只作为 `cause` 保留，消息不复制。
 */
export function toWakeflowError(error, path = "$") {
    if (isWakeflowError(error))
        return error;
    return new WakeflowError("unexpected", "unhandled", path, { cause: error });
}
