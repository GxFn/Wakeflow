import { encodeCanonicalJson } from "../foundation/data/canonical-json.js";
import { fail } from "./error.js";
/**
 * Wakeflow Kernel / Limits：公共请求与结果、投递 prompt 字符数和分页条目数的上限表
 *（ADR-0013 决定 C 与节点评估 C3）。
 *
 * 每个上限以用途命名而不是以工具命名。hook 观察记录、活动投影与 hook 目录等存储上限
 * 由各自的所有者模块定义，不在此表中。
 * 字节上限按规范 JSON 编码后的字节数度量，字符上限按 UTF-16 码元数度量。
 */
export const WAKEFLOW_LIMITS = Object.freeze({
    /** 公共工具请求的规范 JSON 字节数。 */
    publicRequestBytes: 2 * 1024 * 1024,
    /**
     * 公共工具结果的规范 JSON 字节数。过渡值：现有效果型 preview 仍回显整份计划，
     * ADR-0004 的 planRef 在 L1 落地后降为 4 MiB。
     */
    publicResultBytes: 24 * 1024 * 1024,
    /** 投递 prompt 与回调正文的字符数。 */
    promptCharacters: 65_536,
    /** 分页读取一页的最大条目数。 */
    listPageItems: 256,
});
/** 失败原因必须是 kebab-case 记号；字节上限名到原因的映射是显式的。 */
const BYTE_LIMIT_REASONS = Object.freeze({
    publicRequestBytes: "public-request-bytes",
    publicResultBytes: "public-result-bytes",
});
/** 度量一个已准入 JSON 值的规范编码字节数。 */
export function measureCanonicalBytes(value, path = "$") {
    return encodeCanonicalJson(value, path).byteLength;
}
/** 规范 JSON 字节数超过命名上限即以 `capacity-exceeded` 失败。 */
export function assertWithinByteLimit(value, limit, path = "$") {
    if (measureCanonicalBytes(value, path) > WAKEFLOW_LIMITS[limit]) {
        fail("capacity-exceeded", BYTE_LIMIT_REASONS[limit], path);
    }
}
/** 已编码的规范 JSON 文本超过字节上限即以 `output-boundary` 失败；用于公共边界。 */
export function assertCanonicalTextWithinLimit(text, limit, path = "$") {
    if (Buffer.byteLength(text, "utf8") > WAKEFLOW_LIMITS[limit]) {
        fail("output-boundary", BYTE_LIMIT_REASONS[limit], path);
    }
}
/** 文本字符数超过命名上限即以 `capacity-exceeded` 失败。 */
export function assertWithinCharacterLimit(text, limit, path = "$") {
    if (text.length > WAKEFLOW_LIMITS[limit]) {
        fail("capacity-exceeded", "prompt-characters", path);
    }
}
/** 条目数超过命名上限即以 `capacity-exceeded` 失败。 */
export function assertWithinItemLimit(count, limit, path = "$") {
    if (!Number.isSafeInteger(count) || count < 0) {
        fail("invalid-request", "count-not-integer", path);
    }
    if (count > WAKEFLOW_LIMITS[limit]) {
        fail("capacity-exceeded", "list-page-items", path);
    }
}
