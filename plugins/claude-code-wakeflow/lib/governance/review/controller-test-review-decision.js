import { WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_SCHEMA } from "../../contracts/generated/governance/review/controller-test-review-decision.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_TASK_PACKAGE_SCHEMA } from "../../contracts/generated/governance/tasking/task-package.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { createWakeflowDurableId, parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { DeterministicJsonDocumentError, parseDeterministicJsonDocument, renderDeterministicJsonDocument, } from "../../foundation/data/deterministic-json-document.js";
import { JsonValueError, parseJsonValue, } from "../../foundation/data/json-value.js";
import { createUuidV4, UuidV4Error, } from "../../foundation/identity/uuid-v4.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { parseUtcInstant, UtcInstantError, } from "../../foundation/time/utc-instant.js";
import { readUtcWallClock, UtcWallClockError, } from "../../foundation/time/wall-clock.js";
import { DemandEventStreamPositionError, parseDemandEventStreamRevision, } from "../demand/event-sourcing/demand-event-stream-position.js";
import { normalizeControllerReviewCallbackLanding, normalizeControllerReviewResumption, normalizeControllerReviewTargetCompletion, normalizeControllerTestReviewEscalation, } from "./controller-review-decision-contract.js";
/**
 * Wakeflow Governance / Review：Controller对单个test Target的审查决定。
 *
 * 词汇：accept、request-another-attempt（附 stepIds，只跑失败子集）、blocked、escalate
 * （附分类：product-defect 走授权返工，needs-decision 走用户决策）（ADR-0012 D4）。
 * 分类到决定的准入由切片按逐步记录判定；本记录只约束形状与最小一致性。Result 的
 * completed 与 pass 都不能替代本记录中的独立检查。
 */
const DECISION_KIND = "WakeflowControllerTestReviewDecision";
const DECISION_SCHEMA_VERSION = 1;
const CHECK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const CONTROL_EXCEPT_LF_PATTERN = /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const ERROR_MESSAGES = {
    json: "Controller Test Review Decision is not passive JSON data.",
    schema: "Controller Test Review Decision does not satisfy its Schema.",
    identifier: "Controller Test Review Decision contains an invalid identity.",
    digest: "Controller Test Review Decision contains an invalid or inconsistent digest.",
    position: "Controller Test Review Decision contains an invalid Event Stream position.",
    time: "Controller Test Review Decision contains an invalid decision time.",
    text: "Controller Test Review Decision contains invalid review text.",
    relation: "Controller Test Review Decision facts are inconsistent.",
    representation: "Controller Test Review Decision bytes are not deterministic.",
};
export class ControllerTestReviewDecisionError extends Error {
    name = "ControllerTestReviewDecisionError";
    code = "wakeflow-controller-test-review-decision";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const validateWire = createRuntimeJsonSchemaValidator(WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_SCHEMA, [
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_TASK_PACKAGE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
]);
function fail(reason, path) {
    throw new ControllerTestReviewDecisionError(reason, path);
}
function id(value, kind, path) {
    try {
        return parseWakeflowDurableIdOfKind(value, kind, path);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("identifier", path);
        throw error;
    }
}
function digest(value, path) {
    try {
        return parseSha256Digest(value, path);
    }
    catch (error) {
        if (error instanceof Sha256Error)
            fail("digest", path);
        throw error;
    }
}
function instant(value, path) {
    try {
        return parseUtcInstant(value, path);
    }
    catch (error) {
        if (error instanceof UtcInstantError)
            fail("time", path);
        throw error;
    }
}
function streamRevision(value, path) {
    try {
        return parseDemandEventStreamRevision(value, path);
    }
    catch (error) {
        if (error instanceof DemandEventStreamPositionError)
            fail("position", path);
        throw error;
    }
}
function humanText(value, path) {
    if (typeof value !== "string" ||
        value.length === 0 ||
        Array.from(value).length > 8192 ||
        !value.isWellFormed() ||
        value.normalize("NFC") !== value ||
        value.trim() !== value ||
        CONTROL_EXCEPT_LF_PATTERN.test(value)) {
        fail("text", path);
    }
    return value;
}
function checkId(value, path) {
    if (typeof value !== "string" || !CHECK_ID_PATTERN.test(value)) {
        fail("text", path);
    }
    return value;
}
function textList(values, path) {
    const admitted = values.map((value, index) => humanText(value, `${path}/${index}`));
    if (new Set(admitted).size !== admitted.length)
        fail("relation", path);
    return Object.freeze(admitted);
}
function stepIdList(values, path) {
    if (values === null)
        return null;
    const [first, ...rest] = values;
    if (first === undefined || new Set(values).size !== values.length) {
        fail("relation", path);
    }
    return Object.freeze([first, ...rest]);
}
/**
 * 决定与评估、检查、范围、升级的最小一致性（ADR-0012 D4）：
 * accept 要求 completed、satisfied/sufficient、检查全过、无阻塞、有完成证据；
 * request-another-attempt 要求 inconclusive 或 insufficient、带范围；escalate 当且仅当带分类：
 * product-defect 要求 defect-observed/sufficient 且有失败检查，needs-decision 不能是 satisfied；
 * blocked 要求阻塞原因。分类到决定的路由由切片按逐步记录判定。
 */
export function assertControllerTestReviewJudgment(judgment, resultOutcome, targetCompletion) {
    const { decision, assessment, independentChecks: checks, blockingReasons, stepIds, escalation, } = judgment;
    const escalates = decision === "escalate";
    if (escalates !== (escalation !== null) ||
        (decision === "request-another-attempt") !== (stepIds !== null) ||
        (decision === "accept" &&
            (resultOutcome !== "completed" ||
                targetCompletion === null ||
                assessment.conclusion !== "satisfied" ||
                assessment.evidenceSufficiency !== "sufficient" ||
                checks.some((check) => check.outcome !== "passed") ||
                blockingReasons.length !== 0)) ||
        (decision === "request-another-attempt" &&
            ((assessment.conclusion !== "inconclusive" &&
                assessment.evidenceSufficiency !== "insufficient") ||
                !checks.some((check) => check.outcome === "failed" || check.outcome === "inconclusive") ||
                blockingReasons.length !== 0)) ||
        (escalation !== null &&
            escalation.classification === "product-defect" &&
            (resultOutcome === "blocked" ||
                assessment.conclusion !== "defect-observed" ||
                assessment.evidenceSufficiency !== "sufficient" ||
                !checks.some((check) => check.outcome === "failed") ||
                blockingReasons.length !== 0)) ||
        (escalation !== null &&
            escalation.classification === "needs-decision" &&
            assessment.conclusion === "satisfied") ||
        (decision === "blocked" &&
            (blockingReasons.length === 0 ||
                (assessment.conclusion === "satisfied" &&
                    assessment.evidenceSufficiency === "sufficient")))) {
        fail("relation", "$/decision");
    }
}
function decisionBasis(value) {
    return {
        kind: DECISION_KIND,
        schemaVersion: DECISION_SCHEMA_VERSION,
        targetReviewDecisionId: value.targetReviewDecisionId,
        programId: value.programId,
        demandId: value.demandId,
        targetTaskId: value.targetTaskId,
        controllerWindowId: value.controllerWindowId,
        reviewed: value.reviewed,
        testExecution: value.testExecution,
        decision: value.decision,
        assessment: value.assessment,
        independentChecks: value.independentChecks,
        rationale: value.rationale,
        blockingReasons: value.blockingReasons,
        residualRisks: value.residualRisks,
        stepIds: value.stepIds,
        escalation: value.escalation,
        resumption: value.resumption,
        callbackLanding: value.callbackLanding,
        targetCompletion: value.targetCompletion,
        decidedAt: value.decidedAt,
    };
}
function reviewedOf(wire) {
    return Object.freeze({
        snapshotDigest: digest(wire.snapshotDigest, "$/reviewed/snapshotDigest"),
        reviewUnitDigest: digest(wire.reviewUnitDigest, "$/reviewed/reviewUnitDigest"),
        stateDigest: digest(wire.stateDigest, "$/reviewed/stateDigest"),
        streamRevision: streamRevision(wire.streamRevision, "$/reviewed/streamRevision"),
        taskPackageId: id(wire.taskPackageId, "task-package", "$/reviewed/taskPackageId"),
        taskPackageDigest: digest(wire.taskPackageDigest, "$/reviewed/taskPackageDigest"),
        targetResultId: id(wire.targetResultId, "target-result", "$/reviewed/targetResultId"),
        targetResultDigest: digest(wire.targetResultDigest, "$/reviewed/targetResultDigest"),
        targetResultOutcome: wire.targetResultOutcome,
        targetResultReportedAt: instant(wire.targetResultReportedAt, "$/reviewed/targetResultReportedAt"),
    });
}
export function parseControllerTestReviewDecision(value) {
    let json;
    try {
        json = parseJsonValue(value, "$decision");
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("json", error.path);
        throw error;
    }
    const validated = validateWire(json);
    if (!validated.ok)
        fail("schema", validated.path);
    const wire = validated.value;
    const checks = wire.independentChecks.map((check, index) => Object.freeze({
        checkId: checkId(check.checkId, `$/independentChecks/${index}/checkId`),
        method: humanText(check.method, `$/independentChecks/${index}/method`),
        outcome: check.outcome,
        observation: humanText(check.observation, `$/independentChecks/${index}/observation`),
    }));
    if (new Set(checks.map((check) => check.checkId)).size !== checks.length) {
        fail("relation", "$/independentChecks");
    }
    const firstCheck = checks[0];
    if (firstCheck === undefined)
        fail("schema", "$/independentChecks");
    const reviewed = reviewedOf(wire.reviewed);
    const testExecution = Object.freeze({
        testAttemptId: id(wire.testExecution.testAttemptId, "test-attempt", "$/testExecution/testAttemptId"),
    });
    const targetCompletion = normalizeControllerReviewTargetCompletion(wire.targetCompletion, "$/targetCompletion", fail);
    const judgment = {
        decision: wire.decision,
        assessment: Object.freeze({
            conclusion: wire.assessment.conclusion,
            evidenceSufficiency: wire.assessment.evidenceSufficiency,
        }),
        independentChecks: Object.freeze([firstCheck, ...checks.slice(1)]),
        rationale: humanText(wire.rationale, "$/rationale"),
        blockingReasons: textList(wire.blockingReasons, "$/blockingReasons"),
        residualRisks: textList(wire.residualRisks, "$/residualRisks"),
        stepIds: stepIdList(wire.stepIds, "$/stepIds"),
        escalation: wire.escalation === null
            ? null
            : normalizeControllerTestReviewEscalation(wire.escalation, "$/escalation", fail),
        resumption: wire.resumption === null
            ? null
            : normalizeControllerReviewResumption(wire.resumption, "$/resumption", fail),
    };
    assertControllerTestReviewJudgment(judgment, reviewed.targetResultOutcome, targetCompletion);
    // decidedAt只保存审计观察；因果顺序由reported Snapshot、stream revision和append CAS证明。
    const basis = decisionBasis({
        kind: DECISION_KIND,
        schemaVersion: DECISION_SCHEMA_VERSION,
        targetReviewDecisionId: id(wire.targetReviewDecisionId, "target-review-decision", "$/targetReviewDecisionId"),
        programId: id(wire.programId, "program", "$/programId"),
        demandId: id(wire.demandId, "demand", "$/demandId"),
        targetTaskId: id(wire.targetTaskId, "target-task", "$/targetTaskId"),
        controllerWindowId: id(wire.controllerWindowId, "window", "$/controllerWindowId"),
        reviewed,
        testExecution,
        ...judgment,
        callbackLanding: normalizeControllerReviewCallbackLanding(wire.callbackLanding, "$/callbackLanding", fail),
        targetCompletion,
        decidedAt: instant(wire.decidedAt, "$/decidedAt"),
    });
    const decisionDigest = digest(wire.decisionDigest, "$/decisionDigest");
    if (computeCanonicalJsonSha256Digest(basis) !== decisionDigest) {
        fail("digest", "$/decisionDigest");
    }
    return Object.freeze({ ...basis, decisionDigest });
}
export function createControllerTestReviewDecision(input, options = {}) {
    let targetReviewDecisionId;
    try {
        targetReviewDecisionId = createWakeflowDurableId("target-review-decision", createUuidV4(options.uuidFactory));
    }
    catch (error) {
        if (error instanceof UuidV4Error ||
            error instanceof WakeflowDurableIdError) {
            fail("identifier", "$uuidFactory");
        }
        throw error;
    }
    let decidedAt;
    try {
        decidedAt =
            options.clock === undefined
                ? readUtcWallClock()
                : readUtcWallClock(options.clock);
    }
    catch (error) {
        if (error instanceof UtcWallClockError)
            fail("time", "$clock");
        throw error;
    }
    const basis = decisionBasis({
        kind: DECISION_KIND,
        schemaVersion: DECISION_SCHEMA_VERSION,
        targetReviewDecisionId,
        programId: input.programId,
        demandId: input.demandId,
        targetTaskId: input.targetTaskId,
        controllerWindowId: input.controllerWindowId,
        reviewed: input.reviewed,
        testExecution: input.testExecution,
        decision: input.decision,
        assessment: input.assessment,
        independentChecks: input.independentChecks,
        rationale: input.rationale,
        blockingReasons: input.blockingReasons,
        residualRisks: input.residualRisks,
        stepIds: input.stepIds,
        escalation: input.escalation,
        resumption: input.resumption,
        callbackLanding: input.callbackLanding,
        targetCompletion: input.targetCompletion,
        decidedAt,
    });
    return parseControllerTestReviewDecision({
        ...basis,
        decisionDigest: computeCanonicalJsonSha256Digest(basis),
    });
}
export function renderControllerTestReviewDecision(value) {
    return renderDeterministicJsonDocument(parseControllerTestReviewDecision(value), "$decision");
}
export function parseControllerTestReviewDecisionDocument(text) {
    let json;
    try {
        json = parseDeterministicJsonDocument(text, "$decision");
    }
    catch (error) {
        if (error instanceof DeterministicJsonDocumentError) {
            fail("representation", "$decision");
        }
        throw error;
    }
    const decision = parseControllerTestReviewDecision(json);
    if (renderControllerTestReviewDecision(decision) !== text) {
        fail("representation", "$decision");
    }
    return decision;
}
