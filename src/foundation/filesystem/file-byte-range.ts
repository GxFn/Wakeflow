import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import {
  ByteCountError,
  MAX_SAFE_BYTE_COUNT,
  parseByteCount,
  type ByteCount,
} from "../numeric/byte-count.js";

/**
 * Wakeflow Foundation / Filesystem：文件字节偏移量与半开字节区间。
 *
 * 本模块把非负安全整数位置与 `ByteCount` 长度组合为 `[offset, endExclusive)`。
 * `FileByteOffset` 使用独立品牌类型，防止 TypeScript 把“字节数量”误当成“文件位置”；
 * 所有公开操作仍会重新执行运行时准入，品牌不能绕过范围或一致性检查。
 *
 * 本层不打开文件、不分配区间字节、不解释 UTF-8、行或标记，也不把区间绑定到某个
 * 文件版本。文件大小边界只由显式断言函数检查。
 */

declare const FILE_BYTE_OFFSET_BRAND: unique symbol;

/** 已验证为非负安全整数的文件绝对字节偏移量。 */
export type FileByteOffset = number & {
  readonly [FILE_BYTE_OFFSET_BRAND]: "FileByteOffset";
};

/** 冻结且内部一致的半开文件字节区间。 */
export interface FileByteRange {
  readonly offset: FileByteOffset;
  readonly length: ByteCount;
  readonly endExclusive: FileByteOffset;
}

/** 文件字节区间准入、算术或文件边界失败分类。 */
export type FileByteRangeErrorReason =
  | "offset-range"
  | "length-range"
  | "end-overflow"
  | "range-shape"
  | "range-field"
  | "file-size"
  | "out-of-bounds";

const ERROR_MESSAGES = {
  "offset-range": "File byte offset must be a non-negative safe integer.",
  "length-range": "File byte range length must be a valid byte count.",
  "end-overflow": "File byte range end exceeds the safe integer range.",
  "range-shape": "File byte range must match its closed passive data shape.",
  "range-field": "File byte range fields are internally inconsistent.",
  "file-size": "File byte count is invalid for range validation.",
  "out-of-bounds": "File byte range lies outside the file byte boundary.",
} as const satisfies Readonly<Record<FileByteRangeErrorReason, string>>;

/**
 * 文件字节区间的稳定错误。
 *
 * 错误只暴露分类与结构路径，不回显偏移量、长度、结束位置或文件大小。
 */
export class FileByteRangeError extends Error {
  override readonly name = "FileByteRangeError";
  readonly code = "wakeflow-file-byte-range" as const;
  readonly reason: FileByteRangeErrorReason;
  readonly path: string;

  constructor(reason: FileByteRangeErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function normalizeErrorPath(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function fieldPath(basePath: string, field: string): string {
  return `${basePath}.${field}`;
}

function fail(reason: FileByteRangeErrorReason, path: string): never {
  throw new FileByteRangeError(reason, path);
}

function parseOffset(value: unknown, path: string): FileByteOffset {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
  ) {
    fail("offset-range", path);
  }
  return value as FileByteOffset;
}

function parseLength(value: unknown, path: string): ByteCount {
  try {
    return parseByteCount(value, path);
  } catch (error: unknown) {
    if (error instanceof ByteCountError) fail("length-range", path);
    throw error;
  }
}

function rangeEnd(
  offset: FileByteOffset,
  length: ByteCount,
  path: string,
): FileByteOffset {
  if (length > MAX_SAFE_BYTE_COUNT - offset) {
    fail("end-overflow", path);
  }
  return (offset + length) as FileByteOffset;
}

function createRange(
  offsetValue: unknown,
  lengthValue: unknown,
  path: string,
): Readonly<FileByteRange> {
  const offset = parseOffset(offsetValue, fieldPath(path, "offset"));
  const length = parseLength(lengthValue, fieldPath(path, "length"));
  const endExclusive = rangeEnd(offset, length, path);
  return Object.freeze({ offset, length, endExclusive });
}

function parseCompleteRange(
  value: unknown,
  path: string,
): Readonly<FileByteRange> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("range-shape", path);
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 3
    || keys[0] !== "endExclusive"
    || keys[1] !== "length"
    || keys[2] !== "offset"
  ) {
    fail("range-shape", path);
  }
  const created = createRange(record.offset, record.length, path);
  const endExclusive = parseOffset(
    record.endExclusive,
    fieldPath(path, "endExclusive"),
  );
  if (created.endExclusive !== endExclusive) {
    fail("range-field", fieldPath(path, "endExclusive"));
  }
  return created;
}

/** 严格解析文件绝对字节偏移量。 */
export function parseFileByteOffset(
  value: unknown,
  errorPath?: string,
): FileByteOffset {
  return parseOffset(
    value,
    normalizeErrorPath(errorPath, "$offset"),
  );
}

/**
 * 从已声明语义的偏移量与长度创建半开区间，并重新验证两个品牌输入。
 */
export function createFileByteRange(
  offset: FileByteOffset,
  length: ByteCount,
  errorPath?: string,
): Readonly<FileByteRange> {
  return createRange(
    offset,
    length,
    normalizeErrorPath(errorPath, "$range"),
  );
}

/**
 * 从字段集合严格受限的 `{ offset, length }` 纯数据记录解析字节区间。
 *
 * 调用方不能提供 endExclusive；它始终由已验证算术唯一派生。
 */
export function parseFileByteRange(
  value: unknown,
  errorPath?: string,
): Readonly<FileByteRange> {
  const path = normalizeErrorPath(errorPath, "$range");
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("range-shape", path);
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "length" || keys[1] !== "offset") {
    fail("range-shape", path);
  }
  return createRange(record.offset, record.length, path);
}

/**
 * 重新验证字节区间与 `fileByteCount`，并断言整个半开区间位于文件内。
 *
 * 零长度区间可以位于 EOF；偏移量大于 EOF 时，即使长度为零也会失败。
 */
export function assertFileByteRangeWithin(
  range: FileByteRange,
  fileByteCount: ByteCount,
  errorPath?: string,
): void {
  const path = normalizeErrorPath(errorPath, "$range");
  const admittedRange = parseCompleteRange(range, path);
  let admittedFileByteCount: ByteCount;
  try {
    admittedFileByteCount = parseByteCount(fileByteCount, "$fileByteCount");
  } catch (error: unknown) {
    if (error instanceof ByteCountError) fail("file-size", "$fileByteCount");
    throw error;
  }
  if (
    admittedRange.offset > admittedFileByteCount
    || admittedRange.endExclusive > admittedFileByteCount
  ) {
    fail("out-of-bounds", path);
  }
}
