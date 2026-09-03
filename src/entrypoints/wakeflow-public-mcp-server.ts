import { McpServer } from "@modelcontextprotocol/server";

import {
  WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
} from "../governance/controller/demand-controller-route-public-contract.js";
import {
  registerWakeflowPublicMcpAuthorityTools,
} from "./wakeflow-public-mcp-authority-tools.js";
import {
  registerWakeflowPublicMcpExecutionTools,
} from "./wakeflow-public-mcp-execution-tools.js";
import {
  registerWakeflowPublicMcpReviewTools,
} from "./wakeflow-public-mcp-review-tools.js";
import {
  parseCreateWakeflowPublicMcpServerOptions,
  type CreateWakeflowPublicMcpServerOptions,
} from "./wakeflow-public-mcp-server-configuration.js";
import {
  registerWakeflowPublicMcpWorkspaceTools,
} from "./wakeflow-public-mcp-workspace-tools.js";

export {
  WakeflowPublicMcpServerConfigurationError,
} from "./wakeflow-public-mcp-server-configuration.js";

/**
 * Wakeflow公共MCP的唯一组合根。
 *
 * 官方SDK拥有协议、Schema准入和工具调用生命周期；四个静态注册组只把固定executor
 * 连接到真实领域owner。本文件不保存动态registry、不选择下一业务步骤，也不执行宿主效果。
 */
export function createWakeflowPublicMcpServer(
  options: Readonly<CreateWakeflowPublicMcpServerOptions>,
): McpServer {
  const admitted = parseCreateWakeflowPublicMcpServerOptions(options);
  const server = new McpServer(
    {
      name: admitted.serverName,
      version: admitted.serverVersion,
    },
    {
      instructions: [
        "Wakeflow exposes local, closed-world workflow tools and never performs Agent host effects.",
        "For preview/apply capabilities, obtain a preview first and apply only the exact returned confirmation or plan with its digest; use recover only with the exact evidence required by that tool.",
        `For an existing Demand, call ${WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME} after each successful state mutation to identify the next domain owner.`,
        "Inspection results and TargetResults are evidence, not mutation authority or Controller acceptance.",
        "Each tool description and Schema defines its exact input, effect, recovery, and disclosure boundary.",
      ].join(" "),
    },
  );

  registerWakeflowPublicMcpWorkspaceTools(server, admitted);
  registerWakeflowPublicMcpAuthorityTools(server, admitted);
  registerWakeflowPublicMcpExecutionTools(server, admitted);
  registerWakeflowPublicMcpReviewTools(server, admitted);
  return server;
}
