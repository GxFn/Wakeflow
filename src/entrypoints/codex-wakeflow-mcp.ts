import type { McpServer } from "@modelcontextprotocol/server";
import type { StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import {
  executePrepareDeliveryRequest,
  executeRearmDeliveryRequest,
  executeRecordDeliveryOutcomeRequest,
} from "../capabilities/delivery/service.js";
import { executeWindowBindingRequest } from "../capabilities/endpoint/service.js";
import { executeStatusRequest, executeVerifyRequest } from "../capabilities/observation/service.js";
import { executePodRequest } from "../capabilities/pod/service.js";
import {
  executeImplementationReviewDecisionRequest,
  executeTargetResultImportRequest,
  executeTargetResultReviewInspectionRequest,
  executeTestReviewDecisionRequest,
} from "../capabilities/result-review/service.js";
import { claudeCodeWindowHostIdentityProfile } from "../hosts/claude-code/claude-code-window-host-identity-profile.js";
import {
  claudeCodeWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostTransportTable,
} from "../hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWindowHostIdentityProfile } from "../hosts/codex/codex-window-host-identity-profile.js";
import {
  renderCodexWindowLaunchInstructions,
  renderCodexWindowLaunchValues,
} from "../hosts/codex/codex-window-launch-instructions.js";
import { codexWorkspaceHostResourceProfile } from "../hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { executeCodexWakeflowMaintenance } from "./codex-wakeflow-maintenance.js";
import {
  resolveWakeflowArtifactIdentity,
  wakeflowArtifactWriterOf,
} from "./wakeflow-artifact-identity.js";
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

const CODEX_WAKEFLOW_MCP_SERVER_NAME = "wakeflow-codex" as const;

const CODEX_HOST_FACADE = Object.freeze({
  hostId: "codex" as const,
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
  renderLaunchInstructions: renderCodexWindowLaunchInstructions,
  // G14：握手时把这个窗口解析后的启动取值记进绑定。
  renderLaunchValues: renderCodexWindowLaunchValues,
  /** Codex 没有已发布资产面，没有东西可核对（F1）。 */
  assets: null,
});

/** pod 读两个宿主的绑定与投影：对端仍握着的窗口登记也阻塞关闭完成（open-items W7）。 */
const CODEX_POD_FACADE = Object.freeze({
  hostId: "codex" as const,
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
  hosts: Object.freeze([
    Object.freeze({
      hostId: "codex" as const,
      resourceProfile: codexWorkspaceHostResourceProfile,
      identityProfile: codexWindowHostIdentityProfile,
    }),
    Object.freeze({
      hostId: "claude-code" as const,
      resourceProfile: claudeCodeWorkspaceHostResourceProfile,
      // ADR-0025：对端 Claude 工作区可能用桌面传输，pod 读它的绑定时按该工作区配置选 profile。
      transports: claudeCodeWorkspaceHostTransportTable,
      identityProfile: claudeCodeWindowHostIdentityProfile,
    }),
  ]),
});

/**
 * 观察读两个宿主的绑定与 hook 通道：制品固定携带两份纯数据 profile（§13.94 D1）。
 * 状态栏资产是 Claude 宿主的执行内容，不进 Codex 制品；观察只核对当前宿主的资产，
 * 对端条目固定为 null。
 */
const CODEX_ARTIFACT = resolveWakeflowArtifactIdentity(import.meta.url);

const CODEX_OBSERVATION_FACADE = Object.freeze({
  hostId: "codex" as const,
  // 本进程启动时固定的制品身份（§13.127；版本轴 §3.6 C6）。
  artifact: CODEX_ARTIFACT,
  hosts: Object.freeze([
    Object.freeze({
      hostId: "codex" as const,
      resourceProfile: codexWorkspaceHostResourceProfile,
      identityProfile: codexWindowHostIdentityProfile,
      statuslineAsset: null,
      artifact: CODEX_ARTIFACT,
      // G14：status 按字段比较本宿主窗口的启动取值；对端宿主的渲染器不进本制品，它的窗口按整份意图摘要比。
      renderLaunchValues: renderCodexWindowLaunchValues,
    }),
    Object.freeze({
      hostId: "claude-code" as const,
      resourceProfile: claudeCodeWorkspaceHostResourceProfile,
      // ADR-0025：对端 Claude 工作区按它配置的传输选 profile；本进程读不到对端资产，两种传输的期望都为空。
      transports: claudeCodeWorkspaceHostTransportTable,
      identityProfile: claudeCodeWindowHostIdentityProfile,
      statuslineAsset: null,
      transportAssets: Object.freeze({ tmux: null, desktop: null }),
      // 对端制品是另一份安装：本进程读不到它的摘要，窗口只按版本比（R-ROOT-04）。
      artifact: null,
    }),
  ]),
});

/** 创建按登记表发布全部公共工具的 Codex MCP server。 */
export function createCodexWakeflowMcpServer(serverVersion: string): McpServer {
  return createWakeflowPublicMcpServer({
    serverName: CODEX_WAKEFLOW_MCP_SERVER_NAME,
    serverVersion,
    beforeMutation: CODEX_OBSERVATION_FACADE.artifact.assertUnchanged,
    // C11：每次调用的执行上下文带本进程的写者戳；没有 manifest 的构建为 null。
    writer: wakeflowArtifactWriterOf(CODEX_ARTIFACT),
    ...WAKEFLOW_SHARED_PUBLIC_EXECUTORS,
    executeMaintenance: executeCodexWakeflowMaintenance,
    registerWindowHostBinding: (value, options) =>
      executeWindowBindingRequest(CODEX_HOST_FACADE, value, options),
    managePod: (value, options) => executePodRequest(CODEX_POD_FACADE, value, options),
    inspectStatus: (value, options) =>
      executeStatusRequest(CODEX_OBSERVATION_FACADE, value, options),
    verifyWorkspace: (value, options) =>
      executeVerifyRequest(CODEX_OBSERVATION_FACADE, value, options),
    prepareDelivery: (value, options) =>
      executePrepareDeliveryRequest(CODEX_HOST_FACADE, value, options),
    recordDeliveryOutcome: (value, options) =>
      executeRecordDeliveryOutcomeRequest(CODEX_HOST_FACADE, value, options),
    rearmDelivery: (value, options) =>
      executeRearmDeliveryRequest(CODEX_HOST_FACADE, value, options),
    importTargetResult: (value, options) =>
      executeTargetResultImportRequest(CODEX_HOST_FACADE, value, options),
    inspectTargetResultReview: (value, options) =>
      executeTargetResultReviewInspectionRequest(CODEX_HOST_FACADE, value, options),
    recordImplementationReviewDecision: (value, options) =>
      executeImplementationReviewDecisionRequest(CODEX_HOST_FACADE, value, options),
    recordTestReviewDecision: (value, options) =>
      executeTestReviewDecisionRequest(CODEX_HOST_FACADE, value, options),
  });
}

/** 通过官方 stdio transport 运行 Codex MCP composition root。 */
export function runCodexWakeflowMcpStdio(serverVersion: string): StdioServerHandle {
  return runWakeflowMcpStdio(() => createCodexWakeflowMcpServer(serverVersion));
}
