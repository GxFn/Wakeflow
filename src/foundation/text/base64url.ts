import { types } from "node:util";

/**
 * Wakeflow Foundation / Text：canonical、无 padding 的 RFC 4648 base64url。
 *
 * 编码只消费 exact Uint8Array view；解码拒绝 padding、标准 base64 alphabet、空白、
 * 非 canonical 长度以及 Node Buffer 宽松接受的别名，并以 decode→encode round-trip
 * 证明唯一 spelling。本层不解释媒体类型、容量或领域 bytes。
 */

export type Base64UrlErrorReason = "bytes" | "text" | "format" | "decode";

const ERROR_MESSAGES = {
  "bytes": "Base64url input must be an exact Uint8Array view.",
  "text": "Base64url input must be a primitive well-formed string.",
  "format": "Base64url text must use the canonical unpadded URL alphabet.",
  "decode": "Base64url text could not be decoded exactly.",
} as const satisfies Readonly<Record<Base64UrlErrorReason, string>>;

export class Base64UrlError extends Error {
  override readonly name = "Base64UrlError";
  readonly code = "wakeflow-base64url" as const;
  readonly reason: Base64UrlErrorReason;
  readonly path: string;

  constructor(reason: Base64UrlErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/u;

function fail(reason: Base64UrlErrorReason, path: string): never {
  throw new Base64UrlError(reason, path);
}

function normalizedPath(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "$";
}

export function encodeBase64Url(
  value: Uint8Array,
  errorPath?: string,
): string {
  const path = normalizedPath(errorPath);
  if (
    !ArrayBuffer.isView(value)
    || !(value instanceof Uint8Array)
    || types.isProxy(value)
  ) {
    fail("bytes", path);
  }
  try {
    return Buffer.from(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    ).toString("base64url");
  } catch {
    fail("bytes", path);
  }
}

export function decodeBase64Url(
  value: string,
  errorPath?: string,
): Uint8Array {
  const path = normalizedPath(errorPath);
  if (typeof value !== "string" || !value.isWellFormed()) fail("text", path);
  if (
    !BASE64URL_PATTERN.test(value)
    || value.length % 4 === 1
  ) {
    fail("format", path);
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, "base64url");
  } catch {
    fail("decode", path);
  }
  if (decoded.toString("base64url") !== value) fail("format", path);
  return Uint8Array.from(decoded);
}
