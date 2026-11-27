import { constants as fileSystemConstants } from "node:fs";
import { type FileHandle, open as openFileHandle } from "node:fs/promises";

import { type Fail, failWith, ModuleError } from "../error/module-error.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import {
  admitFrozenFileNodeSnapshot,
  createFileNodeSnapshot,
  type FileNodeSnapshot,
  FileNodeSnapshotError,
  sameFileNodeIdentity,
  sameFileNodeSnapshot,
} from "./file-node-snapshot.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import {
  type RootedDirectory,
  RootedDirectoryError,
  type RootedResourceSnapshot,
  isRootedDirectory,
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
 *
 * 文件末尾的两个函数供各耐久原语共用（写一次，1.4.5）：调用或关闭一次句柄时只接住本类错误、
 * 其余原样上抛的骨架。把本类的原因归成哪个原语原因、报在哪条路径上，仍由每个原语自己说。
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

/**
 * RootedExactResourceHandle 的稳定错误。
 *
 * 错误不回显根目录、资源、绝对路径、预期节点、当前节点、系统调用或原因链。
 */
export class RootedExactResourceHandleError extends ModuleError<RootedExactResourceHandleErrorReason> {
  static override readonly code = "wakeflow-rooted-exact-resource-handle";
}

type ResourceAdmission = "regular-file" | "file-or-directory";

function normalizeErrorPath(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "$resourcePath";
}

const fail: Fail<RootedExactResourceHandleErrorReason> = failWith(RootedExactResourceHandleError);

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (!isRootedDirectory(value)) fail("input", "$root");
}

function parseExpectedNode(value: unknown): Readonly<FileNodeSnapshot> {
  return admitFrozenFileNodeSnapshot(value, (cause) => fail("input", "$expectedNode", cause));
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

function requiredOpenFlags(kind: RootedExactResourceKind, errorPath: string): number {
  const noFollow: unknown = fileSystemConstants.O_NOFOLLOW;
  if (typeof noFollow !== "number") fail("root-scope", errorPath);
  const nonBlocking =
    typeof fileSystemConstants.O_NONBLOCK === "number" ? fileSystemConstants.O_NONBLOCK : 0;
  let directory = 0;
  if (kind === "directory") {
    const value: unknown = fileSystemConstants.O_DIRECTORY;
    if (typeof value !== "number") fail("root-scope", errorPath);
    directory = value;
  }
  return fileSystemConstants.O_RDONLY | noFollow | nonBlocking | directory;
}

function snapshotOpenedHandle(value: unknown, errorPath: string): Readonly<FileNodeSnapshot> {
  try {
    return createFileNodeSnapshot(value, errorPath);
  } catch (error: unknown) {
    if (error instanceof FileNodeSnapshotError) {
      fail("resource-changed", errorPath, error);
    }
    throw error;
  }
}

/** 第一次检查失败：按根目录错误的原因归类；别名与中途变化都算资源变了，其余是根作用域。 */
function failInitialInspection(error: RootedDirectoryError, errorPath: string): never {
  if (error.reason === "resource-path") fail("input", errorPath, error);
  if (error.reason === "resource-not-found") {
    fail("resource-not-found", errorPath, error);
  }
  if (error.reason === "resource-changed") {
    fail("resource-changed", errorPath, error);
  }
  if (error.reason === "resource-alias") {
    fail("resource-changed", errorPath, error);
  }
  fail("root-scope", errorPath, error);
}

async function inspectInitialResource(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  expectedNode: Readonly<FileNodeSnapshot>,
  admission: ResourceAdmission,
  errorPath: string,
): Promise<
  Readonly<{
    resource: Readonly<RootedResourceSnapshot>;
    kind: RootedExactResourceKind;
  }>
> {
  let resource: Readonly<RootedResourceSnapshot>;
  try {
    resource = await root.inspectExistingResource(resourcePath, errorPath);
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) failInitialInspection(error, errorPath);
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
      handle = await openFileHandle(initial.resource.physicalPath, flags);
    } catch (error: unknown) {
      const code = readNodeSystemErrorCode(error);
      if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
        fail("resource-changed", errorPath, error);
      }
      fail("resource-open-failure", errorPath, error);
    }

    try {
      const opened = snapshotOpenedHandle(await handle.stat({ bigint: true }), errorPath);
      if (opened.kind !== initial.kind || !sameFileNodeSnapshot(initial.resource.node, opened)) {
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
      opened = snapshotOpenedHandle(await this.#handle.stat({ bigint: true }), this.#errorPath);
    } catch (error: unknown) {
      if (error instanceof RootedExactResourceHandleError) throw error;
      fail("resource-changed", this.#errorPath, error);
    }
    if (opened.kind !== this.#kind || !sameFileNodeIdentity(this.#initialNodeSnapshot, opened)) {
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
      pathResource = await this.#root.inspectExistingResource(this.#resourcePath, this.#errorPath);
    } catch (error: unknown) {
      if (error instanceof RootedDirectoryError) {
        fail("resource-changed", this.#errorPath, error);
      }
      throw error;
    }
    if (
      pathResource.node.kind !== this.#kind ||
      !sameFileNodeSnapshot(this.#initialNodeSnapshot, opened) ||
      !sameFileNodeSnapshot(opened, pathResource.node)
    ) {
      fail("resource-changed", this.#errorPath);
    }
    return pathResource.node;
  }

  /**
   * 同步已打开的 inode，并返回同步后的句柄快照；不要求原路径名仍然存在。
   *
   * 持久化级别由资源所属的根决定。根为 `none` 时只跳过 `fsync` 系统调用本身，
   * 同步前后的观察、返回的节点事实与失败分类都与 `fsync` 完全一致。
   */
  async syncOpenedNode(): Promise<Readonly<FileNodeSnapshot>> {
    this.#assertOpen();
    await this.inspectOpenedNode();
    if (this.#root.durability === "fsync") {
      try {
        await this.#handle.sync();
      } catch (cause: unknown) {
        fail("sync-failure", this.#errorPath, cause);
      }
    }
    return this.inspectOpenedNode();
  }

  /** 幂等关闭指定资源句柄；关闭后所有 I/O 方法都会稳定拒绝调用。 */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    try {
      await this.#handle.close();
    } catch (cause: unknown) {
      fail("close-failure", this.#errorPath, cause);
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

/** 调用一次指定资源句柄：本类的错误交给 `translate` 抛出调用方自己的错误，别的错误原样上抛。 */
export async function translateExactResourceHandleError<T>(
  run: () => Promise<T>,
  translate: (error: RootedExactResourceHandleError) => never,
): Promise<T> {
  try {
    return await run();
  } catch (error: unknown) {
    if (error instanceof RootedExactResourceHandleError) translate(error);
    throw error;
  }
}

/**
 * 关闭指定资源句柄：成功返回 `undefined`；本类的错误由 `describe` 换成调用方自己的错误后返回，
 * 是否成为主错误由调用方决定；别的错误原样上抛。
 */
export async function closeExactResourceHandle<E>(
  resource: RootedExactResourceHandle,
  describe: (error: RootedExactResourceHandleError) => E,
): Promise<E | undefined> {
  try {
    await resource.close();
    return undefined;
  } catch (error: unknown) {
    if (error instanceof RootedExactResourceHandleError) return describe(error);
    throw error;
  }
}
