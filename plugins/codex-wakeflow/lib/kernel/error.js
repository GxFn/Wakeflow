import { isWakeflowErrorCode, } from "../contracts/vocabulary/wakeflow-error-code.js";
import { readNodeSystemErrorCode } from "../foundation/node/node-system-error.js";
/**
 * Wakeflow Kernel / Error：整个运行时唯一的错误类型（ADR-0013 决定 D）。
 *
 * 一个错误由封闭错误码、短的 kebab-case 原因、结构路径和可重试标记组成，
 * 可选地附带少量短标识 `details`（例如恢复所需的 operationId）。
 * 这些字段都是稳定且可公开的：不含原始异常消息、绝对路径、句柄或用户文本；
 * `details` 的键与值都限定在短标识字符集内，写不进路径与自由文本。
 * 原始异常只保留在 `cause` 上供本地诊断，从不进入公共结果；唯一从 cause 链投影出来的是两个短
 * 记号（§13.165 G3）：第一个 Node 系统错误码（`EACCES`、`ENOSPC`…）为 `causeCode`，第一个内层
 * 错误的 kebab-case `reason` 为 `causeReason`。两者都不含路径与用户文本，是用户能据以行动的信息。
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
const CAUSE_CHAIN_MAXIMUM_DEPTH = 8;
function ownReasonToken(value) {
    const descriptor = Object.getOwnPropertyDescriptor(value, "reason");
    const reason = descriptor !== undefined && Object.hasOwn(descriptor, "value") ? descriptor.value : null;
    return typeof reason === "string" &&
        reason.length > 0 &&
        reason.length <= REASON_MAXIMUM_LENGTH &&
        REASON_PATTERN.test(reason)
        ? reason
        : null;
}
/**
 * 沿 cause 链（最多 8 层）取第一个 Node 系统错误码与第一个内层 `reason` 记号；两者都按词法核验，
 * 既不复制消息，也不读取访问器或原型字段。
 */
function causeChain(cause) {
    const chain = [];
    let current = cause;
    while (chain.length < CAUSE_CHAIN_MAXIMUM_DEPTH &&
        typeof current === "object" &&
        current !== null) {
        chain.push(current);
        try {
            current = current.cause;
        }
        catch {
            break;
        }
    }
    return chain;
}
function causeProjection(cause) {
    const chain = causeChain(cause);
    const causeCode = chain
        .map((node) => readNodeSystemErrorCode(node))
        .find((code) => code !== undefined);
    const causeReason = chain.map((node) => ownReasonToken(node)).find((reason) => reason !== null);
    return {
        ...(causeCode === undefined ? {} : { causeCode }),
        ...(causeReason === null || causeReason === undefined ? {} : { causeReason }),
    };
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
    /** 可进入公共结果与 MCP 错误信封的稳定字段：四个必有字段、details 与 cause 链的两个记号。 */
    toPublicDetails() {
        return Object.freeze({
            code: this.code,
            reason: this.reason,
            path: this.path,
            retryable: this.retryable,
            ...(this.details === null ? {} : { details: this.details }),
            ...causeProjection(this.cause),
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
 * 以阻塞项拒绝：第一个阻塞项冒号前的阻塞码是原因，全部阻塞项按 `blocker`、`blocker2`… 进入公开
 * details（至多 8 个）。details 的值只能是短标识，所以带别的字符的阻塞项（例如 Unicode 章节锚点
 * `section-anchor-unknown:性能约束`）只留下阻塞码（§13.131 审查）。
 */
export function failWithBlockers(blockers, path) {
    const first = blockers[0];
    if (first === undefined)
        fail("unexpected", "empty-blockers", path);
    const identifier = (blocker) => {
        if (DETAIL_VALUE_PATTERN.test(blocker))
            return blocker;
        const code = blocker.split(":")[0] ?? "";
        return DETAIL_VALUE_PATTERN.test(code) ? code : "blocker";
    };
    fail("precondition-failed", first.split(":")[0] ?? first, path, {
        details: Object.fromEntries(blockers
            .slice(0, DETAIL_MAXIMUM_ENTRIES)
            .map((blocker, index) => [
            index === 0 ? "blocker" : `blocker${index + 1}`,
            identifier(blocker),
        ])),
    });
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
