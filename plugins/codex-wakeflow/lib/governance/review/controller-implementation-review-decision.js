import { WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_SCHEMA } from "../../contracts/generated/governance/review/controller-implementation-review-decision.generated.js";
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
import { normalizeControllerReviewCallbackLanding, normalizeControllerReviewEscalation, normalizeControllerReviewResumption, normalizeControllerReviewTargetCompletion, } from "./controller-review-decision-contract.js";
/**
 * Wakeflow Governance / Review：Controller对单个implementation Target的审查决定。
 *
 * 本记录保存决定主体、被审查的Snapshot/Result并发基线、Controller独立检查和最终
 * 业务意图（ADR-0012 D5：accept、rework、blocked、escalate）。escalate 携带给用户的
 * 升级内容；blocked 或 escalated 之后的新决定携带 resumption；回调落地与目标会话完成
 * 证据由 Wakeflow 派生写入。它不把Target Report当成事实，也不执行后续重派或宿主效果。
 */
const DECISION_KIND = "WakeflowControllerImplementationReviewDecision";
const DECISION_SCHEMA_VERSION = 1;
const CHECK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const CONTROL_EXCEPT_LF_PATTERN = /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const ERROR_MESSAGES = {
    json: "Controller Implementation Review Decision is not passive JSON data.",
    schema: "Controller Implementation Review Decision does not satisfy its Schema.",
    identifier: "Controller Implementation Review Decision contains an invalid identity.",
    digest: "Controller Implementation Review Decision contains an invalid or inconsistent digest.",
    position: "Controller Implementation Review Decision contains an invalid Event Stream position.",
    time: "Controller Implementation Review Decision contains an invalid decision time.",
    text: "Controller Implementation Review Decision contains invalid review text.",
    relation: "Controller Implementation Review Decision facts are inconsistent.",
    representation: "Controller Implementation Review Decision bytes are not deterministic.",
};
/** Controller审查决定准入、创建或确定性表示失败时的稳定错误。 */
export class ControllerImplementationReviewDecisionError extends Error {
    name = "ControllerImplementationReviewDecisionError";
    code = "wakeflow-controller-implementation-review-decision";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const validateWire = createRuntimeJsonSchemaValidator(WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_SCHEMA, [
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_TASK_PACKAGE_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
]);
function fail(reason, path) {
    throw new ControllerImplementationReviewDecisionError(reason, path);
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
function streamRevision(value, path) {
    try {
        return parseDemandEventStreamRevision(value, path);
    }
    catch (error) {
        if (error instanceof DemandEventStreamPositionError) {
            fail("position", path);
        }
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
/**
 * 决定与升级、恢复依据的最小一致性：escalate 当且仅当携带升级内容；accept 必须有目标
 * 会话完成证据。决定准入的其余规则（结果 completed、锚点全映射、rework 计数）由切片与聚合承担。
 */
export function assertControllerImplementationReviewJudgment(judgment, targetCompletion) {
    const { decision, assessment, blockingReasons, escalation } = judgment;
    if ((decision === "escalate") !== (escalation !== null) ||
        (decision === "accept" &&
            (targetCompletion === null ||
                assessment.requirementAlignment !== "aligned" ||
                assessment.implementationQuality !== "satisfactory" ||
                blockingReasons.length !== 0)) ||
        (decision === "blocked" && blockingReasons.length === 0)) {
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
        decision: value.decision,
        assessment: value.assessment,
        independentChecks: value.independentChecks,
        rationale: value.rationale,
        blockingReasons: value.blockingReasons,
        residualRisks: value.residualRisks,
        escalation: value.escalation,
        resumption: value.resumption,
        callbackLanding: value.callbackLanding,
        targetCompletion: value.targetCompletion,
        ...(value.anchorEvidence === null ? {} : { anchorEvidence: value.anchorEvidence }),
        decidedAt: value.decidedAt,
    };
}
function anchorEvidenceOf(value) {
    if (value === undefined || value === null)
        return null;
    const entries = value.map((entry, index) => {
        const evidenceIds = entry.evidenceIds.map((evidenceId, position) => id(evidenceId, "evidence", `$/anchorEvidence/${index}/evidenceIds/${position}`));
        const [first, ...rest] = evidenceIds;
        if (first === undefined)
            fail("schema", `$/anchorEvidence/${index}/evidenceIds`);
        if (new Set(evidenceIds).size !== evidenceIds.length) {
            fail("relation", `$/anchorEvidence/${index}/evidenceIds`);
        }
        return Object.freeze({
            anchorId: checkId(entry.anchorId, `$/anchorEvidence/${index}/anchorId`),
            evidenceIds: Object.freeze([first, ...rest]),
        });
    });
    if (new Set(entries.map((entry) => entry.anchorId)).size !== entries.length) {
        fail("relation", "$/anchorEvidence");
    }
    return Object.freeze(entries);
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
/** 严格解析并复验一份Controller单Target审查决定。 */
export function parseControllerImplementationReviewDecision(value) {
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
    const targetCompletion = normalizeControllerReviewTargetCompletion(wire.targetCompletion, "$/targetCompletion", fail);
    const anchorEvidence = anchorEvidenceOf(wire.anchorEvidence);
    const judgment = {
        decision: wire.decision,
        assessment: Object.freeze({
            requirementAlignment: wire.assessment.requirementAlignment,
            implementationQuality: wire.assessment.implementationQuality,
        }),
        independentChecks: Object.freeze([firstCheck, ...checks.slice(1)]),
        rationale: humanText(wire.rationale, "$/rationale"),
        blockingReasons: textList(wire.blockingReasons, "$/blockingReasons"),
        residualRisks: textList(wire.residualRisks, "$/residualRisks"),
        escalation: wire.escalation === null
            ? null
            : normalizeControllerReviewEscalation(wire.escalation, "$/escalation", fail),
        resumption: wire.resumption === null
            ? null
            : normalizeControllerReviewResumption(wire.resumption, "$/resumption", fail),
    };
    assertControllerImplementationReviewJudgment(judgment, targetCompletion);
    const basis = decisionBasis({
        kind: DECISION_KIND,
        schemaVersion: DECISION_SCHEMA_VERSION,
        targetReviewDecisionId: id(wire.targetReviewDecisionId, "target-review-decision", "$/targetReviewDecisionId"),
        programId: id(wire.programId, "program", "$/programId"),
        demandId: id(wire.demandId, "demand", "$/demandId"),
        targetTaskId: id(wire.targetTaskId, "target-task", "$/targetTaskId"),
        controllerWindowId: id(wire.controllerWindowId, "window", "$/controllerWindowId"),
        reviewed: reviewedOf(wire.reviewed),
        ...judgment,
        callbackLanding: normalizeControllerReviewCallbackLanding(wire.callbackLanding, "$/callbackLanding", fail),
        targetCompletion,
        anchorEvidence,
        decidedAt: instant(wire.decidedAt, "$/decidedAt"),
    });
    // 锚点绑定只属于 accept；needs-review 结果的 accept 没有绑定就没有依据（§13.121 D7）。
    if ((anchorEvidence !== null && basis.decision !== "accept") ||
        (basis.decision === "accept" &&
            basis.reviewed.targetResultOutcome === "needs-review" &&
            anchorEvidence === null)) {
        fail("relation", "$/anchorEvidence");
    }
    const decisionDigest = digest(wire.decisionDigest, "$/decisionDigest");
    if (computeCanonicalJsonSha256Digest(basis) !== decisionDigest) {
        fail("digest", "$/decisionDigest");
    }
    return Object.freeze({ ...basis, anchorEvidence, decisionDigest });
}
/** 从Controller陈述、墙上时钟和单个新UUID创建审查决定。 */
export function createControllerImplementationReviewDecision(input, options = {}) {
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
        decision: input.decision,
        assessment: input.assessment,
        independentChecks: input.independentChecks,
        rationale: input.rationale,
        blockingReasons: input.blockingReasons,
        residualRisks: input.residualRisks,
        escalation: input.escalation,
        resumption: input.resumption,
        callbackLanding: input.callbackLanding,
        targetCompletion: input.targetCompletion,
        anchorEvidence: input.anchorEvidence,
        decidedAt,
    });
    return parseControllerImplementationReviewDecision({
        ...basis,
        decisionDigest: computeCanonicalJsonSha256Digest(basis),
    });
}
export function renderControllerImplementationReviewDecision(value) {
    return renderDeterministicJsonDocument(parseControllerImplementationReviewDecision(value), "$decision");
}
export function parseControllerImplementationReviewDecisionDocument(text) {
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
    const decision = parseControllerImplementationReviewDecision(json);
    if (renderControllerImplementationReviewDecision(decision) !== text) {
        fail("representation", "$decision");
    }
    return decision;
}
