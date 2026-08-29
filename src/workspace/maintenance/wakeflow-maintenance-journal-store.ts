import {
  createFileAtomically,
  replaceFileAtomically,
  DurableAtomicFileWriteError,
  type DurableAtomicFileReplaceResult,
  type DurableAtomicFileWriteResult,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  readDeterministicJsonFile,
} from "../../foundation/filesystem/deterministic-json-file.js";
import {
  recoverDurableAtomicFileStagesForTargets,
  DurableAtomicFileStageRecoveryError,
  type DurableAtomicFileStageRecoveryReceipt,
} from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import {
  unlinkRegularFileExactly,
  ExactRegularFileUnlinkError,
  type ExactRegularFileUnlinkReceipt,
} from "../../foundation/filesystem/exact-regular-file-unlink.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../../foundation/filesystem/stable-directory-read.js";
import {
  StableFileReadError,
} from "../../foundation/filesystem/stable-file-read.js";
import { parseByteCount, type ByteCount } from "../../foundation/numeric/byte-count.js";
import {
  admitWakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
} from "../../foundation/resource/resource-processing-contract.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  assertWakeflowMaintenanceGateContext,
  type WakeflowMaintenanceGateContext,
} from "./wakeflow-maintenance-gate.js";
import {
  assertWakeflowMaintenanceIntentAndJournalAreOnlyTransaction,
  assertWakeflowMaintenanceIntentIsOnlyTransactionPrefix,
  WakeflowMaintenanceExecutionIntentStoreError,
  type WakeflowMaintenanceExecutionIntentSource,
} from "./wakeflow-maintenance-execution-intent-store.js";
import {
  computeWakeflowMaintenanceJournalDigest,
  createPreparedWakeflowMaintenanceJournal,
  createWakeflowMaintenanceJournalResourceDeclaration,
  parseWakeflowMaintenanceJournal,
  isWakeflowMaintenanceJournalSuccessor,
  renderWakeflowMaintenanceJournal,
  WakeflowMaintenanceJournalError,
  type WakeflowMaintenanceJournal,
} from "./wakeflow-maintenance-journal.js";
import {
  parseWakeflowMaintenanceOperationId,
  wakeflowMaintenanceJournalRef,
  type WakeflowMaintenanceOperationId,
} from "./wakeflow-maintenance-operation-id.js";
import {
  WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF,
} from "./wakeflow-maintenance-resource-catalog.js";

/**
 * Wakeflow Workspace / Maintenance：prepared journal 的 gate-bound 物理 store。
 *
 * create 与 retire 只能在有效 MaintenanceGateContext 内执行；普通读取保持只读。
 * Journal只能在同operation immutable intent已经精确发布后创建；checkpoint期间目录
 * 必须只含intent+journal。Intent先退休后，prepared/terminal journal才能最终退休。
 */

export const WAKEFLOW_MAINTENANCE_JOURNAL_MAXIMUM_BYTES = parseByteCount(
  64 * 1024,
  "$maintenanceJournal.maximumBytes",
);

export interface WakeflowMaintenanceJournalSource {
  readonly operationId: WakeflowMaintenanceOperationId;
  readonly resourcePath: ReturnType<typeof wakeflowMaintenanceJournalRef>;
  readonly node: Readonly<FileNodeSnapshot>;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
  readonly journalDigest: Sha256Digest;
  readonly journal: Readonly<WakeflowMaintenanceJournal>;
}

export interface WakeflowPreparedMaintenanceJournalPublicationReceipt {
  readonly disposition: "prepared";
  readonly publication: Readonly<DurableAtomicFileWriteResult<"created">>;
  readonly source: Readonly<WakeflowMaintenanceJournalSource>;
}

export interface WakeflowPreparedMaintenanceJournalRetirementReceipt {
  readonly disposition: "retired-prepared";
  readonly operationId: WakeflowMaintenanceOperationId;
  readonly journalDigest: Sha256Digest;
  readonly retirement: Readonly<ExactRegularFileUnlinkReceipt>;
}

export interface WakeflowMaintenanceJournalCheckpointReceipt {
  readonly disposition: "checkpointed";
  readonly replacement: Readonly<DurableAtomicFileReplaceResult>;
  readonly source: Readonly<WakeflowMaintenanceJournalSource>;
}

export interface WakeflowTerminalMaintenanceJournalRetirementReceipt {
  readonly disposition: "retired-terminal";
  readonly operationId: WakeflowMaintenanceOperationId;
  readonly journalDigest: Sha256Digest;
  readonly retirement: Readonly<ExactRegularFileUnlinkReceipt>;
}

/** 对一个 exact journal target 执行关闭作用域的 Foundation stage 恢复。 */
export async function recoverWakeflowMaintenanceJournalStages(
  root: RootedDirectory,
  operationIdValue: unknown,
): Promise<Readonly<DurableAtomicFileStageRecoveryReceipt>> {
  let operationId: WakeflowMaintenanceOperationId;
  try {
    operationId = parseWakeflowMaintenanceOperationId(operationIdValue);
  } catch {
    fail("input", "$operationId");
  }
  try {
    const receipt = await recoverDurableAtomicFileStagesForTargets(
      root,
      Object.freeze([wakeflowMaintenanceJournalRef(operationId)]),
    );
    if (
      receipt.activeStageCount !== 0
      || receipt.unknownStageCount !== 0
    ) {
      fail("recovery-required", "$journalStage");
    }
    return receipt;
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceJournalStoreError) throw error;
    if (error instanceof DurableAtomicFileStageRecoveryError) {
      fail("recovery-required", "$journalStage");
    }
    throw error;
  }
}

export type WakeflowMaintenanceJournalStoreErrorReason =
  | "input"
  | "gate"
  | "transactions-shape"
  | "source"
  | "source-policy"
  | "journal"
  | "capacity"
  | "conflict"
  | "recovery-required"
  | "aborted"
  | "effect-failure"
  | "commit-uncertain";

const ERROR_MESSAGES = {
  input: "Wakeflow maintenance journal store input is invalid.",
  gate: "Wakeflow maintenance journal store requires the active matching gate.",
  "transactions-shape":
    "Wakeflow maintenance transaction resources have an invalid shape.",
  source: "Wakeflow maintenance journal source cannot be read stably.",
  "source-policy": "Wakeflow maintenance journal violates its node policy.",
  journal: "Wakeflow maintenance journal content is invalid.",
  capacity: "Wakeflow maintenance journal exceeds its capacity.",
  conflict: "Wakeflow maintenance journal changed before its exact effect.",
  "recovery-required": "Wakeflow maintenance journal requires explicit recovery.",
  aborted: "Wakeflow maintenance journal operation was aborted.",
  "effect-failure": "Wakeflow maintenance journal effect failed safely.",
  "commit-uncertain": "Wakeflow maintenance journal commit could not be proven.",
} as const satisfies Readonly<Record<
  WakeflowMaintenanceJournalStoreErrorReason,
  string
>>;

/** Maintenance journal store 失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceJournalStoreError extends Error {
  override readonly name = "WakeflowMaintenanceJournalStoreError";
  readonly code = "wakeflow-maintenance-journal-store" as const;
  readonly reason: WakeflowMaintenanceJournalStoreErrorReason;
  readonly path: string;

  constructor(reason: WakeflowMaintenanceJournalStoreErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const ISSUED_SOURCES = new WeakSet<object>();

function fail(
  reason: WakeflowMaintenanceJournalStoreErrorReason,
  path: string,
): never {
  throw new WakeflowMaintenanceJournalStoreError(reason, path);
}

/** 在任何bootstrap/gate效果前验证initial journal的持久表示容量。 */
export function assertWakeflowPreparedMaintenanceJournalCapacity(
  operationId: unknown,
  intentDigest: unknown,
  plan: unknown,
): ByteCount {
  let journal;
  try {
    journal = createPreparedWakeflowMaintenanceJournal(
      operationId,
      intentDigest,
      plan,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceJournalError) {
      fail("input", "$journal");
    }
    throw error;
  }
  const byteCount = encodeUtf8(
    renderWakeflowMaintenanceJournal(journal),
  ).byteLength;
  if (byteCount > WAKEFLOW_MAINTENANCE_JOURNAL_MAXIMUM_BYTES) {
    fail("capacity", "$journal");
  }
  return parseByteCount(byteCount, "$journal.byteCount");
}

function currentUserId(): bigint {
  if (process.platform === "win32" || typeof process.geteuid !== "function") {
    fail("source-policy", "$journal");
  }
  return BigInt(process.geteuid());
}

function admitOperation(
  operationId: WakeflowMaintenanceOperationId,
  recipe: "exclusive-create" | "exact-retire",
): void {
  const declaration = createWakeflowMaintenanceJournalResourceDeclaration(
    operationId,
  );
  try {
    admitWakeflowResourceOperation(declaration.processing, recipe);
  } catch (error: unknown) {
    if (error instanceof WakeflowResourceProcessingContractError) {
      fail("input", "$journal");
    }
    throw error;
  }
}

async function assertTransactionsEmpty(root: RootedDirectory): Promise<void> {
  try {
    await readStableResourceDirectory(
      root,
      WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF,
      { maximumEntries: 0 },
    );
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError) {
      if (error.reason === "too-many-entries") {
        fail("transactions-shape", "$transactions");
      }
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("source", "$transactions");
    }
    throw error;
  }
}

/** 在任何退休效果前证明 transactions 只含指定 exact journal。 */
export async function assertWakeflowMaintenanceJournalIsOnlyTransaction(
  root: RootedDirectory,
  sourceValue: Readonly<WakeflowMaintenanceJournalSource>,
): Promise<void> {
  if (
    typeof sourceValue !== "object"
    || sourceValue === null
    || !ISSUED_SOURCES.has(sourceValue)
  ) {
    fail("input", "$source");
  }
  let read;
  try {
    read = await readStableResourceDirectory(
      root,
      WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF,
      { maximumEntries: 1 },
    );
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError) {
      if (error.reason === "too-many-entries") {
        fail("transactions-shape", "$transactions");
      }
      fail("source", "$transactions");
    }
    throw error;
  }
  if (
    read.entries.length !== 1
    || read.entries[0]?.resourcePath !== sourceValue.resourcePath
  ) {
    fail("transactions-shape", "$transactions");
  }
}

/** 读取并严格复验一个 prepared journal。 */
export async function readWakeflowMaintenanceJournal(
  root: RootedDirectory,
  operationIdValue: unknown,
): Promise<Readonly<WakeflowMaintenanceJournalSource>> {
  let operationId: WakeflowMaintenanceOperationId;
  try {
    operationId = parseWakeflowMaintenanceOperationId(operationIdValue);
  } catch {
    fail("input", "$operationId");
  }
  const resourcePath = wakeflowMaintenanceJournalRef(operationId);
  let read;
  try {
    read = await readDeterministicJsonFile(root, resourcePath, {
      maximumBytes: WAKEFLOW_MAINTENANCE_JOURNAL_MAXIMUM_BYTES,
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "not-found") fail("source", "$journal");
      if (error.reason === "symlink" || error.reason === "not-file") {
        fail("source-policy", "$journal");
      }
      fail("source", "$journal");
    }
    fail("journal", "$journal");
  }
  if (
    read.node.kind !== "file"
    || read.node.permissionBits !== 0o600
    || read.node.linkCount !== 1n
    || read.node.userId !== currentUserId()
  ) {
    fail("source-policy", "$journal");
  }
  let journal: Readonly<WakeflowMaintenanceJournal>;
  try {
    journal = parseWakeflowMaintenanceJournal(read.value);
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceJournalError) {
      fail("journal", error.path);
    }
    throw error;
  }
  if (
    journal.operationId !== operationId
    || renderWakeflowMaintenanceJournal(journal) !== read.text
  ) {
    fail("journal", "$journal");
  }
  const journalDigest = computeWakeflowMaintenanceJournalDigest(journal);
  if (journalDigest !== read.semanticDigest) fail("journal", "$journal");
  const source = Object.freeze({
    operationId,
    resourcePath,
    node: read.node,
    byteCount: read.byteCount,
    digest: read.digest,
    journalDigest,
    journal,
  });
  ISSUED_SOURCES.add(source);
  return source;
}

/** 读取可选journal；absent与unsafe source严格区分。 */
export async function readWakeflowMaintenanceJournalOrNull(
  root: RootedDirectory,
  operationIdValue: unknown,
): Promise<Readonly<WakeflowMaintenanceJournalSource> | null> {
  let operationId: WakeflowMaintenanceOperationId;
  try {
    operationId = parseWakeflowMaintenanceOperationId(operationIdValue);
  } catch {
    fail("input", "$operationId");
  }
  try {
    await root.inspectExistingResource(wakeflowMaintenanceJournalRef(operationId));
  } catch (error: unknown) {
    if (
      error instanceof RootedDirectoryError
      && error.reason === "resource-not-found"
    ) {
      return null;
    }
    if (error instanceof RootedDirectoryError) fail("source", "$journal");
    throw error;
  }
  return readWakeflowMaintenanceJournal(root, operationId);
}

/** 在有效 gate scope 内 absent-only 发布一份 prepared journal。 */
export async function publishPreparedWakeflowMaintenanceJournal(
  root: RootedDirectory,
  context: Readonly<WakeflowMaintenanceGateContext>,
  intentSource: Readonly<WakeflowMaintenanceExecutionIntentSource>,
  planValue: unknown,
): Promise<Readonly<WakeflowPreparedMaintenanceJournalPublicationReceipt>> {
  try {
    assertWakeflowMaintenanceGateContext(context, root);
  } catch {
    fail("gate", "$context");
  }
  let journal: Readonly<WakeflowMaintenanceJournal>;
  try {
    journal = createPreparedWakeflowMaintenanceJournal(
      context.operationId,
      intentSource.intentDigest,
      planValue,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceJournalError) {
      fail("input", "$plan");
    }
    throw error;
  }
  if (
    intentSource.operationId !== context.operationId
    || intentSource.intent.planDigest !== journal.planDigest
  ) {
    fail("input", "$intentSource");
  }
  admitOperation(context.operationId, "exclusive-create");
  try {
    await assertWakeflowMaintenanceIntentIsOnlyTransactionPrefix(
      root,
      intentSource,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceExecutionIntentStoreError) {
      if (error.reason === "transactions-shape") {
        fail("transactions-shape", "$transactions");
      }
      fail("conflict", "$intent");
    }
    throw error;
  }
  const bytes = encodeUtf8(renderWakeflowMaintenanceJournal(journal));
  assertWakeflowPreparedMaintenanceJournalCapacity(
    context.operationId,
    intentSource.intentDigest,
    planValue,
  );
  let publication: Readonly<DurableAtomicFileWriteResult<"created">>;
  try {
    publication = await createFileAtomically(
      root,
      wakeflowMaintenanceJournalRef(context.operationId),
      bytes,
      { mode: 0o600 },
    );
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) {
      if (error.reason === "target-exists") fail("conflict", "$journal");
      if (error.reason === "stage-recovery-required") {
        fail("recovery-required", "$journal");
      }
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (
        error.reason === "commit-uncertain"
        || error.reason === "durability-failure"
        || error.reason === "stage-cleanup-failure"
        || error.reason === "close-failure"
      ) {
        fail("commit-uncertain", "$journal");
      }
      fail("effect-failure", "$journal");
    }
    throw error;
  }
  const source = await readWakeflowMaintenanceJournal(
    root,
    context.operationId,
  );
  if (
    publication.resourcePath !== source.resourcePath
    || publication.digest !== source.digest
    || publication.byteCount !== source.byteCount
    || publication.node.deviceId !== source.node.deviceId
    || publication.node.inodeId !== source.node.inodeId
    || source.journal.intentDigest !== intentSource.intentDigest
    || source.journal.planDigest !== journal.planDigest
  ) {
    fail("commit-uncertain", "$journal");
  }
  return Object.freeze({ disposition: "prepared", publication, source });
}

/** 在有效 gate scope 内以CAS写入一个且仅一个合法 journal 后继。 */
export async function checkpointWakeflowMaintenanceJournal(
  root: RootedDirectory,
  context: Readonly<WakeflowMaintenanceGateContext>,
  intentSource: Readonly<WakeflowMaintenanceExecutionIntentSource>,
  sourceValue: Readonly<WakeflowMaintenanceJournalSource>,
  proposedValue: unknown,
): Promise<Readonly<WakeflowMaintenanceJournalCheckpointReceipt>> {
  try {
    assertWakeflowMaintenanceGateContext(context, root);
  } catch {
    fail("gate", "$context");
  }
  if (
    typeof sourceValue !== "object"
    || sourceValue === null
    || !ISSUED_SOURCES.has(sourceValue)
    || sourceValue.operationId !== context.operationId
  ) {
    fail("input", "$source");
  }
  let proposed: Readonly<WakeflowMaintenanceJournal>;
  try {
    proposed = parseWakeflowMaintenanceJournal(proposedValue);
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceJournalError) {
      fail("journal", "$proposed");
    }
    throw error;
  }
  if (!isWakeflowMaintenanceJournalSuccessor(sourceValue.journal, proposed)) {
    fail("input", "$proposed");
  }
  const declaration = createWakeflowMaintenanceJournalResourceDeclaration(
    context.operationId,
  );
  try {
    admitWakeflowResourceOperation(
      declaration.processing,
      "exact-source-replace",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowResourceProcessingContractError) {
      fail("input", "$journal");
    }
    throw error;
  }
  if (
    intentSource.operationId !== context.operationId
    || sourceValue.journal.intentDigest !== intentSource.intentDigest
  ) {
    fail("input", "$intentSource");
  }
  try {
    await assertWakeflowMaintenanceIntentAndJournalAreOnlyTransaction(
      root,
      intentSource,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceExecutionIntentStoreError) {
      if (error.reason === "transactions-shape") {
        fail("transactions-shape", "$transactions");
      }
      fail("conflict", "$intent");
    }
    throw error;
  }
  const current = await readWakeflowMaintenanceJournal(
    root,
    context.operationId,
  );
  if (
    current.digest !== sourceValue.digest
    || current.journalDigest !== sourceValue.journalDigest
    || current.node.deviceId !== sourceValue.node.deviceId
    || current.node.inodeId !== sourceValue.node.inodeId
  ) {
    fail("conflict", "$journal");
  }
  let replacement: Readonly<DurableAtomicFileReplaceResult>;
  try {
    replacement = await replaceFileAtomically(
      root,
      sourceValue.resourcePath,
      encodeUtf8(renderWakeflowMaintenanceJournal(proposed)),
      {
        mode: 0o600,
        expected: Object.freeze({
          resourcePath: sourceValue.resourcePath,
          node: sourceValue.node,
          byteCount: sourceValue.byteCount,
          digest: sourceValue.digest,
        }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) {
      if (error.reason === "input") fail("input", error.path);
      if (
        error.reason === "expectation-changed"
        || error.reason === "expectation-read-failure"
        || error.reason === "target-exists"
      ) {
        fail("conflict", "$journal");
      }
      if (error.reason === "stage-recovery-required") {
        fail("recovery-required", "$journal");
      }
      if (
        error.reason === "commit-uncertain"
        || error.reason === "durability-failure"
        || error.reason === "stage-cleanup-failure"
        || error.reason === "close-failure"
      ) {
        fail("commit-uncertain", "$journal");
      }
      fail("effect-failure", "$journal");
    }
    throw error;
  }
  const source = await readWakeflowMaintenanceJournal(
    root,
    context.operationId,
  );
  if (
    replacement.digest !== source.digest
    || replacement.byteCount !== source.byteCount
    || replacement.node.deviceId !== source.node.deviceId
    || replacement.node.inodeId !== source.node.inodeId
    || source.journalDigest !== computeWakeflowMaintenanceJournalDigest(proposed)
  ) {
    fail("commit-uncertain", "$journal");
  }
  return Object.freeze({ disposition: "checkpointed", replacement, source });
}

/** 在同一有效 gate scope 内退休尚未执行任何 step 的 exact prepared journal。 */
export async function retirePreparedWakeflowMaintenanceJournal(
  root: RootedDirectory,
  context: Readonly<WakeflowMaintenanceGateContext>,
  sourceValue: Readonly<WakeflowMaintenanceJournalSource>,
): Promise<Readonly<WakeflowPreparedMaintenanceJournalRetirementReceipt>> {
  try {
    assertWakeflowMaintenanceGateContext(context, root);
  } catch {
    fail("gate", "$context");
  }
  if (
    typeof sourceValue !== "object"
    || sourceValue === null
    || !ISSUED_SOURCES.has(sourceValue)
    || sourceValue.operationId !== context.operationId
    || sourceValue.journal.checkpoint !== 0
    || sourceValue.journal.state !== "prepared"
  ) {
    fail("input", "$source");
  }
  admitOperation(context.operationId, "exact-retire");
  await assertWakeflowMaintenanceJournalIsOnlyTransaction(root, sourceValue);
  const current = await readWakeflowMaintenanceJournal(
    root,
    context.operationId,
  );
  if (
    current.digest !== sourceValue.digest
    || current.journalDigest !== sourceValue.journalDigest
    || current.node.deviceId !== sourceValue.node.deviceId
    || current.node.inodeId !== sourceValue.node.inodeId
  ) {
    fail("conflict", "$journal");
  }
  let retirement: Readonly<ExactRegularFileUnlinkReceipt>;
  try {
    retirement = await unlinkRegularFileExactly(
      root,
      sourceValue.resourcePath,
      { expectedNode: sourceValue.node },
    );
  } catch (error: unknown) {
    if (error instanceof ExactRegularFileUnlinkError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (
        error.reason === "source-changed"
        || error.reason === "source-not-found"
      ) {
        fail("conflict", "$journal");
      }
      if (
        error.reason === "commit-uncertain"
        || error.reason === "durability-failure"
        || error.reason === "close-failure"
      ) {
        fail("commit-uncertain", "$journal");
      }
      fail("effect-failure", "$journal");
    }
    throw error;
  }
  await assertTransactionsEmpty(root);
  return Object.freeze({
    disposition: "retired-prepared",
    operationId: context.operationId,
    journalDigest: sourceValue.journalDigest,
    retirement,
  });
}

/** 在同一有效 gate scope 内退休已经terminal的exact journal。 */
export async function retireTerminalWakeflowMaintenanceJournal(
  root: RootedDirectory,
  context: Readonly<WakeflowMaintenanceGateContext>,
  sourceValue: Readonly<WakeflowMaintenanceJournalSource>,
): Promise<Readonly<WakeflowTerminalMaintenanceJournalRetirementReceipt>> {
  try {
    assertWakeflowMaintenanceGateContext(context, root);
  } catch {
    fail("gate", "$context");
  }
  if (
    typeof sourceValue !== "object"
    || sourceValue === null
    || !ISSUED_SOURCES.has(sourceValue)
    || sourceValue.operationId !== context.operationId
    || sourceValue.journal.state !== "terminal"
    || sourceValue.journal.affectedStepId !== null
    || sourceValue.journal.checkpoint !== sourceValue.journal.stepIds.length
  ) {
    fail("input", "$source");
  }
  admitOperation(context.operationId, "exact-retire");
  await assertWakeflowMaintenanceJournalIsOnlyTransaction(root, sourceValue);
  const current = await readWakeflowMaintenanceJournal(
    root,
    context.operationId,
  );
  if (
    current.digest !== sourceValue.digest
    || current.journalDigest !== sourceValue.journalDigest
    || current.node.deviceId !== sourceValue.node.deviceId
    || current.node.inodeId !== sourceValue.node.inodeId
  ) {
    fail("conflict", "$journal");
  }
  let retirement: Readonly<ExactRegularFileUnlinkReceipt>;
  try {
    retirement = await unlinkRegularFileExactly(
      root,
      sourceValue.resourcePath,
      { expectedNode: sourceValue.node },
    );
  } catch (error: unknown) {
    if (error instanceof ExactRegularFileUnlinkError) {
      if (
        error.reason === "source-changed"
        || error.reason === "source-not-found"
      ) {
        fail("conflict", "$journal");
      }
      if (
        error.reason === "commit-uncertain"
        || error.reason === "durability-failure"
        || error.reason === "close-failure"
      ) {
        fail("commit-uncertain", "$journal");
      }
      fail("effect-failure", "$journal");
    }
    throw error;
  }
  await assertTransactionsEmpty(root);
  return Object.freeze({
    disposition: "retired-terminal",
    operationId: context.operationId,
    journalDigest: sourceValue.journalDigest,
    retirement,
  });
}
