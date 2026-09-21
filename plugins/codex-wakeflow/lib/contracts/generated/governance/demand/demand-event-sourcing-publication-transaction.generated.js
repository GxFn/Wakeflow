/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/demand-event-sourcing-publication-transaction.schema.json
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
export const WAKEFLOW_DEMAND_EVENT_SOURCING_PUBLICATION_TRANSACTION_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-sourcing-publication-transaction:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_EVENT_SOURCING_PUBLICATION_TRANSACTION_SCHEMA\",\"title\":\"WakeflowDemandEventSourcingPublicationTransaction\",\"description\":\"需求包认领驱动的 Demand Event Sourcing root publication 的自包含 immutable recovery plan。\",\"$comment\":\"Plan 保存 initial command 与由纯 Decider/evolve 得到的 exact commit；snapshot 是 derived cache，不进入跨资源 transaction authority。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"demandId\",\"requirementId\",\"expectedClaimStateDigest\",\"stageRef\",\"finalRootRef\",\"identity\",\"identityDigest\",\"authority\",\"authorityDigest\",\"initialCommand\",\"initialCommandDigest\",\"initialCommit\",\"initialCommitDigest\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-demand-event-sourcing-publication-transaction\"},\"schemaVersion\":{\"const\":1},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"requirementId\":{\"type\":\"string\",\"pattern\":\"^requirement_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"expectedClaimStateDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"stageRef\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"finalRootRef\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"identity\":{\"$ref\":\"urn:wakeflow:governance:demand:identity:v1\"},\"identityDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"authority\":{\"$ref\":\"urn:wakeflow:governance:demand:authority:v1\"},\"authorityDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"initialCommand\":{\"$ref\":\"#/$defs/initialCommand\"},\"initialCommandDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"initialCommit\":{\"$ref\":\"urn:wakeflow:governance:demand:event-stream-commit:v1\"},\"initialCommitDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}},\"$defs\":{\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"initialCommand\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"commandType\",\"commandVersion\",\"demandId\",\"eventId\",\"recordedAt\",\"identityDigest\",\"authorityDigest\"],\"properties\":{\"commandType\":{\"const\":\"publication.publish-demand\"},\"commandVersion\":{\"const\":1},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"recordedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"identityDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"authorityDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}}}}");
