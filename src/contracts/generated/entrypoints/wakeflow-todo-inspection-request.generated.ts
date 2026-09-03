/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-todo-inspection-request.schema.json
 */

/**
 * Closed read-only MCP request for listing one bounded TODO page or inspecting one exact TODO item.
 */
export type WakeflowTodoInspectionRequestV1 = (ListRequest | ItemRequest)
/**
 * Absolute path of the existing Wakeflow workspace root. It is validated physically and never returned.
 */
export type WorkspaceRoot = string
export type TodoStatus = ("pending-claim" | "parked" | "claimed" | "withdrawn" | "archived")
export type TodoPriority = ("P0" | "P1" | "P2" | "P3")
export type DemandType = ("requirement" | "bug" | "supplement" | "research")
export type WindowId = string
export type TodoId = string

export interface ListRequest {
root: WorkspaceRoot
view: "list"
filter?: ListFilter
/**
 * Maximum requested page size. Zero or omission selects 20; the domain clamps values above 100.
 */
pageSize?: number
/**
 * Opaque URL-safe continuation token returned by the preceding page.
 */
pageToken?: string
}
export interface ListFilter {
/**
 * @minItems 1
 * @maxItems 5
 */
statuses?: [TodoStatus]|[TodoStatus, TodoStatus]|[TodoStatus, TodoStatus, TodoStatus]|[TodoStatus, TodoStatus, TodoStatus, TodoStatus]|[TodoStatus, TodoStatus, TodoStatus, TodoStatus, TodoStatus]
/**
 * @minItems 1
 * @maxItems 4
 */
priorities?: [TodoPriority]|[TodoPriority, TodoPriority]|[TodoPriority, TodoPriority, TodoPriority]|[TodoPriority, TodoPriority, TodoPriority, TodoPriority]
/**
 * @minItems 1
 * @maxItems 4
 */
demandTypes?: [DemandType]|[DemandType, DemandType]|[DemandType, DemandType, DemandType]|[DemandType, DemandType, DemandType, DemandType]
autoClaim?: boolean
originWindowId?: WindowId
}
export interface ItemRequest {
root: WorkspaceRoot
view: "item"
todoId: TodoId
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
export const WAKEFLOW_TODO_INSPECTION_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:todo-inspection-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TODO_INSPECTION_REQUEST_SCHEMA\",\"title\":\"WakeflowTodoInspectionRequestV1\",\"description\":\"Closed read-only MCP request for listing one bounded TODO page or inspecting one exact TODO item.\",\"$comment\":\"List filters observation fields only and never asks Wakeflow to select an eligible or next item. Page tokens continue one normalized filter over one exact collection snapshot and provide no mutation authority. Item inspection selects one typed TODO identity.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/listRequest\"},{\"$ref\":\"#/$defs/itemRequest\"}],\"$defs\":{\"listRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"view\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"view\":{\"const\":\"list\"},\"filter\":{\"$ref\":\"#/$defs/listFilter\"},\"pageSize\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":9007199254740991,\"description\":\"Maximum requested page size. Zero or omission selects 20; the domain clamps values above 100.\"},\"pageToken\":{\"type\":\"string\",\"maxLength\":256,\"pattern\":\"^[A-Za-z0-9_-]*$\",\"description\":\"Opaque URL-safe continuation token returned by the preceding page.\"}}},\"itemRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"view\",\"todoId\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"view\":{\"const\":\"item\"},\"todoId\":{\"$ref\":\"#/$defs/todoId\"}}},\"listFilter\":{\"type\":\"object\",\"additionalProperties\":false,\"properties\":{\"statuses\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":5,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/todoStatus\"}},\"priorities\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":4,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/todoPriority\"}},\"demandTypes\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":4,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/demandType\"}},\"autoClaim\":{\"type\":\"boolean\"},\"originWindowId\":{\"$ref\":\"#/$defs/windowId\"}}},\"workspaceRoot\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root. It is validated physically and never returned.\"},\"todoStatus\":{\"enum\":[\"pending-claim\",\"parked\",\"claimed\",\"withdrawn\",\"archived\"]},\"todoPriority\":{\"enum\":[\"P0\",\"P1\",\"P2\",\"P3\"]},\"demandType\":{\"enum\":[\"requirement\",\"bug\",\"supplement\",\"research\"]},\"todoId\":{\"type\":\"string\",\"pattern\":\"^todo_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}");
