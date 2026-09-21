/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/evidence/managed-evidence-publication-transaction.schema.json
 */
/** 递归冻结生成的 Schema，阻止校验器首次使用前发生嵌套漂移。 */
function freezeGeneratedSchema(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        for (const child of Object.values(value))
            freezeGeneratedSchema(child);
        Object.freeze(value);
    }
    return value;
}
/** 从 JSON 文本恢复 Schema，保留 `__proto__` 等普通 JSON 自有键。 */
function restoreGeneratedSchema(serialized) {
    const value = JSON.parse(serialized);
    if (value === null || Array.isArray(value) || typeof value !== "object") {
        throw new TypeError("Generated Schema must be an object.");
    }
    return freezeGeneratedSchema(value);
}
/** Ajv 严格校验器使用的 Schema 派生运行时权威；不得手工修改。 */
export const WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:evidence:managed-evidence-publication-transaction:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_SCHEMA\",\"title\":\"WakeflowManagedEvidencePublicationTransaction\",\"description\":\"Managed Evidence record tree与Demand Event Sourcing追加之间的不可变恢复计划。\",\"$comment\":\"Transaction不保存可变phase，也不重复保存可由Manifest派生的Demand/Evidence ID、stage/final路径、Event command或完整record tree plan。capturePlanDigest闭合已确认preview；recordTreePlanDigest闭合待物化目录；demandEventSourcingAppend保存乐观追加所需的exact source expectation与稳定ID。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"capturePlanDigest\",\"manifest\",\"recordTreePlanDigest\",\"demandEventSourcingAppend\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-managed-evidence-publication-transaction\"},\"schemaVersion\":{\"const\":1},\"capturePlanDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"manifest\":{\"$ref\":\"urn:wakeflow:governance:evidence:managed-evidence-manifest:v1\"},\"recordTreePlanDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"demandEventSourcingAppend\":{\"$ref\":\"#/$defs/demandEventSourcingAppend\"}},\"$defs\":{\"demandEventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandEventCommitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandEventSourcingAppend\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"expectedStreamRevision\",\"expectedStateDigest\",\"expectedLastEventId\",\"expectedLastEventDigest\",\"eventId\",\"commandDigest\",\"commitId\"],\"properties\":{\"expectedStreamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740990},\"expectedStateDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"expectedLastEventId\":{\"$ref\":\"#/$defs/demandEventId\"},\"expectedLastEventDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"eventId\":{\"$ref\":\"#/$defs/demandEventId\"},\"commandDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"commitId\":{\"$ref\":\"#/$defs/demandEventCommitId\"}}}}}");
