import { constants as fileSystemConstants } from "node:fs";
import {
  lstat,
  open as openFileHandle,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import nodePath from "node:path";

import type { Sha256Digest } from "../crypto/sha256.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import {
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
  DurableAtomicFileStageAddressError,
  type DurableAtomicFileStageAddress,
  type DurableAtomicFileStageOperation,
} from "./durable-atomic-file-stage-address.js";
import {
  recoverDurableAtomicFileStagesMatchingTargets,
  DurableAtomicFileStageRecoveryError,
} from "./durable-atomic-file-stage-recovery.js";
import {
  assertDurableAtomicFileNotAborted,
  failDurableAtomicFileWrite as fail,
  DurableAtomicFileWriteError,
  type DurableAtomicFileInputBytes,
  type DurableAtomicFileWriteErrorReason,
} from "./durable-atomic-file-write-contract.js";
import {
  createFileNodeSnapshot,
  sameFileNodeIdentity,
  sameFileNodeSnapshot,
  type FileNodeSnapshot,
} from "./file-node-snapshot.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import type { RootedDirectory } from "./rooted-directory.js";
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

export interface PreparedDurableAtomicFileStage
  extends OpenDurableAtomicFileStage {
  readonly node: Readonly<FileNodeSnapshot>;
}

function requiredStageOpenFlags(): number {
  const noFollow: unknown = fileSystemConstants.O_NOFOLLOW;
  if (typeof noFollow !== "number") fail("root-scope", "$root");
  return fileSystemConstants.O_RDWR
    | fileSystemConstants.O_CREAT
    | fileSystemConstants.O_EXCL
    | noFollow;
}

export async function snapshotDurableAtomicFileHandle(
  handle: FileHandle,
  reason: DurableAtomicFileWriteErrorReason,
  path: string,
): Promise<Readonly<FileNodeSnapshot>> {
  try {
    return createFileNodeSnapshot(await handle.stat({ bigint: true }), path);
  } catch {
    fail(reason, path);
  }
}

function allocateVerificationBuffer(
  byteLength: number,
  reason: "stage-changed" | "commit-uncertain",
  path: string,
): Buffer {
  try {
    return Buffer.allocUnsafe(byteLength);
  } catch {
    fail(reason, path);
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
      address = issueDurableAtomicFileStageAddress(
        operation,
        resourcePath,
        inputDigest,
        mode,
      );
    } catch (error: unknown) {
      if (error instanceof DurableAtomicFileStageAddressError) {
        fail("stage-create-failure", "$stage");
      }
      throw error;
    }
    const physicalPath = nodePath.join(
      parent.parentAbsolutePath,
      address.fileName,
    );
    try {
      const handle = await openFileHandle(
        physicalPath,
        flags,
        PRIVATE_STAGE_MODE,
      );
      return Object.freeze({ physicalPath, handle, address });
    } catch (error: unknown) {
      releaseDurableAtomicFileStageAddress(address);
      if (readNodeSystemErrorCode(error) === "EEXIST") continue;
      fail("stage-create-failure", "$stage");
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
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "input") fail("input", "$resourcePath");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      // 并发写入活动暂存文件可能使稳定枚举暂时失败；不替换目标的提交点仍是安全边界。
      if (error.reason === "busy") return;
      fail("stage-recovery-required", "$stage");
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
      ({ bytesWritten } = await handle.write(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset,
      ));
    } catch {
      assertDurableAtomicFileNotAborted(signal);
      fail("stage-write-failure", "$stage");
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
  const errorPath = reason === "stage-changed" ? "$stage" : "$resourcePath";
  const before = await snapshotDurableAtomicFileHandle(
    handle,
    reason,
    errorPath,
  );
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
    } catch {
      if (reason === "stage-changed") {
        assertDurableAtomicFileNotAborted(signal);
      }
      fail(reason, errorPath);
    }
    if (bytesRead <= 0 || bytesRead > length) fail(reason, errorPath);
    if (!scratch.subarray(0, bytesRead).equals(
      input.bytes.subarray(position, position + bytesRead),
    )) {
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
    fail(reason, errorPath);
  }
  const after = await snapshotDurableAtomicFileHandle(
    handle,
    reason,
    errorPath,
  );
  if (!sameFileNodeSnapshot(before, after)) fail(reason, errorPath);
  return after;
}

export async function prepareDurableAtomicFileStage(
  exclusive: Readonly<OpenDurableAtomicFileStage>,
  input: Readonly<DurableAtomicFileInputBytes>,
  mode: number,
  signal: AbortSignal | undefined,
): Promise<Readonly<PreparedDurableAtomicFileStage>> {
  await writeExactBytes(exclusive.handle, input.bytes, signal);
  assertDurableAtomicFileNotAborted(signal);
  try {
    await exclusive.handle.chmod(mode);
  } catch {
    fail("stage-write-failure", "$stage");
  }
  const beforeSync = await snapshotDurableAtomicFileHandle(
    exclusive.handle,
    "stage-write-failure",
    "$stage",
  );
  if (
    beforeSync.kind !== "file"
    || beforeSync.linkCount !== 1n
    || beforeSync.byteCount !== input.byteCount
    || beforeSync.permissionBits !== mode
  ) {
    fail("stage-write-failure", "$stage");
  }
  try {
    await exclusive.handle.sync();
  } catch {
    fail("stage-sync-failure", "$stage");
  }
  const afterSync = await snapshotDurableAtomicFileHandle(
    exclusive.handle,
    "stage-changed",
    "$stage",
  );
  if (!sameFileNodeSnapshot(beforeSync, afterSync)) {
    fail("stage-changed", "$stage");
  }
  return Object.freeze({ ...exclusive, node: afterSync });
}

export async function assertDurableAtomicFileStageCurrent(
  stage: Readonly<PreparedDurableAtomicFileStage>,
): Promise<void> {
  const handleNode = await snapshotDurableAtomicFileHandle(
    stage.handle,
    "stage-changed",
    "$stage",
  );
  let pathNode: Readonly<FileNodeSnapshot>;
  try {
    pathNode = createFileNodeSnapshot(
      await lstat(stage.physicalPath, { bigint: true }),
      "$stage",
    );
  } catch {
    fail("stage-changed", "$stage");
  }
  if (
    handleNode.kind !== "file"
    || pathNode.kind !== "file"
    || handleNode.linkCount !== 1n
    || pathNode.linkCount !== 1n
    || !sameFileNodeSnapshot(stage.node, handleNode)
    || !sameFileNodeSnapshot(handleNode, pathNode)
  ) {
    fail("stage-changed", "$stage");
  }
}

export async function unlinkOwnedDurableAtomicFileStage(
  stage: Readonly<OpenDurableAtomicFileStage>,
): Promise<void> {
  let pathNode: Readonly<FileNodeSnapshot>;
  try {
    pathNode = createFileNodeSnapshot(
      await lstat(stage.physicalPath, { bigint: true }),
      "$stage",
    );
  } catch (error: unknown) {
    if (readNodeSystemErrorCode(error) === "ENOENT") return;
    fail("stage-cleanup-failure", "$stage");
  }
  const opened = await snapshotDurableAtomicFileHandle(
    stage.handle,
    "stage-cleanup-failure",
    "$stage",
  );
  if (
    pathNode.kind !== "file"
    || opened.kind !== "file"
    || (opened.linkCount !== 1n && opened.linkCount !== 2n)
    || !sameFileNodeIdentity(pathNode, opened)
  ) {
    fail("stage-cleanup-failure", "$stage");
  }
  try {
    await unlink(stage.physicalPath);
  } catch (error: unknown) {
    if (readNodeSystemErrorCode(error) === "ENOENT") return;
    fail("stage-cleanup-failure", "$stage");
  }
  const afterUnlink = await snapshotDurableAtomicFileHandle(
    stage.handle,
    "stage-cleanup-failure",
    "$stage",
  );
  if (
    !sameFileNodeIdentity(opened, afterUnlink)
    || afterUnlink.linkCount !== opened.linkCount - 1n
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
      return new DurableAtomicFileWriteError(
        "stage-cleanup-failure",
        "$stage",
      );
    }
    throw error;
  }
}
