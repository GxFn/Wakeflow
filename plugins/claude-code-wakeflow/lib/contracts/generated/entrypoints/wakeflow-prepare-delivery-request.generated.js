/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-prepare-delivery-request.schema.json
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
export const WAKEFLOW_PREPARE_DELIVERY_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:prepare-delivery-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_PREPARE_DELIVERY_REQUEST_SCHEMA\",\"title\":\"WakeflowPrepareDeliveryRequestV1\",\"description\":\"Append one delivery for a planned, rework-requested, product-defect-rework-requested, or rearm-exhausted target: take the window work claim, render the prompt skeleton, and return the one-shot permit.\",\"$comment\":\"Append shape (ADR-0012 D2): idempotencyKey plus expectedStreamRevision. Implementation and test targets share the tool; Wakeflow derives the work type, the rework or remediation context, and the test attempt from the Demand state.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"demandId\",\"idempotencyKey\",\"expectedStreamRevision\",\"targetTaskId\",\"authored\"],\"properties\":{\"root\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"idempotencyKey\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9._:-]+$\",\"description\":\"Client-generated key binding this request to at most one commit.\"},\"expectedStreamRevision\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":9007199254740991,\"description\":\"Demand stream revision the caller observed; a stale value is rejected.\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"authored\":{\"$ref\":\"#/$defs/authored\"},\"language\":{\"enum\":[\"en\",\"zh-Hans\"]}},\"$defs\":{\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"deliveryId\":{\"type\":\"string\",\"pattern\":\"^target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"claimId\":{\"type\":\"string\",\"pattern\":\"^work-claim_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"bindingId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$\"},\"authored\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"goal\",\"focus\",\"boundary\"],\"description\":\"Controller 撰写的三段人话：目标、完成焦点（至多两条）、关键边界；其余骨架由 Wakeflow 渲染。\",\"properties\":{\"goal\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":2048,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"focus\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":2,\"items\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":512,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"}},\"boundary\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":1024,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"}}}}}");
