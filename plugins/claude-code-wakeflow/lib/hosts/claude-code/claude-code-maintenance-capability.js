import { assertWakeflowMaintenanceGateContext, WakeflowMaintenanceGateError, } from "../../workspace/maintenance/wakeflow-maintenance-gate.js";
import { createWakeflowHostMaintenanceContribution, } from "../../workspace/maintenance/wakeflow-host-maintenance-contribution.js";
import { planClaudeCodePortableSettingsComposition, } from "./claude-code-portable-settings-composition.js";
import { executeClaudeCodePortableSettingsOperation, ClaudeCodePortableSettingsOperationExecutionError, } from "./claude-code-portable-settings-operation-executor.js";
import { executeClaudeCodeStatuslineAssetOperation, planClaudeCodeStatuslineAssetOperation, CLAUDE_CODE_STATUSLINE_ASSET_OPERATION_KIND, CLAUDE_CODE_STATUSLINE_ASSET_OWNER_ID, ClaudeCodeStatuslineAssetOperationError, } from "./claude-code-statusline-asset-operation.js";
import { executeClaudeCodeStatuslineSettingsOperation, planClaudeCodeStatuslineSettingsOperation, CLAUDE_CODE_STATUSLINE_SETTINGS_BLOCKER, CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_KIND, CLAUDE_CODE_STATUSLINE_SETTINGS_OWNER_ID, ClaudeCodeStatuslineSettingsOperationError, } from "./claude-code-statusline-settings-operation.js";
/**
 * Wakeflow Host / Claude Code：当前 Claude 宿主维护 capability。
 *
 * 它把 portable settings 的多根只读计划、状态栏资产的字节核对与本地设置里状态栏条目的核对
 * 转换成共享 contribution，并在唯一 Maintenance Gate 内以闭合分派执行 exact operation。
 * 共享层不依赖本模块；三种 operationKind 都在这里显式分派，不注册动态 handler。
 * 资产字节或本地设置读不稳时贡献 blocked 并带稳定 blocker，不把未分类的宿主错误抛给
 * 维护预览：读不出的宿主制品不能让整个工作区无法维护。
 */
export const CLAUDE_CODE_MAINTENANCE_CAPABILITY_ID = "claude-code-maintenance";
const ERROR_MESSAGES = {
    gate: "Claude Code maintenance capability requires the active matching gate.",
    operation: "Claude Code maintenance capability operation is invalid.",
    owner: "Claude Code maintenance capability owner failed.",
};
/** Claude Code maintenance capability 失败的稳定、脱敏错误。 */
export class ClaudeCodeMaintenanceCapabilityError extends Error {
    name = "ClaudeCodeMaintenanceCapabilityError";
    code = "wakeflow-claude-code-maintenance-capability";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new ClaudeCodeMaintenanceCapabilityError(reason, path);
}
/** 资产读不出（目录、符号链接、超过 256 KiB、权限不足）时宿主贡献报出的 blocker。 */
export const CLAUDE_CODE_STATUSLINE_ASSET_BLOCKER = "claude-statusline-asset-unreadable";
/** 资产字节读不稳时不猜：整份贡献 blocked，不带该操作，而不是抛出未分类的宿主错误。 */
async function planStatuslineAsset(root, signal) {
    try {
        return {
            operation: await planClaudeCodeStatuslineAssetOperation(root, {
                ...(signal === undefined ? {} : { signal }),
            }),
            blocker: null,
        };
    }
    catch (error) {
        if (error instanceof ClaudeCodeStatuslineAssetOperationError) {
            if (error.reason === "read") {
                return { operation: null, blocker: CLAUDE_CODE_STATUSLINE_ASSET_BLOCKER };
            }
            fail("owner", error.path);
        }
        throw error;
    }
}
/** 本地设置读不出或不是 JSON 对象时不猜：整份贡献 blocked，不带该操作。 */
async function planStatuslineSettings(root, signal) {
    try {
        return {
            operation: await planClaudeCodeStatuslineSettingsOperation(root, {
                ...(signal === undefined ? {} : { signal }),
            }),
            blocker: null,
        };
    }
    catch (error) {
        if (error instanceof ClaudeCodeStatuslineSettingsOperationError) {
            if (error.reason === "settings-unreadable") {
                return { operation: null, blocker: CLAUDE_CODE_STATUSLINE_SETTINGS_BLOCKER };
            }
            fail("owner", error.path);
        }
        throw error;
    }
}
async function planContribution(root, request) {
    const composition = await planClaudeCodePortableSettingsComposition(root, {
        action: request.action,
        config: request.config,
        profile: request.profile,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    const statusline = await planStatuslineAsset(root, request.signal);
    const settings = await planStatuslineSettings(root, request.signal);
    // blocker 在边界内排序去重前必须互不相同：三个来源的前缀各不相同。
    const blockerCodes = [
        ...composition.blockerCodes,
        ...(statusline.blocker === null ? [] : [statusline.blocker]),
        ...(settings.blocker === null ? [] : [settings.blocker]),
    ];
    return createWakeflowHostMaintenanceContribution({
        hostId: "claude-code",
        capabilityId: CLAUDE_CODE_MAINTENANCE_CAPABILITY_ID,
        status: blockerCodes.length === 0 ? "ready" : "blocked",
        blockerCodes,
        operations: [
            ...composition.operations.map((operation) => ({
                operationId: operation.operationId,
                operationKind: "portable-settings",
                ownerId: "claude-code-portable-settings",
                targetKey: `settings:${operation.root.rootKind}:${operation.root.rootId}`,
                sourceDigest: operation.sourceDigest,
                targetDigest: operation.targetDigest,
                payload: operation,
            })),
            ...(statusline.operation === null ? [] : [statusline.operation]),
            ...(settings.operation === null ? [] : [settings.operation]),
        ],
    });
}
async function executeStatuslineOperation(root, request) {
    try {
        const executed = await executeClaudeCodeStatuslineAssetOperation(root, {
            operation: request.operation.payload,
            recoveringAffectedOperation: request.recoveringAffectedOperation,
            ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
        if (executed.operationId !== request.operation.operationId
            || executed.targetDigest !== request.operation.targetDigest) {
            fail("owner", "$operation");
        }
        return Object.freeze({
            operationId: executed.operationId,
            disposition: executed.disposition,
            observationDigest: executed.targetDigest,
        });
    }
    catch (error) {
        if (error instanceof ClaudeCodeStatuslineAssetOperationError)
            fail("owner", error.path);
        throw error;
    }
}
async function executeStatuslineSettingsOperation(root, request) {
    try {
        const executed = await executeClaudeCodeStatuslineSettingsOperation(root, {
            operation: request.operation.payload,
            sourceDigest: request.operation.sourceDigest,
            targetDigest: request.operation.targetDigest,
            recoveringAffectedOperation: request.recoveringAffectedOperation,
            ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
        if (executed.operationId !== request.operation.operationId)
            fail("owner", "$operation");
        return Object.freeze({
            operationId: executed.operationId,
            disposition: executed.disposition,
            observationDigest: executed.targetDigest,
        });
    }
    catch (error) {
        if (error instanceof ClaudeCodeStatuslineSettingsOperationError)
            fail("owner", error.path);
        throw error;
    }
}
async function executeOperation(root, context, request) {
    try {
        assertWakeflowMaintenanceGateContext(context, root);
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceGateError) {
            fail("gate", "$context");
        }
        throw error;
    }
    if (request.profile.hostId !== "claude-code")
        fail("operation", "$operation");
    if (request.operation.operationKind === CLAUDE_CODE_STATUSLINE_ASSET_OPERATION_KIND
        && request.operation.ownerId === CLAUDE_CODE_STATUSLINE_ASSET_OWNER_ID) {
        return executeStatuslineOperation(root, request);
    }
    if (request.operation.operationKind === CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_KIND
        && request.operation.ownerId === CLAUDE_CODE_STATUSLINE_SETTINGS_OWNER_ID) {
        return executeStatuslineSettingsOperation(root, request);
    }
    if (request.operation.operationKind !== "portable-settings"
        || request.operation.ownerId !== "claude-code-portable-settings") {
        fail("operation", "$operation");
    }
    let executed;
    try {
        executed = await executeClaudeCodePortableSettingsOperation(root, {
            config: request.config,
            profile: request.profile,
            operation: request.operation.payload,
            recoveringAffectedOperation: request.recoveringAffectedOperation,
            ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
    }
    catch (error) {
        if (error instanceof ClaudeCodePortableSettingsOperationExecutionError) {
            fail("owner", error.path);
        }
        throw error;
    }
    if (executed.operationId !== request.operation.operationId
        || executed.targetDigest !== request.operation.targetDigest) {
        fail("owner", "$operation");
    }
    return Object.freeze({
        operationId: executed.operationId,
        disposition: executed.disposition,
        observationDigest: executed.targetDigest,
    });
}
/** Claude Code 当前唯一、闭合的宿主维护端口实现。 */
export const claudeCodeMaintenanceCapability = Object.freeze({
    kind: "WakeflowHostMaintenanceCapability",
    hostId: "claude-code",
    capabilityId: CLAUDE_CODE_MAINTENANCE_CAPABILITY_ID,
    planContribution,
    executeOperation,
});
