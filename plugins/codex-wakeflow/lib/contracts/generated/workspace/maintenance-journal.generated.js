/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/workspace/maintenance-journal.schema.json
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
export const WAKEFLOW_MAINTENANCE_JOURNAL_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:workspace:maintenance:journal:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_MAINTENANCE_JOURNAL_SCHEMA\",\"title\":\"WakeflowMaintenanceJournal\",\"description\":\"Private mutable checkpoint journal that binds one maintenance operation to an immutable execution intent and exact plan.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"operationId\",\"intentDigest\",\"action\",\"planDigest\",\"matrixDigest\",\"currentConfigDigest\",\"desiredConfigDigest\",\"stepIds\",\"checkpoint\",\"affectedStepId\",\"state\"],\"properties\":{\"kind\":{\"const\":\"WakeflowMaintenanceJournal\"},\"schemaVersion\":{\"const\":1},\"operationId\":{\"type\":\"string\",\"pattern\":\"^maintenance_operation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"intentDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"action\":{\"enum\":[\"fresh-initialize\",\"reconfigure\",\"reconcile\"]},\"planDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"matrixDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"currentConfigDigest\":{\"anyOf\":[{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},{\"type\":\"null\"}]},\"desiredConfigDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"stepIds\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":256,\"uniqueItems\":true,\"items\":{\"type\":\"string\",\"maxLength\":268,\"description\":\"Bounded shared step identity or host-effect prefix plus one bounded host operation identity.\",\"pattern\":\"^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9_:-]*$\"}},\"checkpoint\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":256},\"affectedStepId\":{\"anyOf\":[{\"type\":\"string\",\"maxLength\":268,\"description\":\"The exact currently affected member of stepIds.\",\"pattern\":\"^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9_:-]*$\"},{\"type\":\"null\"}]},\"state\":{\"enum\":[\"prepared\",\"executing\",\"terminal\"]}}}");
