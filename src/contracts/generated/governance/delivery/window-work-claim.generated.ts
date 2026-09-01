/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/delivery/window-work-claim.schema.json
 */

export type ClaimId = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
export type CommitId = string
export type EventId = string

/**
 * Current durable cross-Demand claim reserving one stable logical window for one exact prepared Target Delivery and intended Claim event transition.
 */
export interface WakeflowWindowWorkClaim {
kind: "WakeflowWindowWorkClaim"
schemaVersion: 1
claimId: ClaimId
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
commitId: CommitId
eventId: EventId
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
export const WAKEFLOW_WINDOW_WORK_CLAIM_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:delivery:window-work-claim:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_WINDOW_WORK_CLAIM_SCHEMA\",\"title\":\"WakeflowWindowWorkClaim\",\"description\":\"Current durable cross-Demand claim reserving one stable logical window for one exact prepared Target Delivery and intended Claim event transition.\",\"$comment\":\"This is a non-expiring business coordination claim, not a process mutex or time lease. Historical implementation claims omit workType; a Test claim writes workType=test and binds the exact logical Test attempt plus target-facing packet digest. It contains no raw handle, host effect, send/readback result, retry permission, or acceptance decision.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"claimId\",\"programId\",\"target\",\"route\",\"hostObservation\",\"claimTransition\",\"claimedAt\",\"claimDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowWindowWorkClaim\"},\"schemaVersion\":{\"const\":1},\"claimId\":{\"$ref\":\"#/$defs/claimId\"},\"programId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/programId\"},\"target\":{\"oneOf\":[{\"$ref\":\"#/$defs/implementationTarget\"},{\"$ref\":\"#/$defs/testTarget\"}]},\"route\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"hostId\",\"windowId\",\"bindingId\"],\"properties\":{\"hostId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:host-binding:v1#/properties/hostId\"},\"windowId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:host-binding:v1#/properties/windowId\"},\"bindingId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:host-binding:v1#/properties/bindingId\"}}},\"hostObservation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"authorityDigest\",\"observedAt\"],\"properties\":{\"authorityDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"observedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"}}},\"claimTransition\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"commitId\",\"eventId\",\"expectedStreamRevision\",\"expectedStateDigest\"],\"properties\":{\"commitId\":{\"$ref\":\"#/$defs/commitId\"},\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"expectedStreamRevision\":{\"type\":\"integer\",\"minimum\":3,\"maximum\":9007199254740991},\"expectedStateDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"claimedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"claimDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}},\"$defs\":{\"implementationTarget\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"demandId\",\"targetTaskId\",\"targetDeliveryId\",\"intentDigest\",\"intentPreparedAt\"],\"properties\":{\"demandId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/demandId\"},\"targetTaskId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/targetTaskId\"},\"targetDeliveryId\":{\"$ref\":\"urn:wakeflow:governance:delivery:target-delivery-intent:v1#/properties/targetDeliveryId\"},\"intentDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"intentPreparedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"}}},\"testTarget\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"demandId\",\"targetTaskId\",\"targetDeliveryId\",\"intentDigest\",\"intentPreparedAt\",\"workType\",\"testAttemptId\",\"testDispatchPacketDigest\"],\"properties\":{\"demandId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/demandId\"},\"targetTaskId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/targetTaskId\"},\"targetDeliveryId\":{\"$ref\":\"urn:wakeflow:governance:delivery:target-delivery-intent:v1#/properties/targetDeliveryId\"},\"intentDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"intentPreparedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"workType\":{\"const\":\"test\"},\"testAttemptId\":{\"$ref\":\"urn:wakeflow:governance:testing:test-execution-attempt:v1#/properties/testAttemptId\"},\"testDispatchPacketDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"claimId\":{\"type\":\"string\",\"pattern\":\"^window_work_claim_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}");
