import {
  createWakeflowDurableId,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  JsonValueError,
  parseJsonValue,
} from "../../foundation/data/json-value.js";
import { parseUuidV4 } from "../../foundation/identity/uuid-v4.js";
import {
  parseControllerImplementationReviewDecision,
  ControllerImplementationReviewDecisionError,
  type ControllerImplementationReviewDecision,
} from "./controller-implementation-review-decision.js";
import {
  parseControllerTestReviewDecision,
  ControllerTestReviewDecisionError,
  type ControllerTestReviewDecision,
} from "./controller-test-review-decision.js";

/** Controller对implementation或Test TargetResult作出的共享持久Decision联合。 */

const DECISION_ID_PREFIX = "target-review-decision_";

export type ControllerReviewDecision =
  ControllerImplementationReviewDecision | ControllerTestReviewDecision;

export type ControllerReviewDecisionErrorReason = "json" | "decision";

const ERROR_MESSAGES = {
  json: "Controller Review Decision is not passive JSON data.",
  decision: "Controller Review Decision variant is invalid.",
} as const satisfies Readonly<
  Record<ControllerReviewDecisionErrorReason, string>
>;

export class ControllerReviewDecisionError extends Error {
  override readonly name = "ControllerReviewDecisionError";
  readonly code = "wakeflow-controller-review-decision" as const;
  readonly reason: ControllerReviewDecisionErrorReason;

  constructor(reason: ControllerReviewDecisionErrorReason) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

function fail(reason: ControllerReviewDecisionErrorReason): never {
  throw new ControllerReviewDecisionError(reason);
}

export function parseControllerReviewDecision(
  value: unknown,
): Readonly<ControllerReviewDecision> {
  let json;
  try {
    json = parseJsonValue(value, "$decision");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json");
    throw error;
  }
  if (json === null || Array.isArray(json) || typeof json !== "object") {
    fail("decision");
  }
  const kind = "kind" in json ? json.kind : undefined;
  try {
    if (kind === "WakeflowControllerImplementationReviewDecision") {
      return parseControllerImplementationReviewDecision(json);
    }
    if (kind === "WakeflowControllerTestReviewDecision") {
      return parseControllerTestReviewDecision(json);
    }
  } catch (error: unknown) {
    if (
      error instanceof ControllerImplementationReviewDecisionError ||
      error instanceof ControllerTestReviewDecisionError
    ) {
      fail("decision");
    }
    throw error;
  }
  fail("decision");
}

function decisionUuid(value: unknown) {
  const decision = parseControllerReviewDecision(value);
  return parseUuidV4(
    decision.targetReviewDecisionId.slice(DECISION_ID_PREFIX.length),
  );
}

export function controllerReviewDecisionEventId(
  value: unknown,
): WakeflowDurableId<"demand-event"> {
  return createWakeflowDurableId("demand-event", decisionUuid(value));
}

export function controllerReviewDecisionCommitId(
  value: unknown,
): WakeflowDurableId<"demand-event-commit"> {
  return createWakeflowDurableId("demand-event-commit", decisionUuid(value));
}
