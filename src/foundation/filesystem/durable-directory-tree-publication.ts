import { types } from "node:util";

import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import {
  DurableDirectoryTreeCandidateError,
  inspectDirectoryTreeCandidate,
  parseDirectoryTreeCandidatePlan,
  type DirectoryTreeCandidatePlan,
  type DirectoryTreeCandidateResult,
} from "./durable-directory-tree-candidate.js";
import {
  renameResourceDurably,
  DurableResourceRenameError,
} from "./durable-resource-rename.js";
import {
  sameFileNodeSnapshot,
  FileNodeSnapshotError,
  type FileNodeSnapshot,
} from "./file-node-snapshot.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "./portable-resource-path.js";
import { RootedDirectory } from "./rooted-directory.js";

/**
 * Wakeflow Foundation / Filesystem：清单已闭合的目录树候选整体发布。
 *
 * 本函数在提交前重新验证候选根目录的指定文件系统节点和精确清单，再通过具备崩溃
 * 持久性的资源重命名跨越唯一提交点。重命名完成后，函数从最终路径回读并再次验证
 * 完整计划。成功回执同时绑定源路径、目标路径、目录树摘要、最终根节点，以及源、
 * 目标父目录的同步结果。
 *
 * Node.js 未暴露 `renameat2(RENAME_NOREPLACE)`。目标路径不存在只是调用方持有领域锁
 * 时的协作式前置条件，不是能够约束非协作写入者的内核级比较并交换（CAS）。本层
 * 不创建候选目录或父目录、不获取锁、不解释意图记录、不跨设备复制，也不清理失败
 * 操作或崩溃留下的资源。
 */

export interface DurableDirectoryTreePublicationOptions {
  readonly signal?: AbortSignal;
}

export interface DurableDirectoryTreePublicationResult {
  readonly sourceResourcePath: PortableResourcePath;
  readonly destinationResourcePath: PortableResourcePath;
  readonly plan: Readonly<DirectoryTreeCandidatePlan>;
  readonly rootNode: Readonly<FileNodeSnapshot>;
}

export type DurableDirectoryTreePublicationErrorReason =
  | "input"
  | "source-changed"
  | "source-conflict"
  | "destination-exists"
  | "cross-device"
  | "commit-uncertain"
  | "durability-failure"
  | "operation-failure"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Directory tree publication input is invalid.",
  "source-changed": "Directory tree publication source changed before commit.",
  "source-conflict": "Directory tree publication source is not the declared closed candidate.",
  "destination-exists": "Directory tree publication destination already exists.",
  "cross-device": "Directory tree publication requires one filesystem device.",
  "commit-uncertain": "Directory tree publication commit result could not be proven exact.",
  "durability-failure": "Directory tree publication directory entries could not be synchronized.",
  "operation-failure": "Directory tree publication could not cross its commit point safely.",
  aborted: "Directory tree publication was aborted before commit.",
} as const satisfies Readonly<Record<
  DurableDirectoryTreePublicationErrorReason,
  string
>>;

/** 目录树整体发布失败时返回的稳定、脱敏错误。 */
export class DurableDirectoryTreePublicationError extends Error {
  override readonly name = "DurableDirectoryTreePublicationError";
  readonly code = "wakeflow-durable-directory-tree-publication" as const;
  readonly reason: DurableDirectoryTreePublicationErrorReason;
  readonly path: string;

  constructor(
    reason: DurableDirectoryTreePublicationErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedOptions {
  readonly signal: AbortSignal | undefined;
}

function fail(
  reason: DurableDirectoryTreePublicationErrorReason,
  path: string,
): never {
  throw new DurableDirectoryTreePublicationError(reason, path);
}

function plainRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", path);
    throw error;
  }
}

function parsePath(value: unknown, path: string): PortableResourcePath {
  try {
    return parsePortableResourcePath(value, path);
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) fail("input", path);
    throw error;
  }
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal;
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  const record = plainRecord(value, "$options");
  const unexpected = Object.keys(record).find((key) => key !== "signal");
  if (unexpected !== undefined) fail("input", `$options/${unexpected}`);
  const signal = record.signal;
  if (signal !== undefined && !isAbortSignal(signal)) {
    fail("input", "$options/signal");
  }
  return Object.freeze({ signal });
}

function parseExpectedNode(value: unknown): Readonly<FileNodeSnapshot> {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !Object.isFrozen(value)
  ) {
    fail("input", "$candidate/rootNode");
  }
  try {
    if (!sameFileNodeSnapshot(
      value as FileNodeSnapshot,
      value as FileNodeSnapshot,
    )) {
      fail("input", "$candidate/rootNode");
    }
  } catch (error: unknown) {
    if (error instanceof FileNodeSnapshotError) {
      fail("input", "$candidate/rootNode");
    }
    throw error;
  }
  const node = value as Readonly<FileNodeSnapshot>;
  if (node.kind !== "directory") fail("input", "$candidate/rootNode");
  return node;
}

function parseCandidate(
  value: unknown,
): Readonly<DirectoryTreeCandidateResult> {
  const record = plainRecord(value, "$candidate");
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 3
    || keys[0] !== "candidateRootPath"
    || keys[1] !== "plan"
    || keys[2] !== "rootNode"
  ) {
    fail("input", "$candidate");
  }
  return Object.freeze({
    candidateRootPath: parsePath(
      record.candidateRootPath,
      "$candidate/candidateRootPath",
    ),
    plan: parseDirectoryTreeCandidatePlan(record.plan),
    rootNode: parseExpectedNode(record.rootNode),
  });
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$signal");
}

function mapCandidateError(
  error: DurableDirectoryTreeCandidateError,
  afterCommit: boolean,
): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (afterCommit) fail("commit-uncertain", "$destinationResourcePath");
  if (error.reason === "source-changed") {
    fail("source-changed", "$sourceResourcePath");
  }
  fail("source-conflict", "$sourceResourcePath");
}

function mapRenameError(error: DurableResourceRenameError): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "destination-exists") {
    fail("destination-exists", "$destinationResourcePath");
  }
  if (error.reason === "cross-device") {
    fail("cross-device", "$destinationResourcePath");
  }
  if (
    error.reason === "source-not-found"
    || error.reason === "source-changed"
  ) {
    fail("source-changed", "$sourceResourcePath");
  }
  if (
    error.reason === "source-symlink"
    || error.reason === "source-not-supported"
  ) {
    fail("source-conflict", "$sourceResourcePath");
  }
  if (error.reason === "durability-failure") {
    fail("durability-failure", "$destinationResourcePath");
  }
  if (error.reason === "commit-uncertain") {
    fail("commit-uncertain", "$destinationResourcePath");
  }
  fail("operation-failure", "$destinationResourcePath");
}

/**
 * 在同一 `RootedDirectory` 内，将清单已闭合的候选目录树发布到尚不存在的最终路径。
 * 调用方必须持有同时覆盖源路径和目标路径的领域锁。
 */
export async function publishDirectoryTreeCandidateDurably(
  root: RootedDirectory,
  candidateValue: DirectoryTreeCandidateResult,
  destinationResourcePathValue: unknown,
  optionsValue: DurableDirectoryTreePublicationOptions = {},
): Promise<Readonly<DurableDirectoryTreePublicationResult>> {
  if (!(root instanceof RootedDirectory) || types.isProxy(root)) {
    fail("input", "$root");
  }
  const candidate = parseCandidate(candidateValue);
  const destinationResourcePath = parsePath(
    destinationResourcePathValue,
    "$destinationResourcePath",
  );
  const options = parseOptions(optionsValue);
  assertNotAborted(options.signal);

  let inspected;
  try {
    inspected = await inspectDirectoryTreeCandidate(
      root,
      candidate.candidateRootPath,
      candidate.plan,
      {
        expectedRootNode: candidate.rootNode,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      mapCandidateError(error, false);
    }
    throw error;
  }

  let moved;
  try {
    moved = await renameResourceDurably(
      root,
      candidate.candidateRootPath,
      destinationResourcePath,
      {
        expectedSourceNode: inspected.rootNode,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DurableResourceRenameError) mapRenameError(error);
    throw error;
  }
  if (moved.kind !== "directory") {
    fail("commit-uncertain", "$destinationResourcePath");
  }

  let finalInspection;
  try {
    finalInspection = await inspectDirectoryTreeCandidate(
      root,
      destinationResourcePath,
      candidate.plan,
      {
        expectedRootNode: moved.node,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      mapCandidateError(error, true);
    }
    throw error;
  }
  if (!sameFileNodeSnapshot(moved.node, finalInspection.rootNode)) {
    fail("commit-uncertain", "$destinationResourcePath");
  }
  return Object.freeze({
    sourceResourcePath: candidate.candidateRootPath,
    destinationResourcePath,
    plan: candidate.plan,
    rootNode: finalInspection.rootNode,
  });
}
