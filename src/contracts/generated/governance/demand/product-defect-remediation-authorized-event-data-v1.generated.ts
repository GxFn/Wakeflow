/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/product-defect-remediation-authorized-event-data-v1.schema.json
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
 * review.product-defect-remediation-authorized.v1 的严格事件数据。
 */
export interface WakeflowProductDefectRemediationAuthorizedEventDataV1 {
authorization: WakeflowControllerProductDefectRemediationAuthorization
}
/**
 * Controller把一份精确Test产品缺陷结论映射到原TaskPackage边界内产品返工的不可变授权。
 */
export interface WakeflowControllerProductDefectRemediationAuthorization {
kind: "WakeflowControllerProductDefectRemediationAuthorization"
schemaVersion: 1
productDefectRemediationId: string
programId: string
demandId: string
controllerWindowId: string
source: Source
/**
 * @minItems 1
 * @maxItems 32
 */
failedChecks: [FailedCheck, ...(FailedCheck)[]]
/**
 * @minItems 1
 * @maxItems 10000
 */
affectedTargets: [AffectedTarget, ...(AffectedTarget)[]]
boundary: "existing-task-packages-only"
authorizationRationale: string
authorizedAt: WakeflowUtcInstantText
authorizationDigest: WakeflowSha256DigestText
}
export interface Source {
postAcceptanceRouteDigest: WakeflowSha256DigestText
reviewSnapshotDigest: WakeflowSha256DigestText
stateDigest: WakeflowSha256DigestText
streamRevision: number
testTargetTaskId: string
testCard: {
testCardId: string
testCardDigest: WakeflowSha256DigestText
}
testAttemptId: string
testDispatchPacketDigest: WakeflowSha256DigestText
targetResult: {
targetResultId: string
resultDigest: WakeflowSha256DigestText
}
testReviewDecision: {
targetReviewDecisionId: string
decisionDigest: WakeflowSha256DigestText
decidedAt: WakeflowUtcInstantText
}
}
export interface FailedCheck {
checkId: string
outcome: "failed"
method: string
observation: string
}
export interface AffectedTarget {
baseline: ImplementationBaseline
/**
 * @minItems 1
 * @maxItems 32
 */
failedCheckIds: [string, ...(string)[]]
correctionObjective: string
}
export interface ImplementationBaseline {
targetTaskId: string
taskPackageId: string
taskPackageDigest: WakeflowSha256DigestText
repositoryId: string
windowId: string
targetResultId: string
resultDigest: WakeflowSha256DigestText
targetReviewDecisionId: string
decisionDigest: WakeflowSha256DigestText
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
export const WAKEFLOW_PRODUCT_DEFECT_REMEDIATION_AUTHORIZED_EVENT_DATA_V1_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:product-defect-remediation-authorized-event-data:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_PRODUCT_DEFECT_REMEDIATION_AUTHORIZED_EVENT_DATA_V1_SCHEMA\",\"title\":\"WakeflowProductDefectRemediationAuthorizedEventDataV1\",\"description\":\"review.product-defect-remediation-authorized.v1 的严格事件数据。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"authorization\"],\"properties\":{\"authorization\":{\"$ref\":\"urn:wakeflow:governance:review:controller-product-defect-remediation-authorization:v1\"}}}");
