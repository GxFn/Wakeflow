import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import {
  controllerImplementationReviewDecisionEventId,
  createControllerImplementationReviewDecision,
  parseControllerImplementationReviewDecision,
  parseControllerImplementationReviewDecisionDocument,
  renderControllerImplementationReviewDecision,
  ControllerImplementationReviewDecisionError,
} from "../../../src/governance/review/controller-implementation-review-decision.js";
import {
  CONTROLLER_REVIEW_DECIDED_AT,
  CONTROLLER_REVIEW_DECISION_UUID,
  controllerImplementationReviewDecisionInput,
  controllerReviewEscalationFixture,
  createControllerImplementationReviewDecisionFixture,
} from "./controller-implementation-review-decision.fixture.js";

function createDecision(input = controllerImplementationReviewDecisionInput()) {
  return createControllerImplementationReviewDecision(input, {
    clock: () => CONTROLLER_REVIEW_DECIDED_AT,
    uuidFactory: () => CONTROLLER_REVIEW_DECISION_UUID,
  });
}

test("Controller Implementation Review Decision保存独立审查事实、完成证据并派生稳定Event身份", () => {
  const decision = createControllerImplementationReviewDecisionFixture();
  equal(decision.decision, "accept");
  equal(decision.assessment.requirementAlignment, "aligned");
  equal(decision.independentChecks[0].outcome, "passed");
  equal(decision.escalation, null);
  equal(decision.resumption, null);
  equal(decision.callbackLanding, null);
  equal(decision.targetCompletion?.event, "stop");
  equal(Object.isFrozen(decision), true);
  equal(Object.isFrozen(decision.reviewed), true);
  equal(Object.isFrozen(decision.independentChecks), true);
  equal(Object.isFrozen(decision.independentChecks[0]), true);
  equal(
    controllerImplementationReviewDecisionEventId(decision),
    `demand-event_${CONTROLLER_REVIEW_DECISION_UUID}`,
  );
  const rendered = renderControllerImplementationReviewDecision(decision);
  equal(
    parseControllerImplementationReviewDecisionDocument(rendered).decisionDigest,
    decision.decisionDigest,
  );
});

test("四类Controller决定：accept 要求完成证据，escalate 当且仅当携带升级，blocked 要求阻塞原因", () => {
  for (const decisionType of ["accept", "rework", "blocked", "escalate"] as const) {
    const decision = createDecision(controllerImplementationReviewDecisionInput(decisionType));
    equal(decision.decision, decisionType);
    equal(decision.escalation !== null, decisionType === "escalate");
  }
  // rework 的实现质量是 Controller 的判断：改动没问题只是报告要重做记 satisfactory，无法核实记 unverified（§13.120 D6）。
  for (const quality of ["satisfactory", "unverified", "defective"] as const) {
    const decision = createDecision({
      ...controllerImplementationReviewDecisionInput("rework"),
      assessment: { requirementAlignment: "aligned", implementationQuality: quality },
    });
    equal(decision.assessment.implementationQuality, quality);
  }
  throws(
    () =>
      createDecision({
        ...controllerImplementationReviewDecisionInput("accept"),
        targetCompletion: null,
      }),
    (error: unknown) =>
      error instanceof ControllerImplementationReviewDecisionError &&
      (error.reason === "schema" || error.reason === "relation"),
  );
  throws(
    () =>
      createDecision({
        ...controllerImplementationReviewDecisionInput("accept"),
        assessment: { requirementAlignment: "aligned", implementationQuality: "defective" },
      }),
    (error: unknown) =>
      error instanceof ControllerImplementationReviewDecisionError &&
      (error.reason === "schema" || error.reason === "relation"),
  );
  throws(
    () =>
      createDecision({
        ...controllerImplementationReviewDecisionInput("rework"),
        escalation: controllerReviewEscalationFixture(),
      }),
    (error: unknown) =>
      error instanceof ControllerImplementationReviewDecisionError &&
      (error.reason === "schema" || error.reason === "relation"),
  );
  throws(
    () =>
      createDecision({
        ...controllerImplementationReviewDecisionInput("escalate"),
        escalation: null,
      }),
    (error: unknown) =>
      error instanceof ControllerImplementationReviewDecisionError &&
      (error.reason === "schema" || error.reason === "relation"),
  );
  throws(
    () =>
      createDecision({
        ...controllerImplementationReviewDecisionInput("blocked"),
        blockingReasons: [],
      }),
    (error: unknown) =>
      error instanceof ControllerImplementationReviewDecisionError &&
      (error.reason === "schema" || error.reason === "relation"),
  );
});

test("resumption 记录 blocked 或 escalated 之后再决定的依据，并进入摘要", () => {
  const resumed = createDecision({
    ...controllerImplementationReviewDecisionInput("rework"),
    resumption: {
      previousDecisionId: parseWakeflowDurableIdOfKind(
        "target-review-decision_dededede-dede-4ded-8ded-dededededede",
        "target-review-decision",
      ),
      basis: {
        kind: "decision-recorded",
        escalationEventId: parseWakeflowDurableIdOfKind(
          "demand-event_efefefef-efef-4efe-8efe-efefefefefef",
          "demand-event",
        ),
      },
      summary: "用户已回答升级：按原表述返工。",
    },
  });
  equal(resumed.resumption?.basis.kind, "decision-recorded");
  const plain = createDecision(controllerImplementationReviewDecisionInput("rework"));
  equal(resumed.decisionDigest === plain.decisionDigest, false);
});

test("Controller Implementation Review Decision拒绝重复check、非法时间、非NFC文本和摘要漂移", () => {
  const base = controllerImplementationReviewDecisionInput();
  throws(
    () =>
      createDecision({
        ...base,
        independentChecks: [base.independentChecks[0], base.independentChecks[0]],
      }),
    (error: unknown) =>
      error instanceof ControllerImplementationReviewDecisionError &&
      (error.reason === "schema" || error.reason === "relation"),
  );
  equal(
    createControllerImplementationReviewDecision(base, {
      clock: () => base.reviewed.targetResultReportedAt,
      uuidFactory: () => CONTROLLER_REVIEW_DECISION_UUID,
    }).decidedAt,
    base.reviewed.targetResultReportedAt,
  );
  throws(
    () =>
      createControllerImplementationReviewDecision(base, {
        clock: () => "not-a-utc-instant" as never,
        uuidFactory: () => CONTROLLER_REVIEW_DECISION_UUID,
      }),
    (error: unknown) =>
      error instanceof ControllerImplementationReviewDecisionError && error.reason === "time",
  );
  throws(
    () => createDecision({ ...base, rationale: "Café" }),
    (error: unknown) =>
      error instanceof ControllerImplementationReviewDecisionError && error.reason === "text",
  );
  const decision = createDecision(base);
  throws(
    () =>
      parseControllerImplementationReviewDecision({
        ...decision,
        decisionDigest: `sha256:${"0".repeat(64)}`,
      }),
    (error: unknown) =>
      error instanceof ControllerImplementationReviewDecisionError && error.reason === "digest",
  );
});
