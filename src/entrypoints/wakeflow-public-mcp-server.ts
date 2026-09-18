import { McpServer } from "@modelcontextprotocol/server";

import { WAKEFLOW_STATUS_PUBLIC_TOOL_NAME } from "../capabilities/observation/contract.js";
import { WAKEFLOW_PUBLIC_TOOL_CATALOG } from "./wakeflow-public-mcp-catalog.js";
import {
  parseCreateWakeflowPublicMcpServerOptions,
  type CreateWakeflowPublicMcpServerOptions,
} from "./wakeflow-public-mcp-server-configuration.js";
import {
  registerWakeflowPublicMcpCatalog,
  type WakeflowPublicMcpExecutor,
} from "./wakeflow-public-mcp-tool.js";

export { WakeflowPublicMcpServerConfigurationError } from "./wakeflow-public-mcp-server-configuration.js";

/**
 * Wakeflow公共MCP的唯一组合根。
 *
 * 官方SDK拥有协议、Schema准入和工具调用生命周期；目录由登记表生成，宿主组合根
 * 只提供固定的 executor 集合。本文件不保存动态registry、不选择下一业务步骤，
 * 也不执行宿主效果。
 */
export function createWakeflowPublicMcpServer(
  options: Readonly<CreateWakeflowPublicMcpServerOptions>,
): McpServer {
  const admitted = parseCreateWakeflowPublicMcpServerOptions(options, WAKEFLOW_PUBLIC_TOOL_CATALOG);
  const server = new McpServer(
    {
      name: admitted.serverName,
      version: admitted.serverVersion,
    },
    {
      instructions: [
        "Wakeflow exposes local, closed-world workflow tools and never performs Agent host effects.",
        "For preview/apply capabilities, obtain a preview first and apply only with the exact plan or planDigest that preview returned; use recover only with the exact evidence that tool requires.",
        `Call ${WAKEFLOW_STATUS_PUBLIC_TOOL_NAME} (with demandId for one Demand's route) to identify the next owner; every mutation result also carries next.`,
        "Inspection results and TargetResults are evidence, not mutation authority or Controller acceptance.",
        "Each tool description and Schema defines its exact input, effect, recovery, and disclosure boundary.",
      ].join(" "),
    },
  );
  const { serverName: _serverName, serverVersion: _serverVersion, ...executors } = admitted;
  registerWakeflowPublicMcpCatalog(
    server,
    WAKEFLOW_PUBLIC_TOOL_CATALOG,
    executors as Readonly<Record<string, WakeflowPublicMcpExecutor<unknown>>>,
  );
  return server;
}
