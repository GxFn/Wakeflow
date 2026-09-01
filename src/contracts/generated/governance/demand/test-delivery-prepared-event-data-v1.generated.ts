/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/test-delivery-prepared-event-data-v1.schema.json
 */

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
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string

/**
 * testing.test-delivery-prepared persisted event v1的严格payload。
 */
export interface WakeflowTestDeliveryPreparedEventDataV1 {
intent: WakeflowTestDeliveryIntent
}
/**
 * 把一份Test TaskPackage和同一logical Test attempt授权给精确Test窗口Binding的不可变Intent。
 */
export interface WakeflowTestDeliveryIntent {
kind: "WakeflowTestDeliveryIntent"
schemaVersion: 1
targetDeliveryId: string
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
targetDeliveryId: string
intentDigest: WakeflowSha256DigestText
testDispatchPacketDigest: WakeflowSha256DigestText
}
rejectedHostEffect: {
claimId: string
claimDigest: WakeflowSha256DigestText
claimEventId: string
claimCommitId: string
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
export const WAKEFLOW_TEST_DELIVERY_PREPARED_EVENT_DATA_V1_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-sourcing:test-delivery-prepared-data:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TEST_DELIVERY_PREPARED_EVENT_DATA_V1_SCHEMA\",\"title\":\"WakeflowTestDeliveryPreparedEventDataV1\",\"description\":\"testing.test-delivery-prepared persisted event v1的严格payload。\",\"$comment\":\"完整TaskPackage与TestCard继续由各自先前Event拥有；本Event只保存已验证TestDeliveryIntent。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"intent\"],\"properties\":{\"intent\":{\"$ref\":\"urn:wakeflow:governance:testing:test-delivery-intent:v1\"}}}");
