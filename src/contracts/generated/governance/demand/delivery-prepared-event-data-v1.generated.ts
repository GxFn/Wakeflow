/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/delivery-prepared-event-data-v1.schema.json
 */

/**
 * 一次投递的不可变信封：任务包入口、当前绑定代际、可移植 prompt 与最终 prompt 摘要、围栏令牌；实现与 test 两类任务共用。
 */
export type WakeflowDeliveryEnvelope = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowDeliveryEnvelope"
schemaVersion: 1
deliveryId: string
programId: string
configDigest: WakeflowSha256DigestText
demandId: string
workType: ("implementation" | "test")
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
bindingDigest: WakeflowSha256DigestText
}
language: ("en" | "zh-Hans")
portablePrompt: string
promptDigest: WakeflowSha256DigestText
fence: Fence
rework?: Rework
productDefectRemediation?: ProductDefectRemediation
attempt?: WakeflowTestExecutionAttempt
preparedAt: WakeflowUtcInstantText
envelopeDigest: WakeflowSha256DigestText
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
 * Controller为一次真实环境Test执行授权的逻辑attempt。
 */
export type WakeflowTestExecutionAttempt = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowTestExecutionAttempt"
schemaVersion: 1
testAttemptId: string
targetTaskId: string
ordinal: number
mode: ("initial" | "rerun")
environmentSetup: EnvironmentSetup
rerunSource?: RerunSource
contract: Contract
})
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string

/**
 * `delivery.delivery-prepared` 事件的数据：一份投递信封。
 */
export interface WakeflowDeliveryPreparedEventDataV1 {
envelope: WakeflowDeliveryEnvelope
}
export interface Fence {
claimId: string
claimDigest: WakeflowSha256DigestText
expectedStreamRevision: number
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
export interface Contract {
taskPackageId: string
taskPackageDigest: WakeflowSha256DigestText
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
export const WAKEFLOW_DELIVERY_PREPARED_EVENT_DATA_V1_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-sourcing:delivery-prepared-data:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DELIVERY_PREPARED_EVENT_DATA_V1_SCHEMA\",\"title\":\"WakeflowDeliveryPreparedEventDataV1\",\"description\":\"`delivery.delivery-prepared` 事件的数据：一份投递信封。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"envelope\"],\"properties\":{\"envelope\":{\"$ref\":\"urn:wakeflow:governance:delivery:delivery-envelope:v1\"}}}");
