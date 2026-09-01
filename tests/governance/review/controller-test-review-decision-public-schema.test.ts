import { equal } from "node:assert/strict";
import { test } from "node:test";

import {
  WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_REQUEST_SCHEMA,
  type WakeflowControllerTestReviewDecisionRequestV1 as DecisionRequestWire,
} from "../../../src/contracts/generated/entrypoints/wakeflow-controller-test-review-decision-request.generated.js";
import {
  WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_RESULT_SCHEMA,
  type WakeflowControllerTestReviewDecisionResultV1 as DecisionResultWire,
} from "../../../src/contracts/generated/entrypoints/wakeflow-controller-test-review-decision-result.generated.js";
import { createRuntimeJsonSchemaValidator } from "../../../src/foundation/schema/runtime-json-schema.js";

const validateRequest = createRuntimeJsonSchemaValidator<DecisionRequestWire>(
  WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_REQUEST_SCHEMA,
);
const validateResult = createRuntimeJsonSchemaValidator<DecisionResultWire>(
  WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_RESULT_SCHEMA,
);

const DIGEST = `sha256:${"0".repeat(64)}`;
const TARGET_RESULT_ID = "target-result_11111111-1111-4111-8111-111111111111";

function judgment(
  decision:
    | "accept"
    | "request-another-attempt"
    | "escalate-product-defect"
    | "blocked",
) {
  if (decision === "accept") {
    return {
      decision,
      assessment: {
        conclusion: "satisfied",
        evidenceSufficiency: "sufficient",
      },
      independentChecks: [
        {
          checkId: "test-evidence",
          method: "复验全部批准步骤的Evidence。",
          outcome: "passed",
          observation: "全部冻结步骤均有闭合Evidence。",
        },
      ],
      rationale: "Controller独立检查已关闭当前Test风险。",
      blockingReasons: [],
      residualRisks: ["Decision不自动完成Demand。"],
    } as const;
  }
  if (decision === "request-another-attempt") {
    return {
      decision,
      assessment: {
        conclusion: "inconclusive",
        evidenceSufficiency: "insufficient",
      },
      independentChecks: [
        {
          checkId: "missing-evidence",
          method: "复验当前Evidence覆盖范围。",
          outcome: "inconclusive",
          observation: "当前Evidence不足以关闭冻结Test问题。",
        },
      ],
      rationale: "需要另一logical Test attempt。",
      blockingReasons: [],
      residualRisks: [],
    } as const;
  }
  if (decision === "escalate-product-defect") {
    return {
      decision,
      assessment: {
        conclusion: "defect-observed",
        evidenceSufficiency: "sufficient",
      },
      independentChecks: [
        {
          checkId: "product-defect",
          method: "复验真实环境产品行为。",
          outcome: "failed",
          observation: "冻结实现基线稳定复现产品缺陷。",
        },
      ],
      rationale: "缺陷应进入独立产品修复授权。",
      blockingReasons: [],
      residualRisks: ["修复后仍需新Test代际。"],
    } as const;
  }
  return {
    decision,
    assessment: {
      conclusion: "inconclusive",
      evidenceSufficiency: "insufficient",
    },
    independentChecks: [
      {
        checkId: "external-blocker",
        method: "复验外部环境前置条件。",
        outcome: "inconclusive",
        observation: "当前缺少Controller可解决的外部输入。",
      },
    ],
    rationale: "必须等待明确外部输入。",
    blockingReasons: ["外部环境不可用。"],
    residualRisks: [],
  } as const;
}

function request(decision: Parameters<typeof judgment>[0] = "accept") {
  return {
    root: "/workspace",
    demandId: "demand_22222222-2222-4222-8222-222222222222",
    targetResultId: TARGET_RESULT_ID,
    snapshotDigest: DIGEST,
    reviewUnitDigest: DIGEST,
    ...judgment(decision),
  } as const;
}

function result() {
  return {
    kind: "WakeflowControllerTestReviewDecisionResult",
    schemaVersion: 1,
    tool: "wakeflow_record_controller_test_review_decision",
    status: "decided",
    disposition: "committed",
    eventAuthority: "current",
    decision: {
      kind: "WakeflowControllerTestReviewDecision",
      schemaVersion: 1,
      targetReviewDecisionId:
        "target-review-decision_33333333-3333-4333-8333-333333333333",
      programId: "program_44444444-4444-4444-8444-444444444444",
      demandId: request().demandId,
      targetTaskId: "target-task_55555555-5555-4555-8555-555555555555",
      controllerWindowId: "window_66666666-6666-4666-8666-666666666666",
      reviewed: {
        snapshotDigest: DIGEST,
        reviewUnitDigest: DIGEST,
        stateDigest: DIGEST,
        streamRevision: 8,
        taskPackageId: "task-package_77777777-7777-4777-8777-777777777777",
        taskPackageDigest: DIGEST,
        targetResultId: TARGET_RESULT_ID,
        targetResultDigest: DIGEST,
        targetResultOutcome: "completed",
        targetResultReportedAt: "2026-08-29T12:34:00.000Z",
      },
      testExecution: {
        testAttemptId: "test-attempt_88888888-8888-4888-8888-888888888888",
        testCard: {
          testCardId: "test-card_99999999-9999-4999-8999-999999999999",
          testCardDigest: DIGEST,
        },
        testDispatchPacketDigest: DIGEST,
      },
      ...judgment("accept"),
      decidedAt: "2026-08-29T12:33:00.000Z",
      decisionDigest: DIGEST,
    },
    event: {
      eventId: "demand-event_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      streamRevision: 9,
    },
    commit: {
      commitId: "demand-event-commit_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      commitSequence: 9,
      commitDigest: DIGEST,
    },
    stateDigest: DIGEST,
  } as const;
}

test("Test Decision Request保持四类judgment且只接受Result selector", () => {
  for (const decision of [
    "accept",
    "request-another-attempt",
    "escalate-product-defect",
    "blocked",
  ] as const) {
    equal(validateRequest(request(decision)).ok, true);
  }
  equal(
    validateRequest({
      ...request(),
      targetTaskId: "target-task_55555555-5555-4555-8555-555555555555",
    }).ok,
    false,
  );
  const defect = request("escalate-product-defect");
  equal(
    validateRequest({
      ...defect,
      independentChecks: [
        { ...defect.independentChecks[0], outcome: "passed" },
      ],
    }).ok,
    false,
  );
});

test("Test Decision Result关闭状态关系、Test lineage与Event回执", () => {
  const value = result();
  equal(validateResult(value).ok, true);
  equal(
    validateResult({
      ...value,
      status: "already-decided",
      disposition: "idempotent",
    }).ok,
    true,
  );
  equal(validateResult({ ...value, disposition: "idempotent" }).ok, false);
  const { testExecution: _testExecution, ...decisionWithoutTest } =
    value.decision;
  equal(validateResult({ ...value, decision: decisionWithoutTest }).ok, false);
  equal(validateResult({ ...value, nextAction: "complete" }).ok, false);
  equal(validateResult({ ...value, root: "/workspace" }).ok, false);
});
