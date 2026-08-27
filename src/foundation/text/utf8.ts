import { TextDecoder, TextEncoder } from "node:util";

/**
 * Wakeflow Foundation / Text：无损、严格 UTF-8 字节边界。
 *
 * 本模块只在明确的 `Uint8Array` 字节与结构完整的 JavaScript 字符串之间转换。
 * 解码使用 WHATWG 严格模式，编码前拒绝孤立代理项；起始 UTF-8 BOM 保留为
 * `U+FEFF`，避免基础层静默改变原始字节含义。
 *
 * 文件读取、容量、BOM 接纳、Unicode 规范化、控制字符、换行符、JSON 和领域文本
 * 规则继续由了解具体持久化表示或记录合同的上层职责所有者决定。
 */

const UTF8_DECODER = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});
const UTF8_ENCODER = new TextEncoder();

/** UTF-8 转换失败的稳定分类。 */
export type Utf8ErrorReason =
  | "bytes-type"
  | "decode-failure"
  | "text-type"
  | "ill-formed-text"
  | "encode-failure";

const ERROR_MESSAGES = {
  "bytes-type": "UTF-8 input must be a Uint8Array byte sequence.",
  "decode-failure": "UTF-8 bytes are not a valid fatal UTF-8 sequence.",
  "text-type": "UTF-8 text input must be a primitive string.",
  "ill-formed-text": "UTF-8 text must not contain lone Unicode surrogates.",
  "encode-failure": "UTF-8 text encoding failed.",
} as const satisfies Readonly<Record<Utf8ErrorReason, string>>;

/**
 * UTF-8 解码或编码失败的稳定错误。
 *
 * 错误只暴露能力代码、失败分类和调用方路径，不回显字节、文本、替换字符或
 * `TextDecoder` 或 `TextEncoder` 的内部异常。
 */
export class Utf8Error extends Error {
  override readonly name = "Utf8Error";
  readonly code = "wakeflow-utf8" as const;
  readonly reason: Utf8ErrorReason;
  readonly path: string;

  constructor(reason: Utf8ErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function normalizeErrorPath(path: unknown): string {
  return typeof path === "string" && path.length > 0 ? path : "$";
}

function fail(reason: Utf8ErrorReason, path: string): never {
  throw new Utf8Error(reason, path);
}

function isUint8Array(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && value instanceof Uint8Array;
}

/**
 * 严格解码指定的字节视图，不执行字符替换或输入强制转换。
 *
 * `Buffer` 作为 `Uint8Array` 子类可以直接使用；带偏移量的视图只读取可见区间。
 * 解码器不使用流式模式，任何被截断的多字节序列都会在本次调用中失败。
 */
export function decodeUtf8(
  bytes: Uint8Array,
  errorPath?: string,
): string {
  const path = normalizeErrorPath(errorPath);
  if (!isUint8Array(bytes)) fail("bytes-type", path);

  try {
    return UTF8_DECODER.decode(bytes);
  } catch {
    fail("decode-failure", path);
  }
}

/**
 * 把结构完整的原始字符串编码为新的 UTF-8 `Uint8Array`。
 *
 * `TextEncoder` 按标准会把孤立代理项转换为 `U+FFFD`。本函数先使用 ES2024
 * `isWellFormed()` 拒绝该输入，防止 Wakeflow 在生成字节时静默改写文本。
 */
export function encodeUtf8(
  text: string,
  errorPath?: string,
): Uint8Array {
  const path = normalizeErrorPath(errorPath);
  if (typeof text !== "string") fail("text-type", path);
  if (!text.isWellFormed()) fail("ill-formed-text", path);

  try {
    return UTF8_ENCODER.encode(text);
  } catch {
    fail("encode-failure", path);
  }
}
