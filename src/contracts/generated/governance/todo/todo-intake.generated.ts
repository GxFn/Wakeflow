/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/todo/todo-intake.schema.json
 */

/**
 * TODO intake 使用的稳定、用户可读 opaque ID；允许字母、数字、点、下划线、冒号和连字符，不从标题或路径推导。
 */
export type WakeflowTodoItemIdText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
export type WindowId = string
export type NonEmptyText = string
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string

/**
 * 一个 TODO item 创建后不可变的 pre-demand intake authority；展示状态和 demand mount 不进入本记录。
 */
export interface WakeflowTodoIntake {
artifactKind: "wakeflow-todo-intake"
schemaVersion: 1
todoId: WakeflowTodoItemIdText
createdAt: WakeflowUtcInstantText
initialStatus: ("pending-claim" | "parked")
type: ("requirement" | "bug" | "supplement" | "research")
priority: ("P0" | "P1" | "P2" | "P3")
ownerWindowId: WindowId
goal: NonEmptyText
affectsRetestOrDispatch: boolean
dependency: (null | NonEmptyText)
recommendedWindowId: WindowId
autoClaim: boolean
testingDecision: TestingDecision
/**
 * @minItems 1
 * @maxItems 32
 */
documents: [DocumentReference, ...(DocumentReference)[]]
}
export interface TestingDecision {
mode: ("controller-only" | "real-environment" | "not-applicable")
summary: string
}
export interface DocumentReference {
label: string
ref: WakeflowPortableResourcePathText
anchor: (null | string)
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
export const WAKEFLOW_TODO_INTAKE_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:todo:intake:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TODO_INTAKE_SCHEMA\",\"title\":\"WakeflowTodoIntake\",\"description\":\"一个 TODO item 创建后不可变的 pre-demand intake authority；展示状态和 demand mount 不进入本记录。\",\"$comment\":\"Schema 负责 portable structure；window typed ID、testing decision/type 关系、document anchor 与领域字段顺序由 TODO intake codec 继续校验。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"todoId\",\"createdAt\",\"initialStatus\",\"type\",\"priority\",\"ownerWindowId\",\"goal\",\"affectsRetestOrDispatch\",\"dependency\",\"recommendedWindowId\",\"autoClaim\",\"testingDecision\",\"documents\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-todo-intake\"},\"schemaVersion\":{\"const\":1},\"todoId\":{\"$ref\":\"urn:wakeflow:governance:todo:item-id:v1\"},\"createdAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"initialStatus\":{\"enum\":[\"pending-claim\",\"parked\"]},\"type\":{\"enum\":[\"requirement\",\"bug\",\"supplement\",\"research\"]},\"priority\":{\"enum\":[\"P0\",\"P1\",\"P2\",\"P3\"]},\"ownerWindowId\":{\"$ref\":\"#/$defs/windowId\"},\"goal\":{\"$ref\":\"#/$defs/nonEmptyText\"},\"affectsRetestOrDispatch\":{\"type\":\"boolean\"},\"dependency\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/nonEmptyText\"}]},\"recommendedWindowId\":{\"$ref\":\"#/$defs/windowId\"},\"autoClaim\":{\"type\":\"boolean\"},\"testingDecision\":{\"$ref\":\"#/$defs/testingDecision\"},\"documents\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/documentReference\"}}},\"$defs\":{\"nonEmptyText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"testingDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"mode\",\"summary\"],\"properties\":{\"mode\":{\"enum\":[\"controller-only\",\"real-environment\",\"not-applicable\"]},\"summary\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":4096,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"}}},\"documentReference\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"label\",\"ref\",\"anchor\"],\"properties\":{\"label\":{\"type\":\"string\",\"pattern\":\"^[A-Za-z][A-Za-z0-9-]{0,63}$\"},\"ref\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"anchor\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._~-]*$\",\"maxLength\":256}]}}}}}");
