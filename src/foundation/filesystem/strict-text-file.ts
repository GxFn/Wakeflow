import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import type { ByteCount } from "../numeric/byte-count.js";
import {
  decodeUtf8,
  Utf8Error,
} from "../text/utf8.js";
import type { FileNodeSnapshot } from "./file-node-snapshot.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import type { RootedDirectory } from "./rooted-directory.js";
import {
  readStableFile,
  type StableFileSource,
} from "./stable-file-read.js";

/**
 * Wakeflow Foundation / Filesystem：Wakeflow 自有严格 UTF-8 文本文件读取。
 *
 * 本文件组合 StableFileRead 与 fatal UTF-8 解码，并固定执行一个磁盘文本合同：
 * 无 BOM、NFC、LF-only、恰好一个末尾 LF、且末尾 LF 前存在非空正文。它不提供
 * preserve/strip/normalize 等转换选项，也不解析 JSON、Markdown 或领域 marker。
 *
 * 外部或 mixed-owned 文本必须由后续 managed-text owner 从稳定 bytes 解释并保留
 * outside representation；不能为了兼容外部格式放宽本入口。路径、容量、expected
 * node、竞态、Abort 与节点类型失败继续保持 StableFileReadError。
 */

export interface StrictTextFileOptions {
  readonly maximumBytes: ByteCount;
  readonly expectedNode?: Readonly<FileNodeSnapshot>;
  readonly signal?: AbortSignal;
}

/** 一次严格文本读取结果；成功即证明固定文本 profile 全部成立。 */
export interface StrictTextFileResult extends StableFileSource {
  readonly text: string;
}

interface ParsedStrictTextFileOptions {
  readonly maximumBytes: ByteCount;
  readonly expectedNode: Readonly<FileNodeSnapshot> | undefined;
  readonly signal: AbortSignal | undefined;
}

export type StrictTextFileErrorReason =
  | "input"
  | "utf8"
  | "bom"
  | "line-endings"
  | "final-newline"
  | "empty"
  | "unicode-normalization";

const ERROR_MESSAGES = {
  "input": "Strict text file options are invalid.",
  "utf8": "Strict text file must contain valid fatal UTF-8.",
  "bom": "Strict text file cannot begin with a UTF-8 BOM.",
  "line-endings": "Strict text file must use LF-only line endings.",
  "final-newline": "Strict text file must end with exactly one LF.",
  "empty": "Strict text file must contain non-empty logical content.",
  "unicode-normalization": "Strict text file source must use Unicode NFC.",
} as const satisfies Readonly<Record<StrictTextFileErrorReason, string>>;

/** strict text options、编码或固定文本形态失败的稳定、脱敏错误。 */
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

function fail(reason: StrictTextFileErrorReason, path: string): never {
  throw new StrictTextFileError(reason, path);
}

function parseOptions(value: unknown): Readonly<ParsedStrictTextFileOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  const allowed = new Set(["expectedNode", "maximumBytes", "signal"]);
  if (
    !Object.hasOwn(record, "maximumBytes")
    || Object.keys(record).some((key) => !allowed.has(key))
  ) {
    fail("input", "$options");
  }
  return Object.freeze({
    maximumBytes: record.maximumBytes as ByteCount,
    expectedNode: record.expectedNode as Readonly<FileNodeSnapshot> | undefined,
    signal: record.signal as AbortSignal | undefined,
  });
}

function decodeStrictUtf8(bytes: Uint8Array): string {
  try {
    return decodeUtf8(bytes, "$text");
  } catch (error: unknown) {
    if (error instanceof Utf8Error) fail("utf8", "$text");
    throw error;
  }
}

function assertStrictText(text: string): void {
  if (text.length === 0) fail("empty", "$text");
  if (text.startsWith("\ufeff")) fail("bom", "$text");
  if (text.includes("\r")) fail("line-endings", "$text");
  if (!text.endsWith("\n") || text.endsWith("\n\n")) {
    fail("final-newline", "$text");
  }
  if (text.length === 1) fail("empty", "$text");
  if (text.normalize("NFC") !== text) {
    fail("unicode-normalization", "$text");
  }
}

/** 稳定读取并验证一个固定 Wakeflow 文本 profile。 */
export async function readStrictTextFile(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  options: StrictTextFileOptions,
): Promise<Readonly<StrictTextFileResult>> {
  const parsed = parseOptions(options);
  const stable = await readStableFile(root, resourcePath, {
    maximumBytes: parsed.maximumBytes,
    ...(parsed.expectedNode === undefined
      ? {}
      : { expectedNode: parsed.expectedNode }),
    ...(parsed.signal === undefined ? {} : { signal: parsed.signal }),
  });
  const text = decodeStrictUtf8(stable.bytes);
  assertStrictText(text);
  return Object.freeze({
    resourcePath: stable.resourcePath,
    node: stable.node,
    byteCount: stable.byteCount,
    digest: stable.digest,
    text,
  });
}
