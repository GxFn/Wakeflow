import type { McpServer } from "@modelcontextprotocol/server";
import type { StdioServerHandle } from "@modelcontextprotocol/server/stdio";

import {
  executeCodexWakeflowMaintenance,
} from "./codex-wakeflow-maintenance.js";
import {
  executeCodexWakeflowWindowHostBindingRegistration,
} from "./codex-wakeflow-window-host-binding.js";
import {
  createWakeflowPublicMcpServer,
} from "./wakeflow-public-mcp-server.js";
import {
  executeTargetTaskPlanningPublicRequest,
} from "../governance/tasking/target-task-planning-public-coordinator.js";
import {
  runWakeflowMcpStdio,
} from "./wakeflow-mcp-stdio.js";

/** Codex 制品内固定的 MCP server identity；版本由制品装配入口注入。 */
const CODEX_WAKEFLOW_MCP_SERVER_NAME = "wakeflow-codex" as const;

/** 创建固定组合 Maintenance、Tasking 与 Window Binding 能力的 Codex MCP server。 */
export function createCodexWakeflowMcpServer(
  serverVersion: string,
): McpServer {
  return createWakeflowPublicMcpServer({
    serverName: CODEX_WAKEFLOW_MCP_SERVER_NAME,
    serverVersion,
    executeMaintenance: executeCodexWakeflowMaintenance,
    planTargetTask: executeTargetTaskPlanningPublicRequest,
    registerWindowHostBinding:
      executeCodexWakeflowWindowHostBindingRegistration,
  });
}

/** 通过官方 stdio transport 运行 Codex MCP composition root。 */
export function runCodexWakeflowMcpStdio(
  serverVersion: string,
): StdioServerHandle {
  return runWakeflowMcpStdio(
    () => createCodexWakeflowMcpServer(serverVersion),
  );
}
