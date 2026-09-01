/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/delivery/target-delivery-intent.schema.json
 */

/**
 * Immutable event-carried intent for delivering one TaskPackage attempt to one exact current host binding without performing the host effect.
 */
export type WakeflowTargetDeliveryIntent = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowTargetDeliveryIntent"
schemaVersion: 1
targetDeliveryId: TargetDeliveryId
programId: string
configDigest: WakeflowSha256DigestText
demandId: string
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
}
language: ("en" | "zh-Hans")
portablePrompt: string
rework?: Rework
productDefectRemediation?: ProductDefectRemediation
preparedAt: WakeflowUtcInstantText
intentDigest: WakeflowSha256DigestText
})
export type TargetDeliveryId = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string
export type TargetReviewDecisionId = string
export type TargetResultId = string
export type ReworkRationaleSummary = string
export type ReworkMethodSummary = string
export type ReworkObservationSummary = string
export type ProductDefectRemediationId = string
export type RemediationSummary = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string

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
 * @maxItems 32
 */
requiredCorrections: [ProductDefectRequiredCorrection, ...(ProductDefectRequiredCorrection)[]]
}
export interface ProductDefectRequiredCorrection {
checkId: string
outcome: "failed"
methodSummary: ReworkMethodSummary
observationSummary: ReworkObservationSummary
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
export const WAKEFLOW_TARGET_DELIVERY_INTENT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:delivery:target-delivery-intent:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TARGET_DELIVERY_INTENT_SCHEMA\",\"title\":\"WakeflowTargetDeliveryIntent\",\"description\":\"Immutable event-carried intent for delivering one TaskPackage attempt to one exact current host binding without performing the host effect.\",\"$comment\":\"The Demand event stream is authority. Absence of both execution-source fields means initial; rework binds an Implementation Review rework Decision; productDefectRemediation binds a Controller remediation Authorization. The two source fields are mutually exclusive. The intent contains no raw host handle, claim, send result, readback, retry permission, or acceptance decision.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"targetDeliveryId\",\"programId\",\"configDigest\",\"demandId\",\"target\",\"route\",\"language\",\"portablePrompt\",\"preparedAt\",\"intentDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTargetDeliveryIntent\"},\"schemaVersion\":{\"const\":1},\"targetDeliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"},\"programId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/programId\"},\"configDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"demandId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/demandId\"},\"target\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetTaskId\",\"taskPackageId\",\"taskPackageRef\",\"taskPackageDigest\"],\"properties\":{\"targetTaskId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/targetTaskId\"},\"taskPackageId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/taskPackageId\"},\"taskPackageRef\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"taskPackageDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"route\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"hostId\",\"windowId\",\"bindingId\"],\"properties\":{\"hostId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:host-binding:v1#/properties/hostId\"},\"windowId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:host-binding:v1#/properties/windowId\"},\"bindingId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:host-binding:v1#/properties/bindingId\"}}},\"language\":{\"enum\":[\"en\",\"zh-Hans\"]},\"portablePrompt\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":32768,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"rework\":{\"$ref\":\"#/$defs/rework\"},\"productDefectRemediation\":{\"$ref\":\"#/$defs/productDefectRemediation\"},\"preparedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"intentDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}},\"allOf\":[{\"not\":{\"type\":\"object\",\"properties\":{\"rework\":{},\"productDefectRemediation\":{}},\"required\":[\"rework\",\"productDefectRemediation\"]}}],\"$defs\":{\"targetDeliveryId\":{\"type\":\"string\",\"pattern\":\"^target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetResultId\":{\"type\":\"string\",\"pattern\":\"^target-result_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"productDefectRemediationId\":{\"type\":\"string\",\"pattern\":\"^product-defect-remediation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"rework\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"decision\",\"previousResult\",\"rationaleSummary\",\"requiredCorrections\"],\"properties\":{\"decision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetReviewDecisionId\",\"decisionDigest\"],\"properties\":{\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"decisionDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"previousResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetResultId\",\"resultDigest\"],\"properties\":{\"targetResultId\":{\"$ref\":\"#/$defs/targetResultId\"},\"resultDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"rationaleSummary\":{\"$ref\":\"#/$defs/reworkRationaleSummary\"},\"requiredCorrections\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/requiredCorrection\"},\"contains\":{\"type\":\"object\",\"properties\":{\"outcome\":{\"const\":\"failed\"}},\"required\":[\"outcome\"]},\"minContains\":1}}},\"productDefectRemediation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"authorization\",\"testReviewDecision\",\"previousResult\",\"authorizationRationaleSummary\",\"correctionObjectiveSummary\",\"requiredCorrections\"],\"properties\":{\"authorization\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"productDefectRemediationId\",\"authorizationDigest\"],\"properties\":{\"productDefectRemediationId\":{\"$ref\":\"#/$defs/productDefectRemediationId\"},\"authorizationDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"testReviewDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetReviewDecisionId\",\"decisionDigest\"],\"properties\":{\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"decisionDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"previousResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetResultId\",\"resultDigest\"],\"properties\":{\"targetResultId\":{\"$ref\":\"#/$defs/targetResultId\"},\"resultDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"authorizationRationaleSummary\":{\"$ref\":\"#/$defs/remediationSummary\"},\"correctionObjectiveSummary\":{\"$ref\":\"#/$defs/remediationSummary\"},\"requiredCorrections\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/productDefectRequiredCorrection\"}}}},\"requiredCorrection\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"checkId\",\"outcome\",\"methodSummary\",\"observationSummary\"],\"properties\":{\"checkId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"outcome\":{\"enum\":[\"failed\",\"inconclusive\"]},\"methodSummary\":{\"$ref\":\"#/$defs/reworkMethodSummary\"},\"observationSummary\":{\"$ref\":\"#/$defs/reworkObservationSummary\"}}},\"productDefectRequiredCorrection\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"checkId\",\"outcome\",\"methodSummary\",\"observationSummary\"],\"properties\":{\"checkId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"outcome\":{\"const\":\"failed\"},\"methodSummary\":{\"$ref\":\"#/$defs/reworkMethodSummary\"},\"observationSummary\":{\"$ref\":\"#/$defs/reworkObservationSummary\"}}},\"reworkRationaleSummary\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":1024,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"reworkMethodSummary\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"reworkObservationSummary\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":256,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"remediationSummary\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":1024,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"}}}");
