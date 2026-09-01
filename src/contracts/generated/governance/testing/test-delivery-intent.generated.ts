/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/testing/test-delivery-intent.schema.json
 */

export type TargetDeliveryId = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string
/**
 * Controller为一次真实环境Test执行授权的逻辑attempt。
 */
export type WakeflowTestExecutionAttempt = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowTestExecutionAttempt"
schemaVersion: 1
testAttemptId: string
targetTaskId: string
testCard: TestCardTuple
ordinal: number
mode: ("initial" | "rerun")
environmentSetup: EnvironmentSetup
rerunSource?: RerunSource
})
export type ClaimId = string
export type EventId = string
export type CommitId = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string

/**
 * 把一份Test TaskPackage和同一logical Test attempt授权给精确Test窗口Binding的不可变Intent。
 */
export interface WakeflowTestDeliveryIntent {
kind: "WakeflowTestDeliveryIntent"
schemaVersion: 1
targetDeliveryId: TargetDeliveryId
programId: string
configDigest: WakeflowSha256DigestText
demandId: string
target: Target
route: Route
attempt: WakeflowTestExecutionAttempt
replacement?: Replacement
language: ("en" | "zh-Hans")
preparedAt: WakeflowUtcInstantText
intentDigest: WakeflowSha256DigestText
}
export interface Target {
targetTaskId: string
taskPackageId: string
taskPackageRef: WakeflowPortableResourcePathText
taskPackageDigest: WakeflowSha256DigestText
testCard: TestCardTuple
}
export interface TestCardTuple {
testCardId: string
testCardDigest: WakeflowSha256DigestText
}
export interface Route {
hostId: ("codex" | "claude-code")
windowId: string
bindingId: string
}
export interface EnvironmentSetup {
policy: ("fresh-once" | "fresh-per-attempt" | "reuse-existing")
directive: ("prepare-fresh-environment" | "reuse-confirmed-environment")
}
export interface RerunSource {
previousAttemptId: string
previousResult: {
targetResultId: string
resultDigest: WakeflowSha256DigestText
}
reviewDecision: {
targetReviewDecisionId: string
decisionDigest: WakeflowSha256DigestText
}
}
export interface Replacement {
kind: "rejected-before-effect"
authorizationOrdinal: number
previousDelivery: {
targetDeliveryId: TargetDeliveryId
intentDigest: WakeflowSha256DigestText
testDispatchPacketDigest: WakeflowSha256DigestText
}
rejectedHostEffect: {
claimId: ClaimId
claimDigest: WakeflowSha256DigestText
claimEventId: EventId
claimCommitId: CommitId
observationDigest: WakeflowSha256DigestText
observedAt: WakeflowUtcInstantText
}
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
export const WAKEFLOW_TEST_DELIVERY_INTENT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:testing:test-delivery-intent:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TEST_DELIVERY_INTENT_SCHEMA\",\"title\":\"WakeflowTestDeliveryIntent\",\"description\":\"把一份Test TaskPackage和同一logical Test attempt授权给精确Test窗口Binding的不可变Intent。\",\"$comment\":\"省略replacement表示initial authorization；存在replacement时只允许替换一个已证明rejected-before-effect的host delivery，不创建新Test attempt。Intent不执行环境准备、不创建packet/envelope、不取得WindowWorkClaim、不发送宿主消息，也不保存prompt、raw handle或Test结果。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"targetDeliveryId\",\"programId\",\"configDigest\",\"demandId\",\"target\",\"route\",\"attempt\",\"language\",\"preparedAt\",\"intentDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTestDeliveryIntent\"},\"schemaVersion\":{\"const\":1},\"targetDeliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"},\"programId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/programId\"},\"configDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"demandId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/demandId\"},\"target\":{\"$ref\":\"#/$defs/target\"},\"route\":{\"$ref\":\"#/$defs/route\"},\"attempt\":{\"$ref\":\"urn:wakeflow:governance:testing:test-execution-attempt:v1\"},\"replacement\":{\"$ref\":\"#/$defs/replacement\"},\"language\":{\"enum\":[\"en\",\"zh-Hans\"]},\"preparedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"intentDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}},\"$defs\":{\"targetDeliveryId\":{\"type\":\"string\",\"pattern\":\"^target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"target\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetTaskId\",\"taskPackageId\",\"taskPackageRef\",\"taskPackageDigest\",\"testCard\"],\"properties\":{\"targetTaskId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/targetTaskId\"},\"taskPackageId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/taskPackageId\"},\"taskPackageRef\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"taskPackageDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"testCard\":{\"$ref\":\"urn:wakeflow:governance:testing:test-execution-attempt:v1#/$defs/testCardTuple\"}}},\"route\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"hostId\",\"windowId\",\"bindingId\"],\"properties\":{\"hostId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:host-binding:v1#/properties/hostId\"},\"windowId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:host-binding:v1#/properties/windowId\"},\"bindingId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:host-binding:v1#/properties/bindingId\"}}},\"claimId\":{\"type\":\"string\",\"pattern\":\"^window_work_claim_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"replacement\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"authorizationOrdinal\",\"previousDelivery\",\"rejectedHostEffect\"],\"properties\":{\"kind\":{\"const\":\"rejected-before-effect\"},\"authorizationOrdinal\":{\"type\":\"integer\",\"minimum\":2,\"maximum\":32},\"previousDelivery\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetDeliveryId\",\"intentDigest\",\"testDispatchPacketDigest\"],\"properties\":{\"targetDeliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"},\"intentDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"testDispatchPacketDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"rejectedHostEffect\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"claimId\",\"claimDigest\",\"claimEventId\",\"claimCommitId\",\"observationDigest\",\"observedAt\"],\"properties\":{\"claimId\":{\"$ref\":\"#/$defs/claimId\"},\"claimDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"claimEventId\":{\"$ref\":\"#/$defs/eventId\"},\"claimCommitId\":{\"$ref\":\"#/$defs/commitId\"},\"observationDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"observedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"}}}}}}}");
