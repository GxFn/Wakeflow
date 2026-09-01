/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/controller-target-review-decided-event-data-v1.schema.json
 */

/**
 * Controller基于精确Result Review Snapshot作出的单implementation Target审查决定。
 */
export type WakeflowControllerImplementationReviewDecision = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowControllerImplementationReviewDecision"
schemaVersion: 1
targetReviewDecisionId: string
programId: string
demandId: string
targetTaskId: string
controllerWindowId: string
reviewed: Reviewed
decision: ("accept" | "blocked" | "redesign" | "rework")
assessment: Assessment
/**
 * @minItems 1
 * @maxItems 32
 */
independentChecks: [IndependentCheck, ...(IndependentCheck)[]]
rationale: string
blockingReasons: TextList
residualRisks: TextList
decidedAt: WakeflowUtcInstantText
decisionDigest: WakeflowSha256DigestText
})
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
/**
 * @maxItems 32
 */
export type TextList = string[]
/**
 * Controller基于精确Test Result Review Snapshot作出的单Test Target审查决定。
 */
export type WakeflowControllerTestReviewDecision = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowControllerTestReviewDecision"
schemaVersion: 1
targetReviewDecisionId: string
programId: string
demandId: string
targetTaskId: string
controllerWindowId: string
reviewed: Reviewed1
testExecution: TestExecution
decision: ("accept" | "request-another-attempt" | "escalate-product-defect" | "blocked")
assessment: Assessment1
/**
 * @minItems 1
 * @maxItems 32
 */
independentChecks: [IndependentCheck1, ...(IndependentCheck1)[]]
rationale: string
blockingReasons: TextList1
residualRisks: TextList1
decidedAt: WakeflowUtcInstantText
decisionDigest: WakeflowSha256DigestText
})
/**
 * @maxItems 32
 */
export type TextList1 = string[]

/**
 * review.target-result-decided事件版本1的持久化数据。
 */
export interface WakeflowControllerTargetReviewDecidedEventDataV1 {
decision: (WakeflowControllerImplementationReviewDecision | WakeflowControllerTestReviewDecision)
}
export interface Reviewed {
snapshotDigest: WakeflowSha256DigestText
reviewUnitDigest: WakeflowSha256DigestText
stateDigest: WakeflowSha256DigestText
streamRevision: number
taskPackageId: string
taskPackageDigest: WakeflowSha256DigestText
targetResultId: string
targetResultDigest: WakeflowSha256DigestText
targetResultOutcome: ("completed" | "blocked" | "needs-review")
targetResultReportedAt: WakeflowUtcInstantText
}
export interface Assessment {
requirementAlignment: ("aligned" | "mismatch" | "unresolved")
implementationQuality: ("satisfactory" | "defective" | "unverified")
}
export interface IndependentCheck {
checkId: string
method: string
outcome: ("passed" | "failed" | "inconclusive")
observation: string
}
export interface Reviewed1 {
snapshotDigest: WakeflowSha256DigestText
reviewUnitDigest: WakeflowSha256DigestText
stateDigest: WakeflowSha256DigestText
streamRevision: number
taskPackageId: string
taskPackageDigest: WakeflowSha256DigestText
targetResultId: string
targetResultDigest: WakeflowSha256DigestText
targetResultOutcome: ("completed" | "blocked" | "needs-review")
targetResultReportedAt: WakeflowUtcInstantText
}
export interface TestExecution {
testAttemptId: string
testCard: {
testCardId: string
testCardDigest: WakeflowSha256DigestText
}
testDispatchPacketDigest: WakeflowSha256DigestText
}
export interface Assessment1 {
conclusion: ("satisfied" | "defect-observed" | "inconclusive")
evidenceSufficiency: ("sufficient" | "insufficient")
}
export interface IndependentCheck1 {
checkId: string
method: string
outcome: ("passed" | "failed" | "inconclusive")
observation: string
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
export const WAKEFLOW_CONTROLLER_TARGET_REVIEW_DECIDED_EVENT_DATA_V1_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:controller-target-review-decided-event-data:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_CONTROLLER_TARGET_REVIEW_DECIDED_EVENT_DATA_V1_SCHEMA\",\"title\":\"WakeflowControllerTargetReviewDecidedEventDataV1\",\"description\":\"review.target-result-decided事件版本1的持久化数据。\",\"$comment\":\"Event保存完整ControllerImplementationReviewDecision业务事实；Aggregate状态摘要与后续route不进入Event data。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"decision\"],\"properties\":{\"decision\":{\"oneOf\":[{\"$ref\":\"urn:wakeflow:governance:review:controller-implementation-review-decision:v1\"},{\"$ref\":\"urn:wakeflow:governance:review:controller-test-review-decision:v1\"}]}}}");
