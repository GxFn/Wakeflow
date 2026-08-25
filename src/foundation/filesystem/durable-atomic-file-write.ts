import { constants as fileSystemConstants } from "node:fs";
import {
  link,
  lstat,
  open as openFileHandle,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import nodePath from "node:path";
import { types } from "node:util";

import {
  computeSha256Digest,
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import { createUuidV4, UuidV4Error } from "../identity/uuid-v4.js";
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
import {
  readStableFile,
  STABLE_FILE_READ_CHUNK_BYTES,
  StableFileReadError,
} from "./stable-file-read.js";

/**
 * Wakeflow Foundation / Filesystem：单个完整字节文件的持久化原子发布。
 *
 * 本文件提供两种名称与提交语义明确的操作：create 使用同目录 hard link 原子地
 * 保证 target 不被覆盖；replace 使用同目录 rename，使读者只看到完整旧文件或
 * 完整新文件。两者都先创建私有 exclusive stage、完整写入、设置最终 mode、
 * fsync stage，发布后再复验最终 inode 并 fsync parent directory。
 *
 * replace 必须携带前一次 StableFileRead 的冻结 node 与完整文件 digest，并在
 * staging 前和 commit 前重新读取核验。该 expectation 不是跨进程 CAS；独立 writer
 * 在最终核验与 rename 之间仍可能竞争，领域 owner 必须继续使用自己的 lock/journal。
 *
 * 本层只接受 Uint8Array 字节，不编码字符串、不创建父目录、不合并 mixed-owned
 * 内容，也不拥有多文件事务、业务锁、recovery 状态机或 mode/owner/hardlink policy。
 * Node 缺少 openat/renameat2，pathname 竞态边界与 RootedDirectory 保持一致。
 */

/** stage 在内容完整前始终保持 owner-only；最终 mode 只在发布前设置。 */
const PRIVATE_STAGE_MODE = 0o600;
const STAGE_CREATE_ATTEMPTS = 4;

export interface DurableAtomicFileCreateOptions {
  readonly mode: number;
  readonly signal?: AbortSignal;
}

/** replace 所需的精确前序读取事实。 */
export interface DurableAtomicFileExpectation {
  readonly node: Readonly<FileNodeSnapshot>;
  readonly digest: Sha256Digest;
}

export interface DurableAtomicFileReplaceOptions {
  readonly mode: number;
  readonly expected: DurableAtomicFileExpectation;
  readonly signal?: AbortSignal;
}

export type DurableAtomicFilePublication = "created" | "replaced";

/** 成功返回只描述已经复验并完成 parent sync 的最终 target。 */
export interface DurableAtomicFileWriteResult<
  Publication extends DurableAtomicFilePublication =
    DurableAtomicFilePublication,
> {
  readonly resourcePath: PortableResourcePath;
  readonly publication: Publication;
  readonly node: Readonly<FileNodeSnapshot>;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
}

/** 持久化原子文件发布失败的稳定分类。 */
export type DurableAtomicFileWriteErrorReason =
  | "input"
  | "root-scope"
  | "parent-not-found"
  | "parent-symlink"
  | "parent-not-directory"
  | "parent-open-failure"
  | "parent-changed"
  | "target-exists"
  | "target-inspection-failure"
  | "expectation-changed"
  | "expectation-read-failure"
  | "hash-failure"
  | "stage-create-failure"
  | "stage-write-failure"
  | "stage-sync-failure"
  | "stage-changed"
  | "publish-failure"
  | "commit-uncertain"
  | "durability-failure"
  | "stage-cleanup-failure"
  | "aborted"
  | "close-failure";

const ERROR_MESSAGES = {
  "input": "Durable atomic file write input is invalid.",
  "root-scope": "Atomic file target could not establish its rooted scope.",
  "parent-not-found": "Atomic file target parent directory does not exist.",
  "parent-symlink": "Atomic file target parent chain cannot contain a symbolic link.",
  "parent-not-directory": "Atomic file target parent must be a directory.",
  "parent-open-failure": "Atomic file target parent could not be opened safely.",
  "parent-changed": "Atomic file target parent changed during the operation.",
  "target-exists": "Atomic file create target already exists.",
  "target-inspection-failure": "Atomic file target could not be inspected safely.",
  "expectation-changed": "Atomic file replace expectation no longer matches the target.",
  "expectation-read-failure": "Atomic file replace target could not be re-read safely.",
  "hash-failure": "Atomic file input digest could not be computed safely.",
  "stage-create-failure": "Private atomic file stage could not be created safely.",
  "stage-write-failure": "Private atomic file stage could not be written exactly.",
  "stage-sync-failure": "Private atomic file stage could not be synchronized safely.",
  "stage-changed": "Private atomic file stage changed before publication.",
  "publish-failure": "Private atomic file stage could not be published safely.",
  "commit-uncertain": "Published atomic file target could not be proven exact.",
  "durability-failure": "Published atomic file directory entry could not be synchronized.",
  "stage-cleanup-failure": "Private atomic file stage could not be retired safely.",
  "aborted": "Durable atomic file write was aborted before publication.",
  "close-failure": "An atomic file write handle could not be closed safely.",
} as const satisfies Readonly<
  Record<DurableAtomicFileWriteErrorReason, string>
>;

/**
 * 持久化单文件写入的稳定错误。
 *
 * 错误不回显物理路径、resource ref、stage 名称、文件字节、mode、摘要、节点元数据、
 * Abort reason、系统调用或 lower-layer cause。commit 后错误不得被解释为 target 未变。
 */
export class DurableAtomicFileWriteError extends Error {
  override readonly name = "DurableAtomicFileWriteError";
  readonly code = "wakeflow-durable-atomic-file-write" as const;
  readonly reason: DurableAtomicFileWriteErrorReason;
  readonly path: string;

  constructor(reason: DurableAtomicFileWriteErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedCreateOptions {
  readonly mode: number;
  readonly signal: AbortSignal | undefined;
}

interface ParsedReplaceOptions extends ParsedCreateOptions {
  readonly expected: Readonly<DurableAtomicFileExpectation>;
}

interface OpenStage {
  readonly physicalPath: string;
  readonly handle: FileHandle;
}

interface PreparedStage extends OpenStage {
  readonly node: Readonly<FileNodeSnapshot>;
}

interface InputBytes {
  readonly bytes: Buffer;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
}

function fail(
  reason: DurableAtomicFileWriteErrorReason,
  path: string,
): never {
  throw new DurableAtomicFileWriteError(reason, path);
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

function parseMode(value: unknown): number {
  if (
    typeof value !== "number"
    || !Number.isInteger(value)
    || value < 0
    || value > 0o777
  ) {
    fail("input", "$options.mode");
  }
  return value;
}

function parseOptionRecord(
  value: unknown,
  required: readonly string[],
): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  const allowed = new Set([...required, "signal"]);
  if (
    required.some((field) => !Object.hasOwn(record, field))
    || Object.keys(record).some((key) => !allowed.has(key))
  ) {
    fail("input", "$options");
  }
  return record;
}

function parseSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  if (!isAbortSignal(value)) fail("input", "$options.signal");
  return value;
}

function parseCreateOptions(value: unknown): Readonly<ParsedCreateOptions> {
  const record = parseOptionRecord(value, ["mode"]);
  return Object.freeze({
    mode: parseMode(record.mode),
    signal: parseSignal(record.signal),
  });
}

function parseExpectedNode(value: unknown): Readonly<FileNodeSnapshot> {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !Object.isFrozen(value)
  ) {
    fail("input", "$options.expected.node");
  }
  try {
    if (!sameFileNodeSnapshot(
      value as FileNodeSnapshot,
      value as FileNodeSnapshot,
    )) {
      fail("input", "$options.expected.node");
    }
  } catch (error: unknown) {
    if (error instanceof FileNodeSnapshotError) {
      fail("input", "$options.expected.node");
    }
    throw error;
  }
  const node = value as Readonly<FileNodeSnapshot>;
  if (node.kind !== "file") fail("input", "$options.expected.node");
  return node;
}

function parseExpectation(
  value: unknown,
): Readonly<DurableAtomicFileExpectation> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options.expected");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      fail("input", "$options.expected");
    }
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "digest" || keys[1] !== "node") {
    fail("input", "$options.expected");
  }
  let digest: Sha256Digest;
  try {
    digest = parseSha256Digest(record.digest, "$options.expected.digest");
  } catch (error: unknown) {
    if (error instanceof Sha256Error) {
      fail("input", "$options.expected.digest");
    }
    throw error;
  }
  return Object.freeze({
    node: parseExpectedNode(record.node),
    digest,
  });
}

function parseReplaceOptions(value: unknown): Readonly<ParsedReplaceOptions> {
  const record = parseOptionRecord(value, ["expected", "mode"]);
  return Object.freeze({
    mode: parseMode(record.mode),
    expected: parseExpectation(record.expected),
    signal: parseSignal(record.signal),
  });
}

function snapshotInputBytes(value: unknown): Readonly<InputBytes> {
  if (!(ArrayBuffer.isView(value) && value instanceof Uint8Array)) {
    fail("input", "$bytes");
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(value);
  } catch {
    fail("input", "$bytes");
  }
  const byteCount = parseByteCount(bytes.byteLength, "$bytes");
  let digest: Sha256Digest;
  try {
    digest = computeSha256Digest(bytes, "$bytes");
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("hash-failure", "$bytes");
    throw error;
  }
  return Object.freeze({ bytes, byteCount, digest });
}

function requiredStageOpenFlags(): number {
  const noFollow: unknown = fileSystemConstants.O_NOFOLLOW;
  if (typeof noFollow !== "number") fail("root-scope", "$root");
  return (
    fileSystemConstants.O_RDWR
    | fileSystemConstants.O_CREAT
    | fileSystemConstants.O_EXCL
    | noFollow
  );
}

async function snapshotHandle(
  handle: FileHandle,
  reason: DurableAtomicFileWriteErrorReason,
  path: string,
): Promise<Readonly<FileNodeSnapshot>> {
  try {
    return createFileNodeSnapshot(
      await handle.stat({ bigint: true }),
      path,
    );
  } catch (error: unknown) {
    if (error instanceof FileNodeSnapshotError) fail(reason, path);
    fail(reason, path);
  }
}

function mapParentHandleError(
  error: RootedResourceParentHandleError,
  operation: "open" | "current" | "inspect" | "sync",
): never {
  if (operation === "sync" && error.reason === "sync-failure") {
    fail("durability-failure", "$resourcePath");
  }
  if (
    operation === "inspect"
    && error.reason === "target-inspection-failure"
  ) {
    fail("target-inspection-failure", "$resourcePath");
  }
  if (operation === "open") {
    if (error.reason === "input") fail("input", "$resourcePath");
    if (error.reason === "root-scope") fail("root-scope", "$resourcePath");
    if (error.reason === "parent-not-found") {
      fail("parent-not-found", "$resourcePath");
    }
    if (error.reason === "parent-symlink") {
      fail("parent-symlink", "$resourcePath");
    }
    if (error.reason === "parent-not-directory") {
      fail("parent-not-directory", "$resourcePath");
    }
    if (error.reason === "parent-open-failure") {
      fail("parent-open-failure", "$resourcePath");
    }
  }
  fail("parent-changed", "$resourcePath");
}

async function openResourceParent(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<RootedResourceParentHandle> {
  try {
    return await RootedResourceParentHandle.open(
      root,
      resourcePath,
      "$resourcePath",
    );
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      mapParentHandleError(error, "open");
    }
    throw error;
  }
}

async function assertParentCurrent(
  parent: RootedResourceParentHandle,
): Promise<void> {
  try {
    await parent.assertCurrent();
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      mapParentHandleError(error, "current");
    }
    throw error;
  }
}

async function inspectParentTarget(
  parent: RootedResourceParentHandle,
): Promise<Readonly<FileNodeSnapshot> | null> {
  try {
    return await parent.inspectTarget();
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      mapParentHandleError(error, "inspect");
    }
    throw error;
  }
}

async function assertTargetAbsent(
  parent: RootedResourceParentHandle,
): Promise<void> {
  if (await inspectParentTarget(parent) !== null) {
    fail("target-exists", "$resourcePath");
  }
}

async function syncParent(parent: RootedResourceParentHandle): Promise<void> {
  try {
    await parent.sync();
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      mapParentHandleError(error, "sync");
    }
    throw error;
  }
}

async function closeParent(
  parent: RootedResourceParentHandle,
): Promise<DurableAtomicFileWriteError | undefined> {
  try {
    await parent.close();
    return undefined;
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      return new DurableAtomicFileWriteError(
        error.reason === "close-failure" ? "close-failure" : "parent-changed",
        "$resourcePath",
      );
    }
    throw error;
  }
}

async function assertExpectedTarget(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  expected: Readonly<DurableAtomicFileExpectation>,
  signal: AbortSignal | undefined,
): Promise<void> {
  let current;
  try {
    current = await readStableFile(root, resourcePath, signal === undefined
      ? {
          maximumBytes: expected.node.byteCount,
          capture: "digest-only",
        }
      : {
          maximumBytes: expected.node.byteCount,
          capture: "digest-only",
          signal,
        });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "input") fail("input", "$resourcePath");
      if (error.reason === "root-scope") fail("root-scope", "$resourcePath");
      if (
        error.reason === "not-found"
        || error.reason === "symlink"
        || error.reason === "not-file"
        || error.reason === "too-large"
        || error.reason === "source-changed"
      ) {
        fail("expectation-changed", "$resourcePath");
      }
      fail("expectation-read-failure", "$resourcePath");
    }
    throw error;
  }
  if (
    current.digest !== expected.digest
    || !sameFileNodeSnapshot(current.node, expected.node)
  ) {
    fail("expectation-changed", "$resourcePath");
  }
}

function stageName(): string {
  try {
    return `.wakeflow-stage-${createUuidV4()}.tmp`;
  } catch (error: unknown) {
    if (error instanceof UuidV4Error) {
      fail("stage-create-failure", "$stage");
    }
    throw error;
  }
}

async function createExclusiveStage(
  parent: RootedResourceParentHandle,
): Promise<Readonly<OpenStage>> {
  const flags = requiredStageOpenFlags();
  for (let attempt = 0; attempt < STAGE_CREATE_ATTEMPTS; attempt += 1) {
    const physicalPath = nodePath.join(parent.parentAbsolutePath, stageName());
    try {
      const handle = await openFileHandle(
        physicalPath,
        flags,
        PRIVATE_STAGE_MODE,
      );
      return Object.freeze({ physicalPath, handle });
    } catch (error: unknown) {
      if (readNodeSystemErrorCode(error) === "EEXIST") continue;
      fail("stage-create-failure", "$stage");
    }
  }
  fail("stage-create-failure", "$stage");
}

async function writeExactBytes(
  handle: FileHandle,
  bytes: Uint8Array,
  signal: AbortSignal | undefined,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    assertNotAborted(signal);
    let bytesWritten: number;
    try {
      ({ bytesWritten } = await handle.write(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset,
      ));
    } catch {
      assertNotAborted(signal);
      fail("stage-write-failure", "$stage");
    }
    if (bytesWritten <= 0 || bytesWritten > bytes.byteLength - offset) {
      fail("stage-write-failure", "$stage");
    }
    offset += bytesWritten;
  }
}

async function verifyHandleBytes(
  handle: FileHandle,
  input: Readonly<InputBytes>,
  signal: AbortSignal | undefined,
  reason: "stage-changed" | "commit-uncertain",
): Promise<Readonly<FileNodeSnapshot>> {
  const errorPath = reason === "stage-changed" ? "$stage" : "$resourcePath";
  const before = await snapshotHandle(handle, reason, errorPath);
  const scratch = Buffer.allocUnsafe(
    Math.min(STABLE_FILE_READ_CHUNK_BYTES, input.byteCount || 1),
  );
  let position = 0;
  while (position < input.byteCount) {
    if (reason === "stage-changed") assertNotAborted(signal);
    const length = Math.min(
      scratch.byteLength,
      input.byteCount - position,
    );
    let bytesRead: number;
    try {
      ({ bytesRead } = await handle.read(
        scratch,
        0,
        length,
        position,
      ));
    } catch {
      if (reason === "stage-changed") assertNotAborted(signal);
      fail(reason, errorPath);
    }
    if (bytesRead <= 0 || bytesRead > length) {
      fail(reason, errorPath);
    }
    for (let index = 0; index < bytesRead; index += 1) {
      if (scratch[index] !== input.bytes[position + index]) {
        fail(
          reason,
          errorPath,
        );
      }
    }
    position += bytesRead;
  }
  const growthProbe = Buffer.allocUnsafe(1);
  try {
    const probe = await handle.read(
      growthProbe,
      0,
      1,
      input.byteCount,
    );
    if (probe.bytesRead !== 0) {
      fail(reason, errorPath);
    }
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) throw error;
    if (reason === "stage-changed") assertNotAborted(signal);
    fail(reason, errorPath);
  }
  const after = await snapshotHandle(handle, reason, errorPath);
  if (!sameFileNodeSnapshot(before, after)) fail(reason, errorPath);
  return after;
}

async function prepareStage(
  exclusive: Readonly<OpenStage>,
  input: Readonly<InputBytes>,
  mode: number,
  signal: AbortSignal | undefined,
): Promise<Readonly<PreparedStage>> {
  await writeExactBytes(exclusive.handle, input.bytes, signal);
  assertNotAborted(signal);
  try {
    await exclusive.handle.chmod(mode);
  } catch {
    fail("stage-write-failure", "$stage");
  }
  const beforeSync = await snapshotHandle(
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
  const afterSync = await snapshotHandle(
    exclusive.handle,
    "stage-changed",
    "$stage",
  );
  if (!sameFileNodeSnapshot(beforeSync, afterSync)) {
    fail("stage-changed", "$stage");
  }
  return Object.freeze({
    physicalPath: exclusive.physicalPath,
    handle: exclusive.handle,
    node: afterSync,
  });
}

async function assertStageCurrent(
  stage: Readonly<PreparedStage>,
): Promise<void> {
  const handleNode = await snapshotHandle(
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
  } catch (error: unknown) {
    if (error instanceof FileNodeSnapshotError) fail("stage-changed", "$stage");
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

async function inspectCommittedTarget(
  parent: RootedResourceParentHandle,
  stage: Readonly<PreparedStage>,
  input: Readonly<InputBytes>,
  mode: number,
  expectedLinkCount: bigint,
): Promise<Readonly<FileNodeSnapshot>> {
  const target = await inspectParentTarget(parent);
  if (target === null) fail("commit-uncertain", "$resourcePath");
  const opened = await snapshotHandle(
    stage.handle,
    "commit-uncertain",
    "$resourcePath",
  );
  if (
    target.kind !== "file"
    || opened.kind !== "file"
    || target.byteCount !== input.byteCount
    || target.permissionBits !== mode
    || target.linkCount !== expectedLinkCount
    || opened.linkCount !== expectedLinkCount
    || !sameFileNodeIdentity(stage.node, opened)
    || !sameFileNodeIdentity(opened, target)
  ) {
    fail("commit-uncertain", "$resourcePath");
  }
  return target;
}

async function unlinkOwnedStage(
  stage: Readonly<OpenStage>,
): Promise<void> {
  let pathNode: Readonly<FileNodeSnapshot> | null;
  try {
    pathNode = createFileNodeSnapshot(
      await lstat(stage.physicalPath, { bigint: true }),
      "$stage",
    );
  } catch (error: unknown) {
    if (readNodeSystemErrorCode(error) === "ENOENT") return;
    fail("stage-cleanup-failure", "$stage");
  }
  const opened = await snapshotHandle(
    stage.handle,
    "stage-cleanup-failure",
    "$stage",
  );
  if (!sameFileNodeIdentity(pathNode, opened)) {
    fail("stage-cleanup-failure", "$stage");
  }
  try {
    await unlink(stage.physicalPath);
  } catch (error: unknown) {
    if (readNodeSystemErrorCode(error) !== "ENOENT") {
      fail("stage-cleanup-failure", "$stage");
    }
  }
}

async function closeHandle(
  handle: FileHandle,
): Promise<DurableAtomicFileWriteError | undefined> {
  try {
    await handle.close();
    return undefined;
  } catch {
    return new DurableAtomicFileWriteError("close-failure", "$resourcePath");
  }
}

async function performWrite<
  Publication extends DurableAtomicFilePublication,
>(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  input: Readonly<InputBytes>,
  mode: number,
  signal: AbortSignal | undefined,
  publication: Publication,
  expected: Readonly<DurableAtomicFileExpectation> | null,
): Promise<Readonly<DurableAtomicFileWriteResult<Publication>>> {
  const parent = await openResourceParent(root, resourcePath);
  let openStage: Readonly<OpenStage> | undefined;
  let stage: Readonly<PreparedStage> | undefined;
  let stagePathOwned = false;
  let committed = false;
  let primaryError: unknown;
  let result: Readonly<DurableAtomicFileWriteResult<Publication>> | undefined;

  try {
    assertNotAborted(signal);
    if (publication === "created") await assertTargetAbsent(parent);
    else if (expected !== null) {
      await assertExpectedTarget(root, resourcePath, expected, signal);
    }

    openStage = await createExclusiveStage(parent);
    stagePathOwned = true;
    stage = await prepareStage(openStage, input, mode, signal);
    await assertParentCurrent(parent);
    await assertStageCurrent(stage);
    assertNotAborted(signal);

    if (publication === "created") {
      await assertTargetAbsent(parent);
    } else if (expected !== null) {
      await assertExpectedTarget(root, resourcePath, expected, signal);
    }
    await assertParentCurrent(parent);
    await assertStageCurrent(stage);
    const verifiedStageNode = await verifyHandleBytes(
      stage.handle,
      input,
      signal,
      "stage-changed",
    );
    if (!sameFileNodeSnapshot(stage.node, verifiedStageNode)) {
      fail("stage-changed", "$stage");
    }
    assertNotAborted(signal);

    if (publication === "created") {
      try {
        await link(stage.physicalPath, parent.resourceAbsolutePath);
      } catch (error: unknown) {
        if (readNodeSystemErrorCode(error) === "EEXIST") {
          fail("target-exists", "$resourcePath");
        }
        fail("publish-failure", "$resourcePath");
      }
      committed = true;
      await inspectCommittedTarget(parent, stage, input, mode, 2n);
      await unlinkOwnedStage(stage);
      stagePathOwned = false;
    } else {
      try {
        await rename(stage.physicalPath, parent.resourceAbsolutePath);
      } catch {
        fail("publish-failure", "$resourcePath");
      }
      committed = true;
      stagePathOwned = false;
    }

    try {
      await stage.handle.sync();
    } catch {
      fail("durability-failure", "$resourcePath");
    }
    const verifiedCommittedNode = await verifyHandleBytes(
      stage.handle,
      input,
      undefined,
      "commit-uncertain",
    );
    const committedNode = await inspectCommittedTarget(
      parent,
      stage,
      input,
      mode,
      1n,
    );
    if (!sameFileNodeSnapshot(verifiedCommittedNode, committedNode)) {
      fail("commit-uncertain", "$resourcePath");
    }
    await syncParent(parent);
    await assertParentCurrent(parent);
    const finalNode = await inspectCommittedTarget(
      parent,
      stage,
      input,
      mode,
      1n,
    );
    if (!sameFileNodeSnapshot(committedNode, finalNode)) {
      fail("commit-uncertain", "$resourcePath");
    }
    result = Object.freeze({
      resourcePath,
      publication,
      node: finalNode,
      byteCount: input.byteCount,
      digest: input.digest,
    });
  } catch (error: unknown) {
    primaryError = error;
  }

  if (openStage !== undefined && stagePathOwned) {
    try {
      await unlinkOwnedStage(openStage);
      stagePathOwned = false;
    } catch (error: unknown) {
      primaryError = error;
    }
  }
  if (openStage !== undefined) {
    const closeError = await closeHandle(openStage.handle);
    if (primaryError === undefined && closeError !== undefined) {
      primaryError = closeError;
    }
  }
  const parentCloseError = await closeParent(parent);
  if (primaryError === undefined && parentCloseError !== undefined) {
    primaryError = parentCloseError;
  }

  if (primaryError !== undefined) throw primaryError;
  if (committed !== true || result === undefined) {
    fail("commit-uncertain", "$resourcePath");
  }
  return result;
}

/**
 * 持久化创建一个此前不存在的完整字节文件。
 *
 * 最终发布使用 link，因此另一个 writer 先创建 target 时不会被覆盖。成功返回前
 * stage link 已退休、target 已复验且 parent directory 已完成 sync。
 */
export async function createFileAtomically(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  bytes: Uint8Array,
  options: DurableAtomicFileCreateOptions,
): Promise<Readonly<DurableAtomicFileWriteResult<"created">>> {
  assertRoot(root);
  const parsed = parseCreateOptions(options);
  const input = snapshotInputBytes(bytes);
  assertNotAborted(parsed.signal);
  return performWrite(
    root,
    resourcePath,
    input,
    parsed.mode,
    parsed.signal,
    "created",
    null,
  );
}

/**
 * 持久化替换一个仍匹配精确前序 node + digest 的完整字节文件。
 *
 * 最终发布使用 rename，提供旧/新完整文件之间的原子可见性；独立进程 CAS 仍由
 * 领域 lock 保证，不能把两次 expectation 核验解释为系统级 compare-and-swap。
 */
export async function replaceFileAtomically(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  bytes: Uint8Array,
  options: DurableAtomicFileReplaceOptions,
): Promise<Readonly<DurableAtomicFileWriteResult<"replaced">>> {
  assertRoot(root);
  const parsed = parseReplaceOptions(options);
  const input = snapshotInputBytes(bytes);
  assertNotAborted(parsed.signal);
  return performWrite(
    root,
    resourcePath,
    input,
    parsed.mode,
    parsed.signal,
    "replaced",
    parsed.expected,
  );
}
