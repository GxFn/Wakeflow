/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/review/controller-target-review-resume.schema.json
 */

export type TargetReviewResumeId = string
export type TargetReviewDecisionId = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
export type TargetResultId = string
export type HumanText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string

/**
 * Controller在精确blocked Decision之后重新开放同一TargetResult审查资格的不可变记录。
 */
export interface WakeflowControllerTargetReviewResume {
kind: "WakeflowControllerTargetReviewResume"
schemaVersion: 1
targetReviewResumeId: TargetReviewResumeId
programId: string
demandId: string
targetTaskId: string
controllerWindowId: string
blockedDecision: BlockedDecision
blockedSource: BlockedSource
resolutionSummary: HumanText
resumedAt: WakeflowUtcInstantText
resumeDigest: WakeflowSha256DigestText
}
export interface BlockedDecision {
targetReviewDecisionId: TargetReviewDecisionId
decisionDigest: WakeflowSha256DigestText
targetResultId: TargetResultId
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
export const WAKEFLOW_CONTROLLER_TARGET_REVIEW_RESUME_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:review:controller-target-review-resume:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_CONTROLLER_TARGET_REVIEW_RESUME_SCHEMA\",\"title\":\"WakeflowControllerTargetReviewResume\",\"description\":\"Controller在精确blocked Decision之后重新开放同一TargetResult审查资格的不可变记录。\",\"$comment\":\"Resume只记录阻断已具备重新审查条件；它不撤销旧Decision，也不直接授予accept、rework或redesign。Event Stream/state CAS负责复验当前blocked尾部。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"targetReviewResumeId\",\"programId\",\"demandId\",\"targetTaskId\",\"controllerWindowId\",\"blockedDecision\",\"blockedSource\",\"resolutionSummary\",\"resumedAt\",\"resumeDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowControllerTargetReviewResume\"},\"schemaVersion\":{\"const\":1},\"targetReviewResumeId\":{\"$ref\":\"#/$defs/targetReviewResumeId\"},\"programId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/programId\"},\"demandId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/demandId\"},\"targetTaskId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/targetTaskId\"},\"controllerWindowId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/$defs/windowId\"},\"blockedDecision\":{\"$ref\":\"#/$defs/blockedDecision\"},\"blockedSource\":{\"$ref\":\"#/$defs/blockedSource\"},\"resolutionSummary\":{\"$ref\":\"#/$defs/humanText\"},\"resumedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"resumeDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}},\"$defs\":{\"targetReviewResumeId\":{\"type\":\"string\",\"pattern\":\"^target-review-resume_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetResultId\":{\"type\":\"string\",\"pattern\":\"^target-result_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"blockedDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetReviewDecisionId\",\"decisionDigest\",\"targetResultId\",\"targetResultDigest\"],\"properties\":{\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"decisionDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"targetResultId\":{\"$ref\":\"#/$defs/targetResultId\"},\"targetResultDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"blockedSource\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"snapshotDigest\",\"stateDigest\",\"streamRevision\"],\"properties\":{\"snapshotDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"stateDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991}}},\"humanText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"}}}");
