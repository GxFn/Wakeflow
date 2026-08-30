import type { McpServer } from "@modelcontextprotocol/server";
import type { StdioServerHandle } from "@modelcontextprotocol/server/stdio";

import {
  executeClaudeCodeWakeflowMaintenance,
} from "./claude-code-wakeflow-maintenance.js";
import {
  executeClaudeCodeWakeflowWindowHostBindingRegistration,
} from "./claude-code-wakeflow-window-host-binding.js";
import {
  createWakeflowPublicMcpServer,
} from "./wakeflow-public-mcp-server.js";
import {
  executeTargetTaskPlanningPublicRequest,
} from "../governance/tasking/target-task-planning-public-coordinator.js";
import {
  runWakeflowMcpStdio,
} from "./wakeflow-mcp-stdio.js";

/** Claude Code 制品内固定的 MCP server identity；版本由制品装配入口注入。 */
const CLAUDE_CODE_WAKEFLOW_MCP_SERVER_NAME =
  "wakeflow-claude-code" as const;

/** 创建固定组合 Maintenance、Tasking 与 Window Binding 能力的 Claude MCP server。 */
export function createClaudeCodeWakeflowMcpServer(
  serverVersion: string,
): McpServer {
  return createWakeflowPublicMcpServer({
    serverName: CLAUDE_CODE_WAKEFLOW_MCP_SERVER_NAME,
    serverVersion,
    executeMaintenance: executeClaudeCodeWakeflowMaintenance,
    planTargetTask: executeTargetTaskPlanningPublicRequest,
    registerWindowHostBinding:
      executeClaudeCodeWakeflowWindowHostBindingRegistration,
  });
}

/** 通过官方 stdio transport 运行 Claude Code MCP composition root。 */
export function runClaudeCodeWakeflowMcpStdio(
  serverVersion: string,
): StdioServerHandle {
  return runWakeflowMcpStdio(
    () => createClaudeCodeWakeflowMcpServer(serverVersion),
  );
}
