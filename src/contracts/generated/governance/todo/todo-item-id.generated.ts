/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/todo/todo-item-id.schema.json
 */

/** TODO item ID 的 Schema 派生正则源。 */
export const TODO_ITEM_ID_PATTERN_SOURCE = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" as const;

/** Schema 层的 TODO item ID；运行时解析后再授予品牌类型。 */
export type WakeflowTodoItemIdText = string;

/** 递归冻结生成的 Schema，阻止 validator 首次消费前发生嵌套漂移。 */
function freezeGeneratedSchema<Value>(value: Value): Readonly<Value> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeGeneratedSchema(child);
    Object.freeze(value);
  }
  return value;
}

/** Ajv strict validator 使用的 Schema 派生运行时权威；不得手工修改。 */
export const WAKEFLOW_TODO_ITEM_ID_SCHEMA = freezeGeneratedSchema({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:wakeflow:governance:todo:item-id:v1",
  "x-wakeflow-runtime-export": "WAKEFLOW_TODO_ITEM_ID_SCHEMA",
  "title": "WakeflowTodoItemIdText",
  "description": "TODO intake 使用的稳定、用户可读 opaque ID；允许字母、数字、点、下划线、冒号和连字符，不从标题或路径推导。",
  "$comment": "TODO ID 不是 Wakeflow durable UUID kind；它保留当前公开输入的可读标识，但创建后不可复用或改写。",
  "type": "string",
  "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
  "examples": [
    "TODO-M2-T09"
  ]
} as const);
