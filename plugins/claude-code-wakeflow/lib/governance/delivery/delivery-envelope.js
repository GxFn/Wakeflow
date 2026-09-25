import { WAKEFLOW_PRESENTATION_LANGUAGES, } from "../../configuration/wakeflow-config.js";
import { WAKEFLOW_DELIVERY_ENVELOPE_SCHEMA } from "../../contracts/generated/governance/delivery/delivery-envelope.generated.js";
import { WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA } from "../../contracts/generated/governance/testing/test-execution-attempt.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_TASK_PACKAGE_SCHEMA } from "../../contracts/generated/governance/tasking/task-package.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA } from "../../contracts/generated/workspace/window-host-binding.generated.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { JsonValueError, parseJsonValue, } from "../../foundation/data/json-value.js";
import { parseDenseArray, parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { parsePortableResourcePath, PortableResourcePathError, } from "../../foundation/filesystem/portable-resource-path.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { computePromptDigest, DELIVERY_PROMPT_MAXIMUM_CHARACTERS, } from "../../kernel/prompt-digest.js";
import { parseUtcInstant, UtcInstantError, } from "../../foundation/time/utc-instant.js";
import { WAKEFLOW_WORKSPACE_HOST_IDS } from "../../workspace/workspace-host-resource-profile.js";
import { parseWakeflowWindowHostBindingId, WakeflowWindowHostBindingIdError, } from "../../workspace/window-runtime/wakeflow-window-host-binding-id.js";
import { demandFinalRootRef } from "../demand/publication/demand-publication-paths.js";
import { parseTestExecutionAttempt, TestExecutionAttemptError, } from "../testing/test-execution-attempt.js";
import { computeTaskPackageDigest, parseTaskPackage, TaskPackageError, } from "../tasking/task-package.js";
import { taskPackageProjectionRef, TaskPackageProjectionPathError, } from "../tasking/task-package-projection-paths.js";
const ERROR_MESSAGES = {
    json: "Delivery Envelope is not passive JSON data.",
    schema: "Delivery Envelope does not satisfy its portable Schema.",
    identifier: "Delivery Envelope contains an invalid typed identity.",
    digest: "Delivery Envelope contains an invalid or inconsistent digest.",
    path: "Delivery Envelope contains an invalid TaskPackage reference.",
    host: "Delivery Envelope contains an unsupported host.",
    language: "Delivery Envelope contains an unsupported presentation language.",
    prompt: "Delivery Envelope prompt is invalid.",
    rework: "Delivery Envelope rework context is invalid or inconsistent.",
    "product-defect-remediation": "Delivery Envelope product-defect remediation context is invalid or inconsistent.",
    time: "Delivery Envelope contains an invalid preparation time.",
    "task-package": "Delivery Envelope source TaskPackage is invalid.",
    attempt: "Delivery Envelope test attempt is invalid or does not follow its sources.",
    relation: "Delivery Envelope does not match its TaskPackage, route, or sources.",
};
/** 投递信封准入、创建或来源闭合失败时的稳定错误。 */
export class DeliveryEnvelopeError extends Error {
    name = "DeliveryEnvelopeError";
    code = "wakeflow-delivery-envelope";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const MAXIMUM_REWORK_RATIONALE_CODE_POINTS = 1_024;
// 返工整改项要装得下证据 ref 与摘要（§13.120 第二轮：256 个码点把第一条证据 ref 截在半路）。
const MAXIMUM_REWORK_METHOD_CODE_POINTS = 512;
const MAXIMUM_REWORK_OBSERVATION_CODE_POINTS = 1_024;
const REWORK_CHECK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const CONTROL_EXCEPT_LF_PATTERN = /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const HOST_IDS = new Set(WAKEFLOW_WORKSPACE_HOST_IDS);
const LANGUAGES = new Set(WAKEFLOW_PRESENTATION_LANGUAGES);
/** 投递 prompt 的字符上限：规则住在内核 `prompt-digest`（§13.97 D3），这里再导出给渲染侧。 */
export { DELIVERY_PROMPT_MAXIMUM_CHARACTERS };
const validateWire = createRuntimeJsonSchemaValidator(WAKEFLOW_DELIVERY_ENVELOPE_SCHEMA, [
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_TASK_PACKAGE_SCHEMA,
    WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
    WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA,
]);
function fail(reason, path) {
    throw new DeliveryEnvelopeError(reason, path);
}
function parseId(value, kind, path) {
    try {
        return parseWakeflowDurableIdOfKind(value, kind, path);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("identifier", path);
        throw error;
    }
}
function exactRecord(value, fields, path) {
    let record;
    try {
        record = parsePlainRecord(value, path);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("rework", path);
        throw error;
    }
    const keys = Object.keys(record).sort();
    const expected = [...fields].sort();
    if (keys.length !== expected.length ||
        keys.some((key, index) => key !== expected[index])) {
        fail("rework", path);
    }
    return record;
}
function reworkText(value, maximumCodePoints, path) {
    if (typeof value !== "string" ||
        value.length === 0 ||
        value.trim() !== value ||
        !value.isWellFormed() ||
        CONTROL_EXCEPT_LF_PATTERN.test(value) ||
        Array.from(value).length > maximumCodePoints) {
        fail("rework", path);
    }
    return value;
}
function reworkCheckId(value, path) {
    if (typeof value !== "string" || !REWORK_CHECK_ID_PATTERN.test(value)) {
        fail("rework", path);
    }
    return value;
}
/** 严格解析一份有界返工投影，不读取完整Decision或TargetResult。 */
export function parseTargetDeliveryReworkContext(value, path = "$rework") {
    const record = exactRecord(value, ["decision", "previousResult", "rationaleSummary", "requiredCorrections"], path);
    const decision = exactRecord(record.decision, ["targetReviewDecisionId", "decisionDigest"], `${path}/decision`);
    const previousResult = exactRecord(record.previousResult, ["targetResultId", "resultDigest"], `${path}/previousResult`);
    let correctionValues;
    try {
        correctionValues = parseDenseArray(record.requiredCorrections, 32, `${path}/requiredCorrections`);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError) {
            fail("rework", `${path}/requiredCorrections`);
        }
        throw error;
    }
    if (correctionValues.length === 0) {
        fail("rework", `${path}/requiredCorrections`);
    }
    const corrections = correctionValues.map((value, index) => {
        const correctionPath = `${path}/requiredCorrections/${index}`;
        const correction = exactRecord(value, ["checkId", "outcome", "methodSummary", "observationSummary"], correctionPath);
        if (correction.outcome !== "failed" &&
            correction.outcome !== "inconclusive") {
            fail("rework", `${correctionPath}/outcome`);
        }
        return Object.freeze({
            checkId: reworkCheckId(correction.checkId, `${correctionPath}/checkId`),
            outcome: correction.outcome,
            methodSummary: reworkText(correction.methodSummary, MAXIMUM_REWORK_METHOD_CODE_POINTS, `${correctionPath}/methodSummary`),
            observationSummary: reworkText(correction.observationSummary, MAXIMUM_REWORK_OBSERVATION_CODE_POINTS, `${correctionPath}/observationSummary`),
        });
    });
    if (new Set(corrections.map((correction) => correction.checkId)).size !==
        corrections.length ||
        !corrections.some((correction) => correction.outcome === "failed")) {
        fail("rework", `${path}/requiredCorrections`);
    }
    const first = corrections[0];
    if (first === undefined)
        fail("rework", `${path}/requiredCorrections`);
    const requiredCorrections = Object.freeze([first, ...corrections.slice(1)]);
    return Object.freeze({
        decision: Object.freeze({
            targetReviewDecisionId: parseId(decision.targetReviewDecisionId, "target-review-decision", `${path}/decision/targetReviewDecisionId`),
            decisionDigest: digest(decision.decisionDigest, `${path}/decision/decisionDigest`),
        }),
        previousResult: Object.freeze({
            targetResultId: parseId(previousResult.targetResultId, "target-result", `${path}/previousResult/targetResultId`),
            resultDigest: digest(previousResult.resultDigest, `${path}/previousResult/resultDigest`),
        }),
        rationaleSummary: reworkText(record.rationaleSummary, MAXIMUM_REWORK_RATIONALE_CODE_POINTS, `${path}/rationaleSummary`),
        requiredCorrections,
    });
}
function summarizeReworkText(value, maximumCodePoints) {
    if (typeof value !== "string" ||
        value.length === 0 ||
        value.trim() !== value ||
        !value.isWellFormed() ||
        CONTROL_EXCEPT_LF_PATTERN.test(value)) {
        fail("rework", "$reworkSource");
    }
    const codePoints = Array.from(value);
    return codePoints.length <= maximumCodePoints
        ? value
        : `${codePoints.slice(0, maximumCodePoints - 1).join("")}…`;
}
/** 把完整Review文本确定性压缩成可进入投递Intent的有界执行投影。 */
export function projectTargetDeliveryReworkContext(input) {
    return parseTargetDeliveryReworkContext({
        decision: input.decision,
        previousResult: input.previousResult,
        rationaleSummary: summarizeReworkText(input.rationale, MAXIMUM_REWORK_RATIONALE_CODE_POINTS),
        requiredCorrections: input.requiredCorrections.map((correction) => ({
            checkId: correction.checkId,
            outcome: correction.outcome,
            methodSummary: summarizeReworkText(correction.method, MAXIMUM_REWORK_METHOD_CODE_POINTS),
            observationSummary: summarizeReworkText(correction.observation, MAXIMUM_REWORK_OBSERVATION_CODE_POINTS),
        })),
    });
}
function remediationRecord(value, fields, path) {
    let record;
    try {
        record = parsePlainRecord(value, path);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError) {
            fail("product-defect-remediation", path);
        }
        throw error;
    }
    const keys = Object.keys(record).sort();
    const expected = [...fields].sort();
    if (keys.length !== expected.length ||
        keys.some((key, index) => key !== expected[index])) {
        fail("product-defect-remediation", path);
    }
    return record;
}
function remediationText(value, maximumCodePoints, path) {
    if (typeof value !== "string" ||
        value.length === 0 ||
        value.trim() !== value ||
        !value.isWellFormed() ||
        value.normalize("NFC") !== value ||
        CONTROL_EXCEPT_LF_PATTERN.test(value) ||
        Array.from(value).length > maximumCodePoints) {
        fail("product-defect-remediation", path);
    }
    return value;
}
const REMEDIATION_STEP_ID_PATTERN = /^ts-[1-9][0-9]?$/u;
function remediationStepId(value, path) {
    if (typeof value !== "string" || !REMEDIATION_STEP_ID_PATTERN.test(value)) {
        fail("product-defect-remediation", path);
    }
    return value;
}
/** 严格解析一份有界产品缺陷修复投影，不读取完整Authorization。 */
export function parseTargetDeliveryProductDefectRemediationContext(value, path = "$productDefectRemediation") {
    const record = remediationRecord(value, [
        "authorization",
        "testReviewDecision",
        "previousResult",
        "authorizationRationaleSummary",
        "correctionObjectiveSummary",
        "requiredCorrections",
    ], path);
    const authorization = remediationRecord(record.authorization, ["productDefectRemediationId", "authorizationDigest"], `${path}/authorization`);
    const testReviewDecision = remediationRecord(record.testReviewDecision, ["targetReviewDecisionId", "decisionDigest"], `${path}/testReviewDecision`);
    const previousResult = remediationRecord(record.previousResult, ["targetResultId", "resultDigest"], `${path}/previousResult`);
    let correctionValues;
    try {
        correctionValues = parseDenseArray(record.requiredCorrections, 20, `${path}/requiredCorrections`);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError) {
            fail("product-defect-remediation", `${path}/requiredCorrections`);
        }
        throw error;
    }
    if (correctionValues.length === 0) {
        fail("product-defect-remediation", `${path}/requiredCorrections`);
    }
    const corrections = correctionValues.map((value, index) => {
        const correctionPath = `${path}/requiredCorrections/${index}`;
        const correction = remediationRecord(value, ["stepId", "observedSummary"], correctionPath);
        return Object.freeze({
            stepId: remediationStepId(correction.stepId, `${correctionPath}/stepId`),
            observedSummary: remediationText(correction.observedSummary, MAXIMUM_REWORK_OBSERVATION_CODE_POINTS, `${correctionPath}/observedSummary`),
        });
    });
    if (new Set(corrections.map((correction) => correction.stepId)).size !==
        corrections.length) {
        fail("product-defect-remediation", `${path}/requiredCorrections`);
    }
    const first = corrections[0];
    if (first === undefined) {
        fail("product-defect-remediation", `${path}/requiredCorrections`);
    }
    const requiredCorrections = Object.freeze([first, ...corrections.slice(1)]);
    return Object.freeze({
        authorization: Object.freeze({
            productDefectRemediationId: parseId(authorization.productDefectRemediationId, "product-defect-remediation", `${path}/authorization/productDefectRemediationId`),
            authorizationDigest: digest(authorization.authorizationDigest, `${path}/authorization/authorizationDigest`),
        }),
        testReviewDecision: Object.freeze({
            targetReviewDecisionId: parseId(testReviewDecision.targetReviewDecisionId, "target-review-decision", `${path}/testReviewDecision/targetReviewDecisionId`),
            decisionDigest: digest(testReviewDecision.decisionDigest, `${path}/testReviewDecision/decisionDigest`),
        }),
        previousResult: Object.freeze({
            targetResultId: parseId(previousResult.targetResultId, "target-result", `${path}/previousResult/targetResultId`),
            resultDigest: digest(previousResult.resultDigest, `${path}/previousResult/resultDigest`),
        }),
        authorizationRationaleSummary: remediationText(record.authorizationRationaleSummary, MAXIMUM_REWORK_RATIONALE_CODE_POINTS, `${path}/authorizationRationaleSummary`),
        correctionObjectiveSummary: remediationText(record.correctionObjectiveSummary, MAXIMUM_REWORK_RATIONALE_CODE_POINTS, `${path}/correctionObjectiveSummary`),
        requiredCorrections,
    });
}
function summarizeRemediationText(value, maximumCodePoints) {
    if (typeof value !== "string" ||
        value.length === 0 ||
        value.trim() !== value ||
        !value.isWellFormed() ||
        value.normalize("NFC") !== value ||
        CONTROL_EXCEPT_LF_PATTERN.test(value)) {
        fail("product-defect-remediation", "$remediationSource");
    }
    const codePoints = Array.from(value);
    return codePoints.length <= maximumCodePoints
        ? value
        : `${codePoints.slice(0, maximumCodePoints - 1).join("")}…`;
}
/** 把完整Authorization文本确定性压缩成Target执行所需的有界投影。 */
export function projectTargetDeliveryProductDefectRemediationContext(input) {
    return parseTargetDeliveryProductDefectRemediationContext({
        authorization: input.authorization,
        testReviewDecision: input.testReviewDecision,
        previousResult: input.previousResult,
        authorizationRationaleSummary: summarizeRemediationText(input.authorizationRationale, MAXIMUM_REWORK_RATIONALE_CODE_POINTS),
        correctionObjectiveSummary: summarizeRemediationText(input.correctionObjective, MAXIMUM_REWORK_RATIONALE_CODE_POINTS),
        requiredCorrections: input.requiredCorrections.map((correction) => ({
            stepId: correction.stepId,
            observedSummary: summarizeRemediationText(correction.observed, MAXIMUM_REWORK_OBSERVATION_CODE_POINTS),
        })),
    });
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
/** 任务包投影在工作区里的可移植路径：Demand 活动根加任务包投影引用。 */
export function deliveryTaskPackageRef(demandId, taskPackageId) {
    try {
        return parsePortableResourcePath(`${demandFinalRootRef(demandId)}/${taskPackageProjectionRef(taskPackageId)}`);
    }
    catch (error) {
        if (error instanceof PortableResourcePathError ||
            error instanceof TaskPackageProjectionPathError) {
            fail("path", "$/target/taskPackageRef");
        }
        throw error;
    }
}
function envelopeBasis(value) {
    const shared = {
        kind: "WakeflowDeliveryEnvelope",
        schemaVersion: 1,
        deliveryId: value.deliveryId,
        programId: value.programId,
        configDigest: value.configDigest,
        demandId: value.demandId,
        target: Object.freeze({
            targetTaskId: value.target.targetTaskId,
            taskPackageId: value.target.taskPackageId,
            taskPackageRef: value.target.taskPackageRef,
            taskPackageDigest: value.target.taskPackageDigest,
        }),
        route: Object.freeze({
            hostId: value.route.hostId,
            windowId: value.route.windowId,
            bindingId: value.route.bindingId,
            bindingDigest: value.route.bindingDigest,
        }),
        language: value.language,
        portablePrompt: value.portablePrompt,
        promptDigest: value.promptDigest,
        fence: Object.freeze({
            claimId: value.fence.claimId,
            claimDigest: value.fence.claimDigest,
            expectedStreamRevision: value.fence.expectedStreamRevision,
        }),
        preparedAt: value.preparedAt,
    };
    if (value.workType === "test") {
        return Object.freeze({
            ...shared,
            workType: "test",
            attempt: value.attempt,
        });
    }
    return Object.freeze({
        ...shared,
        workType: "implementation",
        ...(value.rework === undefined ? {} : { rework: value.rework }),
        ...(value.productDefectRemediation === undefined
            ? {}
            : { productDefectRemediation: value.productDefectRemediation }),
    });
}
function parseTime(value, path) {
    try {
        return parseUtcInstant(value, path);
    }
    catch (error) {
        if (error instanceof UtcInstantError)
            fail("time", path);
        throw error;
    }
}
/** 严格解析一份信封；信封摘要必须等于其余字段的规范 JSON 摘要。 */
export function parseDeliveryEnvelope(value) {
    let json;
    try {
        json = parseJsonValue(value, "$envelope");
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
    if (!HOST_IDS.has(wire.route.hostId))
        fail("host", "$/route/hostId");
    if (!LANGUAGES.has(wire.language))
        fail("language", "$/language");
    let bindingId;
    try {
        bindingId = parseWakeflowWindowHostBindingId(wire.route.bindingId, "$/route/bindingId");
    }
    catch (error) {
        if (error instanceof WakeflowWindowHostBindingIdError)
            fail("identifier", "$/route/bindingId");
        throw error;
    }
    let taskPackageRef;
    try {
        taskPackageRef = parsePortableResourcePath(wire.target.taskPackageRef, "$/target/taskPackageRef");
    }
    catch (error) {
        if (error instanceof PortableResourcePathError)
            fail("path", "$/target/taskPackageRef");
        throw error;
    }
    const shared = {
        kind: "WakeflowDeliveryEnvelope",
        schemaVersion: 1,
        deliveryId: parseId(wire.deliveryId, "target-delivery", "$/deliveryId"),
        programId: parseId(wire.programId, "program", "$/programId"),
        configDigest: digest(wire.configDigest, "$/configDigest"),
        demandId: parseId(wire.demandId, "demand", "$/demandId"),
        target: {
            targetTaskId: parseId(wire.target.targetTaskId, "target-task", "$/target/targetTaskId"),
            taskPackageId: parseId(wire.target.taskPackageId, "task-package", "$/target/taskPackageId"),
            taskPackageRef,
            taskPackageDigest: digest(wire.target.taskPackageDigest, "$/target/taskPackageDigest"),
        },
        route: {
            hostId: wire.route.hostId,
            windowId: parseId(wire.route.windowId, "window", "$/route/windowId"),
            bindingId,
            bindingDigest: digest(wire.route.bindingDigest, "$/route/bindingDigest"),
        },
        language: wire.language,
        portablePrompt: wire.portablePrompt,
        promptDigest: digest(wire.promptDigest, "$/promptDigest"),
        fence: {
            claimId: parseId(wire.fence.claimId, "work-claim", "$/fence/claimId"),
            claimDigest: digest(wire.fence.claimDigest, "$/fence/claimDigest"),
            expectedStreamRevision: wire.fence.expectedStreamRevision,
        },
        preparedAt: parseTime(wire.preparedAt, "$/preparedAt"),
    };
    if (computePromptDigest(shared.portablePrompt) !== shared.promptDigest)
        fail("digest", "$/promptDigest");
    let basis;
    if (wire.workType === "test") {
        if (wire.attempt === undefined)
            fail("schema", "$/workType");
        let attempt;
        try {
            attempt = parseTestExecutionAttempt(wire.attempt);
        }
        catch (error) {
            if (error instanceof TestExecutionAttemptError)
                fail("attempt", "$/attempt");
            throw error;
        }
        if (attempt.targetTaskId !== shared.target.targetTaskId ||
            attempt.contract.taskPackageId !== shared.target.taskPackageId ||
            attempt.contract.taskPackageDigest !== shared.target.taskPackageDigest) {
            fail("relation", "$/attempt");
        }
        basis = envelopeBasis({ ...shared, workType: "test", attempt });
    }
    else {
        const rework = wire.rework === undefined ? undefined : parseTargetDeliveryReworkContext(wire.rework, "$/rework");
        const productDefectRemediation = wire.productDefectRemediation === undefined
            ? undefined
            : parseTargetDeliveryProductDefectRemediationContext(wire.productDefectRemediation, "$/productDefectRemediation");
        if (rework !== undefined && productDefectRemediation !== undefined) {
            fail("relation", "$/rework");
        }
        basis = envelopeBasis({
            ...shared,
            workType: "implementation",
            ...(rework === undefined ? {} : { rework }),
            ...(productDefectRemediation === undefined ? {} : { productDefectRemediation }),
        });
    }
    const envelopeDigest = digest(wire.envelopeDigest, "$/envelopeDigest");
    if (computeCanonicalJsonSha256Digest(basis) !== envelopeDigest)
        fail("digest", "$/envelopeDigest");
    return Object.freeze({ ...basis, envelopeDigest });
}
/** 从草稿封一份信封。 */
export function createDeliveryEnvelope(draft) {
    const basis = envelopeBasis({ ...draft, kind: "WakeflowDeliveryEnvelope", schemaVersion: 1 });
    return parseDeliveryEnvelope({ ...basis, envelopeDigest: computeCanonicalJsonSha256Digest(basis) });
}
/** 实现投递的目的由其上下文决定：初次、评审返工或产品缺陷修复。 */
export function deliveryPurpose(envelope) {
    if (envelope.workType === "test")
        return "initial";
    return envelope.rework !== undefined
        ? "implementation-review-rework"
        : envelope.productDefectRemediation !== undefined
            ? "product-defect-remediation"
            : "initial";
}
/** prompt 摘要：内核 `computePromptDigest` 的同一规则；空或超限在信封侧是错误（观察脚本记 null）。 */
export function computeDeliveryPromptDigest(prompt) {
    const digest = computePromptDigest(prompt);
    if (digest === null)
        fail("prompt", "$prompt");
    return digest;
}
/** 复验信封只引用同一份不可变任务包：身份、摘要、投影路径与窗口一致，工作类型一致。 */
export function assertDeliveryEnvelopeMatchesTaskPackage(envelopeValue, taskPackageValue) {
    const envelope = parseDeliveryEnvelope(envelopeValue);
    let taskPackage;
    try {
        taskPackage = parseTaskPackage(taskPackageValue);
    }
    catch (error) {
        if (error instanceof TaskPackageError)
            fail("task-package", "$taskPackage");
        throw error;
    }
    if (envelope.workType !== taskPackage.workType ||
        envelope.programId !== taskPackage.programId ||
        envelope.configDigest !== taskPackage.configDigest ||
        envelope.demandId !== taskPackage.demandId ||
        envelope.target.targetTaskId !== taskPackage.targetTaskId ||
        envelope.target.taskPackageId !== taskPackage.taskPackageId ||
        envelope.target.taskPackageRef !==
            deliveryTaskPackageRef(taskPackage.demandId, taskPackage.taskPackageId) ||
        envelope.target.taskPackageDigest !== computeTaskPackageDigest(taskPackage) ||
        envelope.route.windowId !== taskPackage.assignment.windowId) {
        fail("relation", "$sources");
    }
    if (taskPackage.workType === "test") {
        if (envelope.workType !== "test" ||
            envelope.attempt.contract.taskPackageId !== taskPackage.taskPackageId ||
            envelope.attempt.contract.taskPackageDigest !== envelope.target.taskPackageDigest) {
            fail("relation", "$sources");
        }
    }
    // preparedAt 只保存审计观察；任务包来源、当前 phase 与事件顺序由摘要和追加 CAS 证明。
}
