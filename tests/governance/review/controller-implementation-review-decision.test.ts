import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  controllerImplementationReviewDecisionCommitId,
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
  createControllerImplementationReviewDecisionFixture,
} from "./controller-implementation-review-decision.fixture.js";

function createDecision(input = controllerImplementationReviewDecisionInput()) {
  return createControllerImplementationReviewDecision(input, {
    clock: () => CONTROLLER_REVIEW_DECIDED_AT,
    uuidFactory: () => CONTROLLER_REVIEW_DECISION_UUID,
  });
}

test("Controller Implementation Review Decision保存独立审查事实并派生稳定Event身份", () => {
  const decision = createControllerImplementationReviewDecisionFixture();
  equal(decision.decision, "accept");
  equal(decision.assessment.requirementAlignment, "aligned");
  equal(decision.independentChecks[0].outcome, "passed");
  equal(Object.isFrozen(decision), true);
  equal(Object.isFrozen(decision.reviewed), true);
  equal(Object.isFrozen(decision.independentChecks), true);
  equal(Object.isFrozen(decision.independentChecks[0]), true);
  equal(
    controllerImplementationReviewDecisionEventId(decision),
    `demand-event_${CONTROLLER_REVIEW_DECISION_UUID}`,
  );
  equal(
    controllerImplementationReviewDecisionCommitId(decision),
    `demand-event-commit_${CONTROLLER_REVIEW_DECISION_UUID}`,
  );
  const rendered = renderControllerImplementationReviewDecision(decision);
  equal(
    parseControllerImplementationReviewDecisionDocument(rendered)
      .decisionDigest,
    decision.decisionDigest,
  );
});

test("四类Controller决定使用不同的assessment、check与blocking关系", () => {
  for (const decisionType of [
    "accept",
    "rework",
    "redesign",
    "blocked",
  ] as const) {
    equal(
      createDecision(controllerImplementationReviewDecisionInput(decisionType))
        .decision,
      decisionType,
    );
  }

  throws(
    () =>
      createDecision({
        ...controllerImplementationReviewDecisionInput("accept"),
        assessment: {
          requirementAlignment: "aligned",
          implementationQuality: "defective",
        },
      }),
    (error: unknown) =>
      error instanceof ControllerImplementationReviewDecisionError &&
      error.reason === "schema",
  );
  throws(
    () =>
      createDecision({
        ...controllerImplementationReviewDecisionInput("rework"),
        independentChecks: [
          {
            checkId: "no-failure",
            method: "只运行成功路径",
            outcome: "passed",
            observation: "未复现缺陷。",
          },
        ],
      }),
    (error: unknown) =>
      error instanceof ControllerImplementationReviewDecisionError &&
      error.reason === "schema",
  );
  throws(
    () =>
      createDecision({
        ...controllerImplementationReviewDecisionInput("blocked"),
        blockingReasons: [],
      }),
    (error: unknown) =>
      error instanceof ControllerImplementationReviewDecisionError &&
      error.reason === "schema",
  );
  throws(
    () =>
      createDecision({
        ...controllerImplementationReviewDecisionInput("accept"),
        reviewed: {
          ...controllerImplementationReviewDecisionInput("accept").reviewed,
          targetResultOutcome: "blocked",
        },
      }),
    (error: unknown) =>
      error instanceof ControllerImplementationReviewDecisionError &&
      error.reason === "schema",
  );
});

test("Controller Implementation Review Decision拒绝重复check、非法时间、非NFC文本和摘要漂移", () => {
  const base = controllerImplementationReviewDecisionInput();
  throws(
    () =>
      createDecision({
        ...base,
        independentChecks: [
          base.independentChecks[0],
          base.independentChecks[0],
        ],
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
      error instanceof ControllerImplementationReviewDecisionError &&
      error.reason === "time",
  );
  throws(
    () => createDecision({ ...base, rationale: "Cafe\u0301" }),
    (error: unknown) =>
      error instanceof ControllerImplementationReviewDecisionError &&
      error.reason === "text",
  );
  const decision = createDecision(base);
  throws(
    () =>
      parseControllerImplementationReviewDecision({
        ...decision,
        decisionDigest: `sha256:${"0".repeat(64)}`,
      }),
    (error: unknown) =>
      error instanceof ControllerImplementationReviewDecisionError &&
      error.reason === "digest",
  );
});
