import { Buffer } from "node:buffer";
import { constants as fileSystemConstants } from "node:fs";
import {
  open as openFileHandle,
  unlink,
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
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import {
  parseByteCount,
  type ByteCount,
} from "../numeric/byte-count.js";
import {
  createFileNodeSnapshot,
  sameFileNodeIdentity,
  sameFileNodeSnapshot,
  type FileNodeSnapshot,
} from "./file-node-snapshot.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import { RootedDirectory } from "./rooted-directory.js";
import {
  RootedResourceParentHandle,
  RootedResourceParentHandleError,
} from "./rooted-resource-parent-handle.js";

/**
 * Wakeflow Foundation / Filesystem：具名、可恢复的非权威文件候选资源。
 *
 * 本能力直接使用 `O_CREAT|O_EXCL|O_NOFOLLOW`，在调用方拥有的明确路径创建候选文件。
 * 完整写入、设置最终权限位、复验字节并同步文件和父目录后才返回。它不再创建匿名
 * 暂存文件，因此进程崩溃只会留下调用方能够按自身命名协议识别的部分或完整候选。
 * 候选文件本身不是权威事实；调用方必须另用不替换目标的链接或重命名建立业务提交点，
 * 并负责判断崩溃残留的职责所有者、活动状态和清理条件。
 *
 * 本能力不覆盖已有文件、不发布最终目标、不自动接管崩溃残留，也不解释领域字节。
 * Node.js 未暴露 `openat`，因此路径名竞态边界与 `RootedDirectory` 保持一致。
 */

interface DurableFileCandidateOptions {
  readonly mode: number;
  readonly signal?: AbortSignal;
}

interface DurableFileCandidateResult {
  readonly resourcePath: PortableResourcePath;
  readonly node: Readonly<FileNodeSnapshot>;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
}

type DurableFileCandidateErrorReason =
  | "input"
  | "capacity"
  | "hash-failure"
  | "root-scope"
  | "parent"
  | "target-exists"
  | "create-failure"
  | "write-failure"
  | "sync-failure"
  | "candidate-changed"
  | "durability-failure"
  | "cleanup-failure"
  | "aborted"
  | "close-failure";

const ERROR_MESSAGES = {
  "input": "Durable file candidate input is invalid.",
  "capacity": "Durable file candidate exceeds its byte capacity.",
  "hash-failure": "Durable file candidate bytes could not be hashed.",
  "root-scope": "Durable file candidate lost its rooted scope.",
  "parent": "Durable file candidate parent is unavailable or unsafe.",
  "target-exists": "Durable file candidate target already exists.",
  "create-failure": "Durable file candidate could not be created exclusively.",
  "write-failure": "Durable file candidate bytes could not be written exactly.",
  "sync-failure": "Durable file candidate could not synchronize its bytes.",
  "candidate-changed": "Durable file candidate changed during preparation.",
  "durability-failure": "Durable file candidate directory entry could not be synchronized.",
  "cleanup-failure": "Failed durable file candidate could not be retired exactly.",
  "aborted": "Durable file candidate preparation was aborted.",
  "close-failure": "Durable file candidate handle could not be closed.",
} as const satisfies Readonly<Record<
  DurableFileCandidateErrorReason,
  string
>>;

export class DurableFileCandidateError extends Error {
  override readonly name = "DurableFileCandidateError";
  readonly code = "wakeflow-durable-file-candidate" as const;
  readonly reason: DurableFileCandidateErrorReason;
  readonly path: string;

  constructor(reason: DurableFileCandidateErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedOptions {
  readonly mode: number;
  readonly signal: AbortSignal | undefined;
}

interface InputBytes {
  readonly bytes: Buffer;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
}

/** 与耐久原子单文件写入一致的Foundation单文件硬上限。 */
const DURABLE_FILE_CANDIDATE_MAXIMUM_BYTES = parseByteCount(
  64 * 1024 * 1024,
  "$durableFileCandidate.maximumBytes",
);

function fail(reason: DurableFileCandidateErrorReason, path: string): never {
  throw new DurableFileCandidateError(reason, path);
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

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (
    !Object.hasOwn(record, "mode")
    || Object.keys(record).some((key) => key !== "mode" && key !== "signal")
    || typeof record.mode !== "number"
    || !Number.isInteger(record.mode)
    || record.mode < 0
    || record.mode > 0o777
    || (
      record.signal !== undefined
      && (
        types.isProxy(record.signal)
        || !(record.signal instanceof AbortSignal)
      )
    )
  ) {
    fail("input", "$options");
  }
  return Object.freeze({
    mode: record.mode,
    signal: record.signal as AbortSignal | undefined,
  });
}

function snapshotInput(value: unknown): Readonly<InputBytes> {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !ArrayBuffer.isView(value)
    || !(value instanceof Uint8Array)
    || value.buffer instanceof SharedArrayBuffer
  ) {
    fail("input", "$bytes");
  }
  const byteCount = parseByteCount(value.byteLength, "$bytes");
  if (byteCount > DURABLE_FILE_CANDIDATE_MAXIMUM_BYTES) {
    fail("capacity", "$bytes");
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(value);
  } catch {
    fail("capacity", "$bytes");
  }
  let digest: Sha256Digest;
  try {
    digest = computeSha256Digest(bytes, "$bytes");
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("hash-failure", "$bytes");
    throw error;
  }
  return Object.freeze({
    bytes,
    byteCount,
    digest,
  });
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$signal");
}

function openFlags(): number {
  const noFollow: unknown = fileSystemConstants.O_NOFOLLOW;
  if (typeof noFollow !== "number") fail("root-scope", "$root");
  return fileSystemConstants.O_RDWR
    | fileSystemConstants.O_CREAT
    | fileSystemConstants.O_EXCL
    | noFollow;
}

function snapshotNode(
  value: unknown,
  reason: DurableFileCandidateErrorReason,
): Readonly<FileNodeSnapshot> {
  try {
    return createFileNodeSnapshot(value, "$candidate");
  } catch {
    fail(reason, "$candidate");
  }
}

async function snapshotHandle(
  handle: FileHandle,
  reason: DurableFileCandidateErrorReason,
): Promise<Readonly<FileNodeSnapshot>> {
  try {
    return snapshotNode(await handle.stat({ bigint: true }), reason);
  } catch (error: unknown) {
    if (error instanceof DurableFileCandidateError) throw error;
    fail(reason, "$candidate");
  }
}

async function assertParentCurrent(
  parent: RootedResourceParentHandle,
  reason: "parent" | "candidate-changed",
  path: "$resourcePath" | "$candidate",
): Promise<void> {
  try {
    await parent.assertCurrent();
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) fail(reason, path);
    throw error;
  }
}

async function inspectParentTarget(
  parent: RootedResourceParentHandle,
  reason: "parent" | "candidate-changed",
  path: "$resourcePath" | "$candidate",
): Promise<Readonly<FileNodeSnapshot> | null> {
  try {
    return await parent.inspectTarget();
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) fail(reason, path);
    throw error;
  }
}

async function syncParent(
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

async function writeAll(
  handle: FileHandle,
  bytes: Uint8Array,
  signal: AbortSignal | undefined,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    assertNotAborted(signal);
    let written: number;
    try {
      ({ bytesWritten: written } = await handle.write(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset,
      ));
    } catch {
      assertNotAborted(signal);
      fail("write-failure", "$candidate");
    }
    if (written <= 0 || written > bytes.byteLength - offset) {
      fail("write-failure", "$candidate");
    }
    offset += written;
  }
}

async function verifyBytes(
  handle: FileHandle,
  input: Readonly<InputBytes>,
  signal: AbortSignal | undefined,
): Promise<Readonly<FileNodeSnapshot>> {
  const before = await snapshotHandle(handle, "candidate-changed");
  let scratch: Buffer;
  try {
    scratch = Buffer.allocUnsafe(
      Math.min(input.byteCount || 1, 512 * 1024),
    );
  } catch {
    fail("candidate-changed", "$candidate");
  }
  let offset = 0;
  while (offset < input.byteCount) {
    assertNotAborted(signal);
    const length = Math.min(scratch.byteLength, input.byteCount - offset);
    let filled = 0;
    while (filled < length) {
      let read: number;
      try {
        ({ bytesRead: read } = await handle.read(
          scratch,
          filled,
          length - filled,
          offset + filled,
        ));
      } catch {
        assertNotAborted(signal);
        fail("candidate-changed", "$candidate");
      }
      if (read <= 0 || read > length - filled) {
        fail("candidate-changed", "$candidate");
      }
      filled += read;
    }
    if (!scratch.subarray(0, length).equals(
      input.bytes.subarray(offset, offset + length),
    )) {
      fail("candidate-changed", "$candidate");
    }
    offset += length;
  }
  assertNotAborted(signal);
  try {
    if ((await handle.read(scratch, 0, 1, input.byteCount)).bytesRead !== 0) {
      fail("candidate-changed", "$candidate");
    }
  } catch (error: unknown) {
    if (error instanceof DurableFileCandidateError) throw error;
    fail("candidate-changed", "$candidate");
  }
  const after = await snapshotHandle(handle, "candidate-changed");
  if (!sameFileNodeSnapshot(before, after)) {
    fail("candidate-changed", "$candidate");
  }
  return after;
}

async function closeParent(
  parent: RootedResourceParentHandle,
): Promise<DurableFileCandidateError | undefined> {
  try {
    await parent.close();
    return undefined;
  } catch {
    return new DurableFileCandidateError("close-failure", "$candidate");
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

/** 直接创建并同步一个具名、非权威文件候选资源。 */
export async function createFileCandidateDurably(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  bytesValue: Uint8Array,
  optionsValue: DurableFileCandidateOptions,
): Promise<Readonly<DurableFileCandidateResult>> {
  assertRoot(root);
  const options = parseOptions(optionsValue);
  assertNotAborted(options.signal);
  const input = snapshotInput(bytesValue);

  let parent: RootedResourceParentHandle;
  try {
    parent = await RootedResourceParentHandle.open(root, resourcePath);
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      if (error.reason === "root-scope") fail("root-scope", "$root");
      if (error.reason === "input") fail("input", "$resourcePath");
      fail("parent", "$resourcePath");
    }
    throw error;
  }
  let handle: FileHandle | undefined;
  let created = false;
  let primaryError: unknown;
  let result: Readonly<DurableFileCandidateResult> | undefined;

  try {
    await assertParentCurrent(parent, "parent", "$resourcePath");
    if (await inspectParentTarget(
      parent,
      "parent",
      "$resourcePath",
    ) !== null) {
      fail("target-exists", "$resourcePath");
    }
    try {
      handle = await openFileHandle(
        parent.resourceAbsolutePath,
        openFlags(),
        0o600,
      );
      created = true;
    } catch (error: unknown) {
      if (readNodeSystemErrorCode(error) === "EEXIST") {
        fail("target-exists", "$resourcePath");
      }
      fail("create-failure", "$candidate");
    }
    await writeAll(handle, input.bytes, options.signal);
    assertNotAborted(options.signal);
    try {
      await handle.chmod(options.mode);
    } catch {
      fail("write-failure", "$candidate");
    }
    let prepared = await verifyBytes(handle, input, options.signal);
    if (
      prepared.kind !== "file"
      || prepared.linkCount !== 1n
      || prepared.permissionBits !== options.mode
      || prepared.byteCount !== input.byteCount
    ) {
      fail("candidate-changed", "$candidate");
    }
    try {
      await handle.sync();
    } catch {
      fail("sync-failure", "$candidate");
    }
    prepared = await verifyBytes(handle, input, options.signal);
    await assertParentCurrent(parent, "candidate-changed", "$candidate");
    const pathNode = await inspectParentTarget(
      parent,
      "candidate-changed",
      "$candidate",
    );
    if (
      pathNode === null
      || !sameFileNodeSnapshot(prepared, pathNode)
    ) {
      fail("candidate-changed", "$candidate");
    }
    await syncParent(parent);
    const finalHandle = await verifyBytes(handle, input, options.signal);
    const finalPath = await inspectParentTarget(
      parent,
      "candidate-changed",
      "$candidate",
    );
    if (
      finalPath === null
      || !sameFileNodeSnapshot(finalHandle, finalPath)
    ) {
      fail("candidate-changed", "$candidate");
    }
    result = Object.freeze({
      resourcePath,
      node: finalPath,
      byteCount: input.byteCount,
      digest: input.digest,
    });
  } catch (error: unknown) {
    primaryError = error;
  }

  if (created && result === undefined && handle !== undefined) {
    try {
      const opened = await snapshotHandle(handle, "cleanup-failure");
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
      const retired = await snapshotHandle(handle, "cleanup-failure");
      if (!sameRetiredCandidateNode(opened, retired)) {
        fail("cleanup-failure", "$candidate");
      }
      await parent.sync();
    } catch (error: unknown) {
      primaryError = error instanceof DurableFileCandidateError
        ? error
        : new DurableFileCandidateError("cleanup-failure", "$candidate");
    }
  }
  if (handle !== undefined) {
    try {
      await handle.close();
    } catch {
      if (primaryError === undefined) {
        primaryError = new DurableFileCandidateError(
          "close-failure",
          "$candidate",
        );
      }
    }
  }
  const parentCloseError = await closeParent(parent);
  if (primaryError === undefined && parentCloseError !== undefined) {
    primaryError = parentCloseError;
  }
  if (primaryError !== undefined) throw primaryError;
  if (result === undefined) fail("candidate-changed", "$candidate");
  return result;
}
