/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-controller-product-defect-remediation-request.schema.json
 */

/**
 * Absolute path of the existing Wakeflow workspace root.
 */
export type WorkspaceRoot = string
export type DemandId = string
export type TargetReviewDecisionId = string
export type Sha256Digest = string
export type TargetTaskId = string
export type CheckId = string
export type HumanText = string

/**
 * Closed Controller-authored command for authorizing product remediation from one current product-defect Test Review Decision.
 */
export interface WakeflowControllerProductDefectRemediationRequestV1 {
root: WorkspaceRoot
demandId: DemandId
testReviewDecisionId: TargetReviewDecisionId
postAcceptanceRouteDigest: Sha256Digest
/**
 * @minItems 1
 * @maxItems 10000
 */
affectedTargets: [AffectedTargetRequest, ...(AffectedTargetRequest)[]]
authorizationRationale: HumanText
}
export interface AffectedTargetRequest {
targetTaskId: TargetTaskId
/**
 * @minItems 1
 * @maxItems 32
 */
failedCheckIds: [CheckId, ...(CheckId)[]]
correctionObjective: HumanText
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
export const WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:controller-product-defect-remediation-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_REQUEST_SCHEMA\",\"title\":\"WakeflowControllerProductDefectRemediationRequestV1\",\"description\":\"Closed Controller-authored command for authorizing product remediation from one current product-defect Test Review Decision.\",\"$comment\":\"The caller selects only affected existing product targets, failed-check mappings, and correction objectives. Wakeflow derives the Test target, TestCard baselines, Result/Decision lineage, Controller identity, Event position, Authorization/Event/Commit identity, and authorization time.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"demandId\",\"testReviewDecisionId\",\"postAcceptanceRouteDigest\",\"affectedTargets\",\"authorizationRationale\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"testReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"postAcceptanceRouteDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"affectedTargets\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":10000,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/affectedTargetRequest\"}},\"authorizationRationale\":{\"$ref\":\"#/$defs/humanText\"}},\"$defs\":{\"workspaceRoot\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"checkId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"humanText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"affectedTargetRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetTaskId\",\"failedCheckIds\",\"correctionObjective\"],\"properties\":{\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"failedCheckIds\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/checkId\"}},\"correctionObjective\":{\"$ref\":\"#/$defs/humanText\"}}}}}");
