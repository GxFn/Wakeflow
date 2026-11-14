import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { hasDurableAtomicFileStagePrefix } from "../../foundation/filesystem/durable-atomic-file-stage-address.js";
import { DurableAtomicFileStageRecoveryError, recoverDurableAtomicFileStagesForTargets, recoverDurableAtomicFileStagesInDirectory, } from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import { inspectRootedExclusiveFileLock, RootedExclusiveFileLockError, retireRootedExclusiveFileLockResidue, } from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import { WAKEFLOW_MAINTENANCE_GATE_REF, WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF, } from "./wakeflow-maintenance-resource-catalog.js";
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
    let lock;
    try {
        core = await inspectWakeflowWorkspaceCoreLayout(root, options);
        if (core.local.status !== "recovery-required" || core.local.protocolDigest === null) {
            return null;
        }
        if (core.local.residues.some((residue) => !hasDurableAtomicFileStagePrefix(residue.name))) {
            return null;
        }
        lock = await inspectRootedExclusiveFileLock(root, WAKEFLOW_MAINTENANCE_GATE_REF);
    }
    catch (error) {
        if (error instanceof WakeflowWorkspaceCoreLayoutInspectionError ||
            error instanceof RootedExclusiveFileLockError) {
            if (error.reason === "aborted")
                fail("aborted");
            // 读不出来不是证据：这份计划不出现，原有的预览照它自己的方式报告。
            return null;
        }
        throw error;
    }
    if (lock.status === "held" && lock.ownerState !== "inactive")
        return null;
    const view = {
        lock: lock.status === "held" ? "inactive" : "absent",
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
function retiredCount(receipt) {
    if (receipt.activeStageCount !== 0 || receipt.unknownStageCount !== 0)
        fail("unretired");
    return receipt.retiredStageCount;
}
/** 只读：当前是不是"没有操作可恢复的维护门残留"；不是则为 null。 */
export async function inspectWakeflowMaintenanceGateResidue(root, options = {}) {
    return (await observe(root, options))?.residue ?? null;
}
/**
 * 退役观察到的残留：先是 `transactions` 里的孤儿暂存，最后才是门锁（连同它自己的暂存）——门锁一直留到
 * 最后，协议状态在此之前始终是 `recovery-required`，别的维护进不来。每一步都按节点精确删除；属主还活着
 * 或说不清的暂存不动，并以 `unretired` 收场。
 */
export async function retireWakeflowMaintenanceGateResidue(root, expected, options = {}) {
    const current = await observe(root, options);
    if (current === null || current.residue.digest !== expected.digest)
        fail("changed");
    let stagesRetired = 0;
    try {
        if (current.residue.transactionStages > 0) {
            stagesRetired += retiredCount(await recoverDurableAtomicFileStagesInDirectory(root, WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF, options));
        }
        if (current.lock.status === "held") {
            await retireRootedExclusiveFileLockResidue(root, WAKEFLOW_MAINTENANCE_GATE_REF, current.lock);
        }
        else {
            stagesRetired += retiredCount(await recoverDurableAtomicFileStagesForTargets(root, Object.freeze([WAKEFLOW_MAINTENANCE_GATE_REF]), options));
        }
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceGateResidueError)
            throw error;
        if (error instanceof DurableAtomicFileStageRecoveryError ||
            error instanceof RootedExclusiveFileLockError) {
            fail(error.reason === "aborted" ? "aborted" : "unretired");
        }
        throw error;
    }
    return Object.freeze({ lockRetired: current.lock.status === "held", stagesRetired });
}
