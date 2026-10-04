import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

/** 当前真实 MCP 入口，唯一注入是落盘之后的调度屏障。 */
export async function startAppendCrashProcess(marker: string, point: "candidate" | "linked") {
  const parentModule = new URL(
    "../../src/foundation/filesystem/rooted-resource-parent-handle.js",
    import.meta.url,
  );
  const entrypoint = new URL("../../src/entrypoints/codex-wakeflow-mcp.js", import.meta.url);
  const program = `
    import { statSync, writeFileSync } from "node:fs";
    import { RootedResourceParentHandle } from ${JSON.stringify(parentModule.href)};
    import { runCodexWakeflowMcpStdio } from ${JSON.stringify(entrypoint.href)};
    const point = process.argv[2];
    let paused = false;
    async function pause(handle) {
      if (paused) return;
      const node = statSync(handle.resourceAbsolutePath, { throwIfNoEntry: false });
      if (!node || node.nlink !== (point === "linked" ? 2 : 1)) return;
      paused = true;
      writeFileSync(process.argv[1], "paused");
      await new Promise(() => setInterval(() => {}, 1000));
    }
    const close = RootedResourceParentHandle.prototype.close;
    RootedResourceParentHandle.prototype.close = async function() {
      await close.call(this);
      if (point === "candidate" && this.resourceAbsolutePath.includes("/event-sourcing/append-candidates/")) await pause(this);
    };
    const sync = RootedResourceParentHandle.prototype.sync;
    RootedResourceParentHandle.prototype.sync = async function() {
      const result = await sync.call(this);
      if (point === "linked" && this.resourceAbsolutePath.includes("/event-sourcing/commits/")) await pause(this);
      return result;
    };
    runCodexWakeflowMcpStdio("1.0.0-test");
  `;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--input-type=module", "-e", program, marker, point],
    stderr: "pipe",
  });
  const client = new Client({ name: "append-crash-test", version: "1" });
  await client.connect(transport);
  let crashed = false;
  return Object.freeze({
    client,
    async paused() {
      for (let i = 0; i < 1000 && !existsSync(marker); i += 1) await delay(10);
      if (!existsSync(marker)) throw new Error("Append did not reach the durable barrier.");
    },
    crash() {
      if (transport.pid === null) throw new Error("Expected owned server PID.");
      process.kill(transport.pid, "SIGKILL");
      crashed = true;
    },
    async close() {
      if (!crashed && transport.pid !== null) process.kill(transport.pid, "SIGKILL");
      await client.close();
    },
  });
}
