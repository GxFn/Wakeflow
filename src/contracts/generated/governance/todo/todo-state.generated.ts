/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/todo/todo-state.schema.json
 */

/**
 * TODO intake 使用的稳定、用户可读 opaque ID；允许字母、数字、点、下划线、冒号和连字符，不从标题或路径推导。
 */
export type WakeflowTodoItemIdText = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
export type DemandId = string
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string
export type ArchiveId = string

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
demandId: DemandId
stateRootRef: WakeflowPortableResourcePathText
identityDigest: WakeflowSha256DigestText
}
export interface ArchiveReceipt {
artifactKind: "wakeflow-business-archive-receipt"
schemaVersion: 1
archiveId: ArchiveId
demandId: DemandId
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
export const WAKEFLOW_TODO_STATE_SCHEMA = freezeGeneratedSchema({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:wakeflow:governance:todo:state:v1",
  "x-wakeflow-runtime-export": "WAKEFLOW_TODO_STATE_SCHEMA",
  "title": "WakeflowTodoState",
  "description": "一个 TODO item 可更新的当前状态快照；revision、previous digest、mount 与 archive receipt 绑定每次前向转换。",
  "$comment": "Schema 不决定允许的状态转换。revision chain、mount/status、archive/status 和 intake identity 关系由 TODO state codec 与 transaction owner 校验。",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "artifactKind",
    "schemaVersion",
    "todoId",
    "revision",
    "previousStateDigest",
    "status",
    "updatedAt",
    "mount",
    "archive"
  ],
  "properties": {
    "artifactKind": {
      "const": "wakeflow-todo-state"
    },
    "schemaVersion": {
      "const": 1
    },
    "todoId": {
      "$ref": "urn:wakeflow:governance:todo:item-id:v1"
    },
    "revision": {
      "type": "integer",
      "minimum": 1,
      "maximum": 9007199254740991
    },
    "previousStateDigest": {
      "oneOf": [
        {
          "type": "null"
        },
        {
          "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
        }
      ]
    },
    "status": {
      "enum": [
        "pending-claim",
        "parked",
        "claimed",
        "blocked",
        "observing",
        "completed",
        "cancelled",
        "archived"
      ]
    },
    "updatedAt": {
      "$ref": "urn:wakeflow:foundation:time:utc-instant:v1"
    },
    "mount": {
      "oneOf": [
        {
          "type": "null"
        },
        {
          "$ref": "#/$defs/demandMount"
        }
      ]
    },
    "archive": {
      "oneOf": [
        {
          "type": "null"
        },
        {
          "$ref": "#/$defs/archiveReceipt"
        }
      ]
    }
  },
  "$defs": {
    "demandId": {
      "type": "string",
      "pattern": "^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    },
    "archiveId": {
      "type": "string",
      "pattern": "^archive_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    },
    "demandMount": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "demandId",
        "stateRootRef",
        "identityDigest"
      ],
      "properties": {
        "demandId": {
          "$ref": "#/$defs/demandId"
        },
        "stateRootRef": {
          "$ref": "urn:wakeflow:foundation:filesystem:portable-resource-path:v1"
        },
        "identityDigest": {
          "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
        }
      }
    },
    "archiveReceipt": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "artifactKind",
        "schemaVersion",
        "archiveId",
        "demandId",
        "todoId",
        "intakeDigest",
        "claimedStateDigest",
        "manifestDigest",
        "archivedAt"
      ],
      "properties": {
        "artifactKind": {
          "const": "wakeflow-business-archive-receipt"
        },
        "schemaVersion": {
          "const": 1
        },
        "archiveId": {
          "$ref": "#/$defs/archiveId"
        },
        "demandId": {
          "$ref": "#/$defs/demandId"
        },
        "todoId": {
          "$ref": "urn:wakeflow:governance:todo:item-id:v1"
        },
        "intakeDigest": {
          "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
        },
        "claimedStateDigest": {
          "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
        },
        "manifestDigest": {
          "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
        },
        "archivedAt": {
          "$ref": "urn:wakeflow:foundation:time:utc-instant:v1"
        }
      }
    }
  }
} as const);
