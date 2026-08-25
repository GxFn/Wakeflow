import canonicalize from "canonicalize";

import {
  encodeUtf8,
  Utf8Error,
} from "../text/utf8.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
  type JsonValueErrorReason,
} from "./json-value.js";

/**
 * Wakeflow Foundation / Data：RFC 8785 JSON 规范化适配层。
 *
 * 本文件先通过 json-value 把任意进程内输入收敛为独立、递归冻结的 JSON 树，
 * 再把该可信值交给成熟 canonicalize 依赖。第三方库只拥有 JCS 排序与原始类型
 * 序列化；Wakeflow 继续拥有输入准入、稳定错误和 UTF-8 输出合同。
 *
 * 这里不提供第三方选项或跳过准入的快速入口，也不拥有 SHA-256、换行格式、
 * 领域字段关系、持久记录版本或摘要前缀。
 */

/** canonical JSON 失败分类；JSON 值原因保持原精度。 */
export type CanonicalJsonErrorReason =
  | JsonValueErrorReason
  | "canonicalizer-failure";

/**
 * canonical JSON 适配层的稳定错误。
 *
 * 输入错误保留 json-value 的中立 reason/path；第三方异常统一收敛，不暴露依赖
 * message、stack、cause 或成员值。
 */
export class CanonicalJsonError extends Error {
  override readonly name = "CanonicalJsonError";
  readonly code = "wakeflow-canonical-json" as const;
  readonly reason: CanonicalJsonErrorReason;
  readonly path: string;

  constructor(reason: CanonicalJsonErrorReason, path: string) {
    super(reason === "canonicalizer-failure"
      ? "The RFC 8785 canonicalizer failed for an admitted JSON value."
      : "The input is not an admitted JSON value.");
    this.reason = reason;
    this.path = path;
  }
}

function normalizeErrorPath(path: unknown): string {
  return typeof path === "string" && path.length > 0 ? path : "$";
}

function fail(reason: CanonicalJsonErrorReason, path: string): never {
  throw new CanonicalJsonError(reason, path);
}

function admittedJsonValue(value: unknown, path: string): JsonValue {
  try {
    return parseJsonValue(value, path);
  } catch (error: unknown) {
    if (error instanceof JsonValueError) {
      fail(error.reason, error.path);
    }
    throw error;
  }
}

function canonicalizeAdmittedValue(value: JsonValue, path: string): string {
  try {
    const result = canonicalize(value);
    if (typeof result !== "string") fail("canonicalizer-failure", path);
    return result;
  } catch (error: unknown) {
    if (error instanceof CanonicalJsonError) throw error;
    fail("canonicalizer-failure", path);
  }
}

/**
 * admitted JSON 与 RFC 8785 canonicalizer 都不应产生 ill-formed Unicode；若该
 * 内部不变量被破坏，仍收敛为本适配层失败，不把 Utf8Error 泄漏给调用方。
 */
function encodeCanonicalText(text: string, path: string): Uint8Array {
  try {
    return encodeUtf8(text, path);
  } catch (error: unknown) {
    if (error instanceof Utf8Error) fail("canonicalizer-failure", path);
    throw error;
  }
}

/**
 * 将任意输入规范化为 RFC 8785 JSON 文本。
 *
 * 每次调用都先重新完成 JSON 值准入；TypeScript 类型不能作为绕过运行时边界的
 * 授权。返回文本不含额外空白或末尾换行。
 */
export function canonicalizeJson(
  value: unknown,
  errorPath?: string,
): string {
  const basePath = normalizeErrorPath(errorPath);
  return canonicalizeAdmittedValue(admittedJsonValue(value, basePath), basePath);
}

/**
 * 将任意输入规范化为 RFC 8785 要求的 UTF-8 字节。
 *
 * 每次调用返回新的 Uint8Array；调用方可以持有或修改自己的字节副本。摘要、
 * 换行和文件编码继续由后续基础能力或领域 codec 显式组合。
 */
export function encodeCanonicalJson(
  value: unknown,
  errorPath?: string,
): Uint8Array {
  const path = normalizeErrorPath(errorPath);
  return encodeCanonicalText(canonicalizeJson(value, path), path);
}
