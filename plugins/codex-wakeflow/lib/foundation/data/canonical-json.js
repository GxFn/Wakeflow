import canonicalize from "canonicalize";
import { encodeUtf8, Utf8Error, } from "../text/utf8.js";
import { hasPassiveJsonSerializationEnvironment, JsonValueError, parseJsonValue, } from "./json-value.js";
/**
 * Canonical JSON 适配层失败时返回的稳定错误。
 *
 * 输入错误保留 `json-value` 的中立原因和路径；第三方异常统一映射，不暴露依赖的
 * 消息、调用栈、原因链或成员值。
 */
export class CanonicalJsonError extends Error {
    name = "CanonicalJsonError";
    code = "wakeflow-canonical-json";
    reason;
    path;
    constructor(reason, path) {
        super(reason === "canonicalizer-failure"
            ? "The RFC 8785 canonicalizer failed for an admitted JSON value."
            : "The input is not an admitted JSON value.");
        this.reason = reason;
        this.path = path;
    }
}
function normalizeErrorPath(path) {
    return typeof path === "string" && path.length > 0 ? path : "$";
}
function fail(reason, path) {
    throw new CanonicalJsonError(reason, path);
}
function assertNoInheritedArrayToJson(path) {
    if (!hasPassiveJsonSerializationEnvironment()) {
        fail("canonicalizer-failure", path);
    }
}
function admittedJsonValue(value, path) {
    try {
        return parseJsonValue(value, path);
    }
    catch (error) {
        if (error instanceof JsonValueError) {
            fail(error.reason, error.path);
        }
        throw error;
    }
}
function canonicalizeAdmittedValue(value, path) {
    assertNoInheritedArrayToJson(path);
    try {
        const result = canonicalize(value);
        if (typeof result !== "string")
            fail("canonicalizer-failure", path);
        return result;
    }
    catch (error) {
        if (error instanceof CanonicalJsonError)
            throw error;
        fail("canonicalizer-failure", path);
    }
}
/**
 * 已准入的 JSON 和 RFC 8785 规范化器都不应产生不完整的 Unicode。即使内部不变量
 * 被破坏，函数仍将错误映射为本适配层失败，不向调用方泄漏 `Utf8Error`。
 */
function encodeCanonicalText(text, path) {
    try {
        return encodeUtf8(text, path);
    }
    catch (error) {
        if (error instanceof Utf8Error)
            fail("canonicalizer-failure", path);
        throw error;
    }
}
/**
 * 将任意输入规范化为 RFC 8785 JSON 文本。
 *
 * 每次调用都先重新完成 JSON 值准入；TypeScript 类型不能作为绕过运行时边界的
 * 授权。返回文本不含额外空白或末尾换行。
 */
export function canonicalizeJson(value, errorPath) {
    const basePath = normalizeErrorPath(errorPath);
    return canonicalizeAdmittedValue(admittedJsonValue(value, basePath), basePath);
}
/**
 * 将任意输入规范化为 RFC 8785 要求的 UTF-8 字节。
 *
 * 每次调用返回新的 Uint8Array；调用方可以持有或修改自己的字节副本。摘要、
 * 换行和文件编码继续由后续基础能力或领域编解码器显式组合。
 */
export function encodeCanonicalJson(value, errorPath) {
    const path = normalizeErrorPath(errorPath);
    return encodeCanonicalText(canonicalizeJson(value, path), path);
}
