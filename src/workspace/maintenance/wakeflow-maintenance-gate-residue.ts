import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { hasDurableAtomicFileStagePrefix } from "../../foundation/filesystem/durable-atomic-file-stage-address.js";
import {
  DurableAtomicFileStageRecoveryError,
  recoverDurableAtomicFileStagesInDirectory,
} from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF } from "../wakeflow-maintenance-resource-catalog.js";
import {
  inspectWakeflowWorkspaceCoreLayout,
  WakeflowWorkspaceCoreLayoutInspectionError,
} from "./wakeflow-workspace-core-layout-inspection.js";

/**
 * Wakeflow Workspace / Maintenance：没有操作可恢复的维护残留（open-items B9，§13.242）。
 *
 * 维护 apply 先拿门、再发布 intent。进程死在 intent 的暂存已经写好、尚未链接到目标的那一刻，
 * `transactions` 里只剩孤儿暂存：没有 intent，于是没有 operation ID 可以交给 recover，而协议状态是
 * `recovery-required`，每一次维护预览都被它挡住。这里识别的就是这种状态——什么权威内容都还没有写下，
 * 收场是把暂存退役。门自己不留残留（ADR-0033）：持有者死掉时内核收走它。
 *
 * 只认可证明的情形：没有维护在跑，`transactions` 里只有暂存前缀的条目（没有 intent、或别的文件）。
 * 有维护在跑是 `busy`；目录里有别的东西按 operation ID 走 recover。
 */

export interface WakeflowMaintenanceGateResidue {
  /** `transactions` 里暂存前缀的条目数。 */
  readonly transactionStages: number;
  /** 观察时的协议摘要与上面一项：退役之前重新观察，对不上就什么都不动。 */
  readonly digest: Sha256Digest;
}

export interface WakeflowMaintenanceGateResidueRetirement {
  readonly stagesRetired: number;
}

export type WakeflowMaintenanceGateResidueErrorReason = "changed" | "unretired";

const ERROR_MESSAGES = {
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

interface Options {
  readonly signal?: AbortSignal;
}

async function observe(
  root: RootedDirectory,
  options: Options,
): Promise<Readonly<WakeflowMaintenanceGateResidue> | null> {
  let core: Awaited<ReturnType<typeof inspectWakeflowWorkspaceCoreLayout>>;
  try {
    core = await inspectWakeflowWorkspaceCoreLayout(root, options);
  } catch (error: unknown) {
    if (!(error instanceof WakeflowWorkspaceCoreLayoutInspectionError)) throw error;
    // 读不出来不是证据：这份计划不出现，原有的预览照它自己的方式报告。
    return null;
  }
  // `recovery-required` 只在没有维护持有门时出现；门被持有时状态是 `busy`。
  if (core.local.status !== "recovery-required" || core.local.protocolDigest === null) return null;
  if (core.local.residues.some((residue) => !hasDurableAtomicFileStagePrefix(residue.name))) {
    return null;
  }
  const transactionStages = core.local.residues.length;
  return Object.freeze({
    transactionStages,
    digest: computeCanonicalJsonSha256Digest({
      kind: "WakeflowMaintenanceGateResidueDigestBasis",
      protocolDigest: core.local.protocolDigest,
      transactionStages,
    }),
  });
}

/** 只读：当前是不是"没有操作可恢复的维护残留"；不是则为 null。 */
export function inspectWakeflowMaintenanceGateResidue(
  root: RootedDirectory,
  options: Options = {},
): Promise<Readonly<WakeflowMaintenanceGateResidue> | null> {
  return observe(root, options);
}

/**
 * 退役观察到的残留：`transactions` 里的孤儿暂存，按节点精确删除；属主还活着或说不清的暂存不动，并以
 * `unretired` 收场。
 */
export async function retireWakeflowMaintenanceGateResidue(
  root: RootedDirectory,
  expected: Readonly<WakeflowMaintenanceGateResidue>,
  options: Options = {},
): Promise<Readonly<WakeflowMaintenanceGateResidueRetirement>> {
  const current = await observe(root, options);
  if (current === null || current.digest !== expected.digest) fail("changed");
  try {
    const receipt = await recoverDurableAtomicFileStagesInDirectory(
      root,
      WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF,
      options,
    );
    if (receipt.activeStageCount !== 0 || receipt.unknownStageCount !== 0) fail("unretired");
    return Object.freeze({ stagesRetired: receipt.retiredStageCount });
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceGateResidueError) throw error;
    if (error instanceof DurableAtomicFileStageRecoveryError) fail("unretired");
    throw error;
  }
}
