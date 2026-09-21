/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/managed-evidence-recorded-event-data-v1.schema.json
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
export const WAKEFLOW_MANAGED_EVIDENCE_RECORDED_EVENT_DATA_V1_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-sourcing:managed-evidence-recorded-data:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_MANAGED_EVIDENCE_RECORDED_EVENT_DATA_V1_SCHEMA\",\"title\":\"WakeflowManagedEvidenceRecordedEventDataV1\",\"description\":\"evidence.managed-evidence-recorded persisted event v1 的严格payload。\",\"$comment\":\"完整Manifest是已经捕获并记录的不可变Evidence事实；Aggregate只投影稳定selector，后续同ID文件是可重建资源投影。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"manifest\"],\"properties\":{\"manifest\":{\"$ref\":\"urn:wakeflow:governance:evidence:managed-evidence-manifest:v1\"}}}");
