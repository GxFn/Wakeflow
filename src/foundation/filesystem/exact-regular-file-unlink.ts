import { unlink } from "node:fs/promises";
import { types } from "node:util";

import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import {
  FileNodeSnapshotError,
  sameFileNodeIdentity,
  sameFileNodeSnapshot,
  type FileNodeSnapshot,
} from "./file-node-snapshot.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import { RootedDirectory } from "./rooted-directory.js";
import {
  RootedExactResourceHandle,
  RootedExactResourceHandleError,
} from "./rooted-exact-resource-handle.js";
import {
  RootedResourceParentHandle,
  RootedResourceParentHandleError,
} from "./rooted-resource-parent-handle.js";

/**
 * Wakeflow Foundation / Filesystem：exact regular-file pathname 的持久化 unlink。
 *
 * 本文件要求冻结的 expected node，持有 no-follow source 与 parent handles，并在
 * commit 前确认 pathname/handle/expectation 完全一致。unlink 后 pathname 必须 absent，
 * 打开的 handle 仍须指向原 inode，且 linkCount 精确减少 1；随后同步 inode 与 parent
 * 并完成最终复验。
 *
 * missing 不被当作幂等成功，symlink/directory/special node 均拒绝。unlink 后失败不会
 * 尝试恢复 pathname，也不会删除占据原名的 successor。本 primitive 必须在领域
 * lock/journal 下使用；Node 没有按 expected inode 条件执行的 unlinkat CAS。
 *
 * 本层不 rmdir、不递归删除、不读取内容、不解释业务 authority，也不拥有 tree cleanup。
 */

export interface ExactRegularFileUnlinkOptions {
  readonly expectedNode: Readonly<FileNodeSnapshot>;
  readonly signal?: AbortSignal;
}

/** unlink 成功后签发的进程内节点证明；不得持久化为 wire record。 */
export interface ExactRegularFileUnlinkReceipt {
  readonly resourcePath: PortableResourcePath;
  readonly nodeBefore: Readonly<FileNodeSnapshot>;
  readonly nodeAfterUnlink: Readonly<FileNodeSnapshot>;
  readonly previousLinkCount: bigint;
  readonly remainingLinkCount: bigint;
}

/** exact regular-file unlink 失败分类。 */
export type ExactRegularFileUnlinkErrorReason =
  | "input"
  | "root-scope"
  | "parent-not-found"
  | "parent-symlink"
  | "parent-not-directory"
  | "parent-open-failure"
  | "parent-changed"
  | "source-not-found"
  | "source-symlink"
  | "source-not-file"
  | "source-open-failure"
  | "source-changed"
  | "unlink-failure"
  | "commit-uncertain"
  | "durability-failure"
  | "aborted"
  | "close-failure";

const ERROR_MESSAGES = {
  "input": "Exact regular file unlink input is invalid.",
  "root-scope": "Exact unlink could not establish its rooted scope.",
  "parent-not-found": "Exact unlink parent directory does not exist.",
  "parent-symlink": "Exact unlink parent chain cannot contain a symbolic link.",
  "parent-not-directory": "Exact unlink parent must be a directory.",
  "parent-open-failure": "Exact unlink parent could not be opened safely.",
  "parent-changed": "Exact unlink parent changed during the operation.",
  "source-not-found": "Exact unlink source does not exist.",
  "source-symlink": "Exact unlink source cannot be a symbolic link.",
  "source-not-file": "Exact unlink source must be a regular file.",
  "source-open-failure": "Exact unlink source could not be opened safely.",
  "source-changed": "Exact unlink source no longer matches its expectation.",
  "unlink-failure": "Exact unlink commit could not be executed safely.",
  "commit-uncertain": "Exact unlink commit result could not be proven safely.",
  "durability-failure": "Exact unlink inode and parent could not be synchronized.",
  "aborted": "Exact unlink was aborted before commit.",
  "close-failure": "An exact unlink handle could not be closed safely.",
} as const satisfies Readonly<Record<
  ExactRegularFileUnlinkErrorReason,
  string
>>;

/**
 * exact regular-file unlink 的稳定错误。
 *
 * 错误不回显物理路径、resource ref、节点元数据、link count、Abort reason、系统调用
 * 或 cause。unlink 调用后的错误不得被解释为 pathname 一定仍存在。
 */
export class ExactRegularFileUnlinkError extends Error {
  override readonly name = "ExactRegularFileUnlinkError";
  readonly code = "wakeflow-exact-regular-file-unlink" as const;
  readonly reason: ExactRegularFileUnlinkErrorReason;
  readonly path: string;

  constructor(reason: ExactRegularFileUnlinkErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedOptions {
  readonly expectedNode: Readonly<FileNodeSnapshot>;
  readonly signal: AbortSignal | undefined;
}

function fail(reason: ExactRegularFileUnlinkErrorReason, path: string): never {
  throw new ExactRegularFileUnlinkError(reason, path);
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

function parseExpectedNode(value: unknown): Readonly<FileNodeSnapshot> {
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
  return value as Readonly<FileNodeSnapshot>;
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
  if (
    !Object.hasOwn(record, "expectedNode")
    || Object.keys(record).some((key) => !allowed.has(key))
  ) {
    fail("input", "$options");
  }
  const expectedNode = parseExpectedNode(record.expectedNode);
  if (expectedNode.kind === "file" && expectedNode.linkCount < 1n) {
    fail("input", "$options.expectedNode");
  }
  const signal = record.signal;
  if (signal !== undefined && !isAbortSignal(signal)) {
    fail("input", "$options.signal");
  }
  return Object.freeze({ expectedNode, signal });
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
    fail("commit-uncertain", "$resourcePath");
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
): Promise<ExactRegularFileUnlinkError | undefined> {
  try {
    await parent.close();
    return undefined;
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      return new ExactRegularFileUnlinkError(
        error.reason === "close-failure" ? "close-failure" : "parent-changed",
        "$resourcePath",
      );
    }
    throw error;
  }
}

function mapExactSourceError(
  error: RootedExactResourceHandleError,
  operation: "open" | "current" | "inspect-after-commit" | "sync-after-commit",
): never {
  if (operation === "sync-after-commit" && error.reason === "sync-failure") {
    fail("durability-failure", "$resourcePath");
  }
  if (
    operation === "inspect-after-commit"
    || operation === "sync-after-commit"
  ) {
    fail("commit-uncertain", "$resourcePath");
  }
  if (operation === "current") fail("source-changed", "$resourcePath");
  if (error.reason === "input") fail("input", "$resourcePath");
  if (error.reason === "root-scope") fail("root-scope", "$resourcePath");
  if (error.reason === "resource-not-found") {
    fail("source-not-found", "$resourcePath");
  }
  if (error.reason === "resource-symlink") {
    fail("source-symlink", "$resourcePath");
  }
  if (error.reason === "resource-kind") {
    fail("source-not-file", "$resourcePath");
  }
  if (error.reason === "resource-open-failure") {
    fail("source-open-failure", "$resourcePath");
  }
  fail("source-changed", "$resourcePath");
}

async function openExactSource(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  expectedNode: Readonly<FileNodeSnapshot>,
): Promise<RootedExactResourceHandle> {
  try {
    return await RootedExactResourceHandle.openRegularFile(
      root,
      resourcePath,
      expectedNode,
      "$resourcePath",
    );
  } catch (error: unknown) {
    if (error instanceof RootedExactResourceHandleError) {
      mapExactSourceError(error, "open");
    }
    throw error;
  }
}

async function assertSourceCurrent(
  source: RootedExactResourceHandle,
): Promise<void> {
  try {
    await source.assertPathCurrent();
  } catch (error: unknown) {
    if (error instanceof RootedExactResourceHandleError) {
      mapExactSourceError(error, "current");
    }
    throw error;
  }
}

async function inspectCommittedSource(
  source: RootedExactResourceHandle,
): Promise<Readonly<FileNodeSnapshot>> {
  try {
    return await source.inspectOpenedNode();
  } catch (error: unknown) {
    if (error instanceof RootedExactResourceHandleError) {
      mapExactSourceError(error, "inspect-after-commit");
    }
    throw error;
  }
}

async function syncCommittedSource(
  source: RootedExactResourceHandle,
): Promise<void> {
  try {
    await source.syncOpenedNode();
  } catch (error: unknown) {
    if (error instanceof RootedExactResourceHandleError) {
      mapExactSourceError(error, "sync-after-commit");
    }
    throw error;
  }
}

async function closeSource(
  source: RootedExactResourceHandle,
): Promise<ExactRegularFileUnlinkError | undefined> {
  try {
    await source.close();
    return undefined;
  } catch (error: unknown) {
    if (error instanceof RootedExactResourceHandleError) {
      return new ExactRegularFileUnlinkError("close-failure", "$resourcePath");
    }
    throw error;
  }
}

async function assertPathAbsent(
  parent: RootedResourceParentHandle,
): Promise<void> {
  if (await inspectParentTarget(parent) !== null) {
    fail("commit-uncertain", "$resourcePath");
  }
}

function sameUnlinkedNode(
  before: Readonly<FileNodeSnapshot>,
  after: Readonly<FileNodeSnapshot>,
  remainingLinkCount: bigint,
): boolean {
  return (
    sameFileNodeIdentity(before, after)
    && before.kind === "file"
    && after.kind === "file"
    && before.rawMode === after.rawMode
    && before.permissionBits === after.permissionBits
    && after.linkCount === remainingLinkCount
    && before.userId === after.userId
    && before.groupId === after.groupId
    && before.specialDeviceId === after.specialDeviceId
    && before.byteCount === after.byteCount
    && before.modifiedAtNanoseconds === after.modifiedAtNanoseconds
  );
}

/**
 * 持久化删除一个仍匹配 exact frozen node 的 regular-file pathname。
 *
 * 成功 receipt 证明 pathname absent 与原 inode linkCount-1；调用方仍须用领域 lock
 * 排除最终 pathname check 与 unlink 之间的非协作 replacement。
 */
export async function unlinkRegularFileExactly(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  options: ExactRegularFileUnlinkOptions,
): Promise<Readonly<ExactRegularFileUnlinkReceipt>> {
  assertRoot(root);
  const parsed = parseOptions(options);
  assertNotAborted(parsed.signal);

  const parent = await openResourceParent(root, resourcePath);
  let source: RootedExactResourceHandle | undefined;
  let committed = false;
  let primaryError: unknown;
  let result: Readonly<ExactRegularFileUnlinkReceipt> | undefined;

  try {
    source = await openExactSource(
      root,
      resourcePath,
      parsed.expectedNode,
    );
    if (source.resourceAbsolutePath !== parent.resourceAbsolutePath) {
      fail("root-scope", "$resourcePath");
    }
    await assertParentCurrent(parent);
    await assertSourceCurrent(source);
    assertNotAborted(parsed.signal);

    try {
      await unlink(parent.resourceAbsolutePath);
    } catch (error: unknown) {
      if (readNodeSystemErrorCode(error) === "ENOENT") {
        fail("source-changed", "$resourcePath");
      }
      fail("unlink-failure", "$resourcePath");
    }
    committed = true;

    const nodeBefore = source.initialNodeSnapshot;
    const remainingLinkCount = nodeBefore.linkCount - 1n;
    await assertPathAbsent(parent);
    const afterUnlink = await inspectCommittedSource(source);
    if (!sameUnlinkedNode(nodeBefore, afterUnlink, remainingLinkCount)) {
      fail("commit-uncertain", "$resourcePath");
    }
    await syncCommittedSource(source);
    await syncParent(parent);
    await assertPathAbsent(parent);
    const settled = await inspectCommittedSource(source);
    if (!sameFileNodeSnapshot(afterUnlink, settled)) {
      fail("commit-uncertain", "$resourcePath");
    }
    result = Object.freeze({
      resourcePath,
      nodeBefore,
      nodeAfterUnlink: settled,
      previousLinkCount: nodeBefore.linkCount,
      remainingLinkCount,
    });
  } catch (error: unknown) {
    primaryError = error;
  }

  if (source !== undefined) {
    const closeError = await closeSource(source);
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
