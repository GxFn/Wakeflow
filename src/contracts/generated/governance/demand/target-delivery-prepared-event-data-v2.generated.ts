/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/target-delivery-prepared-event-data-v2.schema.json
 */

/**
 * Immutable event-carried intent for delivering one TaskPackage attempt to one exact current host binding without performing the host effect.
 */
export type WakeflowTargetDeliveryIntent = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowTargetDeliveryIntent"
schemaVersion: 1
targetDeliveryId: string
programId: string
configDigest: WakeflowSha256DigestText
demandId: string
target: {
targetTaskId: string
taskPackageId: string
taskPackageRef: WakeflowPortableResourcePathText
taskPackageDigest: WakeflowSha256DigestText
}
route: {
hostId: ("codex" | "claude-code")
windowId: string
bindingId: string
}
language: ("en" | "zh-Hans")
portablePrompt: string
rework?: Rework
productDefectRemediation?: ProductDefectRemediation
preparedAt: WakeflowUtcInstantText
intentDigest: WakeflowSha256DigestText
})
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string

/**
 * delivery.target-delivery-prepared persisted event v2 的严格 payload。
 */
export interface WakeflowTargetDeliveryPreparedEventDataV2 {
intent: (WakeflowTargetDeliveryIntent & {
productDefectRemediation?: never
[k: string]: unknown | undefined
})
}
export interface Rework {
decision: {
targetReviewDecisionId: string
decisionDigest: WakeflowSha256DigestText
}
previousResult: {
targetResultId: string
resultDigest: WakeflowSha256DigestText
}
rationaleSummary: string
/**
 * @minItems 1
 * @maxItems 32
 */
requiredCorrections: [RequiredCorrection, ...(RequiredCorrection)[]]
}
export interface RequiredCorrection {
checkId: string
outcome: ("failed" | "inconclusive")
methodSummary: string
observationSummary: string
}
export interface ProductDefectRemediation {
authorization: {
productDefectRemediationId: string
authorizationDigest: WakeflowSha256DigestText
}
testReviewDecision: {
targetReviewDecisionId: string
decisionDigest: WakeflowSha256DigestText
}
previousResult: {
targetResultId: string
resultDigest: WakeflowSha256DigestText
}
authorizationRationaleSummary: string
correctionObjectiveSummary: string
/**
 * @minItems 1
 * @maxItems 32
 */
requiredCorrections: [ProductDefectRequiredCorrection, ...(ProductDefectRequiredCorrection)[]]
}
export interface ProductDefectRequiredCorrection {
checkId: string
outcome: "failed"
methodSummary: string
observationSummary: string
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
export const WAKEFLOW_TARGET_DELIVERY_PREPARED_EVENT_DATA_V2_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-sourcing:target-delivery-prepared-data:v2\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TARGET_DELIVERY_PREPARED_EVENT_DATA_V2_SCHEMA\",\"title\":\"WakeflowTargetDeliveryPreparedEventDataV2\",\"description\":\"delivery.target-delivery-prepared persisted event v2 的严格 payload。\",\"$comment\":\"v2 接受初次投递 Intent，也接受绑定精确 rework Decision 与 previous Result 的后续投递 Intent；它仍未取得 WindowWorkClaim 或跨越宿主效果边界。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"intent\"],\"properties\":{\"intent\":{\"allOf\":[{\"$ref\":\"urn:wakeflow:governance:delivery:target-delivery-intent:v1\"},{\"type\":\"object\",\"properties\":{\"productDefectRemediation\":false}}]}}}");
