import { types } from "node:util";
import { WAKEFLOW_DEMAND_AUTHORITY_SCHEMA, } from "../../../contracts/generated/governance/demand/demand-authority.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../../contracts/generated/foundation/sha256-digest.generated.js";
import { computeCanonicalJsonSha256Digest, } from "../../../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, Sha256Error, } from "../../../foundation/crypto/sha256.js";
import { DeterministicJsonDocumentError, parseDeterministicJsonDocument, renderDeterministicJsonDocument, } from "../../../foundation/data/deterministic-json-document.js";
import { JsonValueError, parseJsonValue, } from "../../../foundation/data/json-value.js";
import { parseDenseArray, parsePlainRecord, PassiveOwnDataError, } from "../../../foundation/data/passive-own-data.js";
import { parsePortableResourcePath, PortableResourcePathError, } from "../../../foundation/filesystem/portable-resource-path.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../../contracts/identity/wakeflow-durable-id.js";
import { createRuntimeJsonSchemaValidator, } from "../../../foundation/schema/runtime-json-schema.js";
import { LedgerAuthorityStore, LedgerAuthorityStoreError, parseLedgerAuthorityMemberReference, } from "../../ledger/ledger-authority-store.js";
import { computeDemandIdentityDigest, parseDemandIdentity, } from "./demand-identity.js";
/**
 * Wakeflow Governance / Demand Model：事件溯源聚合发布所需的必需权威关系验证。
 *
 * 权威关系记录只保存可解析的需求包成员引用、身份语义摘要和测试决定。四类
 * Demand 都要求 `requirement` 与 `landing` 各恰好一个成员（ADR-0011 D3）；测试环境不再
 * 由 Ledger 成员证明，`environmentMemberRef` 恒为 `null`。本模块不写入 Ledger 或
 * Demand 文件，也不追加事件流。
 */
const DEMAND_AUTHORITY_ARTIFACT_KIND = "wakeflow-demand-authority";
const DEMAND_AUTHORITY_SCHEMA_VERSION = 1;
const ERROR_MESSAGES = {
    "input": "Demand authority input is invalid.",
    "json": "Demand authority is not passive JSON data.",
    "schema": "Demand authority does not satisfy its portable Schema.",
    "identifier": "Demand authority contains an invalid Demand identity.",
    "digest": "Demand authority contains an invalid identity digest.",
    "text": "Demand authority contains non-canonical text.",
    "reference": "Demand authority contains an invalid Ledger member reference.",
    "ordering": "Demand authority references are not in canonical unique order.",
    "identity": "Demand authority does not bind its exact immutable identity.",
    "role": "Demand authority does not contain its required role closure.",
    "testing": "Demand authority testing decision is inconsistent.",
    "resolution": "Demand authority reference cannot be resolved exactly.",
    "aborted": "Demand authority admission was aborted.",
    "representation": "Demand authority bytes are not its deterministic domain representation.",
};
export class DemandAuthorityError extends Error {
    name = "DemandAuthorityError";
    code = "wakeflow-demand-authority";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const PACKAGE_ROLES = Object.freeze(["requirement", "landing"]);
/**
 * 真实环境Test执行的环境权威成员角色。Confirmation family 退役后，需求包的
 * `landing.md`（落地方案与测试决策）充当环境权威，`requirement.md` 充当Test Basis；
 * Pod 切片按 ADR-0010 接管专用环境权威前，二者由同一需求包记录冻结。
 */
export const TEST_ENVIRONMENT_AUTHORITY_ROLE = "landing";
const REQUIRED_ROLES = Object.freeze({
    requirement: PACKAGE_ROLES,
    bug: PACKAGE_ROLES,
    supplement: PACKAGE_ROLES,
    research: PACKAGE_ROLES,
});
const CONTROL_EXCEPT_LF_PATTERN = /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const DRAFT_FIELDS = Object.freeze([
    "authorityRefs",
    "testingDecision",
]);
const validateWire = createRuntimeJsonSchemaValidator(WAKEFLOW_DEMAND_AUTHORITY_SCHEMA, [
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
]);
function fail(reason, path) {
    throw new DemandAuthorityError(reason, path);
}
function referenceLocationKey(reference) {
    return [
        reference.family,
        reference.recordId,
        reference.recordRef,
        reference.memberPath,
        reference.memberRef,
    ].join("\u0000");
}
function parseReferences(values) {
    const parsed = values.map((value, index) => {
        try {
            return parseLedgerAuthorityMemberReference(value);
        }
        catch (error) {
            if (error instanceof LedgerAuthorityStoreError) {
                fail("reference", `$/authorityRefs/${index}`);
            }
            throw error;
        }
    });
    const first = parsed[0];
    if (first === undefined)
        fail("schema", "$/authorityRefs");
    const mutableReferences = [first];
    mutableReferences.push(...parsed.slice(1));
    const references = Object.freeze(mutableReferences);
    for (let index = 1; index < references.length; index += 1) {
        const previous = references[index - 1];
        const current = references[index];
        if (previous === undefined
            || current === undefined
            || referenceLocationKey(previous) >= referenceLocationKey(current)) {
            fail("ordering", `$/authorityRefs/${index}`);
        }
    }
    return references;
}
function parseCanonicalText(value, path) {
    if (!value.isWellFormed()
        || value.normalize("NFC") !== value
        || CONTROL_EXCEPT_LF_PATTERN.test(value)) {
        fail("text", path);
    }
    return value;
}
function parseTestingDecision(value) {
    let environmentMemberRef = null;
    if (value.environmentMemberRef !== null) {
        try {
            environmentMemberRef = parsePortableResourcePath(value.environmentMemberRef, "$/testingDecision/environmentMemberRef");
        }
        catch (error) {
            if (error instanceof PortableResourcePathError) {
                fail("testing", "$/testingDecision/environmentMemberRef");
            }
            throw error;
        }
    }
    return Object.freeze({
        mode: value.mode,
        summary: parseCanonicalText(value.summary, "$/testingDecision/summary"),
        environmentMemberRef,
    });
}
function assertIdentityRelations(authority, identity) {
    if (authority.demandId !== identity.demandId
        || authority.identityDigest !== computeDemandIdentityDigest(identity)) {
        fail("identity", "$authority");
    }
    // 每个必需角色恰好一个成员：下游按角色 `.find` 环境权威，不允许两个成员争同一角色。
    const roleCounts = new Map();
    for (const entry of authority.authorityRefs) {
        roleCounts.set(entry.role, (roleCounts.get(entry.role) ?? 0) + 1);
    }
    for (const role of REQUIRED_ROLES[identity.demandType]) {
        if (roleCounts.get(role) !== 1)
            fail("role", "$/authorityRefs");
    }
    if (identity.demandType === "research"
        ? authority.testingDecision.mode !== "not-applicable"
        : authority.testingDecision.mode === "not-applicable") {
        fail("testing", "$/testingDecision/mode");
    }
    if (authority.testingDecision.environmentMemberRef !== null) {
        fail("testing", "$/testingDecision/environmentMemberRef");
    }
}
/** 解析 Demand Authority；提供 Identity 时，同时验证摘要、角色、测试和位置关系。 */
export function parseDemandAuthority(value, identityValue) {
    let json;
    try {
        json = parseJsonValue(value, "$authority");
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("json", error.path);
        throw error;
    }
    const result = validateWire(json);
    if (!result.ok)
        fail("schema", result.path);
    let demandId;
    try {
        demandId = parseWakeflowDurableIdOfKind(result.value.demandId, "demand", "$/demandId");
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("identifier", "$/demandId");
        throw error;
    }
    let identityDigest;
    try {
        identityDigest = parseSha256Digest(result.value.identityDigest, "$/identityDigest");
    }
    catch (error) {
        if (error instanceof Sha256Error)
            fail("digest", "$/identityDigest");
        throw error;
    }
    const authority = Object.freeze({
        artifactKind: DEMAND_AUTHORITY_ARTIFACT_KIND,
        schemaVersion: DEMAND_AUTHORITY_SCHEMA_VERSION,
        demandId,
        identityDigest,
        authorityRefs: parseReferences(result.value.authorityRefs),
        testingDecision: parseTestingDecision(result.value.testingDecision),
    });
    if (identityValue !== undefined) {
        const identity = parseDemandIdentity(identityValue);
        assertIdentityRelations(authority, identity);
    }
    return authority;
}
/** 从 Identity 和字段集合严格受限的草稿创建强制 Authority，并规范化引用顺序。 */
export function createDemandAuthority(identityValue, draft) {
    const identity = parseDemandIdentity(identityValue);
    let record;
    try {
        record = parsePlainRecord(draft, "$draft");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$draft");
        throw error;
    }
    const keys = Object.keys(record).sort();
    if (keys.length !== DRAFT_FIELDS.length
        || keys.some((key, index) => key !== DRAFT_FIELDS[index])) {
        fail("input", "$draft");
    }
    let draftRefs;
    try {
        draftRefs = parseDenseArray(record.authorityRefs, 32, "$/authorityRefs");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$/authorityRefs");
        throw error;
    }
    const parsedDraftRefs = draftRefs.map((value, index) => {
        try {
            return parseLedgerAuthorityMemberReference(value);
        }
        catch (error) {
            if (error instanceof LedgerAuthorityStoreError) {
                fail("reference", `$/authorityRefs/${index}`);
            }
            throw error;
        }
    });
    const sortedRefs = [...parsedDraftRefs].sort((left, right) => {
        const leftKey = referenceLocationKey(left);
        const rightKey = referenceLocationKey(right);
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
    return parseDemandAuthority({
        artifactKind: DEMAND_AUTHORITY_ARTIFACT_KIND,
        schemaVersion: DEMAND_AUTHORITY_SCHEMA_VERSION,
        demandId: identity.demandId,
        identityDigest: computeDemandIdentityDigest(identity),
        authorityRefs: sortedRefs,
        testingDecision: record.testingDecision,
    }, identity);
}
/**
 * 通过 `LedgerAuthorityStore` 解析每个成员，并证明每个成员都属于同一 Program
 * 的需求包记录。
 */
export async function admitDemandAuthority(identityValue, authorityValue, ledgerStore, options) {
    const identity = parseDemandIdentity(identityValue);
    const authority = parseDemandAuthority(authorityValue, identity);
    if (typeof ledgerStore !== "object"
        || ledgerStore === null
        || types.isProxy(ledgerStore)
        || !(ledgerStore instanceof LedgerAuthorityStore)) {
        fail("input", "$ledgerStore");
    }
    let optionRecord;
    try {
        optionRecord = parsePlainRecord(options === undefined ? {} : options, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    if (Object.keys(optionRecord).some((key) => key !== "signal")
        || (optionRecord.signal !== undefined
            && (typeof optionRecord.signal !== "object"
                || optionRecord.signal === null
                || types.isProxy(optionRecord.signal)
                || !(optionRecord.signal instanceof AbortSignal)))) {
        fail("input", "$options");
    }
    const signal = optionRecord.signal;
    if (signal?.aborted === true)
        fail("aborted", "$signal");
    const resolved = [];
    let ledgerResolutions;
    try {
        ledgerResolutions = await ledgerStore.resolveMemberReferences(authority.authorityRefs, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (error instanceof LedgerAuthorityStoreError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("resolution", "$/authorityRefs");
        }
        throw error;
    }
    for (const [index, resolution] of ledgerResolutions.entries()) {
        const record = resolution.loaded;
        if (record.record.programId !== identity.programId) {
            fail("resolution", `$/authorityRefs/${index}`);
        }
        resolved.push(Object.freeze({
            reference: resolution.reference,
            record,
        }));
    }
    return Object.freeze({
        identity,
        authority,
        resolvedAuthority: Object.freeze(resolved),
    });
}
export function renderDemandAuthority(value) {
    return renderDeterministicJsonDocument(parseDemandAuthority(value), "$authority");
}
export function parseDemandAuthorityDocument(text, identityValue) {
    let json;
    try {
        json = parseDeterministicJsonDocument(text, "$authority");
    }
    catch (error) {
        if (error instanceof DeterministicJsonDocumentError) {
            fail("representation", error.path);
        }
        throw error;
    }
    const authority = parseDemandAuthority(json, identityValue);
    if (renderDemandAuthority(authority) !== text) {
        fail("representation", "$authority");
    }
    return authority;
}
export function computeDemandAuthorityDigest(value) {
    return computeCanonicalJsonSha256Digest(parseDemandAuthority(value));
}
