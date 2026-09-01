import { equal, throws } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { TargetHostEffectClaimService } from "../../../src/governance/delivery/target-host-effect-claim-service.js";
import { TargetHostEffectOutcomeService } from "../../../src/governance/delivery/target-host-effect-outcome-service.js";
import { inspectWindowWorkClaim } from "../../../src/governance/delivery/window-work-claim-store.js";
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
import { TestDispatchProjectionStore } from "../../../src/governance/testing/test-dispatch-projection-store.js";
import { readDemandPostAcceptanceRoute } from "../../../src/governance/review/demand-post-acceptance-route.js";
import { readDemandResultReviewSnapshot } from "../../../src/governance/review/demand-result-review-snapshot.js";
import {
  TEST_CLAIMED_AT,
  cleanupTestHostEffectClaimWorkspaceFixture,
  createTestHostEffectClaimWorkspaceFixture,
  testClaimUuidFactory,
} from "../testing/test-host-effect-claim-service.fixture.js";

const TEST_OUTCOME_OBSERVED_AT = parseUtcInstant("2026-08-29T12:33:00.000Z");
const TEST_RESULT_REPORTED_AT = parseUtcInstant("2026-08-29T12:29:00.000Z");

test("TestTargetResult闭合Card、attempt、packet与Host Effect但不产生verdict", async () => {
  const fixture = await createTestHostEffectClaimWorkspaceFixture();
  let demandRoot: RootedDirectory | undefined;
  try {
    const claimed = await new TargetHostEffectClaimService(
      fixture.workspaceRoot,
      codexWorkspaceHostResourceProfile,
      codexWindowHostIdentityProfile,
    ).claim(fixture.testClaimRequest, {
      clock: () => TEST_CLAIMED_AT,
      uuidFactory: testClaimUuidFactory(),
    });
    if (claimed.action?.kind !== "WakeflowTestDeliveryAgentHostAction") {
      throw new Error("Expected first Test Agent Host Action.");
    }
    const action = claimed.action;
    const outcome = await new TargetHostEffectOutcomeService(
      fixture.workspaceRoot,
      "codex",
    ).record({
      demandId: fixture.testClaimRequest.demandId,
      actionId: action.actionId,
      claimDigest: action.workClaim.claimDigest,
      attempt: {
        status: "accepted",
        evidence: { transport: "accepted" },
      },
      readback: {
        status: "pending",
        evidence: { visible: false },
      },
      observedAt: TEST_OUTCOME_OBSERVED_AT,
    });

    demandRoot = await RootedDirectory.open(
      path.join(
        fixture.workspacePath,
        ...demandFinalRootRef(fixture.testClaimRequest.demandId).split("/"),
      ),
    );
    const repository = new DemandEventSourcingRepository(demandRoot);
    const preparedEvent = await repository.findTestDeliveryPreparedEvent(
      fixture.targetDeliveryId,
    );
    if (preparedEvent === null) {
      throw new Error("Expected Test Delivery Event.");
    }
    const taskEvent = await repository.findTargetTaskPlannedEvent(
      preparedEvent.event.data.intent.target.taskPackageId,
    );
    if (
      taskEvent === null ||
      taskEvent.event.data.taskPackage.workType !== "test"
    ) {
      throw new Error("Expected Test TaskPackage Event.");
    }
    const taskPackage = taskEvent.event.data.taskPackage;
    const packet = (
      await new TestDispatchProjectionStore(demandRoot).materialize(
        fixture.targetDeliveryId,
      )
    ).packet.projection.packet;
    await demandRoot.close();
    demandRoot = undefined;

    const evidenceLocators = fixture.testCard.approvedPlan.map(
      (_step, index) => ({
        kind: "test-step-report",
        ref: `evidence/test-runs/step-${index}.json`,
        digest: `sha256:${String(index + 1).repeat(64)}`,
      }),
    );
    const reportContent = {
      outcome: "completed",
      summary: "已执行全部Controller批准步骤并返回逐步事实。",
      evidenceLocators,
      verification: ["逐项复验Evidence ref与digest。"],
      risks: ["Result仍需Controller独立审查。"],
      stepEvidence: fixture.testCard.approvedPlan.map((step, index) => ({
        planIndex: index,
        step,
        evidence: {
          ref: evidenceLocators[index]!.ref,
          digest: evidenceLocators[index]!.digest,
        },
      })),
    } as const;
    const report = createTestTargetResultReport(reportContent, {
      clock: () => TEST_RESULT_REPORTED_AT,
    });
    const result = createTestTargetResult({
      taskPackage,
      testCard: fixture.testCard,
      intent: preparedEvent.event.data.intent,
      packet,
      claim: claimed.claim,
      observation: outcome.observation,
      report,
    });
    equal(result.workType, "test");
    equal(result.report.reportedAt < result.hostEffect.observedAt, true);
    equal(result.assignment.windowId, fixture.testCard.testWindowId);
    equal(Object.hasOwn(result.assignment, "repositoryId"), false);
    equal(result.testExecution.testAttemptId, fixture.testAttemptId);
    equal(
      result.testExecution.testDispatchPacketDigest,
      fixture.testDispatchPacketDigest,
    );
    equal(
      result.report.stepEvidence.length,
      fixture.testCard.approvedPlan.length,
    );
    equal(Object.hasOwn(result, "controllerDecision"), false);
    equal(Object.hasOwn(result.report, "verdict"), false);
    equal(
      parseTargetResultDocument(renderTargetResult(result)).resultDigest,
      result.resultDigest,
    );

    const incompleteReport = createTestTargetResultReport(
      {
        outcome: "completed",
        summary: "只返回第一步，不能形成完整Test Result。",
        evidenceLocators: evidenceLocators.slice(0, 1),
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
          testCard: fixture.testCard,
          intent: preparedEvent.event.data.intent,
          packet,
          claim: claimed.claim,
          observation: outcome.observation,
          report: incompleteReport,
        }),
      (error: unknown) =>
        error instanceof TestTargetResultError && error.reason === "relation",
    );

    const owner = new TargetResultImportService(fixture.workspaceRoot, "codex");
    const recorded = await owner.import(
      {
        demandId: fixture.testClaimRequest.demandId,
        actionId: action.actionId,
        observationDigest: outcome.observation.observationDigest,
        report: {
          workType: "test",
          content: reportContent,
        },
      },
      { clock: () => TEST_RESULT_REPORTED_AT },
    );
    equal(recorded.status, "recorded");
    equal(recorded.result.workType, "test");
    equal(recorded.result.resultDigest, result.resultDigest);
    equal(recorded.claimAuthority, "released");
    equal(
      (
        await inspectWindowWorkClaim(
          fixture.workspaceRoot,
          fixture.testCard.testWindowId,
        )
      ).status,
      "absent",
    );
    equal(
      (
        await readDemandPostAcceptanceRoute(
          fixture.workspaceRoot,
          fixture.testClaimRequest.demandId,
        )
      ).nextStage.status,
      "test-result-review-planning",
    );

    demandRoot = await RootedDirectory.open(
      path.join(
        fixture.workspacePath,
        ...demandFinalRootRef(fixture.testClaimRequest.demandId).split("/"),
      ),
    );
    const aggregate = (
      await new DemandEventSourcingRepository(demandRoot).audit()
    ).aggregate;
    const target = aggregate.state.targetTasks.find(
      (entry) => entry.targetTaskId === fixture.testTargetTaskId,
    );
    equal(target?.phase, "test-result-reported");
    const reviewSnapshot = await readDemandResultReviewSnapshot(demandRoot);
    const reviewTarget = reviewSnapshot.targets.find(
      (entry) => entry.targetTaskId === fixture.testTargetTaskId,
    );
    equal(reviewTarget?.status, "reported");
    if (reviewTarget?.status !== "reported") {
      throw new Error("Expected reported Test review target.");
    }
    equal(reviewTarget.targetResult.workType, "test");
    await demandRoot.close();
    demandRoot = undefined;

    const replayed = await owner.import(
      {
        demandId: fixture.testClaimRequest.demandId,
        actionId: action.actionId,
        observationDigest: outcome.observation.observationDigest,
        report: {
          workType: "test",
          content: reportContent,
        },
      },
      { clock: () => TEST_RESULT_REPORTED_AT },
    );
    equal(replayed.status, "already-recorded");
    equal(replayed.disposition, "idempotent");
    equal(replayed.claimAuthority, "released");
  } finally {
    if (demandRoot !== undefined) await demandRoot.close();
    await cleanupTestHostEffectClaimWorkspaceFixture(fixture);
  }
});
