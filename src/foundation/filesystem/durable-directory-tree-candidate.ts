import { types } from "node:util";

import {
  assertDirectoryTreeCandidateNotAborted,
  joinDirectoryTreeCandidatePath,
  parseDirectoryTreeCandidatePath,
  prepareDirectoryTreeCandidate,
  throwDirectoryTreeCandidateError as fail,
  type DirectoryTreeCandidateFileInput,
  type DirectoryTreeCandidateOptions,
  type DirectoryTreeCandidateResult,
} from "./directory-tree-candidate-plan.js";
import {
  inspectDirectoryTreeCandidate,
  inspectPartialDirectoryTreeCandidate,
} from "./directory-tree-candidate-inspection.js";
import {
  createDirectoryAtomically,
  materializeDirectoryPath,
  DurableDirectoryMaterializationError,
} from "./durable-directory-materialization.js";
import {
  createFileCandidateDurably,
  DurableFileCandidateError,
} from "./durable-file-candidate.js";
import { RootedDirectory } from "./rooted-directory.js";

/**
 * Wakeflow Foundation / Filesystem：目录树候选的持久化创建与精确补齐入口。
 *
 * 本模块只创建尚不存在的候选目录，或补齐已由调用方证明归属的部分候选目录。
 * 相邻模块分别负责精确清单计划与稳定验证。候选目录不是权威事实；本模块不选择
 * 暂存路径或最终路径、不获取领域锁、不执行重命名，也不删除崩溃残留。
 */

function mapDirectoryError(error: DurableDirectoryMaterializationError): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "target-exists") {
    fail("target-exists", "$candidateRootPath");
  }
  if (
    error.reason === "target-symlink"
    || error.reason === "target-not-directory"
    || error.reason === "parent-symlink"
    || error.reason === "parent-not-directory"
  ) {
    fail("tree-conflict", "$candidateRootPath");
  }
  fail("operation-failure", "$candidateRootPath");
}

function mapFileError(error: DurableFileCandidateError): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "target-exists") {
    fail("tree-conflict", "$candidateRootPath");
  }
  fail("operation-failure", "$candidateRootPath");
}

/** 在尚不存在的候选路径创建目录树，并验证其清单闭合且已采用最终权限位。 */
export async function createDirectoryTreeCandidateDurably(
  root: RootedDirectory,
  candidateRootPathValue: unknown,
  filesValue: readonly DirectoryTreeCandidateFileInput[],
  optionsValue: DirectoryTreeCandidateOptions,
): Promise<Readonly<DirectoryTreeCandidateResult>> {
  if (!(root instanceof RootedDirectory) || types.isProxy(root)) {
    fail("input", "$root");
  }
  const candidateRootPath = parseDirectoryTreeCandidatePath(
    candidateRootPathValue,
    "$candidateRootPath",
  );
  const prepared = prepareDirectoryTreeCandidate(filesValue, optionsValue);
  assertDirectoryTreeCandidateNotAborted(prepared.options.signal);
  try {
    await createDirectoryAtomically(root, candidateRootPath, {
      mode: prepared.options.directoryMode,
      ...(prepared.options.signal === undefined
        ? {}
        : { signal: prepared.options.signal }),
    });
    for (const directory of prepared.plan.directories) {
      await materializeDirectoryPath(
        root,
        joinDirectoryTreeCandidatePath(candidateRootPath, directory),
        {
          mode: prepared.options.directoryMode,
          ...(prepared.options.signal === undefined
            ? {}
            : { signal: prepared.options.signal }),
        },
      );
    }
    for (const file of prepared.files) {
      await createFileCandidateDurably(
        root,
        joinDirectoryTreeCandidatePath(candidateRootPath, file.path),
        file.bytes,
        {
          mode: file.mode,
          ...(prepared.options.signal === undefined
            ? {}
            : { signal: prepared.options.signal }),
        },
      );
    }
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryMaterializationError) {
      mapDirectoryError(error);
    }
    if (error instanceof DurableFileCandidateError) mapFileError(error);
    throw error;
  }
  return inspectDirectoryTreeCandidate(
    root,
    candidateRootPath,
    prepared.plan,
    prepared.options.signal === undefined
      ? undefined
      : { signal: prepared.options.signal },
  );
}

/**
 * 仅在归属已确认的候选根目录中补齐缺失项，随后重新验证清单闭合状态。
 * 如果存在未知节点、错误权限位、不同字节或观察漂移，函数会在新增写入前拒绝操作。
 */
export async function settleDirectoryTreeCandidateDurably(
  root: RootedDirectory,
  candidateRootPathValue: unknown,
  filesValue: readonly DirectoryTreeCandidateFileInput[],
  optionsValue: DirectoryTreeCandidateOptions,
): Promise<Readonly<DirectoryTreeCandidateResult>> {
  if (!(root instanceof RootedDirectory) || types.isProxy(root)) {
    fail("input", "$root");
  }
  const candidateRootPath = parseDirectoryTreeCandidatePath(
    candidateRootPathValue,
    "$candidateRootPath",
  );
  const prepared = prepareDirectoryTreeCandidate(filesValue, optionsValue);
  assertDirectoryTreeCandidateNotAborted(prepared.options.signal);
  const partial = await inspectPartialDirectoryTreeCandidate(
    root,
    candidateRootPath,
    prepared,
  );
  try {
    for (const directory of prepared.plan.directories) {
      if (partial.existingDirectories.has(directory)) continue;
      await materializeDirectoryPath(
        root,
        joinDirectoryTreeCandidatePath(candidateRootPath, directory),
        {
          mode: prepared.options.directoryMode,
          ...(prepared.options.signal === undefined
            ? {}
            : { signal: prepared.options.signal }),
        },
      );
    }
    for (const file of prepared.files) {
      if (partial.existingFiles.has(file.path)) continue;
      await createFileCandidateDurably(
        root,
        joinDirectoryTreeCandidatePath(candidateRootPath, file.path),
        file.bytes,
        {
          mode: file.mode,
          ...(prepared.options.signal === undefined
            ? {}
            : { signal: prepared.options.signal }),
        },
      );
    }
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryMaterializationError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("tree-conflict", "$candidate");
    }
    if (error instanceof DurableFileCandidateError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("tree-conflict", "$candidate");
    }
    throw error;
  }
  return inspectDirectoryTreeCandidate(
    root,
    candidateRootPath,
    prepared.plan,
    prepared.options.signal === undefined
      ? undefined
      : { signal: prepared.options.signal },
  );
}

export {
  DIRECTORY_TREE_CANDIDATE_PLAN_ARTIFACT_KIND,
  DIRECTORY_TREE_CANDIDATE_PLAN_SCHEMA_VERSION,
  DurableDirectoryTreeCandidateError,
  parseDirectoryTreeCandidatePlan,
  planDirectoryTreeCandidate,
  planDirectoryTreeCandidateFromFileDescriptors,
} from "./directory-tree-candidate-plan.js";
export type {
  DirectoryTreeCandidateFileInput,
  DirectoryTreeCandidateOptions,
  DirectoryTreeCandidatePlan,
  DirectoryTreeCandidatePlanFile,
  DirectoryTreeCandidateProgress,
  DirectoryTreeCandidateResult,
  DurableDirectoryTreeCandidateErrorReason,
  InspectDirectoryTreeCandidateOptions,
} from "./directory-tree-candidate-plan.js";
export {
  inspectDirectoryTreeCandidate,
  inspectDirectoryTreeCandidateProgress,
} from "./directory-tree-candidate-inspection.js";
