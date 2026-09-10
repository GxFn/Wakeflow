import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { TargetResultImportService } from "../../../src/governance/result/target-result-import-service.js";
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
import { testResultReportContent } from "../review/controller-test-review-decision-service.fixture.js";
import { deliveryBindingFromOutcome } from "./target-result.fixture.js";

const TEST_RESULT_REPORTED_AT = parseUtcInstant("2026-08-29T12:40:00.000Z");

test("TestTargetResult闭合测试合同、attempt与投递结局但不产生verdict", async () => {
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

    const reportContent = testResultReportContent(fixture.testStepIds);
    const report = createTestTargetResultReport(reportContent, {
      clock: () => TEST_RESULT_REPORTED_AT,
    });
    const delivery = deliveryBindingFromOutcome(outcome);
    const result = createTestTargetResult({
      taskPackage,
      envelope,
      delivery,
      report,
    });
    equal(result.workType, "test");
    equal(result.deliveryId, envelope.deliveryId);
    equal(result.delivery.disposition, "accepted");
    equal(result.assignment.windowId, taskPackage.assignment.windowId);
    equal(Object.hasOwn(result.assignment, "repositoryId"), false);
    equal(result.testExecution.testAttemptId, envelope.attempt.testAttemptId);
    equal(Object.hasOwn(result.testExecution, "testCard"), false);
    equal(Object.hasOwn(result.testExecution, "testDispatchPacketDigest"), false);
    equal(result.report.stepEvidence.length, taskPackage.testContract.steps.length);
    equal(Object.hasOwn(result, "controllerDecision"), false);
    equal(Object.hasOwn(result.report, "verdict"), false);
    equal(parseTargetResultDocument(renderTargetResult(result)).resultDigest, result.resultDigest);

    const incompleteReport = createTestTargetResultReport(
      {
        outcome: "completed",
        summary: "只返回第一步，不能形成完整Test Result。",
        evidenceLocators: reportContent.evidenceLocators.slice(0, 1),
        verification: [],
        risks: ["批准步骤尚未全部执行。"],
        stepEvidence: report.stepEvidence.slice(0, 1),
      },
      { clock: () => TEST_RESULT_REPORTED_AT },
    );
    throws(
      () =>
        createTestTargetResult({
          taskPackage,
          envelope,
          delivery,
          report: incompleteReport,
        }),
      (error: unknown) => error instanceof TestTargetResultError && error.reason === "relation",
    );

    const owner = new TargetResultImportService(fixture.workspaceRoot, "codex");
    const request = {
      demandId: fixture.demandId,
      deliveryId: envelope.deliveryId,
      claimDigest: delivered.prepared.permit.fence.claimDigest,
      report: { workType: "test" as const, content: reportContent },
    };
    const recorded = await owner.import(request, { clock: () => TEST_RESULT_REPORTED_AT });
    equal(recorded.status, "recorded");
    equal(recorded.result.workType, "test");
    equal(recorded.result.resultDigest, result.resultDigest);
    equal(recorded.claimAuthority, "released");
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

    const replayed = await owner.import(request, { clock: () => TEST_RESULT_REPORTED_AT });
    equal(replayed.status, "already-recorded");
    equal(replayed.disposition, "idempotent");
    equal(replayed.claimAuthority, "released");
  } finally {
    await cleanupTestDeliveryWorkspaceFixture(fixture);
  }
});
