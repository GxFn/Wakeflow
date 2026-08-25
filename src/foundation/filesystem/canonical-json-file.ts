import { types } from "node:util";

import {
  canonicalizeJson,
  CanonicalJsonError,
  type CanonicalJsonErrorReason,
} from "../data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
  type JsonValueErrorReason,
} from "../data/json-value.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import type { Sha256Digest } from "../crypto/sha256.js";
import {
  ByteCountError,
  parseByteCount,
  type ByteCount,
} from "../numeric/byte-count.js";
import type { FileNodeSnapshot } from "./file-node-snapshot.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import type { RootedDirectory } from "./rooted-directory.js";
import { readStrictTextFile } from "./strict-text-file.js";

/**
 * Wakeflow Foundation / Filesystem：RFC 8785 canonical JSON 文件读取。
 *
 * 本文件把 StrictTextFile 的稳定 UTF-8 读取与 Data 层的 JSON 值准入、
 * canonicalize 组合成一个磁盘表示合同：无 BOM、只使用 LF、恰好一个末尾 LF，
 * 且 LF 前的全部文本必须逐字符等于该 JSON 值的 RFC 8785 表示。
 *
 * 它不会修复缩进、键顺序、数字拼写、重复键或换行，也不执行领域 Schema、版本、
 * 字段关系、签名或 authority 判断。文件系统和严格文本错误继续由下层能力拥有。
 */

export interface CanonicalJsonFileOptions {
  readonly maximumBytes: ByteCount;
  readonly signal?: AbortSignal;
}

/** 一次 canonical JSON 文件读取的冻结结果。digest 覆盖包含末尾 LF 的完整文件。 */
export interface CanonicalJsonFileResult {
  readonly resourcePath: PortableResourcePath;
  readonly node: Readonly<FileNodeSnapshot>;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
  readonly value: JsonValue;
}

/** canonical JSON 文件自身拥有的输入、JSON 与磁盘表示失败分类。 */
export type CanonicalJsonFileErrorReason =
  | "input"
  | "json-syntax"
  | "non-canonical"
  | JsonValueErrorReason
  | CanonicalJsonErrorReason;

/**
 * canonical JSON 文件 profile 的稳定错误。
 *
 * 错误只暴露分类和安全结构路径，不回显 resource path、文件文本、JSON 成员、
 * 摘要、解析器 message 或 canonicalize 依赖异常。
 */
export class CanonicalJsonFileError extends Error {
  override readonly name = "CanonicalJsonFileError";
  readonly code = "wakeflow-canonical-json-file" as const;
  readonly reason: CanonicalJsonFileErrorReason;
  readonly path: string;

  constructor(reason: CanonicalJsonFileErrorReason, path: string) {
    super(errorMessage(reason));
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedCanonicalJsonFileOptions {
  readonly maximumBytes: ByteCount;
  readonly signal: AbortSignal | undefined;
}

function errorMessage(reason: CanonicalJsonFileErrorReason): string {
  if (reason === "input") return "Canonical JSON file options are invalid.";
  if (reason === "json-syntax") return "Canonical JSON file syntax is invalid.";
  if (reason === "non-canonical") {
    return "JSON file bytes do not use the required canonical representation.";
  }
  if (reason === "canonicalizer-failure") {
    return "Canonical JSON serialization failed after JSON value admission.";
  }
  return "Decoded JSON does not satisfy the Wakeflow JSON value constraints.";
}

function fail(
  reason: CanonicalJsonFileErrorReason,
  path: string,
): never {
  throw new CanonicalJsonFileError(reason, path);
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal
  );
}

function parseOptions(value: unknown): ParsedCanonicalJsonFileOptions {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }

  const allowed = new Set(["maximumBytes", "signal"]);
  if (
    !Object.hasOwn(record, "maximumBytes")
    || Object.keys(record).some((key) => !allowed.has(key))
  ) {
    fail("input", "$options");
  }

  let maximumBytes: ByteCount;
  try {
    maximumBytes = parseByteCount(
      record.maximumBytes,
      "$options.maximumBytes",
    );
  } catch (error: unknown) {
    if (error instanceof ByteCountError) {
      fail("input", "$options.maximumBytes");
    }
    throw error;
  }

  if (record.signal !== undefined && !isAbortSignal(record.signal)) {
    fail("input", "$options.signal");
  }
  return Object.freeze({ maximumBytes, signal: record.signal });
}

function parseJsonDocument(text: string): JsonValue {
  const documentText = text.slice(0, -1);
  let decoded: unknown;
  try {
    decoded = JSON.parse(documentText) as unknown;
  } catch {
    fail("json-syntax", "$document");
  }

  try {
    return parseJsonValue(decoded, "$document");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail(error.reason, error.path);
    throw error;
  }
}

function canonicalTextFor(value: JsonValue): string {
  try {
    return canonicalizeJson(value, "$document");
  } catch (error: unknown) {
    if (error instanceof CanonicalJsonError) {
      fail(error.reason, error.path);
    }
    throw error;
  }
}

/**
 * 稳定读取一个严格 canonical JSON 文件，并返回解除别名、递归冻结的 JSON 树。
 *
 * 文件固定采用 `canonical JSON + "\\n"`。比较发生在完整文本上，因此 JSON.parse
 * 可接受但不属于 canonical 表示的额外空白、重复键和非规范数字拼写都会失败。
 */
export async function readCanonicalJsonFile(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  options: CanonicalJsonFileOptions,
): Promise<Readonly<CanonicalJsonFileResult>> {
  const parsed = parseOptions(options);
  const strictOptions = parsed.signal === undefined
    ? {
        maximumBytes: parsed.maximumBytes,
        bom: "reject" as const,
        lineEndings: "lf" as const,
        finalNewline: "required" as const,
        empty: "forbid" as const,
      }
    : {
        maximumBytes: parsed.maximumBytes,
        bom: "reject" as const,
        lineEndings: "lf" as const,
        finalNewline: "required" as const,
        empty: "forbid" as const,
        signal: parsed.signal,
      };
  const strict = await readStrictTextFile(root, resourcePath, strictOptions);
  const value = parseJsonDocument(strict.text);
  const expectedText = `${canonicalTextFor(value)}\n`;
  if (strict.text !== expectedText) fail("non-canonical", "$document");

  return Object.freeze({
    resourcePath: strict.resourcePath,
    node: strict.node,
    byteCount: strict.byteCount,
    digest: strict.digest,
    value,
  });
}
