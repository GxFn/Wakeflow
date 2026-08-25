import { constants as bufferConstants } from "node:buffer";
import { constants as fileSystemConstants } from "node:fs";
import {
  open as openFileHandle,
  type FileHandle,
} from "node:fs/promises";
import { types } from "node:util";

import {
  computeSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import {
  MAX_SAFE_BYTE_COUNT,
  parseByteCount,
  type ByteCount,
} from "../numeric/byte-count.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import {
  createFileNodeSnapshot,
  FileNodeSnapshotError,
  sameFileNodeSnapshot,
  type FileNodeSnapshot,
} from "./file-node-snapshot.js";
import {
  assertFileByteRangeWithin,
  createFileByteRange,
  FileByteRangeError,
  type FileByteRange,
} from "./file-byte-range.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
  type RootedResourceSnapshot,
} from "./rooted-directory.js";

/**
 * Wakeflow Foundation / Filesystem：稳定文件版本上的有界 positioned range read。
 *
 * 本文件在 RootedDirectory 下执行 inspect→no-follow open→范围复验→显式 position
 * 分块读取→handle/path/root 复验。可选 expectedNode 把来自自有 index/page/cursor 的
 * FileByteRange 绑定到前一次稳定读取的准确物理版本；缺省时读取本次观察到的版本。
 *
 * 返回 digest 只覆盖 range bytes，不是完整文件 digest。基础层不解码文本、不查找
 * marker、不修改 cursor、不执行 partial write，也不把 node expectation 解释为锁或
 * 跨进程 snapshot isolation。
 */

/** positioned read 的实现 chunk；不是任一领域 range 上限。 */
export const STABLE_FILE_RANGE_READ_CHUNK_BYTES = parseByteCount(64 * 1024);

export interface StableFileRangeReadOptions {
  readonly expectedNode?: Readonly<FileNodeSnapshot>;
  readonly signal?: AbortSignal;
}

/** 一次稳定 range read 的冻结结果；bytes 是调用方拥有的可变副本。 */
export interface StableFileRangeReadResult {
  readonly resourcePath: PortableResourcePath;
  readonly fileNode: Readonly<FileNodeSnapshot>;
  readonly fileByteCount: ByteCount;
  readonly range: Readonly<FileByteRange>;
  readonly bytes: Uint8Array;
  readonly rangeDigest: Sha256Digest;
}

/** 稳定文件 range read 失败分类。 */
export type StableFileRangeReadErrorReason =
  | "input"
  | "root-scope"
  | "not-found"
  | "symlink"
  | "not-file"
  | "expectation-changed"
  | "range-out-of-bounds"
  | "capture-too-large"
  | "open-failure"
  | "read-failure"
  | "hash-failure"
  | "source-changed"
  | "aborted"
  | "close-failure";

const ERROR_MESSAGES = {
  "input": "Stable file range read input is invalid.",
  "root-scope": "Stable file range read could not establish its rooted scope.",
  "not-found": "Stable file range read target does not exist.",
  "symlink": "Stable file range read target cannot be a symbolic link.",
  "not-file": "Stable file range read target must be a regular file.",
  "expectation-changed": "Stable file range read expected node no longer matches.",
  "range-out-of-bounds": "Requested file byte range lies outside the file.",
  "capture-too-large": "Requested file range exceeds the contiguous buffer limit.",
  "open-failure": "Stable file range target could not be opened safely.",
  "read-failure": "Requested file range bytes could not be read safely.",
  "hash-failure": "Requested file range digest could not be computed safely.",
  "source-changed": "Stable file range source changed while it was being read.",
  "aborted": "Stable file range read was aborted.",
  "close-failure": "Stable file range handle could not be closed safely.",
} as const satisfies Readonly<Record<
  StableFileRangeReadErrorReason,
  string
>>;

/**
 * stable file range read 的公共错误。
 *
 * 错误不回显物理路径、resource ref、range 数字、文件大小、字节、摘要、节点事实、
 * Abort reason 或 Node/lower-layer cause。
 */
export class StableFileRangeReadError extends Error {
  override readonly name = "StableFileRangeReadError";
  readonly code = "wakeflow-stable-file-range-read" as const;
  readonly reason: StableFileRangeReadErrorReason;
  readonly path: string;

  constructor(reason: StableFileRangeReadErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedOptions {
  readonly expectedNode: Readonly<FileNodeSnapshot> | undefined;
  readonly signal: AbortSignal | undefined;
}

function fail(
  reason: StableFileRangeReadErrorReason,
  path: string,
): never {
  throw new StableFileRangeReadError(reason, path);
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal
  );
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$signal");
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    fail("input", "$root");
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
    fail("input", "$options.expectedNode");
  }
  try {
    if (!sameFileNodeSnapshot(
      value as FileNodeSnapshot,
      value as FileNodeSnapshot,
    )) {
      fail("input", "$options.expectedNode");
    }
  } catch (error: unknown) {
    if (error instanceof FileNodeSnapshotError) {
      fail("input", "$options.expectedNode");
    }
    throw error;
  }
  const node = value as Readonly<FileNodeSnapshot>;
  if (node.kind !== "file") fail("input", "$options.expectedNode");
  return node;
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  const allowed = new Set(["expectedNode", "signal"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    fail("input", "$options");
  }
  const signal = record.signal;
  if (signal !== undefined && !isAbortSignal(signal)) {
    fail("input", "$options.signal");
  }
  return Object.freeze({
    expectedNode: parseExpectedNode(record.expectedNode),
    signal,
  });
}

function parseRange(value: FileByteRange): Readonly<FileByteRange> {
  try {
    assertFileByteRangeWithin(value, MAX_SAFE_BYTE_COUNT, "$range");
    return createFileByteRange(value.offset, value.length, "$range");
  } catch (error: unknown) {
    if (error instanceof FileByteRangeError) fail("input", "$range");
    throw error;
  }
}

function assertRangeWithinFile(
  range: Readonly<FileByteRange>,
  fileByteCount: ByteCount,
): void {
  try {
    assertFileByteRangeWithin(range, fileByteCount, "$range");
  } catch (error: unknown) {
    if (error instanceof FileByteRangeError) {
      if (error.reason === "out-of-bounds") {
        fail("range-out-of-bounds", "$range");
      }
      fail("input", "$range");
    }
    throw error;
  }
}

async function inspectInitialResource(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<Readonly<RootedResourceSnapshot>> {
  try {
    return await root.inspectExistingResource(resourcePath, "$resourcePath");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      if (error.reason === "resource-not-found") {
        fail("not-found", "$resourcePath");
      }
      if (error.reason === "resource-path") fail("input", "$resourcePath");
      fail("root-scope", "$resourcePath");
    }
    throw error;
  }
}

async function inspectFinalResource(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<Readonly<RootedResourceSnapshot>> {
  try {
    return await root.inspectExistingResource(resourcePath, "$resourcePath");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      fail("source-changed", "$resourcePath");
    }
    throw error;
  }
}

function assertRegularFile(
  resource: Readonly<RootedResourceSnapshot>,
): void {
  if (resource.node.kind === "symbolic-link") {
    fail("symlink", "$resourcePath");
  }
  if (resource.node.kind !== "file") fail("not-file", "$resourcePath");
}

function requiredOpenFlags(): number {
  const noFollow: unknown = fileSystemConstants.O_NOFOLLOW;
  if (typeof noFollow !== "number") fail("root-scope", "$root");
  const nonBlocking = typeof fileSystemConstants.O_NONBLOCK === "number"
    ? fileSystemConstants.O_NONBLOCK
    : 0;
  return fileSystemConstants.O_RDONLY | noFollow | nonBlocking;
}

async function openStableFile(
  initial: Readonly<RootedResourceSnapshot>,
): Promise<FileHandle> {
  const flags = requiredOpenFlags();
  try {
    return await openFileHandle(initial.physicalPath, flags);
  } catch (error: unknown) {
    const code = readNodeSystemErrorCode(error);
    if (code === "ELOOP" || code === "ENOENT" || code === "ENOTDIR") {
      fail("source-changed", "$resourcePath");
    }
    fail("open-failure", "$resourcePath");
  }
}

async function snapshotOpenedFile(
  handle: FileHandle,
): Promise<Readonly<FileNodeSnapshot>> {
  try {
    return createFileNodeSnapshot(
      await handle.stat({ bigint: true }),
      "$resourcePath",
    );
  } catch (error: unknown) {
    if (error instanceof FileNodeSnapshotError) {
      fail("source-changed", "$resourcePath");
    }
    fail("source-changed", "$resourcePath");
  }
}

function createCapture(length: ByteCount): Buffer {
  if (length > bufferConstants.MAX_LENGTH) {
    fail("capture-too-large", "$range");
  }
  try {
    return Buffer.allocUnsafe(length);
  } catch {
    fail("capture-too-large", "$range");
  }
}

async function readRangeBytes(
  handle: FileHandle,
  range: Readonly<FileByteRange>,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  const bytes = createCapture(range.length);
  let captured = 0;
  while (captured < range.length) {
    assertNotAborted(signal);
    const length = Math.min(
      STABLE_FILE_RANGE_READ_CHUNK_BYTES,
      range.length - captured,
    );
    let bytesRead: number;
    try {
      ({ bytesRead } = await handle.read(
        bytes,
        captured,
        length,
        range.offset + captured,
      ));
    } catch {
      assertNotAborted(signal);
      fail("read-failure", "$range");
    }
    if (bytesRead <= 0 || bytesRead > length) {
      fail("source-changed", "$range");
    }
    captured += bytesRead;
  }
  assertNotAborted(signal);
  return bytes;
}

function rangeDigest(bytes: Uint8Array): Sha256Digest {
  try {
    return computeSha256Digest(bytes, "$range");
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("hash-failure", "$range");
    throw error;
  }
}

/**
 * 从一个稳定 regular file 版本读取准确的半开 byte range。
 *
 * 返回 bytes 是新分配的调用方副本；fileNode/fileByteCount 描述读取后已复验的文件，
 * rangeDigest 仅描述 bytes。函数返回后文件仍可由另一个 actor 修改。
 */
export async function readStableFileRange(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  range: FileByteRange,
  options: StableFileRangeReadOptions,
): Promise<Readonly<StableFileRangeReadResult>> {
  assertRoot(root);
  const parsedOptions = parseOptions(options);
  const parsedRange = parseRange(range);
  assertNotAborted(parsedOptions.signal);

  const initial = await inspectInitialResource(root, resourcePath);
  assertRegularFile(initial);
  if (
    parsedOptions.expectedNode !== undefined
    && !sameFileNodeSnapshot(initial.node, parsedOptions.expectedNode)
  ) {
    fail("expectation-changed", "$resourcePath");
  }
  assertRangeWithinFile(parsedRange, initial.node.byteCount);
  if (parsedRange.length > bufferConstants.MAX_LENGTH) {
    fail("capture-too-large", "$range");
  }

  const handle = await openStableFile(initial);
  let primaryError: unknown;
  let result: Readonly<StableFileRangeReadResult> | undefined;
  try {
    const opened = await snapshotOpenedFile(handle);
    if (
      opened.kind !== "file"
      || !sameFileNodeSnapshot(initial.node, opened)
    ) {
      fail("source-changed", "$resourcePath");
    }
    assertRangeWithinFile(parsedRange, opened.byteCount);
    const bytes = await readRangeBytes(
      handle,
      parsedRange,
      parsedOptions.signal,
    );
    const digest = rangeDigest(bytes);
    const afterHandle = await snapshotOpenedFile(handle);
    const afterPath = await inspectFinalResource(root, resourcePath);
    if (
      afterPath.node.kind !== "file"
      || !sameFileNodeSnapshot(opened, afterHandle)
      || !sameFileNodeSnapshot(afterHandle, afterPath.node)
    ) {
      fail("source-changed", "$resourcePath");
    }
    assertNotAborted(parsedOptions.signal);
    result = Object.freeze({
      resourcePath,
      fileNode: afterPath.node,
      fileByteCount: afterPath.node.byteCount,
      range: parsedRange,
      bytes,
      rangeDigest: digest,
    });
  } catch (error: unknown) {
    primaryError = error;
  }

  try {
    await handle.close();
  } catch {
    if (primaryError === undefined) fail("close-failure", "$resourcePath");
  }
  if (primaryError !== undefined) throw primaryError;
  if (result === undefined) fail("read-failure", "$range");
  return result;
}
