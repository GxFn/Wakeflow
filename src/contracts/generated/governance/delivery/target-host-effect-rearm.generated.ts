/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/delivery/target-host-effect-rearm.schema.json
 */

export type ClaimId = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
export type EventId = string
export type CommitId = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string

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
claimId: ClaimId
claimDigest: WakeflowSha256DigestText
claimEventId: EventId
claimCommitId: CommitId
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
export const WAKEFLOW_TARGET_HOST_EFFECT_REARM_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:delivery:target-host-effect-rearm:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TARGET_HOST_EFFECT_REARM_SCHEMA\",\"title\":\"WakeflowTargetHostEffectRearm\",\"description\":\"将一个精确 rejected-before-effect 尾部重新开放为可 Claim 状态的不可变业务事实。\",\"$comment\":\"Rearm 不执行宿主能力、不复用旧 Claim，也不授权自动重试；下一次效果必须重新取得全新 WindowWorkClaim。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"target\",\"rejectedAttempt\",\"rearmedAt\",\"rearmDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTargetHostEffectRearm\"},\"schemaVersion\":{\"const\":1},\"target\":{\"$ref\":\"#/$defs/target\"},\"rejectedAttempt\":{\"$ref\":\"#/$defs/rejectedAttempt\"},\"rearmedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"rearmDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}},\"$defs\":{\"claimId\":{\"type\":\"string\",\"pattern\":\"^window_work_claim_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"target\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"demandId\",\"targetTaskId\",\"targetDeliveryId\"],\"properties\":{\"demandId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/demandId\"},\"targetTaskId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/targetTaskId\"},\"targetDeliveryId\":{\"$ref\":\"urn:wakeflow:governance:delivery:target-delivery-intent:v1#/properties/targetDeliveryId\"}}},\"rejectedAttempt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"claimId\",\"claimDigest\",\"claimEventId\",\"claimCommitId\",\"observationDigest\"],\"properties\":{\"claimId\":{\"$ref\":\"#/$defs/claimId\"},\"claimDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"claimEventId\":{\"$ref\":\"#/$defs/eventId\"},\"claimCommitId\":{\"$ref\":\"#/$defs/commitId\"},\"observationDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}}}}");
