import { types } from "node:util";
import { readWakeflowConfigAuthoritySnapshot, WakeflowConfigAuthoritySnapshotError, } from "../../configuration/wakeflow-config-authority-snapshot.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { assertWakeflowHostMaintenanceCapability, assertWakeflowHostMaintenanceContributionCapability, WakeflowHostMaintenanceCapabilityError, } from "./wakeflow-host-maintenance-capability.js";
import { parseWakeflowHostMaintenanceContribution, WakeflowHostMaintenanceContributionError, } from "./wakeflow-host-maintenance-contribution.js";
import { createWakeflowMaintenanceExecutionPlan, } from "./wakeflow-maintenance-execution-plan.js";
import { previewWakeflowStaticMaterialization } from "./wakeflow-static-materialization-preview.js";
import { isWakeflowDetachAction, parseWakeflowStaticMaterializationPreviewRequest, WakeflowStaticMaterializationPreviewError, } from "./wakeflow-static-materialization-preview-contract.js";
const ERROR_MESSAGES = {
    input: "Wakeflow maintenance execution preview input is invalid.",
    "shared-preview": "Wakeflow maintenance shared preview is unavailable.",
    "source-config": "Wakeflow maintenance execution preview source Config is unavailable.",
    capability: "Wakeflow maintenance execution preview host capability is invalid.",
    contribution: "Wakeflow maintenance execution preview host contribution is invalid.",
    aborted: "Wakeflow maintenance execution preview was aborted.",
};
/** 聚合维护 preview 失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceExecutionPreviewError extends Error {
    name = "WakeflowMaintenanceExecutionPreviewError";
    code = "wakeflow-maintenance-execution-preview";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new WakeflowMaintenanceExecutionPreviewError(reason, path);
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$signal");
}
/**
 * 宿主贡献拿到的 Config：退出路径一律是当前 Config——要清理的就是它声明的托管面（ADR-0024），
 * detach-repository 的宿主也看去掉仓库之前的配置；其余动作是期望 Config（reconcile 从快照读当前）。
 */
async function resolveHostConfig(root, request, sharedPreview) {
    if (isWakeflowDetachAction(request.action)) {
        return resolveSnapshotConfig(root, request, sharedPreview.currentConfigDigest);
    }
    if (request.desiredConfig !== null)
        return request.desiredConfig;
    return resolveSnapshotConfig(root, request, sharedPreview.desiredConfigDigest);
}
/** 当前 Config 的稳定快照，摘要必须等于共享预览记下的那一个；预览没记（null）时快照也必须不在。 */
async function resolveSnapshotConfig(root, request, expectedDigest) {
    assertNotAborted(request.signal);
    let snapshot;
    try {
        snapshot = await readWakeflowConfigAuthoritySnapshot(root, request.signal === undefined ? undefined : { signal: request.signal });
    }
    catch (error) {
        if (error instanceof WakeflowConfigAuthoritySnapshotError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (expectedDigest !== null)
                fail("source-config", "$config");
            return null;
        }
        throw error;
    }
    assertNotAborted(request.signal);
    if (snapshot.configDigest !== expectedDigest) {
        fail("source-config", "$config");
    }
    return snapshot.model;
}
/** 构建共享静态步骤与当前宿主操作合并后的唯一 preview-only 计划。 */
export async function previewWakeflowMaintenanceExecution(rootValue, requestValue, capabilityValue, gateContextValue) {
    if (typeof rootValue !== "object" ||
        rootValue === null ||
        types.isProxy(rootValue) ||
        !(rootValue instanceof RootedDirectory)) {
        fail("input", "$root");
    }
    let request;
    try {
        request = parseWakeflowStaticMaterializationPreviewRequest(requestValue);
    }
    catch (error) {
        if (error instanceof WakeflowStaticMaterializationPreviewError) {
            fail("input", error.path);
        }
        throw error;
    }
    assertNotAborted(request.signal);
    let capability;
    if (capabilityValue !== undefined) {
        try {
            assertWakeflowHostMaintenanceCapability(capabilityValue, request.currentHostProfile.hostId);
            capability = capabilityValue;
        }
        catch (error) {
            if (error instanceof WakeflowHostMaintenanceCapabilityError) {
                fail("capability", error.path);
            }
            throw error;
        }
    }
    let sharedPreview;
    try {
        sharedPreview = await previewWakeflowStaticMaterialization(rootValue, requestValue, gateContextValue === undefined ? {} : { gateContext: gateContextValue });
    }
    catch (error) {
        if (error instanceof WakeflowStaticMaterializationPreviewError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("shared-preview", error.path);
        }
        throw error;
    }
    let hostConfig = request.desiredConfig;
    if (capability !== undefined) {
        hostConfig = await resolveHostConfig(rootValue, request, sharedPreview);
    }
    let contribution = null;
    if (capability !== undefined && hostConfig === null) {
        if (sharedPreview.status === "ready")
            fail("source-config", "$config");
    }
    else if (capability !== undefined && hostConfig !== null) {
        try {
            contribution = parseWakeflowHostMaintenanceContribution(await capability.planContribution(rootValue, {
                action: request.action,
                config: hostConfig,
                profile: request.currentHostProfile,
                ...(request.signal === undefined ? {} : { signal: request.signal }),
            }));
            assertWakeflowHostMaintenanceContributionCapability(capability, contribution);
        }
        catch (error) {
            assertNotAborted(request.signal);
            if (error instanceof WakeflowHostMaintenanceContributionError ||
                error instanceof WakeflowHostMaintenanceCapabilityError) {
                fail("contribution", error.path);
            }
            throw error;
        }
    }
    assertNotAborted(request.signal);
    return createWakeflowMaintenanceExecutionPlan(sharedPreview, request.currentHostProfile, contribution);
}
