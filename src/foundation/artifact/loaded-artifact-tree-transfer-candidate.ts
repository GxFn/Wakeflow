import { types } from "node:util";

import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import {
  copyFileToCandidateDurably,
  DurableFileCopyCandidateError,
} from "../filesystem/durable-file-copy-candidate.js";
import {
  createDirectoryAtomically,
  DurableDirectoryMaterializationError,
} from "../filesystem/durable-directory-materialization.js";
import {
  inspectDirectoryTreeCandidate,
  inspectDirectoryTreeCandidateProgress,
  DurableDirectoryTreeCandidateError,
  type DirectoryTreeCandidateResult,
} from "../filesystem/durable-directory-tree-candidate.js";
import {
  joinDirectoryTreeCandidatePath,
} from "../filesystem/directory-tree-candidate-plan.js";
import type { PortableResourcePath } from "../filesystem/portable-resource-path.js";
import { RootedDirectory } from "../filesystem/rooted-directory.js";
import {
  inspectLoadedArtifactTree,
  LoadedArtifactTreeIdentityError,
  type LoadedArtifactTreeIdentity,
} from "./loaded-artifact-tree-identity.js";
import {
  parseLoadedArtifactTreeTransferPlan,
  LoadedArtifactTreeTransferPlanError,
  type LoadedArtifactTreeTransferPlan,
} from "./loaded-artifact-tree-transfer-plan.js";

/**
 * Wakeflow Foundation / Artifact：Loaded Artifact Tree 的目标根内候选物化。
 *
 * 本 owner 先重新观察完整来源树并绑定 transfer plan 的 artifact digest，再在目标
 * `RootedDirectory` 内创建或验证 candidate 根。已有目录和文件必须是计划的安全精确子集；
 * 缺失目录逐级持久物化，缺失文件逐项调用跨根 streaming copy。最后使用同一
 * `DirectoryTreeCandidatePlan` 证明整树闭合，并再次观察来源树以确认复制期间未漂移。
 *
 * 中途失败会保留已经完成且可由同一计划证明的 candidate 前缀，供精确重试；本模块不
 * 发布最终路径、不删除来源、不清理未知节点，也不把 candidate 视为权威事实。
 */

interface LoadedArtifactTreeTransferCandidateOptions {
  readonly signal?: AbortSignal;
}

interface LoadedArtifactTreeTransferCandidateResult {
  readonly plan: Readonly<LoadedArtifactTreeTransferPlan>;
  readonly sourceIdentity: Readonly<LoadedArtifactTreeIdentity>;
  readonly candidate: Readonly<DirectoryTreeCandidateResult>;
  readonly copiedFiles: readonly PortableResourcePath[];
}

export type LoadedArtifactTreeTransferCandidateErrorReason =
  | "input"
  | "capacity"
  | "source-root-scope"
  | "source-changed"
  | "destination-root-scope"
  | "candidate-conflict"
  | "copy-failure"
  | "operation-failure"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Loaded artifact tree transfer candidate input is invalid.",
  capacity: "Loaded artifact tree transfer exceeds its admitted capacity.",
  "source-root-scope": "Loaded artifact tree transfer lost its source root scope.",
  "source-changed": "Loaded artifact tree source differs from its transfer plan.",
  "destination-root-scope": "Loaded artifact tree transfer lost its destination root scope.",
  "candidate-conflict": "Loaded artifact tree candidate conflicts with its closed plan.",
  "copy-failure": "Loaded artifact tree file could not be copied safely.",
  "operation-failure": "Loaded artifact tree candidate could not be materialized safely.",
  aborted: "Loaded artifact tree transfer candidate was aborted.",
} as const satisfies Readonly<Record<
  LoadedArtifactTreeTransferCandidateErrorReason,
  string
>>;

/** Loaded Artifact Tree candidate 物化失败的稳定、脱敏错误。 */
export class LoadedArtifactTreeTransferCandidateError extends Error {
  override readonly name = "LoadedArtifactTreeTransferCandidateError";
  readonly code = "wakeflow-loaded-artifact-tree-transfer-candidate" as const;
  readonly reason: LoadedArtifactTreeTransferCandidateErrorReason;
  readonly path: string;

  constructor(
    reason: LoadedArtifactTreeTransferCandidateErrorReason,
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
  reason: LoadedArtifactTreeTransferCandidateErrorReason,
  path: string,
): never {
  throw new LoadedArtifactTreeTransferCandidateError(reason, path);
}

function assertRoot(
  value: unknown,
  path: "$sourceRoot" | "$destinationRoot",
): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    fail("input", path);
  }
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal;
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
    Object.keys(record).some((key) => key !== "signal")
    || (record.signal !== undefined && !isAbortSignal(record.signal))
  ) {
    fail("input", "$options");
  }
  return Object.freeze({ signal: record.signal as AbortSignal | undefined });
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$signal");
}

function parsePlan(value: unknown): Readonly<LoadedArtifactTreeTransferPlan> {
  try {
    return parseLoadedArtifactTreeTransferPlan(value);
  } catch (error: unknown) {
    if (error instanceof LoadedArtifactTreeTransferPlanError) {
      if (error.reason === "capacity") fail("capacity", "$plan");
      fail("input", "$plan");
    }
    throw error;
  }
}

function mapSourceError(error: LoadedArtifactTreeIdentityError): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "root-scope") fail("source-root-scope", "$sourceRoot");
  if (
    error.reason === "entry-limit"
    || error.reason === "depth-limit"
    || error.reason === "file-count"
    || error.reason === "file-bytes"
    || error.reason === "total-bytes"
    || error.reason === "ref-bytes"
  ) {
    fail("capacity", "$source");
  }
  if (error.reason === "input") fail("input", error.path);
  fail("source-changed", "$source");
}

async function inspectSource(
  root: RootedDirectory,
  plan: Readonly<LoadedArtifactTreeTransferPlan>,
  signal: AbortSignal | undefined,
): Promise<Readonly<LoadedArtifactTreeIdentity>> {
  let identity: Readonly<LoadedArtifactTreeIdentity>;
  try {
    identity = await inspectLoadedArtifactTree(
      root,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof LoadedArtifactTreeIdentityError) mapSourceError(error);
    throw error;
  }
  if (identity.artifactDigest !== plan.artifactDigest) {
    fail("source-changed", "$source");
  }
  return identity;
}

function mapDirectoryError(
  error: DurableDirectoryMaterializationError,
  allowExistingRoot: boolean,
): "existing" | never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (allowExistingRoot && error.reason === "target-exists") return "existing";
  if (error.reason === "root-scope" || error.reason === "parent-changed") {
    fail("destination-root-scope", "$destinationRoot");
  }
  if (
    error.reason === "target-symlink"
    || error.reason === "target-not-directory"
    || error.reason === "parent-symlink"
    || error.reason === "parent-not-directory"
    || error.reason === "target-exists"
  ) {
    fail("candidate-conflict", "$candidate");
  }
  fail("operation-failure", "$candidate");
}

async function ensureCandidateRoot(
  root: RootedDirectory,
  plan: Readonly<LoadedArtifactTreeTransferPlan>,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await createDirectoryAtomically(root, plan.candidateRootPath, {
      mode: plan.directoryPlan.directoryMode,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryMaterializationError) {
      if (mapDirectoryError(error, true) === "existing") return;
    }
    throw error;
  }
}

function mapCandidateInspectionError(
  error: DurableDirectoryTreeCandidateError,
): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "input") fail("input", error.path);
  if (error.reason === "capacity") fail("capacity", "$candidate");
  if (
    error.reason === "tree-conflict"
    || error.reason === "source-changed"
  ) {
    fail("candidate-conflict", "$candidate");
  }
  fail("operation-failure", "$candidate");
}

async function inspectProgress(
  root: RootedDirectory,
  plan: Readonly<LoadedArtifactTreeTransferPlan>,
  signal: AbortSignal | undefined,
) {
  try {
    return await inspectDirectoryTreeCandidateProgress(
      root,
      plan.candidateRootPath,
      plan.directoryPlan,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      mapCandidateInspectionError(error);
    }
    throw error;
  }
}

async function materializeMissingDirectories(
  root: RootedDirectory,
  plan: Readonly<LoadedArtifactTreeTransferPlan>,
  missingDirectories: readonly PortableResourcePath[],
  signal: AbortSignal | undefined,
): Promise<void> {
  for (const directory of missingDirectories) {
    assertNotAborted(signal);
    try {
      await createDirectoryAtomically(
        root,
        joinDirectoryTreeCandidatePath(plan.candidateRootPath, directory),
        {
          mode: plan.directoryPlan.directoryMode,
          ...(signal === undefined ? {} : { signal }),
        },
      );
    } catch (error: unknown) {
      if (error instanceof DurableDirectoryMaterializationError) {
        mapDirectoryError(error, false);
      }
      throw error;
    }
  }
}

function mapCopyError(error: DurableFileCopyCandidateError): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "input") fail("input", error.path);
  if (error.reason === "capacity") fail("capacity", "$source");
  if (error.reason === "source-root-scope") {
    fail("source-root-scope", "$sourceRoot");
  }
  if (
    error.reason === "source-not-found"
    || error.reason === "source-symlink"
    || error.reason === "source-not-file"
    || error.reason === "source-changed"
    || error.reason === "source-mismatch"
  ) {
    fail("source-changed", "$source");
  }
  if (error.reason === "destination-root-scope") {
    fail("destination-root-scope", "$destinationRoot");
  }
  if (
    error.reason === "destination-parent"
    || error.reason === "target-exists"
    || error.reason === "candidate-changed"
    || error.reason === "cleanup-failure"
  ) {
    fail("candidate-conflict", "$candidate");
  }
  fail("copy-failure", "$candidate");
}

async function copyMissingFiles(
  sourceRoot: RootedDirectory,
  destinationRoot: RootedDirectory,
  plan: Readonly<LoadedArtifactTreeTransferPlan>,
  missingFiles: readonly PortableResourcePath[],
  signal: AbortSignal | undefined,
): Promise<readonly PortableResourcePath[]> {
  const missing = new Set(missingFiles);
  const copied: PortableResourcePath[] = [];
  for (const [index, plannedFile] of plan.directoryPlan.files.entries()) {
    if (!missing.has(plannedFile.path)) continue;
    const copy = plan.copies[index];
    if (
      copy === undefined
      || copy.sourceResourcePath !== plannedFile.path
    ) {
      fail("input", "$plan");
    }
    try {
      await copyFileToCandidateDurably(
        sourceRoot,
        destinationRoot,
        copy.sourceResourcePath,
        copy.candidateResourcePath,
        {
          byteCount: plannedFile.byteCount,
          digest: plannedFile.digest,
        },
        {
          maximumBytes: plannedFile.byteCount,
          mode: plannedFile.mode,
          ...(signal === undefined ? {} : { signal }),
        },
      );
    } catch (error: unknown) {
      if (error instanceof DurableFileCopyCandidateError) mapCopyError(error);
      throw error;
    }
    copied.push(plannedFile.path);
  }
  return Object.freeze(copied);
}

async function inspectCompleteCandidate(
  root: RootedDirectory,
  plan: Readonly<LoadedArtifactTreeTransferPlan>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DirectoryTreeCandidateResult>> {
  try {
    return await inspectDirectoryTreeCandidate(
      root,
      plan.candidateRootPath,
      plan.directoryPlan,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      mapCandidateInspectionError(error);
    }
    throw error;
  }
}

/** 创建或精确补齐一棵 Loaded Artifact Tree candidate，并证明来源和候选均闭合。 */
export async function materializeLoadedArtifactTreeTransferCandidate(
  sourceRootValue: RootedDirectory,
  destinationRootValue: RootedDirectory,
  planValue: LoadedArtifactTreeTransferPlan,
  optionsValue?: LoadedArtifactTreeTransferCandidateOptions,
): Promise<Readonly<LoadedArtifactTreeTransferCandidateResult>> {
  assertRoot(sourceRootValue, "$sourceRoot");
  assertRoot(destinationRootValue, "$destinationRoot");
  const options = parseOptions(optionsValue);
  assertNotAborted(options.signal);
  const plan = parsePlan(planValue);
  await inspectSource(sourceRootValue, plan, options.signal);
  await ensureCandidateRoot(destinationRootValue, plan, options.signal);
  let progress = await inspectProgress(
    destinationRootValue,
    plan,
    options.signal,
  );
  await materializeMissingDirectories(
    destinationRootValue,
    plan,
    progress.missingDirectories,
    options.signal,
  );
  progress = await inspectProgress(
    destinationRootValue,
    plan,
    options.signal,
  );
  const copiedFiles = await copyMissingFiles(
    sourceRootValue,
    destinationRootValue,
    plan,
    progress.missingFiles,
    options.signal,
  );
  const candidate = await inspectCompleteCandidate(
    destinationRootValue,
    plan,
    options.signal,
  );
  const sourceIdentity = await inspectSource(
    sourceRootValue,
    plan,
    options.signal,
  );
  assertNotAborted(options.signal);
  return Object.freeze({
    plan,
    sourceIdentity,
    candidate,
    copiedFiles,
  });
}
