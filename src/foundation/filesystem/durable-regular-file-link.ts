import { link } from "node:fs/promises";
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
 * Wakeflow Foundation / Filesystem：普通文件的不替换目标持久化硬链接。
 *
 * 调用方必须提供冻结且完全一致的源节点预期。本模块打开并复验源、目标父目录和
 * 不跟随符号链接的源句柄，然后只跨越一次硬链接提交点。链接成功后，源路径与目标
 * 路径必须构成指向同一 inode 的精确链接对，链接数在原值上增加 1；随后同步源 inode
 * 和目标父目录，并完成最终复验。
 *
 * 成功结果会有意保留两个路径名。本能力不删除或重命名源路径，也不把链接对描述为
 * 资源已经移动完成。后续暂存文件分离和精确删除必须由领域恢复意图分步编排；链接
 * 调用后的失败也不会猜测删除目标路径。
 *
 * 本层不接受目录、符号链接或特殊节点，不复制跨设备源资源、不创建父目录、不持有
 * 业务锁，也不拥有完整的移动或恢复状态机。Node.js 缺少基于文件描述符的 `linkat`，
 * 因此路径名竞态边界与 `RootedDirectory` 保持一致。
 */

export interface DurableRegularFileLinkOptions {
  readonly expectedSourceNode: Readonly<FileNodeSnapshot>;
  readonly signal?: AbortSignal;
}

/** 成功结果描述已经完成 inode 与目标父目录同步的精确链接对。 */
interface DurableRegularFileLinkResult {
  readonly sourceResourcePath: PortableResourcePath;
  readonly destinationResourcePath: PortableResourcePath;
  readonly sourceNode: Readonly<FileNodeSnapshot>;
  readonly destinationNode: Readonly<FileNodeSnapshot>;
}

/** 普通文件持久化链接失败的分类。 */
export type DurableRegularFileLinkErrorReason =
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
  | "destination-exists"
  | "destination-inspection-failure"
  | "cross-device"
  | "link-failure"
  | "commit-uncertain"
  | "durability-failure"
  | "aborted"
  | "close-failure";

const ERROR_MESSAGES = {
  "input": "Durable regular file link input is invalid.",
  "root-scope": "Regular file link could not establish its rooted scope.",
  "parent-not-found": "Regular file link parent directory does not exist.",
  "parent-symlink": "Regular file link parent chain cannot contain a symbolic link.",
  "parent-not-directory": "Regular file link parent must be a directory.",
  "parent-open-failure": "Regular file link parent could not be opened safely.",
  "parent-changed": "Regular file link parent changed during the operation.",
  "source-not-found": "Regular file link source does not exist.",
  "source-symlink": "Regular file link source cannot be a symbolic link.",
  "source-not-file": "Regular file link source must be a regular file.",
  "source-open-failure": "Regular file link source could not be opened safely.",
  "source-changed": "Regular file link source no longer matches its expectation.",
  "destination-exists": "Regular file link destination already exists.",
  "destination-inspection-failure": "Regular file link destination could not be inspected safely.",
  "cross-device": "Regular file hard link cannot cross a filesystem boundary.",
  "link-failure": "Regular file hard-link commit could not be executed safely.",
  "commit-uncertain": "Regular file linked-pair commit could not be proven exact.",
  "durability-failure": "Regular file linked pair could not be synchronized safely.",
  "aborted": "Regular file link was aborted before commit.",
  "close-failure": "A regular file link handle could not be closed safely.",
} as const satisfies Readonly<Record<DurableRegularFileLinkErrorReason, string>>;

/**
 * 普通文件持久化链接失败时返回的稳定错误。
 *
 * 错误不回显物理路径、资源引用、节点元数据、链接数、取消原因、系统调用或底层原因。
 * `link` 调用后的错误不得被解释为目标路径一定不存在。
 */
export class DurableRegularFileLinkError extends Error {
  override readonly name = "DurableRegularFileLinkError";
  readonly code = "wakeflow-durable-regular-file-link" as const;
  readonly reason: DurableRegularFileLinkErrorReason;
  readonly path: string;

  constructor(reason: DurableRegularFileLinkErrorReason, path: string) {
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

function fail(reason: DurableRegularFileLinkErrorReason, path: string): never {
  throw new DurableRegularFileLinkError(reason, path);
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
    fail("durability-failure", errorPath);
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
): Promise<DurableRegularFileLinkError | undefined> {
  try {
    await parent.close();
    return undefined;
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      return new DurableRegularFileLinkError(
        error.reason === "close-failure" ? "close-failure" : "parent-changed",
        errorPath,
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
    fail("durability-failure", "$destinationResourcePath");
  }
  if (
    operation === "inspect-after-commit"
    || operation === "sync-after-commit"
  ) {
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
    fail("source-not-file", "$sourceResourcePath");
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
    return await RootedExactResourceHandle.openRegularFile(
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
): Promise<DurableRegularFileLinkError | undefined> {
  try {
    await source.close();
    return undefined;
  } catch (error: unknown) {
    if (error instanceof RootedExactResourceHandleError) {
      return new DurableRegularFileLinkError(
        "close-failure",
        "$sourceResourcePath",
      );
    }
    throw error;
  }
}

function sameLinkedNode(
  before: Readonly<FileNodeSnapshot>,
  after: Readonly<FileNodeSnapshot>,
  expectedLinkCount: bigint,
): boolean {
  return (
    sameFileNodeIdentity(before, after)
    && before.kind === "file"
    && after.kind === "file"
    && before.rawMode === after.rawMode
    && before.permissionBits === after.permissionBits
    && after.linkCount === expectedLinkCount
    && before.userId === after.userId
    && before.groupId === after.groupId
    && before.specialDeviceId === after.specialDeviceId
    && before.byteCount === after.byteCount
    && before.modifiedAtNanoseconds === after.modifiedAtNanoseconds
  );
}

async function inspectLinkedPair(
  source: RootedExactResourceHandle,
  sourceParent: RootedResourceParentHandle,
  destinationParent: RootedResourceParentHandle,
  linkedPairLinkCount: bigint,
): Promise<Readonly<{
  sourceNode: Readonly<FileNodeSnapshot>;
  destinationNode: Readonly<FileNodeSnapshot>;
}>> {
  const sourceNode = await inspectParentTarget(
    sourceParent,
    "$sourceResourcePath",
    "commit-uncertain",
  );
  if (sourceNode === null) {
    fail("commit-uncertain", "$destinationResourcePath");
  }
  const destinationNode = await inspectParentTarget(
    destinationParent,
    "$destinationResourcePath",
    "commit-uncertain",
  );
  if (destinationNode === null) {
    fail("commit-uncertain", "$destinationResourcePath");
  }
  const opened = await inspectCommittedSource(source);
  if (
    !sameLinkedNode(
      source.initialNodeSnapshot,
      opened,
      linkedPairLinkCount,
    )
    || !sameFileNodeSnapshot(opened, sourceNode)
    || !sameFileNodeSnapshot(opened, destinationNode)
  ) {
    fail("commit-uncertain", "$destinationResourcePath");
  }
  return Object.freeze({
    sourceNode,
    destinationNode,
  });
}

/**
 * 为指定的源普通文件持久发布一个不替换目标的硬链接。
 *
 * 成功结果是可由恢复意图观察的链接对；调用方不得把它当成源资源已经移动。
 */
export async function linkRegularFileWithoutReplacement(
  root: RootedDirectory,
  sourceResourcePath: PortableResourcePath,
  destinationResourcePath: PortableResourcePath,
  options: DurableRegularFileLinkOptions,
): Promise<Readonly<DurableRegularFileLinkResult>> {
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
  if (sourcePath === destinationPath) {
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
  let result: Readonly<DurableRegularFileLinkResult> | undefined;

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
      await link(
        sourceParent.resourceAbsolutePath,
        destinationParent.resourceAbsolutePath,
      );
    } catch (error: unknown) {
      const code = readNodeSystemErrorCode(error);
      if (code === "EEXIST") fail("destination-exists", "$destinationResourcePath");
      if (code === "EXDEV") fail("cross-device", "$destinationResourcePath");
      fail("link-failure", "$destinationResourcePath");
    }
    const nodeBefore = source.initialNodeSnapshot;
    const linkedPairLinkCount = nodeBefore.linkCount + 1n;
    const linked = await inspectLinkedPair(
      source,
      sourceParent,
      destinationParent,
      linkedPairLinkCount,
    );
    await syncCommittedSource(source);
    await syncParent(destinationParent, "$destinationResourcePath");
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
    const final = await inspectLinkedPair(
      source,
      sourceParent,
      destinationParent,
      linkedPairLinkCount,
    );
    if (
      !sameFileNodeSnapshot(linked.sourceNode, final.sourceNode)
      || !sameFileNodeSnapshot(
        linked.destinationNode,
        final.destinationNode,
      )
    ) {
      fail("commit-uncertain", "$destinationResourcePath");
    }
    result = Object.freeze({
      sourceResourcePath: sourcePath,
      destinationResourcePath: destinationPath,
      sourceNode: final.sourceNode,
      destinationNode: final.destinationNode,
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
