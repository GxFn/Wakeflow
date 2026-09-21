/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/controller-target-review-decided-event-data-v1.schema.json
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
export const WAKEFLOW_CONTROLLER_TARGET_REVIEW_DECIDED_EVENT_DATA_V1_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:controller-target-review-decided-event-data:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_CONTROLLER_TARGET_REVIEW_DECIDED_EVENT_DATA_V1_SCHEMA\",\"title\":\"WakeflowControllerTargetReviewDecidedEventDataV1\",\"description\":\"review.target-result-decided事件版本1的持久化数据。\",\"$comment\":\"Event保存完整ControllerImplementationReviewDecision业务事实；Aggregate状态摘要与后续route不进入Event data。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"decision\"],\"properties\":{\"decision\":{\"oneOf\":[{\"$ref\":\"urn:wakeflow:governance:review:controller-implementation-review-decision:v1\"},{\"$ref\":\"urn:wakeflow:governance:review:controller-test-review-decision:v1\"}]}}}");
