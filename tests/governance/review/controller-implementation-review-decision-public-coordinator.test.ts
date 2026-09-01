import { equal, rejects, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { executeDemandControllerRoutePublicRequest } from "../../../src/governance/controller/demand-controller-route-public-coordinator.js";
import {
  parseControllerImplementationReviewDecisionPublicRequest,
  ControllerImplementationReviewDecisionPublicContractError,
} from "../../../src/governance/review/controller-implementation-review-decision-public-contract.js";
import {
  executeControllerImplementationReviewDecisionPublicRequest,
  ControllerImplementationReviewDecisionPublicCoordinatorError,
} from "../../../src/governance/review/controller-implementation-review-decision-public-coordinator.js";
import { controllerImplementationReviewDecisionInput } from "./controller-implementation-review-decision.fixture.js";
import {
  cleanupControllerImplementationReviewDecisionServiceFixture,
  createControllerImplementationReviewDecisionServiceFixture,
} from "./controller-implementation-review-decision-service.fixture.js";
import { executeTargetResultReviewInspectionPublicRequest } from "../../../src/governance/review/target-result-review-inspection-public-coordinator.js";

const DECIDED_AT = parseUtcInstant("2026-08-29T12:15:00.000Z");
const DECISION_UUID = "f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1";

function containsText(value: unknown, needle: string): boolean {
  if (typeof value === "string") return value.includes(needle);
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((entry) => containsText(entry, needle));
}

test("Decision Public Coordinator只记录Controller独立判断并精确幂等", async () => {
  const fixture =
    await createControllerImplementationReviewDecisionServiceFixture();
  try {
    const inspection = await executeTargetResultReviewInspectionPublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
      targetTaskId: fixture.intent.target.targetTaskId,
    });
    const judgment = controllerImplementationReviewDecisionInput("accept");
    const request = {
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
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
    const parsed =
      parseControllerImplementationReviewDecisionPublicRequest(request);
    equal(Object.isFrozen(parsed), true);
    throws(
      () =>
        parseControllerImplementationReviewDecisionPublicRequest(
          new Proxy(request, {}),
        ),
      (error: unknown) =>
        error instanceof
          ControllerImplementationReviewDecisionPublicContractError &&
        error.reason === "json",
    );
    throws(
      () =>
        parseControllerImplementationReviewDecisionPublicRequest({
          ...request,
          targetTaskId: fixture.intent.target.targetTaskId,
        }),
      (error: unknown) =>
        error instanceof
          ControllerImplementationReviewDecisionPublicContractError &&
        error.reason === "schema",
    );
    throws(
      () =>
        parseControllerImplementationReviewDecisionPublicRequest({
          ...request,
          rationale: fixture.workspacePath,
        }),
      (error: unknown) =>
        error instanceof
          ControllerImplementationReviewDecisionPublicContractError &&
        error.reason === "privacy",
    );

    const decided =
      await executeControllerImplementationReviewDecisionPublicRequest(
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
    equal(decided.decision.targetTaskId, fixture.intent.target.targetTaskId);
    equal(
      decided.decision.reviewed.targetResultId,
      inspection.reviewUnit.targetResult.targetResultId,
    );
    equal(
      decided.decision.controllerWindowId === fixture.intent.route.windowId,
      false,
    );
    equal(containsText(decided, fixture.workspacePath), false);
    equal(containsText(decided, fixture.rawHandle), false);

    const route = await executeDemandControllerRoutePublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
    });
    equal(route.route.frontiers[0]?.kind, "demand-completion-preflight");

    const replayed =
      await executeControllerImplementationReviewDecisionPublicRequest(request);
    equal(replayed.status, "already-decided");
    equal(
      replayed.decision.targetReviewDecisionId,
      decided.decision.targetReviewDecisionId,
    );
    equal(replayed.event.eventId, decided.event.eventId);

    const rework = controllerImplementationReviewDecisionInput("rework");
    await rejects(
      executeControllerImplementationReviewDecisionPublicRequest({
        ...request,
        decision: rework.decision,
        assessment: rework.assessment,
        independentChecks: rework.independentChecks,
        rationale: rework.rationale,
        blockingReasons: rework.blockingReasons,
        residualRisks: rework.residualRisks,
      }),
      (error: unknown) =>
        error instanceof
          ControllerImplementationReviewDecisionPublicCoordinatorError &&
        error.reason === "decision" &&
        error.causeReason === "state" &&
        error.eventAuthority === "current",
    );
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});
