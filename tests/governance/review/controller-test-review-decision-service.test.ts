import { equal, rejects } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { readDemandPostAcceptanceRoute } from "../../../src/governance/review/demand-post-acceptance-route.js";
import { readDemandResultReviewSnapshot } from "../../../src/governance/review/demand-result-review-snapshot.js";
import {
  ControllerTestReviewDecisionService,
  ControllerTestReviewDecisionServiceError,
} from "../../../src/governance/review/controller-test-review-decision-service.js";
import {
  cleanupControllerTestReviewDecisionServiceFixture,
  createControllerTestReviewDecisionServiceFixture,
} from "./controller-test-review-decision-service.fixture.js";

const DECIDED_AT = parseUtcInstant("2026-08-29T12:35:00.000Z");
const ROLLED_BACK_DECIDED_AT = parseUtcInstant("2026-08-29T12:33:00.000Z");
const DECISION_UUID = "e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5";
const ANOTHER_ATTEMPT_DECISION_UUID = "f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f5";

test("Controller Test Review以Card容量准入并在wall clock回拨时持久化accept决定", async () => {
  const fixture = await createControllerTestReviewDecisionServiceFixture();
  let demandRoot: RootedDirectory | undefined;
  try {
    const service = new ControllerTestReviewDecisionService(
      fixture.workspaceRoot,
    );
    await rejects(
      service.decide({
        ...fixture.testDecisionRequest,
        targetTaskId: fixture.testTargetTaskId,
      }),
      (error: unknown) =>
        error instanceof ControllerTestReviewDecisionServiceError &&
        error.reason === "input" &&
        error.eventAuthority === "unchanged",
    );
    const anotherAttemptRequest = {
      ...fixture.testDecisionRequest,
      decision: "request-another-attempt" as const,
      assessment: {
        conclusion: "inconclusive" as const,
        evidenceSufficiency: "insufficient" as const,
      },
      independentChecks: [
        {
          checkId: "controller-test-inconclusive",
          method: "复验当前Evidence覆盖范围。",
          outcome: "inconclusive" as const,
          observation: "现有Evidence不足以关闭问题。",
        },
      ],
      rationale: "需要另一logical Test attempt。",
    };
    await rejects(
      service.decide(anotherAttemptRequest, {
        clock: () => DECIDED_AT,
        uuidFactory: () => DECISION_UUID,
      }),
      (error: unknown) =>
        error instanceof ControllerTestReviewDecisionServiceError &&
        error.reason === "attempt-capacity" &&
        error.eventAuthority === "unchanged",
    );

    const decided = await service.decide(fixture.testDecisionRequest, {
      clock: () => ROLLED_BACK_DECIDED_AT,
      uuidFactory: () => DECISION_UUID,
    });
    equal(decided.status, "decided");
    equal(decided.disposition, "committed");
    equal(decided.decision.kind, "WakeflowControllerTestReviewDecision");
    equal(decided.decision.decision, "accept");
    equal(decided.decision.decidedAt, ROLLED_BACK_DECIDED_AT);
    equal(decided.decision.testExecution.testAttemptId, fixture.testAttemptId);
    equal(
      decided.decision.testExecution.testDispatchPacketDigest,
      fixture.testDispatchPacketDigest,
    );

    demandRoot = await RootedDirectory.open(
      path.join(
        fixture.workspacePath,
        ...demandFinalRootRef(fixture.testClaimRequest.demandId).split("/"),
      ),
    );
    const repository = new DemandEventSourcingRepository(demandRoot);
    const history = await repository.auditTargetResultHistory();
    const target = history.aggregate.state.targetTasks.find(
      (entry) => entry.targetTaskId === fixture.testTargetTaskId,
    );
    equal(target?.phase, "test-accepted");
    equal(history.targetReviewDecisions.length, 2);
    equal(
      history.targetReviewDecisions.filter(
        (source) =>
          source.decision.kind ===
          "WakeflowControllerImplementationReviewDecision",
      ).length,
      1,
    );
    equal(
      history.targetReviewDecisions.filter(
        (source) =>
          source.decision.kind === "WakeflowControllerTestReviewDecision",
      ).length,
      1,
    );
    equal(
      history.targetReviewDecisions.at(-1)?.decision.kind,
      "WakeflowControllerTestReviewDecision",
    );
    const snapshot = await readDemandResultReviewSnapshot(demandRoot);
    const reviewed = snapshot.targets.find(
      (entry) => entry.targetTaskId === fixture.testTargetTaskId,
    );
    equal(reviewed?.status, "review-decided");
    if (reviewed?.status !== "review-decided") {
      throw new Error("Expected decided Test review target.");
    }
    equal(reviewed.phase, "test-accepted");
    equal(reviewed.reviewDecision.kind, "WakeflowControllerTestReviewDecision");
    await demandRoot.close();
    demandRoot = undefined;

    const route = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.testClaimRequest.demandId,
    );
    equal(route.nextStage.status, "completion-preflight");
    if (
      route.nextStage.status !== "completion-preflight" ||
      route.nextStage.testingClosure.mode !== "real-environment"
    ) {
      throw new Error("Expected real-environment completion preflight.");
    }
    equal(
      route.nextStage.testingClosure.testReview.targetReviewDecisionId,
      decided.decision.targetReviewDecisionId,
    );

    const replayed = await service.decide(fixture.testDecisionRequest, {
      clock: () => ROLLED_BACK_DECIDED_AT,
      uuidFactory: () => DECISION_UUID,
    });
    equal(replayed.status, "already-decided");
    equal(replayed.disposition, "idempotent");
    equal(replayed.decision.decisionDigest, decided.decision.decisionDigest);
    await rejects(
      service.decide(anotherAttemptRequest, {
        clock: () => DECIDED_AT,
        uuidFactory: () => ANOTHER_ATTEMPT_DECISION_UUID,
      }),
      (error: unknown) =>
        error instanceof ControllerTestReviewDecisionServiceError &&
        error.reason === "state" &&
        error.eventAuthority === "current",
    );
  } finally {
    if (demandRoot !== undefined) await demandRoot.close();
    await cleanupControllerTestReviewDecisionServiceFixture(fixture);
  }
});

test("Controller Test Review仅在Card容量可用时授权另一attempt planning", async () => {
  const fixture = await createControllerTestReviewDecisionServiceFixture({
    maxAttempts: 2,
  });
  try {
    const decided = await new ControllerTestReviewDecisionService(
      fixture.workspaceRoot,
    ).decide(
      {
        ...fixture.testDecisionRequest,
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
            observation: "现有Evidence不足以关闭冻结Test问题。",
          },
        ],
        rationale: "需要另一logical Test attempt补齐Evidence。",
      },
      {
        clock: () => DECIDED_AT,
        uuidFactory: () => ANOTHER_ATTEMPT_DECISION_UUID,
      },
    );
    equal(decided.decision.decision, "request-another-attempt");

    const route = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.testClaimRequest.demandId,
    );
    equal(route.nextStage.status, "test-another-attempt-planning");
    if (route.nextStage.status !== "test-another-attempt-planning") {
      throw new Error("Expected explicit another Test attempt route.");
    }
    equal(
      route.nextStage.testReview.targetReviewDecisionId,
      decided.decision.targetReviewDecisionId,
    );
    equal(
      route.nextStage.testReview.targetResultId,
      decided.decision.reviewed.targetResultId,
    );
    equal(Object.hasOwn(route.nextStage, "nextAttempt"), false);
    equal(Object.hasOwn(route.nextStage, "replacementDelivery"), false);
  } finally {
    await cleanupControllerTestReviewDecisionServiceFixture(fixture);
  }
});
