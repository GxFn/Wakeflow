import { types } from "node:util";

import {
  materializeLoadedArtifactTreeTransferCandidate,
  LoadedArtifactTreeTransferCandidateError,
} from "../../foundation/artifact/loaded-artifact-tree-transfer-candidate.js";
import {
  planLoadedArtifactTreeTransfer,
  LoadedArtifactTreeTransferPlanError,
} from "../../foundation/artifact/loaded-artifact-tree-transfer-plan.js";
import {
  createDirectoryAtomically,
  DurableDirectoryMaterializationError,
} from "../../foundation/filesystem/durable-directory-materialization.js";
import {
  copyFileToCandidateDurably,
  DurableFileCopyCandidateError,
} from "../../foundation/filesystem/durable-file-copy-candidate.js";
import { sameFileNodeIdentity } from "../../foundation/filesystem/file-node-snapshot.js";
import {
  joinDirectoryTreeCandidatePath,
} from "../../foundation/filesystem/directory-tree-candidate-plan.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import type { DirectoryTreeCandidateProgress } from "../../foundation/filesystem/durable-directory-tree-candidate.js";
import {
  parseManagedEvidencePublicationTransaction,
  ManagedEvidencePublicationTransactionError,
  type ManagedEvidencePublicationTransaction,
} from "./managed-evidence-publication-transaction.js";
import {
  MANAGED_EVIDENCE_PAYLOAD_DIRECTORY_NAME,
} from "./managed-evidence-resource-paths.js";
import {
  MANAGED_EVIDENCE_RECORD_DIRECTORY_MODE,
  MANAGED_EVIDENCE_RECORD_EXECUTABLE_FILE_MODE,
  MANAGED_EVIDENCE_RECORD_FILE_MODE,
  parseManagedEvidenceRecordTreePlan,
  ManagedEvidenceRecordTreePlanError,
  type ManagedEvidenceRecordTreePlan,
} from "./managed-evidence-record-tree-plan.js";

/**
 * Wakeflow Governance / Evidence：Managed Evidence payload的source-specific物化。
 *
 * file来源执行一份stable streaming copy；tree来源打开exact子根并复用Loaded Artifact
 * transfer，在复制前后重算完整位置无关identity。目标只限已存在stage中的`payload/`；
 * 本模块不读取journal、不创建stage根、不写Manifest、不发布final或Event。
 */

export interface ManagedEvidencePublicationPayloadMaterializationOptions {
  readonly signal?: AbortSignal;
}

export type ManagedEvidencePublicationPayloadMaterializationErrorReason =
  | "input"
  | "source-root-scope"
  | "source-changed"
  | "destination-root-scope"
  | "stage-conflict"
  | "capacity"
  | "aborted"
  | "recovery-required"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Managed evidence publication payload materialization input is invalid.",
  "source-root-scope": "Managed evidence publication payload escaped its admitted source root.",
  "source-changed": "Managed evidence publication payload source differs from its Manifest.",
  "destination-root-scope": "Managed evidence publication payload escaped its Demand root.",
  "stage-conflict": "Managed evidence publication payload conflicts with its stage plan.",
  capacity: "Managed evidence publication payload exceeds its admitted capacity.",
  aborted: "Managed evidence publication payload materialization was aborted.",
  "recovery-required": "Managed evidence publication payload materialization requires explicit recovery.",
  "operation-failure": "Managed evidence publication payload could not be materialized safely.",
} as const satisfies Readonly<
  Record<ManagedEvidencePublicationPayloadMaterializationErrorReason, string>
>;

export class ManagedEvidencePublicationPayloadMaterializationError
  extends Error {
  override readonly name =
    "ManagedEvidencePublicationPayloadMaterializationError";
  readonly code =
    "wakeflow-managed-evidence-publication-payload-materialization" as const;
  readonly reason: ManagedEvidencePublicationPayloadMaterializationErrorReason;
  readonly path: string;

  constructor(
    reason: ManagedEvidencePublicationPayloadMaterializationErrorReason,
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

const PAYLOAD_REF = parsePortableResourcePath(
  MANAGED_EVIDENCE_PAYLOAD_DIRECTORY_NAME,
);
const CONTENT_REF = parsePortableResourcePath("content");
const PAYLOAD_CONTENT_REF = parsePortableResourcePath(
  `${MANAGED_EVIDENCE_PAYLOAD_DIRECTORY_NAME}/content`,
);

function fail(
  reason: ManagedEvidencePublicationPayloadMaterializationErrorReason,
  path: string,
): never {
  throw new ManagedEvidencePublicationPayloadMaterializationError(reason, path);
}

function assertRoot(
  value: unknown,
  path: "$sourceRoot" | "$demandRoot",
): asserts value is RootedDirectory {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    !(value instanceof RootedDirectory)
  ) {
    fail("input", path);
  }
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
    (record.signal !== undefined &&
      (typeof record.signal !== "object" ||
        record.signal === null ||
        types.isProxy(record.signal) ||
        !(record.signal instanceof AbortSignal)))
  ) {
    fail("input", "$options");
  }
  return Object.freeze({ signal: record.signal as AbortSignal | undefined });
}

function parseTransaction(
  value: unknown,
): Readonly<ManagedEvidencePublicationTransaction> {
  try {
    return parseManagedEvidencePublicationTransaction(value);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidencePublicationTransactionError) {
      fail("input", "$transaction");
    }
    throw error;
  }
}

function parseRecordPlan(
  value: unknown,
): Readonly<ManagedEvidenceRecordTreePlan> {
  try {
    return parseManagedEvidenceRecordTreePlan(value);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceRecordTreePlanError) {
      fail(error.reason === "capacity" ? "capacity" : "input", "$plan");
    }
    throw error;
  }
}

function assertPlanRelation(
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
  plan: Readonly<ManagedEvidenceRecordTreePlan>,
): void {
  if (
    transaction.manifest.evidenceId !== plan.evidenceId ||
    transaction.recordTreePlanDigest !== plan.planDigest ||
    transaction.manifest.manifestDigest !== plan.manifest.manifestDigest
  ) {
    fail("input", "$plan");
  }
}

function assertProgressRelation(
  progress: Readonly<DirectoryTreeCandidateProgress>,
  plan: Readonly<ManagedEvidenceRecordTreePlan>,
): void {
  if (
    typeof progress !== "object" ||
    progress === null ||
    types.isProxy(progress) ||
    !Object.isFrozen(progress) ||
    progress.candidateRootPath !== plan.candidateRootPath ||
    progress.plan.treeDigest !== plan.directoryPlan.treeDigest ||
    (progress.status !== "complete" && progress.status !== "incomplete")
  ) {
    fail("input", "$progress");
  }
  const directories = new Set(plan.directoryPlan.directories);
  const files = new Set(plan.directoryPlan.files.map((file) => file.path));
  if (
    progress.missingDirectories.some((entry) => !directories.has(entry)) ||
    progress.missingFiles.some((entry) => !files.has(entry)) ||
    (progress.status === "complete" &&
      (progress.missingDirectories.length !== 0 ||
        progress.missingFiles.length !== 0)) ||
    (progress.status === "incomplete" &&
      progress.missingDirectories.length === 0 &&
      progress.missingFiles.length === 0)
  ) {
    fail("input", "$progress");
  }
}

function mapDirectoryError(error: DurableDirectoryMaterializationError): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "target-exists") fail("stage-conflict", "$payload");
  if (error.reason === "root-scope" || error.reason === "parent-changed") {
    fail("destination-root-scope", "$demandRoot");
  }
  if (
    error.reason === "target-symlink" ||
    error.reason === "target-not-directory" ||
    error.reason === "parent-symlink" ||
    error.reason === "parent-not-directory"
  ) {
    fail("stage-conflict", "$payload");
  }
  if (
    error.reason === "commit-uncertain" ||
    error.reason === "durability-failure" ||
    error.reason === "close-failure"
  ) {
    fail("recovery-required", "$payload");
  }
  fail("operation-failure", "$payload");
}

async function ensurePayloadRoot(
  demandRoot: RootedDirectory,
  plan: Readonly<ManagedEvidenceRecordTreePlan>,
  progress: Readonly<DirectoryTreeCandidateProgress>,
  signal: AbortSignal | undefined,
): Promise<PortableResourcePath> {
  const payloadRoot = joinDirectoryTreeCandidatePath(
    plan.candidateRootPath,
    PAYLOAD_REF,
  );
  if (!progress.missingDirectories.includes(PAYLOAD_REF)) return payloadRoot;
  try {
    await createDirectoryAtomically(demandRoot, payloadRoot, {
      mode: MANAGED_EVIDENCE_RECORD_DIRECTORY_MODE,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryMaterializationError) {
      mapDirectoryError(error);
    }
    throw error;
  }
  return payloadRoot;
}

function mapCopyError(error: DurableFileCopyCandidateError): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "capacity") fail("capacity", "$source");
  if (error.reason === "source-root-scope") {
    fail("source-root-scope", "$sourceRoot");
  }
  if (
    error.reason === "source-not-found" ||
    error.reason === "source-symlink" ||
    error.reason === "source-not-file" ||
    error.reason === "source-changed" ||
    error.reason === "source-mismatch"
  ) {
    fail("source-changed", "$source");
  }
  if (error.reason === "destination-root-scope") {
    fail("destination-root-scope", "$demandRoot");
  }
  if (
    error.reason === "destination-parent" ||
    error.reason === "target-exists" ||
    error.reason === "candidate-changed" ||
    error.reason === "cleanup-failure"
  ) {
    fail("stage-conflict", "$payload");
  }
  fail("operation-failure", "$payload");
}

async function materializeFilePayload(
  sourceRoot: RootedDirectory,
  demandRoot: RootedDirectory,
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
  plan: Readonly<ManagedEvidenceRecordTreePlan>,
  progress: Readonly<DirectoryTreeCandidateProgress>,
  signal: AbortSignal | undefined,
): Promise<readonly PortableResourcePath[]> {
  const payloadRoot = await ensurePayloadRoot(
    demandRoot,
    plan,
    progress,
    signal,
  );
  const manifestFile = transaction.manifest.payload.treeManifest.files[0];
  if (
    manifestFile === undefined ||
    manifestFile.ref !== CONTENT_REF ||
    transaction.manifest.payload.treeManifest.files.length !== 1
  ) {
    fail("input", "$transaction/manifest/payload");
  }
  if (!progress.missingFiles.includes(PAYLOAD_CONTENT_REF)) {
    return Object.freeze([]);
  }
  try {
    await copyFileToCandidateDurably(
      sourceRoot,
      demandRoot,
      transaction.manifest.source.path,
      joinDirectoryTreeCandidatePath(payloadRoot, CONTENT_REF),
      {
        byteCount: manifestFile.bytes,
        digest: manifestFile.digest,
      },
      {
        maximumBytes: manifestFile.bytes,
        mode: manifestFile.executable
          ? MANAGED_EVIDENCE_RECORD_EXECUTABLE_FILE_MODE
          : MANAGED_EVIDENCE_RECORD_FILE_MODE,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DurableFileCopyCandidateError) mapCopyError(error);
    throw error;
  }
  return Object.freeze([manifestFile.ref]);
}

async function openTreeSource(
  sourceRoot: RootedDirectory,
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
): Promise<RootedDirectory> {
  let observation;
  try {
    observation = await sourceRoot.inspectExistingResource(
      transaction.manifest.source.path,
      "$source",
    );
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      if (
        error.reason === "resource-not-found" ||
        error.reason === "ancestor-symlink" ||
        error.reason === "ancestor-type"
      ) {
        fail("source-changed", "$source");
      }
      fail("source-root-scope", "$sourceRoot");
    }
    throw error;
  }
  if (observation.node.kind !== "directory") {
    fail("source-changed", "$source");
  }
  let treeRoot: RootedDirectory | undefined;
  try {
    treeRoot = await RootedDirectory.open(observation.physicalPath, "$source");
    const current = await treeRoot.assertCurrent("$source");
    if (!sameFileNodeIdentity(current, observation.node)) {
      fail("source-changed", "$source");
    }
    return treeRoot;
  } catch (error: unknown) {
    if (treeRoot !== undefined) {
      try {
        await treeRoot.close();
      } catch {
        // 首个来源身份错误优先。
      }
    }
    if (error instanceof ManagedEvidencePublicationPayloadMaterializationError) {
      throw error;
    }
    if (error instanceof RootedDirectoryError) {
      fail("source-root-scope", "$sourceRoot");
    }
    throw error;
  }
}

function mapTransferError(
  error: LoadedArtifactTreeTransferCandidateError,
): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "capacity") fail("capacity", "$source");
  if (error.reason === "source-root-scope") {
    fail("source-root-scope", "$sourceRoot");
  }
  if (error.reason === "source-changed") fail("source-changed", "$source");
  if (error.reason === "destination-root-scope") {
    fail("destination-root-scope", "$demandRoot");
  }
  if (error.reason === "candidate-conflict") {
    fail("stage-conflict", "$payload");
  }
  fail("operation-failure", "$payload");
}

async function materializeTreePayload(
  sourceRoot: RootedDirectory,
  demandRoot: RootedDirectory,
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
  plan: Readonly<ManagedEvidenceRecordTreePlan>,
  signal: AbortSignal | undefined,
): Promise<readonly PortableResourcePath[]> {
  const treeRoot = await openTreeSource(sourceRoot, transaction);
  let copied: readonly PortableResourcePath[] | undefined;
  let failure: unknown;
  try {
    let transferPlan;
    try {
      transferPlan = planLoadedArtifactTreeTransfer(
        transaction.manifest.payload.treeManifest,
        joinDirectoryTreeCandidatePath(plan.candidateRootPath, PAYLOAD_REF),
        {
          directoryMode: MANAGED_EVIDENCE_RECORD_DIRECTORY_MODE,
          executableFileMode: MANAGED_EVIDENCE_RECORD_EXECUTABLE_FILE_MODE,
          regularFileMode: MANAGED_EVIDENCE_RECORD_FILE_MODE,
        },
      );
    } catch (error: unknown) {
      if (error instanceof LoadedArtifactTreeTransferPlanError) {
        fail(error.reason === "capacity" ? "capacity" : "input", "$plan");
      }
      throw error;
    }
    try {
      copied = (
        await materializeLoadedArtifactTreeTransferCandidate(
          treeRoot,
          demandRoot,
          transferPlan,
          signal === undefined ? undefined : { signal },
        )
      ).copiedFiles;
    } catch (error: unknown) {
      if (error instanceof LoadedArtifactTreeTransferCandidateError) {
        mapTransferError(error);
      }
      throw error;
    }
  } catch (error: unknown) {
    failure = error;
  }
  try {
    await treeRoot.close();
  } catch (error: unknown) {
    if (failure === undefined) failure = error;
  }
  if (failure !== undefined) {
    if (failure instanceof RootedDirectoryError) {
      fail("source-root-scope", "$sourceRoot");
    }
    throw failure;
  }
  if (copied === undefined) fail("operation-failure", "$payload");
  return copied;
}

/** 按Manifest资源类型稳定物化stage payload，不创建或解释Manifest marker。 */
export async function materializeManagedEvidencePublicationPayload(
  sourceRootValue: RootedDirectory,
  demandRootValue: RootedDirectory,
  transactionValue: unknown,
  planValue: unknown,
  progress: Readonly<DirectoryTreeCandidateProgress>,
  optionsValue: ManagedEvidencePublicationPayloadMaterializationOptions = {},
): Promise<readonly PortableResourcePath[]> {
  assertRoot(sourceRootValue, "$sourceRoot");
  assertRoot(demandRootValue, "$demandRoot");
  const options = parseOptions(optionsValue);
  if (options.signal?.aborted === true) fail("aborted", "$signal");
  const transaction = parseTransaction(transactionValue);
  const plan = parseRecordPlan(planValue);
  assertPlanRelation(transaction, plan);
  assertProgressRelation(progress, plan);
  return transaction.manifest.source.resourceType === "file"
    ? materializeFilePayload(
        sourceRootValue,
        demandRootValue,
        transaction,
        plan,
        progress,
        options.signal,
      )
    : materializeTreePayload(
        sourceRootValue,
        demandRootValue,
        transaction,
        plan,
        options.signal,
      );
}
