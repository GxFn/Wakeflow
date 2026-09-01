/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/delivery/target-delivery-host-effect-observation.schema.json
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
export type Readback = (UnavailableReadback | ObservedReadback)

/**
 * Agent 对一次 Target Delivery 宿主效果尝试及最多一次 readback 的脱敏观察。
 */
export interface WakeflowTargetDeliveryHostEffectObservation {
kind: "WakeflowTargetDeliveryHostEffectObservation"
schemaVersion: 1
source: "agent-host-effect-observation"
action: (ImplementationAction | TestAction)
attempt: Attempt
readback: Readback
observedAt: WakeflowUtcInstantText
observationDigest: WakeflowSha256DigestText
}
export interface ImplementationAction {
actionId: ClaimId
targetDeliveryId: string
intentDigest: WakeflowSha256DigestText
hostId: ("codex" | "claude-code")
windowId: string
bindingId: string
claimDigest: WakeflowSha256DigestText
hostObservationAuthorityDigest: WakeflowSha256DigestText
claimEventId: EventId
claimCommitId: CommitId
claimEventStreamRevision: number
claimExpectedStateDigest: WakeflowSha256DigestText
issuedAt: WakeflowUtcInstantText
}
export interface TestAction {
actionId: ClaimId
targetDeliveryId: string
intentDigest: WakeflowSha256DigestText
hostId: ("codex" | "claude-code")
windowId: string
bindingId: string
claimDigest: WakeflowSha256DigestText
hostObservationAuthorityDigest: WakeflowSha256DigestText
claimEventId: EventId
claimCommitId: CommitId
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
export const WAKEFLOW_TARGET_DELIVERY_HOST_EFFECT_OBSERVATION_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:delivery:target-delivery-host-effect-observation:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TARGET_DELIVERY_HOST_EFFECT_OBSERVATION_SCHEMA\",\"title\":\"WakeflowTargetDeliveryHostEffectObservation\",\"description\":\"Agent 对一次 Target Delivery 宿主效果尝试及最多一次 readback 的脱敏观察。\",\"$comment\":\"本记录是 Agent observation，不是宿主签名证明。历史 implementation action 省略 workType；Test action 额外绑定 logical Test attempt 与 dispatch packet digest。原始 handle、宿主返回值、错误文本、prompt 和 workspace 绝对路径均不得持久化；sent-unconfirmed 是 accepted 与非 confirmed readback 的派生展示，不是本合同状态。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"source\",\"action\",\"attempt\",\"readback\",\"observedAt\",\"observationDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTargetDeliveryHostEffectObservation\"},\"schemaVersion\":{\"const\":1},\"source\":{\"const\":\"agent-host-effect-observation\"},\"action\":{\"oneOf\":[{\"$ref\":\"#/$defs/implementationAction\"},{\"$ref\":\"#/$defs/testAction\"}]},\"attempt\":{\"$ref\":\"#/$defs/attempt\"},\"readback\":{\"$ref\":\"#/$defs/readback\"},\"observedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"observationDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}},\"$defs\":{\"claimId\":{\"type\":\"string\",\"pattern\":\"^window_work_claim_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"implementationAction\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"actionId\",\"targetDeliveryId\",\"intentDigest\",\"hostId\",\"windowId\",\"bindingId\",\"claimDigest\",\"hostObservationAuthorityDigest\",\"claimEventId\",\"claimCommitId\",\"claimEventStreamRevision\",\"claimExpectedStateDigest\",\"issuedAt\"],\"properties\":{\"actionId\":{\"$ref\":\"#/$defs/claimId\"},\"targetDeliveryId\":{\"$ref\":\"urn:wakeflow:governance:delivery:target-delivery-intent:v1#/properties/targetDeliveryId\"},\"intentDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"hostId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:host-binding:v1#/properties/hostId\"},\"windowId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:host-binding:v1#/properties/windowId\"},\"bindingId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:host-binding:v1#/properties/bindingId\"},\"claimDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"hostObservationAuthorityDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"claimEventId\":{\"$ref\":\"#/$defs/eventId\"},\"claimCommitId\":{\"$ref\":\"#/$defs/commitId\"},\"claimEventStreamRevision\":{\"type\":\"integer\",\"minimum\":4,\"maximum\":9007199254740991},\"claimExpectedStateDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"issuedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"}}},\"testAction\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"actionId\",\"targetDeliveryId\",\"intentDigest\",\"hostId\",\"windowId\",\"bindingId\",\"claimDigest\",\"hostObservationAuthorityDigest\",\"claimEventId\",\"claimCommitId\",\"claimEventStreamRevision\",\"claimExpectedStateDigest\",\"issuedAt\",\"workType\",\"testAttemptId\",\"testDispatchPacketDigest\"],\"properties\":{\"actionId\":{\"$ref\":\"#/$defs/claimId\"},\"targetDeliveryId\":{\"$ref\":\"urn:wakeflow:governance:delivery:target-delivery-intent:v1#/properties/targetDeliveryId\"},\"intentDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"hostId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:host-binding:v1#/properties/hostId\"},\"windowId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:host-binding:v1#/properties/windowId\"},\"bindingId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:host-binding:v1#/properties/bindingId\"},\"claimDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"hostObservationAuthorityDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"claimEventId\":{\"$ref\":\"#/$defs/eventId\"},\"claimCommitId\":{\"$ref\":\"#/$defs/commitId\"},\"claimEventStreamRevision\":{\"type\":\"integer\",\"minimum\":4,\"maximum\":9007199254740991},\"claimExpectedStateDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"issuedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"workType\":{\"const\":\"test\"},\"testAttemptId\":{\"$ref\":\"urn:wakeflow:governance:testing:test-execution-attempt:v1#/properties/testAttemptId\"},\"testDispatchPacketDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"attempt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"evidenceDigest\"],\"properties\":{\"status\":{\"enum\":[\"accepted\",\"indeterminate\",\"rejected-before-effect\"]},\"evidenceDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"readback\":{\"oneOf\":[{\"$ref\":\"#/$defs/unavailableReadback\"},{\"$ref\":\"#/$defs/observedReadback\"}]},\"unavailableReadback\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\"],\"properties\":{\"status\":{\"const\":\"unavailable\"}}},\"observedReadback\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"evidenceDigest\"],\"properties\":{\"status\":{\"enum\":[\"confirmed\",\"pending\"]},\"evidenceDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}}}}");
