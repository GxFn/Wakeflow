/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/demand-continued-event-data-v1.schema.json
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
export const WAKEFLOW_DEMAND_CONTINUED_EVENT_DATA_V1_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-sourcing:demand-continued-data:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_CONTINUED_EVENT_DATA_V1_SCHEMA\",\"title\":\"WakeflowDemandContinuedEventDataV1\",\"description\":\"lifecycle.demand-continued persisted event v1 的严格 payload：从归档重开一个已完成 Demand 的续接谱系。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"continuation\"],\"properties\":{\"continuation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"summary\",\"archiveRef\",\"archiveManifestDigest\",\"previousStreamRevision\"],\"properties\":{\"kind\":{\"enum\":[\"optimization\",\"requirement-supplement\",\"verified-bug\"]},\"summary\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":4096,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"archiveRef\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"archiveManifestDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"previousStreamRevision\":{\"type\":\"integer\",\"minimum\":2,\"maximum\":9007199254740991}}},\"historicalTestTargetIds\":{\"description\":\"续接那一刻已存在的 test 目标，由续接决策从续接前状态算出并随事件持久化：它们是上一轮的历史，不再算作未终结或当前的测试代际。没有 test 目标时省略；早期写入的事件也没有该字段，重放时保持当时的状态不变。\",\"type\":\"array\",\"minItems\":1,\"uniqueItems\":true,\"items\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}}");
