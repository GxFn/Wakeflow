/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/delivery/delivery-envelope.schema.json
 */

/**
 * 一次投递的不可变信封：任务包入口、当前绑定代际、可移植 prompt 与最终 prompt 摘要、围栏令牌；实现与 test 两类任务共用。
 */
export type WakeflowDeliveryEnvelope = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowDeliveryEnvelope"
schemaVersion: 1
deliveryId: DeliveryId
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
export type DeliveryId = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string
export type ClaimId = string
export type TargetReviewDecisionId = string
export type TargetResultId = string
export type ReworkRationaleSummary = string
export type ReworkMethodSummary = string
export type ReworkObservationSummary = string
export type ProductDefectRemediationId = string
export type RemediationSummary = string
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

export interface Fence {
claimId: ClaimId
claimDigest: WakeflowSha256DigestText
expectedStreamRevision: number
}
export interface Rework {
decision: {
targetReviewDecisionId: TargetReviewDecisionId
decisionDigest: WakeflowSha256DigestText
}
previousResult: {
targetResultId: TargetResultId
resultDigest: WakeflowSha256DigestText
}
rationaleSummary: ReworkRationaleSummary
/**
 * @minItems 1
 * @maxItems 32
 */
requiredCorrections: [RequiredCorrection, ...(RequiredCorrection)[]]
}
export interface RequiredCorrection {
checkId: string
outcome: ("failed" | "inconclusive")
methodSummary: ReworkMethodSummary
observationSummary: ReworkObservationSummary
}
export interface ProductDefectRemediation {
authorization: {
productDefectRemediationId: ProductDefectRemediationId
authorizationDigest: WakeflowSha256DigestText
}
testReviewDecision: {
targetReviewDecisionId: TargetReviewDecisionId
decisionDigest: WakeflowSha256DigestText
}
previousResult: {
targetResultId: TargetResultId
resultDigest: WakeflowSha256DigestText
}
authorizationRationaleSummary: RemediationSummary
correctionObjectiveSummary: RemediationSummary
/**
 * @minItems 1
 * @maxItems 20
 */
requiredCorrections: [ProductDefectRequiredCorrection]|[ProductDefectRequiredCorrection, ProductDefectRequiredCorrection]|[ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection]|[ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection]|[ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection]|[ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection]|[ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection]|[ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection]|[ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection]|[ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection]|[ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection]|[ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection]|[ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection]|[ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection]|[ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection]|[ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection]|[ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection]|[ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection]|[ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection]|[ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection, ProductDefectRequiredCorrection]
}
export interface ProductDefectRequiredCorrection {
stepId: string
observedSummary: ReworkObservationSummary
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
stepIds: (null | [string]|[string, string]|[string, string, string]|[string, string, string, string]|[string, string, string, string, string]|[string, string, string, string, string, string]|[string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string])
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
export const WAKEFLOW_DELIVERY_ENVELOPE_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:delivery:delivery-envelope:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DELIVERY_ENVELOPE_SCHEMA\",\"title\":\"WakeflowDeliveryEnvelope\",\"description\":\"一次投递的不可变信封：任务包入口、当前绑定代际、可移植 prompt 与最终 prompt 摘要、围栏令牌；实现与 test 两类任务共用。\",\"$comment\":\"事件流是权威。信封不含原始句柄、不含发送结果、不含验收判断；最终 prompt 由可移植 prompt 加工作区根派生，promptDigest 覆盖去除首尾空白后的最终文本，宿主 UserPromptSubmit 记录以此为落地证据。rework 与 productDefectRemediation 互斥且只属于实现包；attempt 只属于 test 包。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"deliveryId\",\"programId\",\"configDigest\",\"demandId\",\"workType\",\"target\",\"route\",\"language\",\"portablePrompt\",\"promptDigest\",\"fence\",\"preparedAt\",\"envelopeDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowDeliveryEnvelope\"},\"schemaVersion\":{\"const\":1},\"deliveryId\":{\"$ref\":\"#/$defs/deliveryId\"},\"programId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/programId\"},\"configDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"demandId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/demandId\"},\"workType\":{\"enum\":[\"implementation\",\"test\"]},\"target\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetTaskId\",\"taskPackageId\",\"taskPackageRef\",\"taskPackageDigest\"],\"properties\":{\"targetTaskId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/targetTaskId\"},\"taskPackageId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/taskPackageId\"},\"taskPackageRef\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"taskPackageDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"route\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"hostId\",\"windowId\",\"bindingId\",\"bindingDigest\"],\"properties\":{\"hostId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:host-binding:v1#/properties/hostId\"},\"windowId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:host-binding:v1#/properties/windowId\"},\"bindingId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:host-binding:v1#/properties/bindingId\"},\"bindingDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"language\":{\"enum\":[\"en\",\"zh-Hans\"]},\"portablePrompt\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":65536,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"promptDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"fence\":{\"$ref\":\"#/$defs/fence\"},\"rework\":{\"$ref\":\"#/$defs/rework\"},\"productDefectRemediation\":{\"$ref\":\"#/$defs/productDefectRemediation\"},\"attempt\":{\"$ref\":\"urn:wakeflow:governance:testing:test-execution-attempt:v1\"},\"preparedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"envelopeDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}},\"allOf\":[{\"if\":{\"properties\":{\"workType\":{\"const\":\"test\"}},\"required\":[\"workType\"]},\"then\":{\"required\":[\"attempt\"],\"properties\":{\"attempt\":{\"$ref\":\"urn:wakeflow:governance:testing:test-execution-attempt:v1\"},\"rework\":false,\"productDefectRemediation\":false}},\"else\":{\"properties\":{\"attempt\":false}}},{\"not\":{\"required\":[\"rework\",\"productDefectRemediation\"]}}],\"$defs\":{\"deliveryId\":{\"type\":\"string\",\"pattern\":\"^target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"claimId\":{\"type\":\"string\",\"pattern\":\"^work-claim_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"fence\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"claimId\",\"claimDigest\",\"expectedStreamRevision\"],\"properties\":{\"claimId\":{\"$ref\":\"#/$defs/claimId\"},\"claimDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"expectedStreamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991}}},\"targetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetResultId\":{\"type\":\"string\",\"pattern\":\"^target-result_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"productDefectRemediationId\":{\"type\":\"string\",\"pattern\":\"^product-defect-remediation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"rework\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"decision\",\"previousResult\",\"rationaleSummary\",\"requiredCorrections\"],\"properties\":{\"decision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetReviewDecisionId\",\"decisionDigest\"],\"properties\":{\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"decisionDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"previousResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetResultId\",\"resultDigest\"],\"properties\":{\"targetResultId\":{\"$ref\":\"#/$defs/targetResultId\"},\"resultDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"rationaleSummary\":{\"$ref\":\"#/$defs/reworkRationaleSummary\"},\"requiredCorrections\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/requiredCorrection\"},\"contains\":{\"type\":\"object\",\"properties\":{\"outcome\":{\"const\":\"failed\"}},\"required\":[\"outcome\"]},\"minContains\":1}}},\"productDefectRemediation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"authorization\",\"testReviewDecision\",\"previousResult\",\"authorizationRationaleSummary\",\"correctionObjectiveSummary\",\"requiredCorrections\"],\"properties\":{\"authorization\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"productDefectRemediationId\",\"authorizationDigest\"],\"properties\":{\"productDefectRemediationId\":{\"$ref\":\"#/$defs/productDefectRemediationId\"},\"authorizationDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"testReviewDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetReviewDecisionId\",\"decisionDigest\"],\"properties\":{\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"decisionDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"previousResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetResultId\",\"resultDigest\"],\"properties\":{\"targetResultId\":{\"$ref\":\"#/$defs/targetResultId\"},\"resultDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"authorizationRationaleSummary\":{\"$ref\":\"#/$defs/remediationSummary\"},\"correctionObjectiveSummary\":{\"$ref\":\"#/$defs/remediationSummary\"},\"requiredCorrections\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":20,\"items\":{\"$ref\":\"#/$defs/productDefectRequiredCorrection\"}}}},\"requiredCorrection\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"checkId\",\"outcome\",\"methodSummary\",\"observationSummary\"],\"properties\":{\"checkId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"outcome\":{\"enum\":[\"failed\",\"inconclusive\"]},\"methodSummary\":{\"$ref\":\"#/$defs/reworkMethodSummary\"},\"observationSummary\":{\"$ref\":\"#/$defs/reworkObservationSummary\"}}},\"productDefectRequiredCorrection\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"stepId\",\"observedSummary\"],\"properties\":{\"stepId\":{\"type\":\"string\",\"pattern\":\"^ts-[1-9][0-9]?$\"},\"observedSummary\":{\"$ref\":\"#/$defs/reworkObservationSummary\"}}},\"reworkRationaleSummary\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":1024,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"reworkMethodSummary\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":512,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"reworkObservationSummary\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":1024,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"remediationSummary\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":1024,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"}}}");
