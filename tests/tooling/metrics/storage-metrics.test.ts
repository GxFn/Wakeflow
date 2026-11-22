// 级别 4（维护者工具）：计数的归类与起不来时报错行的提取是纯函数；计数脚本在一个真实子进程里对已知的调用给出确切的次数，
// 少一个方法时起不来并在 stderr 里留下可提取的那一行；整条测量对
// 已提交的制品起一个真实的 stdio 进程（一次性的空目录）。
import { deepEqual, equal, match, ok, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { runToolingCli } from "../../../tooling/cli.js";
import {
  connectReportingPreloadFailure,
  measureStorageCalls,
  preloadFailureLine,
  STORAGE_COUNTER_DUMP_VARIABLE,
  summarizeStorageCounters,
  writeStorageCounterPreload,
} from "../../../tooling/metrics/storage-metrics.js";
import { loadSensitive } from "../../support/load-sensitive.js";
import { disposableRoot as sharedDisposableRoot } from "../../support/temp-root.js";

const CANDIDATE = path.join(process.cwd(), "plugins", "codex-wakeflow");

function disposableRoot(t: TestContext): string {
  return sharedDisposableRoot(t, "wakeflow-storage-metrics-");
}

// 子进程先转储一次清掉加载自身模块的调用，再做一组已知的调用并转储第二次；十秒没转储完就以 3 退出。
const COUNTED_CHILD = `
import { open, opendir } from "node:fs/promises";
import path from "node:path";
const directory = process.argv[2];
const timer = setTimeout(() => process.exit(3), 10_000);
const dump = () => {
  const dumped = new Promise((resolve) => process.once("SIGUSR2", resolve));
  process.kill(process.pid, "SIGUSR2");
  return dumped;
};
await dump();
const file = await open(path.join(directory, "probe"), "w", 0o600);
await file.write("probe\\n");
await file.sync();
await file.close();
const parent = await open(directory, "r");
await parent.sync();
await parent.close();
const listed = await opendir(directory);
while ((await listed.read()) !== null);
await listed.close();
for await (const _entry of await opendir(directory));
await dump();
clearTimeout(timer);
`;

function runUnderPreload(
  root: string,
  imports: readonly string[],
  data: string,
): ReturnType<typeof spawnSync> {
  const child = path.join(root, "child.mjs");
  writeFileSync(child, COUNTED_CHILD, { mode: 0o600 });
  const dumps = path.join(root, "dumps");
  mkdirSync(dumps, { recursive: true });
  return spawnSync(
    process.execPath,
    [...imports.flatMap((file) => ["--import", file]), child, data],
    {
      env: { PATH: process.env.PATH ?? "", [STORAGE_COUNTER_DUMP_VARIABLE]: dumps },
      encoding: "utf8",
      timeout: 30_000,
    },
  );
}

test("计数脚本在真实子进程里给出确切的次数：两个文件句柄各同步、关闭一次，逐项读到底是项数加一，for await 遍历记一次 entries 加一次迭代器自己的 close", (t) => {
  if (loadSensitive(t, "real child process under the counting preload")) return;
  const root = disposableRoot(t);
  const data = path.join(root, "data");
  mkdirSync(data);
  for (const name of ["a", "b", "c"]) writeFileSync(path.join(data, name), "x\n");
  const run = runUnderPreload(root, [writeStorageCounterPreload(root)], data);
  equal(run.status, 0, String(run.stderr));
  const dumped: unknown = JSON.parse(readFileSync(path.join(root, "dumps", "dump-2.json"), "utf8"));
  ok(dumped !== null && typeof dumped === "object");
  const counters = dumped as Readonly<Record<string, { n: number }>>;
  deepEqual(Object.fromEntries(Object.entries(counters).map(([key, value]) => [key, value.n])), {
    open: 2,
    "handle.write": 1,
    "handle.sync": 2,
    "handle.close": 2,
    opendir: 2,
    "dir.read": 5,
    // 一次是显式的 listed.close()；另一次是 for await 遍历结束时迭代器经包住的 close 关闭目录。
    "dir.close": 2,
    "dir.entries": 1,
  });
  const summary = summarizeStorageCounters(counters);
  equal(summary.fileSystemCalls, 17);
  equal(summary.opens, 2);
  equal(summary.writes, 1);
  equal(summary.syncs, 2);
  equal(summary.directoryReads, 2);
  equal(summary.directoryEntryReads, 6);
});

test("计数脚本列出的方法有一个不存在时进程起不来，并说出是哪一个；工具从 stderr 里取出的那一行没有路径", (t) => {
  if (loadSensitive(t, "real child process under the counting preload")) return;
  const root = disposableRoot(t);
  const remover = path.join(root, "remove-symlink.mjs");
  writeFileSync(remover, 'import fs from "node:fs";\ndelete fs.promises.symlink;\n', {
    mode: 0o600,
  });
  const run = runUnderPreload(root, [remover, writeStorageCounterPreload(root)], root);
  equal(run.status === 0, false);
  // Node 打印的源码行也含这段文字，但只有 `Error: ` 开头的那一行被取出。
  const line = preloadFailureLine(String(run.stderr));
  equal(line, "Storage metrics preload: symlink is not a function.");
  equal(preloadFailureLine("Error: something else\n"), undefined);
});

test("连不上被量的服务时，预加载脚本的报错行进了错误、原错误留作 cause；没有那一行就原样抛出", async () => {
  const closed = new Error("Connection closed");
  const stderr = [
    "file:///private/tmp/scratch/counter.mjs:12",
    "    throw new Error(`Storage metrics preload: ${name} is not a function.`);",
    "Error: Storage metrics preload: symlink is not a function.",
    "    at file:///private/tmp/scratch/counter.mjs:12:11",
    "",
  ].join("\n");
  const failing = () => Promise.reject(closed);
  await rejects(
    connectReportingPreloadFailure(failing, () => stderr),
    (error: unknown) => {
      ok(error instanceof Error);
      equal(
        error.message,
        "The measured server did not start: Storage metrics preload: symlink is not a function.",
      );
      equal(error.cause, closed);
      return true;
    },
  );
  // 别的原因起不来：stderr 里没有那一行，原错误原样抛出。
  await rejects(
    connectReportingPreloadFailure(failing, () => "Error: something else\n"),
    (error: unknown) => error === closed,
  );
  // 连上了就什么都不做，也不去读 stderr。
  await connectReportingPreloadFailure(
    () => Promise.resolve(),
    () => {
      throw new Error("stderr must not be read after a successful connect");
    },
  );
});

test("计数按用途归类：逐段核对路径的调用、落盘同步、读写与改动目录项各算各的；不认识的名字只进总数", () => {
  const summary = summarizeStorageCounters({
    lstat: { n: 40, ms: 4 },
    realpath: { n: 30, ms: 6 },
    open: { n: 3, ms: 1 },
    "handle.stat": { n: 9, ms: 1 },
    "handle.read": { n: 4, ms: 1 },
    "handle.write": { n: 2, ms: 1 },
    "handle.sync": { n: 5, ms: 12.4 },
    fsyncSync: { n: 1, ms: 2.2 },
    readdir: { n: 2, ms: 1 },
    "dir.read": { n: 6, ms: 1 },
    "dir.close": { n: 2, ms: 0 },
    link: { n: 1, ms: 0.5 },
    rename: { n: 1, ms: 0.5 },
    unlink: { n: 2, ms: 1 },
    somethingNew: { n: 7, ms: 1 },
    malformed: "not a counter",
  });
  deepEqual(summary, {
    fileSystemCalls: 115,
    pathChecks: 70,
    opens: 3,
    reads: 4,
    writes: 2,
    directoryReads: 2,
    directoryEntryReads: 6,
    syncs: 6,
    syncMs: 15,
    renames: 1,
    links: 1,
    unlinks: 2,
    fileSystemMs: 34,
  });
  deepEqual(summarizeStorageCounters({}).fileSystemCalls, 0);
});

test("对一份制品起新进程量一次工具调用：每次调用一行计数，工具被拒也照样有数；结果里没有路径；越界的输入被拒", {
  timeout: 90_000,
}, async (t) => {
  if (loadSensitive(t, "real MCP server process with a counting preload")) return;
  const root = disposableRoot(t);
  // 一个空目录不是 Wakeflow 工作区：status 被公开错误拒绝，但服务进程为了判断这一点已经读过文件系统。
  const measured = await measureStorageCalls({
    candidate: CANDIDATE,
    workspace: root,
    tool: "wakeflow_status",
    arguments: {},
    repeat: 2,
  });
  equal(measured.kind, "WakeflowStorageMetrics");
  equal(measured.candidate.hostId, "codex");
  match(measured.candidate.manifestDigest, /^sha256:[0-9a-f]{64}$/u);
  equal(measured.calls.length, 2);
  for (const call of measured.calls) {
    equal(call.tool, "wakeflow_status");
    equal(call.toolStatus, "failed");
    ok(call.fileSystemCalls > 0, "the refused call still touched the file system");
    ok(call.pathChecks > 0);
    // 同步确实会被数到由上面的子进程用例钉住，所以这里的 0 不是计数失效。
    equal(call.syncs, 0, "a read-only call never syncs");
    ok(call.wallMs >= 0);
  }
  equal(JSON.stringify(measured).includes(root), false, "the result must not carry a path");

  const viaCli = (await runToolingCli(
    ["metrics", "storage", "--candidate", CANDIDATE, "--root", root],
    process.cwd(),
  )) as typeof measured;
  equal(viaCli.calls.length, 1);
  equal(viaCli.calls[0]?.tool, "wakeflow_status");

  const request = { candidate: CANDIDATE, workspace: root, tool: "wakeflow_status", arguments: {} };
  await rejects(measureStorageCalls({ ...request, repeat: 0 }), /Repeat must be/u);
  await rejects(measureStorageCalls({ ...request, repeat: 21 }), /Repeat must be/u);
  await rejects(
    measureStorageCalls({ ...request, tool: "rm_rf", repeat: 1 }),
    /wakeflow_\* public tool/u,
  );
  await rejects(
    measureStorageCalls({ ...request, candidate: path.join(root, "missing"), repeat: 1 }),
    /real directory/u,
  );
});
