import { types } from "node:util";

import { parseSha256Digest, type Sha256Digest, Sha256Error } from "../crypto/sha256.js";
import { PassiveOwnDataError, parsePlainRecord } from "../data/passive-own-data.js";
import { type Fail, failWith, ModuleError } from "../error/module-error.js";
import { type ByteCount, ByteCountError, parseByteCount } from "../numeric/byte-count.js";
import {
  admitFrozenFileNodeSnapshot,
  createFileNodeSnapshot,
  type FileNodeSnapshot,
} from "./file-node-snapshot.js";
import {
  type PortableResourcePath,
  PortableResourcePathError,
  parsePortableResourcePath,
} from "./portable-resource-path.js";
import { RootedDirectory } from "./rooted-directory.js";
import type { StableFileSource } from "./stable-file-read.js";
import { isAbortSignal } from "../node/abort-signal.js";

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
  | "close-failure";

/** 跨根流式文件候选失败的稳定、脱敏错误。 */
export class DurableFileCopyCandidateError extends ModuleError<DurableFileCopyCandidateErrorReason> {
  static override readonly code = "wakeflow-durable-file-copy-candidate";
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

export const failDurableFileCopyCandidate: Fail<DurableFileCopyCandidateErrorReason> = failWith(
  DurableFileCopyCandidateError,
);

export function assertDurableFileCopyRoot(
  value: unknown,
  path: "$sourceRoot" | "$destinationRoot",
): asserts value is RootedDirectory {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    !(value instanceof RootedDirectory)
  ) {
    failDurableFileCopyCandidate("input", path);
  }
}

export function parseDurableFileCopyPath(value: unknown, path: string): PortableResourcePath {
  try {
    return parsePortableResourcePath(value, path);
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      failDurableFileCopyCandidate("input", path, error);
    }
    throw error;
  }
}

function plainRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      failDurableFileCopyCandidate("input", path, error);
    }
    throw error;
  }
}

function parseExpectedNode(value: unknown): Readonly<FileNodeSnapshot> | undefined {
  if (value === undefined) return undefined;
  const node = admitFrozenFileNodeSnapshot(value, (cause) =>
    failDurableFileCopyCandidate("input", "$expectation.expectedNode", cause),
  );
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
    (keys.length !== 2 && keys.length !== 3) ||
    keys[0] !== "byteCount" ||
    keys[1] !== "digest" ||
    (keys.length === 3 && keys[2] !== "expectedNode")
  ) {
    failDurableFileCopyCandidate("input", "$expectation");
  }
  let byteCount: ByteCount;
  let digest: Sha256Digest;
  try {
    byteCount = parseByteCount(record.byteCount, "$expectation.byteCount");
  } catch (error: unknown) {
    if (error instanceof ByteCountError) {
      failDurableFileCopyCandidate("input", "$expectation.byteCount", error);
    }
    throw error;
  }
  try {
    digest = parseSha256Digest(record.digest, "$expectation.digest");
  } catch (error: unknown) {
    if (error instanceof Sha256Error) {
      failDurableFileCopyCandidate("input", "$expectation.digest", error);
    }
    throw error;
  }
  const expectedNode = parseExpectedNode(record.expectedNode);
  if (expectedNode !== undefined && expectedNode.byteCount !== byteCount) {
    failDurableFileCopyCandidate("input", "$expectation.expectedNode");
  }
  return Object.freeze({ byteCount, digest, expectedNode });
}

function parseMode(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0o777) {
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
    (keys.length !== 2 && keys.length !== 3) ||
    keys[0] !== "maximumBytes" ||
    keys[1] !== "mode" ||
    (keys.length === 3 && keys[2] !== "signal")
  ) {
    failDurableFileCopyCandidate("input", "$options");
  }
  let maximumBytes: ByteCount;
  try {
    maximumBytes = parseByteCount(record.maximumBytes, "$options.maximumBytes");
  } catch (error: unknown) {
    if (error instanceof ByteCountError) {
      failDurableFileCopyCandidate("input", "$options.maximumBytes", error);
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

export function snapshotDurableFileCopyNode(
  value: unknown,
  reason: DurableFileCopyCandidateErrorReason,
  path: string,
): Readonly<FileNodeSnapshot> {
  try {
    return createFileNodeSnapshot(value, path);
  } catch (cause: unknown) {
    failDurableFileCopyCandidate(reason, path, cause);
  }
}
