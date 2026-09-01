/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/controller-target-review-resumed-event-data-v1.schema.json
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
 * review.target-result-resumed事件版本1的持久化数据。
 */
export interface WakeflowControllerTargetReviewResumedEventDataV1 {
resume: WakeflowControllerTargetReviewResume
}
/**
 * Controller在精确blocked Decision之后重新开放同一TargetResult审查资格的不可变记录。
 */
export interface WakeflowControllerTargetReviewResume {
kind: "WakeflowControllerTargetReviewResume"
schemaVersion: 1
targetReviewResumeId: string
programId: string
demandId: string
targetTaskId: string
controllerWindowId: string
blockedDecision: BlockedDecision
blockedSource: BlockedSource
resolutionSummary: string
resumedAt: WakeflowUtcInstantText
resumeDigest: WakeflowSha256DigestText
}
export interface BlockedDecision {
targetReviewDecisionId: string
decisionDigest: WakeflowSha256DigestText
targetResultId: string
targetResultDigest: WakeflowSha256DigestText
}
export interface BlockedSource {
snapshotDigest: WakeflowSha256DigestText
stateDigest: WakeflowSha256DigestText
streamRevision: number
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
export const WAKEFLOW_CONTROLLER_TARGET_REVIEW_RESUMED_EVENT_DATA_V1_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:controller-target-review-resumed-event-data:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_CONTROLLER_TARGET_REVIEW_RESUMED_EVENT_DATA_V1_SCHEMA\",\"title\":\"WakeflowControllerTargetReviewResumedEventDataV1\",\"description\":\"review.target-result-resumed事件版本1的持久化数据。\",\"$comment\":\"Event保存完整ControllerTargetReviewResume；恢复后的Aggregate摘要由Reducer确定，不进入data。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"resume\"],\"properties\":{\"resume\":{\"$ref\":\"urn:wakeflow:governance:review:controller-target-review-resume:v1\"}}}");
