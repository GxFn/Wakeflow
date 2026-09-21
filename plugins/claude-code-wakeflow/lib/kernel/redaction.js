import { fail } from "./error.js";
/**
 * Wakeflow Kernel / Redaction：公共输出的私有值边界（ADR-0013 决定 C，节点评估 C3）。
 *
 * 边界由一组"绝不能出现在公共输出里的字符串"构成：工作区根的词法路径与 realpath、
 * ledger 根、宿主运行时根、用户 home、全部已登记的宿主句柄值。扫描是纯函数，只看
 * 已准入的 JSON 值；命中只报告结构路径，从不回显命中的文本。
 */
const MINIMUM_PRIVATE_VALUE_LENGTH = 2;
/** 建立边界；短于两个字符的值被忽略，避免把 `/` 这样的值当作私有。 */
export function createRedactionBoundary(values) {
    const admitted = new Set();
    for (const value of values) {
        if (typeof value === "string" && value.length >= MINIMUM_PRIVATE_VALUE_LENGTH) {
            admitted.add(value);
        }
    }
    return Object.freeze({ privateValues: admitted });
}
export function mergeRedactionBoundaries(...boundaries) {
    return createRedactionBoundary(boundaries.flatMap((boundary) => [...boundary.privateValues]));
}
function isJsonArray(value) {
    return Array.isArray(value);
}
function findPrivateString(value, boundary, path) {
    for (const privateValue of boundary.privateValues) {
        if (value.includes(privateValue))
            return path;
    }
    return null;
}
function findPrivateInArray(value, boundary, path) {
    for (let index = 0; index < value.length; index += 1) {
        const entry = value[index];
        if (entry === undefined)
            continue;
        const hit = findPrivateText(entry, boundary, `${path}[${index}]`);
        if (hit !== null)
            return hit;
    }
    return null;
}
function findPrivateInObject(record, boundary, path) {
    for (const key of Object.keys(record)) {
        const keyHit = findPrivateString(key, boundary, `${path}.${key}`);
        if (keyHit !== null)
            return keyHit;
        const entry = record[key];
        if (entry === undefined)
            continue;
        const hit = findPrivateText(entry, boundary, `${path}.${key}`);
        if (hit !== null)
            return hit;
    }
    return null;
}
function findPrivateText(value, boundary, path) {
    if (typeof value === "string")
        return findPrivateString(value, boundary, path);
    if (value === null || typeof value !== "object")
        return null;
    return isJsonArray(value)
        ? findPrivateInArray(value, boundary, path)
        : findPrivateInObject(value, boundary, path);
}
/** 返回第一个含私有值的结构路径，没有则返回 null。 */
export function locatePrivateText(value, boundary, path = "$") {
    return findPrivateText(value, boundary, path);
}
export function containsPrivateText(value, boundary) {
    return findPrivateText(value, boundary, "$") !== null;
}
/** 公共输出含私有值即以 `output-boundary` 失败，路径指向命中的结构位置。 */
export function assertPublicJson(value, boundary, path = "$") {
    const hit = findPrivateText(value, boundary, path);
    if (hit !== null) {
        fail("output-boundary", "private-value", sanitizePath(hit));
    }
}
/** 请求里出现私有值即以 `privacy-violation` 失败。 */
export function assertRequestFreeOfPrivateText(value, boundary, path = "$") {
    const hit = findPrivateText(value, boundary, path);
    if (hit !== null) {
        fail("privacy-violation", "private-value", sanitizePath(hit));
    }
}
/** 结构路径里的对象键可能含任意字符；只保留 `WakeflowError.path` 允许的字符集。 */
function sanitizePath(path) {
    const sanitized = path.replace(/[^A-Za-z0-9_.[\]$-]/gu, "_");
    return sanitized.length > 256 ? sanitized.slice(0, 256) : sanitized;
}
