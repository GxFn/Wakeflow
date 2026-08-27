import { constants as fileSystemConstants } from "node:fs";
import {
  open as openFileHandle,
  type FileHandle,
} from "node:fs/promises";
import { types } from "node:util";

import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import {
  createFileNodeSnapshot,
  FileNodeSnapshotError,
  sameFileNodeIdentity,
  sameFileNodeSnapshot,
  type FileNodeSnapshot,
} from "./file-node-snapshot.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
  type RootedResourceSnapshot,
} from "./rooted-directory.js";

/**
 * Wakeflow Foundation / Filesystem：根目录内指定已有资源的已打开 inode 能力。
 *
 * 静态工厂先通过 `RootedDirectory` 观察真实资源，再使用 `O_NOFOLLOW` 打开
 * `FileHandle`，并证明预期节点、路径名和句柄对应同一份完整快照。成功实例适合作为
 * 链接、重命名、删除等变更操作的源资源准入能力。
 *
 * `assertPathCurrent` 只用于提交前，要求路径名、已打开句柄和初始快照仍完全一致。
 * `inspectOpenedNode` 在提交后仍可观察已经重命名或删除的原 inode；它只保证节点类型、
 * 设备号和 inode 身份未变，不会把合法的链接数或元数据变化误判为源资源被替换。
 *
 * 本类不暴露原始 `FileHandle`，不读取或写入字节，不修改权限，也不执行链接、重命名、
 * 删除或领域恢复。Node.js 未暴露 `openat`，因此路径名竞态边界与 `RootedDirectory`
 * 保持一致。
 */

/** 指定资源句柄可以准入的真实节点类型。 */
export type RootedExactResourceKind = "file" | "directory";

/** 指定资源句柄打开、复验、同步或关闭失败的分类。 */
export type RootedExactResourceHandleErrorReason =
  | "input"
  | "root-scope"
  | "resource-not-found"
  | "resource-symlink"
  | "resource-kind"
  | "resource-open-failure"
  | "resource-changed"
  | "sync-failure"
  | "closed"
  | "close-failure";

const ERROR_MESSAGES = {
  "input": "Rooted exact resource handle input is invalid.",
  "root-scope": "Rooted exact resource could not establish its root scope.",
  "resource-not-found": "Rooted exact resource does not exist.",
  "resource-symlink": "Rooted exact resource cannot be a symbolic link.",
  "resource-kind": "Rooted exact resource has a disallowed node kind.",
  "resource-open-failure": "Rooted exact resource could not be opened safely.",
  "resource-changed": "Rooted exact resource no longer matches its admission.",
  "sync-failure": "Rooted exact resource could not be synchronized safely.",
  "closed": "Rooted exact resource handle is already closed.",
  "close-failure": "Rooted exact resource handle could not be closed safely.",
} as const satisfies Readonly<Record<
  RootedExactResourceHandleErrorReason,
  string
>>;

/**
 * RootedExactResourceHandle 的稳定错误。
 *
 * 错误不回显根目录、资源、绝对路径、预期节点、当前节点、系统调用或原因链。
 */
export class RootedExactResourceHandleError extends Error {
  override readonly name = "RootedExactResourceHandleError";
  readonly code = "wakeflow-rooted-exact-resource-handle" as const;
  readonly reason: RootedExactResourceHandleErrorReason;
  readonly path: string;

  constructor(reason: RootedExactResourceHandleErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

type ResourceAdmission = "regular-file" | "file-or-directory";

function normalizeErrorPath(value: unknown): string {
  return typeof value === "string" && value.length > 0
    ? value
    : "$resourcePath";
}

function fail(
  reason: RootedExactResourceHandleErrorReason,
  path: string,
): never {
  throw new RootedExactResourceHandleError(reason, path);
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
    fail("input", "$expectedNode");
  }
  try {
    if (!sameFileNodeSnapshot(
      value as FileNodeSnapshot,
      value as FileNodeSnapshot,
    )) {
      fail("input", "$expectedNode");
    }
  } catch (error: unknown) {
    if (error instanceof FileNodeSnapshotError) {
      fail("input", "$expectedNode");
    }
    throw error;
  }
  return value as Readonly<FileNodeSnapshot>;
}

function admitResourceKind(
  node: Readonly<FileNodeSnapshot>,
  admission: ResourceAdmission,
  errorPath: string,
): RootedExactResourceKind {
  if (node.kind === "symbolic-link") {
    fail("resource-symlink", errorPath);
  }
  if (admission === "regular-file") {
    if (node.kind !== "file") fail("resource-kind", errorPath);
    return "file";
  }
  if (node.kind !== "file" && node.kind !== "directory") {
    fail("resource-kind", errorPath);
  }
  return node.kind;
}

function requiredOpenFlags(
  kind: RootedExactResourceKind,
  errorPath: string,
): number {
  const noFollow: unknown = fileSystemConstants.O_NOFOLLOW;
  if (typeof noFollow !== "number") fail("root-scope", errorPath);
  const nonBlocking = typeof fileSystemConstants.O_NONBLOCK === "number"
    ? fileSystemConstants.O_NONBLOCK
    : 0;
  let directory = 0;
  if (kind === "directory") {
    const value: unknown = fileSystemConstants.O_DIRECTORY;
    if (typeof value !== "number") fail("root-scope", errorPath);
    directory = value;
  }
  return fileSystemConstants.O_RDONLY | noFollow | nonBlocking | directory;
}

function snapshotOpenedHandle(
  value: unknown,
  errorPath: string,
): Readonly<FileNodeSnapshot> {
  try {
    return createFileNodeSnapshot(value, errorPath);
  } catch (error: unknown) {
    if (error instanceof FileNodeSnapshotError) {
      fail("resource-changed", errorPath);
    }
    throw error;
  }
}

async function inspectInitialResource(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  expectedNode: Readonly<FileNodeSnapshot>,
  admission: ResourceAdmission,
  errorPath: string,
): Promise<Readonly<{
  resource: Readonly<RootedResourceSnapshot>;
  kind: RootedExactResourceKind;
}>> {
  let resource: Readonly<RootedResourceSnapshot>;
  try {
    resource = await root.inspectExistingResource(resourcePath, errorPath);
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      if (error.reason === "resource-path") fail("input", errorPath);
      if (error.reason === "resource-not-found") {
        fail("resource-not-found", errorPath);
      }
      if (error.reason === "resource-changed") {
        fail("resource-changed", errorPath);
      }
      fail("root-scope", errorPath);
    }
    throw error;
  }
  const kind = admitResourceKind(resource.node, admission, errorPath);
  if (!sameFileNodeSnapshot(resource.node, expectedNode)) {
    fail("resource-changed", errorPath);
  }
  return Object.freeze({ resource, kind });
}

/**
 * 已打开指定资源的进程内能力。
 *
 * static factory 是唯一构造入口。实例拥有 FileHandle，调用方必须显式 close；
 * `await using` 只适用于不需要自定义首错权威的简单作用域。
 */
export class RootedExactResourceHandle {
  readonly #root: RootedDirectory;
  readonly #resourcePath: PortableResourcePath;
  readonly #resourceAbsolutePath: string;
  readonly #initialNodeSnapshot: Readonly<FileNodeSnapshot>;
  readonly #kind: RootedExactResourceKind;
  readonly #handle: FileHandle;
  readonly #errorPath: string;
  #closed = false;

  private constructor(
    root: RootedDirectory,
    resource: Readonly<RootedResourceSnapshot>,
    kind: RootedExactResourceKind,
    handle: FileHandle,
    errorPath: string,
  ) {
    this.#root = root;
    this.#resourcePath = resource.resourcePath;
    this.#resourceAbsolutePath = resource.physicalPath;
    this.#initialNodeSnapshot = resource.node;
    this.#kind = kind;
    this.#handle = handle;
    this.#errorPath = errorPath;
  }

  /** 打开仍与指定预期一致的真实普通文件。 */
  static async openRegularFile(
    root: RootedDirectory,
    resourcePath: PortableResourcePath,
    expectedNode: Readonly<FileNodeSnapshot>,
    errorPath?: string,
  ): Promise<RootedExactResourceHandle> {
    return RootedExactResourceHandle.#open(
      root,
      resourcePath,
      expectedNode,
      "regular-file",
      errorPath,
    );
  }

  /** 打开仍与指定预期一致的真实普通文件或目录。 */
  static async openFileOrDirectory(
    root: RootedDirectory,
    resourcePath: PortableResourcePath,
    expectedNode: Readonly<FileNodeSnapshot>,
    errorPath?: string,
  ): Promise<RootedExactResourceHandle> {
    return RootedExactResourceHandle.#open(
      root,
      resourcePath,
      expectedNode,
      "file-or-directory",
      errorPath,
    );
  }

  static async #open(
    root: RootedDirectory,
    resourcePath: PortableResourcePath,
    expectedNode: Readonly<FileNodeSnapshot>,
    admission: ResourceAdmission,
    requestedErrorPath: unknown,
  ): Promise<RootedExactResourceHandle> {
    assertRoot(root);
    const errorPath = normalizeErrorPath(requestedErrorPath);
    const expected = parseExpectedNode(expectedNode);
    const initial = await inspectInitialResource(
      root,
      resourcePath,
      expected,
      admission,
      errorPath,
    );
    const flags = requiredOpenFlags(initial.kind, errorPath);

    let handle: FileHandle;
    try {
      handle = await openFileHandle(
        initial.resource.physicalPath,
        flags,
      );
    } catch (error: unknown) {
      const code = readNodeSystemErrorCode(error);
      if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
        fail("resource-changed", errorPath);
      }
      fail("resource-open-failure", errorPath);
    }

    try {
      const opened = snapshotOpenedHandle(
        await handle.stat({ bigint: true }),
        errorPath,
      );
      if (
        opened.kind !== initial.kind
        || !sameFileNodeSnapshot(initial.resource.node, opened)
      ) {
        fail("resource-changed", errorPath);
      }
      const result = new RootedExactResourceHandle(
        root,
        initial.resource,
        initial.kind,
        handle,
        errorPath,
      );
      await result.assertPathCurrent();
      return result;
    } catch (error: unknown) {
      try {
        await handle.close();
      } catch {
        // 未签发句柄时保留首个准入错误，不再生成第二个公共错误。
      }
      throw error;
    }
  }

  get resourcePath(): PortableResourcePath {
    return this.#resourcePath;
  }

  /** 仅供进程内 foundation I/O；禁止持久化或诊断输出。 */
  get resourceAbsolutePath(): string {
    return this.#resourceAbsolutePath;
  }

  /** 精确准入时的完整节点基准，不是当前元数据缓存。 */
  get initialNodeSnapshot(): Readonly<FileNodeSnapshot> {
    return this.#initialNodeSnapshot;
  }

  get kind(): RootedExactResourceKind {
    return this.#kind;
  }

  get isClosed(): boolean {
    return this.#closed;
  }

  #assertOpen(): void {
    if (this.#closed) fail("closed", this.#errorPath);
  }

  /**
   * 观察当前打开的 inode；pathname 已 rename/unlink 后仍可使用。
   *
   * 本方法只固定节点类型、设备号和 inode，不定义链接数、权限位、大小或时间变化策略。
   */
  async inspectOpenedNode(): Promise<Readonly<FileNodeSnapshot>> {
    this.#assertOpen();
    let opened: Readonly<FileNodeSnapshot>;
    try {
      opened = snapshotOpenedHandle(
        await this.#handle.stat({ bigint: true }),
        this.#errorPath,
      );
    } catch (error: unknown) {
      if (error instanceof RootedExactResourceHandleError) throw error;
      fail("resource-changed", this.#errorPath);
    }
    if (
      opened.kind !== this.#kind
      || !sameFileNodeIdentity(this.#initialNodeSnapshot, opened)
    ) {
      fail("resource-changed", this.#errorPath);
    }
    return opened;
  }

  /** 证明提交前路径名、句柄和指定初始快照仍完全一致。 */
  async assertPathCurrent(): Promise<Readonly<FileNodeSnapshot>> {
    this.#assertOpen();
    const opened = await this.inspectOpenedNode();
    let pathResource: Readonly<RootedResourceSnapshot>;
    try {
      pathResource = await this.#root.inspectExistingResource(
        this.#resourcePath,
        this.#errorPath,
      );
    } catch (error: unknown) {
      if (error instanceof RootedDirectoryError) {
        fail("resource-changed", this.#errorPath);
      }
      throw error;
    }
    if (
      pathResource.node.kind !== this.#kind
      || !sameFileNodeSnapshot(this.#initialNodeSnapshot, opened)
      || !sameFileNodeSnapshot(opened, pathResource.node)
    ) {
      fail("resource-changed", this.#errorPath);
    }
    return pathResource.node;
  }

  /** 同步已打开的 inode，并返回同步后的句柄快照；不要求原路径名仍然存在。 */
  async syncOpenedNode(): Promise<Readonly<FileNodeSnapshot>> {
    this.#assertOpen();
    await this.inspectOpenedNode();
    try {
      await this.#handle.sync();
    } catch {
      fail("sync-failure", this.#errorPath);
    }
    return this.inspectOpenedNode();
  }

  /** 幂等关闭指定资源句柄；关闭后所有 I/O 方法都会稳定拒绝调用。 */
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
