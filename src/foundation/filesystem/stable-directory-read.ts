import {
  constants as fileSystemConstants,
  type Dirent,
} from "node:fs";
import {
  lstat,
  open as openFileHandle,
  opendir,
  type FileHandle,
} from "node:fs/promises";
import nodePath from "node:path";
import { types } from "node:util";

import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import {
  createFileNodeSnapshot,
  FileNodeSnapshotError,
  sameFileNodeSnapshot,
  type FileNodeSnapshot,
} from "./file-node-snapshot.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "./portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
  type RootedResourceSnapshot,
} from "./rooted-directory.js";

/**
 * Wakeflow Foundation / Filesystem：根作用域内的一层稳定目录读取。
 *
 * 本文件对根目录或一个根内 resource directory 执行 no-follow handle 复验、
 * 两次有界流式枚举、两次子节点 lstat 和最终目录/root 复验。返回项使用确定的
 * code-unit 次序，并携带可继续交给根作用域能力使用的 PortableResourcePath。
 *
 * 本层不递归、不读取文件内容、不相信 Dirent 类型、不跟随子 symlink，也不决定
 * special node、mode、owner、hardlink、case collision、过滤或领域目录结构策略。
 * Node 没有暴露 openat/openat2；pathname 竞态边界与 RootedDirectory 相同。
 */

export interface StableDirectoryReadOptions {
  /** 当前一层允许返回的最大目录项数；零只允许空目录。 */
  readonly maximumEntries: number;
  readonly signal?: AbortSignal;
}

/** 一次稳定读取获得的冻结直属目录项。 */
export interface StableDirectoryEntry {
  readonly name: string;
  readonly resourcePath: PortableResourcePath;
  readonly node: Readonly<FileNodeSnapshot>;
}

/**
 * 一次稳定目录读取的冻结结果。
 *
 * `directoryResourcePath === null` 明确表示 RootedDirectory 自身；它不是可持久化
 * wire path，也不会用空字符串或 `.` 冒充 PortableResourcePath。
 */
export interface StableDirectoryReadResult<
  DirectoryResourcePath extends PortableResourcePath | null =
    PortableResourcePath | null,
> {
  readonly directoryResourcePath: DirectoryResourcePath;
  readonly directoryNode: Readonly<FileNodeSnapshot>;
  readonly entries: readonly Readonly<StableDirectoryEntry>[];
}

/** 稳定目录读取失败的稳定分类。 */
export type StableDirectoryReadErrorReason =
  | "input"
  | "root-scope"
  | "not-found"
  | "symlink"
  | "not-directory"
  | "too-many-entries"
  | "entry-path"
  | "open-failure"
  | "enumeration-failure"
  | "inspection-failure"
  | "source-changed"
  | "aborted"
  | "close-failure";

const ERROR_MESSAGES = {
  "input": "Stable directory read input is invalid.",
  "root-scope": "Stable directory read could not establish its rooted scope.",
  "not-found": "Stable directory read target does not exist.",
  "symlink": "Stable directory read target cannot be a symbolic link.",
  "not-directory": "Stable directory read target must be a directory.",
  "too-many-entries": "Directory contains more entries than the caller limit.",
  "entry-path": "Directory entry cannot form a portable rooted resource path.",
  "open-failure": "Directory target could not be opened safely.",
  "enumeration-failure": "Directory entries could not be enumerated safely.",
  "inspection-failure": "Directory entry facts could not be inspected safely.",
  "source-changed": "Directory or one of its entries changed during the read.",
  "aborted": "Stable directory read was aborted.",
  "close-failure": "A directory read handle could not be closed safely.",
} as const satisfies Readonly<
  Record<StableDirectoryReadErrorReason, string>
>;

/**
 * 稳定目录读取的公共错误。
 *
 * 错误不回显物理路径、resource ref、目录项名称、节点元数据、限制值、系统调用、
 * Abort reason 或 Node cause。
 */
export class StableDirectoryReadError extends Error {
  override readonly name = "StableDirectoryReadError";
  readonly code = "wakeflow-stable-directory-read" as const;
  readonly reason: StableDirectoryReadErrorReason;
  readonly path: string;

  constructor(reason: StableDirectoryReadErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedStableDirectoryReadOptions {
  readonly maximumEntries: number;
  readonly signal: AbortSignal | undefined;
}

interface DirectoryTarget<
  DirectoryResourcePath extends PortableResourcePath | null,
> {
  readonly directoryResourcePath: DirectoryResourcePath;
  readonly physicalPath: string;
  readonly node: Readonly<FileNodeSnapshot>;
  readonly errorPath: "$root" | "$resourcePath";
}

function fail(
  reason: StableDirectoryReadErrorReason,
  path: string,
): never {
  throw new StableDirectoryReadError(reason, path);
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal
  );
}

function parseOptions(value: unknown): ParsedStableDirectoryReadOptions {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }

  const allowed = new Set(["maximumEntries", "signal"]);
  if (
    !Object.hasOwn(record, "maximumEntries")
    || Object.keys(record).some((key) => !allowed.has(key))
  ) {
    fail("input", "$options");
  }
  if (
    typeof record.maximumEntries !== "number"
    || !Number.isSafeInteger(record.maximumEntries)
    || record.maximumEntries < 0
  ) {
    fail("input", "$options.maximumEntries");
  }
  if (record.signal !== undefined && !isAbortSignal(record.signal)) {
    fail("input", "$options.signal");
  }
  return Object.freeze({
    maximumEntries: record.maximumEntries,
    signal: record.signal,
  });
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

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$signal");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length
    && left.every((name, index) => name === right[index])
  );
}

function requiredOpenFlags(): number {
  const directory: unknown = fileSystemConstants.O_DIRECTORY;
  const noFollow: unknown = fileSystemConstants.O_NOFOLLOW;
  if (typeof directory !== "number" || typeof noFollow !== "number") {
    fail("root-scope", "$root");
  }
  const nonBlocking = typeof fileSystemConstants.O_NONBLOCK === "number"
    ? fileSystemConstants.O_NONBLOCK
    : 0;
  return fileSystemConstants.O_RDONLY | directory | noFollow | nonBlocking;
}

async function inspectInitialRoot(
  root: RootedDirectory,
): Promise<Readonly<DirectoryTarget<null>>> {
  let node: Readonly<FileNodeSnapshot>;
  try {
    node = await root.assertCurrent("$root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
    throw error;
  }
  if (node.kind !== "directory") fail("root-scope", "$root");
  return Object.freeze({
    directoryResourcePath: null,
    physicalPath: root.absolutePath,
    node,
    errorPath: "$root",
  });
}

async function inspectInitialResource(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<Readonly<DirectoryTarget<PortableResourcePath>>> {
  let resource: Readonly<RootedResourceSnapshot>;
  try {
    resource = await root.inspectExistingResource(
      resourcePath,
      "$resourcePath",
    );
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      if (error.reason === "resource-not-found") {
        fail("not-found", "$resourcePath");
      }
      if (error.reason === "resource-path") fail("input", "$resourcePath");
      fail("root-scope", "$resourcePath");
    }
    throw error;
  }
  if (resource.node.kind === "symbolic-link") {
    fail("symlink", "$resourcePath");
  }
  if (resource.node.kind !== "directory") {
    fail("not-directory", "$resourcePath");
  }
  return Object.freeze({
    directoryResourcePath: resourcePath,
    physicalPath: resource.physicalPath,
    node: resource.node,
    errorPath: "$resourcePath",
  });
}

async function inspectFinalTarget<
  DirectoryResourcePath extends PortableResourcePath | null,
>(
  root: RootedDirectory,
  target: Readonly<DirectoryTarget<DirectoryResourcePath>>,
): Promise<Readonly<FileNodeSnapshot>> {
  try {
    if (target.directoryResourcePath === null) {
      return await root.assertCurrent("$root");
    }
    const resource = await root.inspectExistingResource(
      target.directoryResourcePath,
      "$resourcePath",
    );
    return resource.node;
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      fail("source-changed", target.errorPath);
    }
    throw error;
  }
}

async function openStableDirectory<
  DirectoryResourcePath extends PortableResourcePath | null,
>(
  target: Readonly<DirectoryTarget<DirectoryResourcePath>>,
): Promise<FileHandle> {
  const flags = requiredOpenFlags();
  try {
    return await openFileHandle(target.physicalPath, flags);
  } catch (error: unknown) {
    const code = readNodeSystemErrorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
      fail("source-changed", target.errorPath);
    }
    fail("open-failure", target.errorPath);
  }
}

async function snapshotOpenedDirectory(
  handle: FileHandle,
  errorPath: string,
): Promise<Readonly<FileNodeSnapshot>> {
  try {
    return createFileNodeSnapshot(
      await handle.stat({ bigint: true }),
      errorPath,
    );
  } catch (error: unknown) {
    if (error instanceof FileNodeSnapshotError) {
      fail("source-changed", errorPath);
    }
    fail("source-changed", errorPath);
  }
}

async function enumerateNames(
  physicalPath: string,
  maximumEntries: number,
  signal: AbortSignal | undefined,
): Promise<readonly string[]> {
  let directory;
  try {
    directory = await opendir(physicalPath, {
      encoding: "utf8",
      recursive: false,
    });
  } catch (error: unknown) {
    const code = readNodeSystemErrorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
      fail("source-changed", "$entries");
    }
    fail("enumeration-failure", "$entries");
  }

  const names: string[] = [];
  let primaryError: unknown;
  try {
    while (true) {
      assertNotAborted(signal);
      let entry: Dirent | null;
      try {
        entry = await directory.read();
      } catch (error: unknown) {
        assertNotAborted(signal);
        const code = readNodeSystemErrorCode(error);
        if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
          fail("source-changed", "$entries");
        }
        fail("enumeration-failure", "$entries");
      }
      if (entry === null) break;
      if (typeof entry.name !== "string") fail("entry-path", "$entries");
      if (names.length >= maximumEntries) {
        fail("too-many-entries", "$entries");
      }
      names.push(entry.name);
    }
  } catch (error: unknown) {
    primaryError = error;
  }

  try {
    await directory.close();
  } catch {
    if (primaryError === undefined) fail("close-failure", "$entries");
  }
  if (primaryError !== undefined) throw primaryError;
  assertNotAborted(signal);

  names.sort(compareText);
  for (let index = 1; index < names.length; index += 1) {
    if (names[index - 1] === names[index]) fail("entry-path", "$entries");
  }
  return Object.freeze(names);
}

function entryResourcePath(
  directoryResourcePath: PortableResourcePath | null,
  name: string,
  index: number,
): PortableResourcePath {
  const candidate = directoryResourcePath === null
    ? name
    : `${directoryResourcePath}/${name}`;
  try {
    return parsePortableResourcePath(candidate, `$entries/${index}`);
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      fail("entry-path", `$entries/${index}`);
    }
    throw error;
  }
}

async function inspectEntries(
  target: Readonly<DirectoryTarget<PortableResourcePath | null>>,
  names: readonly string[],
  signal: AbortSignal | undefined,
  verification: boolean,
): Promise<readonly Readonly<StableDirectoryEntry>[]> {
  const entries: Readonly<StableDirectoryEntry>[] = [];
  for (const [index, name] of names.entries()) {
    assertNotAborted(signal);
    const resourcePath = entryResourcePath(
      target.directoryResourcePath,
      name,
      index,
    );
    let node: Readonly<FileNodeSnapshot>;
    try {
      const stats = await lstat(
        nodePath.join(target.physicalPath, name),
        { bigint: true },
      );
      node = createFileNodeSnapshot(stats, `$entries/${index}.node`);
    } catch (error: unknown) {
      if (verification) fail("source-changed", `$entries/${index}`);
      if (readNodeSystemErrorCode(error) === "ENOENT") {
        fail("source-changed", `$entries/${index}`);
      }
      if (error instanceof FileNodeSnapshotError) {
        fail("inspection-failure", `$entries/${index}`);
      }
      fail("inspection-failure", `$entries/${index}`);
    }
    entries.push(Object.freeze({ name, resourcePath, node }));
  }
  return Object.freeze(entries);
}

function sameEntries(
  left: readonly Readonly<StableDirectoryEntry>[],
  right: readonly Readonly<StableDirectoryEntry>[],
): boolean {
  return (
    left.length === right.length
    && left.every((entry, index) => {
      const other = right[index];
      return (
        other !== undefined
        && entry.name === other.name
        && entry.resourcePath === other.resourcePath
        && sameFileNodeSnapshot(entry.node, other.node)
      );
    })
  );
}

async function readStableDirectory<
  DirectoryResourcePath extends PortableResourcePath | null,
>(
  root: RootedDirectory,
  target: Readonly<DirectoryTarget<DirectoryResourcePath>>,
  options: Readonly<ParsedStableDirectoryReadOptions>,
): Promise<Readonly<StableDirectoryReadResult<DirectoryResourcePath>>> {
  const handle = await openStableDirectory(target);
  let primaryError: unknown;
  let result: Readonly<
    StableDirectoryReadResult<DirectoryResourcePath>
  > | undefined;
  try {
    const opened = await snapshotOpenedDirectory(handle, target.errorPath);
    if (
      opened.kind !== "directory"
      || !sameFileNodeSnapshot(target.node, opened)
    ) {
      fail("source-changed", target.errorPath);
    }

    const firstNames = await enumerateNames(
      target.physicalPath,
      options.maximumEntries,
      options.signal,
    );
    const firstEntries = await inspectEntries(
      target,
      firstNames,
      options.signal,
      false,
    );
    const secondNames = await enumerateNames(
      target.physicalPath,
      options.maximumEntries,
      options.signal,
    );
    if (!sameNames(firstNames, secondNames)) {
      fail("source-changed", "$entries");
    }
    const secondEntries = await inspectEntries(
      target,
      secondNames,
      options.signal,
      true,
    );
    if (!sameEntries(firstEntries, secondEntries)) {
      fail("source-changed", "$entries");
    }

    const afterHandle = await snapshotOpenedDirectory(handle, target.errorPath);
    const afterPath = await inspectFinalTarget(root, target);
    if (
      afterPath.kind !== "directory"
      || !sameFileNodeSnapshot(opened, afterHandle)
      || !sameFileNodeSnapshot(afterHandle, afterPath)
    ) {
      fail("source-changed", target.errorPath);
    }
    assertNotAborted(options.signal);
    result = Object.freeze({
      directoryResourcePath: target.directoryResourcePath,
      directoryNode: afterPath,
      entries: firstEntries,
    });
  } catch (error: unknown) {
    primaryError = error;
  }

  try {
    await handle.close();
  } catch {
    if (primaryError === undefined) fail("close-failure", target.errorPath);
  }
  if (primaryError !== undefined) throw primaryError;
  if (result === undefined) fail("inspection-failure", target.errorPath);
  return result;
}

/** 稳定读取 RootedDirectory 自身的一层直属目录项。 */
export async function readStableRootDirectory(
  root: RootedDirectory,
  options: StableDirectoryReadOptions,
): Promise<Readonly<StableDirectoryReadResult<null>>> {
  assertRoot(root);
  const parsed = parseOptions(options);
  assertNotAborted(parsed.signal);
  const target = await inspectInitialRoot(root);
  assertNotAborted(parsed.signal);
  return readStableDirectory(root, target, parsed);
}

/** 稳定读取 RootedDirectory 内一个已存在 resource directory 的直属目录项。 */
export async function readStableResourceDirectory(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  options: StableDirectoryReadOptions,
): Promise<Readonly<StableDirectoryReadResult<PortableResourcePath>>> {
  assertRoot(root);
  const parsed = parseOptions(options);
  assertNotAborted(parsed.signal);
  const target = await inspectInitialResource(root, resourcePath);
  assertNotAborted(parsed.signal);
  return readStableDirectory(root, target, parsed);
}
