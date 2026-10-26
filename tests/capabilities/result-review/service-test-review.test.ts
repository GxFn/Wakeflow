import { deepEqual, equal, rejects } from "node:assert/strict";
import { test } from "node:test";

import { executeDemandContinuationRequest } from "../../../src/capabilities/demand/lifecycle.js";
import type { TestReviewDecisionRequest } from "../../../src/capabilities/result-review/contract.js";
import { executeTestReviewDecisionRequest } from "../../../src/capabilities/result-review/service.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { withFixtureDemandRoot } from "../../governance/delivery/delivery-workspace.fixture.js";
import {
  cleanupTestDeliveryWorkspaceFixture,
  createTestDeliveryWorkspaceFixture,
  deliverFixtureTestTarget,
  type TestDeliveryWorkspaceFixture,
} from "../../governance/delivery/test-delivery-workspace.fixture.js";
import {
  CODEX_REVIEW_FACADE,
  currentFixtureStreamRevision,
  inspectFixtureReview,
  landFixtureTargetCompletion,
} from "../../governance/review/controller-implementation-review-decision-service.fixture.js";
import {
  cleanupControllerTestReviewDecisionServiceFixture,
  createControllerTestReviewDecisionServiceFixture,
  decideFixtureTest,
  failingStep,
  fixtureTestDecisionRequest,
  importFixtureTestResult,
  passingStep,
  TEST_REVIEW_DECIDED_AT,
  TEST_REVIEW_INSPECTED_AT,
  TEST_TARGET_STOPPED_AT,
} from "../../governance/review/controller-test-review-decision-service.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { at, decisionOptions, plain, rejectedWith } from "./service.fixture.js";

useDisposableDurability();

/**
 * result-review 切片效果（§13.87 D1–D8）之测试评审决定，2 级（能力）测试：全部通过只允许 accept 与
 * escalate，needs-decision 升级附带 Demand 升级事件，用户回答后带 resumption 的 accept 进入
 * test-accepted；flaky 失败步骤只允许重跑，重跑只带失败子集并沿用上一轮通过基线；product-defect 失败
 * 步骤只允许 escalate，并在同一提交追加修复授权把实现目标送回返工。拆自 service.test.ts（测试门清理
 * D4，open-items D9），与 service-import-and-callback、service-implementation-review-and-inspection
 * 共用 service.fixture.ts。
 */

type TestEscalationWire = NonNullable<TestReviewDecisionRequest["escalation"]>;
type TestJudgmentWire = Pick<
  TestReviewDecisionRequest,
  "decision" | "assessment" | "independentChecks"
>;

test("测试评审：全部通过只允许 accept 与 escalate；needs-decision 升级附带 Demand 升级事件，用户回答后带 resumption 的 accept 进入 test-accepted", async () => {
  const fixture = await createControllerTestReviewDecisionServiceFixture();
  try {
    const unit = fixture.testInspection.reviewUnit;
    equal(unit.workType, "test");
    equal(unit.testSteps?.length, fixture.testStepIds.length);
    equal(
      unit.testSteps?.every((step) => step.baseline === null && step.verdict === "pass"),
      true,
    );
    deepEqual(plain(unit.attemptScope), { ordinal: 1, stepIds: null });
    deepEqual(plain(unit.allowedDecisions), ["accept", "escalate"]);
    await rejects(
      decideFixtureTest(fixture, {
        decision: "request-another-attempt",
        stepIds: ["ts-1"],
        assessment: { conclusion: "inconclusive", evidenceSufficiency: "insufficient" },
        independentChecks: [
          {
            checkId: "controller-test-evidence",
            method: "复核逐步证据。",
            outcome: "inconclusive",
            observation: "没有失败步骤可重跑。",
          },
        ],
      }),
      rejectedWith("no-pending-step"),
    );
    await rejects(
      decideFixtureTest(fixture, {
        decision: "blocked",
        assessment: { conclusion: "inconclusive", evidenceSufficiency: "insufficient" },
        blockingReasons: ["环境事实尚未确认。"],
      }),
      rejectedWith("blocked-basis"),
    );

    const escalation: TestEscalationWire = {
      classification: "needs-decision",
      userDecision: {
        issue: "测试全部通过，但需求包对结果留存期限的表述需要用户裁定。",
        requirementRefs: [],
        evidence: [],
        options: [
          { option: "按当前结果接受。", impact: "不再补充测试。" },
          { option: "补充一轮留存期限测试。", impact: "需要新的测试合同。" },
        ],
        recommendation: "建议按当前结果接受。",
      },
    };
    const escalated = await decideFixtureTest(fixture, {
      decision: "escalate",
      assessment: { conclusion: "inconclusive", evidenceSufficiency: "sufficient" },
      escalation,
      idempotencyKey: "fixture-test-decision-escalate",
    });
    equal(escalated.status, "committed");
    equal(escalated.target.phase, "test-escalated");
    equal(escalated.attached.productDefectRemediationId, null);
    const escalationEventId = escalated.attached.escalationEventId;
    if (escalationEventId === null) throw new Error("needs-decision must attach the escalation");
    const waiting = await inspectFixtureReview(fixture, fixture.testTargetTaskId, {
      clock: () => at("12:38:00"),
    });
    equal(waiting.reviewUnit.status, "escalated");
    deepEqual(plain(waiting.reviewUnit.allowedDecisions), []);
    deepEqual(plain(waiting.reviewUnit.resumptionBasis), {
      kind: "decision-recorded",
      escalationEventId,
      answered: false,
    });

    const decision = { text: "按当前结果接受。", chosenOption: "按当前结果接受。" };
    const preview = await executeDemandContinuationRequest({
      root: fixture.workspacePath,
      mode: "preview",
      demandId: fixture.demandId,
      action: "record-decision",
      decision,
    });
    if (preview.kind !== "WakeflowDemandContinuationPreview" || preview.planDigest === null) {
      throw new Error("Expected a ready decision plan.");
    }
    const recorded = await executeDemandContinuationRequest({
      root: fixture.workspacePath,
      mode: "apply",
      demandId: fixture.demandId,
      action: "record-decision",
      decision,
      planDigest: preview.planDigest,
    });
    if (recorded.kind !== "WakeflowDemandContinuationMutation")
      throw new Error("Expected a mutation.");
    equal(recorded.disposition, "decision-recorded");
    equal(recorded.next.frontier, "test-result-review");
    const answered = await inspectFixtureReview(fixture, fixture.testTargetTaskId, {
      clock: () => at("12:39:00"),
    });
    deepEqual(plain(answered.reviewUnit.resumptionBasis), {
      kind: "decision-recorded",
      escalationEventId,
      answered: true,
    });
    deepEqual(plain(answered.reviewUnit.allowedDecisions), ["accept", "escalate"]);
    const accepted = await executeTestReviewDecisionRequest(
      CODEX_REVIEW_FACADE,
      {
        ...fixtureTestDecisionRequest(
          fixture,
          answered,
          await currentFixtureStreamRevision(fixture),
          "fixture-test-decision-resumed",
        ),
        resumption: {
          previousDecisionId: escalated.decision.targetReviewDecisionId,
          basis: { kind: "decision-recorded", escalationEventId },
          summary: "用户已回答：按当前结果接受。",
        },
      },
      decisionOptions(at("12:40:00"), "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1"),
    );
    equal(accepted.status, "committed");
    equal(accepted.target.phase, "test-accepted");
    equal(accepted.target.attemptCount, 1);
    equal(accepted.next.frontier, "demand-completion-preflight");
  } finally {
    await cleanupControllerTestReviewDecisionServiceFixture(fixture);
  }
});

function contractSteps(fixture: Readonly<TestDeliveryWorkspaceFixture>): readonly [string, string] {
  const [first, second] = fixture.testStepIds;
  if (first === undefined || second === undefined) throw new Error("Expected two contract steps.");
  return [first, second];
}

function testDecision(request: Readonly<TestReviewDecisionRequest>, uuid: string) {
  return executeTestReviewDecisionRequest(
    CODEX_REVIEW_FACADE,
    request,
    decisionOptions(TEST_REVIEW_DECIDED_AT, uuid),
  );
}

test("flaky 失败步骤只允许 request-another-attempt 与 escalate；重跑尝试只带失败子集，范围外步骤沿用上一轮通过基线", async () => {
  const fixture = await createTestDeliveryWorkspaceFixture({ maxAttempts: 2 });
  try {
    const [first, second] = contractSteps(fixture);
    const delivered = await deliverFixtureTestTarget(fixture);
    const imported = await importFixtureTestResult(fixture, delivered, {
      steps: [passingStep(first, fixture.evidence), failingStep(second, fixture.evidence, "flaky")],
    });
    equal(imported.status, "committed");
    await landFixtureTargetCompletion(fixture, fixture.testRoute, TEST_TARGET_STOPPED_AT);
    const inspection = await inspectFixtureReview(fixture, fixture.testTargetTaskId, {
      clock: () => TEST_REVIEW_INSPECTED_AT,
    });
    deepEqual(plain(inspection.reviewUnit.allowedDecisions), [
      "request-another-attempt",
      "escalate",
    ]);
    equal(inspection.reviewUnit.testSteps?.[1]?.failure?.classification, "flaky");
    const revision = imported.event.streamRevision;
    const rerunJudgment: TestJudgmentWire = {
      decision: "request-another-attempt",
      assessment: { conclusion: "inconclusive", evidenceSufficiency: "insufficient" },
      independentChecks: [
        {
          checkId: "controller-flaky-check",
          method: "重读失败步骤证据并对照合同 then。",
          outcome: "inconclusive",
          observation: "失败与产品行为无关，需重跑确认。",
        },
      ],
    };
    await rejects(
      testDecision(
        fixtureTestDecisionRequest(fixture, inspection, revision, "fixture-test-accept-flaky"),
        "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0",
      ),
      rejectedWith("verdict"),
    );
    await rejects(
      testDecision(
        {
          ...fixtureTestDecisionRequest(fixture, inspection, revision, "fixture-test-rerun-scope"),
          ...rerunJudgment,
          stepIds: [first],
        },
        "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0",
      ),
      rejectedWith("step-scope"),
    );
    const rerun = await testDecision(
      {
        ...fixtureTestDecisionRequest(fixture, inspection, revision, "fixture-test-rerun"),
        ...rerunJudgment,
        stepIds: [second],
      },
      "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1",
    );
    equal(rerun.status, "committed");
    equal(rerun.target.phase, "test-another-attempt-requested");
    equal(rerun.target.attemptCount, 1);
    equal(rerun.next.frontier, "test-delivery-rerun-planning");

    const redelivered = await deliverFixtureTestTarget(
      fixture,
      { expectedStreamRevision: rerun.event.streamRevision },
      2,
    );
    const envelope = redelivered.envelope;
    if (envelope.workType !== "test" || envelope.attempt.mode !== "rerun") {
      throw new Error("Expected a rerun Test delivery envelope.");
    }
    equal(envelope.attempt.ordinal, 2);
    deepEqual(plain(envelope.attempt.rerunSource.stepIds), [second]);
    equal(
      envelope.attempt.rerunSource.reviewDecision.targetReviewDecisionId,
      rerun.decision.targetReviewDecisionId,
    );
    const reimported = await importFixtureTestResult(fixture, redelivered, {
      idempotencyKey: "fixture-test-import-2",
      steps: [passingStep(second, fixture.evidence)],
      reportedAt: at("12:44:00"),
    });
    equal(reimported.status, "committed");
    await landFixtureTargetCompletion(fixture, fixture.testRoute, at("12:45:00"));
    const rerunInspection = await inspectFixtureReview(fixture, fixture.testTargetTaskId, {
      clock: () => at("12:46:00"),
    });
    deepEqual(plain(rerunInspection.reviewUnit.attemptScope), { ordinal: 2, stepIds: [second] });
    const [firstView, secondView] = rerunInspection.reviewUnit.testSteps ?? [];
    equal(firstView?.observed, null);
    equal(firstView?.verdict, null);
    equal(firstView?.baseline?.attemptOrdinal, 1);
    equal(firstView?.baseline?.targetTaskId, fixture.testTargetTaskId);
    equal(secondView?.verdict, "pass");
    equal(secondView?.baseline, null);
    equal(rerunInspection.reviewUnit.priorReviewHistory.length, 1);
    deepEqual(plain(rerunInspection.reviewUnit.allowedDecisions), ["accept", "escalate"]);
    const rerunRevision = reimported.event.streamRevision;
    await rejects(
      testDecision(
        {
          ...fixtureTestDecisionRequest(
            fixture,
            rerunInspection,
            rerunRevision,
            "fixture-test-rerun-again",
          ),
          ...rerunJudgment,
          stepIds: [second],
        },
        "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2",
      ),
      rejectedWith("no-pending-step"),
    );
    const accepted = await testDecision(
      fixtureTestDecisionRequest(fixture, rerunInspection, rerunRevision, "fixture-test-accept-2"),
      "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3",
    );
    equal(accepted.status, "committed");
    equal(accepted.target.phase, "test-accepted");
    equal(accepted.target.attemptCount, 2);
  } finally {
    await cleanupTestDeliveryWorkspaceFixture(fixture);
  }
});

test("product-defect 失败步骤只允许 escalate；escalate{product-defect} 在同一提交追加修复授权并把实现目标送回返工", async () => {
  const fixture = await createTestDeliveryWorkspaceFixture({ maxAttempts: 2 });
  try {
    const [first, second] = contractSteps(fixture);
    const delivered = await deliverFixtureTestTarget(fixture);
    const imported = await importFixtureTestResult(fixture, delivered, {
      steps: [
        passingStep(first, fixture.evidence),
        failingStep(second, fixture.evidence, "product-defect"),
      ],
    });
    await landFixtureTargetCompletion(fixture, fixture.testRoute, TEST_TARGET_STOPPED_AT);
    const inspection = await inspectFixtureReview(fixture, fixture.testTargetTaskId, {
      clock: () => TEST_REVIEW_INSPECTED_AT,
    });
    deepEqual(plain(inspection.reviewUnit.allowedDecisions), ["escalate"]);
    equal(inspection.reviewUnit.testSteps?.[1]?.failure?.classification, "product-defect");
    const revision = imported.event.streamRevision;
    const base = fixtureTestDecisionRequest(fixture, inspection, revision, "fixture-test-escalate");
    await rejects(
      testDecision(
        {
          ...base,
          decision: "request-another-attempt",
          stepIds: [second],
          assessment: { conclusion: "inconclusive", evidenceSufficiency: "insufficient" },
          independentChecks: [
            {
              checkId: "controller-rerun",
              method: "复核失败步骤。",
              outcome: "inconclusive",
              observation: "希望重跑。",
            },
          ],
        },
        "d0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0",
      ),
      rejectedWith("classification"),
    );
    const escalateJudgment: TestJudgmentWire = {
      decision: "escalate",
      assessment: { conclusion: "defect-observed", evidenceSufficiency: "sufficient" },
      independentChecks: [
        {
          checkId: "controller-defect-check",
          method: "按合同 then 复现失败步骤。",
          outcome: "failed",
          observation: "入口在真实环境返回了错误状态，与实现有关。",
        },
      ],
    };
    const remediation = (failedStepIds: [string]): TestEscalationWire => ({
      classification: "product-defect",
      remediation: {
        affectedTargets: [
          {
            targetTaskId: fixture.targetTaskId,
            failedStepIds,
            correctionObjective: "修复入口在真实环境下的返回状态。",
          },
        ],
        authorizationRationale: "测试证据指向实现缺陷，授权按失败步骤返工。",
      },
    });
    await rejects(
      testDecision(
        { ...base, ...escalateJudgment, escalation: remediation([first]) },
        "d0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0",
      ),
      rejectedWith("remediation-step"),
    );
    const escalated = await testDecision(
      { ...base, ...escalateJudgment, escalation: remediation([second]) },
      "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1",
    );
    equal(escalated.status, "committed");
    equal(escalated.target.phase, "test-product-defect");
    equal(escalated.attached.escalationEventId, null);
    const remediationId = escalated.attached.productDefectRemediationId;
    equal(typeof remediationId, "string");
    equal(escalated.next.frontier, "implementation-delivery-planning");
    const replay = await testDecision(
      { ...base, ...escalateJudgment, escalation: remediation([second]) },
      "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1",
    );
    equal(replay.status, "idempotent");
    equal(replay.attached.productDefectRemediationId, remediationId);
    await withFixtureDemandRoot(fixture, async (root) => {
      const repository = new DemandEventSourcingRepository(root);
      const { aggregate } = await repository.audit();
      equal(
        aggregate.streamRevision,
        escalated.event.streamRevision + 1,
        "two events in one commit",
      );
      equal(aggregate.state.awaitingDecision, undefined);
      const implementation = aggregate.state.targetTasks.find(
        (entry) => entry.targetTaskId === fixture.targetTaskId,
      );
      equal(implementation?.phase, "product-defect-rework-requested");
      if (implementation?.phase === "product-defect-rework-requested") {
        equal(implementation.productDefectRemediation.productDefectRemediationId, remediationId);
        deepEqual([...implementation.productDefectRemediation.failedStepIds], [second]);
        equal(
          implementation.productDefectRemediation.testReviewDecisionId,
          escalated.decision.targetReviewDecisionId,
        );
      }
      const commit = await repository.findCommitById(escalated.commit.commitId);
      equal(commit?.events.length, 2);
      equal(commit?.events[0]?.eventType, "review.target-result-decided");
      equal(commit?.events[1]?.eventType, "review.product-defect-remediation-authorized");
    });
  } finally {
    await cleanupTestDeliveryWorkspaceFixture(fixture);
  }
});
