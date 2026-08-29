import { types } from "node:util";
import pLimit from "p-limit";

import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import {
  addByteCounts,
  ByteCountError,
  parseByteCount,
  type ByteCount,
} from "../numeric/byte-count.js";
import {
  BoundedDirectoryTreeScanError,
  scanBoundedResourceDirectoryTree,
  scanBoundedRootDirectoryTree,
  type BoundedDirectoryTreeEntry,
  type BoundedDirectoryTreeScanOptions,
  type BoundedDirectoryTreeScanResult,
} from "./bounded-directory-tree-scan.js";
import {
  sameFileNodeSnapshot,
  type FileNodeSnapshot,
} from "./file-node-snapshot.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import { RootedDirectory } from "./rooted-directory.js";
import {
  readStableFileDigest,
  StableFileReadError,
  type StableFileSource,
} from "./stable-file-read.js";

/**
 * Wakeflow Foundation / Filesystem：根作用域内的稳定、有界资源树内容观察。
 *
 * 本模块组合两次 `BoundedDirectoryTreeScan` 和中间的普通文件稳定摘要读取：先冻结
 * 结构与节点预期，再以固定并发读取每个文件，最后复验完整结构。
 * 返回结果因此把同一次观察窗口内的路径、节点、文件字节数和 SHA-256 绑定起来。
 *
 * 本层不保留文件字节、不解析文本或 JSON、不跟随符号链接，也不决定特殊节点、
 * 空目录树、权限、所有者、硬链接、可移植路径冲突或领域目录布局是否合法。
 * Node 没有提供整树原子快照；本合同证明的是前后快照一致且每个文件在窗口内稳定。
 */

/** 文件摘要读取的内部固定并发上限，不属于调用方容量或领域策略。 */
const STABLE_RESOURCE_TREE_FILE_CONCURRENCY = 8;

export interface StableResourceTreeReadOptions {
  /** 全部后代节点上限，不包含起始目录自身。 */
  readonly maximumEntries: number;
  /** 起始目录深度为 0；直属项深度为 1。 */
  readonly maximumDepth: number;
  /** 普通文件数量上限。 */
  readonly maximumFiles: number;
  /** 任一普通文件的字节上限。 */
  readonly maximumFileBytes: ByteCount;
  /** 全部普通文件的累计字节上限。 */
  readonly maximumTotalBytes: ByteCount;
  /** 可选的起始目录物理节点预期。 */
  readonly expectedNode?: Readonly<FileNodeSnapshot>;
  readonly signal?: AbortSignal;
}

/** 一次整树观察中与结构节点绑定的普通文件内容事实。 */
export interface StableResourceTreeFile extends StableFileSource {
  readonly name: string;
  readonly parentResourcePath: PortableResourcePath | null;
  readonly depth: number;
}

/**
 * 一次完整、冻结的资源树内容观察。
 *
 * `entries` 保留目录、符号链接和特殊节点等全部结构事实；`files` 只包含已经完成
 * 稳定摘要读取的普通文件，并沿用相同的资源路径确定顺序。
 */
export interface StableResourceTreeReadResult<
  TreeRootResourcePath extends PortableResourcePath | null =
    PortableResourcePath | null,
> {
  readonly treeRootResourcePath: TreeRootResourcePath;
  readonly treeRootNode: Readonly<FileNodeSnapshot>;
  readonly entries: readonly Readonly<BoundedDirectoryTreeEntry>[];
  readonly files: readonly Readonly<StableResourceTreeFile>[];
  readonly totalFileBytes: ByteCount;
}

/** 稳定资源树内容观察失败的稳定分类。 */
export type StableResourceTreeReadErrorReason =
  | "input"
  | "root-scope"
  | "not-found"
  | "symlink"
  | "not-directory"
  | "entry-limit"
  | "depth-limit"
  | "file-count"
  | "file-bytes"
  | "total-bytes"
  | "entry-path"
  | "io-failure"
  | "source-changed"
  | "aborted";

const ERROR_MESSAGES = {
  "input": "Stable resource tree read input is invalid.",
  "root-scope": "Stable resource tree read could not establish its rooted scope.",
  "not-found": "Stable resource tree read target does not exist.",
  "symlink": "Stable resource tree read target cannot be a symbolic link.",
  "not-directory": "Stable resource tree read target must be a directory.",
  "entry-limit": "Stable resource tree exceeds the caller entry limit.",
  "depth-limit": "Stable resource tree exceeds the caller depth limit.",
  "file-count": "Stable resource tree exceeds the caller regular-file limit.",
  "file-bytes": "A stable resource tree file exceeds the caller byte limit.",
  "total-bytes": "Stable resource tree exceeds the caller total-byte limit.",
  "entry-path": "Stable resource tree contains a non-portable resource path.",
  "io-failure": "Stable resource tree facts could not be observed safely.",
  "source-changed": "Stable resource tree changed while it was being read.",
  "aborted": "Stable resource tree read was aborted.",
} as const satisfies Readonly<
  Record<StableResourceTreeReadErrorReason, string>
>;

/**
 * 稳定资源树读取的公共、脱敏错误。
 *
 * 错误不回显物理路径、资源引用、节点元数据、容量、摘要、取消原因或底层原因。
 */
export class StableResourceTreeReadError extends Error {
  override readonly name = "StableResourceTreeReadError";
  readonly code = "wakeflow-stable-resource-tree-read" as const;
  readonly reason: StableResourceTreeReadErrorReason;
  readonly path: string;

  constructor(reason: StableResourceTreeReadErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedStableResourceTreeReadOptions {
  readonly maximumEntries: number;
  readonly maximumDepth: number;
  readonly maximumFiles: number;
  readonly maximumFileBytes: ByteCount;
  readonly maximumTotalBytes: ByteCount;
  readonly expectedNode: Readonly<FileNodeSnapshot> | undefined;
  readonly signal: AbortSignal | undefined;
}

type TreeRootResourcePath = PortableResourcePath | null;

function fail(
  reason: StableResourceTreeReadErrorReason,
  path: string,
): never {
  throw new StableResourceTreeReadError(reason, path);
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal
  );
}

function parseCount(value: unknown, path: string): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
  ) {
    fail("input", path);
  }
  return value;
}

function parseBytes(value: unknown, path: string): ByteCount {
  try {
    return parseByteCount(value, path);
  } catch (error: unknown) {
    if (error instanceof ByteCountError) fail("input", path);
    throw error;
  }
}

function parseOptions(
  value: unknown,
): Readonly<ParsedStableResourceTreeReadOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }

  const required = Object.freeze([
    "maximumDepth",
    "maximumEntries",
    "maximumFileBytes",
    "maximumFiles",
    "maximumTotalBytes",
  ] as const);
  const allowed = new Set([...required, "expectedNode", "signal"]);
  if (
    required.some((field) => !Object.hasOwn(record, field))
    || Object.keys(record).some((key) => !allowed.has(key))
  ) {
    fail("input", "$options");
  }
  if (record.signal !== undefined && !isAbortSignal(record.signal)) {
    fail("input", "$options.signal");
  }
  return Object.freeze({
    maximumEntries: parseCount(
      record.maximumEntries,
      "$options.maximumEntries",
    ),
    maximumDepth: parseCount(
      record.maximumDepth,
      "$options.maximumDepth",
    ),
    maximumFiles: parseCount(
      record.maximumFiles,
      "$options.maximumFiles",
    ),
    maximumFileBytes: parseBytes(
      record.maximumFileBytes,
      "$options.maximumFileBytes",
    ),
    maximumTotalBytes: parseBytes(
      record.maximumTotalBytes,
      "$options.maximumTotalBytes",
    ),
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

function mapTreeScanError(
  error: BoundedDirectoryTreeScanError,
  phase: "before" | "after",
): never {
  if (error.reason === "input") fail("input", error.path);
  if (error.reason === "root-scope") fail("root-scope", "$root");
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "source-changed") fail("source-changed", "$tree");
  if (phase === "after") {
    if (
      error.reason === "not-found"
      || error.reason === "symlink"
      || error.reason === "not-directory"
      || error.reason === "entry-limit"
      || error.reason === "depth-limit"
      || error.reason === "entry-path"
    ) {
      fail("source-changed", "$tree");
    }
    fail("io-failure", "$tree");
  }
  if (error.reason === "not-found") fail("not-found", "$tree");
  if (error.reason === "symlink") fail("symlink", "$tree");
  if (error.reason === "not-directory") fail("not-directory", "$tree");
  if (error.reason === "entry-limit") fail("entry-limit", "$tree.entries");
  if (error.reason === "depth-limit") fail("depth-limit", "$tree.depth");
  if (error.reason === "entry-path") fail("entry-path", "$tree.entries");
  fail("io-failure", "$tree");
}

function mapStableFileReadError(error: StableFileReadError): never {
  if (error.reason === "input") fail("input", error.path);
  if (
    error.reason === "root-scope"
    || error.reason === "unsupported-platform"
  ) {
    fail("root-scope", "$root");
  }
  if (error.reason === "too-large") fail("io-failure", "$tree.files");
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (
    error.reason === "not-found"
    || error.reason === "symlink"
    || error.reason === "not-file"
    || error.reason === "expectation-changed"
    || error.reason === "source-changed"
  ) {
    fail("source-changed", "$tree.files");
  }
  fail("io-failure", "$tree.files");
}

function scanOptions(
  options: Readonly<ParsedStableResourceTreeReadOptions>,
  expectedNode: Readonly<FileNodeSnapshot> | undefined,
): BoundedDirectoryTreeScanOptions {
  return {
    maximumEntries: options.maximumEntries,
    maximumDepth: options.maximumDepth,
    ...(expectedNode === undefined ? {} : { expectedNode }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
}

async function scanTree(
  root: RootedDirectory,
  treeRootResourcePath: TreeRootResourcePath,
  options: Readonly<ParsedStableResourceTreeReadOptions>,
  expectedNode: Readonly<FileNodeSnapshot> | undefined,
  phase: "before" | "after",
): Promise<Readonly<BoundedDirectoryTreeScanResult>> {
  try {
    const parsed = scanOptions(options, expectedNode);
    return treeRootResourcePath === null
      ? await scanBoundedRootDirectoryTree(root, parsed)
      : await scanBoundedResourceDirectoryTree(
          root,
          treeRootResourcePath,
          parsed,
        );
  } catch (error: unknown) {
    if (error instanceof BoundedDirectoryTreeScanError) {
      mapTreeScanError(error, phase);
    }
    throw error;
  }
}

function addTreeBytes(
  current: ByteCount,
  next: ByteCount,
): ByteCount {
  try {
    return addByteCounts(current, next, "$tree.totalFileBytes");
  } catch (error: unknown) {
    if (error instanceof ByteCountError) {
      fail("total-bytes", "$tree.totalFileBytes");
    }
    throw error;
  }
}

function collectFileEntries(
  tree: Readonly<BoundedDirectoryTreeScanResult>,
  options: Readonly<ParsedStableResourceTreeReadOptions>,
): {
  readonly entries: readonly Readonly<BoundedDirectoryTreeEntry>[];
  readonly totalBytes: ByteCount;
} {
  const entries: Readonly<BoundedDirectoryTreeEntry>[] = [];
  let totalBytes = parseByteCount(0, "$tree.totalFileBytes");
  for (const entry of tree.entries) {
    if (entry.node.kind !== "file") continue;
    if (entries.length >= options.maximumFiles) {
      fail("file-count", "$tree.files");
    }
    if (entry.node.byteCount > options.maximumFileBytes) {
      fail("file-bytes", "$tree.files");
    }
    totalBytes = addTreeBytes(totalBytes, entry.node.byteCount);
    if (totalBytes > options.maximumTotalBytes) {
      fail("total-bytes", "$tree.totalFileBytes");
    }
    entries.push(entry);
  }
  return Object.freeze({ entries: Object.freeze(entries), totalBytes });
}

async function readOneFile(
  root: RootedDirectory,
  entry: Readonly<BoundedDirectoryTreeEntry>,
  options: Readonly<ParsedStableResourceTreeReadOptions>,
): Promise<Readonly<StableResourceTreeFile>> {
  try {
    const source = await readStableFileDigest(root, entry.resourcePath, {
      maximumBytes: options.maximumFileBytes,
      expectedNode: entry.node,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    return Object.freeze({
      ...source,
      name: entry.name,
      parentResourcePath: entry.parentResourcePath,
      depth: entry.depth,
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) mapStableFileReadError(error);
    throw error;
  }
}

async function readFiles(
  root: RootedDirectory,
  entries: readonly Readonly<BoundedDirectoryTreeEntry>[],
  options: Readonly<ParsedStableResourceTreeReadOptions>,
): Promise<readonly Readonly<StableResourceTreeFile>[]> {
  const limit = pLimit(STABLE_RESOURCE_TREE_FILE_CONCURRENCY);
  const settled = await Promise.allSettled(
    entries.map((entry) => limit(readOneFile, root, entry, options)),
  );
  const files: Readonly<StableResourceTreeFile>[] = [];
  for (const result of settled) {
    if (result.status === "rejected") throw result.reason;
    files.push(result.value);
  }
  return Object.freeze(files);
}

function sameTree(
  left: Readonly<BoundedDirectoryTreeScanResult>,
  right: Readonly<BoundedDirectoryTreeScanResult>,
): boolean {
  return left.treeRootResourcePath === right.treeRootResourcePath
    && sameFileNodeSnapshot(left.treeRootNode, right.treeRootNode)
    && left.entries.length === right.entries.length
    && left.entries.every((entry, index) => {
      const other = right.entries[index];
      return other !== undefined
        && entry.name === other.name
        && entry.resourcePath === other.resourcePath
        && entry.parentResourcePath === other.parentResourcePath
        && entry.depth === other.depth
        && sameFileNodeSnapshot(entry.node, other.node);
    });
}

async function readTree<TreeRoot extends TreeRootResourcePath>(
  root: RootedDirectory,
  treeRootResourcePath: TreeRoot,
  options: Readonly<ParsedStableResourceTreeReadOptions>,
): Promise<Readonly<StableResourceTreeReadResult<TreeRoot>>> {
  const before = await scanTree(
    root,
    treeRootResourcePath,
    options,
    options.expectedNode,
    "before",
  );
  const planned = collectFileEntries(before, options);
  const files = await readFiles(root, planned.entries, options);
  const after = await scanTree(
    root,
    treeRootResourcePath,
    options,
    before.treeRootNode,
    "after",
  );
  if (!sameTree(before, after)) fail("source-changed", "$tree");
  assertNotAborted(options.signal);
  return Object.freeze({
    treeRootResourcePath,
    treeRootNode: before.treeRootNode,
    entries: before.entries,
    files,
    totalFileBytes: planned.totalBytes,
  });
}

/** 稳定读取 RootedDirectory 自身的完整资源树内容事实。 */
export async function readStableRootResourceTree(
  root: RootedDirectory,
  options: StableResourceTreeReadOptions,
): Promise<Readonly<StableResourceTreeReadResult<null>>> {
  assertRoot(root);
  const parsed = parseOptions(options);
  assertNotAborted(parsed.signal);
  return readTree(root, null, parsed);
}

/** 稳定读取 `RootedDirectory` 内一个资源目录的完整目录树内容事实。 */
export async function readStableResourceTree(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  options: StableResourceTreeReadOptions,
): Promise<Readonly<StableResourceTreeReadResult<PortableResourcePath>>> {
  assertRoot(root);
  const parsed = parseOptions(options);
  assertNotAborted(parsed.signal);
  return readTree(root, resourcePath, parsed);
}
