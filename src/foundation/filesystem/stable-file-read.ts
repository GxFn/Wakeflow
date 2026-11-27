import { constants as bufferConstants } from "node:buffer";
import { constants as fileSystemConstants } from "node:fs";
import { type FileHandle, open as openFileHandle } from "node:fs/promises";
import { join as joinPath } from "node:path";
import type { Sha256Digest } from "../crypto/sha256.js";
import { Sha256Hasher, Sha256HasherError } from "../crypto/sha256-hasher.js";
import { type Fail, failWith, ModuleError } from "../error/module-error.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import type { ByteCount } from "../numeric/byte-count.js";
import {
  createFileNodeSnapshot,
  type FileNodeSnapshot,
  FileNodeSnapshotError,
  sameFileNodeSnapshot,
} from "./file-node-snapshot.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import {
  type RootedDirectory,
  RootedDirectoryError,
  type RootedResourceSnapshot,
} from "./rooted-directory.js";
import { throwIfAborted } from "../node/abort-signal.js";

/**
 * Wakeflow Foundation / Filesystem：根作用域内稳定、有界的普通文件读取。
 *
 * 本模块在 `RootedDirectory` 下依次完成观察、预期节点检查、不跟随符号链接地打开、
 * 按位置分块读取并计算 SHA-256、文件末尾探测，以及句柄、路径和根目录复验。调用方
 * 必须显式提供最大字节数；需要完整内容时调用 `readStableFile`，只需要内容身份时
 * 调用 `readStableFileDigest`。两者共享同一读取内核，并且都只读取一个已打开的
 * `FileHandle`。
 *
 * 本层不解码文本、不解析 JSON、不判断所有者、权限位或硬链接策略，也不把成功读取
 * 解释为文件此后不可变或领域权威事实已经成立。
 */

/** regular-file positioned read 的内部性能参数，不属于公共容量合同。 */
const STABLE_FILE_READ_CHUNK_BYTES = 512 * 1024;

/**
 * 读取选项。`listed` 与 `expectedNode` 的关系由类型表达：列出来的一项必须带着列目录时看到的节点。
 */
export type StableFileReadOptions = {
  readonly maximumBytes: ByteCount;
  readonly signal?: AbortSignal;
} & (
  | {
      readonly listed?: undefined;
      readonly expectedNode?: Readonly<FileNodeSnapshot>;
    }
  | {
      /**
       * 调用方刚在 `root` 这个目录里列出了这一项，`expectedNode` 就是列目录时看到的节点，`resourcePath` 是它的
       * 名字（一段）：不再对这个名字读前读后各核对一次路径，直接不跟随符号链接地打开，在句柄上核对它就是列出来
       * 的那个文件，读完再核对句柄没有变（1.4.3，open-items B15）。目录本身由调用方在这一批读取前后各核对一次。
       * 不再发现的：读的过程中这个名字被换成别的文件或被删掉——读到的仍是列目录时那个文件的完整内容。
       */
      readonly listed: true;
      readonly expectedNode: Readonly<FileNodeSnapshot>;
    }
);

/** 一次稳定读取签发的物理源资源事实。 */
export interface StableFileSource {
  readonly resourcePath: PortableResourcePath;
  readonly node: Readonly<FileNodeSnapshot>;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
}

/** 完整 bytes 读取结果；bytes 是调用方拥有的可变副本。 */
export interface StableFileReadResult extends StableFileSource {
  readonly bytes: Uint8Array;
}

/** 稳定文件读取失败的精简分类。 */
export type StableFileReadErrorReason =
  | "input"
  | "unsupported-platform"
  | "root-scope"
  | "not-found"
  | "symlink"
  | "not-file"
  | "expectation-changed"
  | "too-large"
  | "io-failure"
  | "source-changed"
  | "close-failure";

/**
 * 稳定文件读取的公共、脱敏错误。
 *
 * 错误不回显物理路径、资源引用、文件字节、容量、摘要、取消原因或底层原因链。
 */
export class StableFileReadError extends ModuleError<StableFileReadErrorReason> {
  static override readonly code = "wakeflow-stable-file-read";
}

type StableFileReadMode = "bytes" | "digest";

interface InternalStableFileReadResult extends StableFileSource {
  readonly bytes: Uint8Array | null;
}

const fail: Fail<StableFileReadErrorReason> = failWith(StableFileReadError);

async function inspectInitialResource(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<Readonly<RootedResourceSnapshot>> {
  try {
    return await root.inspectExistingResource(resourcePath, "$resourcePath");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      if (error.reason === "resource-not-found") {
        fail("not-found", "$resourcePath", error);
      }
      if (error.reason === "resource-path") {
        fail("input", "$resourcePath", error);
      }
      if (error.reason === "resource-changed" || error.reason === "resource-alias") {
        fail("source-changed", "$resourcePath", error);
      }
      if (error.reason === "unsupported-platform") {
        fail("unsupported-platform", "$resourcePath", error);
      }
      fail("root-scope", "$resourcePath", error);
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
      fail("source-changed", "$resourcePath", error);
    }
    throw error;
  }
}

function assertRegularFile(node: Readonly<FileNodeSnapshot>): void {
  if (node.kind === "symbolic-link") fail("symlink", "$resourcePath");
  if (node.kind !== "file") fail("not-file", "$resourcePath");
}

/** 列出来的那一项在 `root` 目录里的物理路径：名字只能是一段，不经路径核对。 */
function listedPhysicalPath(root: RootedDirectory, resourcePath: PortableResourcePath): string {
  if (resourcePath.includes("/")) fail("input", "$resourcePath");
  return joinPath(root.absolutePath, resourcePath);
}

function assertExpectedNode(
  actual: Readonly<FileNodeSnapshot>,
  expected: Readonly<FileNodeSnapshot> | undefined,
): void {
  if (expected !== undefined && !sameFileNodeSnapshot(actual, expected)) {
    fail("expectation-changed", "$options.expectedNode");
  }
}

function assertWithinMaximum(byteCount: ByteCount, maximumBytes: ByteCount): void {
  if (byteCount > maximumBytes) fail("too-large", "$resourcePath");
}

async function snapshotOpenedFile(handle: FileHandle): Promise<Readonly<FileNodeSnapshot>> {
  let stats: Awaited<ReturnType<FileHandle["stat"]>>;
  try {
    stats = await handle.stat({ bigint: true });
  } catch (cause: unknown) {
    fail("source-changed", "$resourcePath", cause);
  }
  try {
    return createFileNodeSnapshot(stats, "$resourcePath");
  } catch (error: unknown) {
    if (error instanceof FileNodeSnapshotError) {
      fail("source-changed", "$resourcePath", error);
    }
    throw error;
  }
}

function requiredOpenFlags(): number {
  const noFollow: unknown = fileSystemConstants.O_NOFOLLOW;
  if (typeof noFollow !== "number") {
    fail("unsupported-platform", "$resourcePath");
  }
  const nonBlocking =
    typeof fileSystemConstants.O_NONBLOCK === "number" ? fileSystemConstants.O_NONBLOCK : 0;
  return fileSystemConstants.O_RDONLY | noFollow | nonBlocking;
}

async function openStableFile(physicalPath: string, listed: boolean): Promise<FileHandle> {
  try {
    return await openFileHandle(physicalPath, requiredOpenFlags());
  } catch (error: unknown) {
    // 列出来之后、打开之前被删掉的一项：没有读前的路径核对替它报"不在"，在这里报。
    if (listed && readNodeSystemErrorCode(error) === "ENOENT") {
      fail("not-found", "$resourcePath", error);
    }
    const code = readNodeSystemErrorCode(error);
    if (code === "ELOOP" || code === "ENOENT" || code === "ENOTDIR") {
      fail("source-changed", "$resourcePath", error);
    }
    fail("io-failure", "$resourcePath", error);
  }
}

/** 所有读取缓冲区分配失败都映射为稳定的运行时容量错误。 */
function allocateReadBuffer(byteLength: number): Buffer {
  try {
    return Buffer.allocUnsafe(byteLength);
  } catch (cause: unknown) {
    fail("too-large", "$resourcePath", cause);
  }
}

function createCapture(mode: StableFileReadMode, byteCount: ByteCount): Buffer | null {
  if (mode === "digest") return null;
  if (byteCount > bufferConstants.MAX_LENGTH) {
    fail("too-large", "$resourcePath");
  }
  return allocateReadBuffer(byteCount);
}

async function readExactFile(
  handle: FileHandle,
  byteCount: ByteCount,
  capture: Buffer | null,
  signal: AbortSignal | undefined,
): Promise<
  Readonly<{
    digest: Sha256Digest;
    bytes: Uint8Array | null;
  }>
> {
  const hasher = new Sha256Hasher();
  const scratch =
    capture === null
      ? allocateReadBuffer(Math.min(STABLE_FILE_READ_CHUNK_BYTES, byteCount || 1))
      : null;
  let position = 0;

  while (position < byteCount) {
    throwIfAborted(signal);
    const remaining = byteCount - position;
    const length = Math.min(STABLE_FILE_READ_CHUNK_BYTES, remaining);
    const target = capture ?? scratch;
    if (target === null) fail("io-failure", "$resourcePath");
    const offset = capture === null ? 0 : position;

    let bytesRead: number;
    try {
      ({ bytesRead } = await handle.read(target, offset, length, position));
    } catch (cause: unknown) {
      throwIfAborted(signal);
      fail("io-failure", "$resourcePath", cause);
    }
    if (bytesRead <= 0 || bytesRead > length) {
      fail("source-changed", "$resourcePath");
    }
    try {
      hasher.update(target.subarray(offset, offset + bytesRead));
    } catch (error: unknown) {
      if (error instanceof Sha256HasherError) {
        fail("io-failure", "$resourcePath", error);
      }
      throw error;
    }
    position += bytesRead;
  }

  throwIfAborted(signal);
  const growthProbe = allocateReadBuffer(1);
  try {
    const probe = await handle.read(growthProbe, 0, 1, byteCount);
    if (probe.bytesRead !== 0) fail("source-changed", "$resourcePath");
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) throw error;
    throwIfAborted(signal);
    fail("io-failure", "$resourcePath", error);
  }

  try {
    const result = hasher.digest();
    if (result.byteCount !== byteCount) fail("source-changed", "$resourcePath");
    return Object.freeze({ digest: result.digest, bytes: capture });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) throw error;
    if (error instanceof Sha256HasherError) fail("io-failure", "$resourcePath", error);
    throw error;
  }
}

async function readStableFileVersion(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  options: StableFileReadOptions,
  mode: StableFileReadMode,
): Promise<Readonly<InternalStableFileReadResult>> {
  const { maximumBytes, signal } = options;
  throwIfAborted(signal);

  // 列出来的一项以列目录时看到的节点为起点（类型保证它在）；否则先按路径看一次，再与预期比较。
  let initial: Readonly<RootedResourceSnapshot> | null = null;
  let initialNode: Readonly<FileNodeSnapshot>;
  if (options.listed === true) {
    initialNode = options.expectedNode;
    assertRegularFile(initialNode);
  } else {
    initial = await inspectInitialResource(root, resourcePath);
    initialNode = initial.node;
    assertRegularFile(initialNode);
    assertExpectedNode(initialNode, options.expectedNode);
  }
  assertWithinMaximum(initialNode.byteCount, maximumBytes);
  if (mode === "bytes" && initialNode.byteCount > bufferConstants.MAX_LENGTH) {
    fail("too-large", "$resourcePath");
  }

  const handle = await openStableFile(
    initial === null ? listedPhysicalPath(root, resourcePath) : initial.physicalPath,
    initial === null,
  );
  let primaryError: unknown;
  let result: Readonly<InternalStableFileReadResult> | undefined;
  try {
    const opened = await snapshotOpenedFile(handle);
    if (opened.kind !== "file" || !sameFileNodeSnapshot(initialNode, opened)) {
      fail(initial === null ? "expectation-changed" : "source-changed", "$resourcePath");
    }
    assertWithinMaximum(opened.byteCount, maximumBytes);

    const capture = createCapture(mode, opened.byteCount);
    const read = await readExactFile(handle, opened.byteCount, capture, signal);
    const afterHandle = await snapshotOpenedFile(handle);
    if (!sameFileNodeSnapshot(opened, afterHandle)) fail("source-changed", "$resourcePath");
    let finalNode = afterHandle;
    if (initial !== null) {
      const afterPath = await inspectFinalResource(root, resourcePath);
      if (afterPath.node.kind !== "file" || !sameFileNodeSnapshot(afterHandle, afterPath.node)) {
        fail("source-changed", "$resourcePath");
      }
      finalNode = afterPath.node;
    }
    throwIfAborted(signal);

    result = Object.freeze({
      resourcePath,
      node: finalNode,
      byteCount: finalNode.byteCount,
      digest: read.digest,
      bytes: read.bytes,
    });
  } catch (error: unknown) {
    primaryError = error;
  }

  try {
    await handle.close();
  } catch (cause: unknown) {
    if (primaryError === undefined) fail("close-failure", "$resourcePath", cause);
  }
  if (primaryError !== undefined) throw primaryError;
  if (result === undefined) fail("io-failure", "$resourcePath");
  return result;
}

/** 稳定读取普通文件的完整字节，并同时返回源摘要和最终节点事实。 */
export async function readStableFile(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  options: StableFileReadOptions,
): Promise<Readonly<StableFileReadResult>> {
  const result = await readStableFileVersion(root, resourcePath, options, "bytes");
  if (result.bytes === null) fail("io-failure", "$resourcePath");
  return Object.freeze({
    resourcePath: result.resourcePath,
    node: result.node,
    byteCount: result.byteCount,
    digest: result.digest,
    bytes: result.bytes,
  });
}

/**
 * 与 `readStableFile` 相同的读取，只是目标不在时返回 `null`（1.4.5）："不在"恰好是那边抛出 `not-found`
 * 的情形，不更宽；其余失败照旧抛出同样的错误。抛出的形式要保留 `not-found` 的原因链（公共错误投影读它），
 * 所以这里接住它，而不是在两处构造点各自返回。
 */
export async function readStableFileOrNull(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  options: StableFileReadOptions,
): Promise<Readonly<StableFileReadResult> | null> {
  try {
    return await readStableFile(root, resourcePath, options);
  } catch (error: unknown) {
    if (error instanceof StableFileReadError && error.reason === "not-found") return null;
    throw error;
  }
}

/** 流式读取并散列普通文件，不分配与完整文件等大的连续 Buffer。 */
export async function readStableFileDigest(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  options: StableFileReadOptions,
): Promise<Readonly<StableFileSource>> {
  const result = await readStableFileVersion(root, resourcePath, options, "digest");
  return Object.freeze({
    resourcePath: result.resourcePath,
    node: result.node,
    byteCount: result.byteCount,
    digest: result.digest,
  });
}
