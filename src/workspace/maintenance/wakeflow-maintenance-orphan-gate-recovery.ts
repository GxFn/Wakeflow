import {
  materializeDirectoryPath,
  DurableDirectoryMaterializationError,
} from "../../foundation/filesystem/durable-directory-materialization.js";
import { RootedDirectory, RootedDirectoryError } from "../../foundation/filesystem/rooted-directory.js";
import {
  inspectRootedExclusiveFileLock,
  retireRootedExclusiveFileLockResidue,
  RootedExclusiveFileLockError,
} from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../../foundation/filesystem/stable-directory-read.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  parseWakeflowMaintenanceOperationId,
  wakeflowMaintenanceJournalRef,
  wakeflowMaintenanceOperationUuid,
  type WakeflowMaintenanceOperationId,
} from "./wakeflow-maintenance-operation-id.js";
import {
  WAKEFLOW_MAINTENANCE_GATE_REF,
  WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF,
} from "./wakeflow-maintenance-resource-catalog.js";
import {
  inspectWakeflowWorkspaceCoreLayout,
} from "./wakeflow-workspace-core-layout-inspection.js";

/**
 * Wakeflow Workspace / Maintenance：intent发布前孤立gate的显式恢复。
 *
 * 只有gate token的UUID与调用方operation ID相同、owner明确inactive、对应journal
 * 不存在且transactions精确为空时，才补齐空协议目录并退休gate。存在intent/journal、其他
 * transaction/stage、活动或未知 owner、token 不匹配时一律保留现场。
 */

export interface WakeflowMaintenanceOrphanGateRecoveryReceipt {
  readonly kind: "WakeflowMaintenanceOrphanGateRecoveryReceipt";
  readonly operationId: WakeflowMaintenanceOperationId;
  readonly retiredLockDigest: Sha256Digest;
  readonly coreLayoutInspectionDigest: Sha256Digest;
}

export type WakeflowMaintenanceOrphanGateRecoveryErrorReason =
  | "input"
  | "recovery-not-required"
  | "operation-mismatch"
  | "owner-active-or-unknown"
  | "journal-present"
  | "transaction-residue"
  | "recovery-required";

const ERROR_MESSAGES = {
  input: "Wakeflow orphan maintenance gate recovery input is invalid.",
  "recovery-not-required": "Wakeflow maintenance gate is absent.",
  "operation-mismatch": "Wakeflow maintenance gate belongs to another operation.",
  "owner-active-or-unknown":
    "Wakeflow maintenance gate owner is active or cannot be proven inactive.",
  "journal-present": "Wakeflow maintenance gate already has a journal.",
  "transaction-residue":
    "Wakeflow maintenance transaction root contains residue.",
  "recovery-required": "Wakeflow maintenance orphan gate could not be retired safely.",
} as const satisfies Readonly<Record<
  WakeflowMaintenanceOrphanGateRecoveryErrorReason,
  string
>>;

/** Orphan maintenance gate 恢复失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceOrphanGateRecoveryError extends Error {
  override readonly name = "WakeflowMaintenanceOrphanGateRecoveryError";
  readonly code = "wakeflow-maintenance-orphan-gate-recovery" as const;
  readonly reason: WakeflowMaintenanceOrphanGateRecoveryErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowMaintenanceOrphanGateRecoveryErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: WakeflowMaintenanceOrphanGateRecoveryErrorReason,
  path: string,
): never {
  throw new WakeflowMaintenanceOrphanGateRecoveryError(reason, path);
}

async function journalExists(
  root: RootedDirectory,
  operationId: WakeflowMaintenanceOperationId,
): Promise<boolean> {
  try {
    await root.inspectExistingResource(
      wakeflowMaintenanceJournalRef(operationId),
      "$journal",
    );
    return true;
  } catch (error: unknown) {
    if (
      error instanceof RootedDirectoryError
      && error.reason === "resource-not-found"
    ) {
      return false;
    }
    fail("recovery-required", "$journal");
  }
}

async function materializeTransactions(root: RootedDirectory): Promise<void> {
  try {
    await materializeDirectoryPath(
      root,
      WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF,
      { mode: 0o700 },
    );
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryMaterializationError) {
      fail("recovery-required", "$transactions");
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
    if (
      error instanceof StableDirectoryReadError
      && error.reason === "too-many-entries"
    ) {
      fail("transaction-residue", "$transactions");
    }
    fail("recovery-required", "$transactions");
  }
}

/** 退休一份可证明位于intent发布前崩溃窗口的孤立maintenance gate。 */
export async function recoverWakeflowMaintenanceOrphanGate(
  root: RootedDirectory,
  operationIdValue: unknown,
): Promise<Readonly<WakeflowMaintenanceOrphanGateRecoveryReceipt>> {
  let operationId: WakeflowMaintenanceOperationId;
  try {
    operationId = parseWakeflowMaintenanceOperationId(operationIdValue);
  } catch {
    fail("input", "$operationId");
  }
  let observation;
  try {
    observation = await inspectRootedExclusiveFileLock(
      root,
      WAKEFLOW_MAINTENANCE_GATE_REF,
    );
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      fail("recovery-required", "$gate");
    }
    throw error;
  }
  if (observation.status === "absent") {
    fail("recovery-not-required", "$gate");
  }
  if (observation.ownerState !== "inactive") {
    fail("owner-active-or-unknown", "$gate");
  }
  const operationUuid = wakeflowMaintenanceOperationUuid(operationId);
  if (!observation.record.token.endsWith(`-${operationUuid}`)) {
    fail("operation-mismatch", "$operationId");
  }
  if (await journalExists(root, operationId)) {
    fail("journal-present", "$journal");
  }
  await materializeTransactions(root);
  await assertTransactionsEmpty(root);
  try {
    await retireRootedExclusiveFileLockResidue(
      root,
      WAKEFLOW_MAINTENANCE_GATE_REF,
      observation,
    );
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      fail("recovery-required", "$gate");
    }
    throw error;
  }
  const core = await inspectWakeflowWorkspaceCoreLayout(root);
  if (core.local.status !== "idle") fail("recovery-required", "$coreLayout");
  return Object.freeze({
    kind: "WakeflowMaintenanceOrphanGateRecoveryReceipt",
    operationId,
    retiredLockDigest: observation.digest,
    coreLayoutInspectionDigest: core.inspectionDigest,
  });
}
