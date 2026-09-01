import { equal, rejects, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { executeDemandControllerRoutePublicRequest } from "../../../src/governance/controller/demand-controller-route-public-coordinator.js";
import {
  parseControllerTestReviewDecisionPublicRequest,
  ControllerTestReviewDecisionPublicContractError,
} from "../../../src/governance/review/controller-test-review-decision-public-contract.js";
import {
  executeControllerTestReviewDecisionPublicRequest,
  ControllerTestReviewDecisionPublicCoordinatorError,
} from "../../../src/governance/review/controller-test-review-decision-public-coordinator.js";
import { executeTargetResultReviewInspectionPublicRequest } from "../../../src/governance/review/target-result-review-inspection-public-coordinator.js";
import {
  cleanupControllerTestReviewDecisionServiceFixture,
  createControllerTestReviewDecisionServiceFixture,
} from "./controller-test-review-decision-service.fixture.js";

const DECIDED_AT = parseUtcInstant("2026-08-29T12:33:00.000Z");
const DECISION_UUID = "d4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4";

function containsText(value: unknown, needle: string): boolean {
  if (typeof value === "string") return value.includes(needle);
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((entry) => containsText(entry, needle));
}

test("Test Decision Public Coordinator只记录Controller判断并精确幂等", async () => {
  const fixture = await createControllerTestReviewDecisionServiceFixture();
  try {
    const inspection = await executeTargetResultReviewInspectionPublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.testClaimRequest.demandId,
      targetTaskId: fixture.testTargetTaskId,
    });
    if (
      inspection.reviewUnit.status !== "reported" ||
      inspection.reviewUnit.workType !== "test"
    ) {
      throw new Error("Expected one reported Test review unit.");
    }
    const judgment = fixture.testDecisionRequest;
    const request = {
      root: fixture.workspacePath,
      demandId: fixture.testClaimRequest.demandId,
      targetResultId: inspection.reviewUnit.targetResult.targetResultId,
      snapshotDigest: inspection.snapshotDigest,
      reviewUnitDigest: inspection.reviewUnit.reviewUnitDigest,
      decision: judgment.decision,
      assessment: judgment.assessment,
      independentChecks: judgment.independentChecks,
      rationale: judgment.rationale,
      blockingReasons: judgment.blockingReasons,
      residualRisks: judgment.residualRisks,
    };
    const parsed = parseControllerTestReviewDecisionPublicRequest(request);
    equal(Object.isFrozen(parsed), true);
    throws(
      () =>
        parseControllerTestReviewDecisionPublicRequest(new Proxy(request, {})),
      (error: unknown) =>
        error instanceof ControllerTestReviewDecisionPublicContractError &&
        error.reason === "json",
    );
    throws(
      () =>
        parseControllerTestReviewDecisionPublicRequest({
          ...request,
          targetTaskId: fixture.testTargetTaskId,
        }),
      (error: unknown) =>
        error instanceof ControllerTestReviewDecisionPublicContractError &&
        error.reason === "schema",
    );
    throws(
      () =>
        parseControllerTestReviewDecisionPublicRequest({
          ...request,
          rationale: fixture.workspacePath,
        }),
      (error: unknown) =>
        error instanceof ControllerTestReviewDecisionPublicContractError &&
        error.reason === "privacy",
    );

    const decided = await executeControllerTestReviewDecisionPublicRequest(
      request,
      {
        decision: {
          clock: () => DECIDED_AT,
          uuidFactory: () => DECISION_UUID,
        },
      },
    );
    equal(decided.status, "decided");
    equal(decided.disposition, "committed");
    equal(decided.eventAuthority, "current");
    equal(decided.decision.decision, "accept");
    equal(decided.decision.targetTaskId, fixture.testTargetTaskId);
    equal(decided.decision.testExecution.testAttemptId, fixture.testAttemptId);
    equal(
      decided.decision.testExecution.testDispatchPacketDigest,
      fixture.testDispatchPacketDigest,
    );
    equal(containsText(decided, fixture.workspacePath), false);
    equal(containsText(decided, fixture.testRawHandle), false);
    equal(Object.hasOwn(decided, "nextAttempt"), false);
    equal(Object.hasOwn(decided, "productRemediation"), false);

    const route = await executeDemandControllerRoutePublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.testClaimRequest.demandId,
    });
    equal(route.route.frontiers[0]?.kind, "demand-completion-preflight");

    const replayed =
      await executeControllerTestReviewDecisionPublicRequest(request);
    equal(replayed.status, "already-decided");
    equal(replayed.disposition, "idempotent");
    equal(
      replayed.decision.targetReviewDecisionId,
      decided.decision.targetReviewDecisionId,
    );
    equal(replayed.event.eventId, decided.event.eventId);

    await rejects(
      executeControllerTestReviewDecisionPublicRequest({
        ...request,
        decision: "request-another-attempt",
        assessment: {
          conclusion: "inconclusive",
          evidenceSufficiency: "insufficient",
        },
        independentChecks: [
          {
            checkId: "controller-test-inconclusive",
            method: "复验当前Evidence覆盖范围。",
            outcome: "inconclusive",
            observation: "现有Evidence不足以关闭问题。",
          },
        ],
        rationale: "需要另一logical Test attempt。",
        residualRisks: [],
      }),
      (error: unknown) =>
        error instanceof ControllerTestReviewDecisionPublicCoordinatorError &&
        error.reason === "decision" &&
        error.causeReason === "state" &&
        error.eventAuthority === "current",
    );
  } finally {
    await cleanupControllerTestReviewDecisionServiceFixture(fixture);
  }
});
