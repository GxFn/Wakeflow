import { executePrepareDeliveryRequest, executeRearmDeliveryRequest, executeRecordDeliveryOutcomeRequest, } from "../capabilities/delivery/service.js";
import { readBoundWindowLocator } from "../capabilities/endpoint/locator-store.js";
import { executeWindowBindingRequest } from "../capabilities/endpoint/service.js";
import { executeStatusRequest, executeVerifyRequest } from "../capabilities/observation/service.js";
import { executePodRequest } from "../capabilities/pod/service.js";
import { executeImplementationReviewDecisionRequest, executeTargetResultImportRequest, executeTargetResultReviewInspectionRequest, executeTestReviewDecisionRequest, } from "../capabilities/result-review/service.js";
import { CLAUDE_CODE_DESKTOP_ASSET_DIGEST, CLAUDE_CODE_DESKTOP_ASSET_FILE_NAME, } from "../hosts/claude-code/claude-code-desktop-asset.js";
import { CLAUDE_CODE_STATUSLINE_ASSET_DIGEST, CLAUDE_CODE_STATUSLINE_ASSET_FILE_NAME, } from "../hosts/claude-code/claude-code-statusline-asset.js";
import { CLAUDE_CODE_LOCAL_SETTINGS_REF, CLAUDE_CODE_STATUSLINE_SETTINGS_KEY, claudeCodeStatuslineEntryIsWakeflows, claudeCodeStatuslineSettingsEntry, } from "../hosts/claude-code/claude-code-statusline-settings-operation.js";
import { CLAUDE_CODE_TMUX_ASSET_DIGEST, CLAUDE_CODE_TMUX_ASSET_FILE_NAME, } from "../hosts/claude-code/claude-code-tmux-asset.js";
import { claudeCodeWindowHostIdentityProfile } from "../hosts/claude-code/claude-code-window-host-identity-profile.js";
import { claudeCodeWindowExecutionPlacement, renderClaudeCodeWindowLaunchInstructions, renderClaudeCodeWindowLaunchValues, } from "../hosts/claude-code/claude-code-window-launch-instructions.js";
import { claudeCodeDesktopSessionIdOf, claudeCodeDesktopWindowTransportPort, claudeCodeWindowTransportTable, } from "../hosts/claude-code/claude-code-window-transport-ports.js";
import { claudeCodeWorkspaceHostResourceProfile, claudeCodeWorkspaceHostTransportTable, } from "../hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWindowHostIdentityProfile } from "../hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { selectWakeflowWorkspaceHostResourceProfile } from "../workspace/host-runtime/wakeflow-host-window-transport.js";
import { compileWakeflowWindowLaunchIntents } from "../workspace/window-runtime/wakeflow-window-launch-intent.js";
import { executeClaudeCodeWakeflowMaintenance } from "./claude-code-wakeflow-maintenance.js";
import { resolveWakeflowArtifactIdentity, wakeflowArtifactWriterOf, } from "./wakeflow-artifact-identity.js";
import { createWakeflowCallerRoleGate, resolveWakeflowListedRole, } from "./wakeflow-caller-role-gate.js";
import { runWakeflowMcpStdio } from "./wakeflow-mcp-stdio.js";
import { createWakeflowPublicMcpServer } from "./wakeflow-public-mcp-server.js";
import { withFollowUp } from "./wakeflow-public-mcp-follow-up.js";
import { createQuickDemandExecutor } from "./wakeflow-public-mcp-quick-demand.js";
import { WAKEFLOW_SHARED_PUBLIC_EXECUTORS } from "./wakeflow-public-mcp-shared-executors.js";
/**
 * Wakeflow Entrypoint / Claude Code：Claude Code 制品的 MCP composition root。
 *
 * 宿主身份与 profile 在模块装载时固定；需要宿主的工具在这里绑定 facade，其余
 * 复用与宿主无关的 executor。公共目录由登记表生成，本文件不选择业务步骤，也不
 * 执行宿主效果。
 */
const CLAUDE_CODE_WAKEFLOW_MCP_SERVER_NAME = "wakeflow-claude-code";
/** 状态栏资产与它在本地设置里的条目（§13.94 D6）：只有 tmux 传输发布它。 */
const CLAUDE_CODE_STATUSLINE_EXPECTATION = Object.freeze({
    fileName: CLAUDE_CODE_STATUSLINE_ASSET_FILE_NAME,
    digest: CLAUDE_CODE_STATUSLINE_ASSET_DIGEST,
    settings: Object.freeze({
        path: CLAUDE_CODE_LOCAL_SETTINGS_REF,
        key: CLAUDE_CODE_STATUSLINE_SETTINGS_KEY,
        expectedEntry: claudeCodeStatuslineSettingsEntry,
        ownsEntry: claudeCodeStatuslineEntryIsWakeflows,
    }),
});
/**
 * 本宿主已发布资产的期望，按窗口传输各一份（F1；ADR-0025 D6，与维护发布的集合同源）：tmux 传输是状态栏资产、
 * 它的设置条目与同目录的 tmux 助手（§13.117 D4）；桌面传输只有桌面助手，没有状态栏。切片准入时按工作区配置
 * 的传输键选出一份，与 profile 表同键。
 */
const CLAUDE_CODE_HOST_ASSETS_BY_TRANSPORT = Object.freeze({
    tmux: Object.freeze({
        statusline: CLAUDE_CODE_STATUSLINE_EXPECTATION,
        companions: Object.freeze([
            Object.freeze({
                fileName: CLAUDE_CODE_TMUX_ASSET_FILE_NAME,
                digest: CLAUDE_CODE_TMUX_ASSET_DIGEST,
            }),
        ]),
    }),
    desktop: Object.freeze({
        statusline: null,
        companions: Object.freeze([
            Object.freeze({
                fileName: CLAUDE_CODE_DESKTOP_ASSET_FILE_NAME,
                digest: CLAUDE_CODE_DESKTOP_ASSET_DIGEST,
            }),
        ]),
    }),
});
const CLAUDE_CODE_HOST_FACADE = Object.freeze({
    hostId: "claude-code",
    resourceProfile: claudeCodeWorkspaceHostResourceProfile,
    // ADR-0025：tmux 与桌面两种传输的 profile 表，切片按工作区配置选一份；这一份还带着同键的窗口传输端口
    // （open-items L6），执行端点切片按同一个键取。
    transports: claudeCodeWindowTransportTable,
    identityProfile: claudeCodeWindowHostIdentityProfile,
    renderLaunchInstructions: renderClaudeCodeWindowLaunchInstructions,
    // G14：握手时把这个窗口解析后的启动取值记进绑定。
    renderLaunchValues: renderClaudeCodeWindowLaunchValues,
    // F1（ADR-0020）：投递许可签发前核对选出传输的这些资产的字节。
    transportAssets: CLAUDE_CODE_HOST_ASSETS_BY_TRANSPORT,
    // X15：桌面会话传输下投递 prompt 的回传段由服务端渲染 Controller 的桌面会话 id；tmux 定位器读出 null。
    readControllerDesktopSessionId: async (root, windowId, bindingId, signal) => claudeCodeDesktopSessionIdOf(await readBoundWindowLocator(root, "claude-code", windowId, bindingId, claudeCodeDesktopWindowTransportPort.locatorCodecs, signal)),
});
/** pod 读两个宿主的绑定与投影：对端仍握着的窗口登记也阻塞关闭完成（open-items W7）。 */
const CLAUDE_CODE_POD_FACADE = Object.freeze({
    hostId: "claude-code",
    resourceProfile: claudeCodeWorkspaceHostResourceProfile,
    transports: claudeCodeWorkspaceHostTransportTable,
    identityProfile: claudeCodeWindowHostIdentityProfile,
    hosts: Object.freeze([
        Object.freeze({
            hostId: "claude-code",
            resourceProfile: claudeCodeWorkspaceHostResourceProfile,
            transports: claudeCodeWorkspaceHostTransportTable,
            identityProfile: claudeCodeWindowHostIdentityProfile,
        }),
        Object.freeze({
            hostId: "codex",
            resourceProfile: codexWorkspaceHostResourceProfile,
            identityProfile: codexWindowHostIdentityProfile,
        }),
    ]),
});
/**
 * 本进程启动时固定的制品身份（§13.127；版本轴 §3.6 C6）：status / verify 用它判断服务进程是否过期，
 * 并只对本宿主的窗口比摘要（R-ROOT-04）。
 */
const CLAUDE_CODE_ARTIFACT = resolveWakeflowArtifactIdentity(import.meta.url);
/**
 * 观察读两个宿主的绑定、hook 通道与资产：制品固定携带两份 profile（§13.94 D1）；本宿主的 profile 与资产
 * 期望按传输给表，观察准入时按工作区配置选出（ADR-0025 D1、D6）。
 */
const CLAUDE_CODE_OBSERVATION_FACADE = Object.freeze({
    hostId: "claude-code",
    artifact: CLAUDE_CODE_ARTIFACT,
    hosts: Object.freeze([
        Object.freeze({
            hostId: "claude-code",
            resourceProfile: claudeCodeWorkspaceHostResourceProfile,
            transports: claudeCodeWorkspaceHostTransportTable,
            identityProfile: claudeCodeWindowHostIdentityProfile,
            transportAssets: CLAUDE_CODE_HOST_ASSETS_BY_TRANSPORT,
            artifact: CLAUDE_CODE_ARTIFACT,
            // G14：status 按字段比较本宿主窗口的启动取值；对端宿主的渲染器不进本制品，它的窗口按整份意图摘要比。
            renderLaunchValues: renderClaudeCodeWindowLaunchValues,
        }),
        Object.freeze({
            hostId: "codex",
            resourceProfile: codexWorkspaceHostResourceProfile,
            identityProfile: codexWindowHostIdentityProfile,
            statuslineAsset: null,
            // 对端制品是另一份安装：本进程读不到它的摘要，窗口只按版本比（R-ROOT-04）。
            artifact: null,
        }),
    ]),
});
/** 这份配置里每个窗口的角色与执行根：调用时的门与启动时的工具子集认的是同一份。 */
function claudeCodeWindowExecutionRoots(model) {
    return compileWakeflowWindowLaunchIntents(model, selectWakeflowWorkspaceHostResourceProfile(CLAUDE_CODE_HOST_FACADE, model)).intents.map((intent) => ({
        role: intent.role,
        placement: claudeCodeWindowExecutionPlacement(intent),
    }));
}
/**
 * 创建 Claude Code MCP server。`listedRole` 是启动时认出的窗口角色（ADR-0029）：给了就只发布归属表里它
 * 用得到的工具，缺省发布全部。
 */
export function createClaudeCodeWakeflowMcpServer(serverVersion, listedRole = null) {
    return createWakeflowPublicMcpServer({
        serverName: CLAUDE_CODE_WAKEFLOW_MCP_SERVER_NAME,
        serverVersion,
        listedRole,
        beforeMutation: CLAUDE_CODE_OBSERVATION_FACADE.artifact.assertUnchanged,
        // ADR-0020 决定 3（F1）：服务进程的工作目录是某一种角色的窗口的执行根时，归属表之外的工具被拒绝。
        authorizeCall: createWakeflowCallerRoleGate({
            cwd: process.cwd(),
            executionRoots: claudeCodeWindowExecutionRoots,
        }),
        // C11：每次调用的执行上下文带本进程的写者戳；没有 manifest 的构建为 null。
        writer: wakeflowArtifactWriterOf(CLAUDE_CODE_ARTIFACT),
        ...WAKEFLOW_SHARED_PUBLIC_EXECUTORS,
        executeMaintenance: executeClaudeCodeWakeflowMaintenance,
        registerWindowHostBinding: (value, options) => executeWindowBindingRequest(CLAUDE_CODE_HOST_FACADE, value, options),
        managePod: (value, options) => executePodRequest(CLAUDE_CODE_POD_FACADE, value, options),
        inspectStatus: (value, options) => executeStatusRequest(CLAUDE_CODE_OBSERVATION_FACADE, value, options),
        verifyWorkspace: (value, options) => executeVerifyRequest(CLAUDE_CODE_OBSERVATION_FACADE, value, options),
        prepareDelivery: (value, options) => executePrepareDeliveryRequest(CLAUDE_CODE_HOST_FACADE, value, options),
        // 快速 Demand（ADR-0029 决定 9）：发布、认领、规划、准备投递，服务端按顺序走完。
        quickDemand: createQuickDemandExecutor({
            inspectBoard: WAKEFLOW_SHARED_PUBLIC_EXECUTORS.inspectBoard,
            createDemand: WAKEFLOW_SHARED_PUBLIC_EXECUTORS.createDemand,
            planTargetTask: WAKEFLOW_SHARED_PUBLIC_EXECUTORS.planTargetTask,
            prepareDelivery: (value, options) => executePrepareDeliveryRequest(CLAUDE_CODE_HOST_FACADE, value, options),
        }),
        recordDeliveryOutcome: (value, options) => executeRecordDeliveryOutcomeRequest(CLAUDE_CODE_HOST_FACADE, value, options),
        rearmDelivery: (value, options) => executeRearmDeliveryRequest(CLAUDE_CODE_HOST_FACADE, value, options),
        importTargetResult: (value, options) => executeTargetResultImportRequest(CLAUDE_CODE_HOST_FACADE, value, options),
        inspectTargetResultReview: (value, options) => executeTargetResultReviewInspectionRequest(CLAUDE_CODE_HOST_FACADE, value, options),
        // 接受之后紧接着的一步（ADR-0029 决定 9、10）：accept 带着 thenPlan 就接着规划下一份，带着
        // thenComplete 就接着完成并归档。
        recordImplementationReviewDecision: withFollowUp((value, options) => executeImplementationReviewDecisionRequest(CLAUDE_CODE_HOST_FACADE, value, options), {
            plan: WAKEFLOW_SHARED_PUBLIC_EXECUTORS.planTargetTask,
            complete: WAKEFLOW_SHARED_PUBLIC_EXECUTORS.completeDemand,
        }),
        recordTestReviewDecision: (value, options) => executeTestReviewDecisionRequest(CLAUDE_CODE_HOST_FACADE, value, options),
    });
}
/** 通过官方 stdio transport 运行 Claude Code MCP composition root。 */
export function runClaudeCodeWakeflowMcpStdio(serverVersion) {
    // 角色在进程的一生里不变：认一次，每个连接的工具目录都按它列。
    const listedRole = resolveWakeflowListedRole({
        cwd: process.cwd(),
        env: process.env,
        executionRoots: claudeCodeWindowExecutionRoots,
    });
    return runWakeflowMcpStdio(async () => createClaudeCodeWakeflowMcpServer(serverVersion, await listedRole));
}
