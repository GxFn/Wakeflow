import { renderClaudeCodeWindowLaunchInstructions } from "../hosts/claude-code/claude-code-window-launch-instructions.js";
import { executePrepareDeliveryRequest, executeRearmDeliveryRequest, executeRecordDeliveryOutcomeRequest, } from "../capabilities/delivery/service.js";
import { readWindowDesktopSessionId } from "../capabilities/endpoint/locator-store.js";
import { executeWindowBindingRequest } from "../capabilities/endpoint/service.js";
import { executeStatusRequest, executeVerifyRequest } from "../capabilities/observation/service.js";
import { executePodRequest } from "../capabilities/pod/service.js";
import { executeImplementationReviewDecisionRequest, executeTargetResultImportRequest, executeTargetResultReviewInspectionRequest, executeTestReviewDecisionRequest, } from "../capabilities/result-review/service.js";
import { CLAUDE_CODE_DESKTOP_ASSET_DIGEST, CLAUDE_CODE_DESKTOP_ASSET_FILE_NAME, } from "../hosts/claude-code/claude-code-desktop-asset.js";
import { CLAUDE_CODE_STATUSLINE_ASSET_DIGEST, CLAUDE_CODE_STATUSLINE_ASSET_FILE_NAME, } from "../hosts/claude-code/claude-code-statusline-asset.js";
import { CLAUDE_CODE_LOCAL_SETTINGS_REF, CLAUDE_CODE_STATUSLINE_SETTINGS_KEY, claudeCodeStatuslineSettingsEntry, claudeCodeStatuslineEntryIsWakeflows, } from "../hosts/claude-code/claude-code-statusline-settings-operation.js";
import { CLAUDE_CODE_TMUX_ASSET_DIGEST, CLAUDE_CODE_TMUX_ASSET_FILE_NAME, } from "../hosts/claude-code/claude-code-tmux-asset.js";
import { claudeCodeWindowHostIdentityProfile } from "../hosts/claude-code/claude-code-window-host-identity-profile.js";
import { claudeCodeWorkspaceHostResourceProfile, claudeCodeWorkspaceHostTransportTable, } from "../hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWindowHostIdentityProfile } from "../hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { executeClaudeCodeWakeflowMaintenance } from "./claude-code-wakeflow-maintenance.js";
import { resolveWakeflowArtifactIdentity, wakeflowArtifactWriterOf, } from "./wakeflow-artifact-identity.js";
import { runWakeflowMcpStdio } from "./wakeflow-mcp-stdio.js";
import { createWakeflowPublicMcpServer } from "./wakeflow-public-mcp-server.js";
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
    // ADR-0025：tmux 与桌面两种传输的 profile 表，切片按工作区配置选一份。
    transports: claudeCodeWorkspaceHostTransportTable,
    identityProfile: claudeCodeWindowHostIdentityProfile,
    renderLaunchInstructions: renderClaudeCodeWindowLaunchInstructions,
    // F1（ADR-0020）：投递许可签发前核对选出传输的这些资产的字节。
    transportAssets: CLAUDE_CODE_HOST_ASSETS_BY_TRANSPORT,
    // X15：桌面会话传输下投递 prompt 的回传段由服务端渲染 Controller 的桌面会话 id；tmux 定位器读出 null。
    readControllerDesktopSessionId: (root, windowId, bindingId, signal) => readWindowDesktopSessionId(root, "claude-code", windowId, bindingId, signal),
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
/** 创建按登记表发布全部公共工具的 Claude Code MCP server。 */
export function createClaudeCodeWakeflowMcpServer(serverVersion) {
    return createWakeflowPublicMcpServer({
        serverName: CLAUDE_CODE_WAKEFLOW_MCP_SERVER_NAME,
        serverVersion,
        beforeMutation: CLAUDE_CODE_OBSERVATION_FACADE.artifact.assertUnchanged,
        // C11：每次调用的执行上下文带本进程的写者戳；没有 manifest 的构建为 null。
        writer: wakeflowArtifactWriterOf(CLAUDE_CODE_ARTIFACT),
        ...WAKEFLOW_SHARED_PUBLIC_EXECUTORS,
        executeMaintenance: executeClaudeCodeWakeflowMaintenance,
        registerWindowHostBinding: (value, options) => executeWindowBindingRequest(CLAUDE_CODE_HOST_FACADE, value, options),
        managePod: (value, options) => executePodRequest(CLAUDE_CODE_POD_FACADE, value, options),
        inspectStatus: (value, options) => executeStatusRequest(CLAUDE_CODE_OBSERVATION_FACADE, value, options),
        verifyWorkspace: (value, options) => executeVerifyRequest(CLAUDE_CODE_OBSERVATION_FACADE, value, options),
        prepareDelivery: (value, options) => executePrepareDeliveryRequest(CLAUDE_CODE_HOST_FACADE, value, options),
        recordDeliveryOutcome: (value, options) => executeRecordDeliveryOutcomeRequest(CLAUDE_CODE_HOST_FACADE, value, options),
        rearmDelivery: (value, options) => executeRearmDeliveryRequest(CLAUDE_CODE_HOST_FACADE, value, options),
        importTargetResult: (value, options) => executeTargetResultImportRequest(CLAUDE_CODE_HOST_FACADE, value, options),
        inspectTargetResultReview: (value, options) => executeTargetResultReviewInspectionRequest(CLAUDE_CODE_HOST_FACADE, value, options),
        recordImplementationReviewDecision: (value, options) => executeImplementationReviewDecisionRequest(CLAUDE_CODE_HOST_FACADE, value, options),
        recordTestReviewDecision: (value, options) => executeTestReviewDecisionRequest(CLAUDE_CODE_HOST_FACADE, value, options),
    });
}
/** 通过官方 stdio transport 运行 Claude Code MCP composition root。 */
export function runClaudeCodeWakeflowMcpStdio(serverVersion) {
    return runWakeflowMcpStdio(() => createClaudeCodeWakeflowMcpServer(serverVersion));
}
