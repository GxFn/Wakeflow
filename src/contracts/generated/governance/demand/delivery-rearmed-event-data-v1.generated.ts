/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/delivery-rearmed-event-data-v1.schema.json
 */

/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string

/**
 * `delivery.delivery-rearmed` 事件的数据：同一信封的新代际。
 */
export interface WakeflowDeliveryRearmedEventDataV1 {
rearm: WakeflowDeliveryRearm
}
/**
 * 同一信封在 rejected-before-send 之后的新代际：新的工作声明与围栏，prompt 不变。
 */
export interface WakeflowDeliveryRearm {
kind: "WakeflowDeliveryRearm"
schemaVersion: 1
deliveryId: string
previousGeneration: number
generation: number
previousFence: FenceRef
rejectedOutcomeDigest: WakeflowSha256DigestText
fence: Fence
rearmedAt: WakeflowUtcInstantText
rearmDigest: WakeflowSha256DigestText
}
export interface FenceRef {
claimId: string
claimDigest: WakeflowSha256DigestText
}
export interface Fence {
claimId: string
claimDigest: WakeflowSha256DigestText
expectedStreamRevision: number
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
export const WAKEFLOW_DELIVERY_REARMED_EVENT_DATA_V1_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-sourcing:delivery-rearmed-data:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DELIVERY_REARMED_EVENT_DATA_V1_SCHEMA\",\"title\":\"WakeflowDeliveryRearmedEventDataV1\",\"description\":\"`delivery.delivery-rearmed` 事件的数据：同一信封的新代际。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"rearm\"],\"properties\":{\"rearm\":{\"$ref\":\"urn:wakeflow:governance:delivery:delivery-rearm:v1\"}}}");
