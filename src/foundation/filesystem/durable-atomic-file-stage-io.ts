import { constants as fileSystemConstants } from "node:fs";
import { type FileHandle, lstat, open as openFileHandle, unlink } from "node:fs/promises";
import nodePath from "node:path";

import type { Sha256Digest } from "../crypto/sha256.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import {
  type DurableAtomicFileStageAddress,
  DurableAtomicFileStageAddressError,
  type DurableAtomicFileStageOperation,
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "./durable-atomic-file-stage-address.js";
import {
  DurableAtomicFileStageRecoveryError,
  recoverDurableAtomicFileStagesMatchingTargets,
} from "./durable-atomic-file-stage-recovery.js";
import {
  assertDurableAtomicFileNotAborted,
  type DurableAtomicFileInputBytes,
  DurableAtomicFileWriteError,
  type DurableAtomicFileWriteErrorReason,
  failDurableAtomicFileWrite as fail,
} from "./durable-atomic-file-write-contract.js";
import {
  createFileNodeSnapshot,
  type FileNodeSnapshot,
  sameFileNodeIdentity,
  sameFileNodeSnapshot,
} from "./file-node-snapshot.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import type { RootedDirectory, RootedDirectoryDurability } from "./rooted-directory.js";
import type { RootedResourceParentHandle } from "./rooted-resource-parent-handle.js";

/** 耐久原子写入中，自描述暂存文件的 I/O 生命周期。 */

const PRIVATE_STAGE_MODE = 0o600;
const STAGE_CREATE_ATTEMPTS = 4;
const VERIFY_CHUNK_BYTES = 512 * 1024;

export interface OpenDurableAtomicFileStage {
  readonly physicalPath: string;
  readonly handle: FileHandle;
  readonly address: Readonly<DurableAtomicFileStageAddress>;
}

export interface PreparedDurableAtomicFileStage extends OpenDurableAtomicFileStage {
  readonly node: Readonly<FileNodeSnapshot>;
}

function requiredStageOpenFlags(): number {
  const noFollow: unknown = fileSystemConstants.O_NOFOLLOW;
  if (typeof noFollow !== "number") fail("root-scope", "$root");
  return (
    fileSystemConstants.O_RDWR | fileSystemConstants.O_CREAT | fileSystemConstants.O_EXCL | noFollow
  );
}

export async function snapshotDurableAtomicFileHandle(
  handle: FileHandle,
  reason: DurableAtomicFileWriteErrorReason,
  path: string,
): Promise<Readonly<FileNodeSnapshot>> {
  try {
    return createFileNodeSnapshot(await handle.stat({ bigint: true }), path);
  } catch (cause: unknown) {
    fail(reason, path, cause);
  }
}

function allocateVerificationBuffer(
  byteLength: number,
  reason: "stage-changed" | "commit-uncertain",
  path: string,
): Buffer {
  try {
    return Buffer.allocUnsafe(byteLength);
  } catch (cause: unknown) {
    fail(reason, path, cause);
  }
}

export async function createExclusiveDurableAtomicFileStage(
  parent: RootedResourceParentHandle,
  operation: DurableAtomicFileStageOperation,
  resourcePath: PortableResourcePath,
  inputDigest: Sha256Digest,
  mode: number,
): Promise<Readonly<OpenDurableAtomicFileStage>> {
  const flags = requiredStageOpenFlags();
  for (let attempt = 0; attempt < STAGE_CREATE_ATTEMPTS; attempt += 1) {
    let address: Readonly<DurableAtomicFileStageAddress>;
    try {
      address = issueDurableAtomicFileStageAddress(operation, resourcePath, inputDigest, mode);
    } catch (error: unknown) {
      if (error instanceof DurableAtomicFileStageAddressError) {
        fail("stage-create-failure", "$stage", error);
      }
      throw error;
    }
    const physicalPath = nodePath.join(parent.parentAbsolutePath, address.fileName);
    try {
      const handle = await openFileHandle(physicalPath, flags, PRIVATE_STAGE_MODE);
      return Object.freeze({ physicalPath, handle, address });
    } catch (error: unknown) {
      releaseDurableAtomicFileStageAddress(address);
      if (readNodeSystemErrorCode(error) === "EEXIST") continue;
      fail("stage-create-failure", "$stage", error);
    }
  }
  fail("stage-create-failure", "$stage");
}

export async function recoverDurableAtomicFileStagesBeforeWrite(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    const receipt = await recoverDurableAtomicFileStagesMatchingTargets(
      root,
      [resourcePath],
      signal === undefined ? undefined : { signal },
    );
    if (receipt.unknownStageCount !== 0) {
      fail("stage-recovery-required", "$stage");
    }
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) throw error;
    if (error instanceof DurableAtomicFileStageRecoveryError) {
      if (error.reason === "aborted") fail("aborted", "$signal", error);
      if (error.reason === "input") fail("input", "$resourcePath", error);
      if (error.reason === "root-scope") fail("root-scope", "$root", error);
      // 并发写入活动暂存文件可能使稳定枚举暂时失败；不替换目标的提交点仍是安全边界。
      if (error.reason === "busy") return;
      fail("stage-recovery-required", "$stage", error);
    }
    throw error;
  }
}

async function writeExactBytes(
  handle: FileHandle,
  bytes: Uint8Array,
  signal: AbortSignal | undefined,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    assertDurableAtomicFileNotAborted(signal);
    let bytesWritten: number;
    try {
      ({ bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, offset));
    } catch (cause: unknown) {
      assertDurableAtomicFileNotAborted(signal);
      fail("stage-write-failure", "$stage", cause);
    }
    if (bytesWritten <= 0 || bytesWritten > bytes.byteLength - offset) {
      fail("stage-write-failure", "$stage");
    }
    offset += bytesWritten;
  }
}

export async function verifyDurableAtomicFileHandleBytes(
  handle: FileHandle,
  input: Readonly<DurableAtomicFileInputBytes>,
  signal: AbortSignal | undefined,
  reason: "stage-changed" | "commit-uncertain",
): Promise<Readonly<FileNodeSnapshot>> {
  const errorPath = reason === "stage-changed" ? "$stage/bytes" : "$resourcePath";
  const before = await snapshotDurableAtomicFileHandle(handle, reason, errorPath);
  const scratch = allocateVerificationBuffer(
    Math.min(VERIFY_CHUNK_BYTES, input.byteCount || 1),
    reason,
    errorPath,
  );
  let position = 0;
  while (position < input.byteCount) {
    if (reason === "stage-changed") {
      assertDurableAtomicFileNotAborted(signal);
    }
    const length = Math.min(scratch.byteLength, input.byteCount - position);
    let bytesRead: number;
    try {
      ({ bytesRead } = await handle.read(scratch, 0, length, position));
    } catch (cause: unknown) {
      if (reason === "stage-changed") {
        assertDurableAtomicFileNotAborted(signal);
      }
      fail(reason, errorPath, cause);
    }
    if (bytesRead <= 0 || bytesRead > length) fail(reason, errorPath);
    if (
      !scratch.subarray(0, bytesRead).equals(input.bytes.subarray(position, position + bytesRead))
    ) {
      fail(reason, errorPath);
    }
    position += bytesRead;
  }
  const growthProbe = allocateVerificationBuffer(1, reason, errorPath);
  try {
    const probe = await handle.read(growthProbe, 0, 1, input.byteCount);
    if (probe.bytesRead !== 0) fail(reason, errorPath);
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) throw error;
    if (reason === "stage-changed") {
      assertDurableAtomicFileNotAborted(signal);
    }
    fail(reason, errorPath, error);
  }
  const after = await snapshotDurableAtomicFileHandle(handle, reason, errorPath);
  if (!sameFileNodeSnapshot(before, after)) fail(reason, errorPath);
  return after;
}

export async function prepareDurableAtomicFileStage(
  exclusive: Readonly<OpenDurableAtomicFileStage>,
  input: Readonly<DurableAtomicFileInputBytes>,
  mode: number,
  signal: AbortSignal | undefined,
  durability: RootedDirectoryDurability,
): Promise<Readonly<PreparedDurableAtomicFileStage>> {
  await writeExactBytes(exclusive.handle, input.bytes, signal);
  assertDurableAtomicFileNotAborted(signal);
  try {
    await exclusive.handle.chmod(mode);
  } catch (cause: unknown) {
    fail("stage-write-failure", "$stage", cause);
  }
  const beforeSync = await snapshotDurableAtomicFileHandle(
    exclusive.handle,
    "stage-write-failure",
    "$stage",
  );
  if (
    beforeSync.kind !== "file" ||
    beforeSync.linkCount !== 1n ||
    beforeSync.byteCount !== input.byteCount ||
    beforeSync.permissionBits !== mode
  ) {
    fail("stage-write-failure", "$stage");
  }
  if (durability === "fsync") {
    try {
      await exclusive.handle.sync();
    } catch (cause: unknown) {
      fail("stage-sync-failure", "$stage", cause);
    }
  }
  const afterSync = await snapshotDurableAtomicFileHandle(
    exclusive.handle,
    "stage-changed",
    "$stage/after-sync",
  );
  if (!sameFileNodeSnapshot(beforeSync, afterSync)) {
    fail("stage-changed", "$stage/after-sync");
  }
  return Object.freeze({ ...exclusive, node: afterSync });
}

/**
 * 暂存在发布之前仍是它写下时的那个节点。`stage-changed` 有好几处会报，每一处带自己的位置记号
 * （open-items G8）：现场 L21 留下的那条事故只有 reason，五处检查里是哪一处判不出来，也复现不了。
 * 位置是错误的 `path`，事故记录把它记在 cause 链上；上层按 reason 映射，公开结果不变。
 */
export async function assertDurableAtomicFileStageCurrent(
  stage: Readonly<PreparedDurableAtomicFileStage>,
): Promise<void> {
  const handleNode = await snapshotDurableAtomicFileHandle(
    stage.handle,
    "stage-changed",
    "$stage/handle",
  );
  let pathNode: Readonly<FileNodeSnapshot>;
  try {
    pathNode = createFileNodeSnapshot(await lstat(stage.physicalPath, { bigint: true }), "$stage");
  } catch (cause: unknown) {
    // 暂存的名字不在了：被别的进程删掉或改名。
    fail("stage-changed", "$stage/path-missing", cause);
  }
  if (handleNode.kind !== "file" || pathNode.kind !== "file") {
    fail("stage-changed", "$stage/kind");
  }
  if (handleNode.linkCount !== 1n || pathNode.linkCount !== 1n) {
    fail("stage-changed", "$stage/link-count");
  }
  // 句柄上的节点与写完时记下的不同：内容、权限或时间戳在这之后被动过。
  if (!sameFileNodeSnapshot(stage.node, handleNode)) fail("stage-changed", "$stage/handle-node");
  // 名字现在指向的不是句柄打开的那个节点：名字被换成了别的文件。
  if (!sameFileNodeSnapshot(handleNode, pathNode)) fail("stage-changed", "$stage/path-node");
}

export async function unlinkOwnedDurableAtomicFileStage(
  stage: Readonly<OpenDurableAtomicFileStage>,
): Promise<void> {
  let pathNode: Readonly<FileNodeSnapshot>;
  try {
    pathNode = createFileNodeSnapshot(await lstat(stage.physicalPath, { bigint: true }), "$stage");
  } catch (error: unknown) {
    if (readNodeSystemErrorCode(error) === "ENOENT") return;
    fail("stage-cleanup-failure", "$stage", error);
  }
  const opened = await snapshotDurableAtomicFileHandle(
    stage.handle,
    "stage-cleanup-failure",
    "$stage",
  );
  if (
    pathNode.kind !== "file" ||
    opened.kind !== "file" ||
    (opened.linkCount !== 1n && opened.linkCount !== 2n) ||
    !sameFileNodeIdentity(pathNode, opened)
  ) {
    fail("stage-cleanup-failure", "$stage");
  }
  try {
    await unlink(stage.physicalPath);
  } catch (error: unknown) {
    if (readNodeSystemErrorCode(error) === "ENOENT") return;
    fail("stage-cleanup-failure", "$stage", error);
  }
  const afterUnlink = await snapshotDurableAtomicFileHandle(
    stage.handle,
    "stage-cleanup-failure",
    "$stage",
  );
  if (
    !sameFileNodeIdentity(opened, afterUnlink) ||
    afterUnlink.linkCount !== opened.linkCount - 1n
  ) {
    fail("stage-cleanup-failure", "$stage");
  }
}

export async function closeDurableAtomicFileStageHandle(
  handle: FileHandle,
): Promise<DurableAtomicFileWriteError | undefined> {
  try {
    await handle.close();
    return undefined;
  } catch {
    return new DurableAtomicFileWriteError("close-failure", "$resourcePath");
  }
}

export function releaseDurableAtomicFileStage(
  stage: Readonly<OpenDurableAtomicFileStage>,
): DurableAtomicFileWriteError | undefined {
  try {
    releaseDurableAtomicFileStageAddress(stage.address);
    return undefined;
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileStageAddressError) {
      return new DurableAtomicFileWriteError("stage-cleanup-failure", "$stage");
    }
    throw error;
  }
}
