import type {
  McpServerFactory,
} from "@modelcontextprotocol/server";
import {
  serveStdio,
  type StdioServerHandle,
} from "@modelcontextprotocol/server/stdio";

/**
 * Wakeflow Entrypoint / MCP：官方 SDK stdio transport 的进程生命周期边界。
 *
 * stdout 完全保留给 MCP 协议。传输错误和关闭错误只向 stderr 输出稳定摘要，不输出
 * 异常消息、调用栈、路径或请求内容。协议版本协商、分帧和兼容处理全部由官方 SDK
 * 的 `serveStdio` 承担。
 */

function writeStableTransportError(message: string): void {
  process.stderr.write(`${message}\n`);
}

/** 在当前进程 stdio 上运行一个 connection-pinned MCP server factory。 */
export function runWakeflowMcpStdio(
  factory: McpServerFactory,
): StdioServerHandle {
  const handle = serveStdio(factory, {
    legacy: "serve",
    onerror: () => {
      writeStableTransportError("Wakeflow MCP stdio transport failed.");
    },
  });

  let closing = false;
  const close = (): void => {
    if (closing) return;
    closing = true;
    process.off("SIGINT", close);
    process.off("SIGTERM", close);
    void handle.close().catch(() => {
      process.exitCode = 1;
      writeStableTransportError("Wakeflow MCP stdio shutdown failed.");
    });
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  return handle;
}
