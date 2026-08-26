/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/todo/todo-intake-lineage.schema.json
 */

/**
 * TODO intake 使用的稳定、用户可读 opaque ID；允许字母、数字、点、下划线、冒号和连字符，不从标题或路径推导。
 */
export type WakeflowTodoItemIdText = string
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string

/**
 * 跨 Aggregate 绑定一份 immutable TODO intake 的 portable ref/digest。
 */
export interface WakeflowTodoIntakeLineageReference {
artifactKind: "wakeflow-todo-intake-lineage"
schemaVersion: 1
todoId: WakeflowTodoItemIdText
intakeRef: WakeflowPortableResourcePathText
intakeDigest: WakeflowSha256DigestText
}

/** 递归冻结生成的 Schema，阻止 validator 首次消费前发生嵌套漂移。 */
function freezeGeneratedSchema<Value>(value: Value): Readonly<Value> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeGeneratedSchema(child);
    Object.freeze(value);
  }
  return value;
}

/** Ajv strict validator 使用的 Schema 派生运行时权威；不得手工修改。 */
export const WAKEFLOW_TODO_INTAKE_LINEAGE_SCHEMA = freezeGeneratedSchema({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:wakeflow:governance:todo:intake-lineage:v1",
  "x-wakeflow-runtime-export": "WAKEFLOW_TODO_INTAKE_LINEAGE_SCHEMA",
  "title": "WakeflowTodoIntakeLineageReference",
  "description": "跨 Aggregate 绑定一份 immutable TODO intake 的 portable ref/digest。",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "artifactKind",
    "schemaVersion",
    "todoId",
    "intakeRef",
    "intakeDigest"
  ],
  "properties": {
    "artifactKind": {
      "const": "wakeflow-todo-intake-lineage"
    },
    "schemaVersion": {
      "const": 1
    },
    "todoId": {
      "$ref": "urn:wakeflow:governance:todo:item-id:v1"
    },
    "intakeRef": {
      "$ref": "urn:wakeflow:foundation:filesystem:portable-resource-path:v1"
    },
    "intakeDigest": {
      "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
    }
  }
} as const);
