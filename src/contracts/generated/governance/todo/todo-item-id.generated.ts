/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/todo/todo-item-id.schema.json
 */

/** TODO item ID 的 Schema 派生正则源。 */
export const TODO_ITEM_ID_PATTERN_SOURCE = "^todo_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" as const;

/** Schema 层的 TODO item ID；运行时解析后再授予品牌类型。 */
export type WakeflowTodoItemIdText = string;

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
export const WAKEFLOW_TODO_ITEM_ID_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:todo:item-id:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TODO_ITEM_ID_SCHEMA\",\"title\":\"WakeflowTodoItemIdText\",\"description\":\"TODO intake 使用的 Wakeflow 持久类型化身份；由 owner 分配，不从标题、路径、时间或集合位置推导。\",\"$comment\":\"运行时解析器必须继续通过 Wakeflow durable ID 的 todo kind 准入；本 Schema 只提供被多个领域合同复用的 wire 结构。\",\"type\":\"string\",\"pattern\":\"^todo_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\",\"examples\":[\"todo_11111111-1111-4111-8111-111111111111\"]}");
