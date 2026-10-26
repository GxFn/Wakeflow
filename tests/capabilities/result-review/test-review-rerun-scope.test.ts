import { deepEqual, equal, rejects } from "node:assert/strict";
import { test } from "node:test";

import type {
  TargetResultReviewInspectionResult,
  TestReviewDecisionRequest,
} from "../../../src/capabilities/result-review/contract.js";
import {
  type ExecuteResultReviewOptions,
  executeTestReviewDecisionRequest,
} from "../../../src/capabilities/result-review/service.js";
import { parseUtcInstant, type UtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import {
  cleanupTestDeliveryWorkspaceFixture,
  createTestDeliveryWorkspaceFixture,
  deliverFixtureTestTarget,
  type TestDeliveryWorkspaceFixture,
} from "../../governance/delivery/test-delivery-workspace.fixture.js";
import {
  CODEX_REVIEW_FACADE,
  inspectFixtureReview,
  landFixtureTargetCompletion,
} from "../../governance/review/controller-implementation-review-decision-service.fixture.js";
import {
  failingStep,
  fixtureTestDecisionRequest,
  importFixtureTestResult,
  passingStep,
  TEST_REVIEW_DECIDED_AT,
  TEST_REVIEW_INSPECTED_AT,
  TEST_TARGET_STOPPED_AT,
  type TestStepContent,
} from "../../governance/review/controller-test-review-decision-service.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

/**
 * result-review 切片效果（W23，CR-S5）：needs-review 测试报告漏报的合同步骤是未决步骤——另一次尝试
 * 必须把它和失败步骤一起点名；失败步骤重跑通过后仍未观察的步骤可以单独补跑；全部观察后再重跑
 * 被 no-pending-step 拒。级别 2（能力）。
 */

/** 公开结果是冻结的无原型对象；结构比较前转成普通 JSON 值。 */
function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

function rejectedWith(reason: string) {
  return (error: unknown) =>
    isWakeflowError(error) && error.code === "precondition-failed" && error.reason === reason;
}

function at(time: string): UtcInstant {
  return parseUtcInstant(`2026-08-29T${time}.000Z`);
}

function decisionOptions(clock: UtcInstant, uuid: string): ExecuteResultReviewOptions {
  return { clock: () => clock, uuidFactory: () => uuid };
}

function contractSteps(fixture: Readonly<TestDeliveryWorkspaceFixture>): readonly [string, string] {
  const [first, second] = fixture.testStepIds;
  if (first === undefined || second === undefined) throw new Error("Expected two contract steps.");
  return [first, second];
}

const RERUN_JUDGMENT: Pick<
  TestReviewDecisionRequest,
  "decision" | "assessment" | "independentChecks"
> = {
  decision: "request-another-attempt",
  assessment: { conclusion: "inconclusive", evidenceSufficiency: "insufficient" },
  independentChecks: [
    {
      checkId: "controller-rerun-scope",
      method: "对照合同逐步核对报告覆盖与证据。",
      outcome: "inconclusive",
      observation: "报告没有覆盖全部合同步骤，需补跑确认。",
    },
  ],
};

function decide(request: Readonly<TestReviewDecisionRequest>, uuid: string) {
  return executeTestReviewDecisionRequest(
    CODEX_REVIEW_FACADE,
    request,
    decisionOptions(TEST_REVIEW_DECIDED_AT, uuid),
  );
}

/** 一次尝试的往返：投递（首轮或重跑）→ 导入逐步记录 → 测试会话 Stop 记录 → 检查投影。 */
async function attemptRound(
  fixture: Readonly<TestDeliveryWorkspaceFixture>,
  attempt: number,
  expectedStreamRevision: number | undefined,
  report: Readonly<{
    steps: readonly TestStepContent[];
    outcome?: "completed" | "needs-review";
    reportedAt?: UtcInstant;
    stoppedAt?: UtcInstant;
    inspectedAt?: UtcInstant;
  }>,
): Promise<
  Readonly<{
    rerunStepIds: readonly string[] | null;
    inspection: Readonly<TargetResultReviewInspectionResult>;
    streamRevision: number;
  }>
> {
  const delivered = await deliverFixtureTestTarget(
    fixture,
    expectedStreamRevision === undefined ? {} : { expectedStreamRevision },
    attempt,
  );
  const envelope = delivered.envelope;
  if (envelope.workType !== "test") throw new Error("Expected a Test delivery envelope.");
  const imported = await importFixtureTestResult(fixture, delivered, {
    idempotencyKey: `scope-import-${attempt}`,
    steps: report.steps,
    ...(report.outcome === undefined ? {} : { outcome: report.outcome }),
    ...(report.reportedAt === undefined ? {} : { reportedAt: report.reportedAt }),
  });
  equal(imported.status, "committed");
  await landFixtureTargetCompletion(
    fixture,
    fixture.testRoute,
    report.stoppedAt ?? TEST_TARGET_STOPPED_AT,
  );
  const inspectedAt = report.inspectedAt ?? TEST_REVIEW_INSPECTED_AT;
  const inspection = await inspectFixtureReview(fixture, fixture.testTargetTaskId, {
    clock: () => inspectedAt,
  });
  return Object.freeze({
    rerunStepIds: envelope.attempt.mode === "rerun" ? envelope.attempt.rerunSource.stepIds : null,
    inspection,
    streamRevision: imported.event.streamRevision,
  });
}

test("漏报的步骤必须与失败步骤一起补跑；失败步骤通过后仍未观察的步骤可单独补跑；全部观察后再重跑被 no-pending-step 拒", async () => {
  const fixture = await createTestDeliveryWorkspaceFixture({ maxAttempts: 3 });
  try {
    const [first, second] = contractSteps(fixture);

    // 首轮 needs-review 报告只记了第一步（flaky 失败）：第二步没有记录也没有基线，是未决步骤。
    const round1 = await attemptRound(fixture, 1, undefined, {
      steps: [failingStep(first, fixture.evidence, "flaky")],
      outcome: "needs-review",
    });
    equal(round1.rerunStepIds, null);
    const [firstView1, secondView1] = round1.inspection.reviewUnit.testSteps ?? [];
    equal(firstView1?.verdict, "fail");
    equal(secondView1?.verdict, null);
    equal(secondView1?.baseline, null);
    deepEqual(plain(round1.inspection.reviewUnit.allowedDecisions), [
      "request-another-attempt",
      "escalate",
    ]);
    await rejects(
      decide(
        {
          ...fixtureTestDecisionRequest(
            fixture,
            round1.inspection,
            round1.streamRevision,
            "scope-rerun-1-partial",
          ),
          ...RERUN_JUDGMENT,
          stepIds: [first],
        },
        "d0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0",
      ),
      rejectedWith("step-uncovered"),
    );
    const rerun1 = await decide(
      {
        ...fixtureTestDecisionRequest(
          fixture,
          round1.inspection,
          round1.streamRevision,
          "scope-rerun-1",
        ),
        ...RERUN_JUDGMENT,
        stepIds: [first, second],
      },
      "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1",
    );
    equal(rerun1.status, "committed");
    equal(rerun1.target.phase, "test-another-attempt-requested");
    equal(rerun1.target.attemptCount, 1);
    equal(rerun1.next.frontier, "test-delivery-rerun-planning");

    // 第二次尝试重跑两步，报告仍只记第一步（通过）：没有失败步骤，但第二步仍未决——accept 被并集
    // cannot-conclude 挡住，第二步可以单独补跑，已通过的第一步不能再点名。
    const round2 = await attemptRound(fixture, 2, rerun1.event.streamRevision, {
      steps: [passingStep(first, fixture.evidence)],
      outcome: "needs-review",
      reportedAt: at("12:44:00"),
      stoppedAt: at("12:45:00"),
      inspectedAt: at("12:46:00"),
    });
    deepEqual(plain(round2.rerunStepIds), [first, second]);
    const [firstView2, secondView2] = round2.inspection.reviewUnit.testSteps ?? [];
    equal(firstView2?.verdict, "pass");
    equal(secondView2?.verdict, null);
    equal(secondView2?.baseline, null);
    deepEqual(plain(round2.inspection.reviewUnit.attemptScope), {
      ordinal: 2,
      stepIds: [first, second],
    });
    deepEqual(plain(round2.inspection.reviewUnit.allowedDecisions), [
      "request-another-attempt",
      "escalate",
    ]);
    await rejects(
      decide(
        fixtureTestDecisionRequest(
          fixture,
          round2.inspection,
          round2.streamRevision,
          "scope-accept-2",
        ),
        "d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2",
      ),
      rejectedWith("verdict"),
    );
    await rejects(
      decide(
        {
          ...fixtureTestDecisionRequest(
            fixture,
            round2.inspection,
            round2.streamRevision,
            "scope-rerun-2-passed",
          ),
          ...RERUN_JUDGMENT,
          stepIds: [first, second],
        },
        "d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3",
      ),
      rejectedWith("step-scope"),
    );
    const rerun2 = await decide(
      {
        ...fixtureTestDecisionRequest(
          fixture,
          round2.inspection,
          round2.streamRevision,
          "scope-rerun-2",
        ),
        ...RERUN_JUDGMENT,
        stepIds: [second],
      },
      "d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4",
    );
    equal(rerun2.status, "committed");
    equal(rerun2.target.attemptCount, 2);

    // 第三次尝试只跑第二步并通过：第一步沿用第二次尝试的基线，再重跑没有未决步骤，accept 可达。
    const round3 = await attemptRound(fixture, 3, rerun2.event.streamRevision, {
      steps: [passingStep(second, fixture.evidence)],
      reportedAt: at("12:54:00"),
      stoppedAt: at("12:55:00"),
      inspectedAt: at("12:56:00"),
    });
    deepEqual(plain(round3.rerunStepIds), [second]);
    const [firstView3, secondView3] = round3.inspection.reviewUnit.testSteps ?? [];
    equal(firstView3?.verdict, null);
    equal(firstView3?.baseline?.attemptOrdinal, 2);
    equal(secondView3?.verdict, "pass");
    deepEqual(plain(round3.inspection.reviewUnit.allowedDecisions), ["accept", "escalate"]);
    await rejects(
      decide(
        {
          ...fixtureTestDecisionRequest(
            fixture,
            round3.inspection,
            round3.streamRevision,
            "scope-rerun-3",
          ),
          ...RERUN_JUDGMENT,
          stepIds: [second],
        },
        "d5d5d5d5-d5d5-4d5d-8d5d-d5d5d5d5d5d5",
      ),
      rejectedWith("no-pending-step"),
    );
    const accepted = await decide(
      fixtureTestDecisionRequest(
        fixture,
        round3.inspection,
        round3.streamRevision,
        "scope-accept-3",
      ),
      "d6d6d6d6-d6d6-4d6d-8d6d-d6d6d6d6d6d6",
    );
    equal(accepted.status, "committed");
    equal(accepted.target.phase, "test-accepted");
    equal(accepted.target.attemptCount, 3);
  } finally {
    await cleanupTestDeliveryWorkspaceFixture(fixture);
  }
});
