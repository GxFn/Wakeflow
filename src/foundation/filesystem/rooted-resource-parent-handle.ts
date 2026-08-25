import { constants as fileSystemConstants } from "node:fs";
import {
  lstat,
  open as openFileHandle,
  type FileHandle,
} from "node:fs/promises";
import nodePath from "node:path";
import { types } from "node:util";

import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import {
  createFileNodeSnapshot,
  FileNodeSnapshotError,
  sameFileNodeIdentity,
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

/**
 * Wakeflow Foundation / Filesystem：一个根内 resource 的已打开 parent handle。
 *
 * 本 class 把重复的 resource address 解析、root-or-resource parent 定位、
 * O_DIRECTORY/O_NOFOLLOW 打开、parent identity 复验、target no-follow lstat、目录
 * fsync 与 close 生命周期收敛为一个进程内 I/O seam。
 *
 * parent 内容变化可以改变 mtime/ctime/link count，因此 assertCurrent 只比较
 * directory kind 与 dev/inode identity；它不会把合法 sibling mutation 误判为 parent
 * replacement。inspectTarget 只返回最终节点事实或 null，不拥有允许类型、absent/existing
 * expectation、mode/owner/hardlink policy 或任何 mutation。
 *
 * parentAbsolutePath/resourceAbsolutePath 只供 foundation I/O 组合，禁止写入 portable
 * record、错误或日志。Node 未暴露 openat，target pathname 竞态边界与 RootedDirectory
 * 保持一致。
 */

/** parent handle 打开、复验、target 观察、同步或关闭失败分类。 */
export type RootedResourceParentHandleErrorReason =
  | "input"
  | "root-scope"
  | "parent-not-found"
  | "parent-symlink"
  | "parent-not-directory"
  | "parent-open-failure"
  | "parent-changed"
  | "target-inspection-failure"
  | "sync-failure"
  | "closed"
  | "close-failure";

const ERROR_MESSAGES = {
  "input": "Rooted resource parent handle input is invalid.",
  "root-scope": "Rooted resource parent could not establish its root scope.",
  "parent-not-found": "Rooted resource parent directory does not exist.",
  "parent-symlink": "Rooted resource parent chain cannot contain a symbolic link.",
  "parent-not-directory": "Rooted resource parent must be a directory.",
  "parent-open-failure": "Rooted resource parent could not be opened safely.",
  "parent-changed": "Rooted resource parent no longer names the opened directory.",
  "target-inspection-failure": "Rooted resource target could not be inspected safely.",
  "sync-failure": "Rooted resource parent could not be synchronized safely.",
  "closed": "Rooted resource parent handle is already closed.",
  "close-failure": "Rooted resource parent handle could not be closed safely.",
} as const satisfies Readonly<Record<
  RootedResourceParentHandleErrorReason,
  string
>>;

/**
 * RootedResourceParentHandle 的稳定错误。
 *
 * 错误不回显 root、resource、parent、target absolute path、节点元数据、系统调用或 cause。
 */
export class RootedResourceParentHandleError extends Error {
  override readonly name = "RootedResourceParentHandleError";
  readonly code = "wakeflow-rooted-resource-parent-handle" as const;
  readonly reason: RootedResourceParentHandleErrorReason;
  readonly path: string;

  constructor(reason: RootedResourceParentHandleErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ResourceAddress {
  readonly resourcePath: PortableResourcePath;
  readonly parentResourcePath: PortableResourcePath | null;
  readonly resourceName: string;
}

interface ParentObservation {
  readonly absolutePath: string;
  readonly node: Readonly<FileNodeSnapshot>;
}

function normalizeErrorPath(value: unknown): string {
  return typeof value === "string" && value.length > 0
    ? value
    : "$resourcePath";
}

function fail(
  reason: RootedResourceParentHandleErrorReason,
  path: string,
): never {
  throw new RootedResourceParentHandleError(reason, path);
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

function parseAddress(
  resourcePath: PortableResourcePath,
  errorPath: string,
): Readonly<ResourceAddress> {
  let segments: readonly string[];
  try {
    segments = splitPortableResourcePath(resourcePath, errorPath);
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) fail("input", errorPath);
    throw error;
  }
  const resourceName = segments.at(-1);
  if (resourceName === undefined) fail("input", errorPath);
  let parentResourcePath: PortableResourcePath | null = null;
  if (segments.length > 1) {
    try {
      parentResourcePath = parsePortableResourcePath(
        segments.slice(0, -1).join("/"),
        errorPath,
      );
    } catch (error: unknown) {
      if (error instanceof PortableResourcePathError) fail("input", errorPath);
      throw error;
    }
  }
  return Object.freeze({ resourcePath, parentResourcePath, resourceName });
}

function requiredOpenFlags(): number {
  const directory: unknown = fileSystemConstants.O_DIRECTORY;
  const noFollow: unknown = fileSystemConstants.O_NOFOLLOW;
  if (typeof directory !== "number" || typeof noFollow !== "number") {
    fail("root-scope", "$root");
  }
  return fileSystemConstants.O_RDONLY | directory | noFollow;
}

function snapshotNode(
  value: unknown,
  reason: RootedResourceParentHandleErrorReason,
  errorPath: string,
): Readonly<FileNodeSnapshot> {
  try {
    return createFileNodeSnapshot(value, errorPath);
  } catch (error: unknown) {
    if (error instanceof FileNodeSnapshotError) fail(reason, errorPath);
    throw error;
  }
}

async function inspectInitialParent(
  root: RootedDirectory,
  address: Readonly<ResourceAddress>,
  errorPath: string,
): Promise<Readonly<ParentObservation>> {
  if (address.parentResourcePath === null) {
    try {
      return Object.freeze({
        absolutePath: root.absolutePath,
        node: await root.assertCurrent("$root"),
      });
    } catch (error: unknown) {
      if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
      throw error;
    }
  }

  let parent: Readonly<RootedResourceSnapshot>;
  try {
    parent = await root.inspectExistingResource(
      address.parentResourcePath,
      errorPath,
    );
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      if (error.reason === "resource-not-found") {
        fail("parent-not-found", errorPath);
      }
      if (error.reason === "ancestor-symlink") {
        fail("parent-symlink", errorPath);
      }
      if (error.reason === "ancestor-type") {
        fail("parent-not-directory", errorPath);
      }
      if (error.reason === "resource-path") fail("input", errorPath);
      fail("root-scope", errorPath);
    }
    throw error;
  }
  if (parent.node.kind === "symbolic-link") {
    fail("parent-symlink", errorPath);
  }
  if (parent.node.kind !== "directory") {
    fail("parent-not-directory", errorPath);
  }
  return Object.freeze({ absolutePath: parent.physicalPath, node: parent.node });
}

/**
 * 已打开 parent directory 的 resource-address capability。
 *
 * static open 是唯一构造入口。实例拥有 FileHandle，调用方必须 close 或使用
 * `await using`；关闭后所有 I/O 方法稳定失败。
 */
export class RootedResourceParentHandle {
  readonly #root: RootedDirectory;
  readonly #resourcePath: PortableResourcePath;
  readonly #parentResourcePath: PortableResourcePath | null;
  readonly #resourceName: string;
  readonly #parentAbsolutePath: string;
  readonly #resourceAbsolutePath: string;
  readonly #initialParentSnapshot: Readonly<FileNodeSnapshot>;
  readonly #handle: FileHandle;
  readonly #errorPath: string;
  #closed = false;

  private constructor(
    root: RootedDirectory,
    address: Readonly<ResourceAddress>,
    parent: Readonly<ParentObservation>,
    opened: Readonly<FileNodeSnapshot>,
    handle: FileHandle,
    errorPath: string,
  ) {
    this.#root = root;
    this.#resourcePath = address.resourcePath;
    this.#parentResourcePath = address.parentResourcePath;
    this.#resourceName = address.resourceName;
    this.#parentAbsolutePath = parent.absolutePath;
    this.#resourceAbsolutePath = nodePath.join(
      parent.absolutePath,
      address.resourceName,
    );
    this.#initialParentSnapshot = opened;
    this.#handle = handle;
    this.#errorPath = errorPath;
  }

  /** 打开 resource 的 root-level 或 nested real parent directory。 */
  static async open(
    root: RootedDirectory,
    resourcePath: PortableResourcePath,
    errorPath?: string,
  ): Promise<RootedResourceParentHandle> {
    assertRoot(root);
    const path = normalizeErrorPath(errorPath);
    const address = parseAddress(resourcePath, path);
    const parent = await inspectInitialParent(root, address, path);
    const flags = requiredOpenFlags();
    let handle: FileHandle;
    try {
      handle = await openFileHandle(parent.absolutePath, flags);
    } catch (error: unknown) {
      const code = readNodeSystemErrorCode(error);
      if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
        fail("parent-changed", path);
      }
      fail("parent-open-failure", path);
    }

    try {
      const opened = snapshotNode(
        await handle.stat({ bigint: true }),
        "parent-changed",
        path,
      );
      if (
        opened.kind !== "directory"
        || !sameFileNodeIdentity(parent.node, opened)
      ) {
        fail("parent-changed", path);
      }
      const result = new RootedResourceParentHandle(
        root,
        address,
        parent,
        opened,
        handle,
        path,
      );
      await result.assertCurrent();
      return result;
    } catch (error: unknown) {
      try {
        await handle.close();
      } catch {
        // 未签发 handle 的首个准入错误保持权威。
      }
      throw error;
    }
  }

  get resourcePath(): PortableResourcePath {
    return this.#resourcePath;
  }

  /** null 明确表示 RootedDirectory 自身是 parent。 */
  get parentResourcePath(): PortableResourcePath | null {
    return this.#parentResourcePath;
  }

  get resourceName(): string {
    return this.#resourceName;
  }

  /** 仅供进程内 foundation I/O；禁止持久化或诊断输出。 */
  get parentAbsolutePath(): string {
    return this.#parentAbsolutePath;
  }

  /** 仅供进程内 foundation I/O；target 可以尚不存在。 */
  get resourceAbsolutePath(): string {
    return this.#resourceAbsolutePath;
  }

  /** 打开时的 parent identity 基准；不是当前 metadata 缓存。 */
  get initialParentSnapshot(): Readonly<FileNodeSnapshot> {
    return this.#initialParentSnapshot;
  }

  get isClosed(): boolean {
    return this.#closed;
  }

  #assertOpen(): void {
    if (this.#closed) fail("closed", this.#errorPath);
  }

  async #inspectParentPath(): Promise<Readonly<FileNodeSnapshot>> {
    try {
      if (this.#parentResourcePath === null) {
        return await this.#root.assertCurrent("$root");
      }
      return (await this.#root.inspectExistingResource(
        this.#parentResourcePath,
        this.#errorPath,
      )).node;
    } catch (error: unknown) {
      if (error instanceof RootedDirectoryError) {
        fail("parent-changed", this.#errorPath);
      }
      throw error;
    }
  }

  /** 证明 parent pathname、打开 handle 与初始 parent 仍为同一 directory inode。 */
  async assertCurrent(): Promise<Readonly<FileNodeSnapshot>> {
    this.#assertOpen();
    const pathNode = await this.#inspectParentPath();
    let opened: Readonly<FileNodeSnapshot>;
    try {
      opened = snapshotNode(
        await this.#handle.stat({ bigint: true }),
        "parent-changed",
        this.#errorPath,
      );
    } catch (error: unknown) {
      if (error instanceof RootedResourceParentHandleError) throw error;
      fail("parent-changed", this.#errorPath);
    }
    if (
      pathNode.kind !== "directory"
      || opened.kind !== "directory"
      || !sameFileNodeIdentity(this.#initialParentSnapshot, opened)
      || !sameFileNodeIdentity(opened, pathNode)
    ) {
      fail("parent-changed", this.#errorPath);
    }
    return pathNode;
  }

  /**
   * no-follow 观察当前 target；absent 返回 null。
   *
   * parent 在 lstat 前后都会复验；target 自身的允许类型继续由 consumer 判断。
   */
  async inspectTarget(): Promise<Readonly<FileNodeSnapshot> | null> {
    this.#assertOpen();
    await this.assertCurrent();
    let target: Readonly<FileNodeSnapshot> | null;
    try {
      target = snapshotNode(
        await lstat(this.#resourceAbsolutePath, { bigint: true }),
        "target-inspection-failure",
        this.#errorPath,
      );
    } catch (error: unknown) {
      if (readNodeSystemErrorCode(error) === "ENOENT") target = null;
      else if (error instanceof RootedResourceParentHandleError) throw error;
      else fail("target-inspection-failure", this.#errorPath);
    }
    await this.assertCurrent();
    return target;
  }

  /** 同步 parent directory entry metadata，并在 sync 前后复验 parent identity。 */
  async sync(): Promise<Readonly<FileNodeSnapshot>> {
    this.#assertOpen();
    await this.assertCurrent();
    try {
      await this.#handle.sync();
    } catch {
      fail("sync-failure", this.#errorPath);
    }
    return this.assertCurrent();
  }

  /** 幂等关闭 parent handle；关闭后 I/O 方法稳定拒绝。 */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    try {
      await this.#handle.close();
    } catch {
      fail("close-failure", this.#errorPath);
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}
