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
 * RootedDirectory 持有已经打开的目录 FileHandle、canonical 绝对路径和初始节点快照。
 * 它把 PortableResourcePath 逐段映射到该根下，拒绝中间 symlink、错误祖先类型、
 * realpath alias 和根替换，并返回最终节点的一次稳定物理观察。
 *
 * Node.js 未暴露 openat/openat2，因此子节点检查仍是 pathname-based best effort；
 * 本能力用于受信任单用户工作区中的意外路径、并发 Wakeflow writer 和 symlink
 * 防护，不是抵抗同权限恶意进程持续交换目录项的 OS sandbox。
 */

/** 根内一个已存在资源的运行时物理观察；不得进入 portable record。 */
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
 * 错误只暴露能力代码、分类和调用方结构路径，不回显物理根、资源路径、syscall、
 * Node message 或 cause。
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
  missingReason: "root-not-found" | "resource-not-found",
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
): Promise<void> {
  let canonical: string;
  try {
    canonical = await realpath(physicalPath);
  } catch {
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
  } catch {
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
 * 已打开、可显式关闭的根目录能力。
 *
 * static open() 是唯一构造入口；实例保存 FileHandle 以检测根 pathname 被 rename
 * 或替换。absolutePath 与物理 resource result 只供进程内 I/O 组合，不是 wire。
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
   * 打开一个规范绝对 spelling 指向的真实目录根。
   *
   * 根节点本身不能是 symlink；受信任 spelling 中的祖先 alias 会先固定为
   * canonical realpath。成功前同时核对原 spelling、canonical pathname、
   * FileHandle 与再次观察到的节点身份。
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
      "root-not-found",
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
      if (code === "ENOENT") fail("root-not-found", path);
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
        "root-not-found",
      );
      await inspectCanonicalPath(canonicalRootPath, path, "root-alias");
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
        // 首个准入失败保持为权威；未签发的 handle 不产生另一个公共错误。
      }
      throw error;
    }
  }

  /** 进程内 canonical 绝对根；调用方不得写入 portable 数据。 */
  get absolutePath(): string {
    return this.#absolutePath;
  }

  /** 打开根时的冻结物理快照；它不是当前状态缓存。 */
  get initialSnapshot(): Readonly<FileNodeSnapshot> {
    return this.#initialSnapshot;
  }

  get isClosed(): boolean {
    return this.#closed;
  }

  #assertOpen(errorPath: string): void {
    if (this.#closed) fail("closed", errorPath);
  }

  /**
   * 证明当前 pathname、打开的目录 handle 与初始根仍指向同一 dev/ino 节点。
   *
   * 返回最新节点快照；目录内容变化引起的 mtime/link count 漂移不会被误判为根替换。
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
      "root-not-found",
    );
    if (current.kind === "symbolic-link") fail("root-changed", path);
    if (current.kind !== "directory" || opened.kind !== "directory") {
      fail("root-changed", path);
    }
    await inspectCanonicalPath(this.#absolutePath, path, "root-alias");
    if (
      !sameFileNodeIdentity(this.#initialSnapshot, opened)
      || !sameFileNodeIdentity(opened, current)
    ) {
      fail("root-changed", path);
    }
    return current;
  }

  /**
   * 逐段检查一个已存在 resource，不跟随最终 symlink。
   *
   * 所有中间段必须保持真实目录；最终段可为任意节点类型，供后续 stable reader、
   * tree scanner 或 migration owner 再施加自己的节点策略。
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
        await inspectCanonicalPath(current, path, "resource-alias");
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
        "resource-not-found",
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
        );
      }
      if (entry.isFinal) {
        if (!sameFileNodeSnapshot(entry.node, currentNode)) {
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

  /** 幂等关闭根 handle；关闭后所有 filesystem 操作稳定拒绝。 */
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
