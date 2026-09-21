import { ByteCountError, MAX_SAFE_BYTE_COUNT, parseByteCount, } from "../numeric/byte-count.js";
const ERROR_MESSAGES = {
    "offset-range": "File byte offset must be a non-negative safe integer.",
    "length-range": "File byte range length must be a valid byte count.",
    "end-overflow": "File byte range end exceeds the safe integer range.",
};
/**
 * 文件字节区间的稳定错误。
 *
 * 错误只暴露分类与结构路径，不回显偏移量、长度或结束位置。
 */
export class FileByteRangeError extends Error {
    name = "FileByteRangeError";
    code = "wakeflow-file-byte-range";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function normalizeErrorPath(value, fallback) {
    return typeof value === "string" && value.length > 0 ? value : fallback;
}
function fieldPath(basePath, field) {
    return `${basePath}.${field}`;
}
function fail(reason, path) {
    throw new FileByteRangeError(reason, path);
}
function parseOffset(value, path) {
    if (typeof value !== "number"
        || !Number.isSafeInteger(value)
        || value < 0) {
        fail("offset-range", path);
    }
    return value;
}
function parseLength(value, path) {
    try {
        return parseByteCount(value, path);
    }
    catch (error) {
        if (error instanceof ByteCountError)
            fail("length-range", path);
        throw error;
    }
}
function rangeEnd(offset, length, path) {
    if (length > MAX_SAFE_BYTE_COUNT - offset) {
        fail("end-overflow", path);
    }
    return (offset + length);
}
function createRange(offsetValue, lengthValue, path) {
    const offset = parseOffset(offsetValue, fieldPath(path, "offset"));
    const length = parseLength(lengthValue, fieldPath(path, "length"));
    const endExclusive = rangeEnd(offset, length, path);
    return Object.freeze({ offset, length, endExclusive });
}
/** 严格解析文件绝对字节偏移量。 */
export function parseFileByteOffset(value, errorPath) {
    return parseOffset(value, normalizeErrorPath(errorPath, "$offset"));
}
/**
 * 从已声明语义的偏移量与长度创建半开区间，并重新验证两个品牌输入。
 */
export function createFileByteRange(offset, length, errorPath) {
    return createRange(offset, length, normalizeErrorPath(errorPath, "$range"));
}
