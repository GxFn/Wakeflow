import { createWakeflowHostMaintenanceContribution, } from "../../workspace/maintenance/wakeflow-host-maintenance-contribution.js";
import { assertWakeflowMaintenanceGateContext, WakeflowMaintenanceGateError, } from "../../workspace/maintenance/wakeflow-maintenance-gate.js";
import { isWakeflowDetachAction } from "../../workspace/maintenance/wakeflow-static-materialization-preview-contract.js";
import { WakeflowWindowRuntimeProjectionError } from "../../workspace/window-runtime/wakeflow-window-runtime-projection-inspection.js";
import { executeWakeflowWindowRuntimeProjectionOperation, planWakeflowWindowRuntimeProjectionMaintenance, WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OPERATION_KIND, WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OWNER_ID, } from "../../workspace/window-runtime/wakeflow-window-runtime-projection-maintenance.js";
import { CLAUDE_CODE_DESKTOP_ASSET_BLOCKER, CLAUDE_CODE_DESKTOP_ASSET_OPERATION_KIND, CLAUDE_CODE_DESKTOP_ASSET_OWNER_ID, executeClaudeCodeDesktopAssetOperation, planClaudeCodeDesktopAssetOperation, } from "./claude-code-desktop-asset-operation.js";
import { CLAUDE_CODE_DESKTOP_ASSET_FILE_NAME } from "./claude-code-desktop-asset.js";
import { ClaudeCodeHostAssetOperationError } from "./claude-code-host-asset-operation.js";
import { CLAUDE_CODE_PORTABLE_SETTINGS_REMOVAL_OPERATION_KIND, claudeCodePortableSettingsRemovalTargetKey, planClaudeCodePortableSettingsComposition, } from "./claude-code-portable-settings-composition.js";
import { ClaudeCodePortableSettingsOperationExecutionError, executeClaudeCodePortableSettingsOperation, } from "./claude-code-portable-settings-operation-executor.js";
import { CLAUDE_CODE_STATUSLINE_ASSET_OPERATION_KIND, CLAUDE_CODE_STATUSLINE_ASSET_OWNER_ID, executeClaudeCodeStatuslineAssetOperation, planClaudeCodeStatuslineAssetOperation, } from "./claude-code-statusline-asset-operation.js";
import { CLAUDE_CODE_STATUSLINE_ASSET_FILE_NAME } from "./claude-code-statusline-asset.js";
import { CLAUDE_CODE_STATUSLINE_REMOVAL_OPERATION_KIND, CLAUDE_CODE_STATUSLINE_SETTINGS_BLOCKER, CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_KIND, CLAUDE_CODE_STATUSLINE_SETTINGS_OWNER_ID, ClaudeCodeStatuslineSettingsOperationError, executeClaudeCodeStatuslineSettingsOperation, executeClaudeCodeStatuslineSettingsRemoval, planClaudeCodeStatuslineSettingsOperation, planClaudeCodeStatuslineSettingsRemoval, planClaudeCodeStatuslineSettingsSurfaceOperations, } from "./claude-code-statusline-settings-operation.js";
import { CLAUDE_CODE_TMUX_ASSET_BLOCKER, CLAUDE_CODE_TMUX_ASSET_OPERATION_KIND, CLAUDE_CODE_TMUX_ASSET_OWNER_ID, executeClaudeCodeTmuxAssetOperation, planClaudeCodeTmuxAssetOperation, } from "./claude-code-tmux-asset-operation.js";
import { CLAUDE_CODE_TMUX_ASSET_FILE_NAME } from "./claude-code-tmux-asset.js";
import { claudeCodeWindowHostIdentityProfile } from "./claude-code-window-host-identity-profile.js";
import { CLAUDE_CODE_WINDOW_TRANSPORT_RETIREMENT_OPERATION_KIND, CLAUDE_CODE_WINDOW_TRANSPORT_RETIREMENT_OWNER_ID, ClaudeCodeWindowTransportRetirementError, executeClaudeCodeWindowTransportRetirement, planClaudeCodeWindowTransportRetirement, } from "./claude-code-window-transport-retirement.js";
/**
 * Wakeflow Host / Claude Code：当前 Claude 宿主维护 capability。
 *
 * 它把 portable settings 的多根只读计划、选出传输的宿主资产的字节核对与本地设置里状态栏条目的核对
 * 转换成共享 contribution，并在唯一 Maintenance Gate 内以闭合分派执行 exact operation。宿主资产集合随
 * 请求里选出的 profile（ADR-0025 D6）：窗口传输助手按 `surfaces.helperAsset.fileName` 查本模块的助手表
 * （tmux 助手或桌面助手，各自的操作模块）；状态栏资产与它在本地设置里的条目只在 `surfaces.statuslineAsset`
 * 非空时计划（tmux 传输有，桌面传输没有）。共享层不依赖本模块；每种 operationKind 都在这里显式分派，
 * 不注册动态 handler。资产字节或本地设置读不稳时贡献 blocked 并带稳定 blocker，不把未分类的宿主错误抛给
 * 维护预览：读不出的宿主制品不能让整个工作区无法维护。
 *
 * 退出路径（ADR-0024）的贡献只有两种宿主删除步：`remove-portable-settings-rules`（targetKey 程序根
 * `program`、支撑面 `support:<surfaceId>`）与 `remove-statusline-entry`（`statusline`、
 * `statusline:support:<surfaceId>`）；operationKind 就是共享步骤表里的种类名。两种删除步都不分传输：
 * 规则表删两种传输的助手规则，状态行删除只删在场且是 Wakeflow 的条目，没有即 current。
 *
 * 换传输（ADR-0025 K2，裁定 4）：reconfigure 的期望 Config 换了窗口传输时，贡献另出两类步——每个有登记的窗口
 * 一条 `window-transport-retirement`（删绑定与定位器、投影发布成 unregistered，见退役模块），以及不发布状态栏的
 * profile 的 `remove-statusline-entry`（离开 tmux 时删掉 Wakeflow 的状态行条目）；便携设置的写入路径本来就把
 * 另一种传输的助手规则作为退役规则删掉。状态行删除不只在切换时计划：不发布状态栏的传输上任何一次 reconcile
 * 或 reconfigure 都删在场的 Wakeflow 条目，没有即零步，所以中断后的对账同样收敛。
 */
const CLAUDE_CODE_MAINTENANCE_CAPABILITY_ID = "claude-code-maintenance";
const PORTABLE_SETTINGS_OPERATION_KIND = "portable-settings";
const PORTABLE_SETTINGS_OWNER_ID = "claude-code-portable-settings";
const ERROR_MESSAGES = {
    gate: "Claude Code maintenance capability requires the active matching gate.",
    operation: "Claude Code maintenance capability operation is invalid.",
    owner: "Claude Code maintenance capability owner failed.",
    profile: "Claude Code maintenance capability does not provide this Host Profile's assets.",
};
/** Claude Code maintenance capability 失败的稳定、脱敏错误。 */
class ClaudeCodeMaintenanceCapabilityError extends Error {
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
/**
 * 两种窗口传输的助手资产，按 profile 的助手文件名查表（ADR-0025 D6）：这是本宿主维护里唯一认识
 * "哪个文件名由哪个操作模块发布"的地方；共享层只传选出的 profile。
 */
const HELPER_ASSET_OPERATIONS_BY_FILE_NAME = new Map([
    [
        CLAUDE_CODE_TMUX_ASSET_FILE_NAME,
        Object.freeze({
            operationKind: CLAUDE_CODE_TMUX_ASSET_OPERATION_KIND,
            ownerId: CLAUDE_CODE_TMUX_ASSET_OWNER_ID,
            blocker: CLAUDE_CODE_TMUX_ASSET_BLOCKER,
            plan: planClaudeCodeTmuxAssetOperation,
            execute: executeClaudeCodeTmuxAssetOperation,
        }),
    ],
    [
        CLAUDE_CODE_DESKTOP_ASSET_FILE_NAME,
        Object.freeze({
            operationKind: CLAUDE_CODE_DESKTOP_ASSET_OPERATION_KIND,
            ownerId: CLAUDE_CODE_DESKTOP_ASSET_OWNER_ID,
            blocker: CLAUDE_CODE_DESKTOP_ASSET_BLOCKER,
            plan: planClaudeCodeDesktopAssetOperation,
            execute: executeClaudeCodeDesktopAssetOperation,
        }),
    ],
]);
/** 选出的 profile 要发布的助手资产操作；没有助手或文件名不在表里的 profile 不是本宿主的传输。 */
function helperAssetOperationsOf(profile) {
    const fileName = profile.surfaces.helperAsset?.fileName;
    const operations = fileName === undefined ? undefined : HELPER_ASSET_OPERATIONS_BY_FILE_NAME.get(fileName);
    if (operations === undefined)
        fail("profile", "$profile/surfaces/helperAsset");
    return operations;
}
/** 选出的 profile 是否发布状态栏（tmux 传输）；声明了别的状态栏文件名的 profile 不是本宿主的传输。 */
function publishesStatusline(profile) {
    const statusline = profile.surfaces.statuslineAsset;
    if (statusline === null)
        return false;
    if (statusline.fileName !== CLAUDE_CODE_STATUSLINE_ASSET_FILE_NAME) {
        fail("profile", "$profile/surfaces/statuslineAsset");
    }
    return true;
}
/** 资产字节读不稳时不猜：整份贡献 blocked，不带该操作，而不是抛出未分类的宿主错误。 */
async function planHostAsset(plan, blocker, signal) {
    try {
        return {
            operation: await plan(signal === undefined ? {} : { signal }),
            blocker: null,
        };
    }
    catch (error) {
        if (error instanceof ClaudeCodeHostAssetOperationError) {
            if (error.reason === "read")
                return { operation: null, blocker };
            fail("owner", error.path);
        }
        throw error;
    }
}
/** 本地设置读不出或不是 JSON 对象时不猜：整份贡献 blocked，不带该操作；支撑面各自带 surfaceId 的 blocker。 */
async function planStatuslineSettings(root, request) {
    const signal = request.signal === undefined ? {} : { signal: request.signal };
    try {
        const program = await planClaudeCodeStatuslineSettingsOperation(root, signal);
        const surfaces = await planClaudeCodeStatuslineSettingsSurfaceOperations(root, {
            action: request.action,
            config: request.config,
            ...signal,
        });
        return {
            operations: [...(program === null ? [] : [program]), ...surfaces.operations],
            blockerCodes: surfaces.blockerCodes,
        };
    }
    catch (error) {
        if (error instanceof ClaudeCodeStatuslineSettingsOperationError) {
            if (error.reason === "settings-unreadable") {
                return { operations: [], blockerCodes: [CLAUDE_CODE_STATUSLINE_SETTINGS_BLOCKER] };
            }
            fail("owner", error.path);
        }
        throw error;
    }
}
/** 退出路径的状态行删除计划；读不出的根已在计划里记为 blocker，其余宿主错误按 owner 失败。 */
async function planStatuslineRemoval(root, request) {
    try {
        return await planClaudeCodeStatuslineSettingsRemoval(root, {
            action: request.action,
            config: request.config,
            ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
    }
    catch (error) {
        if (error instanceof ClaudeCodeStatuslineSettingsOperationError)
            fail("owner", error.path);
        throw error;
    }
}
/**
 * 退出路径（ADR-0024）的宿主贡献只有两种删除步：程序根与托管支撑面里 Wakeflow 的允许规则条目、Wakeflow
 * 自己的状态行条目。资产在 `.wakeflow-local` 下一律不碰，窗口投影由共享步退役，规则与条目都不再写入；
 * detach-repository 没有宿主维度，两处计划都是空集。宿主步的顺序由共享执行计划给出（每步依赖前一步）。
 * detach-workspace 的 `config` 是当前配置：要清理的就是它声明的托管支撑面。
 */
async function planDetachContribution(root, request) {
    const composition = await planClaudeCodePortableSettingsComposition(root, {
        action: request.action,
        config: request.config,
        profile: request.profile,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    const statusline = await planStatuslineRemoval(root, request);
    const blockerCodes = [...composition.blockerCodes, ...statusline.blockerCodes];
    return createWakeflowHostMaintenanceContribution({
        hostId: "claude-code",
        capabilityId: CLAUDE_CODE_MAINTENANCE_CAPABILITY_ID,
        status: blockerCodes.length === 0 ? "ready" : "blocked",
        blockerCodes,
        operations: [
            ...composition.operations.map((operation) => ({
                operationId: operation.operationId,
                operationKind: CLAUDE_CODE_PORTABLE_SETTINGS_REMOVAL_OPERATION_KIND,
                ownerId: PORTABLE_SETTINGS_OWNER_ID,
                targetKey: claudeCodePortableSettingsRemovalTargetKey(operation.root),
                sourceDigest: operation.sourceDigest,
                targetDigest: operation.targetDigest,
                payload: operation,
            })),
            ...statusline.operations,
        ],
    });
}
/**
 * 不发布状态栏的传输（桌面）上，程序根与托管支撑面里 Wakeflow 自己的状态行条目要删（离开 tmux）。删除计划与
 * detach-workspace 用的是同一份：它对这组根只删所有权判定为 Wakeflow 的那一条、没有即零步，负载里不带动作，
 * 所以这里按 detach-workspace 的根集合求它；执行走同一个删除 executor。fresh-initialize 没有可删的条目。
 */
async function planStatuslineRetirement(root, request) {
    if (request.action === "fresh-initialize")
        return { operations: [], blockerCodes: [] };
    return planStatuslineRemoval(root, { ...request, action: "detach-workspace" });
}
/** 换传输时旧登记的退役计划（K2）；宿主错误按 owner 失败。 */
async function planWindowTransportRetirement(root, request) {
    try {
        return await planClaudeCodeWindowTransportRetirement(root, request);
    }
    catch (error) {
        if (error instanceof ClaudeCodeWindowTransportRetirementError)
            fail("owner", error.path);
        throw error;
    }
}
async function planContribution(root, request) {
    if (isWakeflowDetachAction(request.action))
        return planDetachContribution(root, request);
    // 宿主资产集合随选出的 profile（ADR-0025 D6）：助手按文件名查表；状态栏只在 profile 声明它时发布。
    const helper = helperAssetOperationsOf(request.profile);
    const statuslinePublished = publishesStatusline(request.profile);
    const composition = await planClaudeCodePortableSettingsComposition(root, {
        action: request.action,
        config: request.config,
        profile: request.profile,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    const statusline = statuslinePublished
        ? await planHostAsset((options) => planClaudeCodeStatuslineAssetOperation(root, options), CLAUDE_CODE_STATUSLINE_ASSET_BLOCKER, request.signal)
        : { operation: null, blocker: null };
    const helperAsset = await planHostAsset((options) => helper.plan(root, options), helper.blocker, request.signal);
    const settings = statuslinePublished
        ? await planStatuslineSettings(root, request)
        : await planStatuslineRetirement(root, request);
    const retirement = await planWindowTransportRetirement(root, request);
    const projections = await planProjections(root, request);
    // 被退役的窗口由退役操作自己发布 unregistered 投影；按旧绑定算出的 registered 投影操作不再执行。
    const projectionOperations = projections.operations.filter((operation) => !retirement.retiredWindowIds.includes(operation.targetKey));
    // blocker 在边界内排序去重前必须互不相同：六个来源的前缀各不相同（状态行安装与删除不会同时计划）。
    const blockerCodes = [
        ...composition.blockerCodes,
        ...(statusline.blocker === null ? [] : [statusline.blocker]),
        ...(helperAsset.blocker === null ? [] : [helperAsset.blocker]),
        ...settings.blockerCodes,
        ...retirement.blockerCodes,
        ...projections.blockerCodes,
    ];
    return createWakeflowHostMaintenanceContribution({
        hostId: "claude-code",
        capabilityId: CLAUDE_CODE_MAINTENANCE_CAPABILITY_ID,
        status: blockerCodes.length === 0 ? "ready" : "blocked",
        blockerCodes,
        operations: [
            ...composition.operations.map((operation) => ({
                operationId: operation.operationId,
                operationKind: PORTABLE_SETTINGS_OPERATION_KIND,
                ownerId: PORTABLE_SETTINGS_OWNER_ID,
                targetKey: `settings:${operation.root.rootKind}:${operation.root.rootId}`,
                sourceDigest: operation.sourceDigest,
                targetDigest: operation.targetDigest,
                payload: operation,
            })),
            ...(statusline.operation === null ? [] : [statusline.operation]),
            ...(helperAsset.operation === null ? [] : [helperAsset.operation]),
            ...settings.operations,
            ...retirement.operations,
            ...projectionOperations,
        ],
    });
}
/** 对账时缺失或过期的窗口运行投影：与 Codex 共用同一 workspace owner，只换 identity profile。 */
async function planProjections(root, request) {
    try {
        return await planWakeflowWindowRuntimeProjectionMaintenance(root, {
            action: request.action,
            config: request.config,
            resourceProfile: request.profile,
            identityProfile: claudeCodeWindowHostIdentityProfile,
            ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
    }
    catch (error) {
        if (error instanceof WakeflowWindowRuntimeProjectionError) {
            fail("owner", error.path);
        }
        throw error;
    }
}
async function executeProjectionOperation(root, request) {
    try {
        return await executeWakeflowWindowRuntimeProjectionOperation(root, {
            config: request.config,
            resourceProfile: request.profile,
            identityProfile: claudeCodeWindowHostIdentityProfile,
            operationId: request.operation.operationId,
            targetKey: request.operation.targetKey,
            targetDigest: request.operation.targetDigest,
            ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
    }
    catch (error) {
        if (error instanceof WakeflowWindowRuntimeProjectionError) {
            fail("owner", error.path);
        }
        throw error;
    }
}
async function executeHostAssetOperation(execute, root, request) {
    try {
        const executed = await execute(root, {
            operation: request.operation.payload,
            recoveringAffectedOperation: request.recoveringAffectedOperation,
            ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
        if (executed.operationId !== request.operation.operationId ||
            executed.targetDigest !== request.operation.targetDigest) {
            fail("owner", "$operation");
        }
        return Object.freeze({
            operationId: executed.operationId,
            disposition: executed.disposition,
            observationDigest: executed.targetDigest,
        });
    }
    catch (error) {
        if (error instanceof ClaudeCodeHostAssetOperationError)
            fail("owner", error.path);
        throw error;
    }
}
/** 安装与删除共用一条核对路：executor 由 operationKind 选定，负载形状由 executor 自己准入。 */
async function executeStatuslineSettingsOperation(root, request, execute) {
    try {
        const executed = await execute(root, {
            config: request.config,
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
async function executeWindowTransportRetirement(root, request) {
    try {
        return await executeClaudeCodeWindowTransportRetirement(root, request);
    }
    catch (error) {
        if (error instanceof ClaudeCodeWindowTransportRetirementError)
            fail("owner", error.path);
        throw error;
    }
}
/** 退出路径的 portable settings 负载带 `action: "remove"`（ADR-0024）；只看这一个判别字段，完整准入在 executor。 */
function portableSettingsPayloadRemoves(payload) {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload))
        return false;
    return payload.action === "remove";
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
    if (request.operation.operationKind === CLAUDE_CODE_STATUSLINE_ASSET_OPERATION_KIND &&
        request.operation.ownerId === CLAUDE_CODE_STATUSLINE_ASSET_OWNER_ID) {
        return executeHostAssetOperation(executeClaudeCodeStatuslineAssetOperation, root, request);
    }
    // 两种传输的助手资产各有自己的种类与 owner；计划里只会有选出传输的那一份，执行按它分派。
    for (const helper of HELPER_ASSET_OPERATIONS_BY_FILE_NAME.values()) {
        if (request.operation.operationKind === helper.operationKind &&
            request.operation.ownerId === helper.ownerId) {
            return executeHostAssetOperation(helper.execute, root, request);
        }
    }
    if (request.operation.operationKind === CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_KIND &&
        request.operation.ownerId === CLAUDE_CODE_STATUSLINE_SETTINGS_OWNER_ID) {
        return executeStatuslineSettingsOperation(root, request, executeClaudeCodeStatuslineSettingsOperation);
    }
    if (request.operation.operationKind === CLAUDE_CODE_STATUSLINE_REMOVAL_OPERATION_KIND &&
        request.operation.ownerId === CLAUDE_CODE_STATUSLINE_SETTINGS_OWNER_ID) {
        return executeStatuslineSettingsOperation(root, request, executeClaudeCodeStatuslineSettingsRemoval);
    }
    if (request.operation.operationKind === WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OPERATION_KIND &&
        request.operation.ownerId === WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OWNER_ID) {
        return executeProjectionOperation(root, request);
    }
    if (request.operation.operationKind === CLAUDE_CODE_WINDOW_TRANSPORT_RETIREMENT_OPERATION_KIND &&
        request.operation.ownerId === CLAUDE_CODE_WINDOW_TRANSPORT_RETIREMENT_OWNER_ID) {
        return executeWindowTransportRetirement(root, request);
    }
    // 写入与删除共用一个 executor；种类与负载的 action 不一致的操作在任何效果前拒绝。
    const removal = request.operation.operationKind === CLAUDE_CODE_PORTABLE_SETTINGS_REMOVAL_OPERATION_KIND;
    if ((!removal && request.operation.operationKind !== PORTABLE_SETTINGS_OPERATION_KIND) ||
        request.operation.ownerId !== PORTABLE_SETTINGS_OWNER_ID ||
        portableSettingsPayloadRemoves(request.operation.payload) !== removal) {
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
    if (executed.operationId !== request.operation.operationId ||
        executed.targetDigest !== request.operation.targetDigest) {
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
