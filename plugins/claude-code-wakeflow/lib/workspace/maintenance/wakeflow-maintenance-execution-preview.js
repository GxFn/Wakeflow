import { types } from "node:util";
import { readWakeflowConfigAuthoritySnapshot, WakeflowConfigAuthoritySnapshotError, } from "../../configuration/wakeflow-config-authority-snapshot.js";
import { RootedDirectory, } from "../../foundation/filesystem/rooted-directory.js";
import { assertWakeflowHostMaintenanceCapability, assertWakeflowHostMaintenanceContributionCapability, WakeflowHostMaintenanceCapabilityError, } from "./wakeflow-host-maintenance-capability.js";
import { parseWakeflowHostMaintenanceContribution, WakeflowHostMaintenanceContributionError, } from "./wakeflow-host-maintenance-contribution.js";
import { createWakeflowMaintenanceExecutionPlan, } from "./wakeflow-maintenance-execution-plan.js";
import { previewWakeflowStaticMaterialization, } from "./wakeflow-static-materialization-preview.js";
import { parseWakeflowStaticMaterializationPreviewRequest, WakeflowStaticMaterializationPreviewError, } from "./wakeflow-static-materialization-preview-contract.js";
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
async function resolveDesiredConfig(root, request, expectedDigest) {
    if (request.desiredConfig !== null)
        return request.desiredConfig;
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
    if (typeof rootValue !== "object"
        || rootValue === null
        || types.isProxy(rootValue)
        || !(rootValue instanceof RootedDirectory)) {
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
        sharedPreview = await previewWakeflowStaticMaterialization(rootValue, requestValue, gateContextValue === undefined
            ? {}
            : { gateContext: gateContextValue });
    }
    catch (error) {
        if (error instanceof WakeflowStaticMaterializationPreviewError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("shared-preview", error.path);
        }
        throw error;
    }
    let desiredConfig = request.desiredConfig;
    if (capability !== undefined) {
        desiredConfig = await resolveDesiredConfig(rootValue, request, sharedPreview.desiredConfigDigest);
    }
    let contribution = null;
    if (capability !== undefined && desiredConfig === null) {
        if (sharedPreview.status === "ready")
            fail("source-config", "$config");
    }
    else if (capability !== undefined && desiredConfig !== null) {
        try {
            contribution = parseWakeflowHostMaintenanceContribution(await capability.planContribution(rootValue, {
                action: request.action,
                config: desiredConfig,
                profile: request.currentHostProfile,
                ...(request.signal === undefined ? {} : { signal: request.signal }),
            }));
            assertWakeflowHostMaintenanceContributionCapability(capability, contribution);
        }
        catch (error) {
            assertNotAborted(request.signal);
            if (error instanceof WakeflowHostMaintenanceContributionError
                || error instanceof WakeflowHostMaintenanceCapabilityError) {
                fail("contribution", error.path);
            }
            throw error;
        }
    }
    assertNotAborted(request.signal);
    return createWakeflowMaintenanceExecutionPlan(sharedPreview, request.currentHostProfile, contribution);
}
