import { types } from "node:util";

import {
  computeSha256Digest,
  type Sha256Digest,
} from "../crypto/sha256.js";
import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import { parseByteCount, type ByteCount } from "../numeric/byte-count.js";

/**
 * Wakeflow Foundation / Filesystem：整文件 current→desired 字节转换。
 *
 * 本能力把“目标不存在、已是 desired、精确匹配一个 current、未知内容”收敛成闭合结论。
 * 合法文件类型、权限、稳定读取、CAS、持久发布和领域 authority 均由调用方负责；本层
 * 只复制可见 `Uint8Array` 字节并进行长度、SHA-256 与逐字节比较。
 *
 * currentContents 是有界版本演进接缝。调用方只能放入能从当前领域权威或保留的旧
 * renderer 重算出的精确字节，不能因为文件位于目标路径就把它加入准入集合。
 */

export const WHOLE_FILE_CONTENT_TRANSITION_KIND =
  "WakeflowWholeFileContentTransition" as const;

export interface WholeFileContentTransitionRequest {
  readonly currentContents: readonly unknown[];
  readonly desiredContent: unknown;
}

export interface WholeFileContentTransition {
  readonly kind: typeof WHOLE_FILE_CONTENT_TRANSITION_KIND;
  readonly disposition: "current" | "create-required" | "replace-required";
  readonly sourceAuthority: "absent" | "desired" | "admitted-current";
  readonly matchedCurrentContentIndex: number | null;
  readonly sourceByteCount: ByteCount | null;
  readonly sourceDigest: Sha256Digest | null;
  readonly desiredByteCount: ByteCount;
  readonly desiredDigest: Sha256Digest;
  /** 调用方拥有的独立可变字节副本。 */
  readonly desiredBytes: Uint8Array;
}

export type WholeFileContentTransitionErrorReason =
  | "input"
  | "duplicate-current"
  | "unadmitted-source";

const ERROR_MESSAGES = {
  input: "Whole-file content transition input is invalid.",
  "duplicate-current": "Whole-file current content is duplicated.",
  "unadmitted-source": "Whole-file source is not an admitted content render.",
} as const satisfies Readonly<Record<
  WholeFileContentTransitionErrorReason,
  string
>>;

/** 整文件字节转换准入失败的稳定、脱敏错误。 */
export class WholeFileContentTransitionError extends Error {
  override readonly name = "WholeFileContentTransitionError";
  readonly code = "wakeflow-whole-file-content-transition" as const;
  readonly reason: WholeFileContentTransitionErrorReason;
  readonly path: string;

  constructor(reason: WholeFileContentTransitionErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ContentSnapshot {
  readonly bytes: Buffer;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
}

function fail(
  reason: WholeFileContentTransitionErrorReason,
  path: string,
): never {
  throw new WholeFileContentTransitionError(reason, path);
}

function snapshotBytes(value: unknown, path: string): Readonly<ContentSnapshot> {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !ArrayBuffer.isView(value)
    || !(value instanceof Uint8Array)
    || value.buffer instanceof SharedArrayBuffer
  ) {
    fail("input", path);
  }
  const bytes = Buffer.from(value);
  return Object.freeze({
    bytes,
    byteCount: parseByteCount(bytes.byteLength, path),
    digest: computeSha256Digest(bytes, path),
  });
}

function sameContent(
  left: Readonly<ContentSnapshot>,
  right: Readonly<ContentSnapshot>,
): boolean {
  return left.byteCount === right.byteCount
    && left.digest === right.digest
    && left.bytes.equals(right.bytes);
}

function parseRequest(value: unknown): Readonly<{
  readonly current: readonly Readonly<ContentSnapshot>[];
  readonly desired: Readonly<ContentSnapshot>;
}> {
  let record: Readonly<Record<string, unknown>>;
  let currentValues: readonly unknown[];
  try {
    record = parsePlainRecord(value, "$request");
    currentValues = parseDenseArray(
      record.currentContents,
      8,
      "$request.currentContents",
    );
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error.path);
    throw error;
  }
  if (
    Object.keys(record).sort().join("\u0000")
      !== "currentContents\u0000desiredContent"
  ) {
    fail("input", "$request");
  }
  const desired = snapshotBytes(
    record.desiredContent,
    "$request.desiredContent",
  );
  const current = Object.freeze(currentValues.map((content, index) => (
    snapshotBytes(content, `$request.currentContents/${index}`)
  )));
  for (let index = 0; index < current.length; index += 1) {
    const entry = current[index];
    if (
      entry !== undefined
      && current.slice(0, index).some((prior) => sameContent(prior, entry))
    ) {
      fail("duplicate-current", `$request.currentContents/${index}`);
    }
  }
  return Object.freeze({ current, desired });
}

/** 计划一份 absent/current/replace 的整文件字节转换，不执行任何 I/O。 */
export function planWholeFileContentTransition(
  sourceValue: unknown | null,
  requestValue: WholeFileContentTransitionRequest,
): Readonly<WholeFileContentTransition> {
  const request = parseRequest(requestValue);
  const source = sourceValue === null
    ? null
    : snapshotBytes(sourceValue, "$source");
  if (source === null) {
    return Object.freeze({
      kind: WHOLE_FILE_CONTENT_TRANSITION_KIND,
      disposition: "create-required",
      sourceAuthority: "absent",
      matchedCurrentContentIndex: null,
      sourceByteCount: null,
      sourceDigest: null,
      desiredByteCount: request.desired.byteCount,
      desiredDigest: request.desired.digest,
      desiredBytes: Buffer.from(request.desired.bytes),
    });
  }
  if (sameContent(source, request.desired)) {
    return Object.freeze({
      kind: WHOLE_FILE_CONTENT_TRANSITION_KIND,
      disposition: "current",
      sourceAuthority: "desired",
      matchedCurrentContentIndex: null,
      sourceByteCount: source.byteCount,
      sourceDigest: source.digest,
      desiredByteCount: request.desired.byteCount,
      desiredDigest: request.desired.digest,
      desiredBytes: Buffer.from(request.desired.bytes),
    });
  }
  const currentIndex = request.current.findIndex((content) => (
    sameContent(source, content)
  ));
  if (currentIndex < 0) fail("unadmitted-source", "$source");
  return Object.freeze({
    kind: WHOLE_FILE_CONTENT_TRANSITION_KIND,
    disposition: "replace-required",
    sourceAuthority: "admitted-current",
    matchedCurrentContentIndex: currentIndex,
    sourceByteCount: source.byteCount,
    sourceDigest: source.digest,
    desiredByteCount: request.desired.byteCount,
    desiredDigest: request.desired.digest,
    desiredBytes: Buffer.from(request.desired.bytes),
  });
}
