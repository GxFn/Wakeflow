/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-board-inspection-request.schema.json
 */

/**
 * wakeflow_inspect_board 的请求：list 按优先级列出需求包及其认领状态，package 读一个需求包的记录头部与章节锚点。
 */
export type WakeflowBoardInspectionRequestV1 = (ListRequest | PackageRequest)
export type WorkspaceRoot = string
export type Status = ("pending" | "parked" | "claimed" | "withdrawn" | "archived")
export type Priority = ("P0" | "P1" | "P2" | "P3")
export type DemandType = ("requirement" | "bug" | "supplement" | "research")
export type RequirementId = string

export interface ListRequest {
root: WorkspaceRoot
view: "list"
filter?: {
/**
 * @maxItems 5
 */
statuses?: []|[Status]|[Status, Status]|[Status, Status, Status]|[Status, Status, Status, Status]|[Status, Status, Status, Status, Status]
/**
 * @maxItems 4
 */
priorities?: []|[Priority]|[Priority, Priority]|[Priority, Priority, Priority]|[Priority, Priority, Priority, Priority]
/**
 * @maxItems 4
 */
demandTypes?: []|[DemandType]|[DemandType, DemandType]|[DemandType, DemandType, DemandType]|[DemandType, DemandType, DemandType, DemandType]
}
limit?: number
}
export interface PackageRequest {
root: WorkspaceRoot
view: "package"
requirementId: RequirementId
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
export const WAKEFLOW_BOARD_INSPECTION_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:board-inspection-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_BOARD_INSPECTION_REQUEST_SCHEMA\",\"title\":\"WakeflowBoardInspectionRequestV1\",\"description\":\"wakeflow_inspect_board 的请求：list 按优先级列出需求包及其认领状态，package 读一个需求包的记录头部与章节锚点。\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/listRequest\"},{\"$ref\":\"#/$defs/packageRequest\"}],\"$defs\":{\"listRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"view\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"view\":{\"const\":\"list\"},\"filter\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[],\"properties\":{\"statuses\":{\"type\":\"array\",\"maxItems\":5,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/status\"}},\"priorities\":{\"type\":\"array\",\"maxItems\":4,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/priority\"}},\"demandTypes\":{\"type\":\"array\",\"maxItems\":4,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/demandType\"}}}},\"limit\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":256}}},\"packageRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"view\",\"requirementId\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"view\":{\"const\":\"package\"},\"requirementId\":{\"$ref\":\"#/$defs/requirementId\"}}},\"workspaceRoot\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":4096},\"requirementId\":{\"type\":\"string\",\"pattern\":\"^requirement_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"status\":{\"enum\":[\"pending\",\"parked\",\"claimed\",\"withdrawn\",\"archived\"]},\"priority\":{\"enum\":[\"P0\",\"P1\",\"P2\",\"P3\"]},\"demandType\":{\"enum\":[\"requirement\",\"bug\",\"supplement\",\"research\"]}}}");
