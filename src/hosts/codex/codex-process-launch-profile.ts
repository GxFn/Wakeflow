/**
 * Codex 的桌面进程未必继承登录 shell 的 PATH。宿主给出的 Node 路径优先；
 * 普通 CLI 没有该变量时仍使用 PATH 中的 node。两个位置共用同一段带引号的
 * shell word，路径含空格时也保持单个 argv，不把机器专有路径写进制品。
 */
// biome-ignore lint/suspicious/noTemplateCurlyInString: 在宿主 shell 中展开，空值与缺失都回到 CLI 的 PATH。
export const CODEX_NODE_SHELL_WORD = '"${CODEX_MCP_NODE_PATH:-node}"';

/** MCP 接线属于 Codex 宿主；构建器只读取数据，不再推断宿主启动方式。 */
export const CODEX_MCP_CONFIGURATION = Object.freeze({
  mcpServers: Object.freeze({
    wakeflow: Object.freeze({
      command: "/bin/sh",
      args: Object.freeze(["-c", "exec " + CODEX_NODE_SHELL_WORD + ' ./mcp/server.mjs "$@"', "--"]),
      cwd: ".",
      env_vars: Object.freeze(["CODEX_MCP_NODE_PATH"]),
    }),
  }),
});
