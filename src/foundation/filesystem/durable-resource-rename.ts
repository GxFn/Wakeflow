import { rename } from "node:fs/promises";
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
 * Wakeflow Foundation / Filesystem：根作用域内 real file/directory 的持久 rename。
 *
 * 本文件要求调用方提供冻结的 exact source node，并在 source/destination parents
 * 已打开、destination 仍 absent、source 仍匹配后只跨一次 rename commit 边界。
 * commit 后复验 source absent、destination 与打开的 source handle 是同一 inode，
 * 再同步两侧 parent directory 并完成最终复验。
 *
 * 普通 rename 会替换晚到的 destination；Node 未暴露 renameat2(RENAME_NOREPLACE)。
 * 因此 destination absent 只是协作 writer lock 下的 commit precondition，不是跨进程
 * CAS。本能力不创建 parent、不复制 EXDEV source、不删除 destination、不移动 symlink
 * 或 special node，也不 fsync file content、持有业务 lock 或拥有 recovery journal。
 */

export interface DurableResourceRenameOptions {
  readonly expectedSourceNode: Readonly<FileNodeSnapshot>;
  readonly signal?: AbortSignal;
}

export type DurableRenamedResourceKind = "file" | "directory";

/** 成功返回描述已完成 parent sync 的 destination 节点。 */
export interface DurableResourceRenameResult {
  readonly sourceResourcePath: PortableResourcePath;
  readonly destinationResourcePath: PortableResourcePath;
  readonly kind: DurableRenamedResourceKind;
  readonly node: Readonly<FileNodeSnapshot>;
}

/** durable resource rename 失败分类。 */
export type DurableResourceRenameErrorReason =
  | "input"
  | "root-scope"
  | "parent-not-found"
  | "parent-symlink"
  | "parent-not-directory"
  | "parent-open-failure"
  | "parent-changed"
  | "source-not-found"
  | "source-symlink"
  | "source-not-supported"
  | "source-open-failure"
  | "source-changed"
  | "destination-exists"
  | "destination-inspection-failure"
  | "cross-device"
  | "rename-failure"
  | "commit-uncertain"
  | "durability-failure"
  | "aborted"
  | "close-failure";

const ERROR_MESSAGES = {
  "input": "Durable resource rename input is invalid.",
  "root-scope": "Resource rename could not establish its rooted scope.",
  "parent-not-found": "Resource rename parent directory does not exist.",
  "parent-symlink": "Resource rename parent chain cannot contain a symbolic link.",
  "parent-not-directory": "Resource rename parent must be a directory.",
  "parent-open-failure": "Resource rename parent could not be opened safely.",
  "parent-changed": "Resource rename parent changed during the operation.",
  "source-not-found": "Resource rename source does not exist.",
  "source-symlink": "Resource rename source cannot be a symbolic link.",
  "source-not-supported": "Resource rename source must be a real file or directory.",
  "source-open-failure": "Resource rename source could not be opened safely.",
  "source-changed": "Resource rename source no longer matches its expectation.",
  "destination-exists": "Resource rename destination already exists.",
  "destination-inspection-failure": "Resource rename destination could not be inspected safely.",
  "cross-device": "Resource rename cannot cross a filesystem boundary.",
  "rename-failure": "Resource rename commit could not be executed safely.",
  "commit-uncertain": "Resource rename commit result could not be proven exact.",
  "durability-failure": "Resource rename parent entries could not be synchronized.",
  "aborted": "Resource rename was aborted before commit.",
  "close-failure": "A resource rename handle could not be closed safely.",
} as const satisfies Readonly<Record<DurableResourceRenameErrorReason, string>>;

/**
 * durable resource rename 的稳定错误。
 *
 * 错误不回显物理路径、resource ref、节点元数据、Abort reason、系统调用或 cause。
 * rename 调用后的错误不得被解释为 source 一定仍在原路径。
 */
export class DurableResourceRenameError extends Error {
  override readonly name = "DurableResourceRenameError";
  readonly code = "wakeflow-durable-resource-rename" as const;
  readonly reason: DurableResourceRenameErrorReason;
  readonly path: string;

  constructor(reason: DurableResourceRenameErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedOptions {
  readonly expectedSourceNode: Readonly<FileNodeSnapshot>;
  readonly signal: AbortSignal | undefined;
}

type ResourceErrorPath = "$sourceResourcePath" | "$destinationResourcePath";

function fail(reason: DurableResourceRenameErrorReason, path: string): never {
  throw new DurableResourceRenameError(reason, path);
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
    fail("input", "$options.expectedSourceNode");
  }
  try {
    if (!sameFileNodeSnapshot(
      value as FileNodeSnapshot,
      value as FileNodeSnapshot,
    )) {
      fail("input", "$options.expectedSourceNode");
    }
  } catch (error: unknown) {
    if (error instanceof FileNodeSnapshotError) {
      fail("input", "$options.expectedSourceNode");
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
  const allowed = new Set(["expectedSourceNode", "signal"]);
  if (
    !Object.hasOwn(record, "expectedSourceNode")
    || Object.keys(record).some((key) => !allowed.has(key))
  ) {
    fail("input", "$options");
  }
  const signal = record.signal;
  if (signal !== undefined && !isAbortSignal(signal)) {
    fail("input", "$options.signal");
  }
  return Object.freeze({
    expectedSourceNode: parseExpectedNode(record.expectedSourceNode),
    signal,
  });
}

function mapParentHandleError(
  error: RootedResourceParentHandleError,
  operation: "open" | "current" | "inspect" | "sync",
  errorPath: ResourceErrorPath,
  inspectionReason?: "destination-inspection-failure" | "commit-uncertain",
): never {
  if (operation === "sync" && error.reason === "sync-failure") {
    fail("durability-failure", "$destinationResourcePath");
  }
  if (
    operation === "inspect"
    && error.reason === "target-inspection-failure"
  ) {
    fail(inspectionReason ?? "destination-inspection-failure", errorPath);
  }
  if (operation === "open") {
    if (error.reason === "input") fail("input", errorPath);
    if (error.reason === "root-scope") fail("root-scope", errorPath);
    if (error.reason === "parent-not-found") {
      fail("parent-not-found", errorPath);
    }
    if (error.reason === "parent-symlink") {
      fail("parent-symlink", errorPath);
    }
    if (error.reason === "parent-not-directory") {
      fail("parent-not-directory", errorPath);
    }
    if (error.reason === "parent-open-failure") {
      fail("parent-open-failure", errorPath);
    }
  }
  fail("parent-changed", errorPath);
}

async function openResourceParent(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  errorPath: ResourceErrorPath,
): Promise<RootedResourceParentHandle> {
  try {
    return await RootedResourceParentHandle.open(
      root,
      resourcePath,
      errorPath,
    );
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      mapParentHandleError(error, "open", errorPath);
    }
    throw error;
  }
}

async function assertParentCurrent(
  parent: RootedResourceParentHandle,
  errorPath: ResourceErrorPath,
): Promise<void> {
  try {
    await parent.assertCurrent();
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      mapParentHandleError(error, "current", errorPath);
    }
    throw error;
  }
}

async function inspectParentTarget(
  parent: RootedResourceParentHandle,
  errorPath: ResourceErrorPath,
  reason: "destination-inspection-failure" | "commit-uncertain",
): Promise<Readonly<FileNodeSnapshot> | null> {
  try {
    return await parent.inspectTarget();
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      mapParentHandleError(error, "inspect", errorPath, reason);
    }
    throw error;
  }
}

async function syncParent(
  parent: RootedResourceParentHandle,
  errorPath: ResourceErrorPath,
): Promise<void> {
  try {
    await parent.sync();
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      mapParentHandleError(error, "sync", errorPath);
    }
    throw error;
  }
}

async function closeParent(
  parent: RootedResourceParentHandle,
): Promise<DurableResourceRenameError | undefined> {
  try {
    await parent.close();
    return undefined;
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      return new DurableResourceRenameError(
        error.reason === "close-failure" ? "close-failure" : "parent-changed",
        "$resourcePath",
      );
    }
    throw error;
  }
}

function mapExactSourceError(
  error: RootedExactResourceHandleError,
  operation: "open" | "current" | "inspect-after-commit",
): never {
  if (operation === "inspect-after-commit") {
    fail("commit-uncertain", "$destinationResourcePath");
  }
  if (operation === "current") fail("source-changed", "$sourceResourcePath");
  if (error.reason === "input") fail("input", "$sourceResourcePath");
  if (error.reason === "root-scope") fail("root-scope", "$sourceResourcePath");
  if (error.reason === "resource-not-found") {
    fail("source-not-found", "$sourceResourcePath");
  }
  if (error.reason === "resource-symlink") {
    fail("source-symlink", "$sourceResourcePath");
  }
  if (error.reason === "resource-kind") {
    fail("source-not-supported", "$sourceResourcePath");
  }
  if (error.reason === "resource-open-failure") {
    fail("source-open-failure", "$sourceResourcePath");
  }
  fail("source-changed", "$sourceResourcePath");
}

async function openExactSource(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  expected: Readonly<FileNodeSnapshot>,
): Promise<RootedExactResourceHandle> {
  try {
    return await RootedExactResourceHandle.openFileOrDirectory(
      root,
      resourcePath,
      expected,
      "$sourceResourcePath",
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

async function closeSource(
  source: RootedExactResourceHandle,
): Promise<DurableResourceRenameError | undefined> {
  try {
    await source.close();
    return undefined;
  } catch (error: unknown) {
    if (error instanceof RootedExactResourceHandleError) {
      return new DurableResourceRenameError("close-failure", "$resourcePath");
    }
    throw error;
  }
}

function sameMovedNode(
  before: Readonly<FileNodeSnapshot>,
  after: Readonly<FileNodeSnapshot>,
): boolean {
  return (
    sameFileNodeIdentity(before, after)
    && before.kind === after.kind
    && before.rawMode === after.rawMode
    && before.permissionBits === after.permissionBits
    && before.linkCount === after.linkCount
    && before.userId === after.userId
    && before.groupId === after.groupId
    && before.specialDeviceId === after.specialDeviceId
    && before.byteCount === after.byteCount
    && before.modifiedAtNanoseconds === after.modifiedAtNanoseconds
  );
}

async function assertSourceAbsent(
  sourceParent: RootedResourceParentHandle,
): Promise<void> {
  if (
    await inspectParentTarget(
      sourceParent,
      "$sourceResourcePath",
      "commit-uncertain",
    ) !== null
  ) {
    fail("commit-uncertain", "$sourceResourcePath");
  }
}

async function inspectMovedDestination(
  destination: RootedResourceParentHandle,
  source: RootedExactResourceHandle,
): Promise<Readonly<FileNodeSnapshot>> {
  const destinationNode = await inspectParentTarget(
    destination,
    "$destinationResourcePath",
    "commit-uncertain",
  );
  if (destinationNode === null) {
    fail("commit-uncertain", "$destinationResourcePath");
  }
  const opened = await inspectCommittedSource(source);
  if (
    !sameMovedNode(source.initialNodeSnapshot, opened)
    || !sameFileNodeSnapshot(opened, destinationNode)
  ) {
    fail("commit-uncertain", "$destinationResourcePath");
  }
  return destinationNode;
}

async function syncParents(
  sourceParent: RootedResourceParentHandle,
  destinationParent: RootedResourceParentHandle,
): Promise<void> {
  await syncParent(sourceParent, "$sourceResourcePath");
  if (
    destinationParent.parentResourcePath
    !== sourceParent.parentResourcePath
  ) {
    await syncParent(destinationParent, "$destinationResourcePath");
  }
}

function destinationInsideSource(
  source: PortableResourcePath,
  destination: PortableResourcePath,
): boolean {
  return destination.startsWith(`${source}/`);
}

/**
 * 在同一 RootedDirectory 内持久 rename 一个 exact real file 或 directory。
 *
 * 成功返回只证明目录项 move 和节点身份；regular-file 内容本身的持久性必须由其
 * writer 在 rename 前建立。调用方必须持有覆盖 source/destination 的领域锁。
 */
export async function renameResourceDurably(
  root: RootedDirectory,
  sourceResourcePath: PortableResourcePath,
  destinationResourcePath: PortableResourcePath,
  options: DurableResourceRenameOptions,
): Promise<Readonly<DurableResourceRenameResult>> {
  assertRoot(root);
  const parsed = parseOptions(options);
  if (
    sourceResourcePath === destinationResourcePath
    || (
      parsed.expectedSourceNode.kind === "directory"
      && destinationInsideSource(sourceResourcePath, destinationResourcePath)
    )
  ) {
    fail("input", "$destinationResourcePath");
  }
  assertNotAborted(parsed.signal);

  const sourceParent = await openResourceParent(
    root,
    sourceResourcePath,
    "$sourceResourcePath",
  );
  let destinationParent: RootedResourceParentHandle | undefined;
  let source: RootedExactResourceHandle | undefined;
  let committed = false;
  let primaryError: unknown;
  let result: Readonly<DurableResourceRenameResult> | undefined;

  try {
    destinationParent = await openResourceParent(
      root,
      destinationResourcePath,
      "$destinationResourcePath",
    );

    source = await openExactSource(
      root,
      sourceResourcePath,
      parsed.expectedSourceNode,
    );
    if (source.resourceAbsolutePath !== sourceParent.resourceAbsolutePath) {
      fail("root-scope", "$sourceResourcePath");
    }
    if (
      source.initialNodeSnapshot.deviceId
      !== destinationParent.initialParentSnapshot.deviceId
    ) {
      fail("cross-device", "$destinationResourcePath");
    }
    if (
      await inspectParentTarget(
        destinationParent,
        "$destinationResourcePath",
        "destination-inspection-failure",
      ) !== null
    ) {
      fail("destination-exists", "$destinationResourcePath");
    }

    await assertParentCurrent(sourceParent, "$sourceResourcePath");
    await assertParentCurrent(destinationParent, "$destinationResourcePath");
    await assertSourceCurrent(source);
    if (
      await inspectParentTarget(
        destinationParent,
        "$destinationResourcePath",
        "destination-inspection-failure",
      ) !== null
    ) {
      fail("destination-exists", "$destinationResourcePath");
    }
    assertNotAborted(parsed.signal);

    try {
      await rename(
        sourceParent.resourceAbsolutePath,
        destinationParent.resourceAbsolutePath,
      );
    } catch (error: unknown) {
      if (readNodeSystemErrorCode(error) === "EXDEV") {
        fail("cross-device", "$destinationResourcePath");
      }
      fail("rename-failure", "$destinationResourcePath");
    }
    committed = true;

    await assertSourceAbsent(sourceParent);
    const movedNode = await inspectMovedDestination(destinationParent, source);
    await syncParents(sourceParent, destinationParent);
    await assertParentCurrent(sourceParent, "$sourceResourcePath");
    await assertParentCurrent(destinationParent, "$destinationResourcePath");
    await assertSourceAbsent(sourceParent);
    const finalNode = await inspectMovedDestination(destinationParent, source);
    if (!sameFileNodeSnapshot(movedNode, finalNode)) {
      fail("commit-uncertain", "$destinationResourcePath");
    }
    result = Object.freeze({
      sourceResourcePath,
      destinationResourcePath,
      kind: source.kind,
      node: finalNode,
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
  if (destinationParent !== undefined) {
    const closeError = await closeParent(destinationParent);
    if (primaryError === undefined && closeError !== undefined) {
      primaryError = closeError;
    }
  }
  const sourceParentCloseError = await closeParent(sourceParent);
  if (primaryError === undefined && sourceParentCloseError !== undefined) {
    primaryError = sourceParentCloseError;
  }

  if (primaryError !== undefined) throw primaryError;
  if (committed !== true || result === undefined) {
    fail("commit-uncertain", "$destinationResourcePath");
  }
  return result;
}
