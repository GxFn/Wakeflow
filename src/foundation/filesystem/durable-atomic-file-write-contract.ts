import { types } from "node:util";

import {
  computeSha256Digest,
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../crypto/sha256.js";
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
  FileNodeSnapshotError,
  sameFileNodeSnapshot,
  type FileNodeSnapshot,
} from "./file-node-snapshot.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "./portable-resource-path.js";
import { RootedDirectory } from "./rooted-directory.js";
import type { StableFileSource } from "./stable-file-read.js";

/** Durable atomic file write 的公开合同、输入快照与稳定错误。 */

export const DURABLE_ATOMIC_FILE_MAXIMUM_BYTES = parseByteCount(
  64 * 1024 * 1024,
  "$durableAtomicFile.maximumBytes",
);

export interface DurableAtomicFileCreateOptions {
  readonly mode: number;
  readonly signal?: AbortSignal;
}

/** replace 所需、与目标 resource path 绑定的完整前序稳定读取事实。 */
export type DurableAtomicFileExpectation = Readonly<StableFileSource>;

export interface DurableAtomicFileReplaceOptions {
  readonly mode: number;
  readonly expected: DurableAtomicFileExpectation;
  readonly signal?: AbortSignal;
}

export type DurableAtomicFilePublication = "created" | "replaced";

/** 成功返回只描述已经复验并完成 parent sync 的最终 target。 */
export interface DurableAtomicFileWriteResult<
  Publication extends DurableAtomicFilePublication =
    DurableAtomicFilePublication,
> {
  readonly resourcePath: PortableResourcePath;
  readonly publication: Publication;
  readonly node: Readonly<FileNodeSnapshot>;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
}

/** replace 成功后同时签发已核验的完整前序 source。 */
export interface DurableAtomicFileReplaceResult
  extends DurableAtomicFileWriteResult<"replaced"> {
  readonly previous: Readonly<DurableAtomicFileExpectation>;
}

export type DurableAtomicFileWriteErrorReason =
  | "input"
  | "root-scope"
  | "parent-not-found"
  | "parent-symlink"
  | "parent-not-directory"
  | "parent-open-failure"
  | "parent-changed"
  | "target-exists"
  | "target-inspection-failure"
  | "expectation-changed"
  | "expectation-read-failure"
  | "hash-failure"
  | "capacity"
  | "stage-create-failure"
  | "stage-write-failure"
  | "stage-sync-failure"
  | "stage-changed"
  | "publish-failure"
  | "commit-uncertain"
  | "durability-failure"
  | "stage-cleanup-failure"
  | "stage-recovery-required"
  | "aborted"
  | "close-failure";

const ERROR_MESSAGES = {
  "input": "Durable atomic file write input is invalid.",
  "root-scope": "Atomic file target could not establish its rooted scope.",
  "parent-not-found": "Atomic file target parent directory does not exist.",
  "parent-symlink": "Atomic file target parent chain cannot contain a symbolic link.",
  "parent-not-directory": "Atomic file target parent must be a directory.",
  "parent-open-failure": "Atomic file target parent could not be opened safely.",
  "parent-changed": "Atomic file target parent changed during the operation.",
  "target-exists": "Atomic file create target already exists.",
  "target-inspection-failure": "Atomic file target could not be inspected safely.",
  "expectation-changed": "Atomic file replace expectation no longer matches the target.",
  "expectation-read-failure": "Atomic file replace target could not be re-read safely.",
  "hash-failure": "Atomic file input digest could not be computed safely.",
  "capacity": "Atomic file input exceeds the recoverable stage capacity.",
  "stage-create-failure": "Private atomic file stage could not be created safely.",
  "stage-write-failure": "Private atomic file stage could not be written exactly.",
  "stage-sync-failure": "Private atomic file stage could not be synchronized safely.",
  "stage-changed": "Private atomic file stage changed before publication.",
  "publish-failure": "Private atomic file stage could not be published safely.",
  "commit-uncertain": "Published atomic file target could not be proven exact.",
  "durability-failure": "Published atomic file directory entry could not be synchronized.",
  "stage-cleanup-failure": "Private atomic file stage could not be retired safely.",
  "stage-recovery-required": "Private atomic file stage recovery requires explicit intervention.",
  "aborted": "Durable atomic file write was aborted before publication.",
  "close-failure": "An atomic file write handle could not be closed safely.",
} as const satisfies Readonly<Record<
  DurableAtomicFileWriteErrorReason,
  string
>>;

/** 持久化单文件写入的稳定、脱敏错误。 */
export class DurableAtomicFileWriteError extends Error {
  override readonly name = "DurableAtomicFileWriteError";
  readonly code = "wakeflow-durable-atomic-file-write" as const;
  readonly reason: DurableAtomicFileWriteErrorReason;
  readonly path: string;

  constructor(reason: DurableAtomicFileWriteErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

export interface ParsedDurableAtomicFileCreateOptions {
  readonly mode: number;
  readonly signal: AbortSignal | undefined;
}

export interface ParsedDurableAtomicFileReplaceOptions
  extends ParsedDurableAtomicFileCreateOptions {
  readonly expected: Readonly<DurableAtomicFileExpectation>;
}

export interface DurableAtomicFileInputBytes {
  readonly bytes: Buffer;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
}

export function failDurableAtomicFileWrite(
  reason: DurableAtomicFileWriteErrorReason,
  path: string,
): never {
  throw new DurableAtomicFileWriteError(reason, path);
}

export function assertDurableAtomicFileNotAborted(
  signal: AbortSignal | undefined,
): void {
  if (signal?.aborted === true) {
    failDurableAtomicFileWrite("aborted", "$signal");
  }
}

export function assertDurableAtomicFileRoot(
  value: unknown,
): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    failDurableAtomicFileWrite("input", "$root");
  }
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal;
}

function parseMode(value: unknown): number {
  if (
    typeof value !== "number"
    || !Number.isInteger(value)
    || value < 0
    || value > 0o777
  ) {
    failDurableAtomicFileWrite("input", "$options.mode");
  }
  return value;
}

function parseOptionRecord(
  value: unknown,
  required: readonly string[],
): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      failDurableAtomicFileWrite("input", "$options");
    }
    throw error;
  }
  const allowed = new Set([...required, "signal"]);
  if (
    required.some((field) => !Object.hasOwn(record, field))
    || Object.keys(record).some((key) => !allowed.has(key))
  ) {
    failDurableAtomicFileWrite("input", "$options");
  }
  return record;
}

function parseSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  if (!isAbortSignal(value)) {
    failDurableAtomicFileWrite("input", "$options.signal");
  }
  return value;
}

export function parseDurableAtomicFileCreateOptions(
  value: unknown,
): Readonly<ParsedDurableAtomicFileCreateOptions> {
  const record = parseOptionRecord(value, ["mode"]);
  return Object.freeze({
    mode: parseMode(record.mode),
    signal: parseSignal(record.signal),
  });
}

function parseExpectedNode(value: unknown): Readonly<FileNodeSnapshot> {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !Object.isFrozen(value)
  ) {
    failDurableAtomicFileWrite("input", "$options.expected.node");
  }
  try {
    if (!sameFileNodeSnapshot(
      value as FileNodeSnapshot,
      value as FileNodeSnapshot,
    )) {
      failDurableAtomicFileWrite("input", "$options.expected.node");
    }
  } catch (error: unknown) {
    if (error instanceof FileNodeSnapshotError) {
      failDurableAtomicFileWrite("input", "$options.expected.node");
    }
    throw error;
  }
  const node = value as Readonly<FileNodeSnapshot>;
  if (node.kind !== "file") {
    failDurableAtomicFileWrite("input", "$options.expected.node");
  }
  return node;
}

function parseExpectation(
  value: unknown,
): Readonly<DurableAtomicFileExpectation> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options.expected");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      failDurableAtomicFileWrite("input", "$options.expected");
    }
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 4
    || keys[0] !== "byteCount"
    || keys[1] !== "digest"
    || keys[2] !== "node"
    || keys[3] !== "resourcePath"
  ) {
    failDurableAtomicFileWrite("input", "$options.expected");
  }
  let resourcePath: PortableResourcePath;
  try {
    resourcePath = parsePortableResourcePath(
      record.resourcePath,
      "$options.expected.resourcePath",
    );
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      failDurableAtomicFileWrite("input", "$options.expected.resourcePath");
    }
    throw error;
  }
  let byteCount: ByteCount;
  try {
    byteCount = parseByteCount(
      record.byteCount,
      "$options.expected.byteCount",
    );
  } catch (error: unknown) {
    if (error instanceof ByteCountError) {
      failDurableAtomicFileWrite("input", "$options.expected.byteCount");
    }
    throw error;
  }
  let digest: Sha256Digest;
  try {
    digest = parseSha256Digest(record.digest, "$options.expected.digest");
  } catch (error: unknown) {
    if (error instanceof Sha256Error) {
      failDurableAtomicFileWrite("input", "$options.expected.digest");
    }
    throw error;
  }
  const node = parseExpectedNode(record.node);
  if (node.byteCount !== byteCount) {
    failDurableAtomicFileWrite("input", "$options.expected.byteCount");
  }
  return Object.freeze({ resourcePath, node, byteCount, digest });
}

export function parseDurableAtomicFileReplaceOptions(
  value: unknown,
): Readonly<ParsedDurableAtomicFileReplaceOptions> {
  const record = parseOptionRecord(value, ["expected", "mode"]);
  return Object.freeze({
    mode: parseMode(record.mode),
    expected: parseExpectation(record.expected),
    signal: parseSignal(record.signal),
  });
}

export function snapshotDurableAtomicFileInputBytes(
  value: unknown,
): Readonly<DurableAtomicFileInputBytes> {
  if (!(ArrayBuffer.isView(value) && value instanceof Uint8Array)) {
    failDurableAtomicFileWrite("input", "$bytes");
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(value);
  } catch {
    failDurableAtomicFileWrite("input", "$bytes");
  }
  const byteCount = parseByteCount(bytes.byteLength, "$bytes");
  if (byteCount > DURABLE_ATOMIC_FILE_MAXIMUM_BYTES) {
    failDurableAtomicFileWrite("capacity", "$bytes");
  }
  let digest: Sha256Digest;
  try {
    digest = computeSha256Digest(bytes, "$bytes");
  } catch (error: unknown) {
    if (error instanceof Sha256Error) {
      failDurableAtomicFileWrite("hash-failure", "$bytes");
    }
    throw error;
  }
  return Object.freeze({ bytes, byteCount, digest });
}
