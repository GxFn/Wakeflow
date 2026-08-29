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

export interface WholeFileContentTransitionRequest {
  readonly currentContents: readonly unknown[];
  readonly desiredContent: unknown;
}

export interface WholeFileContentTransition {
  readonly disposition: "current" | "create-required" | "replace-required";
  readonly sourceAuthority: "absent" | "desired" | "admitted-current";
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

const MAXIMUM_ADMITTED_CURRENT_CONTENTS = 8;

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
  try {
    record = parsePlainRecord(value, "$request");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error.path);
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 2
    || keys[0] !== "currentContents"
    || keys[1] !== "desiredContent"
  ) {
    fail("input", "$request");
  }
  let currentValues: readonly unknown[];
  try {
    currentValues = parseDenseArray(
      record.currentContents,
      MAXIMUM_ADMITTED_CURRENT_CONTENTS,
      "$request.currentContents",
    );
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error.path);
    throw error;
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
    if (entry === undefined) continue;
    for (let priorIndex = 0; priorIndex < index; priorIndex += 1) {
      const prior = current[priorIndex];
      if (prior !== undefined && sameContent(prior, entry)) {
        fail("duplicate-current", `$request.currentContents/${index}`);
      }
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
      disposition: "create-required",
      sourceAuthority: "absent",
      desiredByteCount: request.desired.byteCount,
      desiredDigest: request.desired.digest,
      desiredBytes: Buffer.from(request.desired.bytes),
    });
  }
  if (sameContent(source, request.desired)) {
    return Object.freeze({
      disposition: "current",
      sourceAuthority: "desired",
      desiredByteCount: request.desired.byteCount,
      desiredDigest: request.desired.digest,
      desiredBytes: Buffer.from(request.desired.bytes),
    });
  }
  const isAdmittedCurrent = request.current.some((content) => (
    sameContent(source, content)
  ));
  if (!isAdmittedCurrent) fail("unadmitted-source", "$source");
  return Object.freeze({
    disposition: "replace-required",
    sourceAuthority: "admitted-current",
    desiredByteCount: request.desired.byteCount,
    desiredDigest: request.desired.digest,
    desiredBytes: Buffer.from(request.desired.bytes),
  });
}
