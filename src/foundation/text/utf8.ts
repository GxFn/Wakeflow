import { TextDecoder, TextEncoder } from "node:util";

/**
 * Wakeflow Foundation / Text：无损、严格 UTF-8 字节边界。
 *
 * 本文件只在明确的 Uint8Array 字节与 well-formed JavaScript string 之间转换。
 * 解码使用 WHATWG fatal 模式，编码前拒绝 lone surrogate；初始 UTF-8 BOM 被保留
 * 为 U+FEFF，避免基础层静默改变原始字节含义。
 *
 * 文件读取、容量、BOM 接纳、Unicode normalization、control/newline、JSON 和
 * 领域文本规则继续由了解具体 wire/record 合同的上层 owner 决定。
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
 * TextDecoder/TextEncoder 内部异常。
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
 * 严格解码准确的字节视图，不执行字符串替换或输入强制转换。
 *
 * Buffer 作为 Uint8Array 子类自然接受；offset view 只读取其可见区间。decoder
 * 不使用 streaming，任何截断多字节序列都会在本次调用内失败。
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
 * 把 well-formed primitive string 编码为新的 UTF-8 Uint8Array。
 *
 * TextEncoder 按标准会把 lone surrogate 转成 U+FFFD；这里先用 ES2024
 * isWellFormed() 拒绝，防止 Wakeflow 在生成字节时静默改写文本。
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
