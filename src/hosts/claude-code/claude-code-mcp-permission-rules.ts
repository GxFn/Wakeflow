import {
  type WakeflowWindowRole,
  wakeflowRoleToolAccess,
} from "../../contracts/vocabulary/wakeflow-role-tool-access.js";

/**
 * Wakeflow Host / Claude Code：按角色的 MCP 允许规则（ADR-0020 决定 3，open-items F2，§13.168）。
 *
 * `plugin_wakeflow_wakeflow` 是 Claude Code 给插件 MCP 服务器的名字；整服务器规则放行它的全部工具，
 * `mcp__<server>__<tool>` 只放行一个工具。Controller 拿整服务器规则，其他角色按归属表逐工具放行。
 * 支撑面根里以前写的整服务器规则由设置转换按退役规则表精确删除。
 */
export const WAKEFLOW_CLAUDE_CODE_MCP_SERVER_PERMISSION_RULE =
  "mcp__plugin_wakeflow_wakeflow" as const;

export function claudeCodeMcpPermissionRulesFor(role: WakeflowWindowRole): readonly string[] {
  const tools = wakeflowRoleToolAccess(role);
  return tools === null
    ? Object.freeze([WAKEFLOW_CLAUDE_CODE_MCP_SERVER_PERMISSION_RULE])
    : Object.freeze(
        tools.map((tool) => `${WAKEFLOW_CLAUDE_CODE_MCP_SERVER_PERMISSION_RULE}__${tool}`),
      );
}
