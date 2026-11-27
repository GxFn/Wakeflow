// 级别 4（维护者工具）：纯文件读取，临时目录里的合成归档与合成会话记录，不起子进程。
import { deepEqual, equal } from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import {
  type DemandArchiveEvent,
  measureDemandArchiveEvents,
} from "../../../src/governance/demand/demand-archive-measures.js";
import { runToolingCli } from "../../../tooling/cli.js";
import {
  measureArchivedDemand,
  measureSessionTranscript,
} from "../../../tooling/metrics/demand-metrics.js";

function temporaryRoot(t: TestContext): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-metrics-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function event(eventType: string, recordedAt: string, data: unknown): unknown {
  return { eventType, recordedAt, data };
}

/** 一个目标、一次返工的 Demand：规划、两次投递与结果、两次决定、两条证据、完成。 */
function writeArchive(root: string): string {
  const revision = path.join(root, "archives", "demand_x", "0000000010");
  const commits = path.join(revision, "payload", "event-sourcing", "commits");
  mkdirSync(commits, { recursive: true });
  const events = [
    event("publication.demand-published", "2026-11-17T00:00:00.000Z", {}),
    event("tasking.target-task-planned", "2026-11-17T00:01:00.000Z", {
      taskPackage: {
        objective: "abcd",
        confirmedContext: ["ab", "é"],
        boundaries: { inScope: ["a"], outOfScope: ["b"], forbidden: ["c"] },
        completionExpectations: ["de"],
        acceptanceAnchors: [{ anchorId: "ignored", claim: "f", probe: "g", expected: "h" }],
        taskPackageId: "ignored-because-wakeflow-derives-it",
      },
    }),
    event("delivery.delivery-prepared", "2026-11-17T00:02:00.000Z", {}),
    event("delivery.delivery-outcome-recorded", "2026-11-17T00:03:00.000Z", {
      outcome: { deliveryId: "d1" },
    }),
    event("result.target-result-recorded", "2026-11-17T00:04:30.000Z", {
      result: { deliveryId: "d1", targetResultId: "r1" },
    }),
    event("evidence.managed-evidence-recorded", "2026-11-17T00:05:00.000Z", {}),
    event("review.target-result-decided", "2026-11-17T00:08:30.000Z", {
      decision: {
        decision: "rework",
        reviewed: { targetResultId: "r1" },
        rationale: "12345",
        independentChecks: [
          { checkId: "ignored", method: "12", outcome: "failed", observation: "3" },
        ],
        blockingReasons: [],
        residualRisks: ["45"],
      },
    }),
    event("delivery.delivery-prepared", "2026-11-17T00:09:00.000Z", {}),
    event("delivery.delivery-outcome-recorded", "2026-11-17T00:10:00.000Z", {
      outcome: { deliveryId: "d2" },
    }),
    event("result.target-result-recorded", "2026-11-17T00:10:40.000Z", {
      result: { deliveryId: "d2", targetResultId: "r2" },
    }),
    event("evidence.managed-evidence-recorded", "2026-11-17T00:11:00.000Z", {}),
    event("review.target-result-decided", "2026-11-17T00:12:40.000Z", {
      decision: {
        decision: "accept",
        reviewed: { targetResultId: "r2" },
        rationale: "1",
        independentChecks: [],
        blockingReasons: [],
        residualRisks: [],
      },
    }),
    event("lifecycle.demand-completed", "2026-11-17T00:13:00.000Z", {}),
  ];
  events.forEach((item, index) => {
    const name = `${String(index + 1).padStart(16, "0")}.json`;
    writeFileSync(path.join(commits, name), JSON.stringify({ events: [item] }));
  });
  writeFileSync(path.join(commits, "not-a-commit.txt"), "ignored");
  return revision;
}

test("归档的度量：手写字节数只数 Controller 写的文字，两段时长按投递与结果的标识配对", (t) => {
  const metrics = measureArchivedDemand(writeArchive(temporaryRoot(t)));
  equal(metrics.events.total, 13);
  equal(metrics.events.byType["delivery.delivery-prepared"], 2);
  equal(metrics.targets, 1);
  equal(metrics.deliveries, 2);
  equal(metrics.evidenceRecords, 2);
  deepEqual(metrics.decisions, { rework: 1, accept: 1 });
  // 任务包：abcd(4) + ab(2) + é(2 字节) + a + b + c(3) + de(2) + f + g + h(3) = 16；标识不计。
  // 决定：12345(5) + 12(2) + 3(1) + 45(2) = 10，加第二次的 1 = 11；outcome 与 checkId 不计。
  deepEqual(metrics.authoredBytes, { total: 27, taskPackages: 16, decisions: 11, perTarget: 27 });
  deepEqual(metrics.targetWorkSeconds, { values: [90, 40], median: 65 });
  deepEqual(metrics.reviewSeconds, { values: [240, 120], median: 180 });
});

test("归档的度量：每个 Demand 页面上的数（运行时自己算的）与这条命令量出来的是同一个口径", (t) => {
  // 1.4 第 3 段：归档后的页面带着同样的度量。两边各有一份实现（工具不依赖运行时），用同一份归档对一遍。
  const revision = writeArchive(temporaryRoot(t));
  const commits = path.join(revision, "payload", "event-sourcing", "commits");
  const names = readdirSync(commits)
    .filter((name) => name.endsWith(".json"))
    .sort();
  const events = names.flatMap(
    (name) =>
      (
        JSON.parse(readFileSync(path.join(commits, name), "utf8")) as {
          events: DemandArchiveEvent[];
        }
      ).events,
  );
  const page = measureDemandArchiveEvents(events, names.length);
  const tool = measureArchivedDemand(revision);
  deepEqual(page.authoredBytes, tool.authoredBytes);
  deepEqual(page.reviewSeconds, tool.reviewSeconds);
  equal(page.targets, tool.targets);
  equal(page.eventCommits, 13);
  equal(page.resultImports, tool.events.byType["result.target-result-recorded"]);
});

test("归档的度量：没有目标、没有决定时字节与中位数都有定义", (t) => {
  const root = temporaryRoot(t);
  const commits = path.join(root, "payload", "event-sourcing", "commits");
  mkdirSync(commits, { recursive: true });
  writeFileSync(
    path.join(commits, "0000000000000001.json"),
    JSON.stringify({
      events: [event("publication.demand-published", "2026-11-17T00:00:00.000Z", {})],
    }),
  );
  const metrics = measureArchivedDemand(root);
  equal(metrics.targets, 0);
  equal(metrics.authoredBytes.perTarget, 0);
  equal(metrics.reviewSeconds.median, null);
  equal(metrics.targetWorkSeconds.median, null);
});

function transcriptLine(timestamp: string, uses: readonly unknown[]): string {
  return JSON.stringify({ type: "assistant", timestamp, message: { content: uses } });
}

function use(id: string, name: string, command?: string): unknown {
  return { type: "tool_use", id, name, input: command === undefined ? {} : { command } };
}

test("会话记录的度量：Wakeflow 工具按名字计数，助手脚本单列，重复的调用标识只数一次，since 之前的不数", async (t) => {
  const root = temporaryRoot(t);
  const file = path.join(root, "session.jsonl");
  writeFileSync(
    file,
    [
      transcriptLine("2026-11-17T00:00:00.000Z", [
        use("a", "mcp__plugin_wakeflow_wakeflow__wakeflow_status"),
      ]),
      transcriptLine("2026-11-17T01:00:00.000Z", [
        use("b", "mcp__plugin_wakeflow_wakeflow__wakeflow_status"),
        use("c", "mcp__plugin_wakeflow_wakeflow__wakeflow_record_evidence"),
        use(
          "d",
          "Bash",
          "node .wakeflow-local/runtime/hosts/claude-code/operations/assets/tmux.mjs deliver",
        ),
        use("e", "Bash", "git status"),
        { type: "text", text: "not a tool call" },
      ]),
      // 同一条消息在记录里再出现一次：按调用标识去重。
      transcriptLine("2026-11-17T01:00:01.000Z", [
        use("c", "mcp__plugin_wakeflow_wakeflow__wakeflow_record_evidence"),
        use("f", "Read"),
      ]),
      JSON.stringify({ type: "user", timestamp: "2026-11-17T01:00:02.000Z", message: {} }),
      "not json",
      "",
    ].join("\n"),
  );
  const afterHalfPast = { since: "2026-11-17T00:30:00.000Z", until: null };
  deepEqual(measureSessionTranscript(file, afterHalfPast).toolCalls, {
    total: 5,
    wakeflow: { total: 2, byTool: { wakeflow_status: 1, wakeflow_record_evidence: 1 } },
    helper: 1,
    other: 2,
  });
  const everything = { since: null, until: null };
  equal(measureSessionTranscript(file, everything).toolCalls.wakeflow.byTool.wakeflow_status, 2);
  // until 含端点：只留第一条消息里的那一次调用。
  const firstMinute = { since: null, until: "2026-11-17T00:00:00.000Z" };
  equal(measureSessionTranscript(file, firstMinute).toolCalls.total, 1);

  // 命令行入口走同一条路。
  const viaCli = await runToolingCli(["metrics", "transcript", "--input", file], root);
  deepEqual(viaCli, measureSessionTranscript(file, everything));
  const boundedViaCli = await runToolingCli(
    ["metrics", "transcript", "--input", file, "--until", "2026-11-17T00:00:00.000Z"],
    root,
  );
  deepEqual(boundedViaCli, measureSessionTranscript(file, firstMinute));
  const archive = writeArchive(root);
  const archiveViaCli = await runToolingCli(["metrics", "archive", "--dir", archive], root);
  deepEqual(archiveViaCli, measureArchivedDemand(archive));
});
