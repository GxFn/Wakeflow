import { WAKEFLOW_REQUIREMENT_RECORD_SCHEMA, } from "../../contracts/generated/governance/ledger/requirement-record.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { computeCanonicalJsonSha256Digest, } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { DeterministicJsonDocumentError, parseDeterministicJsonDocument, renderDeterministicJsonDocument, } from "../../foundation/data/deterministic-json-document.js";
import { JsonValueError, parseJsonValue, } from "../../foundation/data/json-value.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { parsePortableResourcePath, PortableResourcePathError, splitPortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { createRuntimeJsonSchemaValidator, } from "../../foundation/schema/runtime-json-schema.js";
import { parseUtcInstant, UtcInstantError, } from "../../foundation/time/utc-instant.js";
import { readUtcWallClock, UtcWallClockError, } from "../../foundation/time/wall-clock.js";
/**
 * Wakeflow Governance / Ledger：需求包的不可变权威记录（ADR-0011 D1 D3 D4）。
 *
 * 一份需求包是 `requirements/<requirementId>/` 下的一条 Ledger 记录：`record.json`
 * 加成员 `requirement.md`、`landing.md` 与可选 `attachments/<name>`。记录头部携带
 * demandType、优先级、来源窗口、测试决策、任务计划评审方、supersedes 链、确认点 1
 * 的摘要与章节锚点表。记录只声明 Wakeflow 的写入时间 `recordedAt`，不虚构已经
 * 认证的人类操作者身份；记录存在本身就表示需求包已发布。
 *
 * 本模块只负责 JSON 编解码、类型化标识、成员与章节的结构关系和语义摘要。章节必需
 * 表、标题别名、隐私扫描与 requirementId 的内容派生由 requirement 切片在发布时
 * 校验；成员字节、不可变发布、重新加载和引用解析由 `LedgerAuthorityStore` 负责。
 */
const REQUIREMENT_RECORD_ARTIFACT_KIND = "wakeflow-requirement-record";
const LEDGER_AUTHORITY_RECORD_SCHEMA_VERSION = 1;
const REQUIREMENT_DOCUMENT_PATH = "requirement.md";
const LANDING_DOCUMENT_PATH = "landing.md";
const ATTACHMENTS_DIRECTORY = "attachments";
const ERROR_MESSAGES = {
    "input": "Ledger authority record input is invalid.",
    "json": "Ledger authority record is not passive JSON data.",
    "schema": "Ledger authority record does not satisfy its portable Schema.",
    "identifier": "Ledger authority record contains an invalid typed identity.",
    "time": "Ledger authority record contains an invalid instant.",
    "text": "Ledger authority record contains non-canonical text.",
    "document": "Ledger authority document inventory is inconsistent.",
    "section": "Ledger authority section table is inconsistent.",
    "relation": "Ledger authority record header fields contradict each other.",
    "representation": "Ledger authority record bytes are not its deterministic domain representation.",
};
/** Ledger 权威记录准入或持久化表示验证失败时返回的稳定、脱敏错误。 */
export class LedgerAuthorityRecordError extends Error {
    name = "LedgerAuthorityRecordError";
    code = "wakeflow-ledger-authority-record";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const validateRequirementWire = createRuntimeJsonSchemaValidator(WAKEFLOW_REQUIREMENT_RECORD_SCHEMA, [
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
]);
const CONTROL_EXCEPT_LF_PATTERN = /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const REQUIREMENT_DRAFT_FIELDS = Object.freeze([
    "confirmation",
    "demandType",
    "documents",
    "originWindowId",
    "parked",
    "priority",
    "programId",
    "requirementId",
    "sections",
    "supersedes",
    "taskPlanReview",
    "testingDecision",
    "title",
]);
const DRAFT_VALIDATION_INSTANT = parseUtcInstant("1970-01-01T00:00:00.000Z", "$draftValidationInstant");
function fail(reason, path) {
    throw new LedgerAuthorityRecordError(reason, path);
}
function parseCanonicalText(value, path) {
    if (!value.isWellFormed()
        || value.normalize("NFC") !== value
        || CONTROL_EXCEPT_LF_PATTERN.test(value)) {
        fail("text", path);
    }
    return value;
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
function parseInstant(value, path) {
    try {
        return parseUtcInstant(value, path);
    }
    catch (error) {
        if (error instanceof UtcInstantError)
            fail("time", path);
        throw error;
    }
}
function parseDigest(value, reason, path) {
    try {
        return parseSha256Digest(value, path);
    }
    catch (error) {
        if (error instanceof Sha256Error)
            fail(reason, path);
        throw error;
    }
}
function parseMemberPath(value, reason, path) {
    let memberPath;
    try {
        memberPath = parsePortableResourcePath(value, path);
    }
    catch (error) {
        if (error instanceof PortableResourcePathError)
            fail(reason, path);
        throw error;
    }
    if (memberPath.toLowerCase() === "record.json"
        || memberPath.toLowerCase().startsWith("record.json/")) {
        fail(reason, path);
    }
    return memberPath;
}
function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function parseDocument(wire, index) {
    const path = `$/documents/${index}`;
    const memberPath = parseMemberPath(wire.path, "document", `${path}/path`);
    const segments = splitPortableResourcePath(memberPath);
    const roleMatchesPath = wire.role === "requirement"
        ? memberPath === REQUIREMENT_DOCUMENT_PATH
        : wire.role === "landing"
            ? memberPath === LANDING_DOCUMENT_PATH
            : segments.length === 2 && segments[0] === ATTACHMENTS_DIRECTORY;
    if (!roleMatchesPath)
        fail("document", `${path}/path`);
    return Object.freeze({
        role: wire.role,
        path: memberPath,
        mediaType: parseCanonicalText(wire.mediaType, `${path}/mediaType`),
        digest: parseDigest(wire.digest, "document", `${path}/digest`),
    });
}
/** 成员按路径严格升序、无大小写冲突，且恰有一份 requirement.md 与一份 landing.md。 */
function assertDocumentRelations(documents) {
    const nodesByCaseKey = new Map();
    let requirementCount = 0;
    let landingCount = 0;
    for (let index = 0; index < documents.length; index += 1) {
        const document = documents[index];
        if (document === undefined)
            fail("document", "$/documents");
        const previous = documents[index - 1];
        if (previous !== undefined
            && compareText(previous.path, document.path) >= 0) {
            fail("document", `$/documents/${index}/path`);
        }
        const segments = splitPortableResourcePath(document.path);
        for (let depth = 1; depth <= segments.length; depth += 1) {
            const nodePath = segments.slice(0, depth).join("/");
            const kind = depth === segments.length ? "file" : "directory";
            const caseKey = nodePath.toLowerCase();
            const existing = nodesByCaseKey.get(caseKey);
            if (existing !== undefined
                && (existing.path !== nodePath || existing.kind !== kind)) {
                fail("document", `$/documents/${index}/path`);
            }
            if (existing === undefined) {
                nodesByCaseKey.set(caseKey, Object.freeze({ path: nodePath, kind }));
            }
        }
        if (document.role === "requirement")
            requirementCount += 1;
        if (document.role === "landing")
            landingCount += 1;
    }
    if (requirementCount !== 1 || landingCount !== 1) {
        fail("document", "$/documents");
    }
}
function parseSection(wire, index) {
    const path = `$/sections/${index}`;
    if (!Number.isInteger(wire.line) || wire.line < 1) {
        fail("section", `${path}/line`);
    }
    return Object.freeze({
        path: parseMemberPath(wire.path, "section", `${path}/path`),
        anchor: parseCanonicalText(wire.anchor, `${path}/anchor`),
        heading: parseCanonicalText(wire.heading, `${path}/heading`),
        line: wire.line,
        bodyDigest: parseDigest(wire.bodyDigest, "section", `${path}/bodyDigest`),
    });
}
/** 章节只能指向成员文档，且同一文档内锚点唯一。 */
function assertSectionRelations(documents, sections) {
    const documentPaths = new Set(documents.map((document) => document.path));
    const seen = new Set();
    for (let index = 0; index < sections.length; index += 1) {
        const section = sections[index];
        if (section === undefined)
            fail("section", "$/sections");
        if (!documentPaths.has(section.path)) {
            fail("section", `$/sections/${index}/path`);
        }
        const key = `${section.path}\u0000${section.anchor}`;
        if (seen.has(key))
            fail("section", `$/sections/${index}/anchor`);
        seen.add(key);
    }
}
function normalizeRequirement(wire) {
    const requirementId = parseId(wire.requirementId, "requirement", "$/requirementId");
    const supersedes = wire.supersedes === null
        ? null
        : parseId(wire.supersedes, "requirement", "$/supersedes");
    if (supersedes === requirementId)
        fail("relation", "$/supersedes");
    if ((wire.demandType === "research")
        !== (wire.testingDecision.mode === "not-applicable")) {
        fail("relation", "$/testingDecision/mode");
    }
    const documents = Object.freeze(wire.documents.map((document, index) => (parseDocument(document, index))));
    assertDocumentRelations(documents);
    const sections = Object.freeze(wire.sections.map((section, index) => (parseSection(section, index))));
    assertSectionRelations(documents, sections);
    return Object.freeze({
        artifactKind: REQUIREMENT_RECORD_ARTIFACT_KIND,
        schemaVersion: LEDGER_AUTHORITY_RECORD_SCHEMA_VERSION,
        requirementId,
        programId: parseId(wire.programId, "program", "$/programId"),
        recordedAt: parseInstant(wire.recordedAt, "$/recordedAt"),
        title: parseCanonicalText(wire.title, "$/title"),
        demandType: wire.demandType,
        priority: wire.priority,
        originWindowId: parseId(wire.originWindowId, "window", "$/originWindowId"),
        testingDecision: Object.freeze({
            mode: wire.testingDecision.mode,
            summary: parseCanonicalText(wire.testingDecision.summary, "$/testingDecision/summary"),
        }),
        taskPlanReview: wire.taskPlanReview,
        supersedes,
        parked: wire.parked === null
            ? null
            : Object.freeze({
                trigger: parseCanonicalText(wire.parked.trigger, "$/parked/trigger"),
            }),
        confirmation: Object.freeze({
            confirmedAt: parseInstant(wire.confirmation.confirmedAt, "$/confirmation/confirmedAt"),
            sectionDigest: parseDigest(wire.confirmation.sectionDigest, "schema", "$/confirmation/sectionDigest"),
        }),
        documents,
        sections,
    });
}
/** 将任意 JSON 值解析为字段集合严格受限、关系已闭合的需求包记录。 */
export function parseLedgerAuthorityRecord(value) {
    let json;
    try {
        json = parseJsonValue(value, "$record");
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("json", error.path);
        throw error;
    }
    let record;
    try {
        record = parsePlainRecord(json, "$record");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("schema", "$record");
        throw error;
    }
    if (record.artifactKind !== REQUIREMENT_RECORD_ARTIFACT_KIND) {
        fail("schema", "$/artifactKind");
    }
    const result = validateRequirementWire(json);
    if (!result.ok)
        fail("schema", result.path);
    return normalizeRequirement(result.value);
}
function exactDraft(value) {
    let record;
    try {
        record = parsePlainRecord(value, "$draft");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$draft");
        throw error;
    }
    const keys = Object.keys(record).sort();
    if (keys.length !== REQUIREMENT_DRAFT_FIELDS.length
        || keys.some((key, index) => key !== REQUIREMENT_DRAFT_FIELDS[index])) {
        fail("input", "$draft");
    }
    return record;
}
function recordTime(options) {
    let record;
    try {
        record = parsePlainRecord(options, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    if (Object.keys(record).some((key) => key !== "clock")) {
        fail("input", "$options");
    }
    try {
        return readUtcWallClock(record.clock);
    }
    catch (error) {
        if (error instanceof UtcWallClockError)
            fail("time", "$options/clock");
        throw error;
    }
}
/**
 * 从不含协议头和写入时间的草稿创建需求包记录。
 *
 * 草稿的全部结构关系先以占位时间闭合，再读取墙上时钟；关系失败时不触碰时钟。
 */
export function createRequirementRecord(input, options = {}) {
    const draft = exactDraft(input);
    const admitted = parseLedgerAuthorityRecord({
        artifactKind: REQUIREMENT_RECORD_ARTIFACT_KIND,
        schemaVersion: LEDGER_AUTHORITY_RECORD_SCHEMA_VERSION,
        requirementId: draft.requirementId,
        programId: draft.programId,
        recordedAt: DRAFT_VALIDATION_INSTANT,
        title: draft.title,
        demandType: draft.demandType,
        priority: draft.priority,
        originWindowId: draft.originWindowId,
        testingDecision: draft.testingDecision,
        taskPlanReview: draft.taskPlanReview,
        supersedes: draft.supersedes,
        parked: draft.parked,
        confirmation: draft.confirmation,
        documents: draft.documents,
        sections: draft.sections,
    });
    return Object.freeze({ ...admitted, recordedAt: recordTime(options) });
}
/** 按唯一字段顺序渲染确定性格式化 JSON 文档。 */
export function renderLedgerAuthorityRecord(value) {
    return renderDeterministicJsonDocument(parseLedgerAuthorityRecord(value), "$record");
}
/** 解析磁盘文档，并拒绝格式化方式或领域字段顺序发生漂移。 */
export function parseLedgerAuthorityRecordDocument(text) {
    let json;
    try {
        json = parseDeterministicJsonDocument(text, "$record");
    }
    catch (error) {
        if (error instanceof DeterministicJsonDocumentError) {
            fail("representation", error.path);
        }
        throw error;
    }
    const record = parseLedgerAuthorityRecord(json);
    if (renderLedgerAuthorityRecord(record) !== text) {
        fail("representation", "$record");
    }
    return record;
}
/** 计算与 JSON 字段顺序无关的 Ledger 权威记录语义摘要。 */
export function computeLedgerAuthorityRecordDigest(value) {
    return computeCanonicalJsonSha256Digest(parseLedgerAuthorityRecord(value));
}
