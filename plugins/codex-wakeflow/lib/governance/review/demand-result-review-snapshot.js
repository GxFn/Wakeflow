import { types } from "node:util";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { DemandEventSourcingRepository, DemandEventSourcingRepositoryError, } from "../demand/event-sourcing/demand-event-sourcing-repository.js";
/**
 * Wakeflow Governance / Review：从Demand Event Stream即时重建的结果审查读模型。
 *
 * Snapshot把当前Aggregate选择的Target Task与完整TaskPackage、TargetResult及已有Review
 * Decision事件闭合，供Controller读取审查输入和既有决定。它是零写、可丢弃、可重建的
 * CQRS读模型，不生成ReviewCandidate、Controller决定或acceptance，也不推导allowed
 * decisions和next action。
 */
const SNAPSHOT_KIND = "WakeflowDemandResultReviewSnapshot";
const SNAPSHOT_SCHEMA_VERSION = 1;
const ERROR_MESSAGES = {
    input: "Demand Result Review Snapshot input is invalid.",
    stream: "Demand Result Review Snapshot event stream is invalid.",
    relation: "Demand Result Review Snapshot sources are inconsistent.",
    aborted: "Demand Result Review Snapshot was aborted.",
    "operation-failure": "Demand Result Review Snapshot failed.",
};
/** 结果审查读模型无法由当前Event Stream安全重建时的稳定错误。 */
export class DemandResultReviewSnapshotError extends Error {
    name = "DemandResultReviewSnapshotError";
    code = "wakeflow-demand-result-review-snapshot";
    reason;
    constructor(reason) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
    }
}
function fail(reason) {
    throw new DemandResultReviewSnapshotError(reason);
}
function parseSignal(value) {
    let record;
    try {
        record = parsePlainRecord(value === undefined ? {} : value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input");
        throw error;
    }
    if (Object.keys(record).some((key) => key !== "signal") ||
        (record.signal !== undefined &&
            (typeof record.signal !== "object" ||
                record.signal === null ||
                types.isProxy(record.signal) ||
                !(record.signal instanceof AbortSignal)))) {
        fail("input");
    }
    return record.signal;
}
function assertRoot(value) {
    if (typeof value !== "object" ||
        value === null ||
        types.isProxy(value) ||
        !(value instanceof RootedDirectory)) {
        fail("input");
    }
}
function lexicalCompare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function reportedTargetBasis(targetTaskId, taskPackageSourceEvent, taskPackage, targetResultSourceEvent, targetResult, priorReviewHistory) {
    return {
        status: "reported",
        targetTaskId,
        outcome: targetResult.report.outcome,
        taskPackageSourceEvent,
        taskPackage,
        targetResultSourceEvent,
        targetResult,
        priorReviewHistory,
    };
}
function priorReviewHistory(sources, targetTaskId, beforeStreamRevision) {
    const decisions = sources.targetReviewDecisions
        .filter((entry) => entry.decision.targetTaskId === targetTaskId &&
        (beforeStreamRevision === null ||
            entry.sourceEvent.streamRevision < beforeStreamRevision))
        .map((entry) => Object.freeze({
        sourceEvent: entry.sourceEvent,
        decision: entry.decision,
    }));
    return Object.freeze(decisions.sort((left, right) => left.sourceEvent.streamRevision - right.sourceEvent.streamRevision));
}
function isResultBearingTarget(target) {
    return (target.phase === "result-reported" ||
        target.phase === "test-result-reported" ||
        target.phase === "accepted" ||
        target.phase === "product-defect-rework-requested" ||
        target.phase === "rework-requested" ||
        target.phase === "escalated" ||
        target.phase === "review-blocked" ||
        target.phase === "test-accepted" ||
        target.phase === "test-another-attempt-requested" ||
        target.phase === "test-product-defect" ||
        target.phase === "test-review-blocked" ||
        target.phase === "test-escalated");
}
function buildTargets(sources) {
    const taskPackageById = new Map(sources.taskPackages.map((source) => [source.taskPackage.taskPackageId, source]));
    const targetResultById = new Map(sources.targetResults.map((source) => [source.result.targetResultId, source]));
    const reviewDecisionById = new Map(sources.targetReviewDecisions.map((source) => [source.decision.targetReviewDecisionId, source]));
    const targets = sources.aggregate.state.targetTasks.map((target) => {
        const taskPackageSource = taskPackageById.get(target.taskPackageId);
        if (taskPackageSource === undefined ||
            taskPackageSource.taskPackage.targetTaskId !== target.targetTaskId ||
            (taskPackageSource.taskPackage.workType === "test") !==
                (target.workType === "test") ||
            taskPackageSource.taskPackage.assignment.windowId !== target.windowId ||
            (taskPackageSource.taskPackage.workType === "implementation" &&
                (target.workType === "test" ||
                    taskPackageSource.taskPackage.assignment.repositoryId !==
                        target.repositoryId)) ||
            (taskPackageSource.taskPackage.workType === "test" && target.workType !== "test")) {
            fail("relation");
        }
        if (!isResultBearingTarget(target)) {
            return Object.freeze({
                status: "awaiting-result",
                phase: target.phase,
                workType: target.workType === "test" ? "test" : "implementation",
                targetTaskId: target.targetTaskId,
                taskPackage: Object.freeze({
                    taskPackageId: target.taskPackageId,
                    digest: target.taskPackageDigest,
                }),
                assignment: taskPackageSource.taskPackage.assignment,
            });
        }
        const targetResultSource = targetResultById.get(target.currentDelivery.targetResult.targetResultId);
        if (targetResultSource === undefined ||
            (targetResultSource.result.workType === "test") !==
                (target.workType === "test") ||
            targetResultSource.result.targetTaskId !== target.targetTaskId ||
            targetResultSource.result.taskPackage.taskPackageId !==
                taskPackageSource.taskPackage.taskPackageId ||
            targetResultSource.result.taskPackage.digest !==
                target.taskPackageDigest ||
            targetResultSource.result.resultDigest !==
                target.currentDelivery.targetResult.resultDigest) {
            fail("relation");
        }
        if (target.phase === "result-reported" ||
            target.phase === "test-result-reported") {
            const reportedBasis = reportedTargetBasis(target.targetTaskId, taskPackageSource.sourceEvent, taskPackageSource.taskPackage, targetResultSource.sourceEvent, targetResultSource.result, priorReviewHistory(sources, target.targetTaskId, null));
            return Object.freeze({
                ...reportedBasis,
                reviewUnitDigest: computeCanonicalJsonSha256Digest(reportedBasis),
            });
        }
        const decisionSource = reviewDecisionById.get(target.currentDelivery.reviewDecision.targetReviewDecisionId);
        if (decisionSource === undefined ||
            (decisionSource.decision.kind ===
                "WakeflowControllerTestReviewDecision") !==
                (target.workType === "test") ||
            decisionSource.decision.targetTaskId !== target.targetTaskId ||
            decisionSource.decision.reviewed.targetResultId !==
                targetResultSource.result.targetResultId ||
            decisionSource.decision.decisionDigest !==
                target.currentDelivery.reviewDecision.decisionDigest) {
            fail("relation");
        }
        const reportedBasis = reportedTargetBasis(target.targetTaskId, taskPackageSource.sourceEvent, taskPackageSource.taskPackage, targetResultSource.sourceEvent, targetResultSource.result, priorReviewHistory(sources, target.targetTaskId, decisionSource.sourceEvent.streamRevision));
        const reviewUnitDigest = computeCanonicalJsonSha256Digest(reportedBasis);
        if (decisionSource.decision.reviewed.reviewUnitDigest !== reviewUnitDigest) {
            fail("relation");
        }
        return Object.freeze({
            ...reportedBasis,
            status: "review-decided",
            phase: target.phase,
            reviewUnitDigest,
            reviewDecisionSourceEvent: decisionSource.sourceEvent,
            reviewDecision: decisionSource.decision,
        });
    });
    targets.sort((left, right) => lexicalCompare(left.targetTaskId, right.targetTaskId));
    return Object.freeze(targets);
}
function snapshotBasis(sources) {
    const aggregate = sources.aggregate;
    return {
        kind: SNAPSHOT_KIND,
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        demand: Object.freeze({
            demandId: aggregate.demandId,
            lifecycle: aggregate.state.lifecycle,
        }),
        eventStream: Object.freeze({
            commitSequence: aggregate.commitSequence,
            streamRevision: aggregate.streamRevision,
            lastCommitDigest: aggregate.lastCommitDigest,
            lastEventId: aggregate.lastEvent.eventId,
            lastEventDigest: aggregate.lastEventDigest,
            stateDigest: aggregate.stateDigest,
        }),
        targets: buildTargets(sources),
    };
}
/** 从Repository同一次完整审计结果构造零写Review Snapshot。 */
export function buildDemandResultReviewSnapshotFromHistory(sources) {
    const basis = snapshotBasis(sources);
    return Object.freeze({
        ...basis,
        snapshotDigest: computeCanonicalJsonSha256Digest(basis),
    });
}
/**
 * 完整审计一个已经打开的Demand Event Sourcing根，并返回零写的当前结果审查快照。
 */
export async function readDemandResultReviewSnapshot(rootValue, options) {
    assertRoot(rootValue);
    const signal = parseSignal(options);
    let sources;
    try {
        sources = await new DemandEventSourcingRepository(rootValue).auditTargetResultHistory(signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (error instanceof DemandEventSourcingRepositoryError) {
            if (error.reason === "input")
                fail("input");
            if (error.reason === "aborted")
                fail("aborted");
            if (error.reason === "stream" || error.reason === "not-found") {
                fail("stream");
            }
            fail("operation-failure");
        }
        throw error;
    }
    return buildDemandResultReviewSnapshotFromHistory(sources);
}
