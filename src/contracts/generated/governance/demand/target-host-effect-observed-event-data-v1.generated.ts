/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/target-host-effect-observed-event-data-v1.schema.json
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
 * delivery.target-host-effect-observed persisted event v1 的严格 payload。
 */
export interface WakeflowTargetHostEffectObservedEventDataV1 {
observation: WakeflowTargetDeliveryHostEffectObservation
}
/**
 * Agent 对一次 Target Delivery 宿主效果尝试及最多一次 readback 的脱敏观察。
 */
export interface WakeflowTargetDeliveryHostEffectObservation {
kind: "WakeflowTargetDeliveryHostEffectObservation"
schemaVersion: 1
source: "agent-host-effect-observation"
action: (ImplementationAction | TestAction)
attempt: Attempt
readback: (UnavailableReadback | ObservedReadback)
observedAt: WakeflowUtcInstantText
observationDigest: WakeflowSha256DigestText
}
export interface ImplementationAction {
actionId: string
targetDeliveryId: string
intentDigest: WakeflowSha256DigestText
hostId: ("codex" | "claude-code")
windowId: string
bindingId: string
claimDigest: WakeflowSha256DigestText
hostObservationAuthorityDigest: WakeflowSha256DigestText
claimEventId: string
claimCommitId: string
claimEventStreamRevision: number
claimExpectedStateDigest: WakeflowSha256DigestText
issuedAt: WakeflowUtcInstantText
}
export interface TestAction {
actionId: string
targetDeliveryId: string
intentDigest: WakeflowSha256DigestText
hostId: ("codex" | "claude-code")
windowId: string
bindingId: string
claimDigest: WakeflowSha256DigestText
hostObservationAuthorityDigest: WakeflowSha256DigestText
claimEventId: string
claimCommitId: string
claimEventStreamRevision: number
claimExpectedStateDigest: WakeflowSha256DigestText
issuedAt: WakeflowUtcInstantText
workType: "test"
testAttemptId: string
testDispatchPacketDigest: WakeflowSha256DigestText
}
export interface Attempt {
status: ("accepted" | "indeterminate" | "rejected-before-effect")
evidenceDigest: WakeflowSha256DigestText
}
export interface UnavailableReadback {
status: "unavailable"
}
export interface ObservedReadback {
status: ("confirmed" | "pending")
evidenceDigest: WakeflowSha256DigestText
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
export const WAKEFLOW_TARGET_HOST_EFFECT_OBSERVED_EVENT_DATA_V1_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-sourcing:target-host-effect-observed-data:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TARGET_HOST_EFFECT_OBSERVED_EVENT_DATA_V1_SCHEMA\",\"title\":\"WakeflowTargetHostEffectObservedEventDataV1\",\"description\":\"delivery.target-host-effect-observed persisted event v1 的严格 payload。\",\"$comment\":\"完整脱敏 observation 是 Agent 已报告的宿主效果事实；事件只记录观察并派生 transport disposition，不代表 TargetResult、Controller acceptance 或需求完成。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"observation\"],\"properties\":{\"observation\":{\"$ref\":\"urn:wakeflow:governance:delivery:target-delivery-host-effect-observation:v1\"}}}");
