import { randomUUID } from "node:crypto";

/**
 * Wakeflow Foundation / Identity：规范化 UUIDv4 词法与生成。
 *
 * 本文件只拥有 RFC 9562 UUID version 4 的基础身份能力：接受唯一的 lowercase
 * 文本表示、授予 TypeScript 品牌类型，并通过 Node.js 密码学随机源创建新值。
 * 它不添加 Wakeflow 类型前缀、不判断集合唯一性，也不决定实体生命周期、引用
 * 存在性或业务权限。
 *
 * RFC 允许解析器接受大小写差异；Wakeflow 在持久协议中主动收窄为 lowercase，
 * 避免同一 UUID 出现多个文本别名。
 */

const UUID_V4_TEXT_LENGTH = 36;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

declare const UUID_V4_BRAND: unique symbol;

/** 已生成或严格解析的规范化 lowercase UUIDv4。 */
export type UuidV4 = string & {
  readonly [UUID_V4_BRAND]: "UuidV4";
};

/**
 * UUIDv4 的可注入生成源。
 *
 * 注入只用于确定性测试或明确替换随机源；返回类型仍会在运行时重新验证，不能
 * 依靠 TypeScript 声明绕过词法合同。
 */
export type UuidV4Factory = () => string;

/** UUIDv4 基础能力失败的稳定分类。 */
export type UuidV4ErrorReason =
  | "format"
  | "factory-type"
  | "factory-failure"
  | "factory-result";

const ERROR_MESSAGES = {
  "format": "UUID v4 must be a canonical lowercase RFC 9562 UUID version 4 string.",
  "factory-type": "The UUID v4 factory must be a function.",
  "factory-failure": "The UUID v4 factory failed.",
  "factory-result": "The UUID v4 factory must return one canonical lowercase RFC 9562 UUID version 4 string.",
} as const satisfies Readonly<Record<UuidV4ErrorReason, string>>;

/**
 * UUIDv4 词法与生成失败的稳定错误。
 *
 * 错误只暴露能力代码、失败分类和调用方结构路径；不会回显候选 UUID、生成源
 * 异常、stack 或 cause。
 */
export class UuidV4Error extends Error {
  override readonly name = "UuidV4Error";
  readonly code = "wakeflow-uuid-v4" as const;
  readonly reason: UuidV4ErrorReason;
  readonly path: string;

  constructor(reason: UuidV4ErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function normalizeErrorPath(path: unknown): string {
  return typeof path === "string" && path.length > 0 ? path : "$";
}

function fail(reason: UuidV4ErrorReason, path: string): never {
  throw new UuidV4Error(reason, path);
}

function isCanonicalUuidV4(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length === UUID_V4_TEXT_LENGTH
    && UUID_V4_PATTERN.test(value)
  );
}

/**
 * 严格解析规范化 lowercase UUIDv4，不执行字符串强制转换。
 *
 * version nibble 必须为 `4`，variant 高位必须为 RFC `10xx`；大写、空白、URN、
 * 花括号、其他 UUID version、NIL 和 MAX 都不会被当作等价别名接受。
 */
export function parseUuidV4(
  value: unknown,
  errorPath?: string,
): UuidV4 {
  const path = normalizeErrorPath(errorPath);
  if (!isCanonicalUuidV4(value)) fail("format", path);

  // 字符串已经通过完整词法、version 与 variant 校验，此处恢复该事实的类型品牌。
  return value as UuidV4;
}

/**
 * 创建一个新的规范化 UUIDv4。
 *
 * 默认生成源是 Node.js `crypto.randomUUID()`。可注入生成源是明确的可执行依赖
 * seam：调用恰好一次，其异常统一收敛，返回值仍必须重新满足完整 UUIDv4 合同。
 */
export function createUuidV4(
  uuidFactory: UuidV4Factory = randomUUID,
): UuidV4 {
  if (typeof uuidFactory !== "function") {
    fail("factory-type", "$uuidFactory");
  }

  let value: unknown;
  try {
    value = uuidFactory();
  } catch {
    fail("factory-failure", "$uuidFactory");
  }

  if (!isCanonicalUuidV4(value)) {
    fail("factory-result", "$uuidFactory");
  }
  return value as UuidV4;
}
