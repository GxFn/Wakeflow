import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { parseDemandEventStreamRevision } from "../../../src/governance/demand/event-sourcing/demand-event-stream-position.js";
import type { CreateControllerTestReviewDecisionInput } from "../../../src/governance/review/controller-test-review-decision.js";

export const TEST_REVIEW_REPORTED_AT = parseUtcInstant("2026-08-29T12:34:00.000Z");
const PRODUCT_TARGET_TASK_ID = parseWakeflowDurableIdOfKind(
  "target-task_99999999-9999-4999-8999-999999999999",
  "target-task",
);

export function testReviewDecisionBaseInput(): CreateControllerTestReviewDecisionInput {
  return {
    programId: parseWakeflowDurableIdOfKind(
      "program_11111111-1111-4111-8111-111111111111",
      "program",
    ),
    demandId: parseWakeflowDurableIdOfKind("demand_22222222-2222-4222-8222-222222222222", "demand"),
    targetTaskId: parseWakeflowDurableIdOfKind(
      "target-task_33333333-3333-4333-8333-333333333333",
      "target-task",
    ),
    controllerWindowId: parseWakeflowDurableIdOfKind(
      "window_44444444-4444-4444-8444-444444444444",
      "window",
    ),
    reviewed: {
      snapshotDigest: parseSha256Digest(`sha256:${"1".repeat(64)}`),
      reviewUnitDigest: parseSha256Digest(`sha256:${"2".repeat(64)}`),
      stateDigest: parseSha256Digest(`sha256:${"3".repeat(64)}`),
      streamRevision: parseDemandEventStreamRevision(12),
      taskPackageId: parseWakeflowDurableIdOfKind(
        "task-package_55555555-5555-4555-8555-555555555555",
        "task-package",
      ),
      taskPackageDigest: parseSha256Digest(`sha256:${"4".repeat(64)}`),
      targetResultId: parseWakeflowDurableIdOfKind(
        "target-result_66666666-6666-4666-8666-666666666666",
        "target-result",
      ),
      targetResultDigest: parseSha256Digest(`sha256:${"5".repeat(64)}`),
      targetResultOutcome: "completed",
      targetResultReportedAt: TEST_REVIEW_REPORTED_AT,
    },
    testExecution: {
      testAttemptId: parseWakeflowDurableIdOfKind(
        "test-attempt_77777777-7777-4777-8777-777777777777",
        "test-attempt",
      ),
    },
    decision: "accept",
    assessment: { conclusion: "satisfied", evidenceSufficiency: "sufficient" },
    independentChecks: [
      {
        checkId: "controller-test-evidence",
        method: "重新读取逐步Evidence并复验冻结Test问题。",
        outcome: "passed",
        observation: "全部批准步骤的Evidence闭合且未观察到产品缺陷。",
      },
    ],
    rationale: "Controller独立检查已关闭当前真实环境风险。",
    blockingReasons: [],
    residualRisks: ["该决定不替代后续Demand completion检查。"],
    stepIds: null,
    escalation: null,
    resumption: null,
    callbackLanding: null,
    targetCompletion: {
      recordId: "20260829T123430000Z-stop-fixture",
      event: "stop",
      observedAt: parseUtcInstant("2026-08-29T12:34:30.000Z"),
    },
  };
}

export function productDefectEscalation() {
  return {
    classification: "product-defect" as const,
    remediation: {
      affectedTargets: [
        {
          targetTaskId: PRODUCT_TARGET_TASK_ID,
          failedStepIds: ["ts-1"] as const,
          correctionObjective: "在原TaskPackage边界内恢复批准的入口合同。",
        },
      ] as const,
      authorizationRationale: "真实环境Evidence证明已接受实现存在产品缺陷。",
    },
  };
}
