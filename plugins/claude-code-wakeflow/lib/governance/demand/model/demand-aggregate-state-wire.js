import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_DEMAND_AGGREGATE_STATE_SCHEMA } from "../../../contracts/generated/governance/demand/demand-aggregate-state.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA } from "../../../contracts/generated/governance/testing/test-execution-attempt.generated.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../../contracts/identity/wakeflow-durable-id.js";
import { isEvidenceKind } from "../../../contracts/vocabulary/evidence-kinds.js";
import { computeCanonicalJsonSha256Digest } from "../../../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, Sha256Error, } from "../../../foundation/crypto/sha256.js";
import { JsonValueError, parseJsonValue, } from "../../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../../foundation/schema/runtime-json-schema.js";
import { parseUtcInstant, UtcInstantError, } from "../../../foundation/time/utc-instant.js";
import { parseWakeflowWindowHostBindingId, WakeflowWindowHostBindingIdError, } from "../../../workspace/window-runtime/wakeflow-window-host-binding-id.js";
import { DELIVERY_REARM_LIMIT } from "../../delivery/delivery-rearm.js";
import { deriveTargetResultCallbackId, TARGET_RESULT_CALLBACK_GENERATION_LIMIT, } from "../../result/target-result-callback.js";
import { assertRerunTestExecutionAttemptFollows, parseTestExecutionAttempt, TestExecutionAttemptError, } from "../../testing/test-execution-attempt.js";
import { currentTestTargetsOf, DEMAND_AGGREGATE_STATE_ARTIFACT_KIND, DEMAND_AGGREGATE_STATE_SCHEMA_VERSION, fail, lastTestAttempt, } from "./demand-aggregate-state-model.js";
import { parseRequirementLineageReference, RequirementLineageError, } from "./requirement-lineage.js";
/**
 * Wakeflow Governance / Demand Model / Aggregate Wire：聚合状态的准入：wire Schema 校验之后逐字段归一——标识、摘要、每个目标按阶段要带的事实、补充包与续接、整份状态的摘要。别的模块只经 `parseDemandAggregateState` 拿到状态。
 *
 * 从 `demand-aggregate-state.ts` 按关注点分出来的一段（open-items L5，gate-log §13.255）；对外的入口仍是那个
 * 文件，它只转出别处在用的公开名字。
 */
const validateWire = createRuntimeJsonSchemaValidator(WAKEFLOW_DEMAND_AGGREGATE_STATE_SCHEMA, [
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
]);
/** 一个测试目标的尝试上限，对应 test-execution-attempt Schema 的序号最大值。 */
export const TEST_ATTEMPT_LIMIT = 10;
export function parseId(value, kind, path) {
    try {
        return parseWakeflowDurableIdOfKind(value, kind, path);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("identifier", path, error);
        throw error;
    }
}
function parseCurrentDeliveryBase(value, path) {
    let bindingId;
    try {
        bindingId = parseWakeflowWindowHostBindingId(value.bindingId, `${path}/bindingId`);
    }
    catch (error) {
        if (error instanceof WakeflowWindowHostBindingIdError) {
            fail("identifier", `${path}/bindingId`, error);
        }
        throw error;
    }
    if (!Number.isSafeInteger(value.generation) ||
        value.generation < 1 ||
        value.generation > DELIVERY_REARM_LIMIT + 1) {
        fail("relation", `${path}/generation`);
    }
    if (!Number.isSafeInteger(value.fence.streamRevision) || value.fence.streamRevision < 2) {
        fail("relation", `${path}/fence/streamRevision`);
    }
    return Object.freeze({
        deliveryId: parseId(value.deliveryId, "target-delivery", `${path}/deliveryId`),
        envelopeDigest: parseDigest(value.envelopeDigest, `${path}/envelopeDigest`),
        promptDigest: parseDigest(value.promptDigest, `${path}/promptDigest`),
        generation: value.generation,
        hostId: value.hostId,
        bindingId,
        fence: Object.freeze({
            claimId: parseId(value.fence.claimId, "work-claim", `${path}/fence/claimId`),
            claimDigest: parseDigest(value.fence.claimDigest, `${path}/fence/claimDigest`),
            streamRevision: value.fence.streamRevision,
        }),
    });
}
function parseDeliveryOutcomeSummary(value, path) {
    let observedAt;
    try {
        observedAt = parseUtcInstant(value.observedAt, `${path}/observedAt`);
    }
    catch (error) {
        if (error instanceof UtcInstantError)
            fail("relation", `${path}/observedAt`, error);
        throw error;
    }
    // observedAt 只保留来源时钟的审计事实；因果顺序由事件流修订、当前状态摘要与
    // 处置对围栏的精确引用保证，不比较跨来源墙钟。
    if ((value.disposition === "rejected-before-send") !==
        (value.claimHandling === "release-authorized")) {
        fail("relation", `${path}/claimHandling`);
    }
    return Object.freeze({
        outcomeDigest: parseDigest(value.outcomeDigest, `${path}/outcomeDigest`),
        disposition: value.disposition,
        evidenceKind: value.evidenceKind,
        readbackStatus: value.readbackStatus,
        claimHandling: value.claimHandling,
        observedAt,
    });
}
function parseTargetResultSummary(value, path) {
    let reportedAt;
    try {
        reportedAt = parseUtcInstant(value.reportedAt, `${path}/reportedAt`);
    }
    catch (error) {
        if (error instanceof UtcInstantError)
            fail("relation", `${path}/reportedAt`, error);
        throw error;
    }
    // reportedAt只保留Report来源时钟的审计事实；Event流修订、当前状态摘要和
    // TargetResult对Host Effect的精确引用共同建立因果关系，不比较跨来源墙钟。
    const targetResultId = parseId(value.targetResultId, "target-result", `${path}/targetResultId`);
    return Object.freeze({
        targetResultId,
        resultDigest: parseDigest(value.resultDigest, `${path}/resultDigest`),
        outcome: value.outcome,
        reportedAt,
        claimHandling: "release-authorized",
        callback: parseCallbackSummary(value.callback, targetResultId, `${path}/callback`),
    });
}
function parseCallbackSummary(value, targetResultId, path) {
    let issuedAt;
    try {
        issuedAt = parseUtcInstant(value.issuedAt, `${path}/issuedAt`);
    }
    catch (error) {
        if (error instanceof UtcInstantError)
            fail("relation", `${path}/issuedAt`, error);
        throw error;
    }
    let bindingId;
    try {
        bindingId = parseWakeflowWindowHostBindingId(value.bindingId, `${path}/bindingId`);
    }
    catch (error) {
        if (error instanceof WakeflowWindowHostBindingIdError) {
            fail("identifier", `${path}/bindingId`, error);
        }
        throw error;
    }
    const callbackId = parseId(value.callbackId, "target-delivery", `${path}/callbackId`);
    if (callbackId !== deriveTargetResultCallbackId(targetResultId) ||
        !Number.isSafeInteger(value.generation) ||
        value.generation < 1 ||
        value.generation > TARGET_RESULT_CALLBACK_GENERATION_LIMIT) {
        fail("relation", `${path}/callbackId`);
    }
    return Object.freeze({
        callbackId,
        generation: value.generation,
        promptDigest: parseDigest(value.promptDigest, `${path}/promptDigest`),
        issuedAt,
        controllerWindowId: parseId(value.controllerWindowId, "window", `${path}/controllerWindowId`),
        bindingId,
    });
}
/** 实现与测试审查决定摘要形状相同，只有 decision 的取值域不同。 */
function parseReviewDecisionSummary(value, path) {
    let decidedAt;
    try {
        decidedAt = parseUtcInstant(value.decidedAt, `${path}/decidedAt`);
    }
    catch (error) {
        if (error instanceof UtcInstantError)
            fail("relation", `${path}/decidedAt`, error);
        throw error;
    }
    return Object.freeze({
        targetReviewDecisionId: parseId(value.targetReviewDecisionId, "target-review-decision", `${path}/targetReviewDecisionId`),
        decisionDigest: parseDigest(value.decisionDigest, `${path}/decisionDigest`),
        decision: value.decision,
        controllerWindowId: parseId(value.controllerWindowId, "window", `${path}/controllerWindowId`),
        decidedAt,
    });
}
/** 状态里记录的审查决定摘要只取决定的身份、摘要、取值、窗口与时间。 */
export function reviewDecisionSummaryOf(decision) {
    return {
        targetReviewDecisionId: decision.targetReviewDecisionId,
        decisionDigest: decision.decisionDigest,
        decision: decision.decision,
        controllerWindowId: decision.controllerWindowId,
        decidedAt: decision.decidedAt,
    };
}
/**
 * 一个 TargetResult 身份只能被记录一次：任何阶段仍携带结果的目标（已报告、已审查、
 * 返工、阻塞或升级）都占用它的 targetResultId。
 */
export function targetResultIdInUse(targets, targetResultId) {
    return targets.some((entry) => {
        const delivery = entry.currentDelivery;
        return delivery?.targetResult?.targetResultId === targetResultId;
    });
}
export function reviewPhaseForDecision(decision) {
    return decision === "accept"
        ? "accepted"
        : decision === "rework"
            ? "rework-requested"
            : decision === "escalate"
                ? "escalated"
                : "review-blocked";
}
/** 摘要不带升级分类：escalate 的两个 phase 都成立，精确分类由事件与仓库审计核对。 */
function testReviewPhasesForDecision(decision) {
    return decision === "accept"
        ? ["test-accepted"]
        : decision === "request-another-attempt"
            ? ["test-another-attempt-requested"]
            : decision === "escalate"
                ? ["test-product-defect", "test-escalated"]
                : ["test-review-blocked"];
}
export function testReviewPhaseForDecision(decision) {
    return decision.decision === "escalate"
        ? decision.escalation?.classification === "product-defect"
            ? "test-product-defect"
            : "test-escalated"
        : (testReviewPhasesForDecision(decision.decision)[0] ?? "test-review-blocked");
}
const STEP_ID_PATTERN = /^ts-[1-9][0-9]?$/u;
function compareStepId(left, right) {
    return Number(left.slice(3)) - Number(right.slice(3));
}
function parseAcceptanceAnchorIds(values, path) {
    if (values.length === 0 ||
        new Set(values).size !== values.length ||
        values.some((value) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value))) {
        fail("relation", path);
    }
    return Object.freeze([...values]);
}
function parseDigest(value, path) {
    try {
        return parseSha256Digest(value, path);
    }
    catch (error) {
        if (error instanceof Sha256Error)
            fail("digest", path, error);
        throw error;
    }
}
export function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function parseManagedEvidenceSummaries(values) {
    const result = [];
    let previousEvidenceId;
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (value === undefined)
            fail("schema", `$/managedEvidence/${index}`);
        const path = `$/managedEvidence/${index}`;
        const evidenceId = parseId(value.evidenceId, "evidence", `${path}/evidenceId`);
        if (previousEvidenceId !== undefined && compareText(previousEvidenceId, evidenceId) >= 0) {
            fail("relation", path);
        }
        previousEvidenceId = evidenceId;
        if (!isEvidenceKind(value.kind))
            fail("schema", `${path}/kind`);
        result.push(Object.freeze({
            evidenceId,
            kind: value.kind,
            manifestDigest: parseDigest(value.manifestDigest, `${path}/manifestDigest`),
            payloadArtifactDigest: parseDigest(value.payloadArtifactDigest, `${path}/payloadArtifactDigest`),
        }));
    }
    return Object.freeze(result);
}
/** 待消费的复测记录只引用聚合内的历史 test 目标、其审查决定与缺陷修复授权。 */
function parsePendingTestRetest(value) {
    const path = "$/pendingTestRetest";
    return Object.freeze({
        kind: "product-defect-retest",
        previousTestTarget: Object.freeze({
            targetTaskId: parseId(value.previousTestTarget.targetTaskId, "target-task", `${path}/previousTestTarget/targetTaskId`),
            taskPackageId: parseId(value.previousTestTarget.taskPackageId, "task-package", `${path}/previousTestTarget/taskPackageId`),
            taskPackageDigest: parseDigest(value.previousTestTarget.taskPackageDigest, `${path}/previousTestTarget/taskPackageDigest`),
        }),
        testReviewDecision: Object.freeze({
            targetReviewDecisionId: parseId(value.testReviewDecision.targetReviewDecisionId, "target-review-decision", `${path}/testReviewDecision/targetReviewDecisionId`),
            decisionDigest: parseDigest(value.testReviewDecision.decisionDigest, `${path}/testReviewDecision/decisionDigest`),
        }),
        productDefectRemediation: Object.freeze({
            productDefectRemediationId: parseId(value.productDefectRemediation.productDefectRemediationId, "product-defect-remediation", `${path}/productDefectRemediation/productDefectRemediationId`),
            authorizationDigest: parseDigest(value.productDefectRemediation.authorizationDigest, `${path}/productDefectRemediation/authorizationDigest`),
        }),
    });
}
function parseProductDefectRemediationSummary(value, acceptedDecision, path) {
    const parsedStepIds = value.failedStepIds;
    if (parsedStepIds.some((stepId, index) => {
        if (!STEP_ID_PATTERN.test(stepId))
            return true;
        const previous = index > 0 ? parsedStepIds[index - 1] : undefined;
        return previous !== undefined && compareStepId(previous, stepId) >= 0;
    })) {
        fail("relation", `${path}/failedStepIds`);
    }
    const firstStepId = parsedStepIds[0];
    if (firstStepId === undefined) {
        fail("relation", `${path}/failedStepIds`);
    }
    const failedStepIds = Object.freeze([
        firstStepId,
        ...parsedStepIds.slice(1),
    ]);
    let authorizedAt;
    try {
        authorizedAt = parseUtcInstant(value.authorizedAt, `${path}/authorizedAt`);
    }
    catch (error) {
        if (error instanceof UtcInstantError) {
            fail("relation", `${path}/authorizedAt`, error);
        }
        throw error;
    }
    // authorizedAt只保留Authorization来源时钟的审计事实；Test Decision、accepted
    // baseline、当前Aggregate状态与Event append CAS共同建立因果关系，不比较墙钟。
    if (acceptedDecision.decision !== "accept" ||
        !value.correctionObjective.isWellFormed() ||
        value.correctionObjective.normalize("NFC") !== value.correctionObjective) {
        fail("relation", path);
    }
    return Object.freeze({
        productDefectRemediationId: parseId(value.productDefectRemediationId, "product-defect-remediation", `${path}/productDefectRemediationId`),
        authorizationDigest: parseDigest(value.authorizationDigest, `${path}/authorizationDigest`),
        testReviewDecisionId: parseId(value.testReviewDecisionId, "target-review-decision", `${path}/testReviewDecisionId`),
        testReviewDecisionDigest: parseDigest(value.testReviewDecisionDigest, `${path}/testReviewDecisionDigest`),
        failedStepIds,
        correctionObjective: value.correctionObjective,
        authorizedAt,
    });
}
function parseTestCurrentDelivery(value, path) {
    return Object.freeze({
        ...parseCurrentDeliveryBase(value, path),
        testAttemptId: parseId(value.testAttemptId, "test-attempt", `${path}/testAttemptId`),
    });
}
function parseTestAttemptState(value, path) {
    let attempt;
    try {
        attempt = parseTestExecutionAttempt(value.attempt);
    }
    catch (error) {
        if (error instanceof TestExecutionAttemptError) {
            fail("relation", `${path}/attempt`, error);
        }
        throw error;
    }
    let preparedAt;
    try {
        preparedAt = parseUtcInstant(value.delivery.preparedAt, `${path}/delivery/preparedAt`);
    }
    catch (error) {
        if (error instanceof UtcInstantError) {
            fail("relation", `${path}/delivery/preparedAt`, error);
        }
        throw error;
    }
    return Object.freeze({
        attempt,
        delivery: Object.freeze({
            deliveryId: parseId(value.delivery.deliveryId, "target-delivery", `${path}/delivery/deliveryId`),
            envelopeDigest: parseDigest(value.delivery.envelopeDigest, `${path}/delivery/envelopeDigest`),
            preparedAt,
        }),
    });
}
/** 这次尝试是这个测试目标的：目标标识与任务包（标识与摘要）都对得上。 */
function attemptBelongsToTarget(attempt, target) {
    return (attempt.targetTaskId === target.targetTaskId &&
        attempt.contract.taskPackageId === target.taskPackageId &&
        attempt.contract.taskPackageDigest === target.taskPackageDigest);
}
/**
 * 谱系里第二项起的每次尝试都是上一项的重跑：按重跑合同接得上，并且它依据的上一份结果与评审决定在整条
 * 谱系里只被用过这一次。
 */
function assertRerunAttemptFollows(attempt, previous, attemptPath, priorResultIds, reviewDecisionIds) {
    try {
        assertRerunTestExecutionAttemptFollows(attempt, previous.attempt);
    }
    catch (error) {
        if (error instanceof TestExecutionAttemptError) {
            fail("relation", attemptPath, error);
        }
        throw error;
    }
    if (attempt.mode !== "rerun") {
        fail("relation", `${attemptPath}/mode`);
    }
    const resultId = attempt.rerunSource.previousResult.targetResultId;
    const decisionId = attempt.rerunSource.reviewDecision.targetReviewDecisionId;
    if (priorResultIds.has(resultId) || reviewDecisionIds.has(decisionId)) {
        fail("relation", `${attemptPath}/rerunSource`);
    }
    priorResultIds.add(resultId);
    reviewDecisionIds.add(decisionId);
}
function parseTestAttemptLineage(values, target, path) {
    if (values.length === 0 || values.length > TEST_ATTEMPT_LIMIT)
        fail("relation", path);
    const attempts = values.map((value, index) => parseTestAttemptState(value, `${path}/${index}`));
    const first = attempts[0];
    if (first === undefined)
        fail("relation", path);
    const attemptIds = new Set();
    const deliveryIds = new Set();
    const priorResultIds = new Set();
    const reviewDecisionIds = new Set();
    for (const [index, state] of attempts.entries()) {
        const attempt = state.attempt;
        const previous = index === 0 ? undefined : attempts[index - 1];
        const attemptPath = `${path}/${index}/attempt`;
        if (attemptIds.has(attempt.testAttemptId) ||
            !attemptBelongsToTarget(attempt, target) ||
            (index === 0 && (attempt.mode !== "initial" || attempt.ordinal !== 1))) {
            fail("relation", attemptPath);
        }
        attemptIds.add(attempt.testAttemptId);
        if (previous !== undefined) {
            assertRerunAttemptFollows(attempt, previous, attemptPath, priorResultIds, reviewDecisionIds);
        }
        if (deliveryIds.has(state.delivery.deliveryId)) {
            fail("relation", `${path}/${index}/delivery`);
        }
        deliveryIds.add(state.delivery.deliveryId);
    }
    return Object.freeze([first, ...attempts.slice(1)]);
}
function isTestReviewedPhase(phase) {
    return (phase === "test-accepted" ||
        phase === "test-another-attempt-requested" ||
        phase === "test-product-defect" ||
        phase === "test-review-blocked" ||
        phase === "test-escalated");
}
/** 已经准备过投递的测试阶段：`planned` 之外的全部。 */
function isTestDeliveryBearingPhase(phase) {
    return (phase === "test-delivery-prepared" ||
        phase === "test-host-effect-accepted" ||
        phase === "test-host-effect-indeterminate" ||
        phase === "test-host-effect-rejected" ||
        phase === "test-result-reported" ||
        isTestReviewedPhase(phase));
}
/** 已经有评审决定的测试目标：结果与决定都在，决定推出的阶段集合里要有记下的这个阶段。 */
function parseReviewedTestTarget(value, expectedPhase, path, common, currentDelivery, testAttempts, outcome) {
    const reviewedDelivery = value.currentDelivery;
    if (reviewedDelivery.targetResult === undefined ||
        reviewedDelivery.reviewDecision === undefined ||
        outcome.disposition === "rejected-before-send") {
        fail("relation", `${path}/currentDelivery`);
    }
    const targetResult = parseTargetResultSummary(reviewedDelivery.targetResult, `${path}/currentDelivery/targetResult`);
    const reviewDecision = parseReviewDecisionSummary(reviewedDelivery.reviewDecision, `${path}/currentDelivery/reviewDecision`);
    if (!testReviewPhasesForDecision(reviewDecision.decision).includes(expectedPhase)) {
        fail("relation", `${path}/phase`);
    }
    return Object.freeze({
        ...common,
        workType: "test",
        phase: expectedPhase,
        currentDelivery: Object.freeze({
            ...currentDelivery,
            outcome,
            targetResult,
            reviewDecision,
        }),
        testAttempts,
    });
}
/** 已经有投递结局的测试目标：按阶段再要结果与评审决定；只有结局的那三个阶段由结局的去向推出。 */
function parseObservedTestTarget(value, path, common, currentDelivery, testAttempts) {
    const observedDelivery = value.currentDelivery;
    if (observedDelivery.outcome === undefined) {
        fail("relation", `${path}/currentDelivery/outcome`);
    }
    const outcome = parseDeliveryOutcomeSummary(observedDelivery.outcome, `${path}/currentDelivery/outcome`);
    if (isTestReviewedPhase(value.phase)) {
        return parseReviewedTestTarget(value, value.phase, path, common, currentDelivery, testAttempts, outcome);
    }
    else if (value.phase === "test-result-reported") {
        const resultDelivery = value.currentDelivery;
        if (resultDelivery.targetResult === undefined ||
            outcome.disposition === "rejected-before-send") {
            fail("relation", `${path}/currentDelivery`);
        }
        return Object.freeze({
            ...common,
            workType: "test",
            phase: "test-result-reported",
            currentDelivery: Object.freeze({
                ...currentDelivery,
                outcome,
                targetResult: parseTargetResultSummary(resultDelivery.targetResult, `${path}/currentDelivery/targetResult`),
            }),
            testAttempts,
        });
    }
    else {
        const expectedPhase = outcome.disposition === "accepted"
            ? "test-host-effect-accepted"
            : outcome.disposition === "indeterminate"
                ? "test-host-effect-indeterminate"
                : "test-host-effect-rejected";
        if (value.phase !== expectedPhase)
            fail("relation", `${path}/phase`);
        return Object.freeze({
            ...common,
            workType: "test",
            phase: expectedPhase,
            currentDelivery: Object.freeze({
                ...currentDelivery,
                outcome,
            }),
            testAttempts,
        });
    }
}
function parseTestTargetTask(value, path, common, registerClaim) {
    if (value.reworkCount !== undefined) {
        fail("relation", path);
    }
    if (value.phase === "planned") {
        return Object.freeze({
            ...common,
            workType: "test",
            phase: "planned",
        });
    }
    if (!isTestDeliveryBearingPhase(value.phase) ||
        value.currentDelivery === undefined ||
        value.testAttempts === undefined) {
        fail("relation", path);
    }
    const currentDelivery = parseTestCurrentDelivery(value.currentDelivery, `${path}/currentDelivery`);
    registerClaim(currentDelivery);
    const testAttempts = parseTestAttemptLineage(value.testAttempts, common, `${path}/testAttempts`);
    const attemptState = lastTestAttempt(testAttempts);
    if (attemptState.attempt.targetTaskId !== common.targetTaskId ||
        currentDelivery.testAttemptId !== attemptState.attempt.testAttemptId ||
        currentDelivery.deliveryId !== attemptState.delivery.deliveryId ||
        currentDelivery.envelopeDigest !== attemptState.delivery.envelopeDigest) {
        fail("relation", `${path}/testAttempts`);
    }
    if (value.phase === "test-delivery-prepared") {
        return Object.freeze({
            ...common,
            workType: "test",
            phase: "test-delivery-prepared",
            currentDelivery,
            testAttempts,
        });
    }
    return parseObservedTestTarget(value, path, common, currentDelivery, testAttempts);
}
/** 已经有评审决定的实现目标：产品缺陷返工要带修复摘要；其余阶段由决定本身推出，必须与记下的阶段一致。 */
function parseReviewedProductTarget(value, path, base, productCurrentDelivery, resultDelivery) {
    if (productCurrentDelivery.reviewDecision === undefined) {
        fail("relation", `${path}/currentDelivery/reviewDecision`);
    }
    const reviewDecision = parseReviewDecisionSummary(productCurrentDelivery.reviewDecision, `${path}/currentDelivery/reviewDecision`);
    const reviewedDelivery = Object.freeze({
        ...resultDelivery,
        reviewDecision,
    });
    if (value.phase === "product-defect-rework-requested") {
        if (value.productDefectRemediation === undefined) {
            fail("relation", `${path}/productDefectRemediation`);
        }
        return Object.freeze({
            ...base,
            phase: "product-defect-rework-requested",
            currentDelivery: reviewedDelivery,
            productDefectRemediation: parseProductDefectRemediationSummary(value.productDefectRemediation, reviewDecision, `${path}/productDefectRemediation`),
        });
    }
    const phase = reviewPhaseForDecision(reviewDecision.decision);
    if (value.phase !== phase)
        fail("relation", `${path}/phase`);
    return Object.freeze({
        ...base,
        phase,
        currentDelivery: reviewedDelivery,
    });
}
/**
 * 已经准备过投递的实现目标：阶段沿投递、结局、结果、评审逐层加事实，每一层缺了前一层即失败。
 */
function parseDeliveredProductTarget(value, path, base, productCurrentDelivery, registerClaim) {
    if (productCurrentDelivery === undefined) {
        fail("relation", `${path}/currentDelivery`);
    }
    const currentDelivery = parseCurrentDeliveryBase(productCurrentDelivery, `${path}/currentDelivery`);
    registerClaim(currentDelivery);
    if (value.phase === "delivery-prepared") {
        return Object.freeze({
            ...base,
            phase: "delivery-prepared",
            currentDelivery,
        });
    }
    if (productCurrentDelivery.outcome === undefined) {
        fail("relation", `${path}/currentDelivery/outcome`);
    }
    const observedDelivery = Object.freeze({
        ...currentDelivery,
        outcome: parseDeliveryOutcomeSummary(productCurrentDelivery.outcome, `${path}/currentDelivery/outcome`),
    });
    if (value.phase === "host-effect-accepted" ||
        value.phase === "host-effect-indeterminate" ||
        value.phase === "host-effect-rejected") {
        const expectedPhase = observedDelivery.outcome.disposition === "accepted"
            ? "host-effect-accepted"
            : observedDelivery.outcome.disposition === "indeterminate"
                ? "host-effect-indeterminate"
                : "host-effect-rejected";
        if (value.phase !== expectedPhase)
            fail("relation", `${path}/phase`);
        return Object.freeze({
            ...base,
            phase: expectedPhase,
            currentDelivery: observedDelivery,
        });
    }
    if (productCurrentDelivery.targetResult === undefined ||
        observedDelivery.outcome.disposition === "rejected-before-send") {
        fail("relation", `${path}/currentDelivery/targetResult`);
    }
    const resultDelivery = Object.freeze({
        ...observedDelivery,
        targetResult: parseTargetResultSummary(productCurrentDelivery.targetResult, `${path}/currentDelivery/targetResult`),
    });
    if (value.phase === "result-reported") {
        return Object.freeze({
            ...base,
            phase: "result-reported",
            currentDelivery: resultDelivery,
        });
    }
    return parseReviewedProductTarget(value, path, base, productCurrentDelivery, resultDelivery);
}
function parseProductTargetTask(value, path, common, registerClaim, repositoryIds) {
    if (value.repositoryId === undefined ||
        value.commitExpectation === undefined ||
        value.acceptanceAnchorIds === undefined) {
        fail("schema", path);
    }
    const repositoryId = parseId(value.repositoryId, "repository", `${path}/repositoryId`);
    // 一个仓库同时只能有一个未接受且未被替代的实现目标；已接受与被替代的目标是历史。
    if (value.phase !== "accepted" && value.phase !== "superseded") {
        if (repositoryIds.has(repositoryId))
            fail("relation", path);
        repositoryIds.add(repositoryId);
    }
    const base = {
        ...common,
        repositoryId,
        commitExpectation: value.commitExpectation,
        acceptanceAnchorIds: parseAcceptanceAnchorIds(value.acceptanceAnchorIds, `${path}/acceptanceAnchorIds`),
        ...(value.reworkCount === undefined ? {} : { reworkCount: value.reworkCount }),
    };
    const productCurrentDelivery = value.currentDelivery;
    if (value.phase === "superseded") {
        if (value.supersededByTargetTaskId === undefined) {
            fail("schema", `${path}/supersededByTargetTaskId`);
        }
        const supersededByTargetTaskId = parseId(value.supersededByTargetTaskId, "target-task", `${path}/supersededByTargetTaskId`);
        if (supersededByTargetTaskId === common.targetTaskId)
            fail("relation", path);
        return Object.freeze({
            ...base,
            phase: "superseded",
            supersededByTargetTaskId,
        });
    }
    if (value.phase === "planned") {
        return Object.freeze({ ...base, phase: "planned" });
    }
    return parseDeliveredProductTarget(value, path, base, productCurrentDelivery, registerClaim);
}
function parseTargetTasks(values) {
    const result = [];
    const packageIds = new Set();
    const repositoryIds = new Set();
    const claimIds = new Set();
    let previousTargetTaskId;
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (value === undefined)
            fail("schema", `$/targetTasks/${index}`);
        const path = `$/targetTasks/${index}`;
        const targetTaskId = parseId(value.targetTaskId, "target-task", `${path}/targetTaskId`);
        const taskPackageId = parseId(value.taskPackageId, "task-package", `${path}/taskPackageId`);
        if ((previousTargetTaskId !== undefined &&
            compareText(previousTargetTaskId, targetTaskId) >= 0) ||
            packageIds.has(taskPackageId)) {
            fail("relation", path);
        }
        previousTargetTaskId = targetTaskId;
        packageIds.add(taskPackageId);
        const common = {
            targetTaskId,
            taskPackageId,
            taskPackageDigest: parseDigest(value.taskPackageDigest, `${path}/taskPackageDigest`),
            windowId: parseId(value.windowId, "window", `${path}/windowId`),
        };
        // 每个当前投递的围栏声明在整个状态里唯一：同一声明不能同时服务两个目标。
        const registerClaim = (delivery) => {
            if (claimIds.has(delivery.fence.claimId)) {
                fail("relation", `${path}/currentDelivery/fence/claimId`);
            }
            claimIds.add(delivery.fence.claimId);
        };
        result.push(value.workType === "test"
            ? parseTestTargetTask(value, path, common, registerClaim)
            : parseProductTargetTask(value, path, common, registerClaim, repositoryIds));
    }
    return Object.freeze(result);
}
/** 待复测记录指的那一代测试目标：停在产品缺陷、任务包与那次升级的评审决定都对得上。 */
function isRetestSource(target, pendingTestRetest) {
    return (target.phase === "test-product-defect" &&
        target.targetTaskId === pendingTestRetest.previousTestTarget.targetTaskId &&
        target.taskPackageId === pendingTestRetest.previousTestTarget.taskPackageId &&
        target.taskPackageDigest === pendingTestRetest.previousTestTarget.taskPackageDigest &&
        target.currentDelivery.reviewDecision.targetReviewDecisionId ===
            pendingTestRetest.testReviewDecision.targetReviewDecisionId &&
        target.currentDelivery.reviewDecision.decisionDigest ===
            pendingTestRetest.testReviewDecision.decisionDigest &&
        target.currentDelivery.reviewDecision.decision === "escalate");
}
/**
 * 目标之间与目标同生命周期之间的三条关系：未终结的测试目标至多一个，并且只能站在全部已接受的实现基线
 * 上；待复测记录要有它指的那一代缺陷目标，且此时没有未终结的测试目标；completed 的 Demand 没有未了结的
 * 实现与测试。
 */
function assertTargetRelations(lifecycle, targetTasks, continuation, pendingTestRetest) {
    const implementationTargets = targetTasks.filter((target) => target.workType !== "test");
    const liveImplementationTargets = implementationTargets.filter((target) => target.phase !== "superseded");
    const testTargets = currentTestTargetsOf({ targetTasks, continuation });
    // 同一时间只有一个未终结的 test 目标（能力卡 5 Q4）；历史代际只能停在 test-product-defect。
    const openTestTargets = testTargets.filter((target) => target.phase !== "test-product-defect");
    // 未终结的 test 目标只能站在全部已接受的实现基线上；缺陷代际之后的产品返工不受此限。
    if (openTestTargets.length > 1 ||
        (openTestTargets.length === 1 &&
            (liveImplementationTargets.length === 0 ||
                liveImplementationTargets.some((target) => target.phase !== "accepted")))) {
        fail("relation", "$/targetTasks");
    }
    if (pendingTestRetest !== undefined &&
        (openTestTargets.length !== 0 ||
            !testTargets.some((target) => isRetestSource(target, pendingTestRetest)))) {
        fail("relation", "$/pendingTestRetest");
    }
    if (lifecycle === "completed" &&
        (pendingTestRetest !== undefined ||
            // research（not-applicable）零实现目标也能 completed（§13.94 D8）；实现目标数量由完成转换按测试模式把关。
            liveImplementationTargets.some((target) => target.phase !== "accepted") ||
            (testTargets.length > 0 &&
                (openTestTargets.length !== 1 || openTestTargets[0]?.phase !== "test-accepted")))) {
        fail("relation", "$/lifecycle");
    }
}
function normalizeState(wire) {
    const targetTasks = parseTargetTasks(wire.targetTasks);
    const managedEvidence = wire.managedEvidence === undefined
        ? undefined
        : parseManagedEvidenceSummaries(wire.managedEvidence);
    const pendingTestRetest = wire.pendingTestRetest === undefined
        ? undefined
        : parsePendingTestRetest(wire.pendingTestRetest);
    const awaitingDecision = wire.awaitingDecision === undefined
        ? undefined
        : parseAwaitingDecision(wire.awaitingDecision, wire.lifecycle);
    const continuation = wire.continuation === undefined
        ? undefined
        : parseContinuationState(wire.continuation, targetTasks);
    const supplements = wire.supplements === undefined ? undefined : parseSupplementPackages(wire.supplements);
    assertTargetRelations(wire.lifecycle, targetTasks, continuation, pendingTestRetest);
    return Object.freeze({
        artifactKind: DEMAND_AGGREGATE_STATE_ARTIFACT_KIND,
        schemaVersion: DEMAND_AGGREGATE_STATE_SCHEMA_VERSION,
        demandId: parseId(wire.demandId, "demand", "$/demandId"),
        authorityDigest: parseDigest(wire.authorityDigest, "$/authorityDigest"),
        lifecycle: wire.lifecycle,
        targetTasks,
        ...(managedEvidence === undefined ? {} : { managedEvidence }),
        ...(pendingTestRetest === undefined ? {} : { pendingTestRetest }),
        ...(awaitingDecision === undefined ? {} : { awaitingDecision }),
        ...(continuation === undefined ? {} : { continuation }),
        ...(supplements === undefined ? {} : { supplements }),
    });
}
/** 并入的 supplement 包不重复：同一个包、同一份记录只并入一次。 */
function parseSupplementPackages(value) {
    const parsed = value.map((entry, index) => {
        try {
            const lineage = parseRequirementLineageReference({
                artifactKind: "wakeflow-requirement-lineage",
                schemaVersion: 1,
                ...entry,
            });
            return Object.freeze({
                requirementId: lineage.requirementId,
                recordRef: lineage.recordRef,
                recordDigest: lineage.recordDigest,
            });
        }
        catch (error) {
            if (error instanceof RequirementLineageError)
                fail("relation", `$/supplements/${index}`, error);
            throw error;
        }
    });
    if (new Set(parsed.map((entry) => entry.requirementId)).size !== parsed.length ||
        new Set(parsed.map((entry) => entry.recordDigest)).size !== parsed.length) {
        fail("relation", "$/supplements");
    }
    return Object.freeze(parsed);
}
/** 升级只在活动 Demand 上等待回答；终态不能携带未回答的升级。 */
function parseAwaitingDecision(value, lifecycle) {
    if (lifecycle !== "active")
        fail("relation", "$/awaitingDecision");
    const escalationEventId = parseId(value.escalationEventId, "demand-event", "$/awaitingDecision/escalationEventId");
    parseId(value.source.targetTaskId, "target-task", "$/awaitingDecision/source/targetTaskId");
    return Object.freeze({
        escalationEventId,
        issue: value.issue,
        source: Object.freeze({ ...value.source }),
    });
}
/** 历史 test 目标必须是状态里已终结（test-accepted 或 test-product-defect）的 test 目标。 */
function parseContinuationState(value, targetTasks) {
    const historical = value.historicalTestTargetIds;
    if (historical?.some((targetTaskId) => {
        const target = targetTasks.find((entry) => entry.targetTaskId === targetTaskId);
        return (target === undefined ||
            (target.phase !== "test-accepted" && target.phase !== "test-product-defect"));
    })) {
        fail("relation", "$/continuation/historicalTestTargetIds");
    }
    return Object.freeze({
        eventId: parseId(value.eventId, "demand-event", "$/continuation/eventId"),
        kind: value.kind,
        planningRequired: value.planningRequired,
        ...(historical === undefined
            ? {}
            : {
                historicalTestTargetIds: Object.freeze(historical.map((targetTaskId, index) => parseId(targetTaskId, "target-task", `$/continuation/historicalTestTargetIds/${index}`))),
            }),
    });
}
export function parseDemandAggregateState(value) {
    let json;
    try {
        json = parseJsonValue(value, "$state");
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("json", error.path, error);
        throw error;
    }
    const result = validateWire(json);
    if (!result.ok)
        fail("schema", result.path);
    return normalizeState(result.value);
}
/** `publication.demand-published.v1` 唯一允许创建的初始业务状态。 */
export function createInitialDemandAggregateState(demandIdValue, authorityDigestValue) {
    return parseDemandAggregateState({
        artifactKind: DEMAND_AGGREGATE_STATE_ARTIFACT_KIND,
        schemaVersion: DEMAND_AGGREGATE_STATE_SCHEMA_VERSION,
        demandId: parseId(demandIdValue, "demand", "$demandId"),
        authorityDigest: parseDigest(authorityDigestValue, "$authorityDigest"),
        lifecycle: "active",
        targetTasks: [],
    });
}
export function computeDemandAggregateStateDigest(value) {
    return computeCanonicalJsonSha256Digest(parseDemandAggregateState(value));
}
