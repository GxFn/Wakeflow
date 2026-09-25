import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  deriveAnchorReferenceBlockers,
  deriveImplementationBaselines,
  deriveLineageBlockers,
  deriveLineageExpectation,
  derivePlanReview,
  deriveSectionAnchorBlockers,
  deriveTestPlanningBlockers,
  deriveTestStepReferenceBlockers,
  deriveTopologyBlockers,
  parseAcceptanceCriteria,
} from "../../../src/capabilities/tasking/decide.js";
import { deriveImplementationPlanningBlockers } from "../../../src/capabilities/tasking/service.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import type { DemandAggregateState } from "../../../src/governance/demand/model/demand-aggregate-state.js";
import { FIXTURE_REQUIREMENT_MARKDOWN } from "../../governance/ledger/requirement-package.fixture.js";

/**
 * tasking 切片纯决定：验收标准条目切分、锚点引用、章节锚点、审阅门、仓库谱系、
 * 测试合同的步骤引用、规划准入与实现基线。
 */

const RECORD = parseSha256Digest(`sha256:${"1".repeat(64)}`);
const OTHER = parseSha256Digest(`sha256:${"2".repeat(64)}`);
const AT = parseUtcInstant("2026-09-09T10:00:00.000Z");

function anchor(
  anchorId: string,
  itemId: string,
  recordDigest = RECORD,
  sectionAnchor = "acceptance-criteria",
) {
  return {
    anchorId,
    claim: "c",
    probe: "p",
    expected: "e",
    requirementRef: { recordDigest, sectionAnchor, itemId },
  };
}

test("验收标准条目按顶层列表项切分，围栏与续行按规则处理", () => {
  const criteria = parseAcceptanceCriteria(FIXTURE_REQUIREMENT_MARKDOWN);
  deepEqual(
    criteria.map((item) => item.itemId),
    ["ac-1", "ac-2"],
  );
  equal(criteria[0]?.text.startsWith("AC-1"), true);
  const nested = parseAcceptanceCriteria(
    "## 验收标准\n\n- first\n  continued line\n- second\n\n```\n- not an item\n```\n\n## 其他\n\n- not here\n",
  );
  deepEqual(
    nested.map((item) => item.text),
    ["first continued line", "second"],
  );
  deepEqual(parseAcceptanceCriteria("## 目标\n\n- no criteria section\n"), []);
});

test("锚点引用：记录摘要、节锚点、条目三处各自报出阻塞", () => {
  const criteria = parseAcceptanceCriteria(FIXTURE_REQUIREMENT_MARKDOWN);
  deepEqual(
    deriveAnchorReferenceBlockers({
      anchors: [anchor("a", "ac-1"), anchor("b", "ac-9"), anchor("c", "ac-2", OTHER, "goal")],
      recordDigest: RECORD,
      criteria,
    }),
    ["anchor-item-unknown:b:ac-9", "anchor-record-drift:c", "anchor-section:c:goal"],
  );
  deepEqual(deriveSectionAnchorBlockers(["goal", "nope"], ["goal", "landing-plan"]), [
    "section-anchor-unknown:nope",
  ]);
});

test("审阅门：user 要求确认时间，controller 不接受多余的确认", () => {
  deepEqual(derivePlanReview({ taskPlanReview: "user", confirmedAt: null }), {
    planReview: null,
    blocker: "task-plan-review-required",
  });
  deepEqual(derivePlanReview({ taskPlanReview: "user", confirmedAt: AT }), {
    planReview: { reviewer: "user", confirmedAt: AT },
    blocker: null,
  });
  deepEqual(derivePlanReview({ taskPlanReview: "controller", confirmedAt: null }), {
    planReview: { reviewer: "controller" },
    blocker: null,
  });
  deepEqual(derivePlanReview({ taskPlanReview: "controller", confirmedAt: AT }), {
    planReview: null,
    blocker: "task-plan-review-not-requested",
  });
});

function stateWith(targets: readonly Record<string, unknown>[]): Readonly<DemandAggregateState> {
  return { targetTasks: targets } as unknown as Readonly<DemandAggregateState>;
}

const REPO = "repository_11111111-1111-4111-8111-111111111111";

test("仓库谱系：空仓库不得声明谱系，未接受目标必须替代且可替代，已接受目标必须续接", () => {
  deepEqual(deriveLineageExpectation(stateWith([]), REPO), { kind: "none" });
  deepEqual(deriveLineageBlockers(null, { kind: "none" }), []);
  deepEqual(
    deriveLineageBlockers(
      { kind: "continuation", continuesTargetTaskId: "target-task_x" as never },
      { kind: "none" },
    ),
    ["lineage-unexpected"],
  );
  const open = stateWith([
    {
      workType: "implementation",
      repositoryId: REPO,
      phase: "rework-requested",
      targetTaskId: "t-open",
    },
    { workType: "test", windowId: "w", phase: "planned", targetTaskId: "t-test" },
  ]);
  deepEqual(deriveLineageExpectation(open, REPO), {
    kind: "replacement",
    targetTaskId: "t-open",
    replaceable: true,
  });
  deepEqual(
    deriveLineageBlockers(null, { kind: "replacement", targetTaskId: "t-open", replaceable: true }),
    ["lineage-replacement-required:t-open"],
  );
  deepEqual(
    deriveLineageBlockers(
      { kind: "replacement", replacesTargetTaskId: "t-other" as never },
      { kind: "replacement", targetTaskId: "t-open", replaceable: true },
    ),
    ["lineage-replacement-target:t-open"],
  );
  deepEqual(
    deriveLineageBlockers(
      { kind: "replacement", replacesTargetTaskId: "t-open" as never },
      { kind: "replacement", targetTaskId: "t-open", replaceable: false },
    ),
    ["lineage-target-in-flight:t-open"],
  );
  const inFlight = stateWith([
    {
      workType: "implementation",
      repositoryId: REPO,
      phase: "host-effect-accepted",
      targetTaskId: "t-live",
    },
  ]);
  deepEqual(deriveLineageExpectation(inFlight, REPO), {
    kind: "replacement",
    targetTaskId: "t-live",
    replaceable: false,
  });
  const rejected = stateWith([
    {
      workType: "implementation",
      repositoryId: REPO,
      phase: "host-effect-rejected",
      targetTaskId: "t-rejected",
    },
  ]);
  deepEqual(deriveLineageExpectation(rejected, REPO), {
    kind: "replacement",
    targetTaskId: "t-rejected",
    replaceable: true,
  });
  const accepted = stateWith([
    { workType: "implementation", repositoryId: REPO, phase: "accepted", targetTaskId: "t-done" },
    { workType: "implementation", repositoryId: REPO, phase: "superseded", targetTaskId: "t-old" },
  ]);
  deepEqual(deriveLineageExpectation(accepted, REPO), {
    kind: "continuation",
    targetTaskIds: ["t-done"],
  });
  deepEqual(
    deriveLineageBlockers(
      { kind: "continuation", continuesTargetTaskId: "t-old" as never },
      { kind: "continuation", targetTaskIds: ["t-done"] },
    ),
    ["lineage-continuation-target:t-done"],
  );
  deepEqual(
    deriveLineageBlockers(
      { kind: "continuation", continuesTargetTaskId: "t-done" as never },
      { kind: "continuation", targetTaskIds: ["t-done"] },
    ),
    [],
  );
});

test("测试合同步骤引用：记录摘要、节锚点、条目三处各自报出阻塞", () => {
  const criteria = parseAcceptanceCriteria(FIXTURE_REQUIREMENT_MARKDOWN);
  const step = (
    stepId: string,
    itemId: string,
    recordDigest = RECORD,
    sectionAnchor = "acceptance-criteria",
  ) => ({
    stepId,
    requirementRef: { recordDigest, sectionAnchor, itemId },
  });
  deepEqual(
    deriveTestStepReferenceBlockers({
      steps: [step("ts-1", "ac-1"), step("ts-2", "ac-2")],
      recordDigest: RECORD,
      criteria,
    }),
    [],
  );
  deepEqual(
    deriveTestStepReferenceBlockers({
      steps: [
        step("ts-1", "ac-9"),
        step("ts-2", "ac-1", OTHER),
        step("ts-3", "ac-2", RECORD, "goal"),
      ],
      recordDigest: RECORD,
      criteria,
    }),
    ["step-item-unknown:ts-1:ac-9", "step-record-drift:ts-2", "step-section:ts-3:goal"],
  );
});

test("测试规划准入：真实环境、全部实现已接受、单一未终结测试目标、谱系对上待消费复测", () => {
  const accepted = (targetTaskId: string) => ({
    workType: "implementation",
    repositoryId: REPO,
    phase: "accepted",
    targetTaskId,
    taskPackageId: `tp-${targetTaskId}`,
    taskPackageDigest: `sha256:${"a".repeat(64)}`,
    windowId: "w",
    currentDelivery: {
      targetResult: {
        targetResultId: `tr-${targetTaskId}`,
        resultDigest: `sha256:${"b".repeat(64)}`,
      },
      reviewDecision: {
        targetReviewDecisionId: `rd-${targetTaskId}`,
        decisionDigest: `sha256:${"c".repeat(64)}`,
      },
    },
  });
  const active = (
    targets: readonly Record<string, unknown>[],
    extra: Record<string, unknown> = {},
  ) =>
    ({ lifecycle: "active", targetTasks: targets, ...extra }) as unknown as Parameters<
      typeof deriveTestPlanningBlockers
    >[0]["state"];
  deepEqual(
    deriveTestPlanningBlockers({
      testingMode: "controller-only",
      state: active([], { awaitingDecision: {} }),
      lineage: null,
    }),
    ["testing-mode:controller-only", "awaiting-decision", "implementation-targets-missing"],
  );
  deepEqual(
    deriveTestPlanningBlockers({
      testingMode: "real-environment",
      state: active([
        { ...accepted("t-1"), phase: "rework-requested" },
        {
          workType: "test",
          windowId: "w",
          phase: "test-delivery-prepared",
          targetTaskId: "t-test",
        },
      ]),
      lineage: null,
    }),
    ["implementation-target-not-accepted:t-1", "test-target-open:t-test"],
  );
  deepEqual(
    deriveTestPlanningBlockers({
      testingMode: "real-environment",
      state: active([accepted("t-1")]),
      lineage: { kind: "retest", retestsTargetTaskId: "t-old" },
    }),
    ["lineage-unexpected"],
  );
  const defect = active([
    accepted("t-1"),
    { workType: "test", windowId: "w", phase: "test-product-defect", targetTaskId: "t-old" },
  ]);
  deepEqual(
    deriveTestPlanningBlockers({ testingMode: "real-environment", state: defect, lineage: null }),
    ["test-retest-not-authorized"],
  );
  const pending = active(
    [
      accepted("t-1"),
      { workType: "test", windowId: "w", phase: "test-product-defect", targetTaskId: "t-old" },
    ],
    { pendingTestRetest: { previousTestTarget: { targetTaskId: "t-old" } } },
  );
  deepEqual(
    deriveTestPlanningBlockers({ testingMode: "real-environment", state: pending, lineage: null }),
    ["lineage-retest-required:t-old"],
  );
  deepEqual(
    deriveTestPlanningBlockers({
      testingMode: "real-environment",
      state: pending,
      lineage: { kind: "retest", retestsTargetTaskId: "t-other" },
    }),
    ["lineage-retest-target:t-old"],
  );
  deepEqual(
    deriveTestPlanningBlockers({
      testingMode: "real-environment",
      state: pending,
      lineage: { kind: "retest", retestsTargetTaskId: "t-old" },
    }),
    [],
  );
  deepEqual(
    deriveImplementationBaselines(
      active([
        accepted("t-1"),
        { ...accepted("t-2"), phase: "superseded" },
        { workType: "test", phase: "planned" },
      ]),
    ),
    [
      {
        targetTaskId: "t-1",
        taskPackageId: "tp-t-1",
        taskPackageDigest: `sha256:${"a".repeat(64)}`,
        repositoryId: REPO,
        windowId: "w",
        targetResultId: "tr-t-1",
        resultDigest: `sha256:${"b".repeat(64)}`,
        targetReviewDecisionId: "rd-t-1",
        decisionDigest: `sha256:${"c".repeat(64)}`,
      },
    ],
  );
  deepEqual(
    deriveTopologyBlockers({
      config: { indexes: { repositoryById: {}, windowById: {} } } as never,
      repositoryId: "r",
      windowId: "w",
      podId: "p",
    }),
    ["repository-unknown", "window-unknown"],
  );
  deepEqual(
    deriveTopologyBlockers({
      config: {
        indexes: {
          repositoryById: { r: {} },
          windowById: {
            w: { role: "product", root: { kind: "repository", repositoryId: "r" }, podId: "other" },
          },
        },
      } as never,
      repositoryId: "r",
      windowId: "w",
      podId: "p",
    }),
    ["assignment-window-pod-mismatch:other"],
  );
});

test("实现规划准入：非活动 Demand、待消费复测与已有 test 目标都在规划前说清楚", () => {
  deepEqual(
    deriveImplementationPlanningBlockers({
      lifecycle: "active",
      targetTasks: [{ workType: "implementation", targetTaskId: "t-impl" }],
    } as unknown as Readonly<DemandAggregateState>),
    [],
  );
  deepEqual(
    deriveImplementationPlanningBlockers({
      lifecycle: "completed",
      pendingTestRetest: {},
      targetTasks: [{ workType: "test", targetTaskId: "t-test" }],
    } as unknown as Readonly<DemandAggregateState>),
    ["demand-lifecycle:completed", "test-retest-pending", "test-target-present:t-test"],
  );
});
