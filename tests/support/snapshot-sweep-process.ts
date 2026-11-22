import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import type { SnapshotSweepSet } from "./snapshot-sweep-copy.js";

/**
 * 快照扫点的子进程：真实 MCP 入口，唯一的注入在变更接缝上（`filesystemMutation`，
 * `src/foundation/filesystem/filesystem-mutation.ts`）。
 *
 * 子进程里接缝的每个成员都被包一层：调用成功返回之后，同步地把快照集（`snapshot-sweep-copy.ts`）拷进
 * `<snapshotDirectory>/<序号>/`，并在 `<snapshotDirectory>/seam.jsonl` 里记一行"第几次、哪个成员、哪些路径"。
 * 调用失败不拷：目录项没有变。拷完才把控制交回被测代码，所以每一份快照都是"进程在这一步之后被杀"时
 * 磁盘上可见的样子。场景的调用全部正常做完之后测试关闭 stdin，子进程照常退出：快照里的每一把锁、
 * 每一个暂存都属于一个已经死掉的进程。启动方式照 `sync-crash-process.ts` 与 `append-crash-process.ts`。
 *
 * 内容同步之后的快照（`contentSync` 为真，扫点范围 `all`）：排他新建（`openExclusive`）返回的句柄再包一层
 * `sync`，内容同步成功之后照样拷一份、记一行，成员名记 `sync`，路径是那个新建的文件。这时内容已写完、
 * 权限位已改好、还没链接或改名，即"内容完整、还没发布"的样子。它不占接缝调用的序号：序号记成前一次接缝
 * 调用的序号加一位小数（`12.1`、`12.2`），两个范围里接缝调用的序号因此相同，显式表可以共用。新建在快照集
 * 之外（`outside:`，Git 临时工作树里的 `.gitignore` 候选）的文件不包：那一份与前一份一模一样。
 * `contentSync` 为假时一个句柄都不包，接缝日志里只有接缝调用。
 *
 * 子进程必须正常退出（退出码 0、没有收到信号）：它在 `exit` 时把退出码与收到过的信号写进
 * `<snapshotDirectory>/exit.json`，`close` 先核对这份记录再读接缝日志。SDK 在 stdin 关闭两秒后还没退出就发
 * `SIGTERM`，入口会照常收尾、退出码仍是 0，所以信号要单独记下：被信号收尾的子进程可能还有调用没做完，
 * 它的接缝日志不能当作完整的场景。
 *
 * 子进程照生产的耐久性落盘（不装 `useDisposableDurability`）；扫点按目录项的变化取点，与落盘次数无关。
 */

/**
 * 接缝日志里的一次调用；路径已换成 `workspace:`、`ledger:` 或 `outside:` 开头的相对写法。内容同步之后的
 * 那一份成员名是 `sync`、序号带一位小数（见文件头）。
 */
export interface SnapshotSweepSeamCall {
  readonly index: number;
  readonly method: string;
  readonly paths: readonly string[];
}

export interface SnapshotSweepProcess {
  readonly client: Client;
  /** 关闭 stdin、等子进程退出并核对它正常退出，返回接缝日志（第 i 项对应快照目录 `<i>`）。 */
  close(): Promise<readonly SnapshotSweepSeamCall[]>;
}

export async function startSnapshotSweepProcess(
  snapshotDirectory: string,
  set: Readonly<SnapshotSweepSet>,
  contentSync: boolean,
): Promise<Readonly<SnapshotSweepProcess>> {
  const mutationModule = new URL(
    "../../src/foundation/filesystem/filesystem-mutation.js",
    import.meta.url,
  );
  const copyModule = new URL("./snapshot-sweep-copy.js", import.meta.url);
  const entrypoint = new URL("../../src/entrypoints/codex-wakeflow-mcp.js", import.meta.url);
  const program = `
    import { appendFileSync, writeFileSync } from "node:fs";
    import path from "node:path";
    import { filesystemMutation } from ${JSON.stringify(mutationModule.href)};
    import { copySnapshotSweepSet } from ${JSON.stringify(copyModule.href)};
    import { runCodexWakeflowMcpStdio } from ${JSON.stringify(entrypoint.href)};
    const [directory, workspace, ledger, contentSync] = process.argv.slice(1);
    const signals = [];
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.prependListener(signal, () => signals.push(signal));
    process.on("exit", (code) => {
      writeFileSync(path.join(directory, "exit.json"), JSON.stringify({ code, signals }));
    });
    const label = (value) => {
      if (typeof value !== "string") return null;
      if (value === ledger || value.startsWith(ledger + path.sep)) return "ledger:" + path.relative(ledger, value);
      if (value === workspace || value.startsWith(workspace + path.sep)) return "workspace:" + path.relative(workspace, value);
      return "outside:" + path.basename(value);
    };
    const record = (key, method, paths) => {
      copySnapshotSweepSet({ workspace, ledger }, path.join(directory, String(key)));
      appendFileSync(path.join(directory, "seam.jsonl"), JSON.stringify({ index: key, method, paths }) + "\\n");
    };
    let index = 0;
    let ordinal = 0;
    for (const method of Object.keys(filesystemMutation)) {
      const original = filesystemMutation[method];
      filesystemMutation[method] = async function (...args) {
        const result = await original.apply(this, args);
        index += 1;
        ordinal = 0;
        record(index, method, args.map(label).filter((entry) => entry !== null));
        const created = method === "openExclusive" && contentSync === "true" ? label(args[0]) : null;
        if (created !== null && !created.startsWith("outside:")) {
          const sync = result.sync;
          result.sync = async function (...syncArgs) {
            const synced = await sync.apply(this, syncArgs);
            ordinal += 1;
            if (ordinal > 9) throw new Error("Snapshot sweep numbers at most nine content syncs between seam calls.");
            record(Number(index + "." + ordinal), "sync", [created]);
            return synced;
          };
        }
        return result;
      };
    }
    runCodexWakeflowMcpStdio("1.0.0-test");
  `;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      "--input-type=module",
      "-e",
      program,
      snapshotDirectory,
      set.workspace,
      set.ledger,
      String(contentSync),
    ],
    stderr: "pipe",
  });
  const client = new Client({ name: "snapshot-sweep-test", version: "1" });
  await client.connect(transport);
  return Object.freeze({
    client,
    async close() {
      await client.close();
      assertNormalExit(path.join(snapshotDirectory, "exit.json"));
      const log = path.join(snapshotDirectory, "seam.jsonl");
      if (!existsSync(log)) return Object.freeze([]);
      return Object.freeze(
        readFileSync(log, "utf8")
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => JSON.parse(line) as SnapshotSweepSeamCall),
      );
    },
  });
}

/** 子进程的退出记录：没有记录（被 `SIGKILL` 之类杀掉）、退出码不是 0、收到过信号，都算异常退出。 */
function assertNormalExit(record: string): void {
  if (!existsSync(record)) throw new Error("Snapshot sweep child left no exit record.");
  const exit = JSON.parse(readFileSync(record, "utf8")) as {
    readonly code: unknown;
    readonly signals: readonly unknown[];
  };
  if (exit.code !== 0 || exit.signals.length > 0) {
    throw new Error(
      `Snapshot sweep child exited abnormally: code ${String(exit.code)}, signals ${exit.signals.join(",") || "none"}.`,
    );
  }
}
