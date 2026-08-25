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
 * Wakeflow Foundation / Filesystem：根内 exact 既有资源的已打开 inode capability。
 *
 * static factory 先通过 RootedDirectory 观察真实 resource，再以 O_NOFOLLOW 打开
 * FileHandle，并证明 expected node、pathname 与 handle 是同一份完整快照。成功实例
 * 因此适合作为 link、rename、unlink 等 mutation 的 source 准入能力。
 *
 * assertPathCurrent 只用于 commit 前，要求 pathname、打开 handle 与初始快照仍完全
 * 一致。inspectOpenedNode 在 commit 后仍可观察已经 rename 或 unlink 的原 inode，只
 * 保证 kind 与 dev/inode identity 未变，不把合法的 linkCount 或 metadata transition
 * 误判成 source replacement。
 *
 * 本 class 不暴露原始 FileHandle，不读取或写入字节，不 chmod，也不执行 link、rename、
 * unlink 或领域恢复。Node 未暴露 openat，因此 pathname 竞态边界与 RootedDirectory
 * 保持一致。
 */

/** exact resource handle 可以准入的真实节点类型。 */
export type RootedExactResourceKind = "file" | "directory";

/** exact resource handle 打开、复验、同步或关闭失败分类。 */
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
 * 错误不回显 root、resource、absolute path、expected node、当前节点、系统调用或 cause。
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
 * 已打开 exact resource 的进程内 capability。
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

  /** 打开一个仍匹配 exact expectation 的真实 regular file。 */
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

  /** 打开一个仍匹配 exact expectation 的真实 regular file 或 directory。 */
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
        // 未签发 handle 的首个准入错误保持权威。
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

  /** exact 准入时的完整节点基准，不是当前 metadata 缓存。 */
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
   * 本方法只固定 kind 与 dev/inode，不拥有 linkCount、mode、size 或时间变化策略。
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

  /** 证明 commit 前 pathname、handle 与 exact 初始快照仍完全一致。 */
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

  /** 同步打开的 inode，并返回同步后的 handle 快照；不要求原 pathname 仍存在。 */
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

  /** 幂等关闭 exact resource handle；关闭后所有 I/O 方法稳定拒绝。 */
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
