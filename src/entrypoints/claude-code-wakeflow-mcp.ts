import type { McpServer } from "@modelcontextprotocol/server";
import type { StdioServerHandle } from "@modelcontextprotocol/server/stdio";

import { executeTargetDeliveryPreparationPublicRequest } from "../governance/delivery/target-delivery-preparation-public-coordinator.js";
import { executeTargetHostEffectClaimPublicRequest } from "../governance/delivery/target-host-effect-claim-public-coordinator.js";
import { executeTargetHostEffectOutcomePublicRequest } from "../governance/delivery/target-host-effect-outcome-public-coordinator.js";
import { executeTargetHostEffectRearmPublicRequest } from "../governance/delivery/target-host-effect-rearm-public-coordinator.js";
import { executeTargetResultImportPublicRequest } from "../governance/result/target-result-import-public-coordinator.js";
import { executeTestDeliveryPreparationPublicRequest } from "../governance/testing/test-delivery-preparation-public-coordinator.js";
import { claudeCodeWindowHostIdentityProfile } from "../hosts/claude-code/claude-code-window-host-identity-profile.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { executeWakeflowWindowHostBindingPublicRequest } from "../workspace/window-runtime/wakeflow-window-host-binding-public-coordinator.js";
import { executeClaudeCodeWakeflowMaintenance } from "./claude-code-wakeflow-maintenance.js";
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

const CLAUDE_CODE_WAKEFLOW_MCP_SERVER_NAME = "wakeflow-claude-code" as const;

const CLAUDE_CODE_HOST_IDENTITY = Object.freeze({ hostId: "claude-code" as const });

const CLAUDE_CODE_HOST_FACADE = Object.freeze({
  hostId: "claude-code" as const,
  resourceProfile: claudeCodeWorkspaceHostResourceProfile,
  identityProfile: claudeCodeWindowHostIdentityProfile,
});

/** 创建按登记表发布全部公共工具的 Claude Code MCP server。 */
export function createClaudeCodeWakeflowMcpServer(
  serverVersion: string,
): McpServer {
  return createWakeflowPublicMcpServer({
    serverName: CLAUDE_CODE_WAKEFLOW_MCP_SERVER_NAME,
    serverVersion,
    ...WAKEFLOW_SHARED_PUBLIC_EXECUTORS,
    executeMaintenance: executeClaudeCodeWakeflowMaintenance,
    registerWindowHostBinding: (value: unknown) =>
      executeWakeflowWindowHostBindingPublicRequest(CLAUDE_CODE_HOST_FACADE, value),
    prepareImplementationDelivery: (value: unknown) =>
      executeTargetDeliveryPreparationPublicRequest(CLAUDE_CODE_HOST_FACADE, value),
    prepareTestDelivery: (value: unknown) =>
      executeTestDeliveryPreparationPublicRequest(CLAUDE_CODE_HOST_FACADE, value),
    claimTargetHostEffect: (value: unknown) =>
      executeTargetHostEffectClaimPublicRequest(CLAUDE_CODE_HOST_FACADE, value),
    rearmTargetHostEffect: (value: unknown) =>
      executeTargetHostEffectRearmPublicRequest(CLAUDE_CODE_HOST_FACADE, value),
    recordTargetHostEffectOutcome: (value: unknown) =>
      executeTargetHostEffectOutcomePublicRequest(CLAUDE_CODE_HOST_IDENTITY, value),
    importTargetResult: (value: unknown) =>
      executeTargetResultImportPublicRequest(CLAUDE_CODE_HOST_IDENTITY, value),
  });
}

/** 通过官方 stdio transport 运行 Claude Code MCP composition root。 */
export function runClaudeCodeWakeflowMcpStdio(
  serverVersion: string,
): StdioServerHandle {
  return runWakeflowMcpStdio(() =>
    createClaudeCodeWakeflowMcpServer(serverVersion),
  );
}
