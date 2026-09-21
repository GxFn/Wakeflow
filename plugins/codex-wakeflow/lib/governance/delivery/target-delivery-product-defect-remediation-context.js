import { parseTargetResult, TargetResultError, } from "../result/target-result.js";
import { parseControllerProductDefectRemediationAuthorization, ControllerProductDefectRemediationAuthorizationError, } from "../review/controller-product-defect-remediation-authorization.js";
import { projectTargetDeliveryProductDefectRemediationContext, } from "./delivery-envelope.js";
const ERROR_MESSAGES = {
    authorization: "Target Delivery product-defect remediation context requires a valid Controller Authorization.",
    result: "Target Delivery product-defect remediation context requires a valid previous product TargetResult.",
    relation: "Target Delivery product-defect remediation Authorization and previous Result are inconsistent.",
};
export class TargetDeliveryProductDefectRemediationContextError extends Error {
    name = "TargetDeliveryProductDefectRemediationContextError";
    code = "wakeflow-target-delivery-product-defect-remediation-context";
    reason;
    constructor(reason) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
    }
}
function fail(reason) {
    throw new TargetDeliveryProductDefectRemediationContextError(reason);
}
/** 从完整Authorization与产品Result创建最小产品缺陷修复投影。 */
export function createTargetDeliveryProductDefectRemediationContext(input) {
    let authorization;
    let previousResult;
    try {
        authorization = parseControllerProductDefectRemediationAuthorization(input.authorization);
    }
    catch (error) {
        if (error instanceof ControllerProductDefectRemediationAuthorizationError) {
            fail("authorization");
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
    const affected = authorization.affectedTargets.find((target) => target.baseline.targetTaskId === previousResult.targetTaskId);
    if (previousResult.workType !== "implementation" ||
        affected === undefined ||
        authorization.programId !== previousResult.programId ||
        authorization.demandId !== previousResult.demandId ||
        affected.baseline.taskPackageId !==
            previousResult.taskPackage.taskPackageId ||
        affected.baseline.taskPackageDigest !== previousResult.taskPackage.digest ||
        affected.baseline.repositoryId !== previousResult.assignment.repositoryId ||
        affected.baseline.windowId !== previousResult.assignment.windowId ||
        affected.baseline.targetResultId !== previousResult.targetResultId ||
        affected.baseline.resultDigest !== previousResult.resultDigest) {
        fail("relation");
    }
    const failedStepById = new Map(authorization.failedSteps.map((step) => [step.stepId, step]));
    const requiredCorrections = affected.failedStepIds.map((stepId) => {
        const step = failedStepById.get(stepId);
        if (step === undefined)
            fail("relation");
        return Object.freeze({ stepId: step.stepId, observed: step.observed });
    });
    return projectTargetDeliveryProductDefectRemediationContext({
        authorization: Object.freeze({
            productDefectRemediationId: authorization.productDefectRemediationId,
            authorizationDigest: authorization.authorizationDigest,
        }),
        testReviewDecision: Object.freeze({
            targetReviewDecisionId: authorization.source.testReviewDecision.targetReviewDecisionId,
            decisionDigest: authorization.source.testReviewDecision.decisionDigest,
        }),
        previousResult: Object.freeze({
            targetResultId: previousResult.targetResultId,
            resultDigest: previousResult.resultDigest,
        }),
        authorizationRationale: authorization.authorizationRationale,
        correctionObjective: affected.correctionObjective,
        requiredCorrections,
    });
}
