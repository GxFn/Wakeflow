import { types } from "node:util";

import {
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
  createFileNodeSnapshot,
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

/**
 * 跨根流式文件候选的公共数据、容量、错误与被动准入合同。
 *
 * 本模块不打开文件、不创建候选、不读取或散列字节，也不执行清理。具体 I/O 生命周期
 * 由 `durable-file-copy-candidate` 唯一拥有。
 */

export interface DurableFileCopyContentExpectation {
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
  readonly expectedNode?: Readonly<FileNodeSnapshot>;
}

export interface DurableFileCopyCandidateOptions {
  readonly maximumBytes: ByteCount;
  readonly mode: number;
  readonly signal?: AbortSignal;
}

export interface DurableFileCopyCandidateResult {
  readonly source: Readonly<StableFileSource>;
  readonly candidate: Readonly<StableFileSource>;
}

export type DurableFileCopyCandidateErrorReason =
  | "input"
  | "capacity"
  | "source-root-scope"
  | "source-not-found"
  | "source-symlink"
  | "source-not-file"
  | "source-changed"
  | "source-mismatch"
  | "source-read-failure"
  | "destination-root-scope"
  | "destination-parent"
  | "target-exists"
  | "candidate-create-failure"
  | "candidate-write-failure"
  | "candidate-sync-failure"
  | "candidate-changed"
  | "durability-failure"
  | "cleanup-failure"
  | "aborted"
  | "close-failure";

const ERROR_MESSAGES = {
  input: "Durable file copy candidate input is invalid.",
  capacity: "Durable file copy source exceeds its byte budget.",
  "source-root-scope": "Durable file copy lost its source root scope.",
  "source-not-found": "Durable file copy source does not exist.",
  "source-symlink": "Durable file copy source cannot be a symbolic link.",
  "source-not-file": "Durable file copy source must be a regular file.",
  "source-changed": "Durable file copy source changed during the operation.",
  "source-mismatch": "Durable file copy source differs from its content expectation.",
  "source-read-failure": "Durable file copy source could not be read safely.",
  "destination-root-scope": "Durable file copy lost its destination root scope.",
  "destination-parent": "Durable file copy candidate parent is unavailable or unsafe.",
  "target-exists": "Durable file copy candidate target already exists.",
  "candidate-create-failure": "Durable file copy candidate could not be created exclusively.",
  "candidate-write-failure": "Durable file copy candidate could not be written exactly.",
  "candidate-sync-failure": "Durable file copy candidate could not synchronize its bytes.",
  "candidate-changed": "Durable file copy candidate changed during verification.",
  "durability-failure": "Durable file copy candidate directory entry could not be synchronized.",
  "cleanup-failure": "Failed durable file copy candidate could not be retired exactly.",
  aborted: "Durable file copy candidate was aborted before completion.",
  "close-failure": "Durable file copy candidate handle could not be closed safely.",
} as const satisfies Readonly<Record<
  DurableFileCopyCandidateErrorReason,
  string
>>;

/** 跨根流式文件候选失败的稳定、脱敏错误。 */
export class DurableFileCopyCandidateError extends Error {
  override readonly name = "DurableFileCopyCandidateError";
  readonly code = "wakeflow-durable-file-copy-candidate" as const;
  readonly reason: DurableFileCopyCandidateErrorReason;
  readonly path: string;

  constructor(reason: DurableFileCopyCandidateErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

export interface ParsedDurableFileCopyExpectation {
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
  readonly expectedNode: Readonly<FileNodeSnapshot> | undefined;
}

interface ParsedDurableFileCopyOptions {
  readonly maximumBytes: ByteCount;
  readonly mode: number;
  readonly signal: AbortSignal | undefined;
}

export function failDurableFileCopyCandidate(
  reason: DurableFileCopyCandidateErrorReason,
  path: string,
): never {
  throw new DurableFileCopyCandidateError(reason, path);
}

export function assertDurableFileCopyRoot(
  value: unknown,
  path: "$sourceRoot" | "$destinationRoot",
): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    failDurableFileCopyCandidate("input", path);
  }
}

export function parseDurableFileCopyPath(
  value: unknown,
  path: string,
): PortableResourcePath {
  try {
    return parsePortableResourcePath(value, path);
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      failDurableFileCopyCandidate("input", path);
    }
    throw error;
  }
}

function plainRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      failDurableFileCopyCandidate("input", path);
    }
    throw error;
  }
}

function parseExpectedNode(
  value: unknown,
): Readonly<FileNodeSnapshot> | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !Object.isFrozen(value)
  ) {
    failDurableFileCopyCandidate("input", "$expectation.expectedNode");
  }
  try {
    if (!sameFileNodeSnapshot(
      value as FileNodeSnapshot,
      value as FileNodeSnapshot,
    )) {
      failDurableFileCopyCandidate("input", "$expectation.expectedNode");
    }
  } catch (error: unknown) {
    if (error instanceof FileNodeSnapshotError) {
      failDurableFileCopyCandidate("input", "$expectation.expectedNode");
    }
    throw error;
  }
  const node = value as Readonly<FileNodeSnapshot>;
  if (node.kind !== "file") {
    failDurableFileCopyCandidate("input", "$expectation.expectedNode");
  }
  return node;
}

export function parseDurableFileCopyExpectation(
  value: unknown,
): Readonly<ParsedDurableFileCopyExpectation> {
  const record = plainRecord(value, "$expectation");
  const keys = Object.keys(record).sort();
  if (
    (keys.length !== 2 && keys.length !== 3)
    || keys[0] !== "byteCount"
    || keys[1] !== "digest"
    || (keys.length === 3 && keys[2] !== "expectedNode")
  ) {
    failDurableFileCopyCandidate("input", "$expectation");
  }
  let byteCount: ByteCount;
  let digest: Sha256Digest;
  try {
    byteCount = parseByteCount(
      record.byteCount,
      "$expectation.byteCount",
    );
  } catch (error: unknown) {
    if (error instanceof ByteCountError) {
      failDurableFileCopyCandidate("input", "$expectation.byteCount");
    }
    throw error;
  }
  try {
    digest = parseSha256Digest(record.digest, "$expectation.digest");
  } catch (error: unknown) {
    if (error instanceof Sha256Error) {
      failDurableFileCopyCandidate("input", "$expectation.digest");
    }
    throw error;
  }
  const expectedNode = parseExpectedNode(record.expectedNode);
  if (expectedNode !== undefined && expectedNode.byteCount !== byteCount) {
    failDurableFileCopyCandidate("input", "$expectation.expectedNode");
  }
  return Object.freeze({ byteCount, digest, expectedNode });
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
    failDurableFileCopyCandidate("input", "$options.mode");
  }
  return value;
}

export function parseDurableFileCopyOptions(
  value: unknown,
): Readonly<ParsedDurableFileCopyOptions> {
  const record = plainRecord(value, "$options");
  const keys = Object.keys(record).sort();
  if (
    (keys.length !== 2 && keys.length !== 3)
    || keys[0] !== "maximumBytes"
    || keys[1] !== "mode"
    || (keys.length === 3 && keys[2] !== "signal")
  ) {
    failDurableFileCopyCandidate("input", "$options");
  }
  let maximumBytes: ByteCount;
  try {
    maximumBytes = parseByteCount(
      record.maximumBytes,
      "$options.maximumBytes",
    );
  } catch (error: unknown) {
    if (error instanceof ByteCountError) {
      failDurableFileCopyCandidate("input", "$options.maximumBytes");
    }
    throw error;
  }
  if (record.signal !== undefined && !isAbortSignal(record.signal)) {
    failDurableFileCopyCandidate("input", "$options.signal");
  }
  return Object.freeze({
    maximumBytes,
    mode: parseMode(record.mode),
    signal: record.signal as AbortSignal | undefined,
  });
}

export function assertDurableFileCopyNotAborted(
  signal: AbortSignal | undefined,
): void {
  if (signal?.aborted === true) {
    failDurableFileCopyCandidate("aborted", "$signal");
  }
}

export function snapshotDurableFileCopyNode(
  value: unknown,
  reason: DurableFileCopyCandidateErrorReason,
  path: string,
): Readonly<FileNodeSnapshot> {
  try {
    return createFileNodeSnapshot(value, path);
  } catch {
    failDurableFileCopyCandidate(reason, path);
  }
}
