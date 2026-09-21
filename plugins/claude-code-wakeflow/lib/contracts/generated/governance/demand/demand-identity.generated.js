/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/demand-identity.schema.json
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
export const WAKEFLOW_DEMAND_IDENTITY_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:identity:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_IDENTITY_SCHEMA\",\"title\":\"WakeflowDemandIdentity\",\"description\":\"Demand Event Sourcing Aggregate 创建后不可变的 identity authority。\",\"$comment\":\"需求包谱系、pod 存在性（配置 pods[]）和 typed identity 的跨记录解析由 Demand identity codec 与 demand 切片继续校验。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"programId\",\"demandId\",\"createdAt\",\"title\",\"goal\",\"completionDefinition\",\"demandType\",\"source\",\"podId\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-demand-identity\"},\"schemaVersion\":{\"const\":1},\"programId\":{\"$ref\":\"#/$defs/programId\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"createdAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"title\":{\"$ref\":\"#/$defs/nonEmptyText\"},\"goal\":{\"$ref\":\"#/$defs/nonEmptyText\"},\"completionDefinition\":{\"$ref\":\"#/$defs/nonEmptyText\"},\"demandType\":{\"enum\":[\"requirement\",\"bug\",\"supplement\",\"research\"]},\"source\":{\"$ref\":\"urn:wakeflow:governance:ledger:requirement-lineage:v1\"},\"podId\":{\"$ref\":\"#/$defs/podId\",\"description\":\"The pod this Demand advances in (ADR-0010 D3); one pod advances one Demand at a time.\"}},\"$defs\":{\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"nonEmptyText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":16384,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"podId\":{\"type\":\"string\",\"pattern\":\"^pod_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}");
