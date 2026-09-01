/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-target-result-review-inspection-request.schema.json
 */

/**
 * Absolute path of the existing Wakeflow workspace root.
 */
export type WorkspaceRoot = string
export type DemandId = string
export type TargetTaskId = string

/**
 * Closed read-only MCP request for inspecting one current reported or review-blocked TargetResult review unit.
 */
export interface WakeflowTargetResultReviewInspectionRequestV1 {
root: WorkspaceRoot
demandId: DemandId
targetTaskId: TargetTaskId
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
export const WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:target-result-review-inspection-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_REQUEST_SCHEMA\",\"title\":\"WakeflowTargetResultReviewInspectionRequestV1\",\"description\":\"Closed read-only MCP request for inspecting one current reported or review-blocked TargetResult review unit.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"demandId\",\"targetTaskId\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"}},\"$defs\":{\"workspaceRoot\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}");
