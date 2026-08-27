import { types } from "node:util";

import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import type { FileNodeSnapshot } from "./file-node-snapshot.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import { RootedDirectory } from "./rooted-directory.js";
import {
  readStableResourceDirectory,
  readStableRootDirectory,
  StableDirectoryReadError,
  type StableDirectoryReadErrorReason,
  type StableDirectoryReadResult,
} from "./stable-directory-read.js";

/**
 * Wakeflow Foundation / Filesystem：根作用域内的有界、确定性目录树遍历。
 *
 * 本模块使用 `StableDirectoryRead` 逐层发现后代节点；调用方必须显式限制节点总数
 * 和相对深度。结果包含观察到的全部节点类型，并按完整资源路径确定性排序。只有
 * `kind === "directory"` 的目录项才会继续入栈，符号链接永远不会被跟随。
 *
 * 每个目录自身稳定、父目录观察到的子目录快照也会在进入该目录时复验，但整棵树
 * 不是操作系统原子快照：已经完成的早期分支仍可能在函数返回前再次变化。需要
 * 权威事实的 Artifact 或 Evidence 职责所有者应在读取字节并应用领域策略后执行
 * 整体复验。
 *
 * 本层不读取文件、不计算摘要、不使用回调过滤，也不判断权限位、所有者、硬链接、
 * 大小写冲突、允许的节点类型或任何领域目录布局。
 */

export interface BoundedDirectoryTreeScanOptions {
  /** 全部后代节点上限，不包含起始目录自身。 */
  readonly maximumEntries: number;
  /** 起始目录深度为 0；直属项深度为 1。 */
  readonly maximumDepth: number;
  /** 可选的起始目录物理 expectation；由首层稳定目录读取负责严格准入。 */
  readonly expectedNode?: Readonly<FileNodeSnapshot>;
  readonly signal?: AbortSignal;
}

/** 通用 tree scan 返回的一个冻结后代节点事实。 */
export interface BoundedDirectoryTreeEntry {
  readonly name: string;
  readonly resourcePath: PortableResourcePath;
  readonly parentResourcePath: PortableResourcePath | null;
  readonly depth: number;
  readonly node: Readonly<FileNodeSnapshot>;
}

/**
 * 一次有界树遍历的冻结完整结果。
 *
 * `treeRootResourcePath === null` 只表示 `RootedDirectory` 自身，不是持久化路径。
 */
export interface BoundedDirectoryTreeScanResult<
  TreeRootResourcePath extends PortableResourcePath | null =
    PortableResourcePath | null,
> {
  readonly treeRootResourcePath: TreeRootResourcePath;
  readonly treeRootNode: Readonly<FileNodeSnapshot>;
  readonly entries: readonly Readonly<BoundedDirectoryTreeEntry>[];
}

/** 有界目录树遍历失败的稳定分类。 */
export type BoundedDirectoryTreeScanErrorReason =
  | "input"
  | "root-scope"
  | "not-found"
  | "symlink"
  | "not-directory"
  | "entry-limit"
  | "depth-limit"
  | "entry-path"
  | "open-failure"
  | "enumeration-failure"
  | "inspection-failure"
  | "source-changed"
  | "aborted"
  | "close-failure";

const ERROR_MESSAGES = {
  "input": "Bounded directory tree scan input is invalid.",
  "root-scope": "Directory tree scan could not establish its rooted scope.",
  "not-found": "Directory tree scan target does not exist.",
  "symlink": "Directory tree scan target cannot be a symbolic link.",
  "not-directory": "Directory tree scan target must be a directory.",
  "entry-limit": "Directory tree exceeds the caller total-entry limit.",
  "depth-limit": "Directory tree exceeds the caller relative-depth limit.",
  "entry-path": "Directory tree contains a non-portable resource path.",
  "open-failure": "A directory tree member could not be opened safely.",
  "enumeration-failure": "Directory tree members could not be enumerated safely.",
  "inspection-failure": "Directory tree node facts could not be inspected safely.",
  "source-changed": "Directory tree changed while it was being traversed.",
  "aborted": "Bounded directory tree scan was aborted.",
  "close-failure": "A directory tree scan handle could not be closed safely.",
} as const satisfies Readonly<
  Record<BoundedDirectoryTreeScanErrorReason, string>
>;

/**
 * 通用目录树扫描的稳定错误。
 *
 * 错误不回显物理根目录、资源引用、目录项名称、节点元数据、限制值、取消原因
 * 或 Node.js/底层原因。
 */
export class BoundedDirectoryTreeScanError extends Error {
  override readonly name = "BoundedDirectoryTreeScanError";
  readonly code = "wakeflow-bounded-directory-tree-scan" as const;
  readonly reason: BoundedDirectoryTreeScanErrorReason;
  readonly path: string;

  constructor(reason: BoundedDirectoryTreeScanErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedBoundedDirectoryTreeScanOptions {
  readonly maximumEntries: number;
  readonly maximumDepth: number;
  readonly expectedNode: Readonly<FileNodeSnapshot> | undefined;
  readonly signal: AbortSignal | undefined;
}

interface PendingDirectory {
  readonly resourcePath: PortableResourcePath | null;
  readonly depth: number;
  readonly expectedNode: Readonly<FileNodeSnapshot> | null;
}

const LOWER_REASON_MAP = {
  "input": "input",
  "unsupported-platform": "root-scope",
  "root-scope": "root-scope",
  "not-found": "not-found",
  "symlink": "symlink",
  "not-directory": "not-directory",
  "expectation-changed": "source-changed",
  "entry-path": "entry-path",
  "io-failure": "inspection-failure",
  "source-changed": "source-changed",
  "aborted": "aborted",
  "close-failure": "close-failure",
} as const satisfies Readonly<Record<
  Exclude<StableDirectoryReadErrorReason, "too-many-entries">,
  BoundedDirectoryTreeScanErrorReason
>>;

function fail(
  reason: BoundedDirectoryTreeScanErrorReason,
  path: string,
): never {
  throw new BoundedDirectoryTreeScanError(reason, path);
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal
  );
}

function parseLimit(
  value: unknown,
  path: "$options.maximumEntries" | "$options.maximumDepth",
): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
  ) {
    fail("input", path);
  }
  return value;
}

function parseOptions(
  value: unknown,
): Readonly<ParsedBoundedDirectoryTreeScanOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }

  const required = ["maximumDepth", "maximumEntries"] as const;
  const allowed = new Set([...required, "expectedNode", "signal"]);
  if (
    required.some((field) => !Object.hasOwn(record, field))
    || Object.keys(record).some((key) => !allowed.has(key))
  ) {
    fail("input", "$options");
  }
  const maximumEntries = parseLimit(
    record.maximumEntries,
    "$options.maximumEntries",
  );
  const maximumDepth = parseLimit(
    record.maximumDepth,
    "$options.maximumDepth",
  );
  if (record.signal !== undefined && !isAbortSignal(record.signal)) {
    fail("input", "$options.signal");
  }
  return Object.freeze({
    maximumEntries,
    maximumDepth,
    expectedNode: record.expectedNode as
      | Readonly<FileNodeSnapshot>
      | undefined,
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

function mapDirectoryReadError(
  error: StableDirectoryReadError,
  limitReason: "entry-limit" | "depth-limit",
): never {
  if (error.reason === "too-many-entries") {
    fail(limitReason, limitReason === "entry-limit"
      ? "$tree.entries"
      : "$tree.depth");
  }
  fail(LOWER_REASON_MAP[error.reason], error.path);
}

function directoryReadOptions(
  maximumEntries: number,
  expectedNode: Readonly<FileNodeSnapshot> | null,
  signal: AbortSignal | undefined,
): {
  readonly maximumEntries: number;
  readonly expectedNode?: Readonly<FileNodeSnapshot>;
  readonly signal?: AbortSignal;
} {
  return {
    maximumEntries,
    ...(expectedNode === null ? {} : { expectedNode }),
    ...(signal === undefined ? {} : { signal }),
  };
}

async function readOneDirectory(
  root: RootedDirectory,
  resourcePath: PortableResourcePath | null,
  maximumEntries: number,
  expectedNode: Readonly<FileNodeSnapshot> | null,
  signal: AbortSignal | undefined,
  limitReason: "entry-limit" | "depth-limit",
): Promise<Readonly<StableDirectoryReadResult>> {
  try {
    const options = directoryReadOptions(maximumEntries, expectedNode, signal);
    return resourcePath === null
      ? await readStableRootDirectory(root, options)
      : await readStableResourceDirectory(root, resourcePath, options);
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError) {
      mapDirectoryReadError(error, limitReason);
    }
    throw error;
  }
}

function createTreeEntry(
  parent: Readonly<PendingDirectory>,
  entry: Readonly<StableDirectoryReadResult["entries"][number]>,
): Readonly<BoundedDirectoryTreeEntry> {
  return Object.freeze({
    name: entry.name,
    resourcePath: entry.resourcePath,
    parentResourcePath: parent.resourcePath,
    depth: parent.depth + 1,
    node: entry.node,
  });
}

async function scanTree<
  TreeRootResourcePath extends PortableResourcePath | null,
>(
  root: RootedDirectory,
  treeRootResourcePath: TreeRootResourcePath,
  options: Readonly<ParsedBoundedDirectoryTreeScanOptions>,
): Promise<Readonly<BoundedDirectoryTreeScanResult<TreeRootResourcePath>>> {
  const pendingDirectories: PendingDirectory[] = [{
    resourcePath: treeRootResourcePath,
    depth: 0,
    expectedNode: options.expectedNode ?? null,
  }];
  const entries: Readonly<BoundedDirectoryTreeEntry>[] = [];
  let treeRootNode: Readonly<FileNodeSnapshot> | undefined;

  while (pendingDirectories.length > 0) {
    assertNotAborted(options.signal);
    const pending = pendingDirectories.pop();
    if (pending === undefined) fail("inspection-failure", "$tree");
    if (pending.depth > options.maximumDepth) {
      fail("depth-limit", "$tree.depth");
    }

    const atDepthLimit = pending.depth === options.maximumDepth;
    const remainingEntries = options.maximumEntries - entries.length;
    const directory = await readOneDirectory(
      root,
      pending.resourcePath,
      atDepthLimit ? 0 : remainingEntries,
      pending.expectedNode,
      options.signal,
      atDepthLimit ? "depth-limit" : "entry-limit",
    );

    if (pending.depth === 0) treeRootNode = directory.directoryNode;
    if (atDepthLimit) continue;

    const childDirectories: PendingDirectory[] = [];
    for (const child of directory.entries) {
      const treeEntry = createTreeEntry(pending, child);
      entries.push(treeEntry);
      if (treeEntry.node.kind === "directory") {
        childDirectories.push(Object.freeze({
          resourcePath: treeEntry.resourcePath,
          depth: treeEntry.depth,
          expectedNode: treeEntry.node,
        }));
      }
    }
    for (let index = childDirectories.length - 1; index >= 0; index -= 1) {
      const child = childDirectories[index];
      if (child !== undefined) pendingDirectories.push(child);
    }
  }

  if (treeRootNode === undefined) fail("inspection-failure", "$tree");
  entries.sort((left, right) => compareText(
    left.resourcePath,
    right.resourcePath,
  ));
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1]?.resourcePath === entries[index]?.resourcePath) {
      fail("source-changed", "$tree.entries");
    }
  }
  assertNotAborted(options.signal);
  return Object.freeze({
    treeRootResourcePath,
    treeRootNode,
    entries: Object.freeze(entries),
  });
}

/** 有界扫描 RootedDirectory 自身的完整后代树。 */
export async function scanBoundedRootDirectoryTree(
  root: RootedDirectory,
  options: BoundedDirectoryTreeScanOptions,
): Promise<Readonly<BoundedDirectoryTreeScanResult<null>>> {
  assertRoot(root);
  const parsed = parseOptions(options);
  assertNotAborted(parsed.signal);
  return scanTree(root, null, parsed);
}

/** 有界扫描 `RootedDirectory` 内一个资源目录的完整后代树。 */
export async function scanBoundedResourceDirectoryTree(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  options: BoundedDirectoryTreeScanOptions,
): Promise<Readonly<
  BoundedDirectoryTreeScanResult<PortableResourcePath>
>> {
  assertRoot(root);
  const parsed = parseOptions(options);
  assertNotAborted(parsed.signal);
  return scanTree(root, resourcePath, parsed);
}
