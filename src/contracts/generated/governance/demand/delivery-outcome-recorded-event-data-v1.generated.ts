/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/delivery-outcome-recorded-event-data-v1.schema.json
 */

/**
 * 一次投递代际的宿主效果处置：由 Wakeflow 按证据派生，记录证据种类、宿主记录标识与声明处置。
 */
export type WakeflowDeliveryOutcome = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowDeliveryOutcome"
schemaVersion: 1
deliveryId: string
generation: number
fence: FenceRef
disposition: ("accepted" | "indeterminate" | "rejected-before-send")
attempt: {
status: ("sent" | "failed-before-send" | "unknown")
evidenceDigest: (WakeflowSha256DigestText | null)
}
readback: {
status: ("confirmed" | "pending" | "unavailable")
evidenceDigest: (WakeflowSha256DigestText | null)
}
evidence: {
kind: ("hook-record" | "host-send-return" | "agent-declaration" | "controller-resolution")
hookRecordId: (string | null)
rationale: (string | null)
}
claimHandling: ("retain" | "release-authorized")
observedAt: WakeflowUtcInstantText
outcomeDigest: WakeflowSha256DigestText
})
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string

/**
 * `delivery.delivery-outcome-recorded` 事件的数据：一次投递代际的处置。
 */
export interface WakeflowDeliveryOutcomeRecordedEventDataV1 {
outcome: WakeflowDeliveryOutcome
}
export interface FenceRef {
claimId: string
claimDigest: WakeflowSha256DigestText
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
export const WAKEFLOW_DELIVERY_OUTCOME_RECORDED_EVENT_DATA_V1_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-sourcing:delivery-outcome-recorded-data:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DELIVERY_OUTCOME_RECORDED_EVENT_DATA_V1_SCHEMA\",\"title\":\"WakeflowDeliveryOutcomeRecordedEventDataV1\",\"description\":\"`delivery.delivery-outcome-recorded` 事件的数据：一次投递代际的处置。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"outcome\"],\"properties\":{\"outcome\":{\"$ref\":\"urn:wakeflow:governance:delivery:delivery-outcome:v1\"}}}");
