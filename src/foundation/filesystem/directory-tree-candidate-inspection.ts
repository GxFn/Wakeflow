import { Buffer } from "node:buffer";

import { throwIfAborted } from "../node/abort-signal.js";
import { parseByteCount } from "../numeric/byte-count.js";
import {
  type DirectoryTreeCandidatePlan,
  type DirectoryTreeCandidateProgress,
  type DirectoryTreeCandidateResult,
  directoryTreeCandidateMaximumPathDepth,
  throwDirectoryTreeCandidateError as fail,
  type InspectDirectoryTreeCandidateOptions,
  type PreparedDirectoryTreeCandidate,
  parseDirectoryTreeCandidatePath,
} from "./directory-tree-candidate-plan.js";
import {
  BoundedDirectoryTreeScanError,
  scanBoundedResourceDirectoryTree,
} from "./bounded-directory-tree-scan.js";
import { type FileNodeSnapshot, sameFileNodeIdentity } from "./file-node-snapshot.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import type { RootedDirectory } from "./rooted-directory.js";
import { readStableFile, StableFileReadError } from "./stable-file-read.js";
import {
  readStableResourceTree,
  StableResourceTreeReadError,
} from "./stable-resource-tree-read.js";

/**
 * Wakeflow Foundation / Filesystem：目录树候选的稳定进度检查与清单闭合验证。
 *
 * 进度检查与闭合验证读取并比对每个成员的字节：它们供恢复路径和上层检查遗留候选，
 * 读内容是有意的。刚由本进程创建完的候选改用 `inspectCreatedDirectoryTreeCandidate`：
 * 只按元数据核对清单闭合（条目集合、权限位、链接数、大小与创建时记下的节点身份），
 * 不回读成员内容。
 */

function inspectionLimits(plan: Readonly<DirectoryTreeCandidatePlan>) {
  let largestFile = 0;
  for (const file of plan.files) {
    largestFile = Math.max(largestFile, file.byteCount);
  }
  return Object.freeze({
    maximumEntries: plan.directories.length + plan.files.length,
    maximumDepth: directoryTreeCandidateMaximumPathDepth(plan.directories, plan.files),
    maximumFiles: plan.files.length,
    maximumFileBytes: parseByteCount(largestFile, "$plan/maximumFileBytes"),
    maximumTotalBytes: plan.totalBytes,
  });
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return Buffer.from(left.buffer, left.byteOffset, left.byteLength).equals(
    Buffer.from(right.buffer, right.byteOffset, right.byteLength),
  );
}

function relativeFromCandidate(
  candidateRootPath: PortableResourcePath,
  resourcePath: PortableResourcePath,
): PortableResourcePath {
  const prefix = `${candidateRootPath}/`;
  if (!resourcePath.startsWith(prefix)) fail("tree-conflict", "$candidate");
  return parseDirectoryTreeCandidatePath(
    resourcePath.slice(prefix.length),
    "$candidate/resourcePath",
  );
}

async function readCandidateTree(
  root: RootedDirectory,
  candidateRootPath: PortableResourcePath,
  plan: Readonly<DirectoryTreeCandidatePlan>,
  expectedRootNode: Readonly<FileNodeSnapshot> | undefined,
  signal: AbortSignal | undefined,
) {
  try {
    return await readStableResourceTree(root, candidateRootPath, {
      ...inspectionLimits(plan),
      ...(expectedRootNode === undefined ? {} : { expectedNode: expectedRootNode }),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableResourceTreeReadError) {
      if (error.reason === "source-changed") {
        fail("source-changed", "$candidate");
      }
      fail("tree-conflict", "$candidate");
    }
    throw error;
  }
}

/**
 * 稳定判断候选目录是计划的安全子集，还是已经达到清单闭合状态。
 *
 * 计划与候选根路径都是类型化的（由计划器生成，或由日志读取方从磁盘解析），不再复验；稳定读取
 * 目录树时文件系统原语自己核对路径。
 */
export async function inspectDirectoryTreeCandidateProgress(
  root: RootedDirectory,
  candidateRootPath: PortableResourcePath,
  plan: Readonly<DirectoryTreeCandidatePlan>,
  options: InspectDirectoryTreeCandidateOptions = {},
): Promise<Readonly<DirectoryTreeCandidateProgress>> {
  const { expectedRootNode, signal } = options;
  throwIfAborted(signal);
  const tree = await readCandidateTree(root, candidateRootPath, plan, expectedRootNode, signal);
  if (
    tree.treeRootNode.kind !== "directory" ||
    tree.treeRootNode.permissionBits !== plan.directoryMode
  ) {
    fail("tree-conflict", "$candidate");
  }
  const expectedDirectories = new Set(plan.directories);
  const expectedFiles = new Map(plan.files.map((file) => [file.path, file]));
  const observedDirectories = new Set<PortableResourcePath>();
  const observedFiles = new Set<PortableResourcePath>();
  for (const entry of tree.entries) {
    const relative = relativeFromCandidate(candidateRootPath, entry.resourcePath);
    if (entry.node.kind === "directory") {
      if (!expectedDirectories.has(relative) || entry.node.permissionBits !== plan.directoryMode) {
        fail("tree-conflict", "$candidate");
      }
      observedDirectories.add(relative);
      continue;
    }
    const expected = expectedFiles.get(relative);
    if (
      expected === undefined ||
      entry.node.kind !== "file" ||
      entry.node.permissionBits !== expected.mode ||
      entry.node.linkCount !== 1n
    ) {
      fail("tree-conflict", "$candidate");
    }
    observedFiles.add(relative);
  }
  for (const file of tree.files) {
    const relative = relativeFromCandidate(candidateRootPath, file.resourcePath);
    const expected = expectedFiles.get(relative);
    if (
      expected === undefined ||
      file.byteCount !== expected.byteCount ||
      file.digest !== expected.digest ||
      file.node.permissionBits !== expected.mode ||
      file.node.linkCount !== 1n
    ) {
      fail("tree-conflict", "$candidate");
    }
  }
  const missingDirectories = Object.freeze(
    plan.directories.filter((directory) => !observedDirectories.has(directory)),
  );
  const missingFiles = Object.freeze(
    plan.files.filter((file) => !observedFiles.has(file.path)).map((file) => file.path),
  );
  const complete = missingDirectories.length === 0 && missingFiles.length === 0;
  if (
    complete &&
    (tree.entries.length !== plan.directories.length + plan.files.length ||
      tree.files.length !== plan.files.length ||
      tree.totalFileBytes !== plan.totalBytes)
  ) {
    fail("tree-conflict", "$candidate");
  }
  throwIfAborted(signal);
  return Object.freeze({
    candidateRootPath,
    plan,
    rootNode: tree.treeRootNode,
    status: complete ? "complete" : "incomplete",
    missingDirectories,
    missingFiles,
  });
}

/** 稳定读取候选目录，并证明实际目录项与持久化计划完全一致。 */
export async function inspectDirectoryTreeCandidate(
  root: RootedDirectory,
  candidateRootPath: PortableResourcePath,
  plan: Readonly<DirectoryTreeCandidatePlan>,
  options: InspectDirectoryTreeCandidateOptions = {},
): Promise<Readonly<DirectoryTreeCandidateResult>> {
  const progress = await inspectDirectoryTreeCandidateProgress(
    root,
    candidateRootPath,
    plan,
    options,
  );
  if (progress.status !== "complete") fail("tree-conflict", "$candidate");
  return Object.freeze({
    candidateRootPath: progress.candidateRootPath,
    plan: progress.plan,
    rootNode: progress.rootNode,
  });
}

/**
 * 不读成员内容地证明刚创建完的候选清单闭合。
 *
 * `createdFiles` 是创建时从句柄与路径复验得到的成员节点；每个文件必须仍是同一节点、
 * 同一大小与权限位且只有一个链接，目录集合与权限位必须与计划一致，不得有多余条目。
 */
export async function inspectCreatedDirectoryTreeCandidate(
  root: RootedDirectory,
  candidateRootPath: PortableResourcePath,
  plan: Readonly<DirectoryTreeCandidatePlan>,
  createdFiles: ReadonlyMap<PortableResourcePath, Readonly<FileNodeSnapshot>>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DirectoryTreeCandidateResult>> {
  const limits = inspectionLimits(plan);
  let tree: Awaited<ReturnType<typeof scanBoundedResourceDirectoryTree>>;
  try {
    tree = await scanBoundedResourceDirectoryTree(root, candidateRootPath, {
      maximumEntries: limits.maximumEntries,
      maximumDepth: limits.maximumDepth,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof BoundedDirectoryTreeScanError) {
      if (error.reason === "source-changed") fail("source-changed", "$candidate");
      fail("tree-conflict", "$candidate");
    }
    throw error;
  }
  if (
    tree.treeRootNode.kind !== "directory" ||
    tree.treeRootNode.permissionBits !== plan.directoryMode ||
    tree.entries.length !== plan.directories.length + plan.files.length
  ) {
    fail("tree-conflict", "$candidate");
  }
  const expectedDirectories = new Set(plan.directories);
  const expectedFiles = new Map(plan.files.map((file) => [file.path, file]));
  const seen = new Set<PortableResourcePath>();
  for (const entry of tree.entries) {
    const relative = relativeFromCandidate(candidateRootPath, entry.resourcePath);
    if (seen.has(relative)) fail("tree-conflict", "$candidate");
    seen.add(relative);
    if (entry.node.kind === "directory") {
      if (!expectedDirectories.has(relative) || entry.node.permissionBits !== plan.directoryMode) {
        fail("tree-conflict", "$candidate");
      }
      continue;
    }
    const expected = expectedFiles.get(relative);
    const created = createdFiles.get(relative);
    if (
      expected === undefined ||
      created === undefined ||
      entry.node.kind !== "file" ||
      entry.node.permissionBits !== expected.mode ||
      entry.node.linkCount !== 1n ||
      entry.node.byteCount !== expected.byteCount ||
      !sameFileNodeIdentity(entry.node, created) ||
      entry.node.byteCount !== created.byteCount
    ) {
      fail("tree-conflict", "$candidate");
    }
  }
  throwIfAborted(signal);
  return Object.freeze({ candidateRootPath, plan, rootNode: tree.treeRootNode });
}

/** 写入前验证已有暂存目录是输入计划的安全子集，且现有文件字节完全一致。 */
export async function inspectPartialDirectoryTreeCandidate(
  root: RootedDirectory,
  candidateRootPath: PortableResourcePath,
  prepared: Readonly<PreparedDirectoryTreeCandidate>,
): Promise<
  Readonly<{
    readonly existingDirectories: ReadonlySet<PortableResourcePath>;
    readonly existingFiles: ReadonlySet<PortableResourcePath>;
  }>
> {
  const progress = await inspectDirectoryTreeCandidateProgress(
    root,
    candidateRootPath,
    prepared.plan,
    prepared.options.signal === undefined ? undefined : { signal: prepared.options.signal },
  );
  const missingDirectories = new Set(progress.missingDirectories);
  const missingFiles = new Set(progress.missingFiles);
  const existingDirectories = new Set(
    prepared.plan.directories.filter((directory) => !missingDirectories.has(directory)),
  );
  const existingFiles = new Set(
    prepared.plan.files.filter((file) => !missingFiles.has(file.path)).map((file) => file.path),
  );
  const expectedFiles = new Map(prepared.files.map((file) => [file.path, file]));
  for (const filePath of existingFiles) {
    const expected = expectedFiles.get(filePath);
    if (expected === undefined) fail("tree-conflict", "$candidate");
    let read: Awaited<ReturnType<typeof readStableFile>>;
    try {
      read = await readStableFile(
        root,
        parseDirectoryTreeCandidatePath(`${candidateRootPath}/${filePath}`, "$candidate/file"),
        {
          maximumBytes: expected.byteCount,
          ...(prepared.options.signal === undefined ? {} : { signal: prepared.options.signal }),
        },
      );
    } catch (error: unknown) {
      if (error instanceof StableFileReadError) {
        if (error.reason === "source-changed") {
          fail("source-changed", "$candidate");
        }
        fail("tree-conflict", "$candidate");
      }
      throw error;
    }
    if (read.digest !== expected.digest || !sameBytes(read.bytes, expected.bytes)) {
      fail("tree-conflict", "$candidate");
    }
  }
  return Object.freeze({ existingDirectories, existingFiles });
}
