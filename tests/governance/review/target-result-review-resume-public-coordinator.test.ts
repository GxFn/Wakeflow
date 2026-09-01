import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { executeDemandControllerRoutePublicRequest } from "../../../src/governance/controller/demand-controller-route-public-coordinator.js";
import { executeControllerImplementationReviewDecisionPublicRequest } from "../../../src/governance/review/controller-implementation-review-decision-public-coordinator.js";
import { ControllerTestReviewDecisionService } from "../../../src/governance/review/controller-test-review-decision-service.js";
import { executeTargetResultReviewInspectionPublicRequest } from "../../../src/governance/review/target-result-review-inspection-public-coordinator.js";
import {
  parseTargetResultReviewResumePublicRequest,
  TargetResultReviewResumePublicContractError,
} from "../../../src/governance/review/target-result-review-resume-public-contract.js";
import {
  executeTargetResultReviewResumePublicRequest,
  TargetResultReviewResumePublicCoordinatorError,
} from "../../../src/governance/review/target-result-review-resume-public-coordinator.js";
import { controllerImplementationReviewDecisionInput } from "./controller-implementation-review-decision.fixture.js";
import {
  cleanupControllerImplementationReviewDecisionServiceFixture,
  createControllerImplementationReviewDecisionServiceFixture,
} from "./controller-implementation-review-decision-service.fixture.js";
import {
  cleanupControllerTestReviewDecisionServiceFixture,
  createControllerTestReviewDecisionServiceFixture,
} from "./controller-test-review-decision-service.fixture.js";

const IMPLEMENTATION_BLOCKED_AT = parseUtcInstant("2026-08-29T12:15:00.000Z");
const IMPLEMENTATION_RESUMED_AT = parseUtcInstant("2026-08-29T12:20:00.000Z");
const IMPLEMENTATION_ACCEPTED_AT = parseUtcInstant("2026-08-29T12:25:00.000Z");
const TEST_BLOCKED_AT = parseUtcInstant("2026-08-29T12:35:00.000Z");
const TEST_RESUMED_AT = parseUtcInstant("2026-08-29T12:36:00.000Z");

function containsText(value: unknown, needle: string): boolean {
  if (typeof value === "string") return value.includes(needle);
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((entry) => containsText(entry, needle));
}

test("Resume Public Coordinator闭合blocked inspect到第二代Implementation Decision", async () => {
  const fixture =
    await createControllerImplementationReviewDecisionServiceFixture();
  try {
    const reported = await executeTargetResultReviewInspectionPublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
      targetTaskId: fixture.intent.target.targetTaskId,
    });
    if (reported.reviewUnit.status !== "reported") {
      throw new Error("Expected initial reported review unit.");
    }
    const blockedJudgment =
      controllerImplementationReviewDecisionInput("blocked");
    const blocked =
      await executeControllerImplementationReviewDecisionPublicRequest(
        {
          root: fixture.workspacePath,
          demandId: fixture.intent.demandId,
          targetResultId: reported.reviewUnit.targetResult.targetResultId,
          snapshotDigest: reported.snapshotDigest,
          reviewUnitDigest: reported.reviewUnit.reviewUnitDigest,
          decision: blockedJudgment.decision,
          assessment: blockedJudgment.assessment,
          independentChecks: blockedJudgment.independentChecks,
          rationale: blockedJudgment.rationale,
          blockingReasons: blockedJudgment.blockingReasons,
          residualRisks: blockedJudgment.residualRisks,
        },
        {
          decision: {
            clock: () => IMPLEMENTATION_BLOCKED_AT,
            uuidFactory: () => "91919191-9191-4191-8191-919191919191",
          },
        },
      );
    equal(blocked.decision.decision, "blocked");

    const blockedContext =
      await executeTargetResultReviewInspectionPublicRequest({
        root: fixture.workspacePath,
        demandId: fixture.intent.demandId,
        targetTaskId: fixture.intent.target.targetTaskId,
      });
    if (blockedContext.reviewUnit.status !== "review-blocked") {
      throw new Error("Expected current blocked review context.");
    }
    equal(
      blockedContext.reviewUnit.currentBlockedDecision.decision
        .targetReviewDecisionId,
      blocked.decision.targetReviewDecisionId,
    );
    const request = {
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
      targetTaskId: fixture.intent.target.targetTaskId,
      expectedBlockedState: {
        streamRevision: blockedContext.eventStream.streamRevision,
        stateDigest: blockedContext.eventStream.stateDigest,
      },
      resolutionSummary: "用户已补充缺失决定，Controller可以重新执行独立审查。",
    } as const;
    equal(
      Object.isFrozen(parseTargetResultReviewResumePublicRequest(request)),
      true,
    );
    throws(
      () =>
        parseTargetResultReviewResumePublicRequest({
          ...request,
          blockedDecisionId: blocked.decision.targetReviewDecisionId,
        }),
      (error: unknown) =>
        error instanceof TargetResultReviewResumePublicContractError &&
        error.reason === "schema",
    );
    await rejects(
      executeTargetResultReviewResumePublicRequest({
        ...request,
        expectedBlockedState: {
          ...request.expectedBlockedState,
          stateDigest: `sha256:${"0".repeat(64)}`,
        },
      }),
      (error: unknown) =>
        error instanceof TargetResultReviewResumePublicCoordinatorError &&
        error.reason === "resume" &&
        error.causeReason === "review-snapshot" &&
        error.eventAuthority === "unchanged",
    );
    await rejects(
      executeTargetResultReviewResumePublicRequest({
        ...request,
        resolutionSummary: fixture.workspacePath,
      }),
      (error: unknown) =>
        error instanceof TargetResultReviewResumePublicCoordinatorError &&
        error.reason === "privacy" &&
        error.eventAuthority === "unchanged",
    );

    const resumed = await executeTargetResultReviewResumePublicRequest(
      request,
      {
        resume: {
          clock: () => IMPLEMENTATION_RESUMED_AT,
          uuidFactory: () => "92929292-9292-4292-8292-929292929292",
        },
      },
    );
    equal(resumed.status, "resumed");
    equal(resumed.disposition, "committed");
    equal(resumed.eventAuthority, "current");
    equal(
      resumed.resume.blockedDecision.targetReviewDecisionId,
      blocked.decision.targetReviewDecisionId,
    );
    equal(
      resumed.resume.blockedSource.snapshotDigest,
      blockedContext.snapshotDigest,
    );
    equal(containsText(resumed, fixture.workspacePath), false);
    equal(containsText(resumed, fixture.rawHandle), false);

    const route = await executeDemandControllerRoutePublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
    });
    equal(route.route.frontiers[0]?.kind, "implementation-result-review");
    const reopened = await executeTargetResultReviewInspectionPublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
      targetTaskId: fixture.intent.target.targetTaskId,
    });
    if (reopened.reviewUnit.status !== "reported") {
      throw new Error("Expected reopened reported review unit.");
    }
    deepEqual(
      reopened.reviewUnit.priorReviewHistory.map((entry) => entry.kind),
      ["decision", "resume"],
    );

    const acceptJudgment =
      controllerImplementationReviewDecisionInput("accept");
    const accepted =
      await executeControllerImplementationReviewDecisionPublicRequest(
        {
          root: fixture.workspacePath,
          demandId: fixture.intent.demandId,
          targetResultId: reopened.reviewUnit.targetResult.targetResultId,
          snapshotDigest: reopened.snapshotDigest,
          reviewUnitDigest: reopened.reviewUnit.reviewUnitDigest,
          decision: acceptJudgment.decision,
          assessment: acceptJudgment.assessment,
          independentChecks: acceptJudgment.independentChecks,
          rationale: acceptJudgment.rationale,
          blockingReasons: acceptJudgment.blockingReasons,
          residualRisks: acceptJudgment.residualRisks,
        },
        {
          decision: {
            clock: () => IMPLEMENTATION_ACCEPTED_AT,
            uuidFactory: () => "93939393-9393-4393-8393-939393939393",
          },
        },
      );
    equal(accepted.decision.decision, "accept");

    const replayed =
      await executeTargetResultReviewResumePublicRequest(request);
    equal(replayed.status, "already-resumed");
    equal(replayed.disposition, "idempotent");
    equal(
      replayed.resume.targetReviewResumeId,
      resumed.resume.targetReviewResumeId,
    );
    equal(replayed.event.eventId, resumed.event.eventId);
    equal(replayed.stateDigest, resumed.stateDigest);
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});

test("Resume Public Coordinator共享恢复Test review并保留同一Result", async () => {
  const fixture = await createControllerTestReviewDecisionServiceFixture();
  try {
    const blocked = await new ControllerTestReviewDecisionService(
      fixture.workspaceRoot,
    ).decide(
      {
        ...fixture.testDecisionRequest,
        decision: "blocked",
        assessment: {
          conclusion: "inconclusive",
          evidenceSufficiency: "insufficient",
        },
        independentChecks: [
          {
            checkId: "controller-test-external-blocker",
            method: "复验Test Evidence与当前外部确认状态。",
            outcome: "inconclusive",
            observation: "Evidence可读，但缺少用户对环境例外的确认。",
          },
        ],
        rationale: "等待外部确认后重新审阅同一Test Result。",
        blockingReasons: ["用户尚未确认环境例外是否可接受。"],
      },
      {
        clock: () => TEST_BLOCKED_AT,
        uuidFactory: () => "94949494-9494-4494-8494-949494949494",
      },
    );
    const blockedTarget =
      blocked.commandResult.aggregate.state.targetTasks.find(
        (target) => target.targetTaskId === fixture.testTargetTaskId,
      );
    if (blockedTarget?.workType !== "test") {
      throw new Error("Expected blocked Test target.");
    }
    const context = await executeTargetResultReviewInspectionPublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.testClaimRequest.demandId,
      targetTaskId: fixture.testTargetTaskId,
    });
    if (context.reviewUnit.status !== "review-blocked") {
      throw new Error("Expected current blocked Test context.");
    }
    const request = {
      root: fixture.workspacePath,
      demandId: fixture.testClaimRequest.demandId,
      targetTaskId: fixture.testTargetTaskId,
      expectedBlockedState: {
        streamRevision: context.eventStream.streamRevision,
        stateDigest: context.eventStream.stateDigest,
      },
      resolutionSummary:
        "用户已确认环境例外，Controller可以重新审阅同一Result。",
    } as const;
    const resumed = await executeTargetResultReviewResumePublicRequest(
      request,
      {
        resume: {
          clock: () => TEST_RESUMED_AT,
          uuidFactory: () => "95959595-9595-4595-8595-959595959595",
        },
      },
    );
    equal(resumed.status, "resumed");
    const resumedTarget = resumed.resume.targetTaskId;
    equal(resumedTarget, fixture.testTargetTaskId);
    const reopened = await executeTargetResultReviewInspectionPublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.testClaimRequest.demandId,
      targetTaskId: fixture.testTargetTaskId,
    });
    if (
      reopened.reviewUnit.status !== "reported" ||
      reopened.reviewUnit.targetResult.workType !== "test"
    ) {
      throw new Error("Expected reopened Test review unit.");
    }
    equal(
      reopened.reviewUnit.targetResult.testExecution?.testAttemptId,
      context.reviewUnit.targetResult.testExecution?.testAttemptId,
    );
    const route = await executeDemandControllerRoutePublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.testClaimRequest.demandId,
    });
    equal(route.route.frontiers[0]?.kind, "test-result-review");
  } finally {
    await cleanupControllerTestReviewDecisionServiceFixture(fixture);
  }
});
