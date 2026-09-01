import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_RESULT_SCHEMA,
  type WakeflowTargetResultReviewInspectionResultV1 as InspectionResultWire,
} from "../../../src/contracts/generated/entrypoints/wakeflow-target-result-review-inspection-result.generated.js";
import type { JsonValue } from "../../../src/foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../../src/foundation/schema/runtime-json-schema.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { ControllerImplementationReviewDecisionService } from "../../../src/governance/review/controller-implementation-review-decision-service.js";
import { ControllerTestReviewDecisionService } from "../../../src/governance/review/controller-test-review-decision-service.js";
import {
  parseTargetResultReviewInspectionPublicRequest,
  TargetResultReviewInspectionPublicContractError,
} from "../../../src/governance/review/target-result-review-inspection-public-contract.js";
import {
  executeTargetResultReviewInspectionPublicRequest,
  TargetResultReviewInspectionPublicCoordinatorError,
} from "../../../src/governance/review/target-result-review-inspection-public-coordinator.js";
import {
  cleanupControllerImplementationReviewDecisionServiceFixture,
  createControllerImplementationReviewDecisionServiceFixture,
  readControllerImplementationReviewDecisionServiceSnapshot,
} from "./controller-implementation-review-decision-service.fixture.js";
import {
  cleanupControllerTestReviewDecisionServiceFixture,
  createControllerTestReviewDecisionServiceFixture,
} from "./controller-test-review-decision-service.fixture.js";
import { controllerImplementationReviewDecisionInput } from "./controller-implementation-review-decision.fixture.js";

const validateResult = createRuntimeJsonSchemaValidator<InspectionResultWire>(
  WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_RESULT_SCHEMA,
);
const IMPLEMENTATION_BLOCKED_AT = parseUtcInstant("2026-08-29T12:15:00.000Z");
const TEST_BLOCKED_AT = parseUtcInstant("2026-08-29T12:35:00.000Z");

function containsText(value: unknown, needle: string): boolean {
  if (typeof value === "string") return value.includes(needle);
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((entry) => containsText(entry, needle));
}

test("Review Inspector返回当前Implementation reported unit且保持零写", async () => {
  const fixture =
    await createControllerImplementationReviewDecisionServiceFixture();
  try {
    const target = fixture.reviewSnapshot.targets[0];
    if (target?.status !== "reported") {
      throw new Error("Expected reported implementation target fixture.");
    }
    const request = {
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
      targetTaskId: fixture.intent.target.targetTaskId,
    };
    const parsed = parseTargetResultReviewInspectionPublicRequest(request);
    equal(Object.isFrozen(parsed), true);
    throws(
      () =>
        parseTargetResultReviewInspectionPublicRequest(new Proxy(request, {})),
      (error: unknown) =>
        error instanceof TargetResultReviewInspectionPublicContractError &&
        error.reason === "json",
    );
    const inspected =
      await executeTargetResultReviewInspectionPublicRequest(request);
    equal(inspected.status, "current");
    equal(inspected.reviewUnit.status, "reported");
    equal(inspected.reviewUnit.workType, "implementation");
    equal(inspected.reviewUnit.targetResult.workType, "implementation");
    equal(
      inspected.reviewUnit.taskPackage.taskPackageId,
      target.taskPackage.taskPackageId,
    );
    equal(
      inspected.reviewUnit.targetResult.resultDigest,
      target.targetResult.resultDigest,
    );
    equal(inspected.reviewUnit.reviewUnitDigest, target.reviewUnitDigest);
    equal(inspected.snapshotDigest, fixture.reviewSnapshot.snapshotDigest);
    equal(containsText(inspected, fixture.workspacePath), false);
    equal(containsText(inspected, fixture.rawHandle), false);
    deepEqual(
      await readControllerImplementationReviewDecisionServiceSnapshot(fixture),
      fixture.reviewSnapshot,
    );

    await new ControllerImplementationReviewDecisionService(
      fixture.workspaceRoot,
    ).decide(fixture.decisionRequest);
    await rejects(
      executeTargetResultReviewInspectionPublicRequest(request),
      (error: unknown) =>
        error instanceof TargetResultReviewInspectionPublicCoordinatorError &&
        error.reason === "inspection",
    );
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});

test("Review Inspector共享返回当前Test reported unit但不产生verdict", async () => {
  const fixture = await createControllerTestReviewDecisionServiceFixture();
  try {
    const target = fixture.reviewSnapshot.targets.find(
      (entry) => entry.targetTaskId === fixture.testTargetTaskId,
    );
    if (target?.status !== "reported") {
      throw new Error("Expected reported Test target fixture.");
    }
    const inspected = await executeTargetResultReviewInspectionPublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.testClaimRequest.demandId,
      targetTaskId: fixture.testTargetTaskId,
    });
    equal(inspected.reviewUnit.workType, "test");
    equal(inspected.reviewUnit.taskPackage.workType, "test");
    equal(inspected.reviewUnit.targetResult.workType, "test");
    equal(inspected.reviewUnit.reviewUnitDigest, target.reviewUnitDigest);
    equal(Object.hasOwn(inspected, "decision"), false);
    equal(Object.hasOwn(inspected, "allowedDecisions"), false);
    equal(Object.hasOwn(inspected, "verdict"), false);
  } finally {
    await cleanupControllerTestReviewDecisionServiceFixture(fixture);
  }
});

test("Review Inspector返回当前Implementation blocked Decision与恢复CAS基线", async () => {
  const fixture =
    await createControllerImplementationReviewDecisionServiceFixture();
  try {
    const judgment = controllerImplementationReviewDecisionInput("blocked");
    const blocked = await new ControllerImplementationReviewDecisionService(
      fixture.workspaceRoot,
    ).decide(
      {
        ...fixture.decisionRequest,
        decision: judgment.decision,
        assessment: judgment.assessment,
        independentChecks: judgment.independentChecks,
        rationale: judgment.rationale,
        blockingReasons: judgment.blockingReasons,
        residualRisks: judgment.residualRisks,
      },
      {
        clock: () => IMPLEMENTATION_BLOCKED_AT,
        uuidFactory: () => "81818181-8181-4181-8181-818181818181",
      },
    );
    const blockedSnapshot =
      await readControllerImplementationReviewDecisionServiceSnapshot(fixture);
    const inspected = await executeTargetResultReviewInspectionPublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
      targetTaskId: fixture.intent.target.targetTaskId,
    });
    equal(inspected.reviewUnit.status, "review-blocked");
    if (inspected.reviewUnit.status !== "review-blocked") {
      throw new Error("Expected current blocked implementation review unit.");
    }
    equal(inspected.reviewUnit.workType, "implementation");
    equal(
      inspected.reviewUnit.currentBlockedDecision.decision.workType,
      "implementation",
    );
    equal(
      inspected.reviewUnit.currentBlockedDecision.decision.decision,
      "blocked",
    );
    equal(
      inspected.reviewUnit.currentBlockedDecision.decision
        .targetReviewDecisionId,
      blocked.decision.targetReviewDecisionId,
    );
    equal(
      inspected.reviewUnit.currentBlockedDecision.sourceEvent.eventId,
      blocked.commandResult.commit.events[0]?.eventId,
    );
    equal(
      inspected.eventStream.streamRevision,
      blockedSnapshot.eventStream.streamRevision,
    );
    equal(
      inspected.eventStream.stateDigest,
      blockedSnapshot.eventStream.stateDigest,
    );
    equal(inspected.snapshotDigest, blockedSnapshot.snapshotDigest);
    equal(inspected.reviewUnit.priorReviewHistory.length, 0);
    equal(containsText(inspected, fixture.workspacePath), false);
    equal(containsText(inspected, fixture.rawHandle), false);
    deepEqual(
      await readControllerImplementationReviewDecisionServiceSnapshot(fixture),
      blockedSnapshot,
    );
    equal(validateResult(inspected as unknown as JsonValue).ok, true);
    const forged = structuredClone(inspected) as unknown as {
      reviewUnit: {
        currentBlockedDecision: { decision: { decision: string } };
      };
    };
    forged.reviewUnit.currentBlockedDecision.decision.decision = "accept";
    equal(validateResult(forged as unknown as JsonValue).ok, false);
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});

test("Review Inspector共享返回当前Test blocked Decision与同一Result", async () => {
  const fixture = await createControllerTestReviewDecisionServiceFixture();
  try {
    const beforeTarget = fixture.reviewSnapshot.targets.find(
      (entry) => entry.targetTaskId === fixture.testTargetTaskId,
    );
    if (beforeTarget?.status !== "reported") {
      throw new Error("Expected reported Test review fixture.");
    }
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
        uuidFactory: () => "82828282-8282-4282-8282-828282828282",
      },
    );
    const inspected = await executeTargetResultReviewInspectionPublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.testClaimRequest.demandId,
      targetTaskId: fixture.testTargetTaskId,
    });
    equal(inspected.reviewUnit.status, "review-blocked");
    if (inspected.reviewUnit.status !== "review-blocked") {
      throw new Error("Expected current blocked Test review unit.");
    }
    equal(inspected.reviewUnit.workType, "test");
    equal(
      inspected.reviewUnit.currentBlockedDecision.decision.workType,
      "test",
    );
    equal(
      inspected.reviewUnit.currentBlockedDecision.decision.decision,
      "blocked",
    );
    equal(
      inspected.reviewUnit.currentBlockedDecision.decision
        .targetReviewDecisionId,
      blocked.decision.targetReviewDecisionId,
    );
    equal(
      inspected.reviewUnit.targetResult.targetResultId,
      beforeTarget.targetResult.targetResultId,
    );
    equal(
      inspected.reviewUnit.targetResult.testExecution?.testAttemptId,
      beforeTarget.targetResult.testExecution?.testAttemptId,
    );
    equal(validateResult(inspected as unknown as JsonValue).ok, true);
  } finally {
    await cleanupControllerTestReviewDecisionServiceFixture(fixture);
  }
});
