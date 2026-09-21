import { parseTargetResult, TargetResultError, } from "../result/target-result.js";
import { parseControllerImplementationReviewDecision, ControllerImplementationReviewDecisionError, } from "../review/controller-implementation-review-decision.js";
import { projectTargetDeliveryReworkContext, } from "./delivery-envelope.js";
const ERROR_MESSAGES = {
    decision: "Target Delivery rework context requires a valid Controller Decision.",
    result: "Target Delivery rework context requires a valid previous TargetResult.",
    relation: "Target Delivery rework Decision and previous Result are inconsistent.",
};
/** 完整返工来源无法形成一致投递投影时的稳定错误。 */
export class TargetDeliveryReworkContextError extends Error {
    name = "TargetDeliveryReworkContextError";
    code = "wakeflow-target-delivery-rework-context";
    reason;
    constructor(reason) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
    }
}
function fail(reason) {
    throw new TargetDeliveryReworkContextError(reason);
}
/** 从一份精确rework Decision和它审查的TargetResult创建最小执行投影。 */
export function createTargetDeliveryReworkContext(input) {
    let decision;
    let previousResult;
    try {
        decision = parseControllerImplementationReviewDecision(input.decision);
    }
    catch (error) {
        if (error instanceof ControllerImplementationReviewDecisionError) {
            fail("decision");
        }
        throw error;
    }
    try {
        previousResult = parseTargetResult(input.previousResult);
    }
    catch (error) {
        if (error instanceof TargetResultError)
            fail("result");
        throw error;
    }
    const requiredCorrections = decision.independentChecks.filter((check) => check.outcome !== "passed");
    if (decision.decision !== "rework" ||
        decision.programId !== previousResult.programId ||
        decision.demandId !== previousResult.demandId ||
        decision.targetTaskId !== previousResult.targetTaskId ||
        decision.reviewed.taskPackageId !==
            previousResult.taskPackage.taskPackageId ||
        decision.reviewed.taskPackageDigest !== previousResult.taskPackage.digest ||
        decision.reviewed.targetResultId !== previousResult.targetResultId ||
        decision.reviewed.targetResultDigest !== previousResult.resultDigest ||
        decision.reviewed.targetResultOutcome !== previousResult.report.outcome ||
        decision.reviewed.targetResultReportedAt !==
            previousResult.report.reportedAt ||
        requiredCorrections.length === 0 ||
        !requiredCorrections.some((check) => check.outcome === "failed")) {
        fail("relation");
    }
    return projectTargetDeliveryReworkContext({
        decision: Object.freeze({
            targetReviewDecisionId: decision.targetReviewDecisionId,
            decisionDigest: decision.decisionDigest,
        }),
        previousResult: Object.freeze({
            targetResultId: previousResult.targetResultId,
            resultDigest: previousResult.resultDigest,
        }),
        rationale: decision.rationale,
        requiredCorrections: requiredCorrections.map((check) => Object.freeze({
            checkId: check.checkId,
            outcome: check.outcome,
            method: check.method,
            observation: check.observation,
        })),
    });
}
