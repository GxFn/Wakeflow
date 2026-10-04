/** Claude Code 的插件根由宿主展开；保持现有直接 Node 启动协议。 */
export const CLAUDE_CODE_MCP_CONFIGURATION = Object.freeze({
  mcpServers: Object.freeze({
    wakeflow: Object.freeze({
      command: "node",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code 在启动时展开插件根。
      args: Object.freeze(["${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs"]),
    }),
  }),
});
