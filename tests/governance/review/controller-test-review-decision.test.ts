import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { controllerReviewDecisionEventId } from "../../../src/governance/review/controller-review-decision.js";
import {
  createControllerTestReviewDecision,
  parseControllerTestReviewDecisionDocument,
  renderControllerTestReviewDecision,
  ControllerTestReviewDecisionError,
  type CreateControllerTestReviewDecisionInput,
} from "../../../src/governance/review/controller-test-review-decision.js";
import {
  productDefectEscalation,
  TEST_REVIEW_REPORTED_AT as REPORTED_AT,
  testReviewDecisionBaseInput,
} from "./controller-test-review-decision.fixture.js";

const DECIDED_AT = parseUtcInstant("2026-08-29T12:35:00.000Z");
const ROLLED_BACK_AT = parseUtcInstant("2026-08-29T12:33:00.000Z");
const DECISION_UUID = "e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5";
const EQUAL_TIME_DECISION_UUID = "e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6";
const ROLLBACK_DECISION_UUID = "e7e7e7e7-e7e7-47e7-87e7-e7e7e7e7e7e7";

function createDecision(input: CreateControllerTestReviewDecisionInput) {
  return createControllerTestReviewDecision(input, {
    clock: () => DECIDED_AT,
    uuidFactory: () => DECISION_UUID,
  });
}

test("ControllerTestReviewDecision接受完整Evidence与完成证据但不自动完成Demand", () => {
  const decision = createDecision(testReviewDecisionBaseInput());
  equal(decision.kind, "WakeflowControllerTestReviewDecision");
  equal(decision.decision, "accept");
  equal(decision.stepIds, null);
  equal(decision.escalation, null);
  equal(decision.targetCompletion?.event, "stop");
  equal(Object.hasOwn(decision, "demandCompletion"), false);
  equal(controllerReviewDecisionEventId(decision), `demand-event_${DECISION_UUID}`);
  equal(
    parseControllerTestReviewDecisionDocument(renderControllerTestReviewDecision(decision))
      .decisionDigest,
    decision.decisionDigest,
  );
  throws(
    () => createDecision({ ...testReviewDecisionBaseInput(), targetCompletion: null }),
    (error: unknown) =>
      error instanceof ControllerTestReviewDecisionError &&
      (error.reason === "schema" || error.reason === "relation"),
  );
});

test("ControllerTestReviewDecision区分带范围的另一次attempt、产品缺陷升级、需要决定的升级与阻塞", () => {
  const base = testReviewDecisionBaseInput();
  const anotherAttempt = createDecision({
    ...base,
    reviewed: { ...base.reviewed, targetResultOutcome: "needs-review" },
    decision: "request-another-attempt",
    assessment: { conclusion: "inconclusive", evidenceSufficiency: "insufficient" },
    independentChecks: [
      {
        checkId: "controller-test-inconclusive",
        method: "复验当前Evidence覆盖范围。",
        outcome: "inconclusive",
        observation: "环境读取中断，现有Evidence不足以关闭问题。",
      },
    ],
    rationale: "需要后续owner规划另一logical Test attempt。",
    stepIds: ["ts-2"],
    targetCompletion: null,
  });
  equal(anotherAttempt.decision, "request-another-attempt");
  equal(anotherAttempt.stepIds?.[0], "ts-2");
  throws(
    () => createDecision({ ...base, decision: "accept", stepIds: ["ts-1"] }),
    (error: unknown) =>
      error instanceof ControllerTestReviewDecisionError &&
      (error.reason === "schema" || error.reason === "relation"),
  );

  const productDefect = createDecision({
    ...base,
    reviewed: { ...base.reviewed, targetResultOutcome: "needs-review" },
    decision: "escalate",
    assessment: { conclusion: "defect-observed", evidenceSufficiency: "sufficient" },
    independentChecks: [
      {
        checkId: "controller-product-defect",
        method: "独立复现Test Evidence中的产品行为。",
        outcome: "failed",
        observation: "已接受实现在线上等价环境稳定复现缺陷。",
      },
    ],
    rationale: "保留Evidence并升级到产品remediation，不重派Test。",
    escalation: productDefectEscalation(),
    targetCompletion: null,
  });
  equal(productDefect.decision, "escalate");
  equal(productDefect.escalation?.classification, "product-defect");

  const needsDecision = createDecision({
    ...base,
    reviewed: { ...base.reviewed, targetResultOutcome: "needs-review" },
    decision: "escalate",
    assessment: { conclusion: "inconclusive", evidenceSufficiency: "sufficient" },
    independentChecks: [
      {
        checkId: "controller-needs-decision",
        method: "对照需求包与真实环境行为。",
        outcome: "inconclusive",
        observation: "需求对该行为没有明确表述，需要用户裁定。",
      },
    ],
    rationale: "Controller 不能单方面裁定需求含义。",
    escalation: {
      classification: "needs-decision",
      userDecision: {
        issue: "真实环境行为与需求表述冲突，需要用户裁定。",
        requirementRefs: [],
        evidence: [],
        options: [{ option: "按当前行为接受。", impact: "需求包需要补充说明。" }],
        recommendation: "建议补充需求说明后接受。",
      },
    },
    targetCompletion: null,
  });
  equal(needsDecision.escalation?.classification, "needs-decision");

  const blocked = createDecision({
    ...base,
    reviewed: { ...base.reviewed, targetResultOutcome: "blocked" },
    decision: "blocked",
    assessment: { conclusion: "inconclusive", evidenceSufficiency: "insufficient" },
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
    targetCompletion: null,
  });
  equal(blocked.decision, "blocked");
});

test("ControllerTestReviewDecision拒绝矛盾结论、无升级的 escalate 并允许wall clock重复或回拨", () => {
  const base = testReviewDecisionBaseInput();
  throws(
    () =>
      createDecision({
        ...base,
        independentChecks: [{ ...base.independentChecks[0], outcome: "failed" }],
      }),
    (error: unknown) =>
      error instanceof ControllerTestReviewDecisionError &&
      (error.reason === "schema" || error.reason === "relation"),
  );
  throws(
    () =>
      createDecision({
        ...base,
        decision: "escalate",
        assessment: { conclusion: "defect-observed", evidenceSufficiency: "sufficient" },
        targetCompletion: null,
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
        reviewed: { ...base.reviewed, targetResultOutcome: "blocked" },
        decision: "escalate",
        assessment: { conclusion: "defect-observed", evidenceSufficiency: "sufficient" },
        independentChecks: [{ ...base.independentChecks[0], outcome: "failed" }],
        escalation: productDefectEscalation(),
        targetCompletion: null,
      }),
    (error: unknown) =>
      error instanceof ControllerTestReviewDecisionError &&
      (error.reason === "schema" || error.reason === "relation"),
  );
});
