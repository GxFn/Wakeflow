/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/demand-published-event-data-v1.schema.json
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
export const WAKEFLOW_DEMAND_PUBLISHED_EVENT_DATA_V1_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-sourcing:demand-published-data:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_PUBLISHED_EVENT_DATA_V1_SCHEMA\",\"title\":\"WakeflowDemandPublishedEventDataV1\",\"description\":\"publication.demand-published persisted event v1 的严格 payload。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"identityRef\",\"identityDigest\",\"authorityRef\",\"authorityDigest\"],\"properties\":{\"identityRef\":{\"const\":\"identity.json\"},\"identityDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"authorityRef\":{\"const\":\"authority.json\"},\"authorityDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}}");
