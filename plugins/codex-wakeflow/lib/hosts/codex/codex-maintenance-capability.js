import { createWakeflowHostMaintenanceContribution } from "../../workspace/maintenance/wakeflow-host-maintenance-contribution.js";
import { assertWakeflowMaintenanceGateContext, WakeflowMaintenanceGateError, } from "../../workspace/maintenance/wakeflow-maintenance-gate.js";
import { executeWakeflowWindowRuntimeProjectionOperation, planWakeflowWindowRuntimeProjectionMaintenance, WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OPERATION_KIND, WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OWNER_ID, WakeflowWindowRuntimeProjectionMaintenanceError, } from "../../workspace/window-runtime/wakeflow-window-runtime-projection-maintenance.js";
import { codexWindowHostIdentityProfile } from "./codex-window-host-identity-profile.js";
/**
 * Wakeflow Host / Codex：当前 Codex 宿主维护 capability。
 *
 * Codex 没有 settings 或 statusline 这类宿主文件，唯一的宿主维护贡献是对账时用当前 Config
 * 与 Binding inventory 重建缺失或过期的窗口运行投影（需要 Codex 的 identity profile）。
 * 共享层不依赖本模块；唯一的 operationKind 在这里显式分派，不注册动态 handler。
 */
export const CODEX_MAINTENANCE_CAPABILITY_ID = "codex-maintenance";
const ERROR_MESSAGES = {
    gate: "Codex maintenance capability requires the active matching gate.",
    operation: "Codex maintenance capability operation is invalid.",
    owner: "Codex maintenance capability owner failed.",
};
/** Codex maintenance capability 失败的稳定、脱敏错误。 */
export class CodexMaintenanceCapabilityError extends Error {
    name = "CodexMaintenanceCapabilityError";
    code = "wakeflow-codex-maintenance-capability";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new CodexMaintenanceCapabilityError(reason, path);
}
/** Codex 当前唯一、闭合的宿主维护端口实现。 */
export const codexMaintenanceCapability = Object.freeze({
    kind: "WakeflowHostMaintenanceCapability",
    hostId: "codex",
    capabilityId: CODEX_MAINTENANCE_CAPABILITY_ID,
    planContribution: async (root, request) => {
        let plan;
        try {
            plan = await planWakeflowWindowRuntimeProjectionMaintenance(root, {
                action: request.action,
                config: request.config,
                resourceProfile: request.profile,
                identityProfile: codexWindowHostIdentityProfile,
                ...(request.signal === undefined ? {} : { signal: request.signal }),
            });
        }
        catch (error) {
            if (error instanceof WakeflowWindowRuntimeProjectionMaintenanceError) {
                fail("owner", error.path);
            }
            throw error;
        }
        return createWakeflowHostMaintenanceContribution({
            hostId: "codex",
            capabilityId: CODEX_MAINTENANCE_CAPABILITY_ID,
            status: plan.blockerCodes.length === 0 ? "ready" : "blocked",
            blockerCodes: plan.blockerCodes,
            operations: plan.operations,
        });
    },
    executeOperation: async (root, context, request) => {
        try {
            assertWakeflowMaintenanceGateContext(context, root);
        }
        catch (error) {
            if (error instanceof WakeflowMaintenanceGateError)
                fail("gate", "$context");
            throw error;
        }
        if (request.profile.hostId !== "codex"
            || request.operation.operationKind !== WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OPERATION_KIND
            || request.operation.ownerId !== WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OWNER_ID) {
            fail("operation", "$operation");
        }
        try {
            return await executeWakeflowWindowRuntimeProjectionOperation(root, {
                config: request.config,
                resourceProfile: request.profile,
                identityProfile: codexWindowHostIdentityProfile,
                operationId: request.operation.operationId,
                targetKey: request.operation.targetKey,
                targetDigest: request.operation.targetDigest,
                ...(request.signal === undefined ? {} : { signal: request.signal }),
            });
        }
        catch (error) {
            if (error instanceof WakeflowWindowRuntimeProjectionMaintenanceError) {
                fail("owner", error.path);
            }
            throw error;
        }
    },
});
