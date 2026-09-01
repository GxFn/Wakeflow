import { equal } from "node:assert/strict";
import { test } from "node:test";

import {
  WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_REQUEST_SCHEMA,
  type WakeflowControllerImplementationReviewDecisionRequestV1 as DecisionRequestWire,
} from "../../../src/contracts/generated/entrypoints/wakeflow-controller-implementation-review-decision-request.generated.js";
import {
  WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_RESULT_SCHEMA,
  type WakeflowControllerImplementationReviewDecisionResultV1 as DecisionResultWire,
} from "../../../src/contracts/generated/entrypoints/wakeflow-controller-implementation-review-decision-result.generated.js";
import {
  WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_REQUEST_SCHEMA,
  type WakeflowTargetResultReviewInspectionRequestV1 as InspectionRequestWire,
} from "../../../src/contracts/generated/entrypoints/wakeflow-target-result-review-inspection-request.generated.js";
import {
  WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_RESULT_SCHEMA,
  type WakeflowTargetResultReviewInspectionResultV1 as InspectionResultWire,
} from "../../../src/contracts/generated/entrypoints/wakeflow-target-result-review-inspection-result.generated.js";
import { createRuntimeJsonSchemaValidator } from "../../../src/foundation/schema/runtime-json-schema.js";
import {
  controllerImplementationReviewDecisionInput,
  createControllerImplementationReviewDecisionFixture,
} from "./controller-implementation-review-decision.fixture.js";
import { createTargetResultFixture } from "../result/target-result.fixture.js";
import { createTaskPackageFixture } from "../tasking/task-package.fixture.js";

const validateInspectionRequest =
  createRuntimeJsonSchemaValidator<InspectionRequestWire>(
    WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_REQUEST_SCHEMA,
  );
const validateInspectionResult =
  createRuntimeJsonSchemaValidator<InspectionResultWire>(
    WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_RESULT_SCHEMA,
  );
const validateDecisionRequest =
  createRuntimeJsonSchemaValidator<DecisionRequestWire>(
    WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_REQUEST_SCHEMA,
  );
const validateDecisionResult =
  createRuntimeJsonSchemaValidator<DecisionResultWire>(
    WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_RESULT_SCHEMA,
  );

const DIGEST = `sha256:${"0".repeat(64)}`;
const EVENT_ID = "demand-event_99999999-9999-4999-8999-999999999999";
const COMMIT_ID = "demand-event-commit_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function sourceEvent(streamRevision: number) {
  return { eventId: EVENT_ID, eventDigest: DIGEST, streamRevision } as const;
}

function inspectionResult() {
  const taskPackage = createTaskPackageFixture();
  const targetResult = createTargetResultFixture();
  return {
    kind: "WakeflowTargetResultReviewInspectionResult",
    schemaVersion: 1,
    tool: "wakeflow_inspect_target_result_review",
    status: "current",
    demand: {
      demandId: taskPackage.demandId,
      lifecycle: "active",
    },
    eventStream: {
      commitSequence: 6,
      streamRevision: 6,
      lastCommitDigest: DIGEST,
      lastEventId: EVENT_ID,
      lastEventDigest: DIGEST,
      stateDigest: DIGEST,
    },
    snapshotDigest: DIGEST,
    reviewUnit: {
      status: "reported",
      workType: "implementation",
      targetTaskId: taskPackage.targetTaskId,
      outcome: targetResult.report.outcome,
      taskPackageSourceEvent: sourceEvent(1),
      taskPackage,
      targetResultSourceEvent: sourceEvent(6),
      targetResult,
      priorReviewHistory: [],
      reviewUnitDigest: DIGEST,
    },
  } as const;
}

function decisionRequest(
  decisionType: "accept" | "blocked" | "redesign" | "rework" = "accept",
) {
  const input = controllerImplementationReviewDecisionInput(decisionType);
  return {
    root: "/workspace",
    demandId: input.demandId,
    targetResultId: input.reviewed.targetResultId,
    snapshotDigest: input.reviewed.snapshotDigest,
    reviewUnitDigest: input.reviewed.reviewUnitDigest,
    decision: input.decision,
    assessment: input.assessment,
    independentChecks: input.independentChecks,
    rationale: input.rationale,
    blockingReasons: input.blockingReasons,
    residualRisks: input.residualRisks,
  } as const;
}

function decisionResult() {
  return {
    kind: "WakeflowControllerImplementationReviewDecisionResult",
    schemaVersion: 1,
    tool: "wakeflow_record_controller_implementation_review_decision",
    status: "decided",
    disposition: "committed",
    eventAuthority: "current",
    decision: createControllerImplementationReviewDecisionFixture(),
    event: { eventId: EVENT_ID, streamRevision: 9 },
    commit: {
      commitId: COMMIT_ID,
      commitSequence: 9,
      commitDigest: DIGEST,
    },
    stateDigest: DIGEST,
  } as const;
}

test("Review Inspector wire返回closed review input而不产生Decision", () => {
  const result = inspectionResult();
  equal(
    validateInspectionRequest({
      root: "/workspace",
      demandId: result.demand.demandId,
      targetTaskId: result.reviewUnit.targetTaskId,
    }).ok,
    true,
  );
  equal(validateInspectionResult(result).ok, true);
  equal(
    validateInspectionResult({ ...result, allowedDecisions: ["accept"] }).ok,
    false,
  );
  equal(validateInspectionResult({ ...result, decision: "accept" }).ok, false);
});

test("Implementation Decision Request保持四类judgment关系且不接受Target echo", () => {
  for (const decision of ["accept", "blocked", "redesign", "rework"] as const) {
    equal(validateDecisionRequest(decisionRequest(decision)).ok, true);
  }
  const request = decisionRequest();
  equal(
    validateDecisionRequest({
      ...request,
      targetTaskId: createTaskPackageFixture().targetTaskId,
    }).ok,
    false,
  );
  equal(
    validateDecisionRequest({
      ...request,
      independentChecks: [
        {
          ...request.independentChecks[0],
          outcome: "failed",
        },
      ],
    }).ok,
    false,
  );
});

test("Implementation Decision Result关闭status/disposition且只返回Event回执", () => {
  const result = decisionResult();
  equal(validateDecisionResult(result).ok, true);
  equal(
    validateDecisionResult({
      ...result,
      status: "already-decided",
      disposition: "idempotent",
    }).ok,
    true,
  );
  equal(
    validateDecisionResult({ ...result, disposition: "idempotent" }).ok,
    false,
  );
  equal(
    validateDecisionResult({ ...result, nextAction: "complete" }).ok,
    false,
  );
  equal(validateDecisionResult({ ...result, root: "/workspace" }).ok, false);
});
