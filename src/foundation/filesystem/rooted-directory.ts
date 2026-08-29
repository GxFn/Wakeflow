import {
  constants as fileSystemConstants,
  type BigIntStats,
} from "node:fs";
import {
  lstat,
  open as openFileHandle,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import nodePath from "node:path";

import {
  createFileNodeSnapshot,
  FileNodeSnapshotError,
  sameFileNodeIdentity,
  sameFileNodeSnapshot,
  type FileNodeSnapshot,
} from "./file-node-snapshot.js";
import {
  PortableResourcePathError,
  splitPortableResourcePath,
  type PortableResourcePath,
} from "./portable-resource-path.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";

/**
 * Wakeflow Foundation / Filesystem：一次操作范围内的物理目录根。
 *
 * `RootedDirectory` 持有已经打开的目录 `FileHandle`、规范绝对路径和初始节点快照。
 * 它把 `PortableResourcePath` 逐段映射到根目录下，拒绝路径中间的符号链接、错误祖先
 * 类型、真实路径别名和根目录替换，并返回最终节点的一次稳定物理观察。
 *
 * Node.js 未暴露 `openat` 或 `openat2`，因此子节点检查仍是基于路径名的尽力验证。
 * 本能力用于防范受信任单用户工作区中的意外路径、并发 Wakeflow 写入和符号链接，
 * 不能充当抵抗同权限恶意进程持续交换目录项的操作系统沙箱。
 */

/** 根目录内一个已有资源的运行时物理观察；不得写入可移植记录。 */
export interface RootedResourceSnapshot {
  readonly resourcePath: PortableResourcePath;
  readonly physicalPath: string;
  readonly node: Readonly<FileNodeSnapshot>;
}

/** 根目录打开、复验或资源检查失败的稳定分类。 */
export type RootedDirectoryErrorReason =
  | "root-input"
  | "unsupported-platform"
  | "root-not-found"
  | "root-symlink"
  | "root-type"
  | "root-alias"
  | "root-open-failure"
  | "root-changed"
  | "resource-path"
  | "resource-not-found"
  | "ancestor-symlink"
  | "ancestor-type"
  | "resource-alias"
  | "resource-changed"
  | "inspection-failure"
  | "closed"
  | "close-failure";

const ERROR_MESSAGES = {
  "root-input": "Rooted directory requires one normalized non-root absolute path.",
  "unsupported-platform": "Rooted directory requires Node no-follow directory handles.",
  "root-not-found": "Rooted directory does not exist.",
  "root-symlink": "Rooted directory cannot be a symbolic link.",
  "root-type": "Rooted directory root must be a directory.",
  "root-alias": "Opened rooted directory path now resolves through a physical alias.",
  "root-open-failure": "Rooted directory could not be opened safely.",
  "root-changed": "Rooted directory path no longer names the opened root node.",
  "resource-path": "Rooted resource path is not a valid portable resource path.",
  "resource-not-found": "Rooted resource does not exist.",
  "ancestor-symlink": "Rooted resource contains a symbolic-link ancestor.",
  "ancestor-type": "Rooted resource ancestor is not a directory.",
  "resource-alias": "Rooted resource resolves through a non-canonical path alias.",
  "resource-changed": "Rooted resource changed while it was being inspected.",
  "inspection-failure": "Rooted resource could not be inspected safely.",
  "closed": "Rooted directory is already closed.",
  "close-failure": "Rooted directory handle could not be closed safely.",
} as const satisfies Readonly<Record<RootedDirectoryErrorReason, string>>;

/**
 * 根作用域文件系统失败的稳定错误。
 *
 * 错误只暴露能力代码、分类和调用方结构路径，不回显物理根目录、资源路径、系统调用、
 * Node.js 错误消息或底层原因。
 */
export class RootedDirectoryError extends Error {
  override readonly name = "RootedDirectoryError";
  readonly code = "wakeflow-rooted-directory" as const;
  readonly reason: RootedDirectoryErrorReason;
  readonly path: string;

  constructor(reason: RootedDirectoryErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface InspectedResourceEntry {
  readonly physicalPath: string;
  readonly node: Readonly<FileNodeSnapshot>;
  readonly isFinal: boolean;
}

const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

function normalizeErrorPath(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function fail(reason: RootedDirectoryErrorReason, path: string): never {
  throw new RootedDirectoryError(reason, path);
}

function normalizeRootPath(value: unknown, errorPath: string): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value !== value.trim()
    || !value.isWellFormed()
    || CONTROL_PATTERN.test(value)
    || !nodePath.isAbsolute(value)
    || nodePath.resolve(value) !== value
    || nodePath.parse(value).root === value
  ) {
    fail("root-input", errorPath);
  }
  return value;
}

function requiredOpenFlags(errorPath: string): number {
  const directory: unknown = fileSystemConstants.O_DIRECTORY;
  const noFollow: unknown = fileSystemConstants.O_NOFOLLOW;
  if (typeof directory !== "number" || typeof noFollow !== "number") {
    fail("unsupported-platform", errorPath);
  }
  return fileSystemConstants.O_RDONLY | directory | noFollow;
}

function snapshotNode(
  value: BigIntStats,
  errorPath: string,
): Readonly<FileNodeSnapshot> {
  try {
    return createFileNodeSnapshot(value, errorPath);
  } catch (error: unknown) {
    if (error instanceof FileNodeSnapshotError) {
      fail("inspection-failure", errorPath);
    }
    throw error;
  }
}

async function inspectPathNode(
  physicalPath: string,
  errorPath: string,
  missingReason:
    | "root-not-found"
    | "root-changed"
    | "resource-not-found"
    | "resource-changed",
): Promise<Readonly<FileNodeSnapshot>> {
  let stats: BigIntStats;
  try {
    stats = await lstat(physicalPath, { bigint: true });
  } catch (error: unknown) {
    if (readNodeSystemErrorCode(error) === "ENOENT") {
      fail(missingReason, errorPath);
    }
    fail("inspection-failure", errorPath);
  }
  return snapshotNode(stats, errorPath);
}

async function inspectCanonicalPath(
  physicalPath: string,
  errorPath: string,
  aliasReason: "root-alias" | "resource-alias",
  changedReason: "root-changed" | "resource-changed",
): Promise<void> {
  let canonical: string;
  try {
    canonical = await realpath(physicalPath);
  } catch (error: unknown) {
    if (readNodeSystemErrorCode(error) === "ENOENT") {
      fail(changedReason, errorPath);
    }
    fail("inspection-failure", errorPath);
  }
  if (canonical !== physicalPath) fail(aliasReason, errorPath);
}

async function resolveCanonicalRootPath(
  physicalPath: string,
  errorPath: string,
): Promise<string> {
  try {
    return await realpath(physicalPath);
  } catch (error: unknown) {
    if (readNodeSystemErrorCode(error) === "ENOENT") {
      fail("root-changed", errorPath);
    }
    fail("inspection-failure", errorPath);
  }
}

function resourcePhysicalPath(
  rootPath: string,
  segments: readonly string[],
  errorPath: string,
): string {
  const candidate = nodePath.join(rootPath, ...segments);
  const relative = nodePath.relative(rootPath, candidate);
  if (
    relative.length === 0
    || nodePath.isAbsolute(relative)
    || relative === ".."
    || relative.startsWith(`..${nodePath.sep}`)
  ) {
    fail("resource-path", errorPath);
  }
  return candidate;
}

/**
 * 已打开且可显式关闭的根目录能力。
 *
 * static open() 是唯一构造入口；实例保存 FileHandle 以检测根 pathname 被 rename
 * 或替换。`absolutePath` 与物理资源结果只供进程内 I/O 组合，不属于持久化表示。
 */
export class RootedDirectory {
  readonly #absolutePath: string;
  readonly #initialSnapshot: Readonly<FileNodeSnapshot>;
  readonly #handle: FileHandle;
  #closed = false;

  private constructor(
    absolutePath: string,
    initialSnapshot: Readonly<FileNodeSnapshot>,
    handle: FileHandle,
  ) {
    this.#absolutePath = absolutePath;
    this.#initialSnapshot = initialSnapshot;
    this.#handle = handle;
  }

  /**
   * 打开由规范绝对路径拼写指向的真实目录根。
   *
   * 根节点本身不能是符号链接；受信任路径拼写中的祖先别名会先固定为规范真实路径。
   * 成功前同时核对原始路径拼写、规范路径名、`FileHandle` 与再次观察到的节点身份。
   */
  static async open(
    value: unknown,
    errorPath?: string,
  ): Promise<RootedDirectory> {
    const path = normalizeErrorPath(errorPath, "$root");
    const absolutePath = normalizeRootPath(value, path);
    const before = await inspectPathNode(absolutePath, path, "root-not-found");
    if (before.kind === "symbolic-link") fail("root-symlink", path);
    if (before.kind !== "directory") fail("root-type", path);
    const canonicalRootPath = await resolveCanonicalRootPath(
      absolutePath,
      path,
    );
    const canonicalBefore = await inspectPathNode(
      canonicalRootPath,
      path,
      "root-changed",
    );
    if (
      canonicalBefore.kind !== "directory"
      || !sameFileNodeIdentity(before, canonicalBefore)
    ) {
      fail("root-changed", path);
    }

    let handle: FileHandle;
    try {
      handle = await openFileHandle(
        canonicalRootPath,
        requiredOpenFlags(path),
      );
    } catch (error: unknown) {
      const code = readNodeSystemErrorCode(error);
      if (code === "ELOOP") fail("root-symlink", path);
      if (code === "ENOENT") fail("root-changed", path);
      fail("root-open-failure", path);
    }

    try {
      const opened = snapshotNode(
        await handle.stat({ bigint: true }),
        path,
      );
      const after = await inspectPathNode(
        canonicalRootPath,
        path,
        "root-changed",
      );
      await inspectCanonicalPath(
        canonicalRootPath,
        path,
        "root-alias",
        "root-changed",
      );
      if (
        opened.kind !== "directory"
        || after.kind !== "directory"
        || !sameFileNodeIdentity(canonicalBefore, opened)
        || !sameFileNodeIdentity(opened, after)
      ) {
        fail("root-changed", path);
      }
      return new RootedDirectory(canonicalRootPath, after, handle);
    } catch (error: unknown) {
      try {
        await handle.close();
      } catch {
        // 保留首个准入错误；未签发的句柄不再生成第二个公共错误。
      }
      throw error;
    }
  }

  /** 进程内规范绝对根目录；调用方不得把它写入可移植数据。 */
  get absolutePath(): string {
    return this.#absolutePath;
  }

  #assertOpen(errorPath: string): void {
    if (this.#closed) fail("closed", errorPath);
  }

  /**
   * 证明当前路径名、已打开目录句柄和初始根目录仍指向同一设备号和 inode。
   *
   * 返回最新节点快照；目录内容变化引起的 `mtime` 或链接数漂移不会被误判为根目录替换。
   */
  async assertCurrent(
    errorPath?: string,
  ): Promise<Readonly<FileNodeSnapshot>> {
    const path = normalizeErrorPath(errorPath, "$root");
    this.#assertOpen(path);

    let opened: Readonly<FileNodeSnapshot>;
    try {
      opened = snapshotNode(await this.#handle.stat({ bigint: true }), path);
    } catch (error: unknown) {
      if (error instanceof RootedDirectoryError) throw error;
      fail("root-changed", path);
    }
    const current = await inspectPathNode(
      this.#absolutePath,
      path,
      "root-changed",
    );
    if (current.kind === "symbolic-link") fail("root-changed", path);
    if (current.kind !== "directory" || opened.kind !== "directory") {
      fail("root-changed", path);
    }
    await inspectCanonicalPath(
      this.#absolutePath,
      path,
      "root-alias",
      "root-changed",
    );
    if (
      !sameFileNodeIdentity(this.#initialSnapshot, opened)
      || !sameFileNodeIdentity(opened, current)
    ) {
      fail("root-changed", path);
    }
    return current;
  }

  /**
   * 逐段检查一个已存在资源，不跟随最终符号链接。
   *
   * 所有中间段必须保持真实目录；最终段可为任意节点类型，供后续稳定读取方、
   * 目录树扫描器或迁移职责所有者再施加自己的节点策略。最终节点是目录时只复验
   * 节点类型、设备号和 inode：合法的同级变更会改变目录修改时间和状态变更时间，
   * 但不表示目录已经被替换。
   */
  async inspectExistingResource(
    resourcePath: PortableResourcePath,
    errorPath?: string,
  ): Promise<Readonly<RootedResourceSnapshot>> {
    const path = normalizeErrorPath(errorPath, "$resourcePath");
    this.#assertOpen(path);

    let segments: readonly string[];
    try {
      segments = splitPortableResourcePath(resourcePath, path);
    } catch (error: unknown) {
      if (error instanceof PortableResourcePathError) fail("resource-path", path);
      throw error;
    }
    await this.assertCurrent("$root");
    const finalPhysicalPath = resourcePhysicalPath(
      this.#absolutePath,
      segments,
      path,
    );

    const entries: InspectedResourceEntry[] = [];
    let current = this.#absolutePath;
    for (const [index, segment] of segments.entries()) {
      current = nodePath.join(current, segment);
      const isFinal = index === segments.length - 1;
      const node = await inspectPathNode(
        current,
        path,
        "resource-not-found",
      );
      if (!isFinal && node.kind === "symbolic-link") {
        fail("ancestor-symlink", path);
      }
      if (!isFinal && node.kind !== "directory") {
        fail("ancestor-type", path);
      }
      if (node.kind !== "symbolic-link") {
        await inspectCanonicalPath(
          current,
          path,
          "resource-alias",
          "resource-changed",
        );
      }
      entries.push(Object.freeze({
        physicalPath: current,
        node,
        isFinal,
      }));
    }

    await this.assertCurrent("$root");
    let finalNode: Readonly<FileNodeSnapshot> | undefined;
    for (const entry of entries) {
      const currentNode = await inspectPathNode(
        entry.physicalPath,
        path,
        "resource-changed",
      );
      if (
        currentNode.kind !== entry.node.kind
        || !sameFileNodeIdentity(entry.node, currentNode)
      ) {
        fail("resource-changed", path);
      }
      if (!entry.isFinal && currentNode.kind !== "directory") {
        fail("resource-changed", path);
      }
      if (currentNode.kind !== "symbolic-link") {
        await inspectCanonicalPath(
          entry.physicalPath,
          path,
          "resource-alias",
          "resource-changed",
        );
      }
      if (entry.isFinal) {
        const finalUnchanged = currentNode.kind === "directory"
          ? sameFileNodeIdentity(entry.node, currentNode)
          : sameFileNodeSnapshot(entry.node, currentNode);
        if (!finalUnchanged) {
          fail("resource-changed", path);
        }
        finalNode = currentNode;
      }
    }
    if (finalNode === undefined) fail("inspection-failure", path);

    return Object.freeze({
      resourcePath,
      physicalPath: finalPhysicalPath,
      node: finalNode,
    });
  }

  /** 幂等关闭根目录句柄；关闭后所有文件系统操作都会稳定拒绝。 */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    try {
      await this.#handle.close();
    } catch {
      fail("close-failure", "$root");
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}
