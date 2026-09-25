/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/demand-escalated-event-data-v1.schema.json
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
export const WAKEFLOW_DEMAND_ESCALATED_EVENT_DATA_V1_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-sourcing:demand-escalated-data:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_ESCALATED_EVENT_DATA_V1_SCHEMA\",\"title\":\"WakeflowDemandEscalatedEventDataV1\",\"description\":\"lifecycle.demand-escalated persisted event v1 的严格 payload：问题、需求章节引用、证据引用、备选方案与影响、建议、来源（ADR-0012 D5）。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"escalation\"],\"properties\":{\"escalation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"issue\",\"requirementRefs\",\"evidence\",\"options\",\"recommendation\",\"source\"],\"properties\":{\"issue\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"requirementRefs\":{\"type\":\"array\",\"maxItems\":16,\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"recordDigest\",\"sectionAnchor\"],\"properties\":{\"recordDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"sectionAnchor\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[\\\\p{L}\\\\p{N}][\\\\p{L}\\\\p{N}-]{0,127}$\"}}}},\"evidence\":{\"type\":\"array\",\"maxItems\":16,\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"id\",\"digest\"],\"properties\":{\"kind\":{\"enum\":[\"target-result\",\"review-decision\",\"managed-evidence\",\"host-effect\"]},\"id\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128},\"digest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}}},\"options\":{\"type\":\"array\",\"maxItems\":8,\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"option\",\"impact\"],\"properties\":{\"option\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":1024,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"impact\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":2048,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"}}}},\"recommendation\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":4096,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"source\":{\"oneOf\":[{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"targetTaskId\",\"reworkCount\"],\"properties\":{\"kind\":{\"const\":\"rework-brake\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"reworkCount\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":1024}}},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"targetTaskId\",\"targetReviewDecisionId\",\"decisionDigest\"],\"properties\":{\"kind\":{\"const\":\"review-decision\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"decisionDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}}]}}}}}");
