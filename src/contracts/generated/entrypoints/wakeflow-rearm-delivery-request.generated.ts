/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-rearm-delivery-request.schema.json
 */

export type DemandId = string
export type DeliveryId = string

/**
 * Rearm one delivery. Target mode: a target deliveryId in host-effect-rejected or test-host-effect-rejected keeps its envelope and prompt and gets a fresh work claim and fence, generation plus one. Callback mode: the callback deliveryId of a result-reported or test-result-reported target has its wake-controller callback permit re-issued against the current Controller binding, with no claim or fence.
 */
export interface WakeflowRearmDeliveryRequestV1 {
/**
 * Absolute path of the existing Wakeflow workspace root.
 */
root: string
demandId: DemandId
/**
 * Client-generated key binding this request to at most one commit.
 */
idempotencyKey: string
/**
 * Demand stream revision the caller observed; a stale value is rejected.
 */
expectedStreamRevision: number
deliveryId: DeliveryId
}

/** 递归冻结生成的 Schema，阻止校验器首次使用前发生嵌套漂移。 */
function freezeGeneratedSchema<Value>(value: Value): Readonly<Value> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeGeneratedSchema(child);
    Object.freeze(value);
  }
  return value;
}

/** 从 JSON 文本恢复 Schema，保留 `__proto__` 等普通 JSON 自有键。 */
function restoreGeneratedSchema(
  serialized: string,
): Readonly<Record<string, unknown>> {
  const value: unknown = JSON.parse(serialized);
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError("Generated Schema must be an object.");
  }
  return freezeGeneratedSchema(value as Record<string, unknown>);
}

/** Ajv 严格校验器使用的 Schema 派生运行时权威；不得手工修改。 */
export const WAKEFLOW_REARM_DELIVERY_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:rearm-delivery-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_REARM_DELIVERY_REQUEST_SCHEMA\",\"title\":\"WakeflowRearmDeliveryRequestV1\",\"description\":\"Rearm one delivery. Target mode: a target deliveryId in host-effect-rejected or test-host-effect-rejected keeps its envelope and prompt and gets a fresh work claim and fence, generation plus one. Callback mode: the callback deliveryId of a result-reported or test-result-reported target has its wake-controller callback permit re-issued against the current Controller binding, with no claim or fence.\",\"$comment\":\"At most three target-mode rearms per envelope; beyond that the target must be prepared again with a new envelope.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"demandId\",\"idempotencyKey\",\"expectedStreamRevision\",\"deliveryId\"],\"properties\":{\"root\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"idempotencyKey\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9._:-]+$\",\"description\":\"Client-generated key binding this request to at most one commit.\"},\"expectedStreamRevision\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":9007199254740991,\"description\":\"Demand stream revision the caller observed; a stale value is rejected.\"},\"deliveryId\":{\"$ref\":\"#/$defs/deliveryId\"}},\"$defs\":{\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"deliveryId\":{\"type\":\"string\",\"pattern\":\"^target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}");
