import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

/**
 * 真实 MCP 入口，唯一的注入是一道落盘之后的屏障（open-items B9）：父目录句柄第 `occurrence` 次同步了路径里含
 * `fragment` 的资源之后，进程写下标记并停住，测试随即 SIGKILL 它。它是 `append-crash-process` 的通用版——
 * 那一个按链接数认两个追加位置，这一个按"第几次落盘"扫过一个操作的各个中断点。
 */
export async function startSyncCrashProcess(marker: string, fragment: string, occurrence: number) {
  const parentModule = new URL(
    "../../src/foundation/filesystem/rooted-resource-parent-handle.js",
    import.meta.url,
  );
  const entrypoint = new URL("../../src/entrypoints/codex-wakeflow-mcp.js", import.meta.url);
  const program = `
    import { writeFileSync } from "node:fs";
    import { RootedResourceParentHandle } from ${JSON.stringify(parentModule.href)};
    import { runCodexWakeflowMcpStdio } from ${JSON.stringify(entrypoint.href)};
    const [marker, fragment, occurrence] = [process.argv[1], process.argv[2], Number(process.argv[3])];
    let seen = 0;
    const sync = RootedResourceParentHandle.prototype.sync;
    RootedResourceParentHandle.prototype.sync = async function() {
      const result = await sync.call(this);
      if (this.resourceAbsolutePath.includes(fragment)) {
        seen += 1;
        if (seen === occurrence) {
          writeFileSync(marker, String(seen));
          await new Promise(() => setInterval(() => {}, 1000));
        }
      }
      return result;
    };
    runCodexWakeflowMcpStdio("1.0.0-test");
  `;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--input-type=module", "-e", program, marker, fragment, String(occurrence)],
    stderr: "pipe",
  });
  const client = new Client({ name: "sync-crash-test", version: "1" });
  await client.connect(transport);
  let crashed = false;
  return Object.freeze({
    client,
    /** 等屏障；操作在到达第 `occurrence` 次落盘之前就结束了（`settled` 先完成）时返回 false。 */
    async paused(settled: Promise<unknown>): Promise<boolean> {
      let done = false;
      void settled.then(
        () => {
          done = true;
        },
        () => {
          done = true;
        },
      );
      for (let i = 0; i < 2000 && !existsSync(marker) && !done; i += 1) await delay(10);
      return existsSync(marker);
    },
    crash() {
      if (transport.pid === null) throw new Error("Expected owned server PID.");
      process.kill(transport.pid, "SIGKILL");
      crashed = true;
    },
    async close() {
      if (!crashed && transport.pid !== null) process.kill(transport.pid, "SIGKILL");
      await client.close().catch(() => undefined);
    },
  });
}
