import { types } from "node:util";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { closeDemandOperationAuthorityContext, openDemandOperationAuthorityContext, DemandOperationAuthorityContextError, } from "../demand/demand-operation-authority-context.js";
import { currentTestTargetsOf, } from "../demand/model/demand-aggregate-state.js";
import { TEST_ENVIRONMENT_AUTHORITY_ROLE, } from "../demand/model/demand-authority.js";
import { readDemandResultReviewSnapshot, DemandResultReviewSnapshotError, } from "./demand-result-review-snapshot.js";
/**
 * Wakeflow Governance / Review：Controller完成Implementation或Test审查后的下一阶段路由读模型。
 *
 * 本模块只根据冻结Demand Authority和完整Review Snapshot选择下一位业务owner。它不创建
 * test 任务包、不提交completion Event、不解释或返回测试环境正文，也不把`accepted`解释为Demand已经完成。
 * `completion-preflight`明确携带controller-only或real-environment Test closure；它只表示
 * Completion owner可以开始当前准入，不表示Demand已经完成。所有planning状态都只是后续
 * owner的准入入口。
 */
const ROUTE_KIND = "WakeflowDemandPostAcceptanceRoute";
const ROUTE_SCHEMA_VERSION = 1;
const ERROR_MESSAGES = {
    input: "Demand post-acceptance route input is invalid.",
    root: "Demand post-acceptance route root could not be held safely.",
    config: "Demand post-acceptance route Config authority is invalid.",
    "demand-authority": "Demand post-acceptance route Demand authority is invalid.",
    review: "Demand post-acceptance route Review Snapshot is invalid.",
    relation: "Demand post-acceptance route sources are inconsistent.",
    aborted: "Demand post-acceptance route read was aborted.",
    "operation-failure": "Demand post-acceptance route read failed.",
};
/** Accepted后路由无法由当前Authority与Review事实安全重建时的稳定错误。 */
export class DemandPostAcceptanceRouteError extends Error {
    name = "DemandPostAcceptanceRouteError";
    code = "wakeflow-demand-post-acceptance-route";
    reason;
    constructor(reason) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
    }
}
function fail(reason) {
    throw new DemandPostAcceptanceRouteError(reason);
}
function targetPhase(target) {
    return target.status === "reported"
        ? target.taskPackage.workType === "test"
            ? "test-result-reported"
            : "result-reported"
        : target.phase;
}
function targetWorkType(target) {
    return target.status === "awaiting-result"
        ? target.workType
        : target.taskPackage.workType;
}
function acceptedTarget(target) {
    if (target.status !== "review-decided" ||
        target.phase !== "accepted" ||
        target.reviewDecision.decision !== "accept" ||
        target.taskPackage.workType !== "implementation" ||
        target.targetResult.workType !== "implementation") {
        return null;
    }
    return Object.freeze({
        targetTaskId: target.targetTaskId,
        taskPackageId: target.taskPackage.taskPackageId,
        taskPackageDigest: target.targetResult.taskPackage.digest,
        repositoryId: target.targetResult.assignment.repositoryId,
        windowId: target.targetResult.assignment.windowId,
        targetResultId: target.targetResult.targetResultId,
        resultDigest: target.targetResult.resultDigest,
        targetReviewDecisionId: target.reviewDecision.targetReviewDecisionId,
        decisionDigest: target.reviewDecision.decisionDigest,
    });
}
function blockingTarget(target) {
    return Object.freeze({
        targetTaskId: target.targetTaskId,
        taskPackageId: target.taskPackage.taskPackageId,
        taskPackageDigest: target.status === "awaiting-result"
            ? target.taskPackage.digest
            : target.targetResult.taskPackage.digest,
        phase: targetPhase(target),
    });
}
/** 真实环境测试的环境权威是需求包里唯一的环境角色成员，且其摘要与Ledger记录一致。 */
export function resolveDemandTestEnvironmentAuthority(loaded) {
    const candidates = loaded.admittedAuthority.resolvedAuthority.filter((entry) => entry.reference.role === TEST_ENVIRONMENT_AUTHORITY_ROLE);
    const source = candidates[0];
    if (loaded.authority.testingDecision.environmentMemberRef !== null ||
        candidates.length !== 1 ||
        source === undefined ||
        source.reference.memberDigest !==
            source.record.documents.find((document) => document.memberRef === source.reference.memberRef)?.digest) {
        fail("relation");
    }
    return source.reference;
}
function nextStage(loaded, snapshot, blockingTargets) {
    if (snapshot.demand.lifecycle === "cancelled") {
        return Object.freeze({
            status: "not-ready",
            reason: "demand-cancelled",
            blockingTargets,
        });
    }
    if (snapshot.demand.lifecycle === "completed") {
        return Object.freeze({
            status: "not-ready",
            reason: "demand-completed",
            blockingTargets,
        });
    }
    if (loaded.authority.testingDecision.mode === "not-applicable") {
        return researchStage(loaded, blockingTargets);
    }
    if (snapshot.targets.every((target) => targetWorkType(target) !== "implementation")) {
        return Object.freeze({
            status: "not-ready",
            reason: "no-target-tasks",
            blockingTargets,
        });
    }
    if (blockingTargets.length > 0) {
        return Object.freeze({
            status: "not-ready",
            reason: "targets-not-accepted",
            blockingTargets,
        });
    }
    const state = loaded.aggregate.state;
    // 续接前的 test 目标是上一轮的历史，只看当前测试代际。
    const testTargets = currentTestTargetsOf(state).filter((target) => target.workType === "test");
    if (loaded.authority.testingDecision.mode === "controller-only") {
        if (testTargets.length > 0 || state.pendingTestRetest !== undefined) {
            fail("relation");
        }
        return Object.freeze({
            status: "completion-preflight",
            testingClosure: Object.freeze({ mode: "controller-only" }),
        });
    }
    // 同一时间只有一个未终结的 test 目标；历史代际只能停在 test-product-defect。
    const openTestTargets = testTargets.filter((target) => target.phase !== "test-product-defect");
    if (openTestTargets.length > 1)
        fail("relation");
    const testTarget = openTestTargets[0];
    if (testTarget === undefined) {
        return closedTestStage(loaded, testTargets);
    }
    return openTestStage(testTarget);
}
/**
 * research Demand 没有测试环节：实现目标（若有）全部接受，且至少一条 document 类受管证据
 * 之后进入完成预检，测试闭合记为 `not-applicable`（§13.94 D8）。
 */
function researchStage(loaded, blockingTargets) {
    if (blockingTargets.length > 0) {
        return Object.freeze({
            status: "not-ready",
            reason: "targets-not-accepted",
            blockingTargets,
        });
    }
    const documents = (loaded.aggregate.state.managedEvidence ?? []).filter((summary) => summary.kind === "document");
    if (documents.length === 0) {
        return Object.freeze({
            status: "not-ready",
            reason: "research-evidence-missing",
            blockingTargets,
        });
    }
    return Object.freeze({
        status: "completion-preflight",
        testingClosure: Object.freeze({ mode: "not-applicable" }),
    });
}
/**
 * 没有未终结 test 目标：待消费复测或首个合同交给 test 任务规划。缺陷修复授权与
 * `escalate{product-defect}` 同一提交落地（§13.87 D5），因此历史缺陷代际之后要么有待消费
 * 的复测，要么已被 retest 谱系消费；其他组合是不一致的事件流。
 */
function closedTestStage(loaded, testTargets) {
    const pendingTestRetest = loaded.aggregate.state.pendingTestRetest;
    if (pendingTestRetest === undefined && testTargets.length !== 0) {
        fail("relation");
    }
    return Object.freeze({
        status: "test-task-planning",
        testEnvironmentAuthority: resolveDemandTestEnvironmentAuthority(loaded),
        retest: pendingTestRetest ?? null,
    });
}
function testDelivery(target) {
    return Object.freeze({
        targetTaskId: target.targetTaskId,
        taskPackageId: target.taskPackageId,
        taskPackageDigest: target.taskPackageDigest,
        deliveryId: target.currentDelivery.deliveryId,
        envelopeDigest: target.currentDelivery.envelopeDigest,
        generation: target.currentDelivery.generation,
        fence: Object.freeze({
            claimId: target.currentDelivery.fence.claimId,
            claimDigest: target.currentDelivery.fence.claimDigest,
        }),
        testAttemptId: target.currentDelivery.testAttemptId,
        testWindowId: target.windowId,
    });
}
function reviewedTest(target) {
    return Object.freeze({
        targetTaskId: target.targetTaskId,
        taskPackageId: target.taskPackageId,
        taskPackageDigest: target.taskPackageDigest,
        testAttemptId: target.currentDelivery.testAttemptId,
        testWindowId: target.windowId,
        targetResultId: target.currentDelivery.targetResult.targetResultId,
        resultDigest: target.currentDelivery.targetResult.resultDigest,
        targetReviewDecisionId: target.currentDelivery.reviewDecision.targetReviewDecisionId,
        decisionDigest: target.currentDelivery.reviewDecision.decisionDigest,
    });
}
/** 唯一未终结 test 目标按其阶段决定下一位 owner。 */
function openTestStage(testTarget) {
    switch (testTarget.phase) {
        case "planned":
            return Object.freeze({
                status: "test-delivery-planning",
                testTask: Object.freeze({
                    targetTaskId: testTarget.targetTaskId,
                    taskPackageId: testTarget.taskPackageId,
                    taskPackageDigest: testTarget.taskPackageDigest,
                    testWindowId: testTarget.windowId,
                }),
            });
        case "test-delivery-prepared":
            return Object.freeze({
                status: "test-host-effect-execution",
                testDelivery: testDelivery(testTarget),
            });
        case "test-host-effect-accepted":
        case "test-host-effect-indeterminate":
            return Object.freeze({
                status: "test-result-planning",
                testDelivery: Object.freeze({
                    ...testDelivery(testTarget),
                    outcomeDigest: testTarget.currentDelivery.outcome.outcomeDigest,
                    disposition: testTarget.phase === "test-host-effect-accepted"
                        ? "accepted"
                        : "indeterminate",
                    readbackStatus: testTarget.currentDelivery.outcome.readbackStatus,
                }),
            });
        case "test-host-effect-rejected":
            return Object.freeze({
                status: "test-delivery-rearm-planning",
                rejectedDelivery: Object.freeze({
                    ...testDelivery(testTarget),
                    outcomeDigest: testTarget.currentDelivery.outcome.outcomeDigest,
                }),
            });
        case "test-result-reported":
            return Object.freeze({
                status: "test-result-review-planning",
                testResult: Object.freeze({
                    targetTaskId: testTarget.targetTaskId,
                    taskPackageId: testTarget.taskPackageId,
                    taskPackageDigest: testTarget.taskPackageDigest,
                    deliveryId: testTarget.currentDelivery.deliveryId,
                    testAttemptId: testTarget.currentDelivery.testAttemptId,
                    targetResultId: testTarget.currentDelivery.targetResult.targetResultId,
                    resultDigest: testTarget.currentDelivery.targetResult.resultDigest,
                    outcome: testTarget.currentDelivery.targetResult.outcome,
                }),
            });
        case "test-accepted":
            return Object.freeze({
                status: "completion-preflight",
                testingClosure: Object.freeze({
                    mode: "real-environment",
                    testReview: reviewedTest(testTarget),
                }),
            });
        case "test-another-attempt-requested":
            return Object.freeze({
                status: "test-another-attempt-planning",
                testReview: reviewedTest(testTarget),
            });
        case "test-review-blocked":
            return Object.freeze({
                status: "test-review-blocked",
                testReview: reviewedTest(testTarget),
            });
        case "test-escalated":
            return Object.freeze({
                status: "test-review-escalated",
                testReview: reviewedTest(testTarget),
            });
        case "test-product-defect":
            // 缺陷代际不是未终结目标；调用方已按 phase 过滤。
            fail("relation");
    }
}
function routeBasis(loaded, snapshot) {
    const { snapshotDigest: suppliedSnapshotDigest, ...snapshotBasis } = snapshot;
    if (computeCanonicalJsonSha256Digest(snapshotBasis) !==
        suppliedSnapshotDigest ||
        loaded.identity.demandId !== snapshot.demand.demandId ||
        loaded.aggregate.demandId !== snapshot.demand.demandId ||
        loaded.aggregate.state.lifecycle !== snapshot.demand.lifecycle ||
        loaded.aggregate.streamRevision !== snapshot.eventStream.streamRevision ||
        loaded.aggregate.stateDigest !== snapshot.eventStream.stateDigest ||
        loaded.aggregate.lastEvent.eventId !== snapshot.eventStream.lastEventId ||
        loaded.aggregate.lastEventDigest !== snapshot.eventStream.lastEventDigest ||
        loaded.aggregate.state.targetTasks.length !== snapshot.targets.length ||
        loaded.aggregate.state.targetTasks.some((target, index) => target.targetTaskId !== snapshot.targets[index]?.targetTaskId)) {
        fail("relation");
    }
    const acceptedTargets = [];
    const blockingTargets = [];
    for (const target of snapshot.targets) {
        if (targetWorkType(target) !== "implementation")
            continue;
        // 被替代的目标是历史，既不阻塞也不计入 accepted。
        if (target.status === "awaiting-result" && target.phase === "superseded")
            continue;
        const accepted = acceptedTarget(target);
        if (accepted === null) {
            blockingTargets.push(blockingTarget(target));
        }
        else {
            acceptedTargets.push(accepted);
        }
    }
    return {
        kind: ROUTE_KIND,
        schemaVersion: ROUTE_SCHEMA_VERSION,
        programId: loaded.identity.programId,
        demandId: loaded.identity.demandId,
        demandType: loaded.identity.demandType,
        authorityDigest: loaded.authorityDigest,
        testingDecision: loaded.authority.testingDecision,
        reviewSnapshotDigest: snapshot.snapshotDigest,
        observedEventStream: Object.freeze({
            streamRevision: snapshot.eventStream.streamRevision,
            stateDigest: snapshot.eventStream.stateDigest,
            lastEventId: snapshot.eventStream.lastEventId,
            lastEventDigest: snapshot.eventStream.lastEventDigest,
        }),
        acceptedTargets: Object.freeze(acceptedTargets),
        nextStage: nextStage(loaded, snapshot, blockingTargets),
    };
}
/** 从已验证Demand根Authority和同修订Review Snapshot构造确定性路由。 */
export function buildDemandPostAcceptanceRoute(loaded, snapshot) {
    const basis = routeBasis(loaded, snapshot);
    return Object.freeze({
        ...basis,
        routeDigest: computeCanonicalJsonSha256Digest(basis),
    });
}
function parseInput(workspaceRootValue, demandIdValue, optionsValue) {
    if (typeof workspaceRootValue !== "object" ||
        workspaceRootValue === null ||
        types.isProxy(workspaceRootValue) ||
        !(workspaceRootValue instanceof RootedDirectory)) {
        fail("input");
    }
    let demandId;
    try {
        demandId = parseWakeflowDurableIdOfKind(demandIdValue, "demand", "$demandId");
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("input");
        throw error;
    }
    let options;
    try {
        options = parsePlainRecord(optionsValue === undefined ? {} : optionsValue, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input");
        throw error;
    }
    if (Object.keys(options).some((key) => key !== "signal") ||
        (options.signal !== undefined &&
            (typeof options.signal !== "object" ||
                options.signal === null ||
                types.isProxy(options.signal) ||
                !(options.signal instanceof AbortSignal)))) {
        fail("input");
    }
    const signal = options.signal;
    if (signal?.aborted === true)
        fail("aborted");
    return Object.freeze({
        workspaceRoot: workspaceRootValue,
        demandId,
        signal,
    });
}
function mapContextError(error) {
    if (error.reason === "root")
        fail("root");
    if (error.reason === "config" || error.reason === "stale-config") {
        fail("config");
    }
    if (error.reason === "demand-authority")
        fail("demand-authority");
    fail("aborted");
}
/**
 * 零写读取当前Demand的post-acceptance下一阶段路由；任何后续owner都必须重新复验其
 * `authorityDigest + reviewSnapshotDigest + observedEventStream`，不能把本读模型当成写许可。
 */
export async function readDemandPostAcceptanceRoute(workspaceRootValue, demandIdValue, optionsValue) {
    const input = parseInput(workspaceRootValue, demandIdValue, optionsValue);
    let context;
    try {
        context = await openDemandOperationAuthorityContext(input.workspaceRoot, input.demandId, input.signal);
    }
    catch (error) {
        if (error instanceof DemandOperationAuthorityContextError) {
            mapContextError(error);
        }
        throw error;
    }
    let result;
    let failure;
    try {
        let snapshot;
        try {
            snapshot = await readDemandResultReviewSnapshot(context.demandRoot, input.signal === undefined ? undefined : { signal: input.signal });
        }
        catch (error) {
            if (error instanceof DemandResultReviewSnapshotError) {
                if (error.reason === "aborted")
                    fail("aborted");
                fail("review");
            }
            throw error;
        }
        result = buildDemandPostAcceptanceRoute(context.loaded, snapshot);
    }
    catch (error) {
        failure = error;
    }
    try {
        await closeDemandOperationAuthorityContext(context);
    }
    catch (error) {
        if (failure === undefined) {
            if (error instanceof DemandOperationAuthorityContextError) {
                mapContextError(error);
            }
            failure = error;
        }
    }
    if (failure !== undefined)
        throw failure;
    if (result === undefined)
        fail("operation-failure");
    return result;
}
