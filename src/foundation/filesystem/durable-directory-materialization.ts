import { constants as fileSystemConstants } from "node:fs";
import {
  mkdir,
  open as openFileHandle,
  type FileHandle,
} from "node:fs/promises";
import { types } from "node:util";

import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import {
  createFileNodeSnapshot,
  FileNodeSnapshotError,
  sameFileNodeIdentity,
  sameFileNodeSnapshot,
  type FileNodeSnapshot,
} from "./file-node-snapshot.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  splitPortableResourcePath,
  type PortableResourcePath,
} from "./portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
  type RootedResourceSnapshot,
} from "./rooted-directory.js";
import {
  RootedResourceParentHandle,
  RootedResourceParentHandleError,
} from "./rooted-resource-parent-handle.js";

/**
 * Wakeflow Foundation / Filesystem：根作用域目录的持久化创建与逐级建立。
 *
 * `createDirectoryAtomically` 只跨越一次“目标不存在 → 目录存在”的独占 `mkdir`
 * 边界，随后通过不跟随符号链接的句柄设置最终权限位、同步新目录与父目录，并复验
 * 路径名、句柄和 `RootedDirectory` 仍指向同一文件系统节点。
 *
 * `materializeDirectoryPath` 按可移植路径分段逐级组合该基础操作：已经存在的真实
 * 目录只观察而不修改权限，缺失段逐一持久创建。整条路径不是原子事务；中途失败时，
 * 已同步的安全前缀会保留，供调用方幂等重试或由领域恢复流程解释。
 *
 * 本层不创建文件、不删除或回滚目录、不修复已有权限位，也不判断职责所有者、允许
 * 的权限、目录是否为空、布局权威、恢复意图或多目录事务。Node.js 没有暴露
 * `mkdirat`，因此路径名竞态边界与 `RootedDirectory` 保持一致。
 */

/** 新目录在设置最终权限位前只允许当前用户进入。 */
const PRIVATE_DIRECTORY_MODE = 0o700;

export interface DurableDirectoryOptions {
  readonly mode: number;
  readonly signal?: AbortSignal;
}

export interface DurableDirectoryCreateResult {
  readonly resourcePath: PortableResourcePath;
  readonly disposition: "created";
  readonly node: Readonly<FileNodeSnapshot>;
}

export type DirectoryMaterializationDisposition = "existing" | "created";

/** 路径物化中一个根内目录段的最终冻结事实。 */
export interface DirectoryMaterializationEntry {
  readonly resourcePath: PortableResourcePath;
  readonly disposition: DirectoryMaterializationDisposition;
  readonly node: Readonly<FileNodeSnapshot>;
}

export interface DirectoryMaterializationResult {
  readonly resourcePath: PortableResourcePath;
  readonly node: Readonly<FileNodeSnapshot>;
  readonly segments: readonly Readonly<DirectoryMaterializationEntry>[];
}

/** 目录创建或物化失败的稳定分类。 */
export type DurableDirectoryMaterializationErrorReason =
  | "input"
  | "root-scope"
  | "parent-not-found"
  | "parent-symlink"
  | "parent-not-directory"
  | "parent-open-failure"
  | "parent-changed"
  | "target-exists"
  | "target-symlink"
  | "target-not-directory"
  | "target-inspection-failure"
  | "create-failure"
  | "commit-uncertain"
  | "durability-failure"
  | "path-changed"
  | "aborted"
  | "close-failure";

const ERROR_MESSAGES = {
  "input": "Durable directory materialization input is invalid.",
  "root-scope": "Directory target could not establish its rooted scope.",
  "parent-not-found": "Directory target parent does not exist.",
  "parent-symlink": "Directory target parent chain cannot contain a symbolic link.",
  "parent-not-directory": "Directory target parent must be a directory.",
  "parent-open-failure": "Directory target parent could not be opened safely.",
  "parent-changed": "Directory target parent changed during creation.",
  "target-exists": "Atomic directory create target already exists.",
  "target-symlink": "Directory materialization target cannot be a symbolic link.",
  "target-not-directory": "Directory materialization target must be a directory.",
  "target-inspection-failure": "Directory target could not be inspected safely.",
  "create-failure": "Directory target could not be created exclusively.",
  "commit-uncertain": "Created directory target could not be proven exact.",
  "durability-failure": "Created directory and parent could not be synchronized.",
  "path-changed": "Materialized directory path changed during final verification.",
  "aborted": "Directory materialization was aborted before the next mkdir.",
  "close-failure": "A directory materialization handle could not be closed safely.",
} as const satisfies Readonly<Record<
  DurableDirectoryMaterializationErrorReason,
  string
>>;

/**
 * 根作用域目录创建与物化的稳定错误。
 *
 * 错误不回显物理根目录、资源引用、目录名称、权限位、节点元数据、取消原因、
 * 系统调用或底层原因链。`mkdir` 调用后的错误不得被解释为目标一定不存在。
 */
export class DurableDirectoryMaterializationError extends Error {
  override readonly name = "DurableDirectoryMaterializationError";
  readonly code = "wakeflow-durable-directory-materialization" as const;
  readonly reason: DurableDirectoryMaterializationErrorReason;
  readonly path: string;

  constructor(
    reason: DurableDirectoryMaterializationErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedOptions {
  readonly mode: number;
  readonly signal: AbortSignal | undefined;
}

function fail(
  reason: DurableDirectoryMaterializationErrorReason,
  path: string,
): never {
  throw new DurableDirectoryMaterializationError(reason, path);
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

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  const allowed = new Set(["mode", "signal"]);
  if (
    !Object.hasOwn(record, "mode")
    || Object.keys(record).some((key) => !allowed.has(key))
  ) {
    fail("input", "$options");
  }
  const signal = record.signal;
  if (signal !== undefined && !isAbortSignal(signal)) {
    fail("input", "$options.signal");
  }
  return Object.freeze({ mode: parseMode(record.mode), signal });
}

function requiredDirectoryOpenFlags(): number {
  const directory: unknown = fileSystemConstants.O_DIRECTORY;
  const noFollow: unknown = fileSystemConstants.O_NOFOLLOW;
  if (typeof directory !== "number" || typeof noFollow !== "number") {
    fail("root-scope", "$root");
  }
  return fileSystemConstants.O_RDONLY | directory | noFollow;
}

async function snapshotHandle(
  handle: FileHandle,
  reason: DurableDirectoryMaterializationErrorReason,
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
  inspectReason?: "target-inspection-failure" | "commit-uncertain",
): never {
  if (operation === "sync" && error.reason === "sync-failure") {
    fail("durability-failure", "$resourcePath");
  }
  if (
    operation === "inspect"
    && error.reason === "target-inspection-failure"
  ) {
    fail(inspectReason ?? "target-inspection-failure", "$resourcePath");
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
  reason: "target-inspection-failure" | "commit-uncertain",
): Promise<Readonly<FileNodeSnapshot> | null> {
  try {
    return await parent.inspectTarget();
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      mapParentHandleError(error, "inspect", reason);
    }
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
      mapParentHandleError(error, "sync");
    }
    throw error;
  }
}

async function closeParent(
  parent: RootedResourceParentHandle,
): Promise<DurableDirectoryMaterializationError | undefined> {
  try {
    await parent.close();
    return undefined;
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      return new DurableDirectoryMaterializationError(
        error.reason === "close-failure" ? "close-failure" : "parent-changed",
        "$resourcePath",
      );
    }
    throw error;
  }
}

async function closeHandle(
  handle: FileHandle,
): Promise<DurableDirectoryMaterializationError | undefined> {
  try {
    await handle.close();
    return undefined;
  } catch {
    return new DurableDirectoryMaterializationError(
      "close-failure",
      "$resourcePath",
    );
  }
}

async function performAtomicCreate(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  options: Readonly<ParsedOptions>,
): Promise<Readonly<DurableDirectoryCreateResult>> {
  const parent = await openResourceParent(root, resourcePath);
  let targetHandle: FileHandle | undefined;
  let committed = false;
  let primaryError: unknown;
  let result: Readonly<DurableDirectoryCreateResult> | undefined;

  try {
    assertNotAborted(options.signal);
    await assertParentCurrent(parent);
    if (
      await inspectParentTarget(
        parent,
        "target-inspection-failure",
      ) !== null
    ) {
      fail("target-exists", "$resourcePath");
    }
    assertNotAborted(options.signal);

    try {
      await mkdir(parent.resourceAbsolutePath, {
        mode: PRIVATE_DIRECTORY_MODE,
        recursive: false,
      });
    } catch (error: unknown) {
      const code = readNodeSystemErrorCode(error);
      if (code === "EEXIST") fail("target-exists", "$resourcePath");
      if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
        fail("parent-changed", "$resourcePath");
      }
      fail("create-failure", "$resourcePath");
    }
    committed = true;

    try {
      targetHandle = await openFileHandle(
        parent.resourceAbsolutePath,
        requiredDirectoryOpenFlags(),
      );
    } catch {
      fail("commit-uncertain", "$resourcePath");
    }
    const opened = await snapshotHandle(
      targetHandle,
      "commit-uncertain",
      "$resourcePath",
    );
    const pathBefore = await inspectParentTarget(
      parent,
      "commit-uncertain",
    );
    if (
      pathBefore === null
      || opened.kind !== "directory"
      || pathBefore.kind !== "directory"
      || !sameFileNodeIdentity(opened, pathBefore)
    ) {
      fail("commit-uncertain", "$resourcePath");
    }
    try {
      await targetHandle.chmod(options.mode);
    } catch {
      fail("commit-uncertain", "$resourcePath");
    }
    const hardened = await snapshotHandle(
      targetHandle,
      "commit-uncertain",
      "$resourcePath",
    );
    if (
      hardened.kind !== "directory"
      || hardened.permissionBits !== options.mode
      || !sameFileNodeIdentity(opened, hardened)
    ) {
      fail("commit-uncertain", "$resourcePath");
    }
    try {
      await targetHandle.sync();
    } catch {
      fail("durability-failure", "$resourcePath");
    }
    await syncParent(parent);
    await assertParentCurrent(parent);
    const afterHandle = await snapshotHandle(
      targetHandle,
      "commit-uncertain",
      "$resourcePath",
    );
    const afterPath = await inspectParentTarget(
      parent,
      "commit-uncertain",
    );
    if (
      afterPath === null
      || afterPath.kind !== "directory"
      || afterHandle.permissionBits !== options.mode
      || !sameFileNodeSnapshot(hardened, afterHandle)
      || !sameFileNodeSnapshot(afterHandle, afterPath)
    ) {
      fail("commit-uncertain", "$resourcePath");
    }
    result = Object.freeze({
      resourcePath,
      disposition: "created" as const,
      node: afterPath,
    });
  } catch (error: unknown) {
    primaryError = error;
  }

  if (targetHandle !== undefined) {
    const closeError = await closeHandle(targetHandle);
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

async function inspectExistingDirectoryOrNull(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<Readonly<FileNodeSnapshot> | null> {
  let resource: Readonly<RootedResourceSnapshot>;
  try {
    resource = await root.inspectExistingResource(
      resourcePath,
      "$resourcePath",
    );
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      if (error.reason === "resource-not-found") return null;
      if (error.reason === "ancestor-symlink") {
        fail("parent-symlink", "$resourcePath");
      }
      if (error.reason === "ancestor-type") {
        fail("parent-not-directory", "$resourcePath");
      }
      if (error.reason === "resource-path") fail("input", "$resourcePath");
      fail("root-scope", "$resourcePath");
    }
    throw error;
  }
  if (resource.node.kind === "symbolic-link") {
    fail("target-symlink", "$resourcePath");
  }
  if (resource.node.kind !== "directory") {
    fail("target-not-directory", "$resourcePath");
  }
  return resource.node;
}

function prefixPaths(
  resourcePath: PortableResourcePath,
): readonly PortableResourcePath[] {
  let segments: readonly string[];
  try {
    segments = splitPortableResourcePath(resourcePath, "$resourcePath");
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      fail("input", "$resourcePath");
    }
    throw error;
  }
  const prefixes: PortableResourcePath[] = [];
  for (let index = 1; index <= segments.length; index += 1) {
    try {
      prefixes.push(parsePortableResourcePath(
        segments.slice(0, index).join("/"),
        "$resourcePath",
      ));
    } catch (error: unknown) {
      if (error instanceof PortableResourcePathError) {
        fail("input", "$resourcePath");
      }
      throw error;
    }
  }
  return Object.freeze(prefixes);
}

function publicOptions(
  options: Readonly<ParsedOptions>,
): DurableDirectoryOptions {
  return options.signal === undefined
    ? { mode: options.mode }
    : { mode: options.mode, signal: options.signal };
}

/**
 * 原子且持久地创建一个父目录已经存在的根内目录。
 *
 * 目标已经存在时始终失败；本函数不会把同名目录解释为幂等成功，也不会在 `mkdir`
 * 后失败时盲目执行 `rmdir`，因为其他写入者可能已经在已发布目录中建立事实。
 */
export async function createDirectoryAtomically(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  options: DurableDirectoryOptions,
): Promise<Readonly<DurableDirectoryCreateResult>> {
  assertRoot(root);
  const parsed = parseOptions(options);
  assertNotAborted(parsed.signal);
  return performAtomicCreate(root, resourcePath, parsed);
}

/**
 * 按顺序幂等物化一个根内目录路径。
 *
 * 已有真实目录不修改权限位；缺失段使用 `createDirectoryAtomically`。最终再次逐段
 * 检查 identity，返回反映物化结束时的节点事实。失败不回滚已持久创建的前缀。
 */
export async function materializeDirectoryPath(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  options: DurableDirectoryOptions,
): Promise<Readonly<DirectoryMaterializationResult>> {
  assertRoot(root);
  const parsed = parseOptions(options);
  const prefixes = prefixPaths(resourcePath);
  assertNotAborted(parsed.signal);

  const observations: DirectoryMaterializationEntry[] = [];
  for (const prefix of prefixes) {
    assertNotAborted(parsed.signal);
    const existing = await inspectExistingDirectoryOrNull(root, prefix);
    if (existing !== null) {
      observations.push(Object.freeze({
        resourcePath: prefix,
        disposition: "existing" as const,
        node: existing,
      }));
      continue;
    }

    try {
      const created = await createDirectoryAtomically(
        root,
        prefix,
        publicOptions(parsed),
      );
      observations.push(Object.freeze({
        resourcePath: prefix,
        disposition: created.disposition,
        node: created.node,
      }));
    } catch (error: unknown) {
      if (
        error instanceof DurableDirectoryMaterializationError
        && error.reason === "target-exists"
      ) {
        const concurrent = await inspectExistingDirectoryOrNull(root, prefix);
        if (concurrent === null) fail("path-changed", "$resourcePath");
        observations.push(Object.freeze({
          resourcePath: prefix,
          disposition: "existing" as const,
          node: concurrent,
        }));
        continue;
      }
      throw error;
    }
  }

  const finalEntries: DirectoryMaterializationEntry[] = [];
  for (const observation of observations) {
    const current = await inspectExistingDirectoryOrNull(
      root,
      observation.resourcePath,
    );
    if (
      current === null
      || !sameFileNodeIdentity(observation.node, current)
    ) {
      fail("path-changed", "$resourcePath");
    }
    finalEntries.push(Object.freeze({
      resourcePath: observation.resourcePath,
      disposition: observation.disposition,
      node: current,
    }));
  }
  const final = finalEntries.at(-1);
  if (final === undefined) fail("path-changed", "$resourcePath");
  return Object.freeze({
    resourcePath,
    node: final.node,
    segments: Object.freeze(finalEntries),
  });
}
