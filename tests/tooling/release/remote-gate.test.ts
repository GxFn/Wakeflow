import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  judgeRemoteGate,
  parseRemoteGateRuns,
  readRemoteGateRuns,
} from "../../../tooling/release/remote-gate.js";
import { runGit } from "../../support/git-fixture.js";
import { disposableRoot } from "../../support/temp-root.js";

/**
 * 级别 4（维护者工具）：远端门状态的读取端（open-items C12）。真实的 `gh` 调用不在门里跑——这里钉的是
 * 输出怎么读、最近一次怎么判，以及没有 GitHub 远端的检出根本不去起 `gh`。
 */

const SHA = "c".repeat(40);

test("gh 的输出：形状对的条目留下，缺字段或提交不是 40 位十六进制的丢掉，读不懂的整体是 null", () => {
  deepEqual(
    parseRemoteGateRuns(
      JSON.stringify([
        {
          headSha: SHA,
          headBranch: "main",
          event: "push",
          status: "completed",
          conclusion: "success",
          createdAt: "2026-11-14T02:00:00Z",
        },
        { headSha: SHA, status: "in_progress", conclusion: "", createdAt: "2026-11-14T03:00:00Z" },
        { headSha: "short", status: "completed", createdAt: "2026-11-14T04:00:00Z" },
        { headSha: SHA, createdAt: "2026-11-14T05:00:00Z" },
        "not an object",
      ]),
    ),
    [
      {
        headSha: SHA,
        headBranch: "main",
        event: "push",
        status: "completed",
        conclusion: "success",
        createdAt: "2026-11-14T02:00:00Z",
      },
      {
        headSha: SHA,
        headBranch: null,
        event: null,
        status: "in_progress",
        conclusion: null,
        createdAt: "2026-11-14T03:00:00Z",
      },
    ],
  );
  equal(parseRemoteGateRuns("{}"), null);
  equal(parseRemoteGateRuns("gh: not logged in"), null);
});

test("判定：最近的一次说了算；没读到是 unchecked，读到了但没有算数的运行是 none", () => {
  const run = (conclusion: string | null, createdAt: string, status = "completed") => ({
    headSha: SHA,
    headBranch: "main",
    event: "push",
    status,
    conclusion,
    createdAt,
  });
  deepEqual(judgeRemoteGate(null), { state: "unchecked", headSha: null, conclusion: null });
  deepEqual(judgeRemoteGate([]), { state: "none", headSha: null, conclusion: null });
  equal(
    judgeRemoteGate([
      run("success", "2026-11-13T00:00:00Z"),
      run("failure", "2026-11-14T00:00:00Z"),
    ]).state,
    "red",
  );
  equal(
    judgeRemoteGate([
      run("cancelled", "2026-11-13T00:00:00Z"),
      run("success", "2026-11-14T00:00:00Z"),
    ]).state,
    "green",
  );
  equal(judgeRemoteGate([run(null, "2026-11-14T00:00:00Z", "queued")]).state, "pending");
  equal(
    judgeRemoteGate([run("success", "2026-11-14T00:00:00Z")], (entry) => entry.event === "schedule")
      .state,
    "none",
  );
});

test("没有 GitHub 远端的检出、形状不对的分支名与提交：缺省读取不起 gh，直接是未核对", (t) => {
  const root = disposableRoot(t, "wakeflow-remote-gate-");
  runGit(root, "init", "--quiet");
  equal(readRemoteGateRuns(root, { branch: "main" }), null);
  runGit(root, "remote", "add", "origin", "https://example.invalid/owner/repo.git");
  equal(readRemoteGateRuns(root, { branch: "main" }), null);
  equal(readRemoteGateRuns(root, { branch: "--upload-pack=x" }), null);
  equal(readRemoteGateRuns(root, { commit: "HEAD" }), null);
});
