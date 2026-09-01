/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/target-host-effect-claimed-event-data-v1.schema.json
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
 * delivery.target-host-effect-claimed persisted event v1 的严格 payload。
 */
export interface WakeflowTargetHostEffectClaimedEventDataV1 {
claim: WakeflowWindowWorkClaim
}
/**
 * Current durable cross-Demand claim reserving one stable logical window for one exact prepared Target Delivery and intended Claim event transition.
 */
export interface WakeflowWindowWorkClaim {
kind: "WakeflowWindowWorkClaim"
schemaVersion: 1
claimId: string
programId: string
target: (ImplementationTarget | TestTarget)
route: {
hostId: ("codex" | "claude-code")
windowId: string
bindingId: string
}
hostObservation: {
authorityDigest: WakeflowSha256DigestText
observedAt: WakeflowUtcInstantText
}
claimTransition: {
commitId: string
eventId: string
expectedStreamRevision: number
expectedStateDigest: WakeflowSha256DigestText
}
claimedAt: WakeflowUtcInstantText
claimDigest: WakeflowSha256DigestText
}
export interface ImplementationTarget {
demandId: string
targetTaskId: string
targetDeliveryId: string
intentDigest: WakeflowSha256DigestText
intentPreparedAt: WakeflowUtcInstantText
}
export interface TestTarget {
demandId: string
targetTaskId: string
targetDeliveryId: string
intentDigest: WakeflowSha256DigestText
intentPreparedAt: WakeflowUtcInstantText
workType: "test"
testAttemptId: string
testDispatchPacketDigest: WakeflowSha256DigestText
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
export const WAKEFLOW_TARGET_HOST_EFFECT_CLAIMED_EVENT_DATA_V1_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-sourcing:target-host-effect-claimed-data:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TARGET_HOST_EFFECT_CLAIMED_EVENT_DATA_V1_SCHEMA\",\"title\":\"WakeflowTargetHostEffectClaimedEventDataV1\",\"description\":\"delivery.target-host-effect-claimed persisted event v1 的严格 payload。\",\"$comment\":\"完整 WindowWorkClaim 保留已经提交的跨 Demand 占用历史；事件本身仍不代表宿主发送已经发生。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"claim\"],\"properties\":{\"claim\":{\"$ref\":\"urn:wakeflow:governance:delivery:window-work-claim:v1\"}}}");
