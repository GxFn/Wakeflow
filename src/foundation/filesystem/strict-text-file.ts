import { types } from "node:util";

import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import {
  ByteCountError,
  parseByteCount,
  type ByteCount,
} from "../numeric/byte-count.js";
import {
  decodeUtf8,
  Utf8Error,
} from "../text/utf8.js";
import type { Sha256Digest } from "../crypto/sha256.js";
import type { FileNodeSnapshot } from "./file-node-snapshot.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import type { RootedDirectory } from "./rooted-directory.js";
import { readStableFile } from "./stable-file-read.js";

/**
 * Wakeflow Foundation / Filesystem：稳定文件字节上的严格文本 profile。
 *
 * 本文件组合 StableFileRead 与 fatal UTF-8 解码，并按调用方显式 profile 检查
 * 初始 BOM、line ending、最终换行和空文本。它从不规范化换行、自动添加尾换行
 * 或替换非法 Unicode，也不解析 JSON、JSONL、Markdown 或领域 marker。
 *
 * 文件路径、容量、竞态、节点类型和 Abort 失败继续保持 StableFileReadError；
 * 本能力只拥有 options 准入与文本形态错误。
 */

export type TextBomPolicy = "reject" | "preserve" | "strip";
export type TextLineEndingPolicy = "preserve" | "lf" | "crlf";
export type TextFinalNewlinePolicy = "optional" | "required" | "forbidden";
export type TextEmptyPolicy = "allow" | "forbid";
export type ObservedTextLineEndings = "none" | "lf" | "crlf" | "mixed";

export interface StrictTextFileOptions {
  readonly maximumBytes: ByteCount;
  readonly bom: TextBomPolicy;
  readonly lineEndings: TextLineEndingPolicy;
  readonly finalNewline: TextFinalNewlinePolicy;
  readonly empty: TextEmptyPolicy;
  readonly signal?: AbortSignal;
}

/** 一次严格文本读取的冻结结果；text 保持 profile 指定的 BOM 形态。 */
export interface StrictTextFileResult {
  readonly resourcePath: PortableResourcePath;
  readonly node: Readonly<FileNodeSnapshot>;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
  readonly text: string;
  readonly bom: "present" | "absent";
  readonly lineEndings: ObservedTextLineEndings;
  readonly hasFinalNewline: boolean;
}

/** strict text profile 失败的稳定分类。 */
export type StrictTextFileErrorReason =
  | "input"
  | "utf8"
  | "bom"
  | "line-endings"
  | "final-newline"
  | "empty";

const ERROR_MESSAGES = {
  "input": "Strict text file options are invalid.",
  "utf8": "Strict text file must contain valid fatal UTF-8.",
  "bom": "Strict text file does not satisfy its initial BOM policy.",
  "line-endings": "Strict text file does not satisfy its line-ending policy.",
  "final-newline": "Strict text file does not satisfy its final-newline policy.",
  "empty": "Strict text file cannot be empty under its selected profile.",
} as const satisfies Readonly<Record<StrictTextFileErrorReason, string>>;

/**
 * strict text options、编码或文本形态失败的稳定错误。
 *
 * 错误不回显文本、BOM 后内容、文件路径、字节、摘要或 lower-layer cause。
 */
export class StrictTextFileError extends Error {
  override readonly name = "StrictTextFileError";
  readonly code = "wakeflow-strict-text-file" as const;
  readonly reason: StrictTextFileErrorReason;
  readonly path: string;

  constructor(reason: StrictTextFileErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedStrictTextFileOptions {
  readonly maximumBytes: ByteCount;
  readonly bom: TextBomPolicy;
  readonly lineEndings: TextLineEndingPolicy;
  readonly finalNewline: TextFinalNewlinePolicy;
  readonly empty: TextEmptyPolicy;
  readonly signal: AbortSignal | undefined;
}

interface LineEndingObservation {
  readonly style: ObservedTextLineEndings;
  readonly hasFinalNewline: boolean;
}

const REQUIRED_OPTION_FIELDS = Object.freeze([
  "bom",
  "empty",
  "finalNewline",
  "lineEndings",
  "maximumBytes",
] as const);

function fail(
  reason: StrictTextFileErrorReason,
  path: string,
): never {
  throw new StrictTextFileError(reason, path);
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal
  );
}

function parseOptions(value: unknown): ParsedStrictTextFileOptions {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  const allowed = new Set([...REQUIRED_OPTION_FIELDS, "signal"]);
  const keys = Object.keys(record);
  if (
    REQUIRED_OPTION_FIELDS.some((field) => !Object.hasOwn(record, field))
    || keys.some((key) => !allowed.has(key))
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
  if (
    record.bom !== "reject"
    && record.bom !== "preserve"
    && record.bom !== "strip"
  ) {
    fail("input", "$options.bom");
  }
  if (
    record.lineEndings !== "preserve"
    && record.lineEndings !== "lf"
    && record.lineEndings !== "crlf"
  ) {
    fail("input", "$options.lineEndings");
  }
  if (
    record.finalNewline !== "optional"
    && record.finalNewline !== "required"
    && record.finalNewline !== "forbidden"
  ) {
    fail("input", "$options.finalNewline");
  }
  if (record.empty !== "allow" && record.empty !== "forbid") {
    fail("input", "$options.empty");
  }
  if (record.signal !== undefined && !isAbortSignal(record.signal)) {
    fail("input", "$options.signal");
  }
  return Object.freeze({
    maximumBytes,
    bom: record.bom,
    lineEndings: record.lineEndings,
    finalNewline: record.finalNewline,
    empty: record.empty,
    signal: record.signal,
  });
}

function observeLineEndings(text: string): LineEndingObservation {
  let lf = 0;
  let crlf = 0;
  let loneCr = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\r") {
      if (text[index + 1] === "\n") {
        crlf += 1;
        index += 1;
      } else {
        loneCr += 1;
      }
    } else if (character === "\n") {
      lf += 1;
    }
  }

  const style: ObservedTextLineEndings =
    lf === 0 && crlf === 0 && loneCr === 0
      ? "none"
      : lf > 0 && crlf === 0 && loneCr === 0
        ? "lf"
        : crlf > 0 && lf === 0 && loneCr === 0
          ? "crlf"
          : "mixed";
  return Object.freeze({
    style,
    hasFinalNewline: text.endsWith("\n") || text.endsWith("\r"),
  });
}

function assertLineEndingPolicy(
  observed: ObservedTextLineEndings,
  policy: TextLineEndingPolicy,
): void {
  if (
    (policy === "lf" && observed !== "none" && observed !== "lf")
    || (policy === "crlf" && observed !== "none" && observed !== "crlf")
  ) {
    fail("line-endings", "$text");
  }
}

function assertFinalNewlinePolicy(
  hasFinalNewline: boolean,
  policy: TextFinalNewlinePolicy,
): void {
  if (
    (policy === "required" && !hasFinalNewline)
    || (policy === "forbidden" && hasFinalNewline)
  ) {
    fail("final-newline", "$text");
  }
}

/**
 * 稳定读取并按显式 profile 解释 UTF-8 文本。
 *
 * initial U+FEFF 只由 bom policy 决定 preserve/strip/reject；empty 与换行判断基于
 * 去除 BOM 后的逻辑文本，避免一个孤立 BOM 被误当成有效内容。
 */
export async function readStrictTextFile(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  options: StrictTextFileOptions,
): Promise<Readonly<StrictTextFileResult>> {
  const parsed = parseOptions(options);
  const stableOptions = parsed.signal === undefined
    ? {
        maximumBytes: parsed.maximumBytes,
        capture: "bytes" as const,
      }
    : {
        maximumBytes: parsed.maximumBytes,
        capture: "bytes" as const,
        signal: parsed.signal,
      };
  const stable = await readStableFile(root, resourcePath, stableOptions);
  if (stable.capture !== "bytes") fail("utf8", "$text");

  let decoded: string;
  try {
    decoded = decodeUtf8(stable.bytes, "$text");
  } catch (error: unknown) {
    if (error instanceof Utf8Error) fail("utf8", "$text");
    throw error;
  }

  const hasBom = decoded.startsWith("\ufeff");
  if (hasBom && parsed.bom === "reject") fail("bom", "$text");
  const logicalText = hasBom ? decoded.slice(1) : decoded;
  if (logicalText.length === 0 && parsed.empty === "forbid") {
    fail("empty", "$text");
  }
  const observed = observeLineEndings(logicalText);
  assertLineEndingPolicy(observed.style, parsed.lineEndings);
  assertFinalNewlinePolicy(
    observed.hasFinalNewline,
    parsed.finalNewline,
  );

  return Object.freeze({
    resourcePath,
    node: stable.node,
    byteCount: stable.byteCount,
    digest: stable.digest,
    text: hasBom && parsed.bom === "strip" ? logicalText : decoded,
    bom: hasBom ? "present" : "absent",
    lineEndings: observed.style,
    hasFinalNewline: observed.hasFinalNewline,
  });
}
