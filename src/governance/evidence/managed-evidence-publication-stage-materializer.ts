import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import { joinDirectoryTreeCandidatePath } from "../../foundation/filesystem/directory-tree-candidate-plan.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  createDirectoryAtomically,
  DurableDirectoryMaterializationError,
} from "../../foundation/filesystem/durable-directory-materialization.js";
import {
  type DirectoryTreeCandidateProgress,
  type DirectoryTreeCandidateResult,
  DurableDirectoryTreeCandidateError,
  inspectDirectoryTreeCandidate,
  inspectDirectoryTreeCandidateProgress,
} from "../../foundation/filesystem/durable-directory-tree-candidate.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import { isPrivateDirectory } from "../../foundation/filesystem/private-node-policy.js";
import {
  type RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import { throwIfAborted } from "../../foundation/node/abort-signal.js";
import {
  admitWakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
} from "../../foundation/resource/resource-processing-contract.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { settleStagesOfDeadWritersStrictly } from "../../kernel/workspace-locks.js";
import { renderManagedEvidenceManifest } from "./managed-evidence-manifest.js";
import {
  ManagedEvidencePublicationPayloadMaterializationError,
  materializeManagedEvidencePublicationPayload,
} from "./managed-evidence-publication-payload-materializer.js";
import {
  deriveManagedEvidencePublicationRecordTreePlan,
  type ManagedEvidencePublicationTransaction,
} from "./managed-evidence-publication-transaction.js";
import {
  ManagedEvidencePublicationTransactionStoreError,
  requireCurrentManagedEvidencePublicationTransaction,
  type StoredManagedEvidencePublicationTransaction,
} from "./managed-evidence-publication-transaction-store.js";
import {
  MANAGED_EVIDENCE_RECORD_DIRECTORY_MODE,
  MANAGED_EVIDENCE_RECORD_FILE_MODE,
  type ManagedEvidenceRecordTreePlan,
} from "./managed-evidence-record-tree-plan.js";
import { createManagedEvidenceRootResourceDeclaration } from "./managed-evidence-resource-catalog.js";
import {
  MANAGED_EVIDENCE_MANIFEST_FILE_NAME,
  MANAGED_EVIDENCE_ROOT_REF,
} from "./managed-evidence-resource-paths.js";

/**
 * Wakeflow Governance / Evidence：journal授权的source→stage耐久物化owner。
 *
 * Materializer先证明固定journal与输入Transaction完全一致，再创建可选Evidence容器
 * 和同ID stage。完整stage直接复用，不重新读取source；partial stage只有在Manifest
 * marker尚未出现时才能补齐。tree source复用Loaded Artifact transfer的前后整树
 * identity检查，file source复用稳定streaming copy。payload关闭后最后原子写入
 * `manifest.json`，随后按完整record plan复验stage。
 *
 * 本模块不打开Config逻辑根、不追加Event、不发布final、不退休stage或journal，也不
 * 判断Event前取消或Event后恢复。sourceRoot必须由未来Application按当前Config准入。
 */

export interface ManagedEvidencePublicationStageMaterializationOptions {
  readonly signal?: AbortSignal;
}

export interface ManagedEvidencePublicationStageMaterializationResult {
  readonly transactionDigest: Sha256Digest;
  readonly candidate: Readonly<DirectoryTreeCandidateResult>;
  readonly copiedPayloadFiles: readonly PortableResourcePath[];
  readonly manifestPublication: "created" | "existing";
}

export type ManagedEvidencePublicationStageMaterializationErrorReason =
  | "input"
  | "journal"
  | "source-root-scope"
  | "source-changed"
  | "destination-root-scope"
  | "stage-conflict"
  | "capacity"
  | "recovery-required"
  | "operation-failure";

/** Stage物化无法证明同一journal/source/record plan时的稳定错误。 */
export class ManagedEvidencePublicationStageMaterializationError extends ModuleError<ManagedEvidencePublicationStageMaterializationErrorReason> {
  static override readonly code = "wakeflow-managed-evidence-publication-stage-materialization";
}

const fail: Fail<ManagedEvidencePublicationStageMaterializationErrorReason> = failWith(
  ManagedEvidencePublicationStageMaterializationError,
);

const MANIFEST_REF = parsePortableResourcePath(MANAGED_EVIDENCE_MANIFEST_FILE_NAME);

function mapStoreError(error: ManagedEvidencePublicationTransactionStoreError): never {
  if (error.reason === "root-scope") {
    fail("destination-root-scope", "$demandRoot");
  }
  if (error.reason === "capacity") fail("capacity", "$journal");
  fail("journal", "$journal");
}

async function loadExactJournal(
  demandRoot: RootedDirectory,
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
  signal: AbortSignal | undefined,
  expectedNode?: Readonly<FileNodeSnapshot>,
): Promise<Readonly<StoredManagedEvidencePublicationTransaction>> {
  let stored: Awaited<ReturnType<typeof requireCurrentManagedEvidencePublicationTransaction>>;
  try {
    stored = await requireCurrentManagedEvidencePublicationTransaction(
      demandRoot,
      transaction,
      expectedNode,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof ManagedEvidencePublicationTransactionStoreError) {
      mapStoreError(error);
    }
    throw error;
  }
  return stored;
}

function admitEvidenceRootMaterialization(
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
): void {
  const declaration = createManagedEvidenceRootResourceDeclaration(transaction.manifest.demandId);
  try {
    admitWakeflowResourceOperation(declaration.processing, "materialize-directory");
  } catch (error: unknown) {
    if (error instanceof WakeflowResourceProcessingContractError) {
      fail("operation-failure", "$catalog", error);
    }
    throw error;
  }
}

function mapDirectoryError(
  error: DurableDirectoryMaterializationError,
  path: "$managedEvidenceRoot" | "$stage",
): "existing" | never {
  if (error.reason === "target-exists") return "existing";
  if (error.reason === "root-scope" || error.reason === "parent-changed") {
    fail("destination-root-scope", "$demandRoot");
  }
  if (
    error.reason === "target-symlink" ||
    error.reason === "target-not-directory" ||
    error.reason === "parent-symlink" ||
    error.reason === "parent-not-directory"
  ) {
    fail("stage-conflict", path);
  }
  if (error.commitUncertain) fail("recovery-required", path);
  fail("operation-failure", path, error);
}

async function ensureEvidenceRoot(
  demandRoot: RootedDirectory,
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
  signal: AbortSignal | undefined,
): Promise<void> {
  admitEvidenceRootMaterialization(transaction);
  await ensureDirectory(demandRoot, MANAGED_EVIDENCE_ROOT_REF, "$managedEvidenceRoot", signal);
  let observation: Awaited<ReturnType<RootedDirectory["inspectExistingResource"]>>;
  try {
    observation = await demandRoot.inspectExistingResource(
      MANAGED_EVIDENCE_ROOT_REF,
      "$managedEvidenceRoot",
    );
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      fail("destination-root-scope", "$demandRoot", error);
    }
    throw error;
  }
  if (!isPrivateDirectory(observation.node)) fail("stage-conflict", "$managedEvidenceRoot");
}

async function ensureDirectory(
  demandRoot: RootedDirectory,
  ref: PortableResourcePath,
  path: "$managedEvidenceRoot" | "$stage",
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await createDirectoryAtomically(demandRoot, ref, {
      mode: MANAGED_EVIDENCE_RECORD_DIRECTORY_MODE,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryMaterializationError) {
      if (mapDirectoryError(error, path) === "existing") return;
    }
    throw error;
  }
}

function mapCandidateError(error: DurableDirectoryTreeCandidateError): never {
  if (error.reason === "capacity") fail("capacity", "$stage");
  if (
    error.reason === "tree-conflict" ||
    error.reason === "source-changed" ||
    error.reason === "path-conflict" ||
    error.reason === "target-exists" ||
    error.reason === "file-order"
  ) {
    fail("stage-conflict", "$stage");
  }
  if (error.reason === "input") fail("input", error.path);
  fail("operation-failure", "$stage", error);
}

async function inspectProgress(
  demandRoot: RootedDirectory,
  plan: Readonly<ManagedEvidenceRecordTreePlan>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DirectoryTreeCandidateProgress>> {
  try {
    return await inspectDirectoryTreeCandidateProgress(
      demandRoot,
      plan.candidateRootPath,
      plan.directoryPlan,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      mapCandidateError(error);
    }
    throw error;
  }
}

async function inspectComplete(
  demandRoot: RootedDirectory,
  plan: Readonly<ManagedEvidenceRecordTreePlan>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DirectoryTreeCandidateResult>> {
  try {
    return await inspectDirectoryTreeCandidate(
      demandRoot,
      plan.candidateRootPath,
      plan.directoryPlan,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      mapCandidateError(error);
    }
    throw error;
  }
}

function assertManifestIsLast(progress: Readonly<DirectoryTreeCandidateProgress>): void {
  const manifestMissing = progress.missingFiles.includes(MANIFEST_REF);
  if (progress.status === "incomplete" && !manifestMissing) {
    fail("stage-conflict", "$stage/manifest");
  }
}

function mapPayloadError(error: ManagedEvidencePublicationPayloadMaterializationError): never {
  if (error.reason === "capacity") fail("capacity", "$source");
  if (error.reason === "source-root-scope") {
    fail("source-root-scope", "$sourceRoot");
  }
  if (error.reason === "source-changed") {
    fail("source-changed", "$source");
  }
  if (error.reason === "destination-root-scope") {
    fail("destination-root-scope", "$demandRoot");
  }
  if (error.reason === "stage-conflict") {
    fail("stage-conflict", "$stage");
  }
  if (error.reason === "recovery-required") {
    fail("recovery-required", "$stage");
  }
  if (error.reason === "input") fail("input", "$payload");
  fail("operation-failure", "$payload", error);
}

function onlyManifestMissing(progress: Readonly<DirectoryTreeCandidateProgress>): boolean {
  return (
    progress.status === "incomplete" &&
    progress.missingDirectories.length === 0 &&
    progress.missingFiles.length === 1 &&
    progress.missingFiles[0] === MANIFEST_REF
  );
}

function assertOnlyManifestMissing(progress: Readonly<DirectoryTreeCandidateProgress>): void {
  if (!onlyManifestMissing(progress)) fail("stage-conflict", "$stage");
}

function mapManifestWriteError(error: DurableAtomicFileWriteError): never {
  if (error.reason === "capacity") fail("capacity", "$manifest");
  if (error.reason === "root-scope") {
    fail("destination-root-scope", "$demandRoot");
  }
  if (error.commitUncertain || error.reason === "stage-recovery-required") {
    fail("recovery-required", "$manifest");
  }
  fail("operation-failure", "$manifest", error);
}

async function publishManifest(
  demandRoot: RootedDirectory,
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
  plan: Readonly<ManagedEvidenceRecordTreePlan>,
  signal: AbortSignal | undefined,
): Promise<"created" | "existing"> {
  const manifestRef = joinDirectoryTreeCandidatePath(plan.candidateRootPath, MANIFEST_REF);
  const bytes = encodeUtf8(renderManagedEvidenceManifest(transaction.manifest), "$manifest");
  try {
    await createFileAtomically(demandRoot, manifestRef, bytes, {
      mode: MANAGED_EVIDENCE_RECORD_FILE_MODE,
      ...(signal === undefined ? {} : { signal }),
    });
    return "created";
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError && error.reason === "target-exists") {
      // 同一journal并发winner可能已经发布Manifest；完整stage复验决定能否接纳。
      await inspectComplete(demandRoot, plan, undefined);
      return "existing";
    }
    if (error instanceof DurableAtomicFileWriteError) {
      mapManifestWriteError(error);
    }
    throw error;
  }
}

/** 从exact journal指定的source物化或重用一棵完整耐久stage。 */
export async function materializeManagedEvidencePublicationStage(
  sourceRootValue: RootedDirectory | null,
  demandRootValue: RootedDirectory,
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
  options: ManagedEvidencePublicationStageMaterializationOptions = {},
): Promise<Readonly<ManagedEvidencePublicationStageMaterializationResult>> {
  throwIfAborted(options.signal);
  const stored = await loadExactJournal(demandRootValue, transaction, options.signal);
  const plan = deriveManagedEvidencePublicationRecordTreePlan(transaction);
  await ensureEvidenceRoot(demandRootValue, transaction, options.signal);
  await ensureDirectory(demandRootValue, plan.candidateRootPath, "$stage", options.signal);
  await settleStagesOfDeadWritersStrictly(
    demandRootValue,
    Object.freeze([joinDirectoryTreeCandidatePath(plan.candidateRootPath, MANIFEST_REF)]),
    "matching",
    options.signal,
    (cause) =>
      cause?.reason === "root-scope"
        ? fail("destination-root-scope", "$demandRoot", cause)
        : fail("recovery-required", "$manifest/stage", cause),
  );
  let progress = await inspectProgress(demandRootValue, plan, options.signal);
  if (progress.status === "complete") {
    await loadExactJournal(demandRootValue, transaction, options.signal, stored.source.node);
    return Object.freeze({
      transactionDigest: stored.transactionDigest,
      candidate: await inspectComplete(demandRootValue, plan, options.signal),
      copiedPayloadFiles: Object.freeze([]),
      manifestPublication: "existing",
    });
  }
  assertManifestIsLast(progress);

  let copiedPayloadFiles: readonly PortableResourcePath[] = Object.freeze([]);
  if (!onlyManifestMissing(progress)) {
    try {
      copiedPayloadFiles = await materializeManagedEvidencePublicationPayload(
        sourceRootValue,
        demandRootValue,
        transaction,
        plan,
        progress,
        options.signal === undefined ? undefined : { signal: options.signal },
      );
    } catch (error: unknown) {
      if (error instanceof ManagedEvidencePublicationPayloadMaterializationError) {
        mapPayloadError(error);
      }
      throw error;
    }
    progress = await inspectProgress(demandRootValue, plan, options.signal);
  }
  assertOnlyManifestMissing(progress);
  await loadExactJournal(demandRootValue, transaction, options.signal, stored.source.node);
  const manifestPublication = await publishManifest(
    demandRootValue,
    transaction,
    plan,
    options.signal,
  );
  // Manifest提交后忽略取消，必须完成stage与journal readback或报告恢复需求。
  let candidate: Readonly<DirectoryTreeCandidateResult>;
  try {
    candidate = await inspectComplete(demandRootValue, plan, undefined);
    await loadExactJournal(demandRootValue, transaction, undefined, stored.source.node);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidencePublicationStageMaterializationError) {
      fail("recovery-required", "$stage", error);
    }
    throw error;
  }
  return Object.freeze({
    transactionDigest: stored.transactionDigest,
    candidate,
    copiedPayloadFiles,
    manifestPublication,
  });
}
