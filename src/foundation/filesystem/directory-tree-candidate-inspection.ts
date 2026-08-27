import { types } from "node:util";

import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import { parseByteCount } from "../numeric/byte-count.js";
import {
  assertDirectoryTreeCandidateNotAborted,
  directoryTreeCandidateMaximumPathDepth,
  isDirectoryTreeCandidateAbortSignal,
  parseDirectoryTreeCandidatePath,
  parseDirectoryTreeCandidatePlan,
  throwDirectoryTreeCandidateError as fail,
  type DirectoryTreeCandidatePlan,
  type DirectoryTreeCandidateProgress,
  type DirectoryTreeCandidateResult,
  type InspectDirectoryTreeCandidateOptions,
  type PreparedDirectoryTreeCandidate,
} from "./directory-tree-candidate-plan.js";
import {
  sameFileNodeSnapshot,
  FileNodeSnapshotError,
  type FileNodeSnapshot,
} from "./file-node-snapshot.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import { RootedDirectory } from "./rooted-directory.js";
import {
  readStableFile,
  StableFileReadError,
} from "./stable-file-read.js";
import {
  readStableResourceTree,
  StableResourceTreeReadError,
} from "./stable-resource-tree-read.js";

/** Wakeflow Foundation / Filesystem：目录树候选的稳定进度检查与清单闭合验证。 */

function inspectionLimits(plan: Readonly<DirectoryTreeCandidatePlan>) {
  const largestFile = Math.max(0, ...plan.files.map((file) => file.byteCount));
  return Object.freeze({
    maximumEntries: plan.directories.length + plan.files.length,
    maximumDepth: directoryTreeCandidateMaximumPathDepth(
      plan.directories,
      plan.files,
    ),
    maximumFiles: plan.files.length,
    maximumFileBytes: parseByteCount(largestFile, "$plan/maximumFileBytes"),
    maximumTotalBytes: plan.totalBytes,
  });
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

function parseInspectionOptions(value: unknown): Readonly<{
  readonly expectedRootNode: Readonly<FileNodeSnapshot> | undefined;
  readonly signal: AbortSignal | undefined;
}> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  const unexpected = Object.keys(record).find(
    (key) => key !== "expectedRootNode" && key !== "signal",
  );
  if (unexpected !== undefined) fail("input", `$options/${unexpected}`);
  const signal = record.signal;
  if (signal !== undefined && !isDirectoryTreeCandidateAbortSignal(signal)) {
    fail("input", "$options/signal");
  }
  const expectedRootNode = record.expectedRootNode as
    | Readonly<FileNodeSnapshot>
    | undefined;
  if (expectedRootNode !== undefined) {
    if (
      typeof expectedRootNode !== "object"
      || expectedRootNode === null
      || types.isProxy(expectedRootNode)
      || !Object.isFrozen(expectedRootNode)
    ) {
      fail("input", "$options/expectedRootNode");
    }
    try {
      sameFileNodeSnapshot(expectedRootNode, expectedRootNode);
    } catch (error: unknown) {
      if (error instanceof FileNodeSnapshotError) {
        fail("input", "$options/expectedRootNode");
      }
      throw error;
    }
  }
  return Object.freeze({ expectedRootNode, signal });
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
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "source-changed") {
        fail("source-changed", "$candidate");
      }
      fail("tree-conflict", "$candidate");
    }
    throw error;
  }
}

/** 稳定判断候选目录是计划的安全子集，还是已经达到清单闭合状态。 */
export async function inspectDirectoryTreeCandidateProgress(
  root: RootedDirectory,
  candidateRootPathValue: unknown,
  planValue: DirectoryTreeCandidatePlan,
  optionsValue: InspectDirectoryTreeCandidateOptions = {},
): Promise<Readonly<DirectoryTreeCandidateProgress>> {
  if (!(root instanceof RootedDirectory) || types.isProxy(root)) {
    fail("input", "$root");
  }
  const candidateRootPath = parseDirectoryTreeCandidatePath(
    candidateRootPathValue,
    "$candidateRootPath",
  );
  const plan = parseDirectoryTreeCandidatePlan(planValue);
  const { expectedRootNode, signal } = parseInspectionOptions(optionsValue);
  assertDirectoryTreeCandidateNotAborted(signal);
  const tree = await readCandidateTree(
    root,
    candidateRootPath,
    plan,
    expectedRootNode,
    signal,
  );
  if (
    tree.treeRootNode.kind !== "directory"
    || tree.treeRootNode.permissionBits !== plan.directoryMode
  ) {
    fail("tree-conflict", "$candidate");
  }
  const expectedDirectories = new Map(plan.directories.map((path) => [path, true]));
  const expectedFiles = new Map(plan.files.map((file) => [file.path, file]));
  for (const entry of tree.entries) {
    const relative = relativeFromCandidate(candidateRootPath, entry.resourcePath);
    if (entry.node.kind === "directory") {
      if (
        !expectedDirectories.has(relative)
        || entry.node.permissionBits !== plan.directoryMode
      ) {
        fail("tree-conflict", "$candidate");
      }
      continue;
    }
    const expected = expectedFiles.get(relative);
    if (
      expected === undefined
      || entry.node.kind !== "file"
      || entry.node.permissionBits !== expected.mode
      || entry.node.linkCount !== 1n
    ) {
      fail("tree-conflict", "$candidate");
    }
  }
  for (const file of tree.files) {
    const relative = relativeFromCandidate(candidateRootPath, file.resourcePath);
    const expected = expectedFiles.get(relative);
    if (
      expected === undefined
      || file.byteCount !== expected.byteCount
      || file.digest !== expected.digest
      || file.node.permissionBits !== expected.mode
      || file.node.linkCount !== 1n
    ) {
      fail("tree-conflict", "$candidate");
    }
  }
  const observedDirectories = new Set(tree.entries
    .filter((entry) => entry.node.kind === "directory")
    .map((entry) => relativeFromCandidate(candidateRootPath, entry.resourcePath)));
  const observedFiles = new Set(tree.files.map((file) => (
    relativeFromCandidate(candidateRootPath, file.resourcePath)
  )));
  const missingDirectories = Object.freeze(plan.directories.filter(
    (directory) => !observedDirectories.has(directory),
  ));
  const missingFiles = Object.freeze(plan.files
    .filter((file) => !observedFiles.has(file.path))
    .map((file) => file.path));
  const complete = missingDirectories.length === 0 && missingFiles.length === 0;
  if (
    complete
    && (
      tree.entries.length !== plan.directories.length + plan.files.length
      || tree.files.length !== plan.files.length
      || tree.totalFileBytes !== plan.totalBytes
    )
  ) {
    fail("tree-conflict", "$candidate");
  }
  assertDirectoryTreeCandidateNotAborted(signal);
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
  candidateRootPathValue: unknown,
  planValue: DirectoryTreeCandidatePlan,
  optionsValue: InspectDirectoryTreeCandidateOptions = {},
): Promise<Readonly<DirectoryTreeCandidateResult>> {
  const progress = await inspectDirectoryTreeCandidateProgress(
    root,
    candidateRootPathValue,
    planValue,
    optionsValue,
  );
  if (progress.status !== "complete") fail("tree-conflict", "$candidate");
  return Object.freeze({
    candidateRootPath: progress.candidateRootPath,
    plan: progress.plan,
    rootNode: progress.rootNode,
  });
}

/** 写入前验证已有暂存目录是输入计划的安全子集，且现有文件字节完全一致。 */
export async function inspectPartialDirectoryTreeCandidate(
  root: RootedDirectory,
  candidateRootPath: PortableResourcePath,
  prepared: Readonly<PreparedDirectoryTreeCandidate>,
): Promise<Readonly<{
  readonly existingDirectories: ReadonlySet<PortableResourcePath>;
  readonly existingFiles: ReadonlySet<PortableResourcePath>;
}>> {
  const progress = await inspectDirectoryTreeCandidateProgress(
    root,
    candidateRootPath,
    prepared.plan,
    prepared.options.signal === undefined
      ? undefined
      : { signal: prepared.options.signal },
  );
  const existingDirectories = new Set(prepared.plan.directories.filter(
    (directory) => !progress.missingDirectories.includes(directory),
  ));
  const existingFiles = new Set(prepared.plan.files
    .filter((file) => !progress.missingFiles.includes(file.path))
    .map((file) => file.path));
  const expectedFiles = new Map(prepared.files.map((file) => [file.path, file]));
  for (const filePath of existingFiles) {
    const expected = expectedFiles.get(filePath);
    if (expected === undefined) fail("tree-conflict", "$candidate");
    let read;
    try {
      read = await readStableFile(
        root,
        parseDirectoryTreeCandidatePath(
          `${candidateRootPath}/${filePath}`,
          "$candidate/file",
        ),
        {
          maximumBytes: expected.byteCount,
          ...(prepared.options.signal === undefined
            ? {}
            : { signal: prepared.options.signal }),
        },
      );
    } catch (error: unknown) {
      if (error instanceof StableFileReadError) {
        if (error.reason === "aborted") fail("aborted", "$signal");
        if (error.reason === "source-changed") {
          fail("source-changed", "$candidate");
        }
        fail("tree-conflict", "$candidate");
      }
      throw error;
    }
    if (
      read.digest !== expected.digest
      || read.bytes.length !== expected.bytes.length
      || read.bytes.some((byte, index) => byte !== expected.bytes[index])
    ) {
      fail("tree-conflict", "$candidate");
    }
  }
  return Object.freeze({ existingDirectories, existingFiles });
}
