import { types } from "node:util";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../../contracts/identity/wakeflow-durable-id.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../../../foundation/data/passive-own-data.js";
import { RootedDirectory } from "../../../foundation/filesystem/rooted-directory.js";
import { computeTaskPackageDigest, } from "../../tasking/task-package.js";
import { applyDemandEventStreamCommit, DemandEventStreamCommitError, } from "./demand-event-stream-commit.js";
import { createDemandEventSourcingSnapshot, restoreDemandEventSourcingSnapshot, DemandEventSourcingSnapshotError, } from "./demand-event-sourcing-snapshot.js";
import { DemandFileEventStore, DemandFileEventStoreError, } from "./demand-file-event-store.js";
import { DemandFileEventSnapshotStore, DemandFileEventSnapshotStoreError, } from "./demand-file-event-snapshot-store.js";
import { computeDemandEventSourcingStoredEventDigest, } from "./demand-event-sourcing-stored-event.js";
import { upcastDemandEventSourcingStoredEvent, DemandEventSourcingUpcasterError, } from "./demand-event-sourcing-upcaster.js";
import { computeDemandEventStreamCommitDigest } from "./demand-event-stream-commit.js";
/**
 * Wakeflow Governance / Demand Event Sourcing：聚合仓储。
 *
 * 正常加载选择最新可用的不可变快照，只打开它的锚定提交和后续事件流尾部；审计始终
 * 从提交 1 完整重放。仓储不会在加载过程中写入快照、不决定命令、不访问 Ledger 或
 * 看板认领，也不执行 Demand 根目录发布。
 */
/** 快照保留的最新份数与清扫周期；快照是可重建缓存。 */
const SNAPSHOT_RETENTION = 2;
const CHECKPOINT_SWEEP_INTERVAL = 16;
function taskPackageMatchesTargetSummary(taskPackage, target) {
    if ((taskPackage.workType === "test") !== (target.workType === "test") ||
        taskPackage.targetTaskId !== target.targetTaskId ||
        taskPackage.assignment.windowId !== target.windowId) {
        return false;
    }
    if (taskPackage.workType === "test") {
        return target.workType === "test";
    }
    return (target.workType !== "test" &&
        taskPackage.assignment.repositoryId === target.repositoryId &&
        taskPackage.commitExpectation === target.commitExpectation &&
        taskPackage.acceptanceAnchors.length ===
            target.acceptanceAnchorIds.length &&
        taskPackage.acceptanceAnchors.every((anchor, index) => anchor.anchorId === target.acceptanceAnchorIds[index]));
}
const ERROR_MESSAGES = {
    input: "Demand Event Sourcing Repository input is invalid.",
    "not-found": "Demand Event Sourcing stream does not exist.",
    stream: "Demand Event Sourcing stream cannot be rehydrated.",
    snapshot: "Demand Event Sourcing snapshot cannot be published.",
    aborted: "Demand Event Sourcing Repository operation was aborted.",
    "operation-failure": "Demand Event Sourcing Repository operation failed.",
};
export class DemandEventSourcingRepositoryError extends Error {
    name = "DemandEventSourcingRepositoryError";
    code = "wakeflow-demand-event-sourcing-repository";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new DemandEventSourcingRepositoryError(reason, path);
}
function parseSignal(value) {
    let record;
    try {
        record = parsePlainRecord(value === undefined ? {} : value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    if (Object.keys(record).some((key) => key !== "signal") ||
        (record.signal !== undefined &&
            (typeof record.signal !== "object" ||
                record.signal === null ||
                types.isProxy(record.signal) ||
                !(record.signal instanceof AbortSignal)))) {
        fail("input", "$options");
    }
    return record.signal;
}
function replayCommits(initial, commits) {
    let aggregate = initial;
    for (const [index, commit] of commits.entries()) {
        try {
            aggregate = applyDemandEventStreamCommit(aggregate, commit);
        }
        catch (error) {
            if (error instanceof DemandEventStreamCommitError) {
                fail("stream", `$commits/${index}`);
            }
            throw error;
        }
    }
    if (aggregate === null)
        fail("not-found", "$commits");
    return aggregate;
}
function targetResultSourceEvent(storedEvent) {
    return Object.freeze({
        eventId: storedEvent.eventId,
        eventDigest: computeDemandEventSourcingStoredEventDigest(storedEvent),
        streamRevision: storedEvent.streamRevision,
    });
}
function mapStoreError(error) {
    if (error instanceof DemandFileEventStoreError) {
        if (error.reason === "aborted")
            fail("aborted", "$signal");
        if (error.reason === "stream-invalid" ||
            error.reason === "stream-changed" ||
            error.reason === "node-policy" ||
            error.reason === "capacity") {
            fail("stream", "$commits");
        }
        fail("operation-failure", "$eventStore");
    }
    if (error instanceof DemandFileEventSnapshotStoreError) {
        if (error.reason === "aborted")
            fail("aborted", "$signal");
        fail("operation-failure", "$snapshotStore");
    }
    throw error;
}
export class DemandEventSourcingRepository {
    #eventStore;
    #snapshotStore;
    constructor(root) {
        if (typeof root !== "object" ||
            root === null ||
            types.isProxy(root) ||
            !(root instanceof RootedDirectory)) {
            fail("input", "$root");
        }
        this.#eventStore = new DemandFileEventStore(root);
        this.#snapshotStore = new DemandFileEventSnapshotStore(root);
    }
    /** 正常读取；不存在事件流时返回 `null`，读取过程中绝不创建或修复快照。 */
    async load(options) {
        const signal = parseSignal(options);
        // 快照是可重建缓存：并发的检查点刷新会让一次快照目录读取报告
        // stream-changed，此时立即重读一次；仍失败（含崩溃残留的暂存文件）则视为
        // 本次没有可用快照，退回完整重放并以 `snapshotStatus: "invalid"` 报告。
        // 缓存问题绝不变成加载失败；只有中止照常上抛。
        let observations = Object.freeze({ snapshots: Object.freeze([]) });
        let snapshotStoreFailed = false;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
            try {
                observations = await this.#snapshotStore.readSnapshots(signal === undefined ? undefined : { signal });
                snapshotStoreFailed = false;
                break;
            }
            catch (error) {
                if (!(error instanceof DemandFileEventSnapshotStoreError) ||
                    error.reason === "aborted") {
                    mapStoreError(error);
                }
                snapshotStoreFailed = true;
            }
        }
        const valid = observations.snapshots
            .filter((entry) => entry.status === "valid")
            .sort((left, right) => right.commitSequence - left.commitSequence);
        let snapshotAttemptFailed = observations.snapshots.some((entry) => entry.status === "invalid");
        if (snapshotStoreFailed)
            snapshotAttemptFailed = true;
        for (const observation of valid) {
            if (observation.status !== "valid")
                continue;
            try {
                const tail = await this.#eventStore.readCommitsAfter({
                    commitSequence: observation.snapshot.commitSequence,
                    streamRevision: observation.snapshot.streamRevision,
                    lastCommitDigest: observation.snapshot.lastCommitDigest,
                }, signal === undefined ? undefined : { signal });
                let aggregate = restoreDemandEventSourcingSnapshot(observation.snapshot, tail.anchorCommit);
                aggregate = replayCommits(aggregate, tail.commits);
                return Object.freeze({
                    aggregate,
                    snapshotStatus: "used",
                    snapshotCommitSequence: observation.snapshot.commitSequence,
                    replayedCommitCount: tail.commits.length,
                });
            }
            catch (error) {
                if (error instanceof DemandEventSourcingSnapshotError) {
                    snapshotAttemptFailed = true;
                    continue;
                }
                if (error instanceof DemandFileEventStoreError &&
                    error.reason === "stream-invalid") {
                    snapshotAttemptFailed = true;
                    continue;
                }
                if (error instanceof DemandFileEventStoreError)
                    mapStoreError(error);
                throw error;
            }
        }
        let stream;
        try {
            stream = await this.#eventStore.readCommits(signal === undefined ? undefined : { signal });
        }
        catch (error) {
            mapStoreError(error);
        }
        if (stream.commits.length === 0) {
            if (observations.snapshots.length !== 0)
                fail("stream", "$snapshots");
            return null;
        }
        const aggregate = replayCommits(null, stream.commits);
        return Object.freeze({
            aggregate,
            snapshotStatus: snapshotAttemptFailed
                ? "invalid"
                : "missing",
            snapshotCommitSequence: null,
            replayedCommitCount: stream.commits.length,
        });
    }
    /** 从提交 1 开始完整验证摘要链、事件转换和每一步结果状态。 */
    async audit(options) {
        const signal = parseSignal(options);
        let stream;
        try {
            stream = await this.#eventStore.readCommits(signal === undefined ? undefined : { signal });
        }
        catch (error) {
            mapStoreError(error);
        }
        if (stream.commits.length === 0)
            fail("not-found", "$commits");
        return Object.freeze({
            aggregate: replayCommits(null, stream.commits),
            replayedCommitCount: stream.commits.length,
        });
    }
    /**
     * 从提交1开始只扫描一次完整事件流，同时返回TaskPackage与TargetResult历史来源。
     *
     * 该查询不创建持久化读模型，也不解释Result的上层用途。Aggregate仍是current
     * selector；历史数组只提供消费者重建当前投影所需的不可变完整载荷。
     */
    async auditTargetResultHistory(options) {
        const signal = parseSignal(options);
        let stream;
        try {
            stream = await this.#eventStore.readCommits(signal === undefined ? undefined : { signal });
        }
        catch (error) {
            mapStoreError(error);
        }
        if (stream.commits.length === 0)
            fail("not-found", "$commits");
        const aggregate = replayCommits(null, stream.commits);
        const taskPackages = [];
        const targetResults = [];
        const targetReviewDecisions = [];
        const productDefectRemediationAuthorizations = [];
        const escalations = [];
        const decisionRecords = [];
        const taskPackageIds = new Set();
        const targetTaskIds = new Set();
        const targetDeliveryIds = new Set();
        const targetResultIds = new Set();
        const resultActionIds = new Set();
        const targetReviewDecisionIds = new Set();
        const reviewedGenerationKeys = new Set();
        const resumedDecisionIds = new Set();
        /** 每份结果回调的当前代际，随重发事件推进；最终必须与聚合摘要一致。 */
        const callbackByResultId = new Map();
        const productDefectRemediationIds = new Set();
        const remediatedTestDecisionIds = new Set();
        const storedEventByRevision = new Map();
        for (const commit of stream.commits) {
            for (const storedEvent of commit.events) {
                storedEventByRevision.set(storedEvent.streamRevision, storedEvent);
                let event;
                try {
                    event = upcastDemandEventSourcingStoredEvent(storedEvent);
                }
                catch (error) {
                    if (error instanceof DemandEventSourcingUpcasterError) {
                        fail("stream", "$events");
                    }
                    throw error;
                }
                if (event.eventType === "tasking.target-task-planned") {
                    const taskPackage = event.data.taskPackage;
                    if (taskPackageIds.has(taskPackage.taskPackageId) ||
                        targetTaskIds.has(taskPackage.targetTaskId)) {
                        fail("stream", "$events");
                    }
                    taskPackageIds.add(taskPackage.taskPackageId);
                    targetTaskIds.add(taskPackage.targetTaskId);
                    taskPackages.push(Object.freeze({
                        sourceEvent: targetResultSourceEvent(storedEvent),
                        taskPackage,
                    }));
                    continue;
                }
                if (event.eventType === "delivery.delivery-prepared") {
                    const deliveryId = event.data.envelope.deliveryId;
                    if (targetDeliveryIds.has(deliveryId)) {
                        fail("stream", "$events");
                    }
                    targetDeliveryIds.add(deliveryId);
                    continue;
                }
                if (event.eventType === "result.target-result-recorded") {
                    const result = event.data.result;
                    if (targetResultIds.has(result.targetResultId) ||
                        resultActionIds.has(result.delivery.fence.claimId)) {
                        fail("stream", "$events");
                    }
                    targetResultIds.add(result.targetResultId);
                    resultActionIds.add(result.delivery.fence.claimId);
                    callbackByResultId.set(result.targetResultId, event.data.callback);
                    targetResults.push(Object.freeze({
                        sourceEvent: targetResultSourceEvent(storedEvent),
                        result,
                        callback: event.data.callback,
                        evidenceResolution: event.data.evidenceResolution,
                    }));
                    continue;
                }
                if (event.eventType === "result.callback-reissued") {
                    const reissue = event.data.reissue;
                    const current = callbackByResultId.get(reissue.targetResultId);
                    if (current === undefined ||
                        current.callbackId !== reissue.callbackId ||
                        current.generation !== reissue.previousGeneration ||
                        current.promptDigest !== reissue.promptDigest) {
                        fail("stream", "$events");
                    }
                    callbackByResultId.set(reissue.targetResultId, reissue);
                    continue;
                }
                if (event.eventType === "review.target-result-decided") {
                    const decision = event.data.decision;
                    const generationKey = [
                        decision.reviewed.targetResultId,
                        decision.reviewed.snapshotDigest,
                    ].join("\u0000");
                    if (targetReviewDecisionIds.has(decision.targetReviewDecisionId) ||
                        reviewedGenerationKeys.has(generationKey)) {
                        fail("stream", "$events");
                    }
                    targetReviewDecisionIds.add(decision.targetReviewDecisionId);
                    reviewedGenerationKeys.add(generationKey);
                    // resumption 只指向同一目标上更早的 blocked 或 escalate 决定，且每份决定至多被续接一次。
                    const resumption = decision.resumption;
                    if (resumption !== null) {
                        const previous = targetReviewDecisions.find((entry) => entry.decision.targetReviewDecisionId ===
                            resumption.previousDecisionId);
                        if (previous === undefined ||
                            previous.decision.targetTaskId !== decision.targetTaskId ||
                            previous.decision.reviewed.targetResultId !==
                                decision.reviewed.targetResultId ||
                            resumedDecisionIds.has(resumption.previousDecisionId) ||
                            (resumption.basis.kind === "condition-cleared") !==
                                (previous.decision.decision === "blocked") ||
                            (resumption.basis.kind === "decision-recorded" &&
                                previous.decision.decision !== "escalate")) {
                            fail("stream", "$events");
                        }
                        resumedDecisionIds.add(resumption.previousDecisionId);
                    }
                    targetReviewDecisions.push(Object.freeze({
                        sourceEvent: targetResultSourceEvent(storedEvent),
                        decision,
                    }));
                    continue;
                }
                if (event.eventType === "lifecycle.demand-escalated") {
                    escalations.push(Object.freeze({
                        sourceEvent: targetResultSourceEvent(storedEvent),
                        escalation: event.data.escalation,
                    }));
                    continue;
                }
                if (event.eventType === "lifecycle.decision-recorded") {
                    decisionRecords.push(Object.freeze({
                        sourceEvent: targetResultSourceEvent(storedEvent),
                        decision: event.data.decision,
                    }));
                    continue;
                }
                if (event.eventType === "review.product-defect-remediation-authorized") {
                    const authorization = event.data.authorization;
                    if (productDefectRemediationIds.has(authorization.productDefectRemediationId) ||
                        remediatedTestDecisionIds.has(authorization.source.testReviewDecision.targetReviewDecisionId)) {
                        fail("stream", "$events");
                    }
                    productDefectRemediationIds.add(authorization.productDefectRemediationId);
                    remediatedTestDecisionIds.add(authorization.source.testReviewDecision.targetReviewDecisionId);
                    productDefectRemediationAuthorizations.push(Object.freeze({
                        sourceEvent: targetResultSourceEvent(storedEvent),
                        authorization,
                    }));
                }
            }
        }
        const targetById = new Map(aggregate.state.targetTasks.map((target) => [target.targetTaskId, target]));
        const taskPackageById = new Map(taskPackages.map((source) => [source.taskPackage.taskPackageId, source]));
        const targetResultById = new Map(targetResults.map((source) => [source.result.targetResultId, source]));
        const reviewDecisionById = new Map(targetReviewDecisions.map((source) => [source.decision.targetReviewDecisionId, source]));
        if (taskPackages.length !== targetById.size)
            fail("stream", "$events");
        for (const target of targetById.values()) {
            const taskPackageSource = taskPackageById.get(target.taskPackageId);
            if (taskPackageSource === undefined ||
                !taskPackageMatchesTargetSummary(taskPackageSource.taskPackage, target) ||
                computeTaskPackageDigest(taskPackageSource.taskPackage) !==
                    target.taskPackageDigest ||
                taskPackageSource.sourceEvent.streamRevision > aggregate.streamRevision) {
                fail("stream", "$events");
            }
            if (target.phase !== "result-reported" &&
                target.phase !== "test-result-reported" &&
                target.phase !== "accepted" &&
                target.phase !== "product-defect-rework-requested" &&
                target.phase !== "rework-requested" &&
                target.phase !== "escalated" &&
                target.phase !== "review-blocked" &&
                target.phase !== "test-accepted" &&
                target.phase !== "test-another-attempt-requested" &&
                target.phase !== "test-product-defect" &&
                target.phase !== "test-review-blocked" &&
                target.phase !== "test-escalated") {
                continue;
            }
            const resultSource = targetResultById.get(target.currentDelivery.targetResult.targetResultId);
            if (resultSource === undefined ||
                (resultSource.result.workType === "test") !==
                    (target.workType === "test") ||
                resultSource.result.targetTaskId !== target.targetTaskId ||
                resultSource.result.taskPackage.taskPackageId !==
                    target.taskPackageId ||
                resultSource.result.taskPackage.digest !== target.taskPackageDigest ||
                resultSource.result.resultDigest !==
                    target.currentDelivery.targetResult.resultDigest ||
                resultSource.result.report.outcome !==
                    target.currentDelivery.targetResult.outcome ||
                resultSource.result.report.reportedAt !==
                    target.currentDelivery.targetResult.reportedAt ||
                resultSource.sourceEvent.streamRevision > aggregate.streamRevision) {
                fail("stream", "$events");
            }
            const callback = callbackByResultId.get(resultSource.result.targetResultId);
            const summary = target.currentDelivery.targetResult.callback;
            if (callback === undefined ||
                callback.callbackId !== summary.callbackId ||
                callback.generation !== summary.generation ||
                callback.promptDigest !== summary.promptDigest ||
                callback.issuedAt !== summary.issuedAt ||
                callback.controllerWindowId !== summary.controllerWindowId ||
                callback.bindingId !== summary.bindingId) {
                fail("stream", "$events");
            }
            if (target.phase === "result-reported" ||
                target.phase === "test-result-reported") {
                continue;
            }
            const decisionSource = reviewDecisionById.get(target.currentDelivery.reviewDecision.targetReviewDecisionId);
            if (decisionSource === undefined ||
                (decisionSource.decision.kind ===
                    "WakeflowControllerTestReviewDecision") !==
                    (target.workType === "test") ||
                decisionSource.decision.targetTaskId !== target.targetTaskId ||
                decisionSource.decision.reviewed.targetResultId !==
                    resultSource.result.targetResultId ||
                decisionSource.decision.reviewed.targetResultDigest !==
                    resultSource.result.resultDigest ||
                decisionSource.decision.decisionDigest !==
                    target.currentDelivery.reviewDecision.decisionDigest ||
                decisionSource.decision.decision !==
                    target.currentDelivery.reviewDecision.decision ||
                decisionSource.decision.controllerWindowId !==
                    target.currentDelivery.reviewDecision.controllerWindowId ||
                decisionSource.decision.decidedAt !==
                    target.currentDelivery.reviewDecision.decidedAt ||
                decisionSource.sourceEvent.streamRevision > aggregate.streamRevision ||
                (decisionSource.decision.kind === "WakeflowControllerTestReviewDecision" &&
                    decisionSource.decision.decision === "escalate" &&
                    (target.phase === "test-product-defect") !==
                        (decisionSource.decision.escalation?.classification ===
                            "product-defect"))) {
                fail("stream", "$events");
            }
        }
        for (const source of targetResults) {
            if (!targetById.has(source.result.targetTaskId)) {
                fail("stream", "$events");
            }
        }
        for (const source of targetReviewDecisions) {
            const target = targetById.get(source.decision.targetTaskId);
            if (target === undefined ||
                (source.decision.kind === "WakeflowControllerTestReviewDecision") !==
                    (target.workType === "test")) {
                fail("stream", "$events");
            }
        }
        const remediationById = new Map(productDefectRemediationAuthorizations.map((source) => [source.authorization.productDefectRemediationId, source]));
        for (const source of productDefectRemediationAuthorizations) {
            const authorization = source.authorization;
            const sourceDecision = reviewDecisionById.get(authorization.source.testReviewDecision.targetReviewDecisionId);
            const sourceTestPackage = taskPackageById.get(authorization.source.testTaskPackage.taskPackageId);
            const priorStoredEvent = storedEventByRevision.get(authorization.source.streamRevision);
            const decision = sourceDecision?.decision;
            const escalatedResult = targetResultById.get(authorization.source.targetResult.targetResultId);
            const expectedFailedSteps = escalatedResult?.result.workType === "test"
                ? escalatedResult.result.report.steps
                    .filter((step) => step.verdict === "fail")
                    .map((step) => ({ stepId: step.stepId, observed: step.observed }))
                : [];
            const remediation = decision?.kind === "WakeflowControllerTestReviewDecision" &&
                decision.escalation?.classification === "product-defect"
                ? decision.escalation.remediation
                : undefined;
            if (decision === undefined ||
                decision.kind !== "WakeflowControllerTestReviewDecision" ||
                decision.decision !== "escalate" ||
                remediation === undefined ||
                authorization.authorizationRationale !==
                    remediation.authorizationRationale ||
                decision.programId !== authorization.programId ||
                decision.demandId !== authorization.demandId ||
                decision.controllerWindowId !== authorization.controllerWindowId ||
                decision.targetTaskId !== authorization.source.testTargetTaskId ||
                decision.decisionDigest !==
                    authorization.source.testReviewDecision.decisionDigest ||
                decision.decidedAt !==
                    authorization.source.testReviewDecision.decidedAt ||
                decision.reviewed.targetResultId !==
                    authorization.source.targetResult.targetResultId ||
                decision.reviewed.targetResultDigest !==
                    authorization.source.targetResult.resultDigest ||
                decision.testExecution.testAttemptId !==
                    authorization.source.testAttemptId ||
                sourceDecision?.sourceEvent.streamRevision !==
                    authorization.source.streamRevision ||
                source.sourceEvent.streamRevision !==
                    authorization.source.streamRevision + 1 ||
                priorStoredEvent?.resultingStateDigest !==
                    authorization.source.stateDigest ||
                sourceTestPackage === undefined ||
                sourceTestPackage.taskPackage.workType !== "test" ||
                computeTaskPackageDigest(sourceTestPackage.taskPackage) !==
                    authorization.source.testTaskPackage.taskPackageDigest ||
                sourceTestPackage.taskPackage.targetTaskId !==
                    authorization.source.testTargetTaskId ||
                sourceTestPackage.sourceEvent.streamRevision >=
                    authorization.source.streamRevision ||
                expectedFailedSteps.length !== authorization.failedSteps.length ||
                expectedFailedSteps.some((step, index) => {
                    const projected = authorization.failedSteps[index];
                    return (projected === undefined ||
                        projected.stepId !== step.stepId ||
                        projected.observed !== step.observed);
                }) ||
                remediation.affectedTargets.length !==
                    authorization.affectedTargets.length ||
                remediation.affectedTargets.some((declared) => {
                    const affected = authorization.affectedTargets.find((entry) => entry.baseline.targetTaskId === declared.targetTaskId);
                    return (affected === undefined ||
                        affected.correctionObjective !== declared.correctionObjective ||
                        affected.failedStepIds.length !== declared.failedStepIds.length ||
                        declared.failedStepIds.some((stepId) => !affected.failedStepIds.includes(stepId)));
                })) {
                fail("stream", "$events");
            }
            const baselineByTarget = new Map(sourceTestPackage.taskPackage.implementationBaselines.map((baseline) => [baseline.targetTaskId, baseline]));
            for (const affected of authorization.affectedTargets) {
                const baseline = affected.baseline;
                const packageBaseline = baselineByTarget.get(baseline.targetTaskId);
                const taskPackageSource = taskPackageById.get(baseline.taskPackageId);
                const resultSource = targetResultById.get(baseline.targetResultId);
                const reviewSource = reviewDecisionById.get(baseline.targetReviewDecisionId);
                if (packageBaseline === undefined ||
                    packageBaseline.taskPackageId !== baseline.taskPackageId ||
                    packageBaseline.taskPackageDigest !== baseline.taskPackageDigest ||
                    packageBaseline.repositoryId !== baseline.repositoryId ||
                    packageBaseline.windowId !== baseline.windowId ||
                    packageBaseline.targetResultId !== baseline.targetResultId ||
                    packageBaseline.resultDigest !== baseline.resultDigest ||
                    packageBaseline.targetReviewDecisionId !==
                        baseline.targetReviewDecisionId ||
                    packageBaseline.decisionDigest !== baseline.decisionDigest ||
                    taskPackageSource?.taskPackage.targetTaskId !==
                        baseline.targetTaskId ||
                    taskPackageSource.taskPackage.workType !== "implementation" ||
                    computeTaskPackageDigest(taskPackageSource.taskPackage) !==
                        baseline.taskPackageDigest ||
                    resultSource?.result.targetTaskId !== baseline.targetTaskId ||
                    resultSource.result.workType !== "implementation" ||
                    resultSource.result.resultDigest !== baseline.resultDigest ||
                    reviewSource?.decision.kind !==
                        "WakeflowControllerImplementationReviewDecision" ||
                    reviewSource.decision.decision !== "accept" ||
                    reviewSource.decision.targetTaskId !== baseline.targetTaskId ||
                    reviewSource.decision.decisionDigest !== baseline.decisionDigest ||
                    reviewSource.sourceEvent.streamRevision >=
                        source.sourceEvent.streamRevision) {
                    fail("stream", "$events");
                }
            }
        }
        // 每份缺陷修复授权至多被一个 retest 谱系的 test 任务包消费，且消费发生在授权之后。
        const consumedRemediationIds = new Set();
        for (const source of taskPackages) {
            const taskPackage = source.taskPackage;
            if (taskPackage.workType !== "test" || taskPackage.lineage === null) {
                continue;
            }
            const lineage = taskPackage.lineage;
            const remediationSource = remediationById.get(lineage.productDefectRemediationId);
            const previousTestTarget = targetById.get(lineage.retestsTargetTaskId);
            if (remediationSource === undefined ||
                remediationSource.authorization.authorizationDigest !==
                    lineage.authorizationDigest ||
                remediationSource.authorization.source.testTargetTaskId !==
                    lineage.retestsTargetTaskId ||
                remediationSource.sourceEvent.streamRevision >=
                    source.sourceEvent.streamRevision ||
                previousTestTarget?.workType !== "test" ||
                previousTestTarget.phase !== "test-product-defect" ||
                consumedRemediationIds.has(lineage.productDefectRemediationId)) {
                fail("stream", "$events");
            }
            consumedRemediationIds.add(lineage.productDefectRemediationId);
        }
        const pendingTestRetest = aggregate.state.pendingTestRetest;
        const unconsumedRemediations = productDefectRemediationAuthorizations.filter((source) => !consumedRemediationIds.has(source.authorization.productDefectRemediationId));
        if (pendingTestRetest === undefined) {
            if (unconsumedRemediations.length !== 0)
                fail("stream", "$events");
        }
        else {
            const source = unconsumedRemediations[0];
            if (unconsumedRemediations.length !== 1 ||
                source === undefined ||
                source.authorization.productDefectRemediationId !==
                    pendingTestRetest.productDefectRemediation
                        .productDefectRemediationId ||
                source.authorization.authorizationDigest !==
                    pendingTestRetest.productDefectRemediation.authorizationDigest ||
                source.authorization.source.testTargetTaskId !==
                    pendingTestRetest.previousTestTarget.targetTaskId ||
                source.authorization.source.testTaskPackage.taskPackageId !==
                    pendingTestRetest.previousTestTarget.taskPackageId ||
                source.authorization.source.testTaskPackage.taskPackageDigest !==
                    pendingTestRetest.previousTestTarget.taskPackageDigest ||
                source.authorization.source.testReviewDecision
                    .targetReviewDecisionId !==
                    pendingTestRetest.testReviewDecision.targetReviewDecisionId ||
                source.authorization.source.testReviewDecision.decisionDigest !==
                    pendingTestRetest.testReviewDecision.decisionDigest) {
                fail("stream", "$events");
            }
        }
        for (const target of aggregate.state.targetTasks) {
            if (target.phase !== "product-defect-rework-requested")
                continue;
            const source = remediationById.get(target.productDefectRemediation.productDefectRemediationId);
            const affected = source?.authorization.affectedTargets.find((entry) => entry.baseline.targetTaskId === target.targetTaskId);
            if (source === undefined ||
                affected === undefined ||
                source.authorization.authorizationDigest !==
                    target.productDefectRemediation.authorizationDigest ||
                source.authorization.source.testReviewDecision
                    .targetReviewDecisionId !==
                    target.productDefectRemediation.testReviewDecisionId ||
                source.authorization.source.testReviewDecision.decisionDigest !==
                    target.productDefectRemediation.testReviewDecisionDigest ||
                source.authorization.authorizedAt !==
                    target.productDefectRemediation.authorizedAt ||
                affected.correctionObjective !==
                    target.productDefectRemediation.correctionObjective ||
                affected.failedStepIds.length !==
                    target.productDefectRemediation.failedStepIds.length ||
                affected.failedStepIds.some((id, index) => id !== target.productDefectRemediation.failedStepIds[index])) {
                fail("stream", "$events");
            }
        }
        return Object.freeze({
            aggregate,
            taskPackages: Object.freeze(taskPackages),
            targetResults: Object.freeze(targetResults),
            targetReviewDecisions: Object.freeze(targetReviewDecisions),
            productDefectRemediationAuthorizations: Object.freeze(productDefectRemediationAuthorizations),
            escalations: Object.freeze(escalations),
            decisionRecords: Object.freeze(decisionRecords),
            replayedCommitCount: stream.commits.length,
        });
    }
    /**
     * 完整审计事件流后，按不可变 TaskPackage 身份定位唯一规划事件。
     *
     * 本查询只为可重建投影提供权威来源；它不读取投影文件，也不把 Aggregate 摘要
     * 反向扩展成 TaskPackage 内容。
     */
    async findTargetTaskPlannedEvent(taskPackageIdValue, options) {
        const signal = parseSignal(options);
        let taskPackageId;
        try {
            taskPackageId = parseWakeflowDurableIdOfKind(taskPackageIdValue, "task-package", "$taskPackageId");
        }
        catch (error) {
            if (error instanceof WakeflowDurableIdError) {
                fail("input", "$taskPackageId");
            }
            throw error;
        }
        const found = await this.#findUniqueEvent("tasking.target-task-planned", (event) => event.eventType === "tasking.target-task-planned" && event.data.taskPackage.taskPackageId === taskPackageId, signal);
        if (found === null)
            return null;
        const aggregate = found.aggregate;
        if (found.event.eventType !== "tasking.target-task-planned")
            fail("stream", "$events");
        const located = Object.freeze({
            storedEvent: found.storedEvent,
            event: found.event,
        });
        const taskPackage = located.event.data.taskPackage;
        const summary = aggregate.state.targetTasks.find((entry) => entry.taskPackageId === taskPackageId);
        if (summary === undefined ||
            !taskPackageMatchesTargetSummary(taskPackage, summary) ||
            summary.taskPackageDigest !== computeTaskPackageDigest(taskPackage) ||
            located.storedEvent.streamRevision > aggregate.streamRevision) {
            fail("stream", "$events");
        }
        return located;
    }
    /** 完整审计事件流后，按投递身份定位唯一 prepared 事件（信封）。 */
    async findDeliveryPreparedEvent(deliveryIdValue, options) {
        const signal = parseSignal(options);
        let deliveryId;
        try {
            deliveryId = parseWakeflowDurableIdOfKind(deliveryIdValue, "target-delivery", "$deliveryId");
        }
        catch (error) {
            if (error instanceof WakeflowDurableIdError)
                fail("input", "$deliveryId");
            throw error;
        }
        const found = await this.#findUniqueEvent("delivery.delivery-prepared", (event) => event.eventType === "delivery.delivery-prepared" && event.data.envelope.deliveryId === deliveryId, signal);
        if (found === null)
            return null;
        const aggregate = found.aggregate;
        if (found.event.eventType !== "delivery.delivery-prepared")
            fail("stream", "$events");
        const located = Object.freeze({
            storedEvent: found.storedEvent,
            event: found.event,
        });
        const envelope = located.event.data.envelope;
        const target = aggregate.state.targetTasks.find((entry) => entry.targetTaskId === envelope.target.targetTaskId);
        if (aggregate.demandId !== envelope.demandId ||
            target === undefined ||
            target.taskPackageId !== envelope.target.taskPackageId ||
            target.taskPackageDigest !== envelope.target.taskPackageDigest ||
            target.windowId !== envelope.route.windowId ||
            located.storedEvent.streamRevision !== envelope.fence.expectedStreamRevision + 1 ||
            located.storedEvent.streamRevision > aggregate.streamRevision) {
            fail("stream", "$events");
        }
        return located;
    }
    /** 完整审计事件流后，按投递身份收集全部 outcome 事件（按流修订号升序）。 */
    async findDeliveryOutcomeRecordedEvents(deliveryIdValue, options) {
        const signal = parseSignal(options);
        let deliveryId;
        try {
            deliveryId = parseWakeflowDurableIdOfKind(deliveryIdValue, "target-delivery", "$deliveryId");
        }
        catch (error) {
            if (error instanceof WakeflowDurableIdError)
                fail("input", "$deliveryId");
            throw error;
        }
        const aggregate = await this.#currentAggregate(signal);
        if (aggregate === null)
            return Object.freeze([]);
        const located = [];
        for (const storedEvent of await this.#storedEventsOfType(aggregate, "delivery.delivery-outcome-recorded", signal)) {
            let event;
            try {
                event = upcastDemandEventSourcingStoredEvent(storedEvent);
            }
            catch (error) {
                if (error instanceof DemandEventSourcingUpcasterError)
                    fail("stream", "$events");
                throw error;
            }
            if (event.eventType !== "delivery.delivery-outcome-recorded" ||
                event.data.outcome.deliveryId !== deliveryId) {
                continue;
            }
            if (storedEvent.streamRevision > aggregate.streamRevision)
                fail("stream", "$events");
            located.push(Object.freeze({ storedEvent, event }));
        }
        located.sort((left, right) => left.storedEvent.streamRevision - right.storedEvent.streamRevision);
        return Object.freeze(located);
    }
    /** 完整审计事件流后，按Action/Claim身份定位唯一TargetResult Event。 */
    async findTargetResultRecordedEvent(claimIdValue, options) {
        const signal = parseSignal(options);
        let claimId;
        try {
            claimId = parseWakeflowDurableIdOfKind(claimIdValue, "work-claim", "$claimId");
        }
        catch (error) {
            if (error instanceof WakeflowDurableIdError)
                fail("input", "$claimId");
            throw error;
        }
        const found = await this.#findUniqueEvent("result.target-result-recorded", (event) => event.eventType === "result.target-result-recorded" && event.data.result.delivery.fence.claimId === claimId, signal);
        if (found === null)
            return null;
        const aggregate = found.aggregate;
        if (found.event.eventType !== "result.target-result-recorded")
            fail("stream", "$events");
        const located = Object.freeze({
            storedEvent: found.storedEvent,
            event: found.event,
        });
        if (located.storedEvent.streamRevision > aggregate.streamRevision) {
            fail("stream", "$events");
        }
        return located;
    }
    /** 通过快照加尾部得到当前聚合；不存在事件流时返回 `null`。 */
    async #currentAggregate(signal) {
        const loaded = await this.load(signal === undefined ? undefined : { signal });
        return loaded?.aggregate ?? null;
    }
    /**
     * 收集某一事件类型的全部持久化事件：索引可用时只读命中的提交文件，并用索引里的
     * 提交摘要复验；索引落后于聚合的尾部提交逐个补读；索引不可用则退回完整读取。
     */
    async #storedEventsOfType(aggregate, eventType, signal) {
        const located = await this.#eventStore.readIndex(aggregate.demandId, signal === undefined ? undefined : { signal });
        if (located !== null && located.index.commitSequence <= aggregate.commitSequence) {
            const sequences = new Set(located.index.byType[eventType] ?? []);
            for (let sequence = located.index.commitSequence + 1; sequence <= aggregate.commitSequence; sequence += 1) {
                sequences.add(sequence);
            }
            const collected = [];
            let consistent = true;
            for (const sequence of [...sequences].sort((left, right) => left - right)) {
                let commit;
                try {
                    commit = await this.#eventStore.readCommitAt(sequence, signal === undefined ? undefined : { signal });
                }
                catch (error) {
                    mapStoreError(error);
                }
                const expectedDigest = located.index.digests[String(sequence)];
                if (commit === null ||
                    (expectedDigest !== undefined &&
                        computeDemandEventStreamCommitDigest(commit) !== expectedDigest)) {
                    consistent = false;
                    break;
                }
                for (const storedEvent of commit.events) {
                    if (storedEvent.eventType === eventType)
                        collected.push(storedEvent);
                }
            }
            if (consistent)
                return Object.freeze(collected);
        }
        let stream;
        try {
            stream = await this.#eventStore.readCommits(signal === undefined ? undefined : { signal });
        }
        catch (error) {
            mapStoreError(error);
        }
        return Object.freeze(stream.commits.flatMap((commit) => commit.events.filter((storedEvent) => storedEvent.eventType === eventType)));
    }
    /** 按类型与匹配条件定位唯一事件；匹配到多个即事件流不合法。 */
    async #findUniqueEvent(eventType, matches, signal) {
        const aggregate = await this.#currentAggregate(signal);
        if (aggregate === null)
            return null;
        let located;
        for (const storedEvent of await this.#storedEventsOfType(aggregate, eventType, signal)) {
            let event;
            try {
                event = upcastDemandEventSourcingStoredEvent(storedEvent);
            }
            catch (error) {
                if (error instanceof DemandEventSourcingUpcasterError) {
                    fail("stream", "$events");
                }
                throw error;
            }
            if (event.eventType !== eventType || !matches(event))
                continue;
            if (located !== undefined)
                fail("stream", "$events");
            located = Object.freeze({ storedEvent, event });
        }
        if (located === undefined)
            return null;
        return Object.freeze({ aggregate, ...located });
    }
    /** 仅为命令重试解析 `commitId`；普通加载不会因此扫描历史。 */
    async findCommitById(commitIdValue, options) {
        const signal = parseSignal(options);
        let commitId;
        try {
            commitId = parseWakeflowDurableIdOfKind(commitIdValue, "demand-event-commit", "$commitId");
        }
        catch (error) {
            if (error instanceof WakeflowDurableIdError)
                fail("input", "$commitId");
            throw error;
        }
        const located = await this.#eventStore.readIndex(null, signal === undefined ? undefined : { signal });
        const indexedSequence = located?.index.commits[commitId];
        if (indexedSequence !== undefined) {
            let commit;
            try {
                commit = await this.#eventStore.readCommitAt(indexedSequence, signal === undefined ? undefined : { signal });
            }
            catch (error) {
                mapStoreError(error);
            }
            if (commit !== null && commit.commitId === commitId)
                return commit;
        }
        let stream;
        try {
            stream = await this.#eventStore.readCommits(signal === undefined ? undefined : { signal });
        }
        catch (error) {
            mapStoreError(error);
        }
        return (stream.commits.find((commit) => commit.commitId === commitId) ?? null);
    }
    /** 按客户端幂等键定位提交：索引 O(1)，索引不可用时回退完整读取。 */
    async findCommitByIdempotencyKey(key, options) {
        const signal = parseSignal(options);
        if (typeof key !== "string" || key.length === 0 || key.length > 128) {
            fail("input", "$idempotencyKey");
        }
        const located = await this.#eventStore.readIndex(null, signal === undefined ? undefined : { signal });
        const indexedSequence = located?.index.keys[key];
        if (indexedSequence !== undefined) {
            let commit;
            try {
                commit = await this.#eventStore.readCommitAt(indexedSequence, signal === undefined ? undefined : { signal });
            }
            catch (error) {
                mapStoreError(error);
            }
            if (commit !== null && commit.idempotency?.key === key)
                return commit;
        }
        let stream;
        try {
            stream = await this.#eventStore.readCommits(signal === undefined ? undefined : { signal });
        }
        catch (error) {
            mapStoreError(error);
        }
        return (stream.commits.find((commit) => commit.idempotency?.key === key) ?? null);
    }
    /** 持久追加一条已经由决策器和状态演进逻辑完整准备的不可变提交记录。 */
    async appendPreparedCommit(prepared, options) {
        const signal = parseSignal(options);
        return this.#eventStore.append(prepared, signal === undefined ? undefined : { signal });
    }
    /** 显式发布当前聚合的不可变检查点；该操作不属于加载副作用。 */
    async publishSnapshot(aggregateValue, options) {
        const signal = parseSignal(options);
        let snapshot;
        try {
            snapshot = createDemandEventSourcingSnapshot(aggregateValue);
        }
        catch (error) {
            if (error instanceof DemandEventSourcingSnapshotError) {
                fail("input", "$aggregate");
            }
            throw error;
        }
        try {
            return await this.#snapshotStore.publish(snapshot, signal === undefined ? undefined : { signal });
        }
        catch (error) {
            if (error instanceof DemandFileEventSnapshotStoreError) {
                if (error.reason === "aborted")
                    fail("aborted", "$signal");
                fail("snapshot", "$snapshot");
            }
            throw error;
        }
    }
    /**
     * 追加成功后刷新检查点：发布当前聚合的快照并退休更早的快照（ADR-0005）。
     * 快照是可重建缓存，退休失败只计数。
     */
    async refreshCheckpoints(aggregateValue, options) {
        const signal = parseSignal(options);
        const receipt = await this.publishSnapshot(aggregateValue, signal === undefined ? undefined : { signal });
        let retiredSnapshots = 0;
        try {
            // 常态只退休恰好落到保留窗口之外的那一份；每隔一段做一次清扫兜底。
            if (await this.#snapshotStore.retireSnapshotAt(receipt.commitSequence - SNAPSHOT_RETENTION, signal === undefined ? undefined : { signal })) {
                retiredSnapshots += 1;
            }
            if (receipt.commitSequence % CHECKPOINT_SWEEP_INTERVAL === 0) {
                const sweep = await this.#snapshotStore.retireSnapshotsBefore(receipt.commitSequence - SNAPSHOT_RETENTION + 1, signal === undefined ? undefined : { signal });
                retiredSnapshots += sweep.retired;
            }
        }
        catch (error) {
            if (!(error instanceof DemandFileEventSnapshotStoreError))
                throw error;
            // 退休失败只计数，但中止不是失败：照常上抛。
            if (error.reason === "aborted")
                fail("aborted", "$signal");
        }
        return Object.freeze({ snapshot: receipt.disposition, retiredSnapshots });
    }
}
