/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-target-result-review-resume-request.schema.json
 */

export type DemandId = string
export type TargetTaskId = string
export type Sha256Digest = string

/**
 * Closed MCP request for resuming one exact current blocked TargetResult review generation.
 */
export interface WakeflowTargetResultReviewResumeRequestV1 {
/**
 * Absolute path of the existing Wakeflow workspace root.
 */
root: string
demandId: DemandId
targetTaskId: TargetTaskId
expectedBlockedState: ExpectedBlockedState
resolutionSummary: string
}
export interface ExpectedBlockedState {
streamRevision: number
stateDigest: Sha256Digest
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
export const WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:target-result-review-resume-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_REQUEST_SCHEMA\",\"title\":\"WakeflowTargetResultReviewResumeRequestV1\",\"description\":\"Closed MCP request for resuming one exact current blocked TargetResult review generation.\",\"$comment\":\"The caller supplies only the current Route/Inspector state selector and a Controller resolution summary. Wakeflow derives the blocked Decision, TargetResult, Snapshot, Controller, time, Resume, Event, and Commit identities.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"demandId\",\"targetTaskId\",\"expectedBlockedState\",\"resolutionSummary\"],\"properties\":{\"root\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"expectedBlockedState\":{\"$ref\":\"#/$defs/expectedBlockedState\"},\"resolutionSummary\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"}},\"$defs\":{\"expectedBlockedState\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"streamRevision\",\"stateDigest\"],\"properties\":{\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}");
