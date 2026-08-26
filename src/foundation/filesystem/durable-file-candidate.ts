import { constants as fileSystemConstants } from "node:fs";
import {
  open as openFileHandle,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { types } from "node:util";

import {
  computeSha256Digest,
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
  FileNodeSnapshotError,
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
 * Wakeflow Foundation / Filesystem：具名、可恢复的非权威 file candidate。
 *
 * Candidate 直接以 O_CREAT|O_EXCL|O_NOFOLLOW 创建在调用方拥有的明确 pathname，
 * 完整写入、设置最终 mode、复验字节、fsync file 与 parent 后才返回。它不使用第二个
 * anonymous stage，因此进程崩溃只会留下调用方可按自身命名协议识别的 partial/complete
 * candidate。Candidate 本身不是 authority；调用方必须另用 no-replace link/rename
 * 建立业务 commit point，并负责 crash residue 的 owner/liveness 与清理判断。
 *
 * 本能力不覆盖既有文件、不发布最终 target、不自动收养 crash residue，也不解释领域
 * bytes。Node 未暴露 openat，pathname 竞态边界与 RootedDirectory 保持一致。
 */

export interface DurableFileCandidateOptions {
  readonly mode: number;
  readonly signal?: AbortSignal;
}

export interface DurableFileCandidateResult {
  readonly resourcePath: PortableResourcePath;
  readonly node: Readonly<FileNodeSnapshot>;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
}

export type DurableFileCandidateErrorReason =
  | "input"
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
  readonly bytes: Uint8Array;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
}

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
      && !(record.signal instanceof AbortSignal)
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
  if (!(value instanceof Uint8Array) || !ArrayBuffer.isView(value)) {
    fail("input", "$bytes");
  }
  const bytes = Uint8Array.from(value);
  return Object.freeze({
    bytes,
    byteCount: parseByteCount(bytes.byteLength, "$bytes"),
    digest: computeSha256Digest(bytes),
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
  } catch (error: unknown) {
    if (error instanceof FileNodeSnapshotError) fail(reason, "$candidate");
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
): Promise<Readonly<FileNodeSnapshot>> {
  const before = snapshotNode(
    await handle.stat({ bigint: true }),
    "candidate-changed",
  );
  const scratch = Buffer.allocUnsafe(Math.min(input.byteCount || 1, 512 * 1024));
  let offset = 0;
  while (offset < input.byteCount) {
    const length = Math.min(scratch.byteLength, input.byteCount - offset);
    let read: number;
    try {
      ({ bytesRead: read } = await handle.read(scratch, 0, length, offset));
    } catch {
      fail("candidate-changed", "$candidate");
    }
    if (read !== length) fail("candidate-changed", "$candidate");
    for (let index = 0; index < read; index += 1) {
      if (scratch[index] !== input.bytes[offset + index]) {
        fail("candidate-changed", "$candidate");
      }
    }
    offset += read;
  }
  const probe = Buffer.allocUnsafe(1);
  try {
    if ((await handle.read(probe, 0, 1, input.byteCount)).bytesRead !== 0) {
      fail("candidate-changed", "$candidate");
    }
  } catch (error: unknown) {
    if (error instanceof DurableFileCandidateError) throw error;
    fail("candidate-changed", "$candidate");
  }
  const after = snapshotNode(
    await handle.stat({ bigint: true }),
    "candidate-changed",
  );
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

/** 直接创建并同步一个具名、非权威 file candidate。 */
export async function createFileCandidateDurably(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  bytesValue: Uint8Array,
  optionsValue: DurableFileCandidateOptions,
): Promise<Readonly<DurableFileCandidateResult>> {
  assertRoot(root);
  const options = parseOptions(optionsValue);
  const input = snapshotInput(bytesValue);
  assertNotAborted(options.signal);

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
  let completed = false;
  let primaryError: unknown;
  let result: Readonly<DurableFileCandidateResult> | undefined;

  try {
    await parent.assertCurrent();
    if (await parent.inspectTarget() !== null) {
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
    let prepared = await verifyBytes(handle, input);
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
    prepared = await verifyBytes(handle, input);
    await parent.assertCurrent();
    const pathNode = await parent.inspectTarget();
    if (
      pathNode === null
      || !sameFileNodeSnapshot(prepared, pathNode)
    ) {
      fail("candidate-changed", "$candidate");
    }
    try {
      await parent.sync();
    } catch {
      fail("durability-failure", "$candidate");
    }
    const finalHandle = await verifyBytes(handle, input);
    const finalPath = await parent.inspectTarget();
    if (
      finalPath === null
      || !sameFileNodeSnapshot(finalHandle, finalPath)
    ) {
      fail("candidate-changed", "$candidate");
    }
    completed = true;
    result = Object.freeze({
      resourcePath,
      node: finalPath,
      byteCount: input.byteCount,
      digest: input.digest,
    });
  } catch (error: unknown) {
    primaryError = error;
  }

  if (created && !completed && handle !== undefined) {
    try {
      const opened = snapshotNode(
        await handle.stat({ bigint: true }),
        "cleanup-failure",
      );
      const current = await parent.inspectTarget();
      if (
        current === null
        || opened.linkCount !== 1n
        || !sameFileNodeIdentity(opened, current)
      ) {
        fail("cleanup-failure", "$candidate");
      }
      await unlink(parent.resourceAbsolutePath);
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
  if (!completed || result === undefined) fail("candidate-changed", "$candidate");
  return result;
}
