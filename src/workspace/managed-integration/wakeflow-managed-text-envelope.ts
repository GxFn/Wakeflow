import { types } from "node:util";

import {
  computeSha256Digest,
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  Sha256Hasher,
  Sha256HasherError,
} from "../../foundation/crypto/sha256-hasher.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  createFileByteRange,
  parseFileByteOffset,
  type FileByteRange,
} from "../../foundation/filesystem/file-byte-range.js";
import {
  parseByteCount,
  type ByteCount,
} from "../../foundation/numeric/byte-count.js";
import {
  decodeUtf8,
  encodeUtf8,
  Utf8Error,
} from "../../foundation/text/utf8.js";

/**
 * Wakeflow Workspace / Managed Integration：混合所有权文本的 v1 envelope 协议。
 *
 * 本模块只解释和重组一份完整 UTF-8 字节快照。外部区域允许保留 BOM、CRLF、非 NFC
 * 文本和缺失末尾换行；受管正文采用独立的严格文本合同。所有重组都复制原始 outside
 * 字节，不从解码字符串重新生成。文件读取、容量、路径、CAS、原子发布和恢复属于调用方。
 *
 * Marker digest 只证明 envelope 内部自洽，不是签名或业务 authority。领域 owner 必须
 * 在 update/remove 前把检查结果与自己的来源权威比较；本模块不会因 marker 合法而授予
 * 对该 component 的修改权限。
 */

export const WAKEFLOW_MANAGED_TEXT_MARKER_PREFIX =
  "<!-- wakeflow:managed-content:v1:" as const;

const MARKER_NAMESPACE_PREFIX_BYTES = Buffer.from(
  "<!-- wakeflow:managed-content:",
  "ascii",
);
const LF = 0x0a;
const COMPONENT_PATTERN = /^[a-z][a-z0-9-]{0,127}$/u;
const OWNER_PATTERN = /^[a-z][a-z0-9_-]{0,127}$/u;
const MARKER_PATTERN =
  /^<!-- wakeflow:managed-content:v1:(begin|end) component=([a-z][a-z0-9-]{0,127}) owner=([a-z][a-z0-9_-]{0,127}) digest=(sha256:[0-9a-f]{64}) sep=([01]) -->$/u;

export type WakeflowManagedTextEnvelopeErrorReason =
  | "input"
  | "capacity"
  | "hash-failure"
  | "utf8"
  | "identity"
  | "body-profile"
  | "marker"
  | "marker-pair"
  | "body-digest"
  | "relation";

const ERROR_MESSAGES = {
  input: "Wakeflow managed text envelope input is invalid.",
  capacity: "Wakeflow managed text envelope exceeds runtime byte capacity.",
  "hash-failure": "Wakeflow managed text envelope bytes could not be hashed.",
  utf8: "Wakeflow managed text source is not valid UTF-8.",
  identity: "Wakeflow managed text component identity is invalid.",
  "body-profile": "Wakeflow managed text body violates its strict profile.",
  marker: "Wakeflow managed text marker structure is invalid.",
  "marker-pair": "Wakeflow managed text marker pair does not close.",
  "body-digest": "Wakeflow managed text body differs from its marker digest.",
  relation: "Wakeflow managed text envelope belongs to another component.",
} as const satisfies Readonly<Record<
  WakeflowManagedTextEnvelopeErrorReason,
  string
>>;

/** Managed Text envelope 解析或重组失败的稳定、脱敏错误。 */
export class WakeflowManagedTextEnvelopeError extends Error {
  override readonly name = "WakeflowManagedTextEnvelopeError";
  readonly code = "wakeflow-managed-text-envelope" as const;
  readonly reason: WakeflowManagedTextEnvelopeErrorReason;
  readonly path: string;

  constructor(reason: WakeflowManagedTextEnvelopeErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface WakeflowManagedTextEnvelopeFacts {
  readonly sourceByteCount: ByteCount;
  readonly sourceDigest: Sha256Digest;
  readonly outsideDigest: Sha256Digest;
}

export interface WakeflowUnmanagedTextEnvelopeInspection
  extends WakeflowManagedTextEnvelopeFacts {
  readonly kind: "unmanaged";
}

export interface WakeflowOwnedTextEnvelopeInspection
  extends WakeflowManagedTextEnvelopeFacts {
  readonly kind: "managed";
  readonly component: string;
  readonly owner: string;
  readonly body: string;
  readonly bodyDigest: Sha256Digest;
  readonly separator: "none" | "owned-leading-lf";
  readonly prefixOutsideRange: Readonly<FileByteRange>;
  readonly ownedRange: Readonly<FileByteRange>;
  readonly bodyRange: Readonly<FileByteRange>;
  readonly suffixOutsideRange: Readonly<FileByteRange>;
}

export type WakeflowManagedTextEnvelopeInspection =
  | WakeflowUnmanagedTextEnvelopeInspection
  | WakeflowOwnedTextEnvelopeInspection;

export interface WakeflowManagedTextEnvelopeTarget {
  readonly component: string;
  readonly owner: string;
  readonly body: string;
}

export interface WakeflowManagedTextEnvelopeIdentity {
  readonly component: string;
  readonly owner: string;
}

export interface WakeflowManagedTextRecompositionResult {
  readonly disposition: "inserted" | "current" | "updated";
  /** 调用方拥有的独立可变字节副本。 */
  readonly bytes: Uint8Array;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
  readonly envelope: Readonly<WakeflowOwnedTextEnvelopeInspection>;
}

export interface WakeflowManagedTextRemovalResult {
  readonly disposition: "removed";
  /** 调用方拥有的独立可变字节副本。 */
  readonly bytes: Uint8Array;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
}

interface ParsedMarker {
  readonly side: "begin" | "end";
  readonly component: string;
  readonly owner: string;
  readonly bodyDigest: Sha256Digest;
  readonly separator: "0" | "1";
  readonly start: number;
  readonly lineEnd: number;
}

function fail(
  reason: WakeflowManagedTextEnvelopeErrorReason,
  path: string,
): never {
  throw new WakeflowManagedTextEnvelopeError(reason, path);
}

function digestBytes(bytes: Uint8Array, path: string): Sha256Digest {
  try {
    return computeSha256Digest(bytes, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("hash-failure", path);
    throw error;
  }
}

function digestParts(
  parts: readonly Uint8Array[],
  path: string,
): Sha256Digest {
  let hasher: Sha256Hasher;
  try {
    hasher = new Sha256Hasher();
    for (const part of parts) hasher.update(part, path);
    return hasher.digest().digest;
  } catch (error: unknown) {
    if (error instanceof Sha256HasherError) fail("hash-failure", path);
    throw error;
  }
}

function concatenate(parts: readonly Uint8Array[], path: string): Buffer {
  try {
    return Buffer.concat(parts);
  } catch {
    fail("capacity", path);
  }
}

function snapshotBytes(value: unknown): Buffer {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !ArrayBuffer.isView(value)
    || !(value instanceof Uint8Array)
    || value.buffer instanceof SharedArrayBuffer
  ) {
    fail("input", "$source");
  }
  try {
    return Buffer.from(value);
  } catch {
    fail("capacity", "$source");
  }
}

function decodeSource(bytes: Uint8Array): void {
  try {
    decodeUtf8(bytes, "$source");
  } catch (error: unknown) {
    if (error instanceof Utf8Error) fail("utf8", "$source");
    throw error;
  }
}

function range(start: number, endExclusive: number, path: string) {
  return createFileByteRange(
    parseFileByteOffset(start, `${path}.offset`),
    parseByteCount(endExclusive - start, `${path}.length`),
    path,
  );
}

function markerOffsets(source: Buffer): readonly number[] {
  const offsets: number[] = [];
  let offset = 0;
  while (
    offset <= source.byteLength - MARKER_NAMESPACE_PREFIX_BYTES.byteLength
  ) {
    const found = source.indexOf(MARKER_NAMESPACE_PREFIX_BYTES, offset);
    if (found === -1) break;
    offsets.push(found);
    offset = found + MARKER_NAMESPACE_PREFIX_BYTES.byteLength;
  }
  return Object.freeze(offsets);
}

function parseMarker(source: Buffer, start: number): Readonly<ParsedMarker> {
  if (start !== 0 && source[start - 1] !== LF) fail("marker", "$marker");
  const lineEnd = source.indexOf(LF, start);
  if (lineEnd === -1) fail("marker", "$marker");
  const text = source.subarray(start, lineEnd).toString("utf8");
  const match = MARKER_PATTERN.exec(text);
  if (match === null) fail("marker", "$marker");
  const side = match[1];
  const component = match[2];
  const owner = match[3];
  const digest = match[4];
  const separator = match[5];
  if (
    (side !== "begin" && side !== "end")
    || component === undefined
    || owner === undefined
    || digest === undefined
    || (separator !== "0" && separator !== "1")
  ) {
    fail("marker", "$marker");
  }
  return Object.freeze({
    side,
    component,
    owner,
    bodyDigest: parseSha256Digest(digest, "$marker.digest"),
    separator,
    start,
    lineEnd,
  });
}

function assertBodyProfile(body: string, path: string): void {
  if (
    body.length <= 1
    || body.startsWith("\ufeff")
    || body.includes("\r")
    || !body.endsWith("\n")
    || body.endsWith("\n\n")
    || body.normalize("NFC") !== body
  ) {
    fail("body-profile", path);
  }
}

function inputRecord(
  value: unknown,
  path: string,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", path);
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== expectedKeys.length
    || keys.some((key, index) => key !== expectedKeys[index])
  ) {
    fail("input", path);
  }
  return record;
}

function parseIdentityRecord(
  value: unknown,
  path: string,
): Readonly<WakeflowManagedTextEnvelopeIdentity> {
  const record = inputRecord(value, path, ["component", "owner"]);
  if (
    typeof record.component !== "string"
    || !COMPONENT_PATTERN.test(record.component)
  ) {
    fail("identity", `${path}.component`);
  }
  if (typeof record.owner !== "string" || !OWNER_PATTERN.test(record.owner)) {
    fail("identity", `${path}.owner`);
  }
  return Object.freeze({
    component: record.component,
    owner: record.owner,
  });
}

/** 验证并快照一份严格 managed-text 目标；不读取或重组任何源字节。 */
export function parseWakeflowManagedTextEnvelopeTarget(
  value: unknown,
): Readonly<WakeflowManagedTextEnvelopeTarget> {
  const record = inputRecord(value, "$target", [
    "body",
    "component",
    "owner",
  ]);
  const identity = parseIdentityRecord({
    component: record.component,
    owner: record.owner,
  }, "$target");
  if (typeof record.body !== "string" || !record.body.isWellFormed()) {
    fail("body-profile", "$target.body");
  }
  assertBodyProfile(record.body, "$target.body");
  return Object.freeze({
    ...identity,
    body: record.body,
  });
}

function inspectSnapshot(
  source: Buffer,
): Readonly<WakeflowManagedTextEnvelopeInspection> {
  decodeSource(source);
  const sourceByteCount = parseByteCount(source.byteLength, "$source");
  const sourceDigest = digestBytes(source, "$source");
  const offsets = markerOffsets(source);
  if (offsets.length === 0) {
    return Object.freeze({
      kind: "unmanaged",
      sourceByteCount,
      sourceDigest,
      outsideDigest: sourceDigest,
    });
  }
  if (offsets.length !== 2) fail("marker", "$marker");
  const firstOffset = offsets[0];
  const secondOffset = offsets[1];
  if (firstOffset === undefined || secondOffset === undefined) {
    fail("marker", "$marker");
  }
  const begin = parseMarker(source, firstOffset);
  const end = parseMarker(source, secondOffset);
  if (
    begin.side !== "begin"
    || end.side !== "end"
    || begin.component !== end.component
    || begin.owner !== end.owner
    || begin.bodyDigest !== end.bodyDigest
    || begin.separator !== end.separator
    || begin.start >= end.start
  ) {
    fail("marker-pair", "$marker");
  }
  const bodyStart = begin.lineEnd + 1;
  const bodyEnd = end.start;
  if (bodyEnd <= bodyStart || source[bodyEnd - 1] !== LF) {
    fail("body-profile", "$body");
  }
  const bodyBytes = source.subarray(bodyStart, bodyEnd);
  const body = decodeUtf8(bodyBytes, "$body");
  assertBodyProfile(body, "$body");
  if (digestBytes(bodyBytes, "$body") !== begin.bodyDigest) {
    fail("body-digest", "$body");
  }
  const blockEnd = end.lineEnd + 1;
  const ownsSeparator = begin.separator === "1";
  const ownedStart = begin.start - (ownsSeparator ? 1 : 0);
  if (
    ownedStart < 0
    || (ownsSeparator && source[ownedStart] !== LF)
  ) {
    fail("marker-pair", "$marker.separator");
  }
  const prefix = source.subarray(0, ownedStart);
  const suffix = source.subarray(blockEnd);
  return Object.freeze({
    kind: "managed",
    sourceByteCount,
    sourceDigest,
    outsideDigest: digestParts([prefix, suffix], "$outside"),
    component: begin.component,
    owner: begin.owner,
    body,
    bodyDigest: begin.bodyDigest,
    separator: ownsSeparator ? "owned-leading-lf" : "none",
    prefixOutsideRange: range(0, ownedStart, "$prefixOutsideRange"),
    ownedRange: range(ownedStart, blockEnd, "$ownedRange"),
    bodyRange: range(bodyStart, bodyEnd, "$bodyRange"),
    suffixOutsideRange: range(
      blockEnd,
      source.byteLength,
      "$suffixOutsideRange",
    ),
  });
}

/** 复制并检查一份完整 UTF-8 字节快照中的唯一 Wakeflow envelope。 */
export function inspectWakeflowManagedTextEnvelope(
  sourceValue: unknown,
): Readonly<WakeflowManagedTextEnvelopeInspection> {
  return inspectSnapshot(snapshotBytes(sourceValue));
}

function renderOwnedBlock(
  target: Readonly<WakeflowManagedTextEnvelopeTarget>,
  ownsSeparator: boolean,
): Buffer {
  let bodyBytes: Uint8Array;
  try {
    bodyBytes = encodeUtf8(target.body, "$target.body");
  } catch (error: unknown) {
    if (error instanceof Utf8Error) fail("body-profile", "$target.body");
    throw error;
  }
  const digest = digestBytes(bodyBytes, "$target.body");
  const separator = ownsSeparator ? "1" : "0";
  const marker = (side: "begin" | "end") => (
    `${WAKEFLOW_MANAGED_TEXT_MARKER_PREFIX}${side} component=${target.component} owner=${target.owner} digest=${digest} sep=${separator} -->`
  );
  try {
    return Buffer.from(
      `${ownsSeparator ? "\n" : ""}${marker("begin")}\n${target.body}${marker("end")}\n`,
      "utf8",
    );
  } catch {
    fail("capacity", "$target.body");
  }
}

function resultBytes(
  bytes: Buffer,
): Readonly<Pick<
  WakeflowManagedTextRecompositionResult,
  "bytes" | "byteCount" | "digest"
>> {
  return Object.freeze({
    bytes,
    byteCount: parseByteCount(bytes.byteLength, "$result"),
    digest: digestBytes(bytes, "$result"),
  });
}

/**
 * 在完整源字节上插入或更新一个 exact owned envelope；调用方仍负责来源权威准入。
 */
export function recomposeWakeflowManagedTextEnvelope(
  sourceValue: unknown,
  targetValue: unknown,
): Readonly<WakeflowManagedTextRecompositionResult> {
  const source = snapshotBytes(sourceValue);
  const target = parseWakeflowManagedTextEnvelopeTarget(targetValue);
  const current = inspectSnapshot(source);
  if (
    current.kind === "managed"
    && (current.component !== target.component || current.owner !== target.owner)
  ) {
    fail("relation", "$target");
  }
  const prefixEnd = current.kind === "managed"
    ? current.ownedRange.offset
    : source.byteLength;
  const suffixStart = current.kind === "managed"
    ? current.ownedRange.endExclusive
    : source.byteLength;
  const ownsSeparator = current.kind === "managed"
    ? current.separator === "owned-leading-lf"
    : source.byteLength > 0 && source[source.byteLength - 1] !== LF;
  const output = concatenate([
    source.subarray(0, prefixEnd),
    renderOwnedBlock(target, ownsSeparator),
    source.subarray(suffixStart),
  ], "$result");
  const facts = resultBytes(output);
  const envelope = inspectSnapshot(output);
  if (envelope.kind !== "managed") fail("relation", "$result");
  return Object.freeze({
    disposition: source.equals(output)
      ? "current"
      : current.kind === "managed"
        ? "updated"
        : "inserted",
    ...facts,
    envelope,
  });
}

/**
 * 删除一个身份完全匹配的 owned envelope，并逐字节拼回两个 outside 区域。
 * 调用方必须先验证当前 body digest 属于可移除的已知渲染。
 */
export function removeWakeflowManagedTextEnvelope(
  sourceValue: unknown,
  identityValue: unknown,
): Readonly<WakeflowManagedTextRemovalResult> {
  const source = snapshotBytes(sourceValue);
  const identity = parseIdentityRecord(identityValue, "$identity");
  const current = inspectSnapshot(source);
  if (
    current.kind !== "managed"
    || current.component !== identity.component
    || current.owner !== identity.owner
  ) {
    fail("relation", "$identity");
  }
  const output = concatenate([
    source.subarray(0, current.ownedRange.offset),
    source.subarray(current.ownedRange.endExclusive),
  ], "$result");
  return Object.freeze({
    disposition: "removed",
    ...resultBytes(output),
  });
}
