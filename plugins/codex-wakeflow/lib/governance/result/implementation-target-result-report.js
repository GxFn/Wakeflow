import { WAKEFLOW_GIT_OBJECT_ID_SCHEMA } from "../../contracts/generated/foundation/git-object-id.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_IMPLEMENTATION_TARGET_RESULT_REPORT_SCHEMA } from "../../contracts/generated/governance/result/implementation-target-result-report.generated.js";
import { WAKEFLOW_IMPLEMENTATION_TARGET_RESULT_REPORT_V2_SCHEMA } from "../../contracts/generated/governance/result/implementation-target-result-report-v2.generated.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { isEvidenceKind } from "../../contracts/vocabulary/evidence-kinds.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { DeterministicJsonDocumentError, parseDeterministicJsonDocument, renderDeterministicJsonDocument, } from "../../foundation/data/deterministic-json-document.js";
import { JsonValueError, parseJsonValue, } from "../../foundation/data/json-value.js";
import { PortableResourcePathError, parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { GitObjectIdError, parseGitObjectId, } from "../../foundation/git/git-object-id.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { parseUtcInstant, UtcInstantError, } from "../../foundation/time/utc-instant.js";
import { readUtcWallClock, UtcWallClockError, } from "../../foundation/time/wall-clock.js";
import { parseTargetResultOutsideInstructions, } from "./target-result-outside-instructions.js";
/**
 * Wakeflow Governance / Result：目标 Agent 提交的单仓库 implementation 结果陈述。
 *
 * Report只描述目标窗口声称完成了什么、留下了哪些repository状态和review输入；它不声明
 * transport、Claim、Event或Controller acceptance。Import owner会从当前Event Sourcing
 * authority补齐这些事实后再生成TargetResult。
 */
const REPORT_KIND = "WakeflowImplementationTargetResultReport";
/**
 * 记录版本（ADR-0030）。版本 1 是 1.4 之前写下的报告；版本 2 多了逐条锚点的结论与任务包之外收到的指示。
 * 旧记录原样读入、原样参与摘要——它没有这两项就是"未记录"，这里不替它补任何东西。新报告一律写版本 2。
 */
const LEGACY_REPORT_SCHEMA_VERSION = 1;
const REPORT_SCHEMA_VERSION = 2;
export const IMPLEMENTATION_ANCHOR_RESULT_STATUSES = Object.freeze([
    "passed",
    "failed",
    "blocked",
    "not-run",
]);
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
// biome-ignore lint/suspicious/noControlCharactersInRegex: the pattern exists to reject control characters in record text
const CONTROL_EXCEPT_LF_PATTERN = /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/u;
/** 逐条锚点的结论；版本 1 的报告没有记录，返回 null。 */
export function implementationReportAnchorResults(report) {
    return report.anchorResults ?? null;
}
/** 任务包之外收到的指示；版本 1 的报告没有记录，返回 null（与"记录了、一条也没有"的空数组不同）。 */
export function implementationReportOutsideInstructions(report) {
    return report.outsideInstructions ?? null;
}
const ERROR_MESSAGES = {
    input: "Implementation Target Result Report is not passive closed JSON data.",
    schema: "Implementation Target Result Report does not satisfy its Schema.",
    identifier: "Implementation Target Result Report contains an invalid identity.",
    digest: "Implementation Target Result Report contains an invalid or inconsistent digest.",
    path: "Implementation Target Result Report contains an invalid portable resource path.",
    "git-object-id": "Implementation Target Result Report contains an invalid Git object ID.",
    text: "Implementation Target Result Report contains invalid human text or token text.",
    time: "Implementation Target Result Report contains an invalid time.",
    relation: "Implementation Target Result Report facts are inconsistent.",
    representation: "Implementation Target Result Report bytes are not deterministic.",
};
export class ImplementationTargetResultReportError extends Error {
    name = "ImplementationTargetResultReportError";
    code = "wakeflow-implementation-target-result-report";
    reason;
    path;
    constructor(reason, path, options) {
        super(ERROR_MESSAGES[reason], options);
        this.reason = reason;
        this.path = path;
    }
}
const REPORT_SCHEMA_DEPENDENCIES = [
    WAKEFLOW_GIT_OBJECT_ID_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
];
const validateLegacyWire = createRuntimeJsonSchemaValidator(WAKEFLOW_IMPLEMENTATION_TARGET_RESULT_REPORT_SCHEMA, REPORT_SCHEMA_DEPENDENCIES);
const validateWire = createRuntimeJsonSchemaValidator(WAKEFLOW_IMPLEMENTATION_TARGET_RESULT_REPORT_V2_SCHEMA, REPORT_SCHEMA_DEPENDENCIES);
function fail(reason, path, cause) {
    throw new ImplementationTargetResultReportError(reason, path, cause === undefined ? undefined : { cause });
}
function jsonRecord(value, fields, path) {
    let json;
    try {
        json = parseJsonValue(value, path);
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("input", error.path, error);
        throw error;
    }
    if (json === null || Array.isArray(json) || typeof json !== "object") {
        fail("input", path);
    }
    const keys = Object.keys(json).sort();
    const expected = [...fields].sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
        fail("input", path);
    }
    return json;
}
function text(value, path) {
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
function token(value, path) {
    if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) {
        fail("text", path);
    }
    return value;
}
function repositoryId(value, path) {
    try {
        return parseWakeflowDurableIdOfKind(value, "repository", path);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("identifier", path, error);
        throw error;
    }
}
function digest(value, path) {
    try {
        return parseSha256Digest(value, path);
    }
    catch (error) {
        if (error instanceof Sha256Error)
            fail("digest", path, error);
        throw error;
    }
}
function resourcePath(value, path) {
    try {
        return parsePortableResourcePath(value, path);
    }
    catch (error) {
        if (error instanceof PortableResourcePathError)
            fail("path", path, error);
        throw error;
    }
}
function gitObjectId(value, path) {
    try {
        return parseGitObjectId(value, path);
    }
    catch (error) {
        if (error instanceof GitObjectIdError)
            fail("git-object-id", path, error);
        throw error;
    }
}
function instant(value, path) {
    try {
        return parseUtcInstant(value, path);
    }
    catch (error) {
        if (error instanceof UtcInstantError)
            fail("time", path, error);
        throw error;
    }
}
function stringArray(value, path, maximumItems = 64) {
    if (!Array.isArray(value) || value.length > maximumItems) {
        fail("input", path);
    }
    const result = value.map((entry, index) => text(entry, `${path}/${index}`));
    if (new Set(result).size !== result.length)
        fail("relation", path);
    return Object.freeze(result);
}
/**
 * 报告里的仓库变更：分支、处置与提交各自合法，并且"已提交"与"有提交"同真同假。仓库标识原样交回——它在
 * 内容的其余部分都核对之后才解析，错误的先后不变。
 */
function parseRepositoryChangeFields(value) {
    const repository = jsonRecord(value, ["branch", "commits", "disposition", "repositoryId"], "$/repositoryChange");
    if (repository.branch !== null &&
        (typeof repository.branch !== "string" || !BRANCH_PATTERN.test(repository.branch))) {
        fail("text", "$/repositoryChange/branch");
    }
    if (repository.disposition !== "committed" &&
        repository.disposition !== "left-uncommitted" &&
        repository.disposition !== "no-changes") {
        fail("input", "$/repositoryChange/disposition");
    }
    if (!Array.isArray(repository.commits) || repository.commits.length > 64) {
        fail("input", "$/repositoryChange/commits");
    }
    const commits = repository.commits.map((entry, index) => gitObjectId(entry, `$/repositoryChange/commits/${index}`));
    const commitKeys = commits.map((entry) => `${entry.algorithm}:${entry.value}`);
    if (new Set(commitKeys).size !== commitKeys.length ||
        (repository.disposition === "committed") !== commits.length > 0) {
        fail("relation", "$/repositoryChange/commits");
    }
    return {
        repositoryIdValue: repository.repositoryId,
        disposition: repository.disposition,
        branch: repository.branch,
        commits,
    };
}
/** 准入不含时钟和摘要的Agent业务陈述，并返回独立冻结快照。 */
const COMMON_CONTENT_FIELDS = Object.freeze([
    "anchorEvidence",
    "evidenceLocators",
    "outcome",
    "repositoryChange",
    "risks",
    "summary",
    "verification",
]);
function parseAnchorResults(value) {
    if (!Array.isArray(value) || value.length > 32)
        fail("input", "$/anchorResults");
    const seen = new Set();
    return Object.freeze(value.map((entry, index) => {
        const path = `$/anchorResults/${index}`;
        const record = jsonRecord(entry, ["anchorId", "observed", "status"], path);
        const anchorId = token(record.anchorId, `${path}/anchorId`);
        if (seen.has(anchorId))
            fail("relation", `${path}/anchorId`);
        seen.add(anchorId);
        const status = record.status;
        if (typeof status !== "string" ||
            !IMPLEMENTATION_ANCHOR_RESULT_STATUSES.includes(status)) {
            fail("input", `${path}/status`);
        }
        return Object.freeze({
            anchorId,
            status: status,
            observed: text(record.observed, `${path}/observed`),
        });
    }));
}
/** 一份新报告的内容（记录版本 2）：共有的七项，加上逐条锚点的结论与任务包之外收到的指示。 */
function parseImplementationTargetResultReportContent(value) {
    const record = jsonRecord(value, [...COMMON_CONTENT_FIELDS, "anchorResults", "outsideInstructions"], "$content");
    const { anchorResults, outsideInstructions, ...common } = record;
    return Object.freeze({
        ...parseCommonContent(common),
        anchorResults: parseAnchorResults(anchorResults),
        outsideInstructions: parseTargetResultOutsideInstructions(outsideInstructions, "$/outsideInstructions", {
            record: jsonRecord,
            text,
            fail: (path) => fail("input", path),
        }),
    });
}
function parseCommonContent(value) {
    const record = jsonRecord(value, COMMON_CONTENT_FIELDS, "$content");
    if (record.outcome !== "completed" &&
        record.outcome !== "blocked" &&
        record.outcome !== "needs-review") {
        fail("input", "$/outcome");
    }
    const change = parseRepositoryChangeFields(record.repositoryChange);
    if (!Array.isArray(record.evidenceLocators) || record.evidenceLocators.length > 64) {
        fail("input", "$/evidenceLocators");
    }
    const locators = record.evidenceLocators.map((entry, index) => {
        const path = `$/evidenceLocators/${index}`;
        const locator = jsonRecord(entry, ["digest", "kind", "ref"], path);
        if (!isEvidenceKind(locator.kind))
            fail("text", `${path}/kind`);
        return Object.freeze({
            kind: locator.kind,
            ref: resourcePath(locator.ref, `${path}/ref`),
            digest: digest(locator.digest, `${path}/digest`),
        });
    });
    const locatorKeys = locators.map((entry) => `${entry.kind}\0${entry.ref}\0${entry.digest}`);
    if (new Set(locatorKeys).size !== locatorKeys.length) {
        fail("relation", "$/evidenceLocators");
    }
    if (!Array.isArray(record.anchorEvidence) || record.anchorEvidence.length > 32) {
        fail("input", "$/anchorEvidence");
    }
    const locatorRefs = new Set(locators.map((entry) => `${entry.ref}\0${entry.digest}`));
    const anchorIds = new Set();
    const anchorEvidence = record.anchorEvidence.map((entry, index) => {
        const path = `$/anchorEvidence/${index}`;
        const anchor = jsonRecord(entry, ["anchorId", "evidenceRefs"], path);
        const anchorId = token(anchor.anchorId, `${path}/anchorId`);
        if (anchorIds.has(anchorId))
            fail("relation", `${path}/anchorId`);
        anchorIds.add(anchorId);
        if (!Array.isArray(anchor.evidenceRefs) ||
            anchor.evidenceRefs.length === 0 ||
            anchor.evidenceRefs.length > 32) {
            fail("input", `${path}/evidenceRefs`);
        }
        const references = anchor.evidenceRefs.map((referenceValue, refIndex) => {
            const refPath = `${path}/evidenceRefs/${refIndex}`;
            const reference = jsonRecord(referenceValue, ["digest", "ref"], refPath);
            const admitted = Object.freeze({
                ref: resourcePath(reference.ref, `${refPath}/ref`),
                digest: digest(reference.digest, `${refPath}/digest`),
            });
            if (!locatorRefs.has(`${admitted.ref}\0${admitted.digest}`)) {
                fail("relation", refPath);
            }
            return admitted;
        });
        const referenceKeys = references.map((reference) => `${reference.ref}\0${reference.digest}`);
        if (new Set(referenceKeys).size !== referenceKeys.length) {
            fail("relation", `${path}/evidenceRefs`);
        }
        return Object.freeze({
            anchorId,
            evidenceRefs: Object.freeze(references),
        });
    });
    return Object.freeze({
        outcome: record.outcome,
        summary: text(record.summary, "$/summary"),
        repositoryChange: Object.freeze({
            repositoryId: repositoryId(change.repositoryIdValue, "$/repositoryChange/repositoryId"),
            disposition: change.disposition,
            branch: change.branch,
            commits: Object.freeze(change.commits),
        }),
        evidenceLocators: Object.freeze(locators),
        verification: stringArray(record.verification, "$/verification"),
        risks: stringArray(record.risks, "$/risks"),
        anchorEvidence: Object.freeze(anchorEvidence),
    });
}
/**
 * 摘要的基：每个记录版本恰好是它自己的成员。版本 1 的基里没有新加的两项，所以 1.4 之前写下的报告摘要
 * 一个字节不变——结果、评审单元与决定里引用它的摘要也都不变。
 */
function reportBasis(value) {
    const common = {
        kind: REPORT_KIND,
        outcome: value.outcome,
        summary: value.summary,
        repositoryChange: value.repositoryChange,
        evidenceLocators: value.evidenceLocators,
        verification: value.verification,
        risks: value.risks,
        anchorEvidence: value.anchorEvidence,
        reportedAt: value.reportedAt,
    };
    if (value.schemaVersion === LEGACY_REPORT_SCHEMA_VERSION) {
        return { ...common, schemaVersion: LEGACY_REPORT_SCHEMA_VERSION };
    }
    if (value.anchorResults === undefined || value.outsideInstructions === undefined) {
        fail("relation", "$/schemaVersion");
    }
    return {
        ...common,
        schemaVersion: REPORT_SCHEMA_VERSION,
        anchorResults: value.anchorResults,
        outsideInstructions: value.outsideInstructions,
    };
}
export function parseImplementationTargetResultReport(value) {
    let json;
    try {
        json = parseJsonValue(value, "$report");
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("input", error.path, error);
        throw error;
    }
    const legacy = json !== null &&
        typeof json === "object" &&
        !Array.isArray(json) &&
        json.schemaVersion === LEGACY_REPORT_SCHEMA_VERSION;
    const validated = legacy ? validateLegacyWire(json) : validateWire(json);
    if (!validated.ok)
        fail("schema", validated.path);
    const wire = validated.value;
    const common = {
        outcome: wire.outcome,
        summary: wire.summary,
        repositoryChange: wire.repositoryChange,
        evidenceLocators: wire.evidenceLocators,
        verification: wire.verification,
        risks: wire.risks,
        anchorEvidence: wire.anchorEvidence,
    };
    const reportedAt = instant(wire.reportedAt, "$/reportedAt");
    const basis = wire.schemaVersion === LEGACY_REPORT_SCHEMA_VERSION
        ? reportBasis({
            kind: REPORT_KIND,
            schemaVersion: LEGACY_REPORT_SCHEMA_VERSION,
            ...parseCommonContent(common),
            reportedAt,
        })
        : reportBasis({
            kind: REPORT_KIND,
            schemaVersion: REPORT_SCHEMA_VERSION,
            ...parseImplementationTargetResultReportContent({
                ...common,
                anchorResults: wire.anchorResults,
                outsideInstructions: wire.outsideInstructions,
            }),
            reportedAt,
        });
    const reportDigest = digest(wire.reportDigest, "$/reportDigest");
    if (computeCanonicalJsonSha256Digest(basis) !== reportDigest) {
        fail("digest", "$/reportDigest");
    }
    return Object.freeze({ ...basis, reportDigest });
}
export function createImplementationTargetResultReport(contentValue, options = {}) {
    const content = parseImplementationTargetResultReportContent(contentValue);
    let reportedAt;
    try {
        reportedAt = readUtcWallClock(options.clock);
    }
    catch (error) {
        if (error instanceof UtcWallClockError)
            fail("time", "$clock", error);
        throw error;
    }
    const basis = reportBasis({
        kind: REPORT_KIND,
        schemaVersion: REPORT_SCHEMA_VERSION,
        ...content,
        reportedAt,
    });
    return parseImplementationTargetResultReport({
        ...basis,
        reportDigest: computeCanonicalJsonSha256Digest(basis),
    });
}
export function implementationTargetResultReportContentDigest(value) {
    return computeCanonicalJsonSha256Digest(parseImplementationTargetResultReportContent(value));
}
export function renderImplementationTargetResultReport(value) {
    return renderDeterministicJsonDocument(parseImplementationTargetResultReport(value), "$report");
}
export function parseImplementationTargetResultReportDocument(textValue) {
    let json;
    try {
        json = parseDeterministicJsonDocument(textValue, "$report");
    }
    catch (error) {
        if (error instanceof DeterministicJsonDocumentError) {
            fail("representation", "$report", error);
        }
        throw error;
    }
    const report = parseImplementationTargetResultReport(json);
    if (renderImplementationTargetResultReport(report) !== textValue) {
        fail("representation", "$report");
    }
    return report;
}
