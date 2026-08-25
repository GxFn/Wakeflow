import { constants as bufferConstants } from "node:buffer";
import { constants as fileSystemConstants } from "node:fs";
import {
  open as openFileHandle,
  type FileHandle,
} from "node:fs/promises";
import { types } from "node:util";

import {
  Sha256Hasher,
  Sha256HasherError,
} from "../crypto/sha256-hasher.js";
import type { Sha256Digest } from "../crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import {
  ByteCountError,
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
import type { PortableResourcePath } from "./portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
  type RootedResourceSnapshot,
} from "./rooted-directory.js";

/**
 * Wakeflow Foundation / Filesystem：根作用域内的稳定、有界 regular-file 读取。
 *
 * 本文件在 RootedDirectory 下完成 inspect→no-follow open→分块读取与 SHA-256→
 * growth probe→handle/path/root 复验。调用方必须显式提供最大字节数，并选择返回
 * 完整 bytes 或只返回 digest；两种模式都只对同一个打开 FileHandle 读取一次。
 *
 * 本层不解码文本、不解析 JSON、不判断 owner/mode/hardlink policy，也不把成功
 * 读取解释为文件之后不可变或领域 authority 已成立。
 */

/** 默认顺序读取 chunk；属于实现资源参数，不是领域文件容量。 */
export const STABLE_FILE_READ_CHUNK_BYTES = parseByteCount(64 * 1024);

export type StableFileCapture = "bytes" | "digest-only";

export interface StableFileReadOptions {
  readonly maximumBytes: ByteCount;
  readonly capture?: StableFileCapture;
  readonly signal?: AbortSignal;
}

interface StableFileReadBase {
  readonly resourcePath: PortableResourcePath;
  readonly node: Readonly<FileNodeSnapshot>;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
}

export type StableFileReadResult =
  | Readonly<StableFileReadBase & {
      readonly capture: "bytes";
      readonly bytes: Uint8Array;
    }>
  | Readonly<StableFileReadBase & {
      readonly capture: "digest-only";
      readonly bytes: null;
    }>;

/** 稳定文件读取失败的稳定分类。 */
export type StableFileReadErrorReason =
  | "input"
  | "root-scope"
  | "not-found"
  | "symlink"
  | "not-file"
  | "too-large"
  | "capture-too-large"
  | "open-failure"
  | "read-failure"
  | "hash-failure"
  | "source-changed"
  | "aborted"
  | "close-failure";

const ERROR_MESSAGES = {
  "input": "Stable file read input is invalid.",
  "root-scope": "Stable file read could not establish its rooted resource scope.",
  "not-found": "Stable file read target does not exist.",
  "symlink": "Stable file read target cannot be a symbolic link.",
  "not-file": "Stable file read target must be a regular file.",
  "too-large": "Stable file read target exceeds the caller byte limit.",
  "capture-too-large": "Stable file bytes exceed the Node.js contiguous buffer limit.",
  "open-failure": "Stable file read target could not be opened safely.",
  "read-failure": "Stable file bytes could not be read safely.",
  "hash-failure": "Stable file SHA-256 could not be computed safely.",
  "source-changed": "Stable file target changed while it was being read.",
  "aborted": "Stable file read was aborted.",
  "close-failure": "Stable file handle could not be closed safely.",
} as const satisfies Readonly<Record<StableFileReadErrorReason, string>>;

/**
 * 稳定文件读取的公共错误。
 *
 * 错误不回显物理路径、resource ref、文件字节、容量、摘要、Abort reason 或
 * Node/OpenSSL cause。
 */
export class StableFileReadError extends Error {
  override readonly name = "StableFileReadError";
  readonly code = "wakeflow-stable-file-read" as const;
  readonly reason: StableFileReadErrorReason;
  readonly path: string;

  constructor(reason: StableFileReadErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedStableFileReadOptions {
  readonly maximumBytes: ByteCount;
  readonly capture: StableFileCapture;
  readonly signal: AbortSignal | undefined;
}

function fail(
  reason: StableFileReadErrorReason,
  path: string,
): never {
  throw new StableFileReadError(reason, path);
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal
  );
}

function parseOptions(value: unknown): ParsedStableFileReadOptions {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  const keys = Object.keys(record).sort();
  const allowed = new Set(["capture", "maximumBytes", "signal"]);
  if (
    !Object.hasOwn(record, "maximumBytes")
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
  const capture = record.capture ?? "bytes";
  if (capture !== "bytes" && capture !== "digest-only") {
    fail("input", "$options.capture");
  }
  const signal = record.signal;
  if (signal !== undefined && !isAbortSignal(signal)) {
    fail("input", "$options.signal");
  }
  return Object.freeze({ maximumBytes, capture, signal });
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
      if (error.reason === "resource-path") {
        fail("input", "$resourcePath");
      }
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
  if (resource.node.kind === "symbolic-link") fail("symlink", "$resourcePath");
  if (resource.node.kind !== "file") fail("not-file", "$resourcePath");
}

function assertWithinMaximum(
  byteCount: ByteCount,
  maximumBytes: ByteCount,
): void {
  if (byteCount > maximumBytes) fail("too-large", "$resourcePath");
}

async function snapshotOpenedFile(
  handle: FileHandle,
): Promise<Readonly<FileNodeSnapshot>> {
  let stats: Awaited<ReturnType<FileHandle["stat"]>>;
  try {
    stats = await handle.stat({ bigint: true });
  } catch {
    fail("source-changed", "$resourcePath");
  }
  try {
    return createFileNodeSnapshot(stats, "$resourcePath");
  } catch (error: unknown) {
    if (error instanceof FileNodeSnapshotError) {
      fail("source-changed", "$resourcePath");
    }
    throw error;
  }
}

function openFlags(): number {
  const noFollow = typeof fileSystemConstants.O_NOFOLLOW === "number"
    ? fileSystemConstants.O_NOFOLLOW
    : 0;
  const nonBlocking = typeof fileSystemConstants.O_NONBLOCK === "number"
    ? fileSystemConstants.O_NONBLOCK
    : 0;
  return fileSystemConstants.O_RDONLY | noFollow | nonBlocking;
}

async function openStableFile(
  initial: Readonly<RootedResourceSnapshot>,
): Promise<FileHandle> {
  try {
    return await openFileHandle(initial.physicalPath, openFlags());
  } catch (error: unknown) {
    const code = readNodeSystemErrorCode(error);
    if (code === "ELOOP") fail("symlink", "$resourcePath");
    if (code === "ENOENT") fail("source-changed", "$resourcePath");
    fail("open-failure", "$resourcePath");
  }
}

function createCapture(
  capture: StableFileCapture,
  byteCount: ByteCount,
): Buffer | null {
  if (capture === "digest-only") return null;
  if (byteCount > bufferConstants.MAX_LENGTH) {
    fail("capture-too-large", "$resourcePath");
  }
  try {
    return Buffer.allocUnsafe(byteCount);
  } catch {
    fail("capture-too-large", "$resourcePath");
  }
}

async function readExactFile(
  handle: FileHandle,
  byteCount: ByteCount,
  capture: Buffer | null,
  signal: AbortSignal | undefined,
): Promise<{
  readonly digest: Sha256Digest;
  readonly bytes: Uint8Array | null;
}> {
  const hasher = new Sha256Hasher();
  const scratch = capture === null
    ? Buffer.allocUnsafe(Math.min(STABLE_FILE_READ_CHUNK_BYTES, byteCount || 1))
    : null;
  let position = 0;

  while (position < byteCount) {
    assertNotAborted(signal);
    const remaining = byteCount - position;
    const length = Math.min(STABLE_FILE_READ_CHUNK_BYTES, remaining);
    const target = capture ?? scratch;
    if (target === null) fail("read-failure", "$resourcePath");
    const offset = capture === null ? 0 : position;

    let bytesRead: number;
    try {
      ({ bytesRead } = await handle.read(
        target,
        offset,
        length,
        position,
      ));
    } catch {
      assertNotAborted(signal);
      fail("read-failure", "$resourcePath");
    }
    if (bytesRead <= 0 || bytesRead > length) {
      fail("source-changed", "$resourcePath");
    }
    try {
      hasher.update(target.subarray(offset, offset + bytesRead));
    } catch (error: unknown) {
      if (error instanceof Sha256HasherError) {
        fail("hash-failure", "$resourcePath");
      }
      throw error;
    }
    position += bytesRead;
  }

  assertNotAborted(signal);
  const growthProbe = Buffer.allocUnsafe(1);
  try {
    const probe = await handle.read(growthProbe, 0, 1, byteCount);
    if (probe.bytesRead !== 0) fail("source-changed", "$resourcePath");
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) throw error;
    assertNotAborted(signal);
    fail("read-failure", "$resourcePath");
  }

  try {
    const result = hasher.digest();
    if (result.byteCount !== byteCount) fail("source-changed", "$resourcePath");
    return Object.freeze({
      digest: result.digest,
      bytes: capture,
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) throw error;
    if (error instanceof Sha256HasherError) fail("hash-failure", "$resourcePath");
    throw error;
  }
}

/**
 * 在一个打开的 RootedDirectory 下稳定读取 regular file。
 *
 * 返回的 bytes 是本次读取新分配、由调用方拥有的可变副本；digest、node 与
 * byteCount 描述读取完成时已经复验的源事实，不承诺文件在返回后继续不变。
 */
export async function readStableFile(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  options: StableFileReadOptions,
): Promise<StableFileReadResult> {
  assertRoot(root);
  const parsed = parseOptions(options);
  assertNotAborted(parsed.signal);

  const initial = await inspectInitialResource(root, resourcePath);
  assertRegularFile(initial);
  assertWithinMaximum(initial.node.byteCount, parsed.maximumBytes);
  if (
    parsed.capture === "bytes"
    && initial.node.byteCount > bufferConstants.MAX_LENGTH
  ) {
    fail("capture-too-large", "$resourcePath");
  }

  const handle = await openStableFile(initial);
  let primaryError: unknown;
  let result: StableFileReadResult | undefined;
  try {
    const opened = await snapshotOpenedFile(handle);
    if (
      opened.kind !== "file"
      || !sameFileNodeSnapshot(initial.node, opened)
    ) {
      fail("source-changed", "$resourcePath");
    }
    assertWithinMaximum(opened.byteCount, parsed.maximumBytes);

    const capture = createCapture(parsed.capture, opened.byteCount);
    const read = await readExactFile(
      handle,
      opened.byteCount,
      capture,
      parsed.signal,
    );
    const afterHandle = await snapshotOpenedFile(handle);
    const afterPath = await inspectFinalResource(root, resourcePath);
    if (
      afterPath.node.kind !== "file"
      || !sameFileNodeSnapshot(opened, afterHandle)
      || !sameFileNodeSnapshot(afterHandle, afterPath.node)
    ) {
      fail("source-changed", "$resourcePath");
    }
    assertNotAborted(parsed.signal);

    const base = {
      resourcePath,
      node: afterPath.node,
      byteCount: afterPath.node.byteCount,
      digest: read.digest,
    } as const;
    result = parsed.capture === "bytes"
      ? Object.freeze({
          ...base,
          capture: "bytes" as const,
          bytes: read.bytes as Uint8Array,
        })
      : Object.freeze({
          ...base,
          capture: "digest-only" as const,
          bytes: null,
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
  if (result === undefined) fail("read-failure", "$resourcePath");
  return result;
}
