import { executePrepareDeliveryRequest, executeRearmDeliveryRequest, executeRecordDeliveryOutcomeRequest, } from "../capabilities/delivery/service.js";
import { executeWindowBindingRequest } from "../capabilities/endpoint/service.js";
import { executeStatusRequest, executeVerifyRequest } from "../capabilities/observation/service.js";
import { executePodRequest } from "../capabilities/pod/service.js";
import { executeImplementationReviewDecisionRequest, executeTargetResultImportRequest, executeTargetResultReviewInspectionRequest, executeTestReviewDecisionRequest, } from "../capabilities/result-review/service.js";
import { claudeCodeWindowHostIdentityProfile } from "../hosts/claude-code/claude-code-window-host-identity-profile.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWindowHostIdentityProfile } from "../hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { executeCodexWakeflowMaintenance } from "./codex-wakeflow-maintenance.js";
import { runWakeflowMcpStdio } from "./wakeflow-mcp-stdio.js";
import { createWakeflowPublicMcpServer } from "./wakeflow-public-mcp-server.js";
import { WAKEFLOW_SHARED_PUBLIC_EXECUTORS } from "./wakeflow-public-mcp-shared-executors.js";
/**
 * Wakeflow Entrypoint / Codex：Codex 制品的 MCP composition root。
 *
 * 宿主身份与 profile 在模块装载时固定；需要宿主的工具在这里绑定 facade，其余
 * 复用与宿主无关的 executor。公共目录由登记表生成，本文件不选择业务步骤，也不
 * 执行宿主效果。
 */
const CODEX_WAKEFLOW_MCP_SERVER_NAME = "wakeflow-codex";
const CODEX_HOST_FACADE = Object.freeze({
    hostId: "codex",
    resourceProfile: codexWorkspaceHostResourceProfile,
    identityProfile: codexWindowHostIdentityProfile,
});
/**
 * 观察读两个宿主的绑定与 hook 通道：制品固定携带两份纯数据 profile（§13.94 D1）。
 * 状态栏资产是 Claude 宿主的执行内容，不进 Codex 制品；观察只核对当前宿主的资产，
 * 对端条目固定为 null。
 */
const CODEX_OBSERVATION_FACADE = Object.freeze({
    hostId: "codex",
    hosts: Object.freeze([
        Object.freeze({
            hostId: "codex",
            resourceProfile: codexWorkspaceHostResourceProfile,
            identityProfile: codexWindowHostIdentityProfile,
            statuslineAsset: null,
        }),
        Object.freeze({
            hostId: "claude-code",
            resourceProfile: claudeCodeWorkspaceHostResourceProfile,
            identityProfile: claudeCodeWindowHostIdentityProfile,
            statuslineAsset: null,
        }),
    ]),
});
/** 创建按登记表发布全部公共工具的 Codex MCP server。 */
export function createCodexWakeflowMcpServer(serverVersion) {
    return createWakeflowPublicMcpServer({
        serverName: CODEX_WAKEFLOW_MCP_SERVER_NAME,
        serverVersion,
        ...WAKEFLOW_SHARED_PUBLIC_EXECUTORS,
        executeMaintenance: executeCodexWakeflowMaintenance,
        registerWindowHostBinding: (value) => executeWindowBindingRequest(CODEX_HOST_FACADE, value),
        managePod: (value) => executePodRequest(CODEX_HOST_FACADE, value),
        inspectStatus: (value) => executeStatusRequest(CODEX_OBSERVATION_FACADE, value),
        verifyWorkspace: (value) => executeVerifyRequest(CODEX_OBSERVATION_FACADE, value),
        prepareDelivery: (value) => executePrepareDeliveryRequest(CODEX_HOST_FACADE, value),
        recordDeliveryOutcome: (value) => executeRecordDeliveryOutcomeRequest(CODEX_HOST_FACADE, value),
        rearmDelivery: (value) => executeRearmDeliveryRequest(CODEX_HOST_FACADE, value),
        importTargetResult: (value) => executeTargetResultImportRequest(CODEX_HOST_FACADE, value),
        inspectTargetResultReview: (value) => executeTargetResultReviewInspectionRequest(CODEX_HOST_FACADE, value),
        recordImplementationReviewDecision: (value) => executeImplementationReviewDecisionRequest(CODEX_HOST_FACADE, value),
        recordTestReviewDecision: (value) => executeTestReviewDecisionRequest(CODEX_HOST_FACADE, value),
    });
}
/** 通过官方 stdio transport 运行 Codex MCP composition root。 */
export function runCodexWakeflowMcpStdio(serverVersion) {
    return runWakeflowMcpStdio(() => createCodexWakeflowMcpServer(serverVersion));
}
