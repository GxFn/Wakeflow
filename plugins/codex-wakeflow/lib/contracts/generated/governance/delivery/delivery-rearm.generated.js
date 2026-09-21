/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/delivery/delivery-rearm.schema.json
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
export const WAKEFLOW_DELIVERY_REARM_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:delivery:delivery-rearm:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DELIVERY_REARM_SCHEMA\",\"title\":\"WakeflowDeliveryRearm\",\"description\":\"同一信封在 rejected-before-send 之后的新代际：新的工作声明与围栏，prompt 不变。\",\"$comment\":\"rearm 不执行宿主效果；同一信封最多三次，超过必须重新准备新信封。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"deliveryId\",\"previousGeneration\",\"generation\",\"previousFence\",\"rejectedOutcomeDigest\",\"fence\",\"rearmedAt\",\"rearmDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowDeliveryRearm\"},\"schemaVersion\":{\"const\":1},\"deliveryId\":{\"$ref\":\"#/$defs/deliveryId\"},\"previousGeneration\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":3},\"generation\":{\"type\":\"integer\",\"minimum\":2,\"maximum\":4},\"previousFence\":{\"$ref\":\"#/$defs/fenceRef\"},\"rejectedOutcomeDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"fence\":{\"$ref\":\"#/$defs/fence\"},\"rearmedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"rearmDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}},\"$defs\":{\"deliveryId\":{\"type\":\"string\",\"pattern\":\"^target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"claimId\":{\"type\":\"string\",\"pattern\":\"^work-claim_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"fence\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"claimId\",\"claimDigest\",\"expectedStreamRevision\"],\"properties\":{\"claimId\":{\"$ref\":\"#/$defs/claimId\"},\"claimDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"expectedStreamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991}}},\"fenceRef\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"claimId\",\"claimDigest\"],\"properties\":{\"claimId\":{\"$ref\":\"#/$defs/claimId\"},\"claimDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}}}}");
