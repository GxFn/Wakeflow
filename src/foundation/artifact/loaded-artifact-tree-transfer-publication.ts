import { types } from "node:util";

import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import {
  publishDirectoryTreeCandidateDurably,
  DurableDirectoryTreePublicationError,
  type DurableDirectoryTreePublicationResult,
} from "../filesystem/durable-directory-tree-publication.js";
import {
  inspectDirectoryTreeCandidate,
  DurableDirectoryTreeCandidateError,
  type DirectoryTreeCandidateResult,
} from "../filesystem/durable-directory-tree-candidate.js";
import type { FileNodeSnapshot } from "../filesystem/file-node-snapshot.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../filesystem/rooted-directory.js";
import {
  type LoadedArtifactTreeIdentity,
} from "./loaded-artifact-tree-identity.js";
import {
  parseLoadedArtifactTreeTransferPlan,
  LoadedArtifactTreeTransferPlanError,
  type LoadedArtifactTreeTransferPlan,
} from "./loaded-artifact-tree-transfer-plan.js";

/**
 * Wakeflow Foundation / Artifact：Loaded Artifact Tree candidate 的同根持久发布。
 *
 * 最终路径已存在时，本 owner 只接受目录计划与 artifact identity 都完全一致、且 candidate
 * 路径已经不存在的幂等 current 状态。最终路径不存在时，它先验证 candidate 整树闭合，
 * 再复用 Foundation durable rename 跨越唯一提交点。Directory Plan与Artifact Manifest
 * 的严格关系已经由Transfer Plan parser证明，因此一次exact最终树验证即可同时证明
 * artifact identity，不重复读取并散列全部文件。
 *
 * 本模块不取得领域锁、不跨设备复制、不删除来源或冲突 candidate，也不在 current 状态
 * 自动清理残留。调用方必须持有同时覆盖 candidate 与 final 的领域协调边界。
 */

interface LoadedArtifactTreeTransferPublicationOptions {
  readonly signal?: AbortSignal;
}

interface LoadedArtifactTreeTransferPublicationResult {
  readonly disposition: "current" | "published";
  readonly plan: Readonly<LoadedArtifactTreeTransferPlan>;
  readonly publication:
    Readonly<DurableDirectoryTreePublicationResult> | null;
  readonly finalTree: Readonly<DirectoryTreeCandidateResult>;
  readonly artifactIdentity: Readonly<LoadedArtifactTreeIdentity>;
}

export type LoadedArtifactTreeTransferPublicationErrorReason =
  | "input"
  | "destination-root-scope"
  | "candidate-conflict"
  | "candidate-residue"
  | "destination-conflict"
  | "destination-exists"
  | "cross-device"
  | "durability-failure"
  | "commit-uncertain"
  | "operation-failure"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Loaded artifact tree publication input is invalid.",
  "destination-root-scope": "Loaded artifact tree publication lost its destination root scope.",
  "candidate-conflict": "Loaded artifact tree publication candidate is not closed.",
  "candidate-residue": "Loaded artifact tree current target conflicts with candidate residue.",
  "destination-conflict": "Loaded artifact tree final target conflicts with its plan.",
  "destination-exists": "Loaded artifact tree final target appeared before publication.",
  "cross-device": "Loaded artifact tree candidate and final target are on different filesystems.",
  "durability-failure": "Loaded artifact tree publication directory entries are not durable.",
  "commit-uncertain": "Published loaded artifact tree could not be proven exact.",
  "operation-failure": "Loaded artifact tree candidate could not be published safely.",
  aborted: "Loaded artifact tree publication was aborted before commit.",
} as const satisfies Readonly<Record<
  LoadedArtifactTreeTransferPublicationErrorReason,
  string
>>;

/** Loaded Artifact Tree 发布失败的稳定、脱敏错误。 */
export class LoadedArtifactTreeTransferPublicationError extends Error {
  override readonly name = "LoadedArtifactTreeTransferPublicationError";
  readonly code = "wakeflow-loaded-artifact-tree-transfer-publication" as const;
  readonly reason: LoadedArtifactTreeTransferPublicationErrorReason;
  readonly path: string;

  constructor(
    reason: LoadedArtifactTreeTransferPublicationErrorReason,
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

interface FinalReadback {
  readonly tree: Readonly<DirectoryTreeCandidateResult>;
  readonly identity: Readonly<LoadedArtifactTreeIdentity>;
}

function fail(
  reason: LoadedArtifactTreeTransferPublicationErrorReason,
  path: string,
): never {
  throw new LoadedArtifactTreeTransferPublicationError(reason, path);
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    fail("input", "$destinationRoot");
  }
}

function parsePlan(value: unknown): Readonly<LoadedArtifactTreeTransferPlan> {
  try {
    return parseLoadedArtifactTreeTransferPlan(value);
  } catch (error: unknown) {
    if (error instanceof LoadedArtifactTreeTransferPlanError) {
      fail("input", "$plan");
    }
    throw error;
  }
}

function parseDestinationPath(value: unknown): PortableResourcePath {
  try {
    return parsePortableResourcePath(value, "$destinationResourcePath");
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      fail("input", "$destinationResourcePath");
    }
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

async function inspectResourceOrNull(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<Readonly<FileNodeSnapshot> | null> {
  try {
    return (await root.inspectExistingResource(resourcePath, "$resourcePath"))
      .node;
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      if (error.reason === "resource-not-found") return null;
      fail("destination-root-scope", "$destinationRoot");
    }
    throw error;
  }
}

function mapTreeInspectionError(
  error: DurableDirectoryTreeCandidateError,
): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "input") fail("input", error.path);
  fail("destination-conflict", "$destinationResourcePath");
}

function artifactIdentityFromPlan(
  plan: Readonly<LoadedArtifactTreeTransferPlan>,
): Readonly<LoadedArtifactTreeIdentity> {
  return Object.freeze({
    artifactDigest: plan.artifactDigest,
    manifest: plan.manifest,
  });
}

async function readCurrentFinal(
  root: RootedDirectory,
  destinationResourcePath: PortableResourcePath,
  plan: Readonly<LoadedArtifactTreeTransferPlan>,
  signal: AbortSignal | undefined,
): Promise<Readonly<FinalReadback>> {
  let tree: Readonly<DirectoryTreeCandidateResult>;
  try {
    tree = await inspectDirectoryTreeCandidate(
      root,
      destinationResourcePath,
      plan.directoryPlan,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      mapTreeInspectionError(error);
    }
    fail("destination-conflict", "$destinationResourcePath");
  }
  return Object.freeze({
    tree,
    identity: artifactIdentityFromPlan(plan),
  });
}

function readPublishedFinal(
  publication: Readonly<DurableDirectoryTreePublicationResult>,
  destinationResourcePath: PortableResourcePath,
  plan: Readonly<LoadedArtifactTreeTransferPlan>,
): Readonly<FinalReadback> {
  if (
    publication.destinationResourcePath !== destinationResourcePath
    || publication.plan.treeDigest !== plan.directoryPlan.treeDigest
    || publication.rootNode.kind !== "directory"
  ) {
    fail("commit-uncertain", "$destinationResourcePath");
  }
  return Object.freeze({
    tree: Object.freeze({
      candidateRootPath: destinationResourcePath,
      plan: plan.directoryPlan,
      rootNode: publication.rootNode,
    }),
    identity: artifactIdentityFromPlan(plan),
  });
}

function mapPublicationError(
  error: DurableDirectoryTreePublicationError,
): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "input") fail("input", error.path);
  if (
    error.reason === "source-changed"
    || error.reason === "source-conflict"
  ) {
    fail("candidate-conflict", "$candidate");
  }
  if (error.reason === "destination-exists") {
    fail("destination-exists", "$destinationResourcePath");
  }
  if (error.reason === "cross-device") {
    fail("cross-device", "$destinationResourcePath");
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
 * 幂等读取或持久发布一棵已闭合 Loaded Artifact Tree candidate。
 */
export async function publishLoadedArtifactTreeTransferCandidate(
  destinationRootValue: RootedDirectory,
  planValue: LoadedArtifactTreeTransferPlan,
  destinationResourcePathValue: PortableResourcePath,
  optionsValue?: LoadedArtifactTreeTransferPublicationOptions,
): Promise<Readonly<LoadedArtifactTreeTransferPublicationResult>> {
  assertRoot(destinationRootValue);
  const options = parseOptions(optionsValue);
  assertNotAborted(options.signal);
  const plan = parsePlan(planValue);
  const destinationResourcePath = parseDestinationPath(
    destinationResourcePathValue,
  );

  const existingDestination = await inspectResourceOrNull(
    destinationRootValue,
    destinationResourcePath,
  );
  if (existingDestination !== null) {
    if (
      await inspectResourceOrNull(
        destinationRootValue,
        plan.candidateRootPath,
      ) !== null
    ) {
      fail("candidate-residue", "$candidate");
    }
    const final = await readCurrentFinal(
      destinationRootValue,
      destinationResourcePath,
      plan,
      options.signal,
    );
    return Object.freeze({
      disposition: "current",
      plan,
      publication: null,
      finalTree: final.tree,
      artifactIdentity: final.identity,
    });
  }

  let candidate: Readonly<DirectoryTreeCandidateResult>;
  try {
    candidate = await inspectDirectoryTreeCandidate(
      destinationRootValue,
      plan.candidateRootPath,
      plan.directoryPlan,
      options.signal === undefined ? undefined : { signal: options.signal },
    );
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("candidate-conflict", "$candidate");
    }
    throw error;
  }

  let publication: Readonly<DurableDirectoryTreePublicationResult>;
  try {
    publication = await publishDirectoryTreeCandidateDurably(
      destinationRootValue,
      candidate,
      destinationResourcePath,
      options.signal === undefined ? undefined : { signal: options.signal },
    );
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreePublicationError) {
      mapPublicationError(error);
    }
    fail("operation-failure", "$destinationResourcePath");
  }
  const final = readPublishedFinal(
    publication,
    destinationResourcePath,
    plan,
  );
  return Object.freeze({
    disposition: "published",
    plan,
    publication,
    finalTree: final.tree,
    artifactIdentity: final.identity,
  });
}
