import { equal, rejects } from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  test(`${signal} 关闭实际 stdio server，取消在途请求并允许完成结算`, {
    timeout: 15_000,
  }, async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stdio-shutdown-"));
    const started = path.join(directory, "started");
    const settled = path.join(directory, "settled");
    const entrypoint = new URL("../../src/entrypoints/wakeflow-mcp-stdio.js", import.meta.url);
    const sdk = import.meta.resolve("@modelcontextprotocol/server");
    const program = `
      import { writeFileSync } from "node:fs";
      import { setTimeout as delay } from "node:timers/promises";
      import { McpServer } from ${JSON.stringify(sdk)};
      import { runWakeflowMcpStdio } from ${JSON.stringify(entrypoint.href)};
      runWakeflowMcpStdio(() => {
        const server = new McpServer({ name: "shutdown-test", version: "1" });
        server.registerTool("probe", {}, async context => {
          writeFileSync(process.argv[1], "started");
          await new Promise(resolve => context.mcpReq.signal.addEventListener("abort", resolve, { once: true }));
          await delay(10);
          writeFileSync(process.argv[2], "settled");
          return { content: [] };
        });
        return server;
      });
    `;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--input-type=module", "-e", program, started, settled],
      stderr: "pipe",
    });
    const client = new Client({ name: "shutdown-test", version: "1" });
    try {
      await client.connect(transport);
      const interrupted = rejects(client.callTool({ name: "probe" }));
      for (let i = 0; i < 500 && !existsSync(started); i += 1) await delay(5);
      equal(existsSync(started), true);
      if (transport.pid === null) throw new Error("Expected the owned server PID.");
      process.kill(transport.pid, signal);
      await interrupted;
      for (let i = 0; i < 500 && !existsSync(settled); i += 1) await delay(5);
      equal(readFileSync(settled, "utf8"), "settled");
    } finally {
      await client.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
