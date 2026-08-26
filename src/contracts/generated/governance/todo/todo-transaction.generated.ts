/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/todo/todo-transaction.schema.json
 */

/**
 * TODO intake 使用的稳定、用户可读 opaque ID；允许字母、数字、点、下划线、冒号和连字符，不从标题或路径推导。
 */
export type WakeflowTodoItemIdText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
export type NullableDigest = (null | WakeflowSha256DigestText)
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string

/**
 * 一个 TODO item append、claim 或 archive 的 immutable recovery plan；expected 与 target digest 允许 owner 判断前向恢复、幂等重放或冲突。
 */
export interface WakeflowTodoTransaction {
artifactKind: "wakeflow-todo-transaction"
schemaVersion: 1
todoId: WakeflowTodoItemIdText
operation: ("append" | "claim" | "archive")
createdAt: WakeflowUtcInstantText
expectedCollectionDigest: WakeflowSha256DigestText
expectedIntakeDigest: NullableDigest
expectedStateDigest: NullableDigest
targetIntake: (null | WakeflowTodoIntake)
targetState: WakeflowTodoState
targetIntakeDigest: WakeflowSha256DigestText
targetStateDigest: WakeflowSha256DigestText
targetCollectionDigest: WakeflowSha256DigestText
}
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
ownerWindowId: string
goal: string
affectsRetestOrDispatch: boolean
dependency: (null | string)
recommendedWindowId: string
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
/**
 * 一个 TODO item 可更新的当前状态快照；revision、previous digest、mount 与 archive receipt 绑定每次前向转换。
 */
export interface WakeflowTodoState {
artifactKind: "wakeflow-todo-state"
schemaVersion: 1
todoId: WakeflowTodoItemIdText
revision: number
previousStateDigest: (null | WakeflowSha256DigestText)
status: ("pending-claim" | "parked" | "claimed" | "blocked" | "observing" | "completed" | "cancelled" | "archived")
updatedAt: WakeflowUtcInstantText
mount: (null | DemandMount)
archive: (null | ArchiveReceipt)
}
export interface DemandMount {
demandId: string
stateRootRef: WakeflowPortableResourcePathText
identityDigest: WakeflowSha256DigestText
}
export interface ArchiveReceipt {
artifactKind: "wakeflow-business-archive-receipt"
schemaVersion: 1
archiveId: string
demandId: string
todoId: WakeflowTodoItemIdText
intakeDigest: WakeflowSha256DigestText
claimedStateDigest: WakeflowSha256DigestText
manifestDigest: WakeflowSha256DigestText
archivedAt: WakeflowUtcInstantText
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
export const WAKEFLOW_TODO_TRANSACTION_SCHEMA = freezeGeneratedSchema({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:wakeflow:governance:todo:transaction:v1",
  "x-wakeflow-runtime-export": "WAKEFLOW_TODO_TRANSACTION_SCHEMA",
  "title": "WakeflowTodoTransaction",
  "description": "一个 TODO item append、claim 或 archive 的 immutable recovery plan；expected 与 target digest 允许 owner 判断前向恢复、幂等重放或冲突。",
  "$comment": "Journal 不保存可变 phase。磁盘 effect 顺序、lock、projection publish 和 exact journal retirement 由 TODO collection owner 执行。",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "artifactKind",
    "schemaVersion",
    "todoId",
    "operation",
    "createdAt",
    "expectedCollectionDigest",
    "expectedIntakeDigest",
    "expectedStateDigest",
    "targetIntake",
    "targetState",
    "targetIntakeDigest",
    "targetStateDigest",
    "targetCollectionDigest"
  ],
  "properties": {
    "artifactKind": {
      "const": "wakeflow-todo-transaction"
    },
    "schemaVersion": {
      "const": 1
    },
    "todoId": {
      "$ref": "urn:wakeflow:governance:todo:item-id:v1"
    },
    "operation": {
      "enum": [
        "append",
        "claim",
        "archive"
      ]
    },
    "createdAt": {
      "$ref": "urn:wakeflow:foundation:time:utc-instant:v1"
    },
    "expectedCollectionDigest": {
      "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
    },
    "expectedIntakeDigest": {
      "$ref": "#/$defs/nullableDigest"
    },
    "expectedStateDigest": {
      "$ref": "#/$defs/nullableDigest"
    },
    "targetIntake": {
      "oneOf": [
        {
          "type": "null"
        },
        {
          "$ref": "urn:wakeflow:governance:todo:intake:v1"
        }
      ]
    },
    "targetState": {
      "$ref": "urn:wakeflow:governance:todo:state:v1"
    },
    "targetIntakeDigest": {
      "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
    },
    "targetStateDigest": {
      "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
    },
    "targetCollectionDigest": {
      "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
    }
  },
  "$defs": {
    "nullableDigest": {
      "oneOf": [
        {
          "type": "null"
        },
        {
          "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
        }
      ]
    }
  }
} as const);
