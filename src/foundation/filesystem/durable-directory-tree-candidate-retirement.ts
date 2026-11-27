import { type Fail, failWith, ModuleError } from "../error/module-error.js";
import { throwIfAborted } from "../node/abort-signal.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import {
  directoryTreeCandidateMaximumPathDepth,
  joinDirectoryTreeCandidatePath,
} from "./directory-tree-candidate-plan.js";
import {
  type DirectoryTreeCandidatePlan,
  type DirectoryTreeCandidateResult,
  DurableDirectoryTreeCandidateError,
  inspectDirectoryTreeCandidate,
  inspectDirectoryTreeCandidateProgress,
} from "./durable-directory-tree-candidate.js";
import {
  DurableResourceEntrySettlementError,
  settleObservedResourceEntry,
} from "./durable-resource-entry-settlement.js";
import {
  ExactRegularFileUnlinkError,
  unlinkRegularFileExactly,
} from "./exact-regular-file-unlink.js";
import { type FileNodeSnapshot, sameFileNodeIdentity } from "./file-node-snapshot.js";
import { filesystemMutation } from "./filesystem-mutation.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import { type RootedDirectory, RootedDirectoryError } from "./rooted-directory.js";
import {
  RootedExactResourceHandle,
  RootedExactResourceHandleError,
} from "./rooted-exact-resource-handle.js";
import {
  RootedResourceParentHandle,
  RootedResourceParentHandleError,
} from "./rooted-resource-parent-handle.js";
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
  | "close-failure";

/** 目录树candidate退休失败时的稳定、脱敏错误。 */
export class DurableDirectoryTreeCandidateRetirementError extends ModuleError<DurableDirectoryTreeCandidateRetirementErrorReason> {
  static override readonly code = "wakeflow-durable-directory-tree-candidate-retirement";
}

interface CapturedCandidateMembers {
  readonly rootNode: Readonly<FileNodeSnapshot>;
  readonly directories: ReadonlyMap<PortableResourcePath, FileNodeSnapshot>;
  readonly files: ReadonlyMap<PortableResourcePath, StableFileSource>;
  readonly missingDirectories: readonly PortableResourcePath[];
  readonly missingFiles: readonly PortableResourcePath[];
}

const fail: Fail<DurableDirectoryTreeCandidateRetirementErrorReason> = failWith(
  DurableDirectoryTreeCandidateRetirementError,
);

function mapCandidateError(error: DurableDirectoryTreeCandidateError): never {
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
      if (error.reason === "resource-path") fail("input", "$candidate", error);
      if (error.reason === "ancestor-symlink" || error.reason === "ancestor-type") {
        fail("candidate-conflict", "$candidate", error);
      }
      fail("root-scope", "$root", error);
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
    return await inspectDirectoryTreeCandidateProgress(root, candidateRootPath, plan, {
      ...(expectedRootNode === undefined ? {} : { expectedRootNode }),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      mapCandidateError(error);
    }
    throw error;
  }
}

async function inspectComplete(
  root: RootedDirectory,
  candidate: Readonly<DirectoryTreeCandidateResult>,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await inspectDirectoryTreeCandidate(root, candidate.candidateRootPath, candidate.plan, {
      expectedRootNode: candidate.rootNode,
      ...(signal === undefined ? {} : { signal }),
    });
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
  const progress = await inspectProgress(root, candidateRootPath, plan, undefined, signal);
  const missingDirectories = new Set(progress.missingDirectories);
  const missingFiles = new Set(progress.missingFiles);
  const directories = new Map<PortableResourcePath, FileNodeSnapshot>();
  const files = new Map<PortableResourcePath, StableFileSource>();

  for (const directory of plan.directories) {
    if (missingDirectories.has(directory)) continue;
    let inspected: Awaited<ReturnType<RootedDirectory["inspectExistingResource"]>>;
    try {
      inspected = await root.inspectExistingResource(
        memberPath(candidateRootPath, directory),
        "$candidate/directory",
      );
    } catch (error: unknown) {
      if (error instanceof RootedDirectoryError) {
        fail("source-changed", "$candidate/directory", error);
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
      read = await readStableFileDigest(root, memberPath(candidateRootPath, file.path), {
        maximumBytes: file.byteCount,
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error: unknown) {
      if (error instanceof StableFileReadError) {
        if (error.reason === "source-changed") {
          fail("source-changed", "$candidate/file", error);
        }
        fail("candidate-conflict", "$candidate/file", error);
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

  const confirmed = await inspectProgress(root, candidateRootPath, plan, progress.rootNode, signal);
  if (
    confirmed.missingDirectories.length !== progress.missingDirectories.length ||
    confirmed.missingFiles.length !== progress.missingFiles.length ||
    confirmed.missingDirectories.some(
      (entry, index) => entry !== progress.missingDirectories[index],
    ) ||
    confirmed.missingFiles.some((entry, index) => entry !== progress.missingFiles[index])
  ) {
    fail("source-changed", "$candidate");
  }
  throwIfAborted(signal);
  return Object.freeze({
    rootNode: confirmed.rootNode,
    directories,
    files,
    missingDirectories: confirmed.missingDirectories,
    missingFiles: confirmed.missingFiles,
  });
}

function mapFileUnlinkError(error: ExactRegularFileUnlinkError): never {
  if (error.reason === "durability-failure") {
    fail("durability-failure", "$candidate/file");
  }
  if (error.reason === "commit-uncertain" || error.reason === "close-failure") {
    fail("commit-uncertain", "$candidate/file");
  }
  if (error.reason === "source-changed" || error.reason === "source-not-found") {
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
    throwIfAborted(signal);
    try {
      await unlinkRegularFileExactly(root, memberPath(candidateRootPath, file.path), {
        expectedNode: captured.node,
        ...(signal === undefined ? {} : { signal }),
      });
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

function mapParentError(error: RootedResourceParentHandleError, afterCommit: boolean): never {
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

/**
 * 精确删除一个空目录：节点身份、模式与路径都要对得上，非空（`ENOTEMPTY`）报 `candidate-conflict`，
 * 已消失报 `source-changed`。候选树退役与 hook 目录的空分片回收共用（gate-log §13.161）；后者按
 * `durability: "none"` 调用——尽力而为的回收不为每个目录付一次父目录 fsync，崩溃后重现的空目录下次再收。
 */
export async function removeEmptyDirectoryExactly(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  expectedIdentity: Readonly<FileNodeSnapshot>,
  expectedMode: number,
  signal: AbortSignal | undefined,
  durability: "fsync" | "none" = "fsync",
): Promise<void> {
  let current: Awaited<ReturnType<RootedDirectory["inspectExistingResource"]>>;
  try {
    current = await root.inspectExistingResource(resourcePath, "$directory");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      fail("source-changed", "$candidate/directory", error);
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
    parent = await RootedResourceParentHandle.open(root, resourcePath, "$directory");
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
    throwIfAborted(signal);
    try {
      await filesystemMutation.rmdir(parent.resourceAbsolutePath);
    } catch (error: unknown) {
      const code = readNodeSystemErrorCode(error);
      if (code === "ENOTEMPTY" || code === "EEXIST") {
        fail("candidate-conflict", "$candidate/directory", error);
      }
      if (code === "ENOENT") fail("source-changed", "$candidate/directory", error);
      fail("retirement-failure", "$candidate/directory", error);
    }
    committed = true;
    if ((await parent.inspectTarget()) !== null) {
      fail("commit-uncertain", "$candidate/directory");
    }
    const opened = await source.inspectOpenedNode();
    if (opened.kind !== "directory" || !sameFileNodeIdentity(opened, current.node)) {
      fail("commit-uncertain", "$candidate/directory");
    }
    if (durability === "fsync") {
      await parent.sync();
      if ((await parent.inspectTarget()) !== null) {
        fail("commit-uncertain", "$candidate/directory");
      }
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
    throwIfAborted(signal);
    await removeEmptyDirectoryExactly(
      root,
      memberPath(candidateRootPath, directory),
      expected,
      plan.directoryMode,
      signal,
    );
    retired += 1;
  }
  throwIfAborted(signal);
  await removeEmptyDirectoryExactly(
    root,
    candidateRootPath,
    captured.rootNode,
    plan.directoryMode,
    signal,
  );
  return retired + 1;
}

/** 候选根"已经不在"这个观察落盘：同步它的父目录，前后各核对一次它仍然不在。 */
async function settleAbsentCandidate(
  root: RootedDirectory,
  candidateRootPath: PortableResourcePath,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await settleObservedResourceEntry(root, candidateRootPath, "absent", {
      errorPath: "$candidate",
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (!(error instanceof DurableResourceEntrySettlementError)) throw error;
    if (error.reason === "observation-changed") fail("source-changed", "$candidate", error);
    fail("durability-failure", "$candidate", error);
  }
}

async function settleRetirement(
  root: RootedDirectory,
  candidateRootPath: PortableResourcePath,
  plan: Readonly<DirectoryTreeCandidatePlan>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DirectoryTreeCandidateRetirementReceipt>> {
  if (!(await candidateExists(root, candidateRootPath))) {
    // 沿用"已经不在"之前先落盘（1.4.1 段 1b）：上一次退休可能死在删掉候选根与同步它的父目录之间，
    // 调用方拿到 absent 之后会去删别的目录里的恢复记录。
    await settleAbsentCandidate(root, candidateRootPath, signal);
    return Object.freeze({
      disposition: "absent",
      candidateRootPath,
      plan,
      retiredFileCount: 0,
      retiredDirectoryCount: 0,
    });
  }
  const captured = await captureMembers(root, candidateRootPath, plan, signal);
  const retiredFileCount = await retireFiles(root, candidateRootPath, plan, captured.files, signal);
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
 * 首次退休一棵完整candidate。缺失、部分或冲突candidate在任何删除前拒绝。候选是本层签发的结果，
 * 不再复验：删除前按它的根节点与计划重新观察整棵树。
 */
export async function retireDirectoryTreeCandidateDurably(
  root: RootedDirectory,
  candidate: Readonly<DirectoryTreeCandidateResult>,
  options: DirectoryTreeCandidateRetirementOptions = {},
): Promise<Readonly<DirectoryTreeCandidateRetirementReceipt>> {
  const { signal } = options;
  throwIfAborted(signal);
  await inspectComplete(root, candidate, signal);
  const receipt = await settleRetirement(root, candidate.candidateRootPath, candidate.plan, signal);
  if (receipt.disposition !== "retired") {
    fail("source-changed", "$candidate");
  }
  return receipt;
}

/**
 * 在领域journal授权下续接同一计划的部分退休；目标缺失只返回`absent`观察。计划来自日志读取方
 * 对磁盘文档的解析，路径与计划都不再复验；候选根的物理检查在续接本身里。
 */
export async function settleDirectoryTreeCandidateRetirement(
  root: RootedDirectory,
  candidateRootPath: PortableResourcePath,
  plan: Readonly<DirectoryTreeCandidatePlan>,
  options: DirectoryTreeCandidateRetirementOptions = {},
): Promise<Readonly<DirectoryTreeCandidateRetirementReceipt>> {
  const { signal } = options;
  throwIfAborted(signal);
  return settleRetirement(root, candidateRootPath, plan, signal);
}
