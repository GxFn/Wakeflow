import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { buildDemandPostAcceptanceRoute, DemandPostAcceptanceRouteError, } from "../review/demand-post-acceptance-route.js";
/**
 * Wakeflow Governance / Controller：从现有领域读模型组合出的当前责任前沿。
 *
 * 本Route不拥有Aggregate转换、Review解释或Test/Completion准入。它只把已经闭合的
 * current state映射给Controller application consumer；任何写owner仍须重读并复验自己的
 * 完整Authority。Route不持久化、不执行宿主效果，也不替Controller作业务判断。
 */
const DEMAND_CONTROLLER_ROUTE_KIND = "WakeflowDemandControllerRoute";
const DEMAND_CONTROLLER_ROUTE_SCHEMA_VERSION = 1;
const ERROR_MESSAGES = {
    "post-acceptance-route": "Demand Controller Route could not rebuild its Post-Acceptance source.",
    relation: "Demand Controller Route sources are inconsistent.",
};
export class DemandControllerRouteError extends Error {
    name = "DemandControllerRouteError";
    code = "wakeflow-demand-controller-route";
    reason;
    constructor(reason) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
    }
}
function fail(reason) {
    throw new DemandControllerRouteError(reason);
}
/** 把无Implementation Target的Demand条件解析为唯一Controller责任前沿。 */
export function resolveDemandControllerDemandFrontierDescriptor(condition) {
    switch (condition) {
        case "implementation-planning-required":
            return Object.freeze({
                scope: "demand",
                kind: "implementation-task-planning",
                owner: "target-task-planning",
            });
        case "research-completion-required":
            return Object.freeze({
                scope: "demand",
                kind: "research-completion-required",
                owner: "demand-lifecycle",
            });
    }
}
/** 把Implementation Target phase解析为唯一Controller责任前沿。 */
export function resolveDemandControllerImplementationFrontierDescriptor(phase) {
    switch (phase) {
        case "accepted":
        case "superseded":
            return null;
        case "planned":
        case "rework-requested":
        case "product-defect-rework-requested":
            return Object.freeze({
                scope: "target",
                kind: "implementation-delivery-planning",
                owner: "target-delivery-preparation",
            });
        case "delivery-prepared":
            return Object.freeze({
                scope: "target",
                kind: "implementation-host-effect-execution",
                owner: "agent-host",
            });
        case "host-effect-accepted":
        case "host-effect-indeterminate":
            return Object.freeze({
                scope: "target",
                kind: "implementation-target-result-import",
                owner: "target-result-import",
            });
        case "host-effect-rejected":
            return Object.freeze({
                scope: "target",
                kind: "implementation-host-effect-rearm",
                owner: "target-host-effect-rearm",
            });
        case "result-reported":
        case "escalated":
            // escalated 期间由 Demand 的 awaiting-decision 前沿覆盖；回答后回到评审。
            return Object.freeze({
                scope: "target",
                kind: "implementation-result-review",
                owner: "controller-implementation-review",
            });
        case "review-blocked":
            return Object.freeze({
                scope: "target",
                kind: "implementation-review-blocked",
                owner: "controller-implementation-review",
            });
    }
}
/** 把已闭合Post-Acceptance stage解析为唯一Controller责任前沿。 */
export function resolveDemandControllerPostAcceptanceFrontierDescriptor(status) {
    switch (status) {
        case "completion-preflight":
            return Object.freeze({
                scope: "demand",
                kind: "demand-completion-preflight",
                owner: "demand-completion",
            });
        case "test-task-planning":
            return Object.freeze({
                scope: "demand",
                kind: "test-task-planning",
                owner: "test-task-planning",
            });
        case "test-delivery-planning":
            return Object.freeze({
                scope: "target",
                kind: "test-delivery-planning",
                owner: "test-delivery-preparation",
            });
        case "test-host-effect-execution":
            return Object.freeze({
                scope: "target",
                kind: "test-host-effect-execution",
                owner: "agent-host",
            });
        case "test-result-planning":
            return Object.freeze({
                scope: "target",
                kind: "test-target-result-import",
                owner: "target-result-import",
            });
        case "test-result-review-planning":
        case "test-review-escalated":
            return Object.freeze({
                scope: "target",
                kind: "test-result-review",
                owner: "controller-test-review",
            });
        case "test-another-attempt-planning":
            return Object.freeze({
                scope: "target",
                kind: "test-delivery-rerun-planning",
                owner: "test-delivery-preparation",
            });
        case "test-review-blocked":
            return Object.freeze({
                scope: "target",
                kind: "test-review-blocked",
                owner: "controller-test-review",
            });
        case "test-delivery-rearm-planning":
            return Object.freeze({
                scope: "target",
                kind: "test-host-effect-rearm",
                owner: "target-host-effect-rearm",
            });
    }
}
function isImplementationTarget(target) {
    return target.workType !== "test";
}
function implementationTargetReference(target) {
    return Object.freeze({
        workType: "implementation",
        targetTaskId: target.targetTaskId,
        taskPackageId: target.taskPackageId,
        taskPackageDigest: target.taskPackageDigest,
        repositoryId: target.repositoryId,
        windowId: target.windowId,
        phase: target.phase,
    });
}
function testTargetReference(target) {
    return Object.freeze({
        workType: "test",
        targetTaskId: target.targetTaskId,
        taskPackageId: target.taskPackageId,
        taskPackageDigest: target.taskPackageDigest,
        windowId: target.windowId,
        phase: target.phase,
    });
}
function implementationFrontier(target) {
    const descriptor = resolveDemandControllerImplementationFrontierDescriptor(target.phase);
    if (descriptor === null) {
        return Object.freeze({ frontier: null, blocker: null });
    }
    const blocker = target.phase === "review-blocked"
        ? Object.freeze({
            kind: "external-condition",
            owner: "controller-implementation-review",
            targetTaskId: target.targetTaskId,
            targetReviewDecisionId: target.currentDelivery.reviewDecision.targetReviewDecisionId,
            decisionDigest: target.currentDelivery.reviewDecision.decisionDigest,
        })
        : null;
    return Object.freeze({
        frontier: Object.freeze({
            ...descriptor,
            target: implementationTargetReference(target),
        }),
        blocker,
    });
}
function targetTaskIdFromPostAcceptanceStage(stage) {
    switch (stage.status) {
        case "completion-preflight":
        case "test-task-planning":
            return null;
        case "test-delivery-planning":
            return stage.testTask.targetTaskId;
        case "test-host-effect-execution":
        case "test-result-planning":
            return stage.testDelivery.targetTaskId;
        case "test-result-review-planning":
            return stage.testResult.targetTaskId;
        case "test-another-attempt-planning":
        case "test-review-blocked":
        case "test-review-escalated":
            return stage.testReview.targetTaskId;
        case "test-delivery-rearm-planning":
            return stage.rejectedDelivery.targetTaskId;
    }
}
function postAcceptanceFrontier(loaded, route) {
    const stage = route.nextStage;
    if (stage.status === "not-ready")
        fail("relation");
    const descriptor = resolveDemandControllerPostAcceptanceFrontierDescriptor(stage.status);
    if (descriptor.scope === "demand") {
        return descriptor;
    }
    const targetTaskId = targetTaskIdFromPostAcceptanceStage(stage);
    const target = targetTaskId === null
        ? undefined
        : loaded.aggregate.state.targetTasks.find((entry) => entry.workType === "test" && entry.targetTaskId === targetTaskId);
    if (target === undefined || target.workType !== "test")
        fail("relation");
    return Object.freeze({
        ...descriptor,
        target: testTargetReference(target),
    });
}
/** test-review-blocked 前沿携带外部条件阻塞项；其余 post-acceptance 前沿没有阻塞项。 */
function postAcceptanceBlocker(route) {
    const stage = route.nextStage;
    if (stage.status !== "test-review-blocked")
        return null;
    return Object.freeze({
        kind: "external-condition",
        owner: "controller-test-review",
        targetTaskId: stage.testReview.targetTaskId,
        targetReviewDecisionId: stage.testReview.targetReviewDecisionId,
        decisionDigest: stage.testReview.decisionDigest,
    });
}
function frontierSortKey(frontier) {
    return frontier.scope === "demand"
        ? `0\u0000${frontier.kind}`
        : `1\u0000${frontier.target.targetTaskId}\u0000${frontier.kind}`;
}
function sortedFrontiers(values) {
    return Object.freeze([...values].sort((left, right) => {
        const leftKey = frontierSortKey(left);
        const rightKey = frontierSortKey(right);
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    }));
}
function routeBasis(loaded, postAcceptanceRoute) {
    const lifecycle = loaded.aggregate.state.lifecycle;
    const common = {
        kind: DEMAND_CONTROLLER_ROUTE_KIND,
        schemaVersion: DEMAND_CONTROLLER_ROUTE_SCHEMA_VERSION,
        programId: loaded.identity.programId,
        demandId: loaded.identity.demandId,
        demandType: loaded.identity.demandType,
        lifecycle,
        authorityDigest: loaded.authorityDigest,
        observedEventStream: postAcceptanceRoute.observedEventStream,
        reviewSnapshotDigest: postAcceptanceRoute.reviewSnapshotDigest,
    };
    if (lifecycle === "cancelled" || lifecycle === "completed") {
        if (postAcceptanceRoute.nextStage.status !== "not-ready" ||
            postAcceptanceRoute.nextStage.reason !== `demand-${lifecycle}`) {
            fail("relation");
        }
        return {
            ...common,
            disposition: "terminal",
            frontiers: Object.freeze([]),
            blockers: Object.freeze([]),
        };
    }
    const awaitingDecision = loaded.aggregate.state.awaitingDecision;
    if (awaitingDecision !== undefined) {
        return {
            ...common,
            disposition: "awaiting-decision",
            frontiers: Object.freeze([
                Object.freeze({
                    scope: "demand",
                    kind: "decision-required",
                    owner: "user",
                }),
            ]),
            blockers: Object.freeze([
                Object.freeze({
                    kind: "awaiting-decision",
                    owner: "user",
                    escalationEventId: awaitingDecision.escalationEventId,
                }),
            ]),
        };
    }
    if (loaded.aggregate.state.continuation?.planningRequired === true) {
        // 续接后先规划新的任务包；已接受的历史目标不再构成完成前置。
        return {
            ...common,
            disposition: "work-available",
            frontiers: Object.freeze([
                resolveDemandControllerDemandFrontierDescriptor("implementation-planning-required"),
            ]),
            blockers: Object.freeze([]),
        };
    }
    const implementationTargets = loaded.aggregate.state.targetTasks.filter(isImplementationTarget);
    if (implementationTargets.length === 0) {
        if (loaded.identity.demandType === "research") {
            const stage = postAcceptanceRoute.nextStage;
            const frontiers = Object.freeze([
                resolveDemandControllerDemandFrontierDescriptor("research-completion-required"),
            ]);
            if (stage.status === "completion-preflight" && stage.testingClosure.mode === "not-applicable") {
                return { ...common, disposition: "work-available", frontiers, blockers: Object.freeze([]) };
            }
            if (stage.status !== "not-ready" || stage.reason !== "research-evidence-missing") {
                fail("relation");
            }
            return {
                ...common,
                disposition: "blocked",
                frontiers,
                blockers: Object.freeze([
                    Object.freeze({
                        kind: "research-evidence-missing",
                        owner: "demand-lifecycle",
                    }),
                ]),
            };
        }
        if (postAcceptanceRoute.nextStage.status !== "not-ready" ||
            postAcceptanceRoute.nextStage.reason !== "no-target-tasks") {
            fail("relation");
        }
        return {
            ...common,
            disposition: "work-available",
            frontiers: Object.freeze([
                resolveDemandControllerDemandFrontierDescriptor("implementation-planning-required"),
            ]),
            blockers: Object.freeze([]),
        };
    }
    const openImplementationTargets = implementationTargets.filter((target) => target.phase !== "accepted" && target.phase !== "superseded");
    if (openImplementationTargets.length > 0) {
        if (postAcceptanceRoute.nextStage.status !== "not-ready" ||
            postAcceptanceRoute.nextStage.reason !== "targets-not-accepted") {
            fail("relation");
        }
        const frontiers = [];
        const blockers = [];
        for (const target of openImplementationTargets) {
            const mapped = implementationFrontier(target);
            if (mapped.frontier !== null)
                frontiers.push(mapped.frontier);
            if (mapped.blocker !== null)
                blockers.push(mapped.blocker);
        }
        if (frontiers.length !== openImplementationTargets.length) {
            fail("relation");
        }
        return {
            ...common,
            disposition: blockers.length === frontiers.length ? "blocked" : "work-available",
            frontiers: sortedFrontiers(frontiers),
            blockers: Object.freeze(blockers),
        };
    }
    if (postAcceptanceRoute.nextStage.status === "not-ready")
        fail("relation");
    const postAcceptanceFrontierValue = postAcceptanceFrontier(loaded, postAcceptanceRoute);
    const blocker = postAcceptanceBlocker(postAcceptanceRoute);
    return {
        ...common,
        postAcceptanceRouteDigest: postAcceptanceRoute.routeDigest,
        disposition: blocker === null ? "work-available" : "blocked",
        frontiers: Object.freeze([postAcceptanceFrontierValue]),
        blockers: Object.freeze(blocker === null ? [] : [blocker]),
    };
}
/** 从同一次已验证Authority与Review Snapshot构造确定性的Controller责任Route。 */
export function buildDemandControllerRoute(loaded, snapshot) {
    let postAcceptanceRoute;
    try {
        postAcceptanceRoute = buildDemandPostAcceptanceRoute(loaded, snapshot);
    }
    catch (error) {
        if (error instanceof DemandPostAcceptanceRouteError) {
            fail("post-acceptance-route");
        }
        throw error;
    }
    const basis = routeBasis(loaded, postAcceptanceRoute);
    return Object.freeze({
        ...basis,
        routeDigest: computeCanonicalJsonSha256Digest(basis),
    });
}
