import { Buffer } from "node:buffer";
import { constants as fileSystemConstants } from "node:fs";
import {
  open as openFileHandle,
  unlink,
  type FileHandle,
} from "node:fs/promises";

import type { Sha256Digest } from "../crypto/sha256.js";
import {
  Sha256Hasher,
  Sha256HasherError,
} from "../crypto/sha256-hasher.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import type { ByteCount } from "../numeric/byte-count.js";
import {
  sameFileNodeIdentity,
  sameFileNodeSnapshot,
  type FileNodeSnapshot,
} from "./file-node-snapshot.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
  type RootedResourceSnapshot,
} from "./rooted-directory.js";
import {
  RootedResourceParentHandle,
  RootedResourceParentHandleError,
} from "./rooted-resource-parent-handle.js";
import {
  assertDurableFileCopyNotAborted,
  assertDurableFileCopyRoot,
  failDurableFileCopyCandidate as fail,
  parseDurableFileCopyExpectation,
  parseDurableFileCopyOptions,
  parseDurableFileCopyPath,
  snapshotDurableFileCopyNode,
  DurableFileCopyCandidateError,
  type DurableFileCopyCandidateOptions,
  type DurableFileCopyCandidateResult,
  type DurableFileCopyContentExpectation,
  type ParsedDurableFileCopyExpectation,
} from "./durable-file-copy-candidate-contract.js";

const DURABLE_FILE_COPY_CANDIDATE_CHUNK_BYTES = 512 * 1024;

function allocateScratch(
  byteCount: ByteCount,
  path: "$source" | "$candidate",
): Buffer {
  try {
    return Buffer.allocUnsafe(Math.min(
      DURABLE_FILE_COPY_CANDIDATE_CHUNK_BYTES,
      byteCount || 1,
    ));
  } catch {
    fail("capacity", path);
  }
}

function createHasher(
  reason: "source-read-failure" | "candidate-changed",
  path: "$source" | "$candidate",
): Sha256Hasher {
  try {
    return new Sha256Hasher();
  } catch (error: unknown) {
    if (error instanceof Sha256HasherError) fail(reason, path);
    throw error;
  }
}

async function snapshotHandle(
  handle: FileHandle,
  reason:
    | "source-changed"
    | "candidate-changed"
    | "cleanup-failure",
  path: "$source" | "$candidate",
): Promise<Readonly<FileNodeSnapshot>> {
  try {
    return snapshotDurableFileCopyNode(
      await handle.stat({ bigint: true }),
      reason,
      path,
    );
  } catch (error: unknown) {
    if (error instanceof DurableFileCopyCandidateError) throw error;
    fail(reason, path);
  }
}

/**
 * Wakeflow Foundation / Filesystem：跨根流式复制的具名文件候选。
 *
 * 本能力把来源 `RootedDirectory` 中一个真实普通文件流式复制到目标根内尚不存在的
 * 具名候选路径。来源在打开前、复制后同时复验 pathname、inode 与完整节点快照；
 * 复制过程按固定分块计算 SHA-256，并与调用方给出的字节数和摘要预期比较。目标先以
 * `0600` exclusive/no-follow 创建，采用最终权限位后重新流式读取并散列，随后同步文件
 * 和父目录。
 *
 * 本能力不创建父目录、不发布最终树、不删除来源、不解释 executable 语义，也不把
 * 候选视为权威资源。失败时只删除仍可证明由本次调用独占、单链接且 inode 未变化的
 * 候选。公共输入、错误和被动准入由相邻 contract 唯一解释。
 */

async function inspectInitialSource(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  expectation: Readonly<ParsedDurableFileCopyExpectation>,
  maximumBytes: ByteCount,
): Promise<Readonly<RootedResourceSnapshot>> {
  let source: Readonly<RootedResourceSnapshot>;
  try {
    source = await root.inspectExistingResource(resourcePath, "$source");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      if (error.reason === "resource-not-found") {
        fail("source-not-found", "$source");
      }
      if (error.reason === "resource-path") {
        fail("input", "$sourceResourcePath");
      }
      fail("source-root-scope", "$sourceRoot");
    }
    throw error;
  }
  if (source.node.kind === "symbolic-link") {
    fail("source-symlink", "$source");
  }
  if (source.node.kind !== "file") fail("source-not-file", "$source");
  if (
    source.node.byteCount > maximumBytes
    || expectation.byteCount > maximumBytes
  ) {
    fail("capacity", "$source");
  }
  if (
    source.node.byteCount !== expectation.byteCount
    || (
      expectation.expectedNode !== undefined
      && !sameFileNodeSnapshot(source.node, expectation.expectedNode)
    )
  ) {
    fail("source-changed", "$source");
  }
  return source;
}

function sourceOpenFlags(): number {
  const noFollow: unknown = fileSystemConstants.O_NOFOLLOW;
  if (typeof noFollow !== "number") fail("source-root-scope", "$sourceRoot");
  const nonBlocking = typeof fileSystemConstants.O_NONBLOCK === "number"
    ? fileSystemConstants.O_NONBLOCK
    : 0;
  return fileSystemConstants.O_RDONLY | noFollow | nonBlocking;
}

function candidateOpenFlags(): number {
  const noFollow: unknown = fileSystemConstants.O_NOFOLLOW;
  if (typeof noFollow !== "number") {
    fail("destination-root-scope", "$destinationRoot");
  }
  return fileSystemConstants.O_RDWR
    | fileSystemConstants.O_CREAT
    | fileSystemConstants.O_EXCL
    | noFollow;
}

async function openSource(
  source: Readonly<RootedResourceSnapshot>,
): Promise<FileHandle> {
  try {
    return await openFileHandle(source.physicalPath, sourceOpenFlags());
  } catch (error: unknown) {
    const code = readNodeSystemErrorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
      fail("source-changed", "$source");
    }
    fail("source-read-failure", "$source");
  }
}

async function openDestinationParent(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<RootedResourceParentHandle> {
  try {
    return await RootedResourceParentHandle.open(
      root,
      resourcePath,
      "$candidateResourcePath",
    );
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      if (error.reason === "input") fail("input", "$candidateResourcePath");
      if (error.reason === "root-scope") {
        fail("destination-root-scope", "$destinationRoot");
      }
      fail("destination-parent", "$candidateResourcePath");
    }
    throw error;
  }
}

async function assertDestinationParentCurrent(
  parent: RootedResourceParentHandle,
  reason: "destination-parent" | "candidate-changed",
): Promise<void> {
  try {
    await parent.assertCurrent();
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      fail(reason, reason === "destination-parent"
        ? "$candidateResourcePath"
        : "$candidate");
    }
    throw error;
  }
}

async function inspectDestinationTarget(
  parent: RootedResourceParentHandle,
  reason: "destination-parent" | "candidate-changed",
): Promise<Readonly<FileNodeSnapshot> | null> {
  try {
    return await parent.inspectTarget();
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      fail(reason, reason === "destination-parent"
        ? "$candidateResourcePath"
        : "$candidate");
    }
    throw error;
  }
}

async function syncDestinationParent(
  parent: RootedResourceParentHandle,
): Promise<void> {
  try {
    await parent.sync();
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      fail("durability-failure", "$candidate");
    }
    throw error;
  }
}

async function writeChunk(
  handle: FileHandle,
  bytes: Buffer,
  length: number,
  position: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  let written = 0;
  while (written < length) {
    assertDurableFileCopyNotAborted(signal);
    let bytesWritten: number;
    try {
      ({ bytesWritten } = await handle.write(
        bytes,
        written,
        length - written,
        position + written,
      ));
    } catch {
      assertDurableFileCopyNotAborted(signal);
      fail("candidate-write-failure", "$candidate");
    }
    if (bytesWritten <= 0 || bytesWritten > length - written) {
      fail("candidate-write-failure", "$candidate");
    }
    written += bytesWritten;
  }
}

async function copySourceBytes(
  sourceHandle: FileHandle,
  candidateHandle: FileHandle,
  expectation: Readonly<ParsedDurableFileCopyExpectation>,
  signal: AbortSignal | undefined,
): Promise<Sha256Digest> {
  const scratch = allocateScratch(expectation.byteCount, "$source");
  const hasher = createHasher("source-read-failure", "$source");
  let position = 0;
  while (position < expectation.byteCount) {
    assertDurableFileCopyNotAborted(signal);
    const length = Math.min(
      scratch.byteLength,
      expectation.byteCount - position,
    );
    let bytesRead: number;
    try {
      ({ bytesRead } = await sourceHandle.read(
        scratch,
        0,
        length,
        position,
      ));
    } catch {
      assertDurableFileCopyNotAborted(signal);
      fail("source-read-failure", "$source");
    }
    if (bytesRead <= 0 || bytesRead > length) {
      fail("source-changed", "$source");
    }
    try {
      hasher.update(scratch.subarray(0, bytesRead), "$source");
    } catch (error: unknown) {
      if (error instanceof Sha256HasherError) {
        fail("source-read-failure", "$source");
      }
      throw error;
    }
    await writeChunk(
      candidateHandle,
      scratch,
      bytesRead,
      position,
      signal,
    );
    position += bytesRead;
  }

  assertDurableFileCopyNotAborted(signal);
  try {
    const probe = await sourceHandle.read(scratch, 0, 1, position);
    if (probe.bytesRead !== 0) fail("source-changed", "$source");
  } catch (error: unknown) {
    if (error instanceof DurableFileCopyCandidateError) throw error;
    assertDurableFileCopyNotAborted(signal);
    fail("source-read-failure", "$source");
  }
  try {
    const hashed = hasher.digest();
    if (hashed.byteCount !== expectation.byteCount) {
      fail("source-changed", "$source");
    }
    return hashed.digest;
  } catch (error: unknown) {
    if (error instanceof DurableFileCopyCandidateError) throw error;
    if (error instanceof Sha256HasherError) {
      fail("source-read-failure", "$source");
    }
    throw error;
  }
}

async function inspectFinalSource(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  sourceHandle: FileHandle,
  initial: Readonly<FileNodeSnapshot>,
): Promise<Readonly<FileNodeSnapshot>> {
  let opened: Readonly<FileNodeSnapshot>;
  let pathNode: Readonly<FileNodeSnapshot>;
  try {
    opened = await snapshotHandle(
      sourceHandle,
      "source-changed",
      "$source",
    );
    pathNode = (await root.inspectExistingResource(
      resourcePath,
      "$source",
    )).node;
  } catch (error: unknown) {
    if (error instanceof DurableFileCopyCandidateError) throw error;
    if (error instanceof RootedDirectoryError) {
      fail("source-changed", "$source");
    }
    fail("source-changed", "$source");
  }
  if (
    opened.kind !== "file"
    || pathNode.kind !== "file"
    || !sameFileNodeSnapshot(initial, opened)
    || !sameFileNodeSnapshot(opened, pathNode)
  ) {
    fail("source-changed", "$source");
  }
  return pathNode;
}

async function verifyCandidate(
  handle: FileHandle,
  expectation: Readonly<ParsedDurableFileCopyExpectation>,
  signal: AbortSignal | undefined,
): Promise<Readonly<FileNodeSnapshot>> {
  assertDurableFileCopyNotAborted(signal);
  const before = await snapshotHandle(
    handle,
    "candidate-changed",
    "$candidate",
  );
  const scratch = allocateScratch(expectation.byteCount, "$candidate");
  const hasher = createHasher("candidate-changed", "$candidate");
  let position = 0;
  while (position < expectation.byteCount) {
    assertDurableFileCopyNotAborted(signal);
    const length = Math.min(
      scratch.byteLength,
      expectation.byteCount - position,
    );
    let bytesRead: number;
    try {
      ({ bytesRead } = await handle.read(scratch, 0, length, position));
    } catch {
      assertDurableFileCopyNotAborted(signal);
      fail("candidate-changed", "$candidate");
    }
    if (bytesRead <= 0 || bytesRead > length) {
      fail("candidate-changed", "$candidate");
    }
    try {
      hasher.update(scratch.subarray(0, bytesRead), "$candidate");
    } catch (error: unknown) {
      if (error instanceof Sha256HasherError) {
        fail("candidate-changed", "$candidate");
      }
      throw error;
    }
    position += bytesRead;
  }
  assertDurableFileCopyNotAborted(signal);
  try {
    if ((await handle.read(scratch, 0, 1, position)).bytesRead !== 0) {
      fail("candidate-changed", "$candidate");
    }
  } catch (error: unknown) {
    if (error instanceof DurableFileCopyCandidateError) throw error;
    assertDurableFileCopyNotAborted(signal);
    fail("candidate-changed", "$candidate");
  }
  let digest: Sha256Digest;
  assertDurableFileCopyNotAborted(signal);
  try {
    const hashed = hasher.digest();
    if (hashed.byteCount !== expectation.byteCount) {
      fail("candidate-changed", "$candidate");
    }
    digest = hashed.digest;
  } catch (error: unknown) {
    if (error instanceof DurableFileCopyCandidateError) throw error;
    if (error instanceof Sha256HasherError) {
      fail("candidate-changed", "$candidate");
    }
    throw error;
  }
  const after = await snapshotHandle(
    handle,
    "candidate-changed",
    "$candidate",
  );
  if (
    digest !== expectation.digest
    || !sameFileNodeSnapshot(before, after)
  ) {
    fail("candidate-changed", "$candidate");
  }
  return after;
}

async function closeHandle(
  handle: FileHandle | undefined,
  path: string,
): Promise<DurableFileCopyCandidateError | undefined> {
  if (handle === undefined) return undefined;
  try {
    await handle.close();
    return undefined;
  } catch {
    return new DurableFileCopyCandidateError("close-failure", path);
  }
}

async function closeParent(
  parent: RootedResourceParentHandle | undefined,
): Promise<DurableFileCopyCandidateError | undefined> {
  if (parent === undefined) return undefined;
  try {
    await parent.close();
    return undefined;
  } catch {
    return new DurableFileCopyCandidateError(
      "close-failure",
      "$candidate",
    );
  }
}

function sameRetiredCandidateNode(
  before: Readonly<FileNodeSnapshot>,
  after: Readonly<FileNodeSnapshot>,
): boolean {
  return (
    sameFileNodeIdentity(before, after)
    && before.kind === "file"
    && after.kind === "file"
    && before.rawMode === after.rawMode
    && before.permissionBits === after.permissionBits
    && before.linkCount === 1n
    && after.linkCount === 0n
    && before.userId === after.userId
    && before.groupId === after.groupId
    && before.specialDeviceId === after.specialDeviceId
    && before.byteCount === after.byteCount
    && before.modifiedAtNanoseconds === after.modifiedAtNanoseconds
  );
}

/**
 * 按内容预期把一个来源普通文件流式复制为目标根内具名、非权威、已同步的候选文件。
 */
export async function copyFileToCandidateDurably(
  sourceRootValue: RootedDirectory,
  destinationRootValue: RootedDirectory,
  sourceResourcePathValue: PortableResourcePath,
  candidateResourcePathValue: PortableResourcePath,
  expectationValue: DurableFileCopyContentExpectation,
  optionsValue: DurableFileCopyCandidateOptions,
): Promise<Readonly<DurableFileCopyCandidateResult>> {
  assertDurableFileCopyRoot(sourceRootValue, "$sourceRoot");
  assertDurableFileCopyRoot(destinationRootValue, "$destinationRoot");
  const options = parseDurableFileCopyOptions(optionsValue);
  assertDurableFileCopyNotAborted(options.signal);
  const sourceResourcePath = parseDurableFileCopyPath(
    sourceResourcePathValue,
    "$sourceResourcePath",
  );
  const candidateResourcePath = parseDurableFileCopyPath(
    candidateResourcePathValue,
    "$candidateResourcePath",
  );
  const expectation = parseDurableFileCopyExpectation(expectationValue);
  if (expectation.byteCount > options.maximumBytes) {
    fail("capacity", "$source");
  }

  const initialSource = await inspectInitialSource(
    sourceRootValue,
    sourceResourcePath,
    expectation,
    options.maximumBytes,
  );
  let sourceHandle: FileHandle | undefined;
  let parent: RootedResourceParentHandle | undefined;
  let candidateHandle: FileHandle | undefined;
  let candidateCreated = false;
  let primaryError: unknown;
  let result: Readonly<DurableFileCopyCandidateResult> | undefined;

  try {
    sourceHandle = await openSource(initialSource);
    const openedSource = await snapshotHandle(
      sourceHandle,
      "source-changed",
      "$source",
    );
    if (
      openedSource.kind !== "file"
      || !sameFileNodeSnapshot(initialSource.node, openedSource)
    ) {
      fail("source-changed", "$source");
    }

    parent = await openDestinationParent(
      destinationRootValue,
      candidateResourcePath,
    );
    await assertDestinationParentCurrent(parent, "destination-parent");
    if (await inspectDestinationTarget(
      parent,
      "destination-parent",
    ) !== null) {
      fail("target-exists", "$candidateResourcePath");
    }
    try {
      candidateHandle = await openFileHandle(
        parent.resourceAbsolutePath,
        candidateOpenFlags(),
        0o600,
      );
      candidateCreated = true;
    } catch (error: unknown) {
      if (readNodeSystemErrorCode(error) === "EEXIST") {
        fail("target-exists", "$candidateResourcePath");
      }
      fail("candidate-create-failure", "$candidate");
    }

    const copiedDigest = await copySourceBytes(
      sourceHandle,
      candidateHandle,
      expectation,
      options.signal,
    );
    const finalSourceNode = await inspectFinalSource(
      sourceRootValue,
      sourceResourcePath,
      sourceHandle,
      openedSource,
    );
    if (copiedDigest !== expectation.digest) {
      fail("source-mismatch", "$source");
    }
    assertDurableFileCopyNotAborted(options.signal);
    try {
      await candidateHandle.chmod(options.mode);
    } catch {
      fail("candidate-write-failure", "$candidate");
    }
    let candidateNode = await verifyCandidate(
      candidateHandle,
      expectation,
      options.signal,
    );
    if (
      candidateNode.kind !== "file"
      || candidateNode.linkCount !== 1n
      || candidateNode.permissionBits !== options.mode
      || candidateNode.byteCount !== expectation.byteCount
    ) {
      fail("candidate-changed", "$candidate");
    }
    try {
      await candidateHandle.sync();
    } catch {
      fail("candidate-sync-failure", "$candidate");
    }
    candidateNode = await verifyCandidate(
      candidateHandle,
      expectation,
      options.signal,
    );
    await assertDestinationParentCurrent(parent, "candidate-changed");
    const pathNode = await inspectDestinationTarget(
      parent,
      "candidate-changed",
    );
    if (
      pathNode === null
      || !sameFileNodeSnapshot(candidateNode, pathNode)
    ) {
      fail("candidate-changed", "$candidate");
    }
    await syncDestinationParent(parent);
    const finalHandleNode = await snapshotHandle(
      candidateHandle,
      "candidate-changed",
      "$candidate",
    );
    const finalPathNode = await inspectDestinationTarget(
      parent,
      "candidate-changed",
    );
    if (
      finalPathNode === null
      || !sameFileNodeSnapshot(candidateNode, finalHandleNode)
      || !sameFileNodeSnapshot(finalHandleNode, finalPathNode)
    ) {
      fail("candidate-changed", "$candidate");
    }
    result = Object.freeze({
      source: Object.freeze({
        resourcePath: sourceResourcePath,
        node: finalSourceNode,
        byteCount: expectation.byteCount,
        digest: expectation.digest,
      }),
      candidate: Object.freeze({
        resourcePath: candidateResourcePath,
        node: finalPathNode,
        byteCount: expectation.byteCount,
        digest: expectation.digest,
      }),
    });
  } catch (error: unknown) {
    primaryError = error;
  }

  if (
    candidateCreated
    && result === undefined
    && candidateHandle !== undefined
    && parent !== undefined
  ) {
    try {
      const opened = await snapshotHandle(
        candidateHandle,
        "cleanup-failure",
        "$candidate",
      );
      const current = await parent.inspectTarget();
      if (
        current === null
        || opened.kind !== "file"
        || current.kind !== "file"
        || opened.linkCount !== 1n
        || !sameFileNodeSnapshot(opened, current)
      ) {
        fail("cleanup-failure", "$candidate");
      }
      await unlink(parent.resourceAbsolutePath);
      const retired = await snapshotHandle(
        candidateHandle,
        "cleanup-failure",
        "$candidate",
      );
      if (!sameRetiredCandidateNode(opened, retired)) {
        fail("cleanup-failure", "$candidate");
      }
      await parent.sync();
    } catch (error: unknown) {
      primaryError = error instanceof DurableFileCopyCandidateError
        ? error
        : new DurableFileCopyCandidateError(
            "cleanup-failure",
            "$candidate",
          );
    }
  }

  for (const closeError of [
    await closeHandle(candidateHandle, "$candidate"),
    await closeHandle(sourceHandle, "$source"),
    await closeParent(parent),
  ]) {
    if (primaryError === undefined && closeError !== undefined) {
      primaryError = closeError;
    }
  }
  if (primaryError !== undefined) throw primaryError;
  if (result === undefined) {
    fail("candidate-changed", "$candidate");
  }
  return result;
}

export {
  DurableFileCopyCandidateError,
  type DurableFileCopyCandidateErrorReason,
  type DurableFileCopyCandidateOptions,
  type DurableFileCopyContentExpectation,
} from "./durable-file-copy-candidate-contract.js";
