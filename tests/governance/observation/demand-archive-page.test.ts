import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";

import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import {
  DEMAND_ARCHIVE_PAGE_COMPACT_LIMITS,
  type DemandArchivePageFacts,
  type DemandArchivePageTarget,
  demandArchivePageLine,
  demandArchivePageMarker,
  demandArchiveResultAccountsOf,
  renderDemandArchivePage,
} from "../../../src/governance/observation/demand-archive-page.js";
import { parseTargetSessionPromptObservation } from "../../../src/governance/result/target-session-prompts.js";
import {
  type LedgerHistoryEntry,
  renderLedgerHistoryIndex,
} from "../../../src/governance/observation/ledger-reading-pages.js";

/**
 * 0 级（纯函数）：已归档 Demand 的人读页面与历史索引的渲染（open-items I22，1.4 第 3 段）。
 * 页面有四样固定内容——要求了什么、改了什么、验证了什么、还剩什么——加度量；来自 Agent 的文字开不出
 * 标签、注释、链接、标题或表格列；记录版本 1 的报告明说"未记录"；读不出评审历史的归档照样出一页；
 * 历史索引新的在前，页面不是当前渲染的那一行不给链接。真实归档上的读写在能力级的 reading-pages 测试里。
 */

const DEMAND_ID = "demand_11111111-1111-4111-8111-111111111111";
const OTHER_DEMAND_ID = "demand_22222222-2222-4222-8222-222222222222";
const REQUIREMENT_ID = "requirement_33333333-3333-4333-8333-333333333333";
const MANIFEST_DIGEST = computeCanonicalJsonSha256Digest({ seed: "manifest" });

function target(overrides: Partial<DemandArchivePageTarget> = {}): DemandArchivePageTarget {
  return {
    targetTaskId: "target-task_44444444-4444-4444-8444-444444444444",
    workType: "implementation",
    phase: "accepted",
    accepted: true,
    objective: "Add the sample endpoint.",
    repositoryId: "repository_55555555-5555-4555-8555-555555555555",
    anchors: [
      {
        anchorId: "ac-1",
        claim: "The endpoint answers 200.",
        result: { status: "passed", observed: "curl returned 200." },
      },
      {
        anchorId: "ac-2",
        claim: "The unit test passes.",
        result: { status: "not-run", observed: "No runner in this checkout." },
      },
    ],
    report: {
      outcome: "completed",
      summary: "Added the route and its test.",
      branch: "wakeflow/sample",
      commits: ["1111111111111111111111111111111111111111"],
      risks: ["The route has no rate limit."],
      outsideInstructions: [
        { source: "user", summary: "Also rename the file.", handling: "declined" },
      ],
      test: null,
    },
    decisions: [
      {
        decision: "rework",
        decidedAt: "2026-11-17T00:07:00.000Z",
        rationale: "The test was missing.",
        checks: [{ method: "Read the diff", outcome: "failed", observation: "No test file." }],
        blockingReasons: ["missing test"],
        residualRisks: [],
      },
      {
        decision: "accept",
        decidedAt: "2026-11-17T00:12:40.000Z",
        rationale: "Re-ran the test; it passes.",
        checks: [{ method: "npm test", outcome: "passed", observation: "1 passed." }],
        blockingReasons: [],
        residualRisks: ["Rate limiting is still open."],
      },
    ],
    sessionPrompts: parseTargetSessionPromptObservation({
      status: "observed",
      reason: null,
      from: "2026-11-17T00:03:00.000Z",
      until: "2026-11-17T00:10:40.000Z",
      permitPrompts: 1,
      nudgePrompts: 1,
      outsidePrompts: 2,
      outsideAt: ["2026-11-17T00:05:00.000Z", "2026-11-17T00:06:30.000Z"],
    }),
    earlierResults: [],
    ...overrides,
  };
}

function facts(overrides: Partial<DemandArchivePageFacts> = {}): DemandArchivePageFacts {
  return {
    demandId: DEMAND_ID,
    revision: "0000000012",
    outcome: "completed",
    archivedAt: "2026-11-17T00:13:00.000Z",
    manifestDigest: MANIFEST_DIGEST,
    identity: {
      title: "Sample endpoint",
      goal: "Ship the sample endpoint end to end.",
      completionDefinition: "The route answers and its test passes.",
      demandType: "requirement",
      requirementId: REQUIREMENT_ID,
    },
    verify: { gateCount: 14, failedCount: 0 },
    evidenceCount: 2,
    targets: [target()],
    pending: [],
    measures: {
      eventCommits: 9,
      resultImports: 2,
      targets: 1,
      authoredBytes: { total: 900, taskPackages: 600, decisions: 300, perTarget: 900 },
      reviewSeconds: { values: [240, 120], median: 180 },
    },
    ...overrides,
  };
}

test("页面有四样固定内容加度量，按固定顺序；每一样说的是归档里有的东西", () => {
  const page = renderDemandArchivePage(facts(), "en");
  const order = [
    "# Demand: Sample endpoint",
    demandArchivePageMarker("en", MANIFEST_DIGEST),
    "## What was asked",
    "## What changed",
    "## What was verified",
    "## Instructions outside the task package",
    "## What remains",
    "## Measures",
  ].map((heading) => page.indexOf(heading));
  ok(
    order.every((position, index) => position !== -1 && position > (order[index - 1] ?? -1)),
    page,
  );
  // 头部：归档包才是记录；链到需求包与历史索引（相对路径，页面在 archives/<demandId>/ 下）。
  ok(page.includes("Generated from the sealed archive beside this page (`0000000012/`)."));
  ok(page.includes(`- Demand: \`${DEMAND_ID}\` (requirement)`));
  ok(page.includes("- Outcome: completed · archived 2026-11-17T00:13:00.000Z"));
  ok(page.includes(`[\`${REQUIREMENT_ID}\`](../../requirements/${REQUIREMENT_ID}/)`));
  ok(page.includes("[Demand history](../../history.md)"));
  // 要求了什么：目标、完成定义、每个目标的任务与锚点主张。
  ok(page.includes("Ship the sample endpoint end to end."));
  ok(page.includes("**Done when:** The route answers and its test passes."));
  ok(page.includes("- `ac-1` The endpoint answers 200."));
  // 改了什么：分支、最后一次提交、目标自己的摘要。
  ok(
    page.includes(
      "- **Target 1** · accepted · completed · branch `wakeflow/sample` · commit `1111111111111111111111111111111111111111`",
    ),
  );
  ok(page.includes("  Added the route and its test."));
  // 验证了什么：目标逐条的结论、Controller 的每一次决定与它的检查、证据数与归档时的校验。
  ok(page.includes("| `ac-2` | The unit test passes. | not-run | No runner in this checkout. |"));
  ok(page.includes("1. **rework** · 2026-11-17T00:07:00.000Z — The test was missing."));
  ok(page.includes("   - check (failed): Read the diff → No test file."));
  ok(page.includes("2. **accept** · 2026-11-17T00:12:40.000Z — Re-ran the test; it passes."));
  ok(page.includes("- Managed evidence records: 2"));
  ok(page.includes("- Verification when archived: 14 gates, 0 failed"));
  // 还剩什么：最后一次决定的剩余风险、目标报告的风险、任务包之外的指示、记录下来的分支。
  ok(page.includes("- Target 1: Residual risk — Rate limiting is still open."));
  ok(page.includes("- Target 1: Risk the target reported — The route has no rate limit."));
  // 任务包之外的指示单独一栏（ADR-0030 决定 7）：目标的申报与 Wakeflow 自己的观察并排，各自标明出处。
  ok(
    page.includes(
      "## Instructions outside the task package\n\n> Two accounts side by side: what each target declared it was told to do outside its task package, and what Wakeflow itself counted in the target's session. Neither replaces the other.\n\n- Target 1: declared by the target (user, declined) — Also rename the file.\n- Target 1: observed by Wakeflow between landing and result import: 2 prompts from outside the delivery, 1 carrying a Wakeflow permit, 1 matching a continue phrase the Controller pushed (at 2026-11-17T00:05:00.000Z, 2026-11-17T00:06:30.000Z)\n",
    ),
    page,
  );
  ok(page.includes("Branch `wakeflow/sample` was recorded by the accepted result"));
  // 度量：留下记录的步数不是调用数，页面自己说明。
  ok(page.includes("Recorded steps: 9 event commits, 2 of them result imports by target windows."));
  ok(page.includes("this is not the number of tool calls"));
  ok(page.includes("900 bytes over 1 target, 900 per target."));
  ok(page.includes("median 180 s (240, 120)."));
  ok(page.endsWith("\n") && !page.endsWith("\n\n"));
});

test("中文工作区的页面用中文的四个段名与说明，标记带语言；同一份事实两种语言的标记不同", () => {
  const page = renderDemandArchivePage(facts(), "zh-Hans");
  for (const heading of [
    "## 要求了什么",
    "## 改了什么",
    "## 验证了什么",
    "## 任务包之外的指示",
    "## 还剩什么",
    "## 度量",
  ]) {
    ok(page.includes(heading), heading);
  }
  ok(page.includes("本页由旁边封存的归档包（`0000000012/`）生成。"));
  ok(page.includes("留下记录的步数：9 次事件提交，其中 2 次是目标窗口导入结果。"));
  ok(page.includes(demandArchivePageMarker("zh-Hans", MANIFEST_DIGEST)));
  equal(page.includes(demandArchivePageMarker("en", MANIFEST_DIGEST)), false);
});

test("记录版本 1 的报告没有逐条结论与任务包之外的指示：页面明说未记录，不当作没有", () => {
  const legacy = target({
    anchors: target().anchors.map((anchor) => ({ ...anchor, result: null })),
    report: { ...(target().report ?? fail()), outsideInstructions: null },
    // 1.4 之前的结果事件也没有 Wakeflow 的观察：页面不为它编一行。
    sessionPrompts: null,
  });
  const page = renderDemandArchivePage(facts({ targets: [legacy] }), "en");
  ok(page.includes("The target's result per anchor was not recorded (report record version 1)."));
  ok(page.includes("- Target 1: not recorded (report record version 1)"), page);
  equal(page.includes("observed by Wakeflow"), false);
  equal(page.includes("could not observe"), false);
  equal(page.includes("| Anchor | Claim |"), false);
});

function fail(): never {
  throw new Error("fixture target has no report");
}

test("没做完的归档：未被接受的目标、归档时没有结果的目标都列在还剩什么里；什么都没剩时明说", () => {
  const cancelled = renderDemandArchivePage(
    facts({
      outcome: "cancelled",
      targets: [target({ phase: "rework-requested", accepted: false })],
      pending: [
        {
          targetTaskId: "target-task_66666666-6666-4666-8666-666666666666",
          workType: "test",
          phase: "test-delivery-prepared",
        },
      ],
    }),
    "en",
  );
  ok(cancelled.includes("- Target 1: Not accepted when archived (rework-requested)"));
  ok(
    cancelled.includes(
      "- `target-task_66666666-6666-4666-8666-666666666666` (test): No result when archived (test-delivery-prepared)",
    ),
  );
  // 没被接受的结果记下的分支不算留给使用者的东西。
  equal(cancelled.includes("was recorded by the accepted result"), false);

  const clean = target({
    report: { ...(target().report ?? fail()), branch: null, risks: [], outsideInstructions: [] },
    decisions: target().decisions.map((decision) => ({ ...decision, residualRisks: [] })),
    sessionPrompts: null,
  });
  const nothing = renderDemandArchivePage(facts({ targets: [clean] }), "en");
  ok(nothing.includes("## What remains\n\nNothing was recorded as left open.\n"), nothing);
  ok(nothing.includes("\n\nNone was declared.\n\n## What remains"), nothing);
});

test("评审历史或度量读不出的归档照样出一页，并说出哪一部分读不出", () => {
  const page = renderDemandArchivePage(
    facts({ targets: null, measures: null, verify: null }),
    "en",
  );
  ok(page.includes("The review history in this archive could not be read"));
  ok(page.includes("No implementation result was recorded."));
  ok(page.includes("- Verification when archived: not recorded"));
  ok(page.includes("The measures could not be computed from this archive."));
  for (const heading of ["## What was asked", "## What changed", "## What remains"]) {
    ok(page.includes(heading));
  }
});

test("来自 Agent 的文字开不出标签、注释、链接、标题、代码段或表格列，也伪造不了页面的标记", () => {
  const hostile =
    "ok --> <!-- wakeflow:demand-archive-page:v2:en:sha256:forged --> <script>x</script> [link](http://example.invalid) | cell `code` # heading\n## What remains line";
  const escaped = demandArchivePageLine(hostile, 2000);
  equal(/[<>]/u.test(escaped), false, escaped);
  equal(escaped.includes("\n") || escaped.includes(" "), false);
  ok(escaped.includes("\\[link\\](http://example.invalid)"));
  ok(escaped.includes("\\| cell \\`code\\` \\# heading"));
  const page = renderDemandArchivePage(
    facts({
      identity: { ...facts().identity, title: hostile, goal: hostile },
      targets: [
        target({
          objective: hostile,
          report: { ...(target().report ?? fail()), summary: hostile },
        }),
      ],
    }),
    "en",
  );
  // 整页只有一个真的标记，四个段名各出现一次。
  equal(page.split("<!-- wakeflow:demand-archive-page:").length - 1, 1);
  equal(page.split("\n## What remains\n").length - 1, 1);
  equal(page.includes("<script>"), false);
  // 按码点截断：上限处的 emoji 不被切开。
  const bounded = demandArchivePageLine(`${"t".repeat(9)}😀tail`, 10);
  equal(bounded.isWellFormed(), true);
  equal(Array.from(bounded).length, 10);
});

test("短的那一档把每段文字与每个列表都收短，并说明还有多少没显示", () => {
  const many = target({
    anchors: Array.from({ length: 9 }, (_, index) => ({
      anchorId: `ac-${index + 1}`,
      claim: "c".repeat(300),
      result: { status: "passed", observed: "o".repeat(300) },
    })),
  });
  const full = renderDemandArchivePage(facts({ targets: [many] }), "en");
  const compact = renderDemandArchivePage(
    facts({ targets: [many] }),
    "en",
    DEMAND_ARCHIVE_PAGE_COMPACT_LIMITS,
  );
  ok(compact.length < full.length / 2);
  ok(compact.includes("- … 3 more not shown"), compact);
  ok(compact.includes("## What remains"));
});

test("历史索引：每个归档过的 Demand 一行、新的在前；页面不是当前渲染的不给链接；没有归档时明说", () => {
  const entries: LedgerHistoryEntry[] = [
    {
      demandId: DEMAND_ID,
      revision: "0000000012",
      title: "Older | one",
      demandType: "requirement",
      outcome: "completed",
      archivedAt: "2026-11-16T00:00:00.000Z",
      pageCurrent: true,
    },
    {
      demandId: OTHER_DEMAND_ID,
      revision: "0000000007",
      title: "",
      demandType: null,
      outcome: "cancelled",
      archivedAt: "2026-11-17T00:00:00.000Z",
      pageCurrent: false,
    },
  ];
  const index = renderLedgerHistoryIndex(entries, "en");
  equal(
    index,
    renderLedgerHistoryIndex([...entries].reverse(), "en"),
    "order of input is irrelevant",
  );
  const rows = index.split("\n").filter((line) => line.startsWith("| 2026-"));
  equal(rows.length, 2);
  equal(
    rows[0],
    `| 2026-11-17T00:00:00.000Z | (no title recorded) | — | cancelled | \`${OTHER_DEMAND_ID}\` |`,
  );
  equal(
    rows[1],
    `| 2026-11-16T00:00:00.000Z | Older \\| one | requirement | completed | [\`${DEMAND_ID}\`](archives/${DEMAND_ID}/0000000012.md) |`,
  );
  ok(index.includes("<!-- wakeflow:ledger-history:v1:en -->"));
  const zh = renderLedgerHistoryIndex(entries, "zh-Hans");
  ok(zh.startsWith("# Wakeflow Demand 历史\n\n<!-- wakeflow:ledger-history:v1:zh-Hans -->\n"));
  ok(zh.includes("| 归档时间 | Demand | 类型 | 结局 | 页面 |"));
  ok(renderLedgerHistoryIndex([], "en").includes("No Demand has been archived yet."));
});

test("返工之前那几份结果的申报与观察也在页面上：每份结果各列一次并标明第几份；只有一份结果的目标照旧（1.4 第 6 段桌面现场）", () => {
  const observed = (outsidePrompts: number, outsideAt: readonly string[]) =>
    parseTargetSessionPromptObservation({
      status: "observed",
      reason: null,
      from: "2026-11-17T00:03:00.000Z",
      until: "2026-11-17T00:10:40.000Z",
      permitPrompts: 0,
      nudgePrompts: 0,
      outsidePrompts,
      outsideAt: [...outsideAt],
    });
  const page = renderDemandArchivePage(
    facts({
      targets: [
        target({
          // 第一次尝试途中使用者直接对目标说了一句话，目标没有照做；那一次被判返工。
          earlierResults: [
            {
              outsideInstructions: [
                { source: "user", summary: "Uppercase the title too.", handling: "declined" },
              ],
              sessionPrompts: observed(1, ["2026-11-17T00:05:00.000Z"]),
            },
          ],
          report: { ...(target().report ?? fail()), outsideInstructions: [] },
          sessionPrompts: observed(0, []),
        }),
      ],
    }),
    "en",
  );
  ok(
    page.includes(
      "- Target 1 · result 1: declared by the target (user, declined) — Uppercase the title too.\n- Target 1 · result 1: observed by Wakeflow between landing and result import: 1 prompt from outside the delivery, 0 carrying a Wakeflow permit, 0 matching a continue phrase the Controller pushed (at 2026-11-17T00:05:00.000Z)\n- Target 1 · result 2: observed by Wakeflow between landing and result import: 0 prompts from outside the delivery",
    ),
    page,
  );
  // 记录版本 1 的较早结果没有申报这一项：明说未记录。
  const versionOne = renderDemandArchivePage(
    facts({
      targets: [target({ earlierResults: [{ outsideInstructions: null, sessionPrompts: null }] })],
    }),
    "zh-Hans",
  );
  ok(versionOne.includes("- 目标 1 · 第 1 份结果: 未记录（报告的记录版本为 1）\n"), versionOne);
  ok(versionOne.includes("- 目标 1 · 第 2 份结果: 目标申报 (user, declined)"), versionOne);
  // 只有一份结果：不带"第几份"。
  ok(renderDemandArchivePage(facts(), "en").includes("- Target 1: declared by the target"));

  // 归档事件原文里每份结果的申报按先后取出；认不出的条目跳过，申报形状不对的当作未记录。
  const accounts = demandArchiveResultAccountsOf([
    { eventType: "tasking.target-task-planned", data: {} },
    {
      eventType: "result.target-result-recorded",
      data: {
        result: {
          targetTaskId: "target-task_a",
          targetResultId: "target-result_1",
          report: {
            outsideInstructions: [{ source: "user", summary: "First.", handling: "declined" }],
          },
        },
      },
    },
    { eventType: "result.target-result-recorded", data: { result: { targetTaskId: 7 } } },
    {
      eventType: "result.target-result-recorded",
      data: {
        result: { targetTaskId: "target-task_a", targetResultId: "target-result_2", report: {} },
      },
    },
    {
      eventType: "result.target-result-recorded",
      data: {
        result: {
          targetTaskId: "target-task_a",
          targetResultId: "target-result_3",
          report: { outsideInstructions: [{ source: "someone", summary: 1 }] },
        },
      },
    },
  ]);
  deepEqual(
    accounts.map((entry) => [entry.targetResultId, entry.outsideInstructions]),
    [
      ["target-result_1", [{ source: "user", summary: "First.", handling: "declined" }]],
      ["target-result_2", null],
      ["target-result_3", null],
    ],
  );
});

test("越级观察（H13）：没有落地记录可当起点时页面说没能观察、不是零条；观察到零条时照实写零", () => {
  const unobserved = renderDemandArchivePage(
    facts({
      targets: [
        target({
          sessionPrompts: parseTargetSessionPromptObservation({
            status: "unobserved",
            reason: "landing-record-absent",
            from: null,
            until: "2026-11-17T00:10:40.000Z",
            permitPrompts: 0,
            nudgePrompts: 0,
            outsidePrompts: 0,
            outsideAt: [],
          }),
        }),
      ],
    }),
    "en",
  );
  ok(
    unobserved.includes(
      "- Target 1: Wakeflow could not observe the target session (landing-record-absent); this is not a count of zero",
    ),
    unobserved,
  );
  const quiet = renderDemandArchivePage(
    facts({
      targets: [
        target({
          sessionPrompts: parseTargetSessionPromptObservation({
            status: "observed",
            reason: null,
            from: "2026-11-17T00:03:00.000Z",
            until: "2026-11-17T00:10:40.000Z",
            permitPrompts: 0,
            nudgePrompts: 0,
            outsidePrompts: 0,
            outsideAt: [],
          }),
        }),
      ],
    }),
    "zh-Hans",
  );
  ok(
    quiet.includes(
      "Wakeflow 在落地到结果导入之间观察到：0 条投递之外的 prompt，0 条带 Wakeflow 的许可，0 条与 Controller 推过的续跑短句相符\n",
    ),
    quiet,
  );
});
