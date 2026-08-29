import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  inspectRootedExclusiveFileLock,
  retireRootedExclusiveFileLockResidue,
  RootedExclusiveFileLockError,
} from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import {
  withExistingWakeflowMaintenanceGate,
  WakeflowMaintenanceGateError,
  type WakeflowExistingMaintenanceGateOptions,
} from "./wakeflow-maintenance-gate.js";
import {
  assertWakeflowMaintenanceJournalIsOnlyTransaction,
  publishPreparedWakeflowMaintenanceJournal,
  recoverWakeflowMaintenanceJournalStages,
  readWakeflowMaintenanceJournalOrNull,
  retirePreparedWakeflowMaintenanceJournal,
  WakeflowMaintenanceJournalStoreError,
  type WakeflowPreparedMaintenanceJournalRetirementReceipt,
} from "./wakeflow-maintenance-journal-store.js";
import {
  wakeflowMaintenanceExecutionPlanFromIntent,
} from "./wakeflow-maintenance-execution-intent.js";
import {
  assertWakeflowMaintenanceIntentAndJournalAreOnlyTransaction,
  assertWakeflowMaintenanceIntentIsOnlyTransactionPrefix,
  readWakeflowMaintenanceExecutionIntentOrNull,
  recoverWakeflowMaintenanceExecutionIntentStages,
  retireWakeflowMaintenanceExecutionIntent,
  WakeflowMaintenanceExecutionIntentStoreError,
  type WakeflowMaintenanceExecutionIntentRetirementReceipt,
} from "./wakeflow-maintenance-execution-intent-store.js";
import {
  parseWakeflowMaintenanceOperationId,
  wakeflowMaintenanceOperationUuid,
  type WakeflowMaintenanceOperationId,
} from "./wakeflow-maintenance-operation-id.js";
import {
  WAKEFLOW_MAINTENANCE_GATE_REF,
} from "./wakeflow-maintenance-resource-catalog.js";
import {
  inspectWakeflowWorkspaceCoreLayout,
} from "./wakeflow-workspace-core-layout-inspection.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";

/**
 * Wakeflow Workspace / Maintenance：checkpoint 0 prepared transaction 的取消恢复。
 *
 * 本恢复从磁盘intent重建exact plan；若旧gate残留，则要求token UUID匹配operation且
 * owner inactive。随后以同一operation ID取得gate，按intent→prepared journal顺序退休。
 * 任何step执行迹象都不属于本取消能力。
 */

export interface WakeflowPreparedMaintenanceRecoveryReceipt {
  readonly kind: "WakeflowPreparedMaintenanceRecoveryReceipt";
  readonly operationId: WakeflowMaintenanceOperationId;
  readonly retiredPreviousGateDigest: Sha256Digest | null;
  readonly intentRetirement:
    Readonly<WakeflowMaintenanceExecutionIntentRetirementReceipt> | null;
  readonly journalRetirement:
    Readonly<WakeflowPreparedMaintenanceJournalRetirementReceipt>;
  readonly coreLayoutInspectionDigest: Sha256Digest;
}

export type WakeflowPreparedMaintenanceRecoveryErrorReason =
  | "input"
  | "intent"
  | "transaction"
  | "plan-mismatch"
  | "operation-mismatch"
  | "owner-active-or-unknown"
  | "gate"
  | "journal"
  | "recovery-required";

const ERROR_MESSAGES = {
  input: "Wakeflow prepared maintenance recovery input is invalid.",
  intent: "Wakeflow prepared maintenance recovery intent is unavailable or unsafe.",
  transaction: "Wakeflow prepared maintenance transaction resources have an invalid shape.",
  "plan-mismatch": "Wakeflow prepared journal differs from the confirmed execution plan.",
  "operation-mismatch": "Wakeflow prepared gate belongs to another operation.",
  "owner-active-or-unknown":
    "Wakeflow prepared gate owner is active or cannot be proven inactive.",
  gate: "Wakeflow prepared recovery could not acquire its gate.",
  journal: "Wakeflow prepared journal is unavailable or unsafe.",
  "recovery-required": "Wakeflow prepared maintenance recovery remains incomplete.",
} as const satisfies Readonly<Record<
  WakeflowPreparedMaintenanceRecoveryErrorReason,
  string
>>;

/** Prepared maintenance 取消恢复失败的稳定、脱敏错误。 */
export class WakeflowPreparedMaintenanceRecoveryError extends Error {
  override readonly name = "WakeflowPreparedMaintenanceRecoveryError";
  readonly code = "wakeflow-prepared-maintenance-recovery" as const;
  readonly reason: WakeflowPreparedMaintenanceRecoveryErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowPreparedMaintenanceRecoveryErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: WakeflowPreparedMaintenanceRecoveryErrorReason,
  path: string,
): never {
  throw new WakeflowPreparedMaintenanceRecoveryError(reason, path);
}

/** 取消一笔尚未尝试任何 step 的 prepared maintenance transaction。 */
export async function recoverPreparedWakeflowMaintenanceTransaction(
  root: RootedDirectory,
  operationIdValue: unknown,
  options: WakeflowExistingMaintenanceGateOptions = {},
): Promise<Readonly<WakeflowPreparedMaintenanceRecoveryReceipt>> {
  let operationId: WakeflowMaintenanceOperationId;
  try {
    operationId = parseWakeflowMaintenanceOperationId(operationIdValue);
  } catch {
    fail("input", "$operationId");
  }
  let intentSource;
  let source;
  try {
    await recoverWakeflowMaintenanceExecutionIntentStages(root, operationId);
    await recoverWakeflowMaintenanceJournalStages(root, operationId);
    intentSource = await readWakeflowMaintenanceExecutionIntentOrNull(
      root,
      operationId,
    );
    source = await readWakeflowMaintenanceJournalOrNull(root, operationId);
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceExecutionIntentStoreError) {
      fail(
        error.reason === "transactions-shape" ? "transaction" : "intent",
        error.reason === "transactions-shape" ? "$transactions" : "$intent",
      );
    }
    if (error instanceof WakeflowMaintenanceJournalStoreError) {
      fail(
        error.reason === "transactions-shape" ? "transaction" : "journal",
        error.reason === "transactions-shape" ? "$transactions" : "$journal",
      );
    }
    throw error;
  }
  if (intentSource === null && source === null) fail("journal", "$journal");
  const plan = intentSource === null
    ? null
    : wakeflowMaintenanceExecutionPlanFromIntent(intentSource.intent);
  if (source !== null && intentSource !== null) {
    if (plan === null) fail("plan-mismatch", "$intent");
    if (
      source.journal.intentDigest !== intentSource.intentDigest
      || source.journal.planDigest !== plan.planDigest
      || source.journal.action !== plan.sharedPreview.action
      || source.journal.matrixDigest !== plan.sharedPreview.matrixDigest
      || source.journal.currentConfigDigest
        !== plan.sharedPreview.currentConfigDigest
      || source.journal.desiredConfigDigest
        !== plan.sharedPreview.desiredConfigDigest
      || source.journal.stepIds.length !== plan.steps.length
      || source.journal.stepIds.some((stepId, index) => (
        stepId !== plan.steps[index]?.stepId
      ))
    ) {
      fail("plan-mismatch", "$intent");
    }
  }
  try {
    if (intentSource !== null && source !== null) {
      await assertWakeflowMaintenanceIntentAndJournalAreOnlyTransaction(
        root,
        intentSource,
      );
    } else if (intentSource !== null) {
      await assertWakeflowMaintenanceIntentIsOnlyTransactionPrefix(
        root,
        intentSource,
      );
    } else if (source !== null) {
      await assertWakeflowMaintenanceJournalIsOnlyTransaction(root, source);
    }
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceExecutionIntentStoreError) {
      fail(
        error.reason === "transactions-shape" ? "transaction" : "intent",
        error.reason === "transactions-shape" ? "$transactions" : "$intent",
      );
    }
    if (error instanceof WakeflowMaintenanceJournalStoreError) {
      fail(
        error.reason === "transactions-shape" ? "transaction" : "journal",
        error.reason === "transactions-shape" ? "$transactions" : "$journal",
      );
    }
    throw error;
  }
  let oldGate;
  try {
    oldGate = await inspectRootedExclusiveFileLock(
      root,
      WAKEFLOW_MAINTENANCE_GATE_REF,
    );
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) fail("gate", "$gate");
    throw error;
  }
  let retiredPreviousGateDigest: Sha256Digest | null = null;
  if (oldGate.status === "held") {
    if (oldGate.ownerState !== "inactive") {
      fail("owner-active-or-unknown", "$gate");
    }
    const operationUuid = wakeflowMaintenanceOperationUuid(operationId);
    if (!oldGate.record.token.endsWith(`-${operationUuid}`)) {
      fail("operation-mismatch", "$operationId");
    }
    try {
      await retireRootedExclusiveFileLockResidue(
        root,
        WAKEFLOW_MAINTENANCE_GATE_REF,
        oldGate,
      );
      retiredPreviousGateDigest = oldGate.digest;
    } catch (error: unknown) {
      if (error instanceof RootedExclusiveFileLockError) {
        fail("recovery-required", "$gate");
      }
      throw error;
    }
  }
  let intentRetirement:
    Readonly<WakeflowMaintenanceExecutionIntentRetirementReceipt> | null = null;
  let journalRetirement:
    Readonly<WakeflowPreparedMaintenanceJournalRetirementReceipt>;
  try {
    journalRetirement = await withExistingWakeflowMaintenanceGate(
      root,
      operationId,
      async (context) => {
        const currentIntent = await readWakeflowMaintenanceExecutionIntentOrNull(
          root,
          operationId,
        );
        if (
          (intentSource === null) !== (currentIntent === null)
          || (
            intentSource !== null
            && currentIntent !== null
            && (
              currentIntent.intentDigest !== intentSource.intentDigest
              || currentIntent.digest !== intentSource.digest
              || currentIntent.node.deviceId !== intentSource.node.deviceId
              || currentIntent.node.inodeId !== intentSource.node.inodeId
            )
          )
        ) {
          fail("intent", "$intent");
        }
        let current = await readWakeflowMaintenanceJournalOrNull(
          root,
          operationId,
        );
        if (current === null) {
          if (currentIntent === null || plan === null) {
            fail("journal", "$journal");
          }
          current = (await publishPreparedWakeflowMaintenanceJournal(
            root,
            context,
            currentIntent,
            plan,
          )).source;
        } else if (
          source !== null
          && (
            current.digest !== source.digest
            || current.journalDigest !== source.journalDigest
            || current.node.deviceId !== source.node.deviceId
            || current.node.inodeId !== source.node.inodeId
          )
        ) {
          fail("journal", "$journal");
        }
        if (
          current.journal.state !== "prepared"
          || current.journal.checkpoint !== 0
          || current.journal.affectedStepId !== null
        ) {
          fail("journal", "$journal");
        }
        if (currentIntent !== null) {
          intentRetirement = await retireWakeflowMaintenanceExecutionIntent(
            root,
            context,
            currentIntent,
          );
        }
        return retirePreparedWakeflowMaintenanceJournal(
          root,
          context,
          current,
        );
      },
      options,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowPreparedMaintenanceRecoveryError) throw error;
    if (error instanceof WakeflowMaintenanceGateError) fail("gate", "$gate");
    if (error instanceof WakeflowMaintenanceExecutionIntentStoreError) {
      fail(
        error.reason === "transactions-shape" ? "transaction" : "intent",
        error.reason === "transactions-shape" ? "$transactions" : "$intent",
      );
    }
    if (error instanceof WakeflowMaintenanceJournalStoreError) {
      fail(
        error.reason === "transactions-shape" ? "transaction" : "journal",
        error.reason === "transactions-shape" ? "$transactions" : "$journal",
      );
    }
    throw error;
  }
  const core = await inspectWakeflowWorkspaceCoreLayout(root);
  if (core.local.status !== "idle") {
    fail("recovery-required", "$coreLayout");
  }
  return Object.freeze({
    kind: "WakeflowPreparedMaintenanceRecoveryReceipt",
    operationId,
    retiredPreviousGateDigest,
    intentRetirement,
    journalRetirement,
    coreLayoutInspectionDigest: core.inspectionDigest,
  });
}
