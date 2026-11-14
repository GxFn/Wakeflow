import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { hasDurableAtomicFileStagePrefix } from "../../foundation/filesystem/durable-atomic-file-stage-address.js";
import {
  DurableAtomicFileStageRecoveryError,
  type DurableAtomicFileStageRecoveryReceipt,
  recoverDurableAtomicFileStagesForTargets,
  recoverDurableAtomicFileStagesInDirectory,
} from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  inspectRootedExclusiveFileLock,
  RootedExclusiveFileLockError,
  type RootedExclusiveFileLockObservation,
  retireRootedExclusiveFileLockResidue,
} from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import {
  WAKEFLOW_MAINTENANCE_GATE_REF,
  WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF,
} from "./wakeflow-maintenance-resource-catalog.js";
import {
  inspectWakeflowWorkspaceCoreLayout,
  WakeflowWorkspaceCoreLayoutInspectionError,
} from "./wakeflow-workspace-core-layout-inspection.js";

/**
 * Wakeflow Workspace / Maintenance：没有操作可恢复的维护门残留（open-items B9，§13.242）。
 *
 * 维护 apply 先拿门锁、再发布 intent。进程死在这两步之间，或死在 intent 的暂存已经写好、尚未链接到目标的
 * 那一刻，磁盘上只有一把已死进程的门锁和（可能的）孤儿暂存：没有 intent，也没有 journal，于是没有
 * operation ID 可以交给 recover，而协议状态是 `recovery-required`，每一次维护预览都被它挡住。真实进程的
 * 中断矩阵把这条死路跑了出来。这里识别的就是这种状态——什么权威内容都还没有写下，收场是把残留退役。
 *
 * 只认可证明的情形：门锁不在，或它的持有者确实不在了；`transactions` 里只有暂存前缀的条目（没有 intent、
 * journal 或别的文件）。持有者还活着或说不清、目录里有别的东西，都不归这里管：前者是 `busy` 或等待，
 * 后者按 operation ID 走 recover。
 */

export interface WakeflowMaintenanceGateResidue {
  /** `inactive`：持有者已经不在的门锁；`absent`：没有门锁，只剩暂存。 */
  readonly lock: "inactive" | "absent";
  /** `transactions` 里暂存前缀的条目数；门锁自己的暂存在上一层，随门锁一起处理，不计在这里。 */
  readonly transactionStages: number;
  /** 观察时的协议摘要与上面两项：退役之前重新观察，对不上就什么都不动。 */
  readonly digest: Sha256Digest;
}

export interface WakeflowMaintenanceGateResidueRetirement {
  readonly lockRetired: boolean;
  readonly stagesRetired: number;
}

export type WakeflowMaintenanceGateResidueErrorReason = "aborted" | "changed" | "unretired";

const ERROR_MESSAGES = {
  aborted: "Wakeflow maintenance gate residue retirement was aborted.",
  changed: "Wakeflow maintenance gate residue changed after it was observed.",
  unretired: "Wakeflow maintenance gate residue could not be retired.",
} as const satisfies Readonly<Record<WakeflowMaintenanceGateResidueErrorReason, string>>;

export class WakeflowMaintenanceGateResidueError extends Error {
  override readonly name = "WakeflowMaintenanceGateResidueError";
  readonly code = "wakeflow-maintenance-gate-residue" as const;
  readonly reason: WakeflowMaintenanceGateResidueErrorReason;

  constructor(reason: WakeflowMaintenanceGateResidueErrorReason) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

function fail(reason: WakeflowMaintenanceGateResidueErrorReason): never {
  throw new WakeflowMaintenanceGateResidueError(reason);
}

interface Observed {
  readonly residue: Readonly<WakeflowMaintenanceGateResidue>;
  readonly lock: RootedExclusiveFileLockObservation;
}

interface Options {
  readonly signal?: AbortSignal;
}

async function observe(
  root: RootedDirectory,
  options: Options,
): Promise<Readonly<Observed> | null> {
  let core: Awaited<ReturnType<typeof inspectWakeflowWorkspaceCoreLayout>>;
  let lock: RootedExclusiveFileLockObservation;
  try {
    core = await inspectWakeflowWorkspaceCoreLayout(root, options);
    if (core.local.status !== "recovery-required" || core.local.protocolDigest === null) {
      return null;
    }
    if (core.local.residues.some((residue) => !hasDurableAtomicFileStagePrefix(residue.name))) {
      return null;
    }
    lock = await inspectRootedExclusiveFileLock(root, WAKEFLOW_MAINTENANCE_GATE_REF);
  } catch (error: unknown) {
    if (
      error instanceof WakeflowWorkspaceCoreLayoutInspectionError ||
      error instanceof RootedExclusiveFileLockError
    ) {
      if (error.reason === "aborted") fail("aborted");
      // 读不出来不是证据：这份计划不出现，原有的预览照它自己的方式报告。
      return null;
    }
    throw error;
  }
  if (lock.status === "held" && lock.ownerState !== "inactive") return null;
  const view = {
    lock: lock.status === "held" ? ("inactive" as const) : ("absent" as const),
    transactionStages: core.local.residues.length,
  };
  return Object.freeze({
    lock,
    residue: Object.freeze({
      ...view,
      digest: computeCanonicalJsonSha256Digest({
        kind: "WakeflowMaintenanceGateResidueDigestBasis",
        protocolDigest: core.local.protocolDigest,
        ...view,
      }),
    }),
  });
}

/** 一次暂存恢复退役了几个；还有属主活着或说不清的暂存时不往下走。 */
function retiredCount(receipt: Readonly<DurableAtomicFileStageRecoveryReceipt>): number {
  if (receipt.activeStageCount !== 0 || receipt.unknownStageCount !== 0) fail("unretired");
  return receipt.retiredStageCount;
}

/** 只读：当前是不是"没有操作可恢复的维护门残留"；不是则为 null。 */
export async function inspectWakeflowMaintenanceGateResidue(
  root: RootedDirectory,
  options: Options = {},
): Promise<Readonly<WakeflowMaintenanceGateResidue> | null> {
  return (await observe(root, options))?.residue ?? null;
}

/**
 * 退役观察到的残留：先是 `transactions` 里的孤儿暂存，最后才是门锁（连同它自己的暂存）——门锁一直留到
 * 最后，协议状态在此之前始终是 `recovery-required`，别的维护进不来。每一步都按节点精确删除；属主还活着
 * 或说不清的暂存不动，并以 `unretired` 收场。
 */
export async function retireWakeflowMaintenanceGateResidue(
  root: RootedDirectory,
  expected: Readonly<WakeflowMaintenanceGateResidue>,
  options: Options = {},
): Promise<Readonly<WakeflowMaintenanceGateResidueRetirement>> {
  const current = await observe(root, options);
  if (current === null || current.residue.digest !== expected.digest) fail("changed");
  let stagesRetired = 0;
  try {
    if (current.residue.transactionStages > 0) {
      stagesRetired += retiredCount(
        await recoverDurableAtomicFileStagesInDirectory(
          root,
          WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF,
          options,
        ),
      );
    }
    if (current.lock.status === "held") {
      await retireRootedExclusiveFileLockResidue(root, WAKEFLOW_MAINTENANCE_GATE_REF, current.lock);
    } else {
      stagesRetired += retiredCount(
        await recoverDurableAtomicFileStagesForTargets(
          root,
          Object.freeze([WAKEFLOW_MAINTENANCE_GATE_REF]),
          options,
        ),
      );
    }
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceGateResidueError) throw error;
    if (
      error instanceof DurableAtomicFileStageRecoveryError ||
      error instanceof RootedExclusiveFileLockError
    ) {
      fail(error.reason === "aborted" ? "aborted" : "unretired");
    }
    throw error;
  }
  return Object.freeze({ lockRetired: current.lock.status === "held", stagesRetired });
}
