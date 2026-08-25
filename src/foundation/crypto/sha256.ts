import { createHash } from "node:crypto";

/**
 * Wakeflow Foundation / Crypto：SHA-256 字节摘要与词法合同。
 *
 * 本文件只对明确的 Uint8Array 字节序列计算 SHA-256，并统一 Wakeflow 已使用的
 * lowercase hex 与 `sha256:<hex>` 两种完整表示。它不隐式编码字符串、不读取
 * 文件、不规范化 JSON，也不把摘要解释为授权、签名或真实性证明。
 *
 * 截断摘要的长度与碰撞风险继续由使用它的领域 owner 决定；本基础能力只生成
 * 和解析完整 256-bit 摘要。
 */

/** SHA-256 lowercase hexadecimal payload 的固定字符数。 */
export const SHA256_HEX_LENGTH = 64;

/** Wakeflow 持久摘要使用的算法前缀。 */
export const SHA256_DIGEST_PREFIX = "sha256:" as const;

const SHA256_HEX_PATTERN = new RegExp(
  `^[0-9a-f]{${SHA256_HEX_LENGTH}}$`,
  "u",
);
const SHA256_DIGEST_PATTERN = new RegExp(
  `^${SHA256_DIGEST_PREFIX}[0-9a-f]{${SHA256_HEX_LENGTH}}$`,
  "u",
);

declare const SHA256_HEX_BRAND: unique symbol;
declare const SHA256_DIGEST_BRAND: unique symbol;

/** 已计算或严格解析的完整 lowercase SHA-256 hex。 */
export type Sha256Hex = string & {
  readonly [SHA256_HEX_BRAND]: "Sha256Hex";
};

/** 已计算或严格解析的 `sha256:<64 lowercase hex>` 摘要。 */
export type Sha256Digest = `sha256:${string}` & {
  readonly [SHA256_DIGEST_BRAND]: "Sha256Digest";
};

/** SHA-256 基础能力失败的稳定分类。 */
export type Sha256ErrorReason =
  | "input-type"
  | "hash-failure"
  | "hex-format"
  | "digest-format";

const ERROR_MESSAGES = {
  "input-type": "SHA-256 input must be a Uint8Array byte sequence.",
  "hash-failure": "The Node.js SHA-256 operation failed.",
  "hex-format": `SHA-256 hex must contain exactly ${SHA256_HEX_LENGTH} lowercase hexadecimal characters.`,
  "digest-format": `SHA-256 digest must match ${SHA256_DIGEST_PREFIX}<${SHA256_HEX_LENGTH} lowercase hexadecimal characters>.`,
} as const satisfies Readonly<Record<Sha256ErrorReason, string>>;

/**
 * SHA-256 字节摘要与词法解析的稳定错误。
 *
 * 错误只暴露能力代码、失败分类和调用方结构路径；不回显输入、Node/OpenSSL
 * message、stack 或 cause。
 */
export class Sha256Error extends Error {
  override readonly name = "Sha256Error";
  readonly code = "wakeflow-sha256" as const;
  readonly reason: Sha256ErrorReason;
  readonly path: string;

  constructor(reason: Sha256ErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function normalizeErrorPath(path: unknown): string {
  return typeof path === "string" && path.length > 0 ? path : "$";
}

function fail(reason: Sha256ErrorReason, path: string): never {
  throw new Sha256Error(reason, path);
}

function isUint8Array(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && value instanceof Uint8Array;
}

/**
 * 对准确的字节视图计算完整 lowercase SHA-256 hex。
 *
 * Buffer 作为 Uint8Array 子类自然被接受；字符串、ArrayBuffer、DataView 和其他
 * TypedArray 必须由调用方先显式转换。计算同步完成，不修改输入视图。
 */
export function computeSha256Hex(
  bytes: Uint8Array,
  errorPath?: string,
): Sha256Hex {
  const path = normalizeErrorPath(errorPath);
  if (!isUint8Array(bytes)) fail("input-type", path);

  let result: string;
  try {
    result = createHash("sha256").update(bytes).digest("hex");
  } catch {
    fail("hash-failure", path);
  }
  if (!SHA256_HEX_PATTERN.test(result)) fail("hash-failure", path);

  // Node 返回值已经通过固定长度与 lowercase 词法验证，此处恢复该验证事实的类型品牌。
  return result as Sha256Hex;
}

/** 对准确的字节视图计算 `sha256:<hex>` 完整摘要。 */
export function computeSha256Digest(
  bytes: Uint8Array,
  errorPath?: string,
): Sha256Digest {
  const hex = computeSha256Hex(bytes, errorPath);
  return `${SHA256_DIGEST_PREFIX}${hex}` as Sha256Digest;
}

/** 严格解析完整 lowercase SHA-256 hex，不执行字符串强制转换。 */
export function parseSha256Hex(
  value: unknown,
  errorPath?: string,
): Sha256Hex {
  const path = normalizeErrorPath(errorPath);
  if (typeof value !== "string" || !SHA256_HEX_PATTERN.test(value)) {
    fail("hex-format", path);
  }
  return value as Sha256Hex;
}

/** 严格解析 `sha256:<64 lowercase hex>`，不接受别名、大小写或空白漂移。 */
export function parseSha256Digest(
  value: unknown,
  errorPath?: string,
): Sha256Digest {
  const path = normalizeErrorPath(errorPath);
  if (typeof value !== "string" || !SHA256_DIGEST_PATTERN.test(value)) {
    fail("digest-format", path);
  }
  return value as Sha256Digest;
}
