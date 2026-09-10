import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import {
  createTestTargetResult,
  TestTargetResultError,
} from "../../../src/governance/result/test-target-result.js";
import {
  parseTargetResultDocument,
  renderTargetResult,
} from "../../../src/governance/result/target-result.js";
import { createTestTargetResultReport } from "../../../src/governance/result/test-target-result-report.js";
import { readDemandPostAcceptanceRoute } from "../../../src/governance/review/demand-post-acceptance-route.js";
import { readDemandResultReviewSnapshot } from "../../../src/governance/review/demand-result-review-snapshot.js";
import { inspectWorkClaim } from "../../../src/kernel/work-claims.js";
import {
  loadFixtureDeliveryOutcome,
  withFixtureDemandRoot,
} from "../delivery/delivery-workspace.fixture.js";
import {
  cleanupTestDeliveryWorkspaceFixture,
  createTestDeliveryWorkspaceFixture,
  deliverFixtureTestTarget,
} from "../delivery/test-delivery-workspace.fixture.js";
import {
  importFixtureTestResult,
  passingStep,
  TEST_RESULT_REPORTED_AT,
  testResultReportContent,
} from "../review/controller-test-review-decision-service.fixture.js";
import { deliveryBindingFromOutcome } from "./target-result.fixture.js";

test("TestTargetResult闭合测试合同、attempt与投递结局并携带派生判定，但不表示acceptance", async () => {
  const fixture = await createTestDeliveryWorkspaceFixture();
  try {
    const delivered = await deliverFixtureTestTarget(fixture);
    const envelope = delivered.envelope;
    if (envelope.workType !== "test") throw new Error("Expected a Test delivery envelope.");
    const outcome = await loadFixtureDeliveryOutcome(fixture, envelope.deliveryId);
    const taskPackage = await withFixtureDemandRoot(fixture, async (root) => {
      const located = await new DemandEventSourcingRepository(root).findTargetTaskPlannedEvent(
        envelope.target.taskPackageId,
      );
      if (located === null || located.event.data.taskPackage.workType !== "test") {
        throw new Error("Expected Test TaskPackage Event.");
      }
      return located.event.data.taskPackage;
    });

    const steps = fixture.testStepIds.map((stepId) => passingStep(stepId, fixture.evidence));
    const reportContent = testResultReportContent(steps, fixture.evidence);
    const report = createTestTargetResultReport(reportContent, {
      clock: () => TEST_RESULT_REPORTED_AT,
    });
    const delivery = deliveryBindingFromOutcome(outcome);
    const result = createTestTargetResult({ taskPackage, envelope, delivery, report });
    equal(result.workType, "test");
    equal(result.deliveryId, envelope.deliveryId);
    equal(result.delivery.disposition, "accepted");
    equal(result.assignment.windowId, taskPackage.assignment.windowId);
    equal(Object.hasOwn(result.assignment, "repositoryId"), false);
    equal(result.testExecution.testAttemptId, envelope.attempt.testAttemptId);
    equal(result.testExecution.ordinal, 1);
    equal(result.testExecution.stepIds, null);
    equal(result.report.steps.length, taskPackage.testContract.steps.length);
    equal(result.report.verdict, "pass");
    equal(Object.hasOwn(result, "controllerDecision"), false);
    equal(parseTargetResultDocument(renderTargetResult(result)).resultDigest, result.resultDigest);

    const incompleteReport = createTestTargetResultReport(
      {
        outcome: "completed",
        summary: "只返回第一步，不能形成完整Test Result。",
        evidenceLocators: reportContent.evidenceLocators,
        verification: [],
        risks: ["合同步骤尚未全部执行。"],
        steps: steps.slice(0, 1),
      },
      { clock: () => TEST_RESULT_REPORTED_AT },
    );
    throws(
      () => createTestTargetResult({ taskPackage, envelope, delivery, report: incompleteReport }),
      (error: unknown) => error instanceof TestTargetResultError && error.reason === "relation",
    );

    const recorded = await importFixtureTestResult(fixture, delivered, { steps });
    equal(recorded.status, "committed");
    equal(recorded.result.workType, "test");
    equal(recorded.result.resultDigest, result.resultDigest);
    equal(recorded.callback.permit.hostAction.effect, "send-prompt-to-window");
    equal(
      (await inspectWorkClaim(fixture.workspaceRoot, taskPackage.assignment.windowId)).status,
      "absent",
    );
    equal(
      (await readDemandPostAcceptanceRoute(fixture.workspaceRoot, fixture.demandId)).nextStage
        .status,
      "test-result-review-planning",
    );

    await withFixtureDemandRoot(fixture, async (demandRoot) => {
      const aggregate = (await new DemandEventSourcingRepository(demandRoot).audit()).aggregate;
      const target = aggregate.state.targetTasks.find(
        (entry) => entry.targetTaskId === fixture.testTargetTaskId,
      );
      equal(target?.phase, "test-result-reported");
      const reviewSnapshot = await readDemandResultReviewSnapshot(demandRoot);
      const reviewTarget = reviewSnapshot.targets.find(
        (entry) => entry.targetTaskId === fixture.testTargetTaskId,
      );
      if (reviewTarget?.status !== "reported") {
        throw new Error("Expected reported Test review target.");
      }
      equal(reviewTarget.targetResult.workType, "test");
    });

    const replayed = await importFixtureTestResult(fixture, delivered, {
      steps,
      expectedStreamRevision: recorded.event.streamRevision - 1,
    });
    equal(replayed.status, "idempotent");
    equal(replayed.result.resultDigest, recorded.result.resultDigest);
    equal(replayed.callback.callbackId, recorded.callback.callbackId);
  } finally {
    await cleanupTestDeliveryWorkspaceFixture(fixture);
  }
});
