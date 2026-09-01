import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { parseDemandEventStreamRevision } from "../../../src/governance/demand/event-sourcing/demand-event-stream-position.js";
import {
  controllerTestReviewDecisionCommitId,
  controllerTestReviewDecisionEventId,
  createControllerTestReviewDecision,
  parseControllerTestReviewDecisionDocument,
  renderControllerTestReviewDecision,
  ControllerTestReviewDecisionError,
  type CreateControllerTestReviewDecisionInput,
} from "../../../src/governance/review/controller-test-review-decision.js";

const REPORTED_AT = parseUtcInstant("2026-08-29T12:34:00.000Z");
const DECIDED_AT = parseUtcInstant("2026-08-29T12:35:00.000Z");
const ROLLED_BACK_AT = parseUtcInstant("2026-08-29T12:33:00.000Z");
const DECISION_UUID = "e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5";
const EQUAL_TIME_DECISION_UUID = "e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6";
const ROLLBACK_DECISION_UUID = "e7e7e7e7-e7e7-47e7-87e7-e7e7e7e7e7e7";

function baseInput(): CreateControllerTestReviewDecisionInput {
  return {
    programId: parseWakeflowDurableIdOfKind(
      "program_11111111-1111-4111-8111-111111111111",
      "program",
    ),
    demandId: parseWakeflowDurableIdOfKind(
      "demand_22222222-2222-4222-8222-222222222222",
      "demand",
    ),
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
      targetResultReportedAt: REPORTED_AT,
    },
    testExecution: {
      testAttemptId: parseWakeflowDurableIdOfKind(
        "test-attempt_77777777-7777-4777-8777-777777777777",
        "test-attempt",
      ),
      testCard: {
        testCardId: parseWakeflowDurableIdOfKind(
          "test-card_88888888-8888-4888-8888-888888888888",
          "test-card",
        ),
        testCardDigest: parseSha256Digest(`sha256:${"6".repeat(64)}`),
      },
      testDispatchPacketDigest: parseSha256Digest(`sha256:${"7".repeat(64)}`),
    },
    decision: "accept",
    assessment: {
      conclusion: "satisfied",
      evidenceSufficiency: "sufficient",
    },
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
  };
}

function createDecision(input: CreateControllerTestReviewDecisionInput) {
  return createControllerTestReviewDecision(input, {
    clock: () => DECIDED_AT,
    uuidFactory: () => DECISION_UUID,
  });
}

test("ControllerTestReviewDecision接受完整Evidence但不自动完成Demand", () => {
  const decision = createDecision(baseInput());
  equal(decision.kind, "WakeflowControllerTestReviewDecision");
  equal(decision.decision, "accept");
  equal(Object.hasOwn(decision, "demandCompletion"), false);
  equal(
    controllerTestReviewDecisionEventId(decision),
    `demand-event_${DECISION_UUID}`,
  );
  equal(
    controllerTestReviewDecisionCommitId(decision),
    `demand-event-commit_${DECISION_UUID}`,
  );
  equal(
    parseControllerTestReviewDecisionDocument(
      renderControllerTestReviewDecision(decision),
    ).decisionDigest,
    decision.decisionDigest,
  );
});

test("ControllerTestReviewDecision区分另一次attempt、产品缺陷与阻塞", () => {
  const base = baseInput();
  const anotherAttempt = createDecision({
    ...base,
    reviewed: {
      ...base.reviewed,
      targetResultOutcome: "needs-review",
    },
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
        observation: "环境读取中断，现有Evidence不足以关闭问题。",
      },
    ],
    rationale: "需要后续owner规划另一logical Test attempt。",
  });
  equal(anotherAttempt.decision, "request-another-attempt");
  equal(Object.hasOwn(anotherAttempt, "nextAttempt"), false);

  const productDefect = createDecision({
    ...base,
    reviewed: {
      ...base.reviewed,
      targetResultOutcome: "needs-review",
    },
    decision: "escalate-product-defect",
    assessment: {
      conclusion: "defect-observed",
      evidenceSufficiency: "sufficient",
    },
    independentChecks: [
      {
        checkId: "controller-product-defect",
        method: "独立复现Test Evidence中的产品行为。",
        outcome: "failed",
        observation: "已接受实现在线上等价环境稳定复现缺陷。",
      },
    ],
    rationale: "保留Evidence并升级到产品remediation，不重派Test。",
  });
  equal(productDefect.decision, "escalate-product-defect");
  equal(Object.hasOwn(productDefect, "productMutation"), false);

  const blocked = createDecision({
    ...base,
    reviewed: {
      ...base.reviewed,
      targetResultOutcome: "blocked",
    },
    decision: "blocked",
    assessment: {
      conclusion: "inconclusive",
      evidenceSufficiency: "insufficient",
    },
    independentChecks: [
      {
        checkId: "controller-environment-blocked",
        method: "复核Test环境访问边界。",
        outcome: "inconclusive",
        observation: "外部环境当前不可访问。",
      },
    ],
    rationale: "等待外部环境事实。",
    blockingReasons: ["Test环境所有者尚未恢复访问。"],
  });
  equal(blocked.decision, "blocked");
});

test("ControllerTestReviewDecision拒绝矛盾结论并允许wall clock重复或回拨", () => {
  const base = baseInput();
  throws(
    () =>
      createDecision({
        ...base,
        independentChecks: [
          {
            ...base.independentChecks[0],
            outcome: "failed",
          },
        ],
      }),
    (error: unknown) =>
      error instanceof ControllerTestReviewDecisionError &&
      (error.reason === "schema" || error.reason === "relation"),
  );
  const equalTime = createControllerTestReviewDecision(base, {
    clock: () => REPORTED_AT,
    uuidFactory: () => EQUAL_TIME_DECISION_UUID,
  });
  equal(equalTime.decidedAt, REPORTED_AT);
  const rolledBack = createControllerTestReviewDecision(base, {
    clock: () => ROLLED_BACK_AT,
    uuidFactory: () => ROLLBACK_DECISION_UUID,
  });
  equal(rolledBack.decidedAt, ROLLED_BACK_AT);
  throws(
    () =>
      createDecision({
        ...base,
        reviewed: {
          ...base.reviewed,
          targetResultOutcome: "blocked",
        },
        decision: "escalate-product-defect",
        assessment: {
          conclusion: "defect-observed",
          evidenceSufficiency: "sufficient",
        },
        independentChecks: [
          {
            ...base.independentChecks[0],
            outcome: "failed",
          },
        ],
      }),
    (error: unknown) =>
      error instanceof ControllerTestReviewDecisionError &&
      (error.reason === "schema" || error.reason === "relation"),
  );
});
