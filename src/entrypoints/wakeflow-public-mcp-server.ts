import { McpServer } from "@modelcontextprotocol/server";

import { WAKEFLOW_STATUS_PUBLIC_TOOL_NAME } from "../capabilities/observation/contract.js";
import { wakeflowRoleToolAccess } from "../contracts/vocabulary/wakeflow-role-tool-access.js";
import { WAKEFLOW_PUBLIC_TOOL_CATALOG } from "./wakeflow-public-mcp-catalog.js";
import type { CreateWakeflowPublicMcpServerOptions } from "./wakeflow-public-mcp-server-configuration.js";
import {
  registerWakeflowPublicMcpCatalog,
  type WakeflowPublicMcpExecutor,
} from "./wakeflow-public-mcp-tool.js";

/**
 * Wakeflow公共MCP的唯一组合根。
 *
 * 官方SDK拥有协议和工具调用生命周期；请求准入归 Wakeflow 自己（SDK 校验器放行，见
 * `wakeflow-public-mcp-tool.ts`）。目录由登记表生成，宿主组合根只提供固定的 executor 集合。
 * 本文件不保存动态registry、不选择下一业务步骤，也不执行宿主效果。
 */
export function createWakeflowPublicMcpServer(
  options: Readonly<CreateWakeflowPublicMcpServerOptions>,
): McpServer {
  const server = new McpServer(
    {
      name: options.serverName,
      version: options.serverVersion,
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
  const {
    serverName: _serverName,
    serverVersion: _serverVersion,
    beforeMutation,
    writer,
    authorizeCall,
    listedRole,
    ...executors
  } = options;
  registerWakeflowPublicMcpCatalog(
    server,
    WAKEFLOW_PUBLIC_TOOL_CATALOG,
    executors as Readonly<Record<string, WakeflowPublicMcpExecutor<unknown>>>,
    beforeMutation,
    writer ?? null,
    authorizeCall,
    listedRole === undefined || listedRole === null ? null : wakeflowRoleToolAccess(listedRole),
  );
  return server;
}
