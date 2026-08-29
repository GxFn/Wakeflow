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
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "./portable-resource-path.js";
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
 * Wakeflow Foundation / Filesystem：根作用域内真实文件或目录的持久化重命名。
 *
 * 调用方必须提供冻结且完全一致的源节点预期。本模块打开源、目标父目录，确认目标
 * 仍不存在且源节点仍匹配后，只跨越一次重命名提交点。提交后，它复验源路径已经
 * 不存在、目标路径与打开的源句柄仍指向同一 inode，再同步两侧父目录并完成最终复验。
 *
 * 普通重命名会替换晚到的目标；Node.js 未暴露 `renameat2(RENAME_NOREPLACE)`。因此，
 * “目标不存在”只是协作写入者持锁时的提交前置条件，不是跨进程比较并交换（CAS）。
 * 本能力不创建父目录、不复制跨设备源资源、不删除目标、不移动符号链接或特殊节点，
 * 也不同步普通文件内容、不持有业务锁或拥有恢复意图记录。
 */

export interface DurableResourceRenameOptions {
  readonly expectedSourceNode: Readonly<FileNodeSnapshot>;
  readonly signal?: AbortSignal;
}

type DurableRenamedResourceKind = "file" | "directory";

/** 成功结果描述已经完成父目录同步的目标节点。 */
interface DurableResourceRenameResult {
  readonly sourceResourcePath: PortableResourcePath;
  readonly destinationResourcePath: PortableResourcePath;
  readonly kind: DurableRenamedResourceKind;
  readonly node: Readonly<FileNodeSnapshot>;
}

/** 持久化资源重命名失败的分类。 */
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
 * 持久化资源重命名失败时返回的稳定错误。
 *
 * 错误不回显物理路径、资源引用、节点元数据、取消原因、系统调用或原因链。
 * 重命名调用后的错误不得被解释为源资源一定仍在原路径。
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

function parseResourcePath(
  value: unknown,
  path: ResourceErrorPath,
): PortableResourcePath {
  try {
    return parsePortableResourcePath(value, path);
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) fail("input", path);
    throw error;
  }
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
  afterCommit = false,
): Promise<void> {
  try {
    await parent.assertCurrent();
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      if (afterCommit) fail("commit-uncertain", errorPath);
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
  errorPath: ResourceErrorPath,
): Promise<DurableResourceRenameError | undefined> {
  try {
    await parent.close();
    return undefined;
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      return new DurableResourceRenameError(
        error.reason === "close-failure" ? "close-failure" : "parent-changed",
        errorPath,
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
      return new DurableResourceRenameError(
        "close-failure",
        "$sourceResourcePath",
      );
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
 * 在同一 `RootedDirectory` 内持久化重命名一个指定的真实文件或目录。
 *
 * 成功返回只证明目录项 move 和节点身份；regular-file 内容本身的持久性必须由其
 * 写入者在重命名前建立。调用方必须持有覆盖源路径和目标路径的领域锁。
 */
export async function renameResourceDurably(
  root: RootedDirectory,
  sourceResourcePath: PortableResourcePath,
  destinationResourcePath: PortableResourcePath,
  options: DurableResourceRenameOptions,
): Promise<Readonly<DurableResourceRenameResult>> {
  assertRoot(root);
  const parsed = parseOptions(options);
  const sourcePath = parseResourcePath(
    sourceResourcePath,
    "$sourceResourcePath",
  );
  const destinationPath = parseResourcePath(
    destinationResourcePath,
    "$destinationResourcePath",
  );
  if (
    sourcePath === destinationPath
    || (
      parsed.expectedSourceNode.kind === "directory"
      && destinationInsideSource(sourcePath, destinationPath)
    )
  ) {
    fail("input", "$destinationResourcePath");
  }
  assertNotAborted(parsed.signal);

  const sourceParent = await openResourceParent(
    root,
    sourcePath,
    "$sourceResourcePath",
  );
  let destinationParent: RootedResourceParentHandle | undefined;
  let source: RootedExactResourceHandle | undefined;
  let primaryError: unknown;
  let result: Readonly<DurableResourceRenameResult> | undefined;

  try {
    destinationParent = await openResourceParent(
      root,
      destinationPath,
      "$destinationResourcePath",
    );

    source = await openExactSource(
      root,
      sourcePath,
      parsed.expectedSourceNode,
    );
    if (source.resourceAbsolutePath !== sourceParent.resourceAbsolutePath) {
      fail("root-scope", "$sourceResourcePath");
    }
    if (
      source.initialNodeSnapshot.deviceId
      !== destinationParent.parentDeviceId
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
    await assertSourceAbsent(sourceParent);
    const movedNode = await inspectMovedDestination(destinationParent, source);
    await syncParents(sourceParent, destinationParent);
    await assertParentCurrent(
      sourceParent,
      "$sourceResourcePath",
      true,
    );
    await assertParentCurrent(
      destinationParent,
      "$destinationResourcePath",
      true,
    );
    await assertSourceAbsent(sourceParent);
    const finalNode = await inspectMovedDestination(destinationParent, source);
    if (!sameFileNodeSnapshot(movedNode, finalNode)) {
      fail("commit-uncertain", "$destinationResourcePath");
    }
    result = Object.freeze({
      sourceResourcePath: sourcePath,
      destinationResourcePath: destinationPath,
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
    const closeError = await closeParent(
      destinationParent,
      "$destinationResourcePath",
    );
    if (primaryError === undefined && closeError !== undefined) {
      primaryError = closeError;
    }
  }
  const sourceParentCloseError = await closeParent(
    sourceParent,
    "$sourceResourcePath",
  );
  if (primaryError === undefined && sourceParentCloseError !== undefined) {
    primaryError = sourceParentCloseError;
  }

  if (primaryError !== undefined) throw primaryError;
  if (result === undefined) {
    fail("commit-uncertain", "$destinationResourcePath");
  }
  return result;
}
