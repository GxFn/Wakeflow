/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-demand-publication-request.schema.json
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
export const WAKEFLOW_DEMAND_PUBLICATION_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:demand-publication-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_PUBLICATION_REQUEST_SCHEMA\",\"title\":\"WakeflowDemandPublicationRequestV1\",\"description\":\"wakeflow_create_demand 的请求：认领一个 pending 需求包即创建 Demand。preview 零写，apply 带 planDigest 重算同一计划，recover 带 operationId（即 demandId）向前恢复。podId 缺省为 primary pod；同一 pod 同一时刻只推进一个 Demand（ADR-0010 D3）。Demand 类型、测试决策、权威成员、时间与标识都由 Wakeflow 派生。\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/createRequest\"},{\"$ref\":\"#/$defs/recoverRequest\"}],\"$defs\":{\"createRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"requirementId\",\"demand\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"enum\":[\"preview\",\"apply\"]},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"requirementId\":{\"$ref\":\"#/$defs/requirementId\"},\"podId\":{\"$ref\":\"#/$defs/podId\",\"description\":\"Target pod; omitted means the primary pod. The pod must be open (not closing) and must not have an active Demand.\"},\"demand\":{\"$ref\":\"#/$defs/authoredDemand\"}}},\"recoverRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"operationId\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"const\":\"recover\"},\"operationId\":{\"$ref\":\"#/$defs/demandId\"}}},\"authoredDemand\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"title\",\"goal\",\"completionDefinition\"],\"properties\":{\"title\":{\"$ref\":\"#/$defs/identityText\"},\"goal\":{\"$ref\":\"#/$defs/identityText\"},\"completionDefinition\":{\"$ref\":\"#/$defs/identityText\"}}},\"identityText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":16384,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"workspaceRoot\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root; never returned.\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"requirementId\":{\"type\":\"string\",\"pattern\":\"^requirement_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"podId\":{\"type\":\"string\",\"pattern\":\"^pod_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}");
