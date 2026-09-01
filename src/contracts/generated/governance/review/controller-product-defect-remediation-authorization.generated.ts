/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/review/controller-product-defect-remediation-authorization.schema.json
 */

export type ProductDefectRemediationId = string
export type ProgramId = string
export type DemandId = string
export type WindowId = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
export type TargetTaskId = string
export type TestCardId = string
export type TestAttemptId = string
export type TargetResultId = string
export type TargetReviewDecisionId = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
export type CheckId = string
export type HumanText = string
export type TaskPackageId = string
export type RepositoryId = string

/**
 * Controller把一份精确Test产品缺陷结论映射到原TaskPackage边界内产品返工的不可变授权。
 */
export interface WakeflowControllerProductDefectRemediationAuthorization {
kind: "WakeflowControllerProductDefectRemediationAuthorization"
schemaVersion: 1
productDefectRemediationId: ProductDefectRemediationId
programId: ProgramId
demandId: DemandId
controllerWindowId: WindowId
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
authorizationRationale: HumanText
authorizedAt: WakeflowUtcInstantText
authorizationDigest: WakeflowSha256DigestText
}
export interface Source {
postAcceptanceRouteDigest: WakeflowSha256DigestText
reviewSnapshotDigest: WakeflowSha256DigestText
stateDigest: WakeflowSha256DigestText
streamRevision: number
testTargetTaskId: TargetTaskId
testCard: {
testCardId: TestCardId
testCardDigest: WakeflowSha256DigestText
}
testAttemptId: TestAttemptId
testDispatchPacketDigest: WakeflowSha256DigestText
targetResult: {
targetResultId: TargetResultId
resultDigest: WakeflowSha256DigestText
}
testReviewDecision: {
targetReviewDecisionId: TargetReviewDecisionId
decisionDigest: WakeflowSha256DigestText
decidedAt: WakeflowUtcInstantText
}
}
export interface FailedCheck {
checkId: CheckId
outcome: "failed"
method: HumanText
observation: HumanText
}
export interface AffectedTarget {
baseline: ImplementationBaseline
/**
 * @minItems 1
 * @maxItems 32
 */
failedCheckIds: [CheckId, ...(CheckId)[]]
correctionObjective: HumanText
}
export interface ImplementationBaseline {
targetTaskId: TargetTaskId
taskPackageId: TaskPackageId
taskPackageDigest: WakeflowSha256DigestText
repositoryId: RepositoryId
windowId: WindowId
targetResultId: TargetResultId
resultDigest: WakeflowSha256DigestText
targetReviewDecisionId: TargetReviewDecisionId
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
export const WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_AUTHORIZATION_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:review:controller-product-defect-remediation-authorization:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_AUTHORIZATION_SCHEMA\",\"title\":\"WakeflowControllerProductDefectRemediationAuthorization\",\"description\":\"Controller把一份精确Test产品缺陷结论映射到原TaskPackage边界内产品返工的不可变授权。\",\"$comment\":\"Authorization只确定受影响Implementation baseline、失败检查映射与修复目标；它不修改Aggregate、不创建Delivery、不授予跨TaskPackage或redesign权限。后续Event Stream append与expected revision负责状态转换和幂等。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"productDefectRemediationId\",\"programId\",\"demandId\",\"controllerWindowId\",\"source\",\"failedChecks\",\"affectedTargets\",\"boundary\",\"authorizationRationale\",\"authorizedAt\",\"authorizationDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowControllerProductDefectRemediationAuthorization\"},\"schemaVersion\":{\"const\":1},\"productDefectRemediationId\":{\"$ref\":\"#/$defs/productDefectRemediationId\"},\"programId\":{\"$ref\":\"#/$defs/programId\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"controllerWindowId\":{\"$ref\":\"#/$defs/windowId\"},\"source\":{\"$ref\":\"#/$defs/source\"},\"failedChecks\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/failedCheck\"}},\"affectedTargets\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":10000,\"items\":{\"$ref\":\"#/$defs/affectedTarget\"}},\"boundary\":{\"const\":\"existing-task-packages-only\"},\"authorizationRationale\":{\"$ref\":\"#/$defs/humanText\"},\"authorizedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"authorizationDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}},\"$defs\":{\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"productDefectRemediationId\":{\"type\":\"string\",\"pattern\":\"^product-defect-remediation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"taskPackageId\":{\"type\":\"string\",\"pattern\":\"^task-package_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"testCardId\":{\"type\":\"string\",\"pattern\":\"^test-card_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"testAttemptId\":{\"type\":\"string\",\"pattern\":\"^test-attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetResultId\":{\"type\":\"string\",\"pattern\":\"^target-result_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"source\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"postAcceptanceRouteDigest\",\"reviewSnapshotDigest\",\"stateDigest\",\"streamRevision\",\"testTargetTaskId\",\"testCard\",\"testAttemptId\",\"testDispatchPacketDigest\",\"targetResult\",\"testReviewDecision\"],\"properties\":{\"postAcceptanceRouteDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"reviewSnapshotDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"stateDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"testTargetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"testCard\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"testCardId\",\"testCardDigest\"],\"properties\":{\"testCardId\":{\"$ref\":\"#/$defs/testCardId\"},\"testCardDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"testAttemptId\":{\"$ref\":\"#/$defs/testAttemptId\"},\"testDispatchPacketDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"targetResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetResultId\",\"resultDigest\"],\"properties\":{\"targetResultId\":{\"$ref\":\"#/$defs/targetResultId\"},\"resultDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"testReviewDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetReviewDecisionId\",\"decisionDigest\",\"decidedAt\"],\"properties\":{\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"decisionDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"decidedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"}}}}},\"failedCheck\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"checkId\",\"outcome\",\"method\",\"observation\"],\"properties\":{\"checkId\":{\"$ref\":\"#/$defs/checkId\"},\"outcome\":{\"const\":\"failed\"},\"method\":{\"$ref\":\"#/$defs/humanText\"},\"observation\":{\"$ref\":\"#/$defs/humanText\"}}},\"affectedTarget\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"baseline\",\"failedCheckIds\",\"correctionObjective\"],\"properties\":{\"baseline\":{\"$ref\":\"#/$defs/implementationBaseline\"},\"failedCheckIds\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/checkId\"}},\"correctionObjective\":{\"$ref\":\"#/$defs/humanText\"}}},\"implementationBaseline\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetTaskId\",\"taskPackageId\",\"taskPackageDigest\",\"repositoryId\",\"windowId\",\"targetResultId\",\"resultDigest\",\"targetReviewDecisionId\",\"decisionDigest\"],\"properties\":{\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"taskPackageId\":{\"$ref\":\"#/$defs/taskPackageId\"},\"taskPackageDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"targetResultId\":{\"$ref\":\"#/$defs/targetResultId\"},\"resultDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"decisionDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"checkId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"humanText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"}}}");
