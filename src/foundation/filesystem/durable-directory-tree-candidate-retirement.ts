import { rmdir } from "node:fs/promises";
import { types } from "node:util";

import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import {
  inspectDirectoryTreeCandidate,
  inspectDirectoryTreeCandidateProgress,
  parseDirectoryTreeCandidatePlan,
  DurableDirectoryTreeCandidateError,
  type DirectoryTreeCandidatePlan,
  type DirectoryTreeCandidateResult,
} from "./durable-directory-tree-candidate.js";
import {
  joinDirectoryTreeCandidatePath,
  directoryTreeCandidateMaximumPathDepth,
} from "./directory-tree-candidate-plan.js";
import {
  sameFileNodeIdentity,
  sameFileNodeSnapshot,
  FileNodeSnapshotError,
  type FileNodeSnapshot,
} from "./file-node-snapshot.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "./portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError } from "./rooted-directory.js";
import {
  RootedExactResourceHandle,
  RootedExactResourceHandleError,
} from "./rooted-exact-resource-handle.js";
import {
  RootedResourceParentHandle,
  RootedResourceParentHandleError,
} from "./rooted-resource-parent-handle.js";
import {
  unlinkRegularFileExactly,
  ExactRegularFileUnlinkError,
} from "./exact-regular-file-unlink.js";
import {
  readStableFileDigest,
  StableFileReadError,
  type StableFileSource,
} from "./stable-file-read.js";

/**
 * Wakeflow Foundation / Filesystem：已关闭目录树candidate的精确、可续接退休。
 *
 * 首次入口只接受完整`DirectoryTreeCandidateResult`，在删除前再次复验整树。恢复入口
 * 接受同一candidate路径与原计划，只允许当前树是该计划的安全子集；缺失成员解释为
 * 已退休前缀，未知、替换或内容漂移节点一律拒绝。普通文件逐个稳定散列并按精确inode
 * 删除，目录按最深优先只执行空目录`rmdir`，最后同步每个父目录。
 *
 * 本模块不接受recursive rm、不选择业务stage/final路径、不删除符号链接或特殊节点、
 * 不清理计划外资源，也不判断Event是否已经提交。领域owner必须用耐久journal证明
 * recovery入口只针对Event前已授权退休的candidate。
 */

export interface DirectoryTreeCandidateRetirementOptions {
  readonly signal?: AbortSignal;
}

export interface DirectoryTreeCandidateRetirementReceipt {
  readonly disposition: "absent" | "retired";
  readonly candidateRootPath: PortableResourcePath;
  readonly plan: Readonly<DirectoryTreeCandidatePlan>;
  readonly retiredFileCount: number;
  /** 包含candidate root自身。 */
  readonly retiredDirectoryCount: number;
}

export type DurableDirectoryTreeCandidateRetirementErrorReason =
  | "input"
  | "root-scope"
  | "candidate-conflict"
  | "source-changed"
  | "retirement-failure"
  | "commit-uncertain"
  | "durability-failure"
  | "aborted"
  | "close-failure";

const ERROR_MESSAGES = {
  input: "Directory tree candidate retirement input is invalid.",
  "root-scope": "Directory tree candidate retirement lost its root scope.",
  "candidate-conflict":
    "Directory tree candidate retirement found a non-closed or unknown resource.",
  "source-changed":
    "Directory tree candidate retirement source changed before removal.",
  "retirement-failure":
    "Directory tree candidate retirement could not remove an exact member.",
  "commit-uncertain":
    "Directory tree candidate retirement result could not be proven exact.",
  "durability-failure":
    "Directory tree candidate retirement could not synchronize its directory entries.",
  aborted:
    "Directory tree candidate retirement was aborted before a commit point.",
  "close-failure":
    "Directory tree candidate retirement could not close an exact handle.",
} as const satisfies Readonly<
  Record<DurableDirectoryTreeCandidateRetirementErrorReason, string>
>;

/** 目录树candidate退休失败时的稳定、脱敏错误。 */
export class DurableDirectoryTreeCandidateRetirementError extends Error {
  override readonly name = "DurableDirectoryTreeCandidateRetirementError";
  readonly code =
    "wakeflow-durable-directory-tree-candidate-retirement" as const;
  readonly reason: DurableDirectoryTreeCandidateRetirementErrorReason;
  readonly path: string;

  constructor(
    reason: DurableDirectoryTreeCandidateRetirementErrorReason,
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

interface ParsedCandidate {
  readonly candidateRootPath: PortableResourcePath;
  readonly plan: Readonly<DirectoryTreeCandidatePlan>;
  readonly rootNode: Readonly<FileNodeSnapshot>;
}

interface CapturedCandidateMembers {
  readonly rootNode: Readonly<FileNodeSnapshot>;
  readonly directories: ReadonlyMap<PortableResourcePath, FileNodeSnapshot>;
  readonly files: ReadonlyMap<PortableResourcePath, StableFileSource>;
  readonly missingDirectories: readonly PortableResourcePath[];
  readonly missingFiles: readonly PortableResourcePath[];
}

function fail(
  reason: DurableDirectoryTreeCandidateRetirementErrorReason,
  path: string,
): never {
  throw new DurableDirectoryTreeCandidateRetirementError(reason, path);
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    !(value instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === "object" &&
    value !== null &&
    !types.isProxy(value) &&
    value instanceof AbortSignal
  );
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (
    Object.keys(record).some((key) => key !== "signal") ||
    (record.signal !== undefined && !isAbortSignal(record.signal))
  ) {
    fail("input", "$options");
  }
  return Object.freeze({ signal: record.signal as AbortSignal | undefined });
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$signal");
}

function parsePath(value: unknown): PortableResourcePath {
  try {
    return parsePortableResourcePath(value, "$candidateRootPath");
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      fail("input", "$candidateRootPath");
    }
    throw error;
  }
}

function parseRootNode(value: unknown): Readonly<FileNodeSnapshot> {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    !Object.isFrozen(value)
  ) {
    fail("input", "$candidate/rootNode");
  }
  try {
    if (
      !sameFileNodeSnapshot(
        value as FileNodeSnapshot,
        value as FileNodeSnapshot,
      )
    ) {
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

function parseCandidate(value: unknown): Readonly<ParsedCandidate> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$candidate");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$candidate");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "candidateRootPath" ||
    keys[1] !== "plan" ||
    keys[2] !== "rootNode"
  ) {
    fail("input", "$candidate");
  }
  let plan: Readonly<DirectoryTreeCandidatePlan>;
  try {
    plan = parseDirectoryTreeCandidatePlan(record.plan);
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      fail("input", "$candidate/plan");
    }
    throw error;
  }
  return Object.freeze({
    candidateRootPath: parsePath(record.candidateRootPath),
    plan,
    rootNode: parseRootNode(record.rootNode),
  });
}

function parseRecoveryInput(
  candidateRootPathValue: unknown,
  planValue: unknown,
): Readonly<Pick<ParsedCandidate, "candidateRootPath" | "plan">> {
  const candidateRootPath = parsePath(candidateRootPathValue);
  let plan: Readonly<DirectoryTreeCandidatePlan>;
  try {
    plan = parseDirectoryTreeCandidatePlan(planValue);
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      fail("input", "$plan");
    }
    throw error;
  }
  return Object.freeze({ candidateRootPath, plan });
}

function mapCandidateError(error: DurableDirectoryTreeCandidateError): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "source-changed") {
    fail("source-changed", "$candidate");
  }
  if (error.reason === "input") fail("input", error.path);
  fail("candidate-conflict", "$candidate");
}

async function candidateExists(
  root: RootedDirectory,
  candidateRootPath: PortableResourcePath,
): Promise<boolean> {
  try {
    await root.inspectExistingResource(candidateRootPath, "$candidate");
    return true;
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      if (error.reason === "resource-not-found") return false;
      if (error.reason === "resource-path") fail("input", "$candidate");
      if (
        error.reason === "ancestor-symlink" ||
        error.reason === "ancestor-type"
      ) {
        fail("candidate-conflict", "$candidate");
      }
      fail("root-scope", "$root");
    }
    throw error;
  }
}

async function inspectProgress(
  root: RootedDirectory,
  candidateRootPath: PortableResourcePath,
  plan: Readonly<DirectoryTreeCandidatePlan>,
  expectedRootNode: Readonly<FileNodeSnapshot> | undefined,
  signal: AbortSignal | undefined,
) {
  try {
    return await inspectDirectoryTreeCandidateProgress(
      root,
      candidateRootPath,
      plan,
      {
        ...(expectedRootNode === undefined ? {} : { expectedRootNode }),
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      mapCandidateError(error);
    }
    throw error;
  }
}

async function inspectComplete(
  root: RootedDirectory,
  candidate: Readonly<ParsedCandidate>,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await inspectDirectoryTreeCandidate(
      root,
      candidate.candidateRootPath,
      candidate.plan,
      {
        expectedRootNode: candidate.rootNode,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      mapCandidateError(error);
    }
    throw error;
  }
}

function memberPath(
  candidateRootPath: PortableResourcePath,
  relativePath: PortableResourcePath,
): PortableResourcePath {
  return joinDirectoryTreeCandidatePath(candidateRootPath, relativePath);
}

async function captureMembers(
  root: RootedDirectory,
  candidateRootPath: PortableResourcePath,
  plan: Readonly<DirectoryTreeCandidatePlan>,
  signal: AbortSignal | undefined,
): Promise<Readonly<CapturedCandidateMembers>> {
  const progress = await inspectProgress(
    root,
    candidateRootPath,
    plan,
    undefined,
    signal,
  );
  const missingDirectories = new Set(progress.missingDirectories);
  const missingFiles = new Set(progress.missingFiles);
  const directories = new Map<PortableResourcePath, FileNodeSnapshot>();
  const files = new Map<PortableResourcePath, StableFileSource>();

  for (const directory of plan.directories) {
    if (missingDirectories.has(directory)) continue;
    let inspected;
    try {
      inspected = await root.inspectExistingResource(
        memberPath(candidateRootPath, directory),
        "$candidate/directory",
      );
    } catch (error: unknown) {
      if (error instanceof RootedDirectoryError) {
        fail("source-changed", "$candidate/directory");
      }
      throw error;
    }
    if (
      inspected.node.kind !== "directory" ||
      inspected.node.permissionBits !== plan.directoryMode
    ) {
      fail("candidate-conflict", "$candidate/directory");
    }
    directories.set(directory, inspected.node);
  }

  for (const file of plan.files) {
    if (missingFiles.has(file.path)) continue;
    let read: Readonly<StableFileSource>;
    try {
      read = await readStableFileDigest(
        root,
        memberPath(candidateRootPath, file.path),
        {
          maximumBytes: file.byteCount,
          ...(signal === undefined ? {} : { signal }),
        },
      );
    } catch (error: unknown) {
      if (error instanceof StableFileReadError) {
        if (error.reason === "aborted") fail("aborted", "$signal");
        if (error.reason === "source-changed") {
          fail("source-changed", "$candidate/file");
        }
        fail("candidate-conflict", "$candidate/file");
      }
      throw error;
    }
    if (
      read.byteCount !== file.byteCount ||
      read.digest !== file.digest ||
      read.node.permissionBits !== file.mode ||
      read.node.linkCount !== 1n
    ) {
      fail("candidate-conflict", "$candidate/file");
    }
    files.set(file.path, read);
  }

  const confirmed = await inspectProgress(
    root,
    candidateRootPath,
    plan,
    progress.rootNode,
    signal,
  );
  if (
    confirmed.missingDirectories.length !==
      progress.missingDirectories.length ||
    confirmed.missingFiles.length !== progress.missingFiles.length ||
    confirmed.missingDirectories.some(
      (entry, index) => entry !== progress.missingDirectories[index],
    ) ||
    confirmed.missingFiles.some(
      (entry, index) => entry !== progress.missingFiles[index],
    )
  ) {
    fail("source-changed", "$candidate");
  }
  assertNotAborted(signal);
  return Object.freeze({
    rootNode: confirmed.rootNode,
    directories,
    files,
    missingDirectories: confirmed.missingDirectories,
    missingFiles: confirmed.missingFiles,
  });
}

function mapFileUnlinkError(error: ExactRegularFileUnlinkError): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "durability-failure") {
    fail("durability-failure", "$candidate/file");
  }
  if (error.reason === "commit-uncertain" || error.reason === "close-failure") {
    fail("commit-uncertain", "$candidate/file");
  }
  if (
    error.reason === "source-changed" ||
    error.reason === "source-not-found"
  ) {
    fail("source-changed", "$candidate/file");
  }
  if (error.reason === "root-scope" || error.reason === "parent-changed") {
    fail("root-scope", "$root");
  }
  fail("candidate-conflict", "$candidate/file");
}

async function retireFiles(
  root: RootedDirectory,
  candidateRootPath: PortableResourcePath,
  plan: Readonly<DirectoryTreeCandidatePlan>,
  files: ReadonlyMap<PortableResourcePath, StableFileSource>,
  signal: AbortSignal | undefined,
): Promise<number> {
  let retired = 0;
  for (const file of [...plan.files].reverse()) {
    const captured = files.get(file.path);
    if (captured === undefined) continue;
    assertNotAborted(signal);
    try {
      await unlinkRegularFileExactly(
        root,
        memberPath(candidateRootPath, file.path),
        {
          expectedNode: captured.node,
          ...(signal === undefined ? {} : { signal }),
        },
      );
    } catch (error: unknown) {
      if (error instanceof ExactRegularFileUnlinkError) {
        mapFileUnlinkError(error);
      }
      throw error;
    }
    retired += 1;
  }
  return retired;
}

function mapParentError(
  error: RootedResourceParentHandleError,
  afterCommit: boolean,
): never {
  if (error.reason === "sync-failure") {
    fail("durability-failure", "$candidate/directory");
  }
  if (afterCommit || error.reason === "close-failure") {
    fail("commit-uncertain", "$candidate/directory");
  }
  if (error.reason === "root-scope" || error.reason === "parent-changed") {
    fail("root-scope", "$root");
  }
  fail("candidate-conflict", "$candidate/directory");
}

function mapDirectoryHandleError(
  error: RootedExactResourceHandleError,
  afterCommit: boolean,
): never {
  if (afterCommit || error.reason === "close-failure") {
    fail("commit-uncertain", "$candidate/directory");
  }
  if (error.reason === "root-scope") fail("root-scope", "$root");
  if (error.reason === "resource-changed") {
    fail("source-changed", "$candidate/directory");
  }
  fail("candidate-conflict", "$candidate/directory");
}

async function removeEmptyDirectoryExactly(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  expectedIdentity: Readonly<FileNodeSnapshot>,
  expectedMode: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  let current;
  try {
    current = await root.inspectExistingResource(resourcePath, "$directory");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      fail("source-changed", "$candidate/directory");
    }
    throw error;
  }
  if (
    current.node.kind !== "directory" ||
    current.node.permissionBits !== expectedMode ||
    !sameFileNodeIdentity(current.node, expectedIdentity)
  ) {
    fail("source-changed", "$candidate/directory");
  }

  let parent: RootedResourceParentHandle;
  try {
    parent = await RootedResourceParentHandle.open(
      root,
      resourcePath,
      "$directory",
    );
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      mapParentError(error, false);
    }
    throw error;
  }
  let source: RootedExactResourceHandle | undefined;
  let committed = false;
  let primaryError: unknown;
  try {
    source = await RootedExactResourceHandle.openFileOrDirectory(
      root,
      resourcePath,
      current.node,
      "$directory",
    );
    if (
      source.kind !== "directory" ||
      source.resourceAbsolutePath !== parent.resourceAbsolutePath
    ) {
      fail("root-scope", "$root");
    }
    await parent.assertCurrent();
    await source.assertPathCurrent();
    assertNotAborted(signal);
    try {
      await rmdir(parent.resourceAbsolutePath);
    } catch (error: unknown) {
      const code = readNodeSystemErrorCode(error);
      if (code === "ENOTEMPTY" || code === "EEXIST") {
        fail("candidate-conflict", "$candidate/directory");
      }
      if (code === "ENOENT") fail("source-changed", "$candidate/directory");
      fail("retirement-failure", "$candidate/directory");
    }
    committed = true;
    if ((await parent.inspectTarget()) !== null) {
      fail("commit-uncertain", "$candidate/directory");
    }
    const opened = await source.inspectOpenedNode();
    if (
      opened.kind !== "directory" ||
      !sameFileNodeIdentity(opened, current.node)
    ) {
      fail("commit-uncertain", "$candidate/directory");
    }
    await parent.sync();
    if ((await parent.inspectTarget()) !== null) {
      fail("commit-uncertain", "$candidate/directory");
    }
  } catch (error: unknown) {
    primaryError = error;
  }

  if (source !== undefined) {
    try {
      await source.close();
    } catch (error: unknown) {
      if (primaryError === undefined) {
        primaryError =
          error instanceof RootedExactResourceHandleError
            ? new DurableDirectoryTreeCandidateRetirementError(
                committed ? "commit-uncertain" : "close-failure",
                "$candidate/directory",
              )
            : error;
      }
    }
  }
  try {
    await parent.close();
  } catch (error: unknown) {
    if (primaryError === undefined) {
      primaryError =
        error instanceof RootedResourceParentHandleError
          ? new DurableDirectoryTreeCandidateRetirementError(
              committed ? "commit-uncertain" : "close-failure",
              "$candidate/directory",
            )
          : error;
    }
  }
  if (primaryError instanceof RootedResourceParentHandleError) {
    mapParentError(primaryError, committed);
  }
  if (primaryError instanceof RootedExactResourceHandleError) {
    mapDirectoryHandleError(primaryError, committed);
  }
  if (primaryError !== undefined) throw primaryError;
  if (!committed) fail("commit-uncertain", "$candidate/directory");
}

function deepestFirst(
  directories: readonly PortableResourcePath[],
): readonly PortableResourcePath[] {
  return Object.freeze(
    [...directories].sort((left, right) => {
      const depthDifference =
        directoryTreeCandidateMaximumPathDepth([right], []) -
        directoryTreeCandidateMaximumPathDepth([left], []);
      if (depthDifference !== 0) return depthDifference;
      return left < right ? 1 : left > right ? -1 : 0;
    }),
  );
}

async function retireDirectories(
  root: RootedDirectory,
  candidateRootPath: PortableResourcePath,
  plan: Readonly<DirectoryTreeCandidatePlan>,
  captured: Readonly<CapturedCandidateMembers>,
  signal: AbortSignal | undefined,
): Promise<number> {
  let retired = 0;
  for (const directory of deepestFirst(plan.directories)) {
    const expected = captured.directories.get(directory);
    if (expected === undefined) continue;
    assertNotAborted(signal);
    await removeEmptyDirectoryExactly(
      root,
      memberPath(candidateRootPath, directory),
      expected,
      plan.directoryMode,
      signal,
    );
    retired += 1;
  }
  assertNotAborted(signal);
  await removeEmptyDirectoryExactly(
    root,
    candidateRootPath,
    captured.rootNode,
    plan.directoryMode,
    signal,
  );
  return retired + 1;
}

async function settleRetirement(
  root: RootedDirectory,
  candidateRootPath: PortableResourcePath,
  plan: Readonly<DirectoryTreeCandidatePlan>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DirectoryTreeCandidateRetirementReceipt>> {
  if (!(await candidateExists(root, candidateRootPath))) {
    return Object.freeze({
      disposition: "absent",
      candidateRootPath,
      plan,
      retiredFileCount: 0,
      retiredDirectoryCount: 0,
    });
  }
  const captured = await captureMembers(root, candidateRootPath, plan, signal);
  const retiredFileCount = await retireFiles(
    root,
    candidateRootPath,
    plan,
    captured.files,
    signal,
  );
  const retiredDirectoryCount = await retireDirectories(
    root,
    candidateRootPath,
    plan,
    captured,
    signal,
  );
  if (await candidateExists(root, candidateRootPath)) {
    fail("commit-uncertain", "$candidate");
  }
  return Object.freeze({
    disposition: "retired",
    candidateRootPath,
    plan,
    retiredFileCount,
    retiredDirectoryCount,
  });
}

/**
 * 首次退休一棵完整candidate。缺失、部分或冲突candidate在任何删除前拒绝。
 */
export async function retireDirectoryTreeCandidateDurably(
  rootValue: RootedDirectory,
  candidateValue: DirectoryTreeCandidateResult,
  optionsValue: DirectoryTreeCandidateRetirementOptions = {},
): Promise<Readonly<DirectoryTreeCandidateRetirementReceipt>> {
  assertRoot(rootValue);
  const options = parseOptions(optionsValue);
  assertNotAborted(options.signal);
  const candidate = parseCandidate(candidateValue);
  await inspectComplete(rootValue, candidate, options.signal);
  const receipt = await settleRetirement(
    rootValue,
    candidate.candidateRootPath,
    candidate.plan,
    options.signal,
  );
  if (receipt.disposition !== "retired") {
    fail("source-changed", "$candidate");
  }
  return receipt;
}

/**
 * 在领域journal授权下续接同一计划的部分退休；目标缺失只返回`absent`观察。
 */
export async function settleDirectoryTreeCandidateRetirement(
  rootValue: RootedDirectory,
  candidateRootPathValue: PortableResourcePath,
  planValue: DirectoryTreeCandidatePlan,
  optionsValue: DirectoryTreeCandidateRetirementOptions = {},
): Promise<Readonly<DirectoryTreeCandidateRetirementReceipt>> {
  assertRoot(rootValue);
  const options = parseOptions(optionsValue);
  assertNotAborted(options.signal);
  const input = parseRecoveryInput(candidateRootPathValue, planValue);
  return settleRetirement(
    rootValue,
    input.candidateRootPath,
    input.plan,
    options.signal,
  );
}
