import { constants as fileSystemConstants } from "node:fs";
import { type FileHandle, open as openFileHandle } from "node:fs/promises";

import { PassiveOwnDataError, parsePlainRecord } from "../data/passive-own-data.js";
import { isAbortSignal, throwIfAborted } from "../node/abort-signal.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import {
  createFileNodeSnapshot,
  type FileNodeSnapshot,
  sameFileNodeIdentity,
} from "./file-node-snapshot.js";
import { filesystemMutation } from "./filesystem-mutation.js";
import {
  type PortableResourcePath,
  PortableResourcePathError,
  parsePortableResourcePath,
  splitPortableResourcePath,
} from "./portable-resource-path.js";
import {
  isRootedDirectory,
  type RootedDirectory,
  RootedDirectoryError,
  type RootedResourceSnapshot,
} from "./rooted-directory.js";
import {
  closeParentHandle,
  parentOpenRefusal,
  RootedResourceParentHandle,
  type RootedResourceParentHandleError,
  translateParentHandleError,
} from "./rooted-resource-parent-handle.js";

/**
 * Wakeflow Foundation / Filesystem：根作用域目录的持久化创建与逐级建立。
 *
 * `createDirectoryAtomically` 只跨越一次“目标不存在 → 目录存在”的独占 `mkdir`
 * 边界，随后通过不跟随符号链接的句柄核对权限位、同步父目录，并复验路径名、句柄和
 * `RootedDirectory` 仍指向同一文件系统节点。请求的权限位含属主读写进入（0700 各位）
 * 时，`mkdir` 直接以请求的权限位创建；进程 umask 只能把它收窄，所以新目录从出生起
 * 就不比请求更宽。句柄上看到的权限位等于请求时不再 chmod，也不另同步新目录：条目与
 * 权限位由同一次 `mkdir` 写下，同步父目录一次（常见 umask 022 下的 0755、0700 都是
 * 一次）。权限位不等于请求时（收窄的 umask），经句柄 chmod 到请求的权限位，并在同步
 * 父目录之前先同步新目录自身，共两次。请求的权限位缺少属主读写进入时（例如 0），
 * 新目录仍以 0700 出生再经句柄 chmod，同样两次。
 *
 * 剩下的窗口：只在需要 chmod 的那两种情形里。进程在 `mkdir` 与 chmod 之间被杀，
 * 目录以出生时的权限位留下，不需要断电；从 `mkdir` 到新目录自身同步完成之间断电，
 * 条目可能因别人对父目录的同步或文件系统自己的刷写先落盘而 chmod 未落盘，结果相同。
 * 本层不修复已有目录的权限位：下一次逐级建立把它当作已有目录原样留下，由上层的布局
 * 检查拒绝。出生的权限位等于请求时没有这个窗口：条目与权限位由同一次 `mkdir` 写下。
 *
 * `createTreeCandidateDirectoryAtomically` 只供目录树候选使用：创建规则、chmod 与
 * 复验完全相同，但一次都不同步。目录树候选在全部成员写完之后逐个同步树内的每个目录
 * 一次，再由发布的重命名同步暂存与目标的父目录，所以“建好就同步父目录”在树内不适用。
 * 以请求的权限位出生的树内目录没有未覆盖的权限位改动；需要 chmod 时，上面的窗口在树内
 * 一直延续到树同步这个目录为止。
 *
 * `materializeDirectoryPath` 按可移植路径分段逐级组合该基础操作：已经存在的真实
 * 目录只观察而不修改权限，缺失段逐一持久创建。整条路径不是原子事务；中途失败时，
 * 已同步的安全前缀会保留，供调用方幂等重试或由领域恢复流程解释。
 *
 * 本层不创建文件、不删除或回滚目录、不修复已有权限位，也不判断职责所有者、允许
 * 的权限、目录是否为空、布局权威、恢复意图或多目录事务。Node.js 没有暴露
 * `mkdirat`，因此路径名竞态边界与 `RootedDirectory` 保持一致。
 */

/**
 * 请求的权限位缺少属主读写进入时的出生权限位：新目录先只允许当前用户进入，打开句柄
 * 之后再 chmod 到请求的权限位。
 */
const PRIVATE_DIRECTORY_MODE = 0o700;

/** 含属主读写进入的请求以自身出生（umask 只会收窄它），否则以 0700 出生。 */
function birthMode(mode: number): number {
  return (mode & PRIVATE_DIRECTORY_MODE) === PRIVATE_DIRECTORY_MODE ? mode : PRIVATE_DIRECTORY_MODE;
}

export interface DurableDirectoryOptions {
  readonly mode: number;
  readonly signal?: AbortSignal;
}

interface DurableDirectoryCreateResult {
  readonly resourcePath: PortableResourcePath;
  readonly disposition: "created";
  readonly node: Readonly<FileNodeSnapshot>;
}

export type DirectoryMaterializationDisposition = "existing" | "created";

/** 路径物化中一个根内目录段的最终冻结事实。 */
interface DirectoryMaterializationEntry {
  readonly resourcePath: PortableResourcePath;
  readonly disposition: DirectoryMaterializationDisposition;
  readonly node: Readonly<FileNodeSnapshot>;
}

interface DirectoryMaterializationResult {
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
  | "close-failure";

const ERROR_MESSAGES = {
  input: "Durable directory materialization input is invalid.",
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
  "close-failure": "A directory materialization handle could not be closed safely.",
} as const satisfies Readonly<Record<DurableDirectoryMaterializationErrorReason, string>>;

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
  /** `mkdir` 之后的失败：目录可能已经建好，也可能没有。 */
  readonly commitUncertain: boolean;

  constructor(
    reason: DurableDirectoryMaterializationErrorReason,
    path: string,
    options?: ErrorOptions,
  ) {
    super(ERROR_MESSAGES[reason], options);
    this.reason = reason;
    this.path = path;
    this.commitUncertain =
      reason === "commit-uncertain" ||
      reason === "durability-failure" ||
      reason === "close-failure";
  }
}

interface ParsedOptions {
  readonly mode: number;
  readonly signal: AbortSignal | undefined;
}

function fail(
  reason: DurableDirectoryMaterializationErrorReason,
  path: string,
  cause?: unknown,
): never {
  throw new DurableDirectoryMaterializationError(
    reason,
    path,
    cause === undefined ? undefined : { cause },
  );
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (!isRootedDirectory(value)) fail("input", "$root");
}

function parseMode(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0o777) {
    fail("input", "$options.mode");
  }
  return value;
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options", error);
    throw error;
  }
  const allowed = new Set(["mode", "signal"]);
  if (!Object.hasOwn(record, "mode") || Object.keys(record).some((key) => !allowed.has(key))) {
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
    return createFileNodeSnapshot(await handle.stat({ bigint: true }), path);
  } catch (cause: unknown) {
    fail(reason, path, cause);
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
  if (operation === "inspect" && error.reason === "target-inspection-failure") {
    fail(inspectReason ?? "target-inspection-failure", "$resourcePath");
  }
  const refusal = operation === "open" ? parentOpenRefusal(error) : undefined;
  if (refusal !== undefined) fail(refusal, "$resourcePath");
  fail("parent-changed", "$resourcePath");
}

function openResourceParent(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<RootedResourceParentHandle> {
  return translateParentHandleError(
    () => RootedResourceParentHandle.open(root, resourcePath, "$resourcePath"),
    (error) => mapParentHandleError(error, "open"),
  );
}

function assertParentCurrent(
  parent: RootedResourceParentHandle,
): Promise<Readonly<FileNodeSnapshot>> {
  return translateParentHandleError(
    () => parent.assertCurrent(),
    (error) => mapParentHandleError(error, "current"),
  );
}

function inspectParentTarget(
  parent: RootedResourceParentHandle,
  reason: "target-inspection-failure" | "commit-uncertain",
): Promise<Readonly<FileNodeSnapshot> | null> {
  return translateParentHandleError(
    () => parent.inspectTarget(),
    (error) => mapParentHandleError(error, "inspect", reason),
  );
}

function syncParent(parent: RootedResourceParentHandle): Promise<Readonly<FileNodeSnapshot>> {
  return translateParentHandleError(
    () => parent.sync(),
    (error) => mapParentHandleError(error, "sync"),
  );
}

function closeParent(
  parent: RootedResourceParentHandle,
): Promise<DurableDirectoryMaterializationError | undefined> {
  return closeParentHandle(
    parent,
    (error) =>
      new DurableDirectoryMaterializationError(
        error.reason === "close-failure" ? "close-failure" : "parent-changed",
        "$resourcePath",
      ),
  );
}

async function closeHandle(
  handle: FileHandle,
): Promise<DurableDirectoryMaterializationError | undefined> {
  try {
    await handle.close();
    return undefined;
  } catch {
    return new DurableDirectoryMaterializationError("close-failure", "$resourcePath");
  }
}

function sameDirectoryFacts(
  left: Readonly<FileNodeSnapshot>,
  right: Readonly<FileNodeSnapshot>,
): boolean {
  return (
    left.kind === "directory" &&
    right.kind === "directory" &&
    sameFileNodeIdentity(left, right) &&
    left.rawMode === right.rawMode &&
    left.permissionBits === right.permissionBits &&
    left.userId === right.userId &&
    left.groupId === right.groupId
  );
}

async function performAtomicCreate(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  options: Readonly<ParsedOptions>,
  parentEntry: "sync" | "deferred",
): Promise<Readonly<DurableDirectoryCreateResult>> {
  const parent = await openResourceParent(root, resourcePath);
  let targetHandle: FileHandle | undefined;
  let primaryError: unknown;
  let result: Readonly<DurableDirectoryCreateResult> | undefined;

  try {
    throwIfAborted(options.signal);
    await assertParentCurrent(parent);
    if ((await inspectParentTarget(parent, "target-inspection-failure")) !== null) {
      fail("target-exists", "$resourcePath");
    }
    throwIfAborted(options.signal);

    try {
      await filesystemMutation.mkdir(parent.resourceAbsolutePath, {
        mode: birthMode(options.mode),
        recursive: false,
      });
    } catch (error: unknown) {
      const code = readNodeSystemErrorCode(error);
      if (code === "EEXIST") fail("target-exists", "$resourcePath", error);
      if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
        fail("parent-changed", "$resourcePath", error);
      }
      fail("create-failure", "$resourcePath", error);
    }
    try {
      targetHandle = await openFileHandle(
        parent.resourceAbsolutePath,
        requiredDirectoryOpenFlags(),
      );
    } catch (cause: unknown) {
      fail("commit-uncertain", "$resourcePath", cause);
    }
    const opened = await snapshotHandle(targetHandle, "commit-uncertain", "$resourcePath");
    const pathBefore = await inspectParentTarget(parent, "commit-uncertain");
    if (
      pathBefore === null ||
      opened.kind !== "directory" ||
      pathBefore.kind !== "directory" ||
      !sameFileNodeIdentity(opened, pathBefore)
    ) {
      fail("commit-uncertain", "$resourcePath");
    }
    // 出生的权限位已等于请求时不 chmod：条目与权限位由同一次 `mkdir` 写下。
    const chmodNeeded = opened.permissionBits !== options.mode;
    if (chmodNeeded) {
      try {
        await targetHandle.chmod(options.mode);
      } catch (cause: unknown) {
        fail("commit-uncertain", "$resourcePath", cause);
      }
    }
    const hardened = await snapshotHandle(targetHandle, "commit-uncertain", "$resourcePath");
    if (
      hardened.kind !== "directory" ||
      hardened.permissionBits !== options.mode ||
      !sameFileNodeIdentity(opened, hardened)
    ) {
      fail("commit-uncertain", "$resourcePath");
    }
    // 上面的 chmod 只记在新目录自己的 inode 上，父目录同步不覆盖它。单独新建的目录
    // chmod 过就先同步自己、再同步父目录：顺序反过来，断电可能留下条目而权限位退回
    // 出生时的值。没有 chmod 的目录不另同步。
    // 目录树候选传 `deferred`，两次都不发：树在成员写完之后逐个同步每个目录一次，
    // 那一次同时覆盖它的权限位，父目录交给发布的重命名同步。
    // 同步与否只由根的持久化级别决定（`none` 只省掉 `fsync` 本身）；`mkdir`、权限收紧
    // 与提交后复验在各档都照常执行。
    if (parentEntry === "sync" && root.durability === "fsync" && chmodNeeded) {
      try {
        await targetHandle.sync();
      } catch (cause: unknown) {
        fail("durability-failure", "$resourcePath", cause);
      }
    }
    if (parentEntry === "sync") await syncParent(parent);
    await assertParentCurrent(parent);
    const afterHandle = await snapshotHandle(targetHandle, "commit-uncertain", "$resourcePath");
    const afterPath = await inspectParentTarget(parent, "commit-uncertain");
    // 目录一旦发布，其他写入者就可以在里面建立事实；这会改变链接数、大小与时间戳，
    // 但不改变目录本身的身份、类型、权限位与属主。终检只比较这些稳定事实。
    if (
      afterPath === null ||
      afterPath.kind !== "directory" ||
      afterHandle.permissionBits !== options.mode ||
      !sameDirectoryFacts(hardened, afterHandle) ||
      !sameDirectoryFacts(afterHandle, afterPath)
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
  if (result === undefined) {
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
    resource = await root.inspectExistingResource(resourcePath, "$resourcePath");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      if (error.reason === "resource-not-found") return null;
      if (error.reason === "ancestor-symlink") {
        fail("parent-symlink", "$resourcePath", error);
      }
      if (error.reason === "ancestor-type") {
        fail("parent-not-directory", "$resourcePath", error);
      }
      if (error.reason === "resource-path") fail("input", "$resourcePath", error);
      fail("root-scope", "$resourcePath", error);
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

function prefixPaths(resourcePath: PortableResourcePath): readonly PortableResourcePath[] {
  let segments: readonly string[];
  try {
    segments = splitPortableResourcePath(resourcePath, "$resourcePath");
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      fail("input", "$resourcePath", error);
    }
    throw error;
  }
  const prefixes: PortableResourcePath[] = [];
  let current = "";
  for (let index = 1; index <= segments.length; index += 1) {
    const segment = segments[index - 1];
    if (segment === undefined) fail("input", "$resourcePath");
    current = current.length === 0 ? segment : `${current}/${segment}`;
    try {
      prefixes.push(parsePortableResourcePath(current, "$resourcePath"));
    } catch (error: unknown) {
      if (error instanceof PortableResourcePathError) {
        fail("input", "$resourcePath", error);
      }
      throw error;
    }
  }
  return Object.freeze(prefixes);
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
  throwIfAborted(parsed.signal);
  return performAtomicCreate(root, resourcePath, parsed, "sync");
}

/**
 * 与 `createDirectoryAtomically` 相同地创建并复验一个目录，但不发出任何同步。
 *
 * 只供目录树候选使用：调用方负责在这个目录的成员全部写完之后同步它一次，并保证
 * 目录树在发布前不被当作权威事实；目录树之外的调用方应使用 `createDirectoryAtomically`。
 */
export async function createTreeCandidateDirectoryAtomically(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  options: DurableDirectoryOptions,
): Promise<Readonly<DurableDirectoryCreateResult>> {
  assertRoot(root);
  const parsed = parseOptions(options);
  throwIfAborted(parsed.signal);
  return performAtomicCreate(root, resourcePath, parsed, "deferred");
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
  throwIfAborted(parsed.signal);

  const observations: DirectoryMaterializationEntry[] = [];
  for (const prefix of prefixes) {
    throwIfAborted(parsed.signal);
    const existing = await inspectExistingDirectoryOrNull(root, prefix);
    if (existing !== null) {
      observations.push(
        Object.freeze({
          resourcePath: prefix,
          disposition: "existing" as const,
          node: existing,
        }),
      );
      continue;
    }

    try {
      const created = await performAtomicCreate(root, prefix, parsed, "sync");
      observations.push(
        Object.freeze({
          resourcePath: prefix,
          disposition: created.disposition,
          node: created.node,
        }),
      );
    } catch (error: unknown) {
      if (
        error instanceof DurableDirectoryMaterializationError &&
        error.reason === "target-exists"
      ) {
        const concurrent = await inspectExistingDirectoryOrNull(root, prefix);
        if (concurrent === null) fail("path-changed", "$resourcePath", error);
        observations.push(
          Object.freeze({
            resourcePath: prefix,
            disposition: "existing" as const,
            node: concurrent,
          }),
        );
        continue;
      }
      throw error;
    }
  }

  const finalEntries: DirectoryMaterializationEntry[] = [];
  for (const observation of observations) {
    const current = await inspectExistingDirectoryOrNull(root, observation.resourcePath);
    if (current === null || !sameFileNodeIdentity(observation.node, current)) {
      fail("path-changed", "$resourcePath");
    }
    finalEntries.push(
      Object.freeze({
        resourcePath: observation.resourcePath,
        disposition: observation.disposition,
        node: current,
      }),
    );
  }
  const final = finalEntries.at(-1);
  if (final === undefined) fail("path-changed", "$resourcePath");
  return Object.freeze({
    resourcePath,
    node: final.node,
    segments: Object.freeze(finalEntries),
  });
}
