import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { hasDurableAtomicFileStagePrefix } from "../../foundation/filesystem/durable-atomic-file-stage-address.js";
import { DurableAtomicFileStageRecoveryError, recoverDurableAtomicFileStagesInDirectory, } from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import { WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF } from "./wakeflow-maintenance-resource-catalog.js";
import { inspectWakeflowWorkspaceCoreLayout, WakeflowWorkspaceCoreLayoutInspectionError, } from "./wakeflow-workspace-core-layout-inspection.js";
const ERROR_MESSAGES = {
    aborted: "Wakeflow maintenance gate residue retirement was aborted.",
    changed: "Wakeflow maintenance gate residue changed after it was observed.",
    unretired: "Wakeflow maintenance gate residue could not be retired.",
};
export class WakeflowMaintenanceGateResidueError extends Error {
    name = "WakeflowMaintenanceGateResidueError";
    code = "wakeflow-maintenance-gate-residue";
    reason;
    constructor(reason) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
    }
}
function fail(reason) {
    throw new WakeflowMaintenanceGateResidueError(reason);
}
async function observe(root, options) {
    let core;
    try {
        core = await inspectWakeflowWorkspaceCoreLayout(root, options);
    }
    catch (error) {
        if (!(error instanceof WakeflowWorkspaceCoreLayoutInspectionError))
            throw error;
        if (error.reason === "aborted")
            fail("aborted");
        // 读不出来不是证据：这份计划不出现，原有的预览照它自己的方式报告。
        return null;
    }
    // `recovery-required` 只在没有维护持有门时出现；门被持有时状态是 `busy`。
    if (core.local.status !== "recovery-required" || core.local.protocolDigest === null)
        return null;
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
export function inspectWakeflowMaintenanceGateResidue(root, options = {}) {
    return observe(root, options);
}
/**
 * 退役观察到的残留：`transactions` 里的孤儿暂存，按节点精确删除；属主还活着或说不清的暂存不动，并以
 * `unretired` 收场。
 */
export async function retireWakeflowMaintenanceGateResidue(root, expected, options = {}) {
    const current = await observe(root, options);
    if (current === null || current.digest !== expected.digest)
        fail("changed");
    try {
        const receipt = await recoverDurableAtomicFileStagesInDirectory(root, WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF, options);
        if (receipt.activeStageCount !== 0 || receipt.unknownStageCount !== 0)
            fail("unretired");
        return Object.freeze({ stagesRetired: receipt.retiredStageCount });
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceGateResidueError)
            throw error;
        if (error instanceof DurableAtomicFileStageRecoveryError) {
            fail(error.reason === "aborted" ? "aborted" : "unretired");
        }
        throw error;
    }
}
