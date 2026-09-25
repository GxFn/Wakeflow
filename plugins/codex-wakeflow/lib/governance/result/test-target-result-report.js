import { WAKEFLOW_TEST_TARGET_RESULT_REPORT_SCHEMA } from "../../contracts/generated/governance/result/test-target-result-report.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { DeterministicJsonDocumentError, parseDeterministicJsonDocument, renderDeterministicJsonDocument, } from "../../foundation/data/deterministic-json-document.js";
import { JsonValueError, parseJsonValue, } from "../../foundation/data/json-value.js";
import { parsePortableResourcePath, PortableResourcePathError, } from "../../foundation/filesystem/portable-resource-path.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { parseUtcInstant, UtcInstantError, } from "../../foundation/time/utc-instant.js";
import { readUtcWallClock, UtcWallClockError, } from "../../foundation/time/wall-clock.js";
import { isEvidenceKind } from "../../contracts/vocabulary/evidence-kinds.js";
import { isTestFailureClassification, isTestFailureOwner, isTestStepVerdict, } from "../../contracts/vocabulary/test-step-vocabulary.js";
/**
 * Wakeflow Governance / Result：Test Agent提交的逐步执行结果陈述。
 *
 * Report按测试合同逐步记录 observed、证据、verdict 与失败分类（ADR-0012 D4）；整体
 * verdict 由步骤派生。它不解释Evidence真假，不声明product repository change、测试通过、
 * Controller acceptance或Demand completion。TaskPackage（含测试合同）、attempt、Claim和
 * Observation的闭合由TargetResult owner负责。
 */
const REPORT_KIND = "WakeflowTestTargetResultReport";
const REPORT_SCHEMA_VERSION = 1;
const CONTROL_EXCEPT_LF_PATTERN = /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const MAXIMUM_EVIDENCE_LOCATORS = 64;
const MAXIMUM_CONTRACT_STEPS = 20;
const STEP_ID_PATTERN = /^ts-[1-9][0-9]?$/u;
const ERROR_MESSAGES = {
    input: "Test Target Result Report is not passive closed JSON data.",
    schema: "Test Target Result Report does not satisfy its Schema.",
    digest: "Test Target Result Report contains an invalid or inconsistent digest.",
    path: "Test Target Result Report contains an invalid portable resource path.",
    text: "Test Target Result Report contains invalid human text or token text.",
    time: "Test Target Result Report contains an invalid time.",
    relation: "Test Target Result Report facts are inconsistent.",
    representation: "Test Target Result Report bytes are not deterministic.",
};
/** Test Report输入、关系或确定性表示失败时的稳定错误。 */
export class TestTargetResultReportError extends Error {
    name = "TestTargetResultReportError";
    code = "wakeflow-test-target-result-report";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const validateWire = createRuntimeJsonSchemaValidator(WAKEFLOW_TEST_TARGET_RESULT_REPORT_SCHEMA, [
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
]);
function fail(reason, path) {
    throw new TestTargetResultReportError(reason, path);
}
function exactRecord(value, fields, path) {
    let json;
    try {
        json = parseJsonValue(value, path);
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("input", error.path);
        throw error;
    }
    if (json === null || Array.isArray(json) || typeof json !== "object") {
        fail("input", path);
    }
    const keys = Object.keys(json).sort();
    const expected = [...fields].sort();
    if (keys.length !== expected.length ||
        keys.some((key, index) => key !== expected[index])) {
        fail("input", path);
    }
    return json;
}
function humanText(value, path) {
    if (typeof value !== "string" ||
        value.length === 0 ||
        value.length > 8192 ||
        !value.isWellFormed() ||
        value.normalize("NFC") !== value ||
        value.trim() !== value ||
        CONTROL_EXCEPT_LF_PATTERN.test(value)) {
        fail("text", path);
    }
    return value;
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
function resourcePath(value, path) {
    try {
        return parsePortableResourcePath(value, path);
    }
    catch (error) {
        if (error instanceof PortableResourcePathError)
            fail("path", path);
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
function textList(value, path) {
    if (!Array.isArray(value) || value.length > 64)
        fail("input", path);
    const values = value.map((entry, index) => humanText(entry, `${path}/${index}`));
    if (new Set(values).size !== values.length)
        fail("relation", path);
    return Object.freeze(values);
}
function evidenceLocators(value) {
    if (!Array.isArray(value) || value.length > MAXIMUM_EVIDENCE_LOCATORS) {
        fail("input", "$/evidenceLocators");
    }
    const locators = value.map((entry, index) => {
        const path = `$/evidenceLocators/${index}`;
        const record = exactRecord(entry, ["digest", "kind", "ref"], path);
        if (!isEvidenceKind(record.kind))
            fail("text", `${path}/kind`);
        return Object.freeze({
            kind: record.kind,
            ref: resourcePath(record.ref, `${path}/ref`),
            digest: digest(record.digest, `${path}/digest`),
        });
    });
    const refs = locators.map((entry) => entry.ref);
    if (new Set(refs).size !== refs.length) {
        fail("relation", "$/evidenceLocators");
    }
    return Object.freeze(locators);
}
/** 整体判定只从步骤派生；调用方不能自行宣称。 */
export function deriveTestVerdict(steps) {
    if (steps.length === 0)
        return "cannot-conclude";
    if (steps.some((step) => step.verdict === "fail"))
        return "fail";
    if (steps.some((step) => step.verdict === "blocked"))
        return "blocked";
    if (steps.some((step) => step.verdict === "cannot-conclude"))
        return "cannot-conclude";
    return "pass";
}
function stepFailure(value, path) {
    const record = exactRecord(value, ["classification", "likelyOwner", "recommendedAction"], path);
    if (!isTestFailureClassification(record.classification)) {
        fail("input", `${path}/classification`);
    }
    if (!isTestFailureOwner(record.likelyOwner))
        fail("input", `${path}/likelyOwner`);
    return Object.freeze({
        classification: record.classification,
        likelyOwner: record.likelyOwner,
        recommendedAction: humanText(record.recommendedAction, `${path}/recommendedAction`),
    });
}
function parseSteps(value, locators) {
    if (!Array.isArray(value) || value.length > MAXIMUM_CONTRACT_STEPS) {
        fail("input", "$/steps");
    }
    const locatorTuples = new Set(locators.map((entry) => `${entry.ref}\0${entry.digest}`));
    const steps = value.map((entry, index) => {
        const path = `$/steps/${index}`;
        const hasFailure = typeof entry === "object" && entry !== null && Object.hasOwn(entry, "failure");
        const record = exactRecord(entry, hasFailure
            ? ["evidence", "failure", "observed", "stepId", "verdict"]
            : ["evidence", "observed", "stepId", "verdict"], path);
        if (typeof record.stepId !== "string" || !STEP_ID_PATTERN.test(record.stepId)) {
            fail("input", `${path}/stepId`);
        }
        if (!isTestStepVerdict(record.verdict))
            fail("input", `${path}/verdict`);
        if ((record.verdict === "pass") === hasFailure)
            fail("relation", `${path}/failure`);
        const evidence = exactRecord(record.evidence, ["digest", "ref"], `${path}/evidence`);
        const admittedEvidence = Object.freeze({
            ref: resourcePath(evidence.ref, `${path}/evidence/ref`),
            digest: digest(evidence.digest, `${path}/evidence/digest`),
        });
        if (!locatorTuples.has(`${admittedEvidence.ref}\0${admittedEvidence.digest}`)) {
            fail("relation", `${path}/evidence`);
        }
        return Object.freeze({
            stepId: record.stepId,
            observed: humanText(record.observed, `${path}/observed`),
            evidence: admittedEvidence,
            verdict: record.verdict,
            ...(hasFailure ? { failure: stepFailure(record.failure, `${path}/failure`) } : {}),
        });
    });
    if (new Set(steps.map((entry) => entry.stepId)).size !== steps.length) {
        fail("relation", "$/steps");
    }
    return Object.freeze(steps);
}
/** 准入不含时钟和摘要的Test Agent业务陈述。 */
export function parseTestTargetResultReportContent(value) {
    const record = exactRecord(value, [
        "evidenceLocators",
        "outcome",
        "risks",
        "steps",
        "summary",
        "verification",
    ], "$content");
    if (record.outcome !== "completed" &&
        record.outcome !== "blocked" &&
        record.outcome !== "needs-review") {
        fail("input", "$/outcome");
    }
    const locators = evidenceLocators(record.evidenceLocators);
    const steps = parseSteps(record.steps, locators);
    // completed 至少一步；blocked 不能同时含 fail（失败不是阻断）。覆盖范围由 TargetResult owner 对照合同核对。
    if ((record.outcome === "completed" && steps.length === 0) ||
        (record.outcome === "blocked" && steps.some((step) => step.verdict === "fail"))) {
        fail("relation", "$/steps");
    }
    return Object.freeze({
        outcome: record.outcome,
        summary: humanText(record.summary, "$/summary"),
        evidenceLocators: locators,
        verification: textList(record.verification, "$/verification"),
        risks: textList(record.risks, "$/risks"),
        steps,
    });
}
function reportBasis(value) {
    return {
        kind: REPORT_KIND,
        schemaVersion: REPORT_SCHEMA_VERSION,
        outcome: value.outcome,
        summary: value.summary,
        evidenceLocators: value.evidenceLocators,
        verification: value.verification,
        risks: value.risks,
        steps: value.steps,
        verdict: value.verdict,
        reportedAt: value.reportedAt,
    };
}
/** 严格解析并复验self-excluding digest的Test Report。 */
export function parseTestTargetResultReport(value) {
    let json;
    try {
        json = parseJsonValue(value, "$report");
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("input", error.path);
        throw error;
    }
    const validated = validateWire(json);
    if (!validated.ok)
        fail("schema", validated.path);
    const wire = validated.value;
    const content = parseTestTargetResultReportContent({
        outcome: wire.outcome,
        summary: wire.summary,
        evidenceLocators: wire.evidenceLocators,
        verification: wire.verification,
        risks: wire.risks,
        steps: wire.steps,
    });
    if (wire.verdict !== deriveTestVerdict(content.steps))
        fail("relation", "$/verdict");
    const basis = reportBasis({
        kind: REPORT_KIND,
        schemaVersion: REPORT_SCHEMA_VERSION,
        ...content,
        verdict: wire.verdict,
        reportedAt: instant(wire.reportedAt, "$/reportedAt"),
    });
    const reportDigest = digest(wire.reportDigest, "$/reportDigest");
    if (computeCanonicalJsonSha256Digest(basis) !== reportDigest) {
        fail("digest", "$/reportDigest");
    }
    return Object.freeze({ ...basis, reportDigest });
}
/** 使用当前时钟创建一份Test Agent执行结果陈述。 */
export function createTestTargetResultReport(contentValue, options = {}) {
    const content = parseTestTargetResultReportContent(contentValue);
    let reportedAt;
    try {
        reportedAt = readUtcWallClock(options.clock);
    }
    catch (error) {
        if (error instanceof UtcWallClockError)
            fail("time", "$clock");
        throw error;
    }
    const basis = reportBasis({
        kind: REPORT_KIND,
        schemaVersion: REPORT_SCHEMA_VERSION,
        ...content,
        verdict: deriveTestVerdict(content.steps),
        reportedAt,
    });
    return parseTestTargetResultReport({
        ...basis,
        reportDigest: computeCanonicalJsonSha256Digest(basis),
    });
}
export function testTargetResultReportContentDigest(value) {
    return computeCanonicalJsonSha256Digest(parseTestTargetResultReportContent(value));
}
export function renderTestTargetResultReport(value) {
    return renderDeterministicJsonDocument(parseTestTargetResultReport(value), "$report");
}
export function parseTestTargetResultReportDocument(textValue) {
    let json;
    try {
        json = parseDeterministicJsonDocument(textValue, "$report");
    }
    catch (error) {
        if (error instanceof DeterministicJsonDocumentError) {
            fail("representation", "$report");
        }
        throw error;
    }
    const report = parseTestTargetResultReport(json);
    if (renderTestTargetResultReport(report) !== textValue) {
        fail("representation", "$report");
    }
    return report;
}
