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
  DeterministicJsonDocumentError,
} from "../../foundation/data/deterministic-json-document.js";
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
import {
  StrictTextFileError,
} from "../../foundation/filesystem/strict-text-file.js";
import { parseByteCount, type ByteCount } from "../../foundation/numeric/byte-count.js";
import {
  admitWakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
} from "../../foundation/resource/resource-processing-contract.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  assertWakeflowMaintenanceGateContext,
  WakeflowMaintenanceGateError,
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
  WakeflowMaintenanceOperationIdError,
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
  readonly digest: Sha256Digest;
  readonly journalDigest: Sha256Digest;
  readonly journal: Readonly<WakeflowMaintenanceJournal>;
}

export interface WakeflowPreparedMaintenanceJournalRetirementReceipt {
  readonly disposition: "retired-prepared";
  readonly operationId: WakeflowMaintenanceOperationId;
  readonly journalDigest: Sha256Digest;
  readonly retirement: Readonly<ExactRegularFileUnlinkReceipt>;
}

/** 对一个 exact journal target 执行关闭作用域的 Foundation stage 恢复。 */
export async function recoverWakeflowMaintenanceJournalStages(
  root: RootedDirectory,
  operationIdValue: unknown,
): Promise<Readonly<DurableAtomicFileStageRecoveryReceipt>> {
  const operationId = admittedOperationId(operationIdValue);
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

function admittedOperationId(value: unknown): WakeflowMaintenanceOperationId {
  try {
    return parseWakeflowMaintenanceOperationId(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceOperationIdError) {
      fail("input", "$operationId");
    }
    throw error;
  }
}

function admittedJournalByteCount(bytes: Uint8Array): ByteCount {
  if (bytes.byteLength > WAKEFLOW_MAINTENANCE_JOURNAL_MAXIMUM_BYTES) {
    fail("capacity", "$journal");
  }
  return parseByteCount(bytes.byteLength, "$journal.byteCount");
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
  return admittedJournalByteCount(encodeUtf8(
    renderWakeflowMaintenanceJournal(journal),
  ));
}

function currentUserId(): bigint {
  if (process.platform === "win32" || typeof process.geteuid !== "function") {
    fail("source-policy", "$journal");
  }
  return BigInt(process.geteuid());
}

function assertGate(
  root: RootedDirectory,
  context: Readonly<WakeflowMaintenanceGateContext>,
): void {
  try {
    assertWakeflowMaintenanceGateContext(context, root);
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceGateError) {
      fail("gate", "$context");
    }
    throw error;
  }
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
  const operationId = admittedOperationId(operationIdValue);
  const resourcePath = wakeflowMaintenanceJournalRef(operationId);
  let read;
  try {
    read = await readDeterministicJsonFile(root, resourcePath, {
      maximumBytes: WAKEFLOW_MAINTENANCE_JOURNAL_MAXIMUM_BYTES,
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "too-large") fail("capacity", "$journal");
      if (error.reason === "not-found") fail("source", "$journal");
      if (error.reason === "symlink" || error.reason === "not-file") {
        fail("source-policy", "$journal");
      }
      fail("source", "$journal");
    }
    if (
      error instanceof StrictTextFileError
      || error instanceof DeterministicJsonDocumentError
    ) {
      fail("journal", "$journal");
    }
    throw error;
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
  const source = Object.freeze({
    operationId,
    resourcePath,
    node: read.node,
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
  const operationId = admittedOperationId(operationIdValue);
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
): Promise<Readonly<WakeflowMaintenanceJournalSource>> {
  assertGate(root, context);
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
  admittedJournalByteCount(bytes);
  const intendedDigest = computeWakeflowMaintenanceJournalDigest(journal);
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
  let source: Readonly<WakeflowMaintenanceJournalSource>;
  try {
    source = await readWakeflowMaintenanceJournal(root, context.operationId);
  } catch {
    fail("commit-uncertain", "$journal");
  }
  if (
    publication.resourcePath !== source.resourcePath
    || publication.digest !== source.digest
    || publication.byteCount !== source.node.byteCount
    || publication.node.deviceId !== source.node.deviceId
    || publication.node.inodeId !== source.node.inodeId
    || source.journal.intentDigest !== intentSource.intentDigest
    || source.journal.planDigest !== journal.planDigest
    || source.journalDigest !== intendedDigest
  ) {
    fail("commit-uncertain", "$journal");
  }
  return source;
}

/** 在有效 gate scope 内以CAS写入一个且仅一个合法 journal 后继。 */
export async function checkpointWakeflowMaintenanceJournal(
  root: RootedDirectory,
  context: Readonly<WakeflowMaintenanceGateContext>,
  intentSource: Readonly<WakeflowMaintenanceExecutionIntentSource>,
  sourceValue: Readonly<WakeflowMaintenanceJournalSource>,
  proposedValue: unknown,
): Promise<Readonly<WakeflowMaintenanceJournalSource>> {
  assertGate(root, context);
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
  const proposedBytes = encodeUtf8(renderWakeflowMaintenanceJournal(proposed));
  admittedJournalByteCount(proposedBytes);
  const proposedDigest = computeWakeflowMaintenanceJournalDigest(proposed);
  let replacement: Readonly<DurableAtomicFileReplaceResult>;
  try {
    replacement = await replaceFileAtomically(
      root,
      sourceValue.resourcePath,
      proposedBytes,
      {
        mode: 0o600,
        expected: Object.freeze({
          resourcePath: sourceValue.resourcePath,
          node: sourceValue.node,
          byteCount: sourceValue.node.byteCount,
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
  let source: Readonly<WakeflowMaintenanceJournalSource>;
  try {
    source = await readWakeflowMaintenanceJournal(root, context.operationId);
  } catch {
    fail("commit-uncertain", "$journal");
  }
  if (
    replacement.digest !== source.digest
    || replacement.byteCount !== source.node.byteCount
    || replacement.node.deviceId !== source.node.deviceId
    || replacement.node.inodeId !== source.node.inodeId
    || source.journalDigest !== proposedDigest
  ) {
    fail("commit-uncertain", "$journal");
  }
  return source;
}

/** 在同一有效 gate scope 内退休尚未执行任何 step 的 exact prepared journal。 */
export async function retirePreparedWakeflowMaintenanceJournal(
  root: RootedDirectory,
  context: Readonly<WakeflowMaintenanceGateContext>,
  sourceValue: Readonly<WakeflowMaintenanceJournalSource>,
): Promise<Readonly<WakeflowPreparedMaintenanceJournalRetirementReceipt>> {
  assertGate(root, context);
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
  try {
    await assertTransactionsEmpty(root);
  } catch {
    fail("commit-uncertain", "$journal");
  }
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
): Promise<void> {
  assertGate(root, context);
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
  try {
    await unlinkRegularFileExactly(
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
  try {
    await assertTransactionsEmpty(root);
  } catch {
    fail("commit-uncertain", "$journal");
  }
}
