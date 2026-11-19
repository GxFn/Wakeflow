// 级别 4（维护者工具）：计数的归类是纯函数；整条测量对已提交的制品起一个真实的 stdio 进程（一次性的空目录）。
import { deepEqual, equal, match, ok, rejects } from "node:assert/strict";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { runToolingCli } from "../../../tooling/cli.js";
import {
  measureStorageCalls,
  summarizeStorageCounters,
} from "../../../tooling/metrics/storage-metrics.js";
import { loadSensitive } from "../../support/load-sensitive.js";
import { disposableRoot as sharedDisposableRoot } from "../../support/temp-root.js";

const CANDIDATE = path.join(process.cwd(), "plugins", "codex-wakeflow");

function disposableRoot(t: TestContext): string {
  return sharedDisposableRoot(t, "wakeflow-storage-metrics-");
}

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
    link: { n: 1, ms: 0.5 },
    rename: { n: 1, ms: 0.5 },
    unlink: { n: 2, ms: 1 },
    somethingNew: { n: 7, ms: 1 },
    malformed: "not a counter",
  });
  deepEqual(summary, {
    fileSystemCalls: 107,
    pathChecks: 70,
    opens: 3,
    reads: 4,
    writes: 2,
    directoryReads: 2,
    syncs: 6,
    syncMs: 15,
    renames: 1,
    links: 1,
    unlinks: 2,
    fileSystemMs: 33,
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
