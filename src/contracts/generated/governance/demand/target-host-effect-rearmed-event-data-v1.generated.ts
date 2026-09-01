/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/target-host-effect-rearmed-event-data-v1.schema.json
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
 * delivery.target-host-effect-rearmed persisted event v1 的严格 payload。
 */
export interface WakeflowTargetHostEffectRearmedEventDataV1 {
rearm: WakeflowTargetHostEffectRearm
}
/**
 * 将一个精确 rejected-before-effect 尾部重新开放为可 Claim 状态的不可变业务事实。
 */
export interface WakeflowTargetHostEffectRearm {
kind: "WakeflowTargetHostEffectRearm"
schemaVersion: 1
target: Target
rejectedAttempt: RejectedAttempt
rearmedAt: WakeflowUtcInstantText
rearmDigest: WakeflowSha256DigestText
}
export interface Target {
demandId: string
targetTaskId: string
targetDeliveryId: string
}
export interface RejectedAttempt {
claimId: string
claimDigest: WakeflowSha256DigestText
claimEventId: string
claimCommitId: string
observationDigest: WakeflowSha256DigestText
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
export const WAKEFLOW_TARGET_HOST_EFFECT_REARMED_EVENT_DATA_V1_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-sourcing:target-host-effect-rearmed-data:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TARGET_HOST_EFFECT_REARMED_EVENT_DATA_V1_SCHEMA\",\"title\":\"WakeflowTargetHostEffectRearmedEventDataV1\",\"description\":\"delivery.target-host-effect-rearmed persisted event v1 的严格 payload。\",\"$comment\":\"完整 TargetHostEffectRearm 绑定精确 rejected observation；事件只恢复 prepared 资格，不跨越宿主效果边界。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"rearm\"],\"properties\":{\"rearm\":{\"$ref\":\"urn:wakeflow:governance:delivery:target-host-effect-rearm:v1\"}}}");
