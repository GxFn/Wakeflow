/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/workspace/maintenance-execution-intent.schema.json
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
export const WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:workspace:maintenance:execution-intent:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_SCHEMA\",\"title\":\"WakeflowMaintenanceExecutionIntent\",\"description\":\"Private immutable recovery intent for one exact Wakeflow maintenance execution.\",\"$comment\":\"The intent stores normalized desired Config, exact host profiles and the compact plan sources required to reconstruct the execution plan after restart. It excludes source file bodies, absolute paths, credentials, process identity, lock tokens and mutable checkpoints.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"operationId\",\"desiredConfig\",\"currentHostProfile\",\"hostProfiles\",\"sharedPreview\",\"hostContribution\",\"planDigest\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-maintenance-execution-intent\"},\"schemaVersion\":{\"const\":1},\"operationId\":{\"type\":\"string\",\"pattern\":\"^maintenance_operation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"desiredConfig\":{\"$ref\":\"urn:wakeflow:config:v1\"},\"currentHostProfile\":{\"type\":\"object\"},\"hostProfiles\":{\"type\":\"array\",\"minItems\":2,\"maxItems\":2,\"items\":{\"type\":\"object\"}},\"sharedPreview\":{\"type\":\"object\"},\"hostContribution\":{\"anyOf\":[{\"type\":\"object\"},{\"type\":\"null\"}]},\"planDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}}");
