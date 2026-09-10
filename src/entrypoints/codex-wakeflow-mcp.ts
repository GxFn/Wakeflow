import type { McpServer } from "@modelcontextprotocol/server";
import type { StdioServerHandle } from "@modelcontextprotocol/server/stdio";

import {
  executePrepareDeliveryRequest,
  executeRearmDeliveryRequest,
  executeRecordDeliveryOutcomeRequest,
} from "../capabilities/delivery/service.js";
import { executeWindowBindingRequest } from "../capabilities/endpoint/service.js";
import {
  executeImplementationReviewDecisionRequest,
  executeTargetResultImportRequest,
  executeTargetResultReviewInspectionRequest,
  executeTestReviewDecisionRequest,
} from "../capabilities/result-review/service.js";
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

const CODEX_WAKEFLOW_MCP_SERVER_NAME = "wakeflow-codex" as const;

const CODEX_HOST_FACADE = Object.freeze({
  hostId: "codex" as const,
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
});

/** 创建按登记表发布全部公共工具的 Codex MCP server。 */
export function createCodexWakeflowMcpServer(serverVersion: string): McpServer {
  return createWakeflowPublicMcpServer({
    serverName: CODEX_WAKEFLOW_MCP_SERVER_NAME,
    serverVersion,
    ...WAKEFLOW_SHARED_PUBLIC_EXECUTORS,
    executeMaintenance: executeCodexWakeflowMaintenance,
    registerWindowHostBinding: (value: unknown) =>
      executeWindowBindingRequest(CODEX_HOST_FACADE, value),
    prepareDelivery: (value: unknown) => executePrepareDeliveryRequest(CODEX_HOST_FACADE, value),
    recordDeliveryOutcome: (value: unknown) =>
      executeRecordDeliveryOutcomeRequest(CODEX_HOST_FACADE, value),
    rearmDelivery: (value: unknown) => executeRearmDeliveryRequest(CODEX_HOST_FACADE, value),
    importTargetResult: (value: unknown) =>
      executeTargetResultImportRequest(CODEX_HOST_FACADE, value),
    inspectTargetResultReview: (value: unknown) =>
      executeTargetResultReviewInspectionRequest(CODEX_HOST_FACADE, value),
    recordImplementationReviewDecision: (value: unknown) =>
      executeImplementationReviewDecisionRequest(CODEX_HOST_FACADE, value),
    recordTestReviewDecision: (value: unknown) =>
      executeTestReviewDecisionRequest(CODEX_HOST_FACADE, value),
  });
}

/** 通过官方 stdio transport 运行 Codex MCP composition root。 */
export function runCodexWakeflowMcpStdio(serverVersion: string): StdioServerHandle {
  return runWakeflowMcpStdio(() => createCodexWakeflowMcpServer(serverVersion));
}
