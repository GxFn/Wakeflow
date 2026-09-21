import { createWakeflowDurableId, } from "../../contracts/identity/wakeflow-durable-id.js";
import { JsonValueError, parseJsonValue, } from "../../foundation/data/json-value.js";
import { parseUuidV4 } from "../../foundation/identity/uuid-v4.js";
import { parseControllerImplementationReviewDecision, ControllerImplementationReviewDecisionError, } from "./controller-implementation-review-decision.js";
import { parseControllerTestReviewDecision, ControllerTestReviewDecisionError, } from "./controller-test-review-decision.js";
/** Controller对implementation或Test TargetResult作出的共享持久Decision联合。 */
const DECISION_ID_PREFIX = "target-review-decision_";
const ERROR_MESSAGES = {
    json: "Controller Review Decision is not passive JSON data.",
    decision: "Controller Review Decision variant is invalid.",
};
export class ControllerReviewDecisionError extends Error {
    name = "ControllerReviewDecisionError";
    code = "wakeflow-controller-review-decision";
    reason;
    constructor(reason) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
    }
}
function fail(reason) {
    throw new ControllerReviewDecisionError(reason);
}
export function parseControllerReviewDecision(value) {
    let json;
    try {
        json = parseJsonValue(value, "$decision");
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("json");
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
    }
    catch (error) {
        if (error instanceof ControllerImplementationReviewDecisionError ||
            error instanceof ControllerTestReviewDecisionError) {
            fail("decision");
        }
        throw error;
    }
    fail("decision");
}
function decisionUuid(value) {
    const decision = parseControllerReviewDecision(value);
    return parseUuidV4(decision.targetReviewDecisionId.slice(DECISION_ID_PREFIX.length));
}
export function controllerReviewDecisionEventId(value) {
    return createWakeflowDurableId("demand-event", decisionUuid(value));
}
export function controllerReviewDecisionCommitId(value) {
    return createWakeflowDurableId("demand-event-commit", decisionUuid(value));
}
