import { randomUUID } from "node:crypto";
import { computeSha256Hex } from "../crypto/sha256.js";
import { encodeUtf8 } from "../text/utf8.js";
/**
 * Wakeflow Foundation / Identity：规范化 UUIDv4 词法与生成。
 *
 * 本模块只负责 RFC 9562 UUID 版本 4 的基础标识能力：接受唯一的小写文本表示、
 * 授予 TypeScript 品牌类型，并通过 Node.js 密码学随机源创建新值。
 * 它不添加 Wakeflow 类型前缀、不判断集合唯一性，也不决定实体生命周期、引用
 * 存在性或业务权限。
 *
 * RFC 允许解析器接受大小写差异；Wakeflow 在持久化协议中主动收窄为小写形式，
 * 避免同一 UUID 出现多个文本别名。
 */
const UUID_V4_TEXT_LENGTH = 36;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ERROR_MESSAGES = {
    "format": "UUID v4 must be a canonical lowercase RFC 9562 UUID version 4 string.",
    "factory-type": "The UUID v4 factory must be a function.",
    "factory-failure": "The UUID v4 factory failed.",
    "factory-result": "The UUID v4 factory must return one canonical lowercase RFC 9562 UUID version 4 string.",
    "derivation-input": "UUID v4 derivation needs a non-empty namespace and NUL-free parts.",
};
/**
 * UUIDv4 词法与生成失败的稳定错误。
 *
 * 错误只暴露能力代码、失败分类和调用方结构路径；不会回显候选 UUID、生成源
 * 异常、调用栈或原因链。
 */
export class UuidV4Error extends Error {
    name = "UuidV4Error";
    code = "wakeflow-uuid-v4";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function normalizeErrorPath(path) {
    return typeof path === "string" && path.length > 0 ? path : "$";
}
function fail(reason, path) {
    throw new UuidV4Error(reason, path);
}
function isCanonicalUuidV4(value) {
    return (typeof value === "string"
        && value.length === UUID_V4_TEXT_LENGTH
        && UUID_V4_PATTERN.test(value));
}
/**
 * 严格解析规范化小写 UUIDv4，不执行字符串强制转换。
 *
 * 版本半字节必须为 `4`，变体高位必须为 RFC `10xx`。大写、空白、URN、花括号、
 * 其他 UUID 版本、NIL 和 MAX 都不会作为等价别名被接受。
 */
export function parseUuidV4(value, errorPath) {
    const path = normalizeErrorPath(errorPath);
    if (!isCanonicalUuidV4(value))
        fail("format", path);
    // 字符串已经通过完整词法、版本与变体校验；此处只恢复该事实的类型品牌。
    return value;
}
/**
 * 创建一个新的规范化 UUIDv4。
 *
 * 默认生成源是 Node.js `crypto.randomUUID()`。可注入生成源是明确的依赖注入点：
 * 函数恰好调用一次，异常统一映射，返回值仍须重新满足完整 UUIDv4 合同。
 */
export function createUuidV4(uuidFactory = randomUUID) {
    if (typeof uuidFactory !== "function") {
        fail("factory-type", "$uuidFactory");
    }
    let value;
    try {
        value = uuidFactory();
    }
    catch {
        fail("factory-failure", "$uuidFactory");
    }
    if (!isCanonicalUuidV4(value)) {
        fail("factory-result", "$uuidFactory");
    }
    return value;
}
/**
 * 由命名空间与若干片段确定性派生一个 UUID v4 形状的值。
 *
 * 同一命名空间与同一输入永远得到同一个 UUID，因此重试与重算不会造出第二个身份；
 * 输出仍满足版本位与变体位，与随机分配的 UUID 共用同一词法合同。
 */
export function deriveUuidV4(namespace, ...parts) {
    if (typeof namespace !== "string"
        || namespace.length === 0
        || namespace.includes("\u0000")
        || parts.some((part) => typeof part !== "string" || part.includes("\u0000"))) {
        fail("derivation-input", "$namespace");
    }
    const hex = computeSha256Hex(encodeUtf8([namespace, ...parts].join("\u0000")));
    const digits = hex.slice(0, 32).split("");
    digits[12] = "4";
    const variant = Number.parseInt(digits[16] ?? "0", 16);
    digits[16] = ((variant & 0x3) | 0x8).toString(16);
    const flat = digits.join("");
    return parseUuidV4([
        flat.slice(0, 8),
        flat.slice(8, 12),
        flat.slice(12, 16),
        flat.slice(16, 20),
        flat.slice(20, 32),
    ].join("-"), "$derived");
}
