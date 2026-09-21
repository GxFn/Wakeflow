import { WAKEFLOW_REQUIREMENT_LINEAGE_SCHEMA, } from "../../../contracts/generated/governance/ledger/requirement-lineage.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../../contracts/generated/foundation/sha256-digest.generated.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../../contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest, Sha256Error, } from "../../../foundation/crypto/sha256.js";
import { JsonValueError, parseJsonValue, } from "../../../foundation/data/json-value.js";
import { parsePortableResourcePath, PortableResourcePathError, } from "../../../foundation/filesystem/portable-resource-path.js";
import { createRuntimeJsonSchemaValidator, } from "../../../foundation/schema/runtime-json-schema.js";
import { requirementRootRef } from "../../ledger/ledger-authority-paths.js";
/**
 * Wakeflow Governance / Demand Model：Demand 身份绑定的需求包谱系引用。
 *
 * 本引用只绑定需求包标识、Ledger 记录的可移植引用和记录摘要；它不引用看板
 * 状态、成员正文或认领修订。Demand 发布流程必须重新解析该引用，并由 Ledger
 * 与看板职责所有者验证当前记录、认领状态和 CAS 预期（ADR-0011 D7）。
 */
const REQUIREMENT_LINEAGE_ARTIFACT_KIND = "wakeflow-requirement-lineage";
const REQUIREMENT_LINEAGE_SCHEMA_VERSION = 1;
const ERROR_MESSAGES = {
    "json": "Requirement lineage is not passive JSON data.",
    "schema": "Requirement lineage does not satisfy its portable Schema.",
    "identifier": "Requirement lineage contains an invalid requirement identity.",
    "path": "Requirement lineage contains an invalid record reference.",
    "digest": "Requirement lineage contains an invalid digest.",
};
export class RequirementLineageError extends Error {
    name = "RequirementLineageError";
    code = "wakeflow-requirement-lineage";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const validateWire = createRuntimeJsonSchemaValidator(WAKEFLOW_REQUIREMENT_LINEAGE_SCHEMA, [WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA, WAKEFLOW_SHA256_DIGEST_SCHEMA]);
function fail(reason, path) {
    throw new RequirementLineageError(reason, path);
}
/** 需求包记录在 Ledger 根内的固定引用：`requirements/<requirementId>/record.json`。 */
export function requirementLineageRecordRef(requirementId) {
    return parsePortableResourcePath(`${requirementRootRef(requirementId)}/record.json`, "$recordRef");
}
/** 解析字段关系严格受限、与 Ledger 布局一致的需求包谱系引用。 */
export function parseRequirementLineageReference(value) {
    let json;
    try {
        json = parseJsonValue(value, "$lineage");
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("json", error.path);
        throw error;
    }
    const result = validateWire(json);
    if (!result.ok)
        fail("schema", result.path);
    let requirementId;
    try {
        requirementId = parseWakeflowDurableIdOfKind(result.value.requirementId, "requirement", "$/requirementId");
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError) {
            fail("identifier", "$/requirementId");
        }
        throw error;
    }
    let recordRef;
    try {
        recordRef = parsePortableResourcePath(result.value.recordRef, "$/recordRef");
    }
    catch (error) {
        if (error instanceof PortableResourcePathError)
            fail("path", "$/recordRef");
        throw error;
    }
    if (recordRef !== requirementLineageRecordRef(requirementId)) {
        fail("path", "$/recordRef");
    }
    let recordDigest;
    try {
        recordDigest = parseSha256Digest(result.value.recordDigest, "$/recordDigest");
    }
    catch (error) {
        if (error instanceof Sha256Error)
            fail("digest", "$/recordDigest");
        throw error;
    }
    return Object.freeze({
        artifactKind: REQUIREMENT_LINEAGE_ARTIFACT_KIND,
        schemaVersion: REQUIREMENT_LINEAGE_SCHEMA_VERSION,
        requirementId,
        recordRef,
        recordDigest,
    });
}
