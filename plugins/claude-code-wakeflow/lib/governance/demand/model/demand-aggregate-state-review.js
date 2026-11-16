import { ControllerProductDefectRemediationAuthorizationError, parseControllerProductDefectRemediationAuthorization, } from "../../review/controller-product-defect-remediation-authorization.js";
import { ControllerReviewDecisionError, parseControllerReviewDecision, } from "../../review/controller-review-decision.js";
import { fail, } from "./demand-aggregate-state-model.js";
import { computeDemandAggregateStateDigest, parseDemandAggregateState, reviewDecisionSummaryOf, reviewPhaseForDecision, testReviewPhaseForDecision, } from "./demand-aggregate-state-wire.js";
/**
 * blocked 或 escalated 之后在同一结果上再次决定的准入（§13.87 D4）：新决定必须带
 * `resumption` 指向当前决定；`condition-cleared` 只接 blocked，`decision-recorded`
 * 只接已被用户回答的 escalate（`awaitingDecision` 已清除）。
 */
function assertResumptionAdmitted(current, target, decision) {
    const resumption = decision.resumption;
    const previous = target.currentDelivery.reviewDecision;
    if (resumption === null ||
        resumption.previousDecisionId !== previous.targetReviewDecisionId ||
        (resumption.basis.kind === "condition-cleared") !== (previous.decision === "blocked") ||
        (resumption.basis.kind === "decision-recorded" &&
            (previous.decision !== "escalate" || current.awaitingDecision !== undefined))) {
        fail("transition", "$/targetTasks/resumption");
    }
}
/**
 * 对一份测试结果作决定：目标在等评审（或评审曾被阻塞、升级过），决定评的就是当前这份结果与这次尝试；
 * 第一次决定不带恢复依据，阻塞或升级之后的决定必须带。
 */
function decideTestTargetReview(current, target, decision) {
    if (target.workType !== "test" ||
        (target.phase !== "test-result-reported" &&
            target.phase !== "test-review-blocked" &&
            target.phase !== "test-escalated") ||
        decision.reviewed.targetResultId !== target.currentDelivery.targetResult.targetResultId ||
        decision.reviewed.targetResultDigest !== target.currentDelivery.targetResult.resultDigest ||
        decision.reviewed.targetResultOutcome !== target.currentDelivery.targetResult.outcome ||
        decision.reviewed.targetResultReportedAt !== target.currentDelivery.targetResult.reportedAt ||
        decision.testExecution.testAttemptId !== target.currentDelivery.testAttemptId) {
        fail("transition", "$/targetTasks");
    }
    if (target.phase === "test-result-reported") {
        if (decision.resumption !== null)
            fail("transition", "$/targetTasks/resumption");
    }
    else {
        assertResumptionAdmitted(current, target, decision);
    }
    const phase = testReviewPhaseForDecision(decision);
    return parseDemandAggregateState({
        ...current,
        targetTasks: current.targetTasks.map((entry) => entry.targetTaskId === target.targetTaskId
            ? {
                ...target,
                phase,
                currentDelivery: {
                    ...target.currentDelivery,
                    reviewDecision: reviewDecisionSummaryOf(decision),
                },
            }
            : entry),
    });
}
/**
 * 对一份实现结果作决定：与测试目标同样的对应关系；决定是 rework 时返工次数加一。
 */
function decideImplementationTargetReview(current, target, decision) {
    if (target.workType === "test" ||
        (target.phase !== "result-reported" &&
            target.phase !== "review-blocked" &&
            target.phase !== "escalated")) {
        fail("transition", "$/targetTasks");
    }
    if (decision.reviewed.targetResultId !== target.currentDelivery.targetResult.targetResultId ||
        decision.reviewed.targetResultDigest !== target.currentDelivery.targetResult.resultDigest ||
        decision.reviewed.targetResultOutcome !== target.currentDelivery.targetResult.outcome ||
        decision.reviewed.targetResultReportedAt !== target.currentDelivery.targetResult.reportedAt) {
        fail("transition", "$/targetTasks");
    }
    if (target.phase === "result-reported") {
        if (decision.resumption !== null)
            fail("transition", "$/targetTasks/resumption");
    }
    else {
        assertResumptionAdmitted(current, target, decision);
    }
    const phase = reviewPhaseForDecision(decision.decision);
    const reworkCount = decision.decision === "rework" ? (target.reworkCount ?? 0) + 1 : target.reworkCount;
    return parseDemandAggregateState({
        ...current,
        targetTasks: current.targetTasks.map((entry) => entry.targetTaskId === target.targetTaskId
            ? {
                ...target,
                ...(reworkCount === undefined ? {} : { reworkCount }),
                phase,
                currentDelivery: {
                    ...target.currentDelivery,
                    reviewDecision: reviewDecisionSummaryOf(decision),
                },
            }
            : entry),
    });
}
export function decideTargetResultReviewInDemandAggregateState(currentValue, decisionValue) {
    const current = parseDemandAggregateState(currentValue);
    let decision;
    try {
        decision = parseControllerReviewDecision(decisionValue);
    }
    catch (error) {
        if (error instanceof ControllerReviewDecisionError) {
            fail("controller-review-decision", "$decision", error);
        }
        throw error;
    }
    const target = current.targetTasks.find((entry) => entry.targetTaskId === decision.targetTaskId);
    const duplicateDecision = current.targetTasks.some((entry) => {
        if (!("currentDelivery" in entry) || !("reviewDecision" in entry.currentDelivery)) {
            return false;
        }
        return (entry.currentDelivery.reviewDecision.targetReviewDecisionId ===
            decision.targetReviewDecisionId);
    });
    if (current.lifecycle !== "active" ||
        decision.demandId !== current.demandId ||
        target === undefined ||
        decision.reviewed.stateDigest !== computeDemandAggregateStateDigest(current) ||
        decision.reviewed.taskPackageId !== target.taskPackageId ||
        decision.reviewed.taskPackageDigest !== target.taskPackageDigest ||
        duplicateDecision) {
        fail("transition", "$/targetTasks");
    }
    if (decision.kind === "WakeflowControllerTestReviewDecision") {
        return decideTestTargetReview(current, target, decision);
    }
    return decideImplementationTargetReview(current, target, decision);
}
/** `review.product-defect-remediation-authorized.v1`使用的纯状态转换。 */
export function authorizeProductDefectRemediationInDemandAggregateState(currentValue, authorizationValue) {
    const current = parseDemandAggregateState(currentValue);
    let authorization;
    try {
        authorization = parseControllerProductDefectRemediationAuthorization(authorizationValue);
    }
    catch (error) {
        if (error instanceof ControllerProductDefectRemediationAuthorizationError) {
            fail("controller-product-defect-remediation-authorization", "$authorization", error);
        }
        throw error;
    }
    const testTarget = current.targetTasks.find((target) => target.targetTaskId === authorization.source.testTargetTaskId);
    if (current.lifecycle !== "active" ||
        authorization.demandId !== current.demandId ||
        authorization.source.stateDigest !== computeDemandAggregateStateDigest(current) ||
        current.pendingTestRetest !== undefined ||
        testTarget === undefined ||
        testTarget.workType !== "test" ||
        testTarget.phase !== "test-product-defect" ||
        testTarget.taskPackageId !== authorization.source.testTaskPackage.taskPackageId ||
        testTarget.taskPackageDigest !== authorization.source.testTaskPackage.taskPackageDigest ||
        testTarget.currentDelivery.testAttemptId !== authorization.source.testAttemptId ||
        testTarget.currentDelivery.targetResult.targetResultId !==
            authorization.source.targetResult.targetResultId ||
        testTarget.currentDelivery.targetResult.resultDigest !==
            authorization.source.targetResult.resultDigest ||
        testTarget.currentDelivery.reviewDecision.targetReviewDecisionId !==
            authorization.source.testReviewDecision.targetReviewDecisionId ||
        testTarget.currentDelivery.reviewDecision.decisionDigest !==
            authorization.source.testReviewDecision.decisionDigest ||
        testTarget.currentDelivery.reviewDecision.decidedAt !==
            authorization.source.testReviewDecision.decidedAt ||
        testTarget.currentDelivery.reviewDecision.decision !== "escalate" ||
        testTarget.currentDelivery.reviewDecision.controllerWindowId !==
            authorization.controllerWindowId) {
        fail("transition", "$state/targetTasks");
    }
    const authorizationTargets = new Map(authorization.affectedTargets.map((target) => [target.baseline.targetTaskId, target]));
    if (authorizationTargets.size !== authorization.affectedTargets.length ||
        authorization.affectedTargets.some(({ baseline }) => {
            const target = current.targetTasks.find((entry) => entry.targetTaskId === baseline.targetTaskId);
            return (target === undefined ||
                target.workType === "test" ||
                target.phase !== "accepted" ||
                target.taskPackageId !== baseline.taskPackageId ||
                target.taskPackageDigest !== baseline.taskPackageDigest ||
                target.repositoryId !== baseline.repositoryId ||
                target.windowId !== baseline.windowId ||
                target.currentDelivery.targetResult.targetResultId !== baseline.targetResultId ||
                target.currentDelivery.targetResult.resultDigest !== baseline.resultDigest ||
                target.currentDelivery.reviewDecision.targetReviewDecisionId !==
                    baseline.targetReviewDecisionId ||
                target.currentDelivery.reviewDecision.decisionDigest !== baseline.decisionDigest ||
                target.currentDelivery.reviewDecision.decision !== "accept");
        })) {
        fail("transition", "$state/targetTasks");
    }
    return parseDemandAggregateState({
        ...current,
        pendingTestRetest: {
            kind: "product-defect-retest",
            previousTestTarget: {
                targetTaskId: testTarget.targetTaskId,
                taskPackageId: testTarget.taskPackageId,
                taskPackageDigest: testTarget.taskPackageDigest,
            },
            testReviewDecision: {
                targetReviewDecisionId: authorization.source.testReviewDecision.targetReviewDecisionId,
                decisionDigest: authorization.source.testReviewDecision.decisionDigest,
            },
            productDefectRemediation: {
                productDefectRemediationId: authorization.productDefectRemediationId,
                authorizationDigest: authorization.authorizationDigest,
            },
        },
        targetTasks: current.targetTasks.map((target) => {
            const authorizedTarget = authorizationTargets.get(target.targetTaskId);
            if (authorizedTarget === undefined || target.workType === "test") {
                return target;
            }
            return {
                ...target,
                phase: "product-defect-rework-requested",
                productDefectRemediation: {
                    productDefectRemediationId: authorization.productDefectRemediationId,
                    authorizationDigest: authorization.authorizationDigest,
                    testReviewDecisionId: authorization.source.testReviewDecision.targetReviewDecisionId,
                    testReviewDecisionDigest: authorization.source.testReviewDecision.decisionDigest,
                    failedStepIds: authorizedTarget.failedStepIds,
                    correctionObjective: authorizedTarget.correctionObjective,
                    authorizedAt: authorization.authorizedAt,
                },
            };
        }),
    });
}
