/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/demand-event-sourcing-stored-event.schema.json
 */

export type EventId = string
export type DemandId = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
export type NonEmptyText = string

/**
 * Demand Event Store 已分配 stream revision 并记录 resulting-state digest 的不可变领域事件。
 */
export interface WakeflowDemandEventSourcingStoredEvent {
artifactKind: "wakeflow-demand-event-sourcing-event"
schemaVersion: 1
eventId: EventId
demandId: DemandId
streamRevision: number
recordedAt: WakeflowUtcInstantText
eventType: ("publication.demand-published" | "lifecycle.demand-cancelled")
eventVersion: 1
data: (DemandPublishedData | DemandCancelledData)
resultingStateDigest: WakeflowSha256DigestText
}
export interface DemandPublishedData {
identityRef: "identity.json"
identityDigest: WakeflowSha256DigestText
authorityRef: "authority.json"
authorityDigest: WakeflowSha256DigestText
}
export interface DemandCancelledData {
reason: NonEmptyText
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
export const WAKEFLOW_DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA = freezeGeneratedSchema({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:wakeflow:governance:demand:event-sourcing-stored-event:v1",
  "x-wakeflow-runtime-export": "WAKEFLOW_DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA",
  "title": "WakeflowDemandEventSourcingStoredEvent",
  "description": "Demand Event Store 已分配 stream revision 并记录 resulting-state digest 的不可变领域事件。",
  "$comment": "领域 Decider 不生成这些持久化位置字段；commit preparation 在完整 evolve 成功后才构造 stored event。",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "artifactKind",
    "schemaVersion",
    "eventId",
    "demandId",
    "streamRevision",
    "recordedAt",
    "eventType",
    "eventVersion",
    "data",
    "resultingStateDigest"
  ],
  "properties": {
    "artifactKind": {
      "const": "wakeflow-demand-event-sourcing-event"
    },
    "schemaVersion": {
      "const": 1
    },
    "eventId": {
      "$ref": "#/$defs/eventId"
    },
    "demandId": {
      "$ref": "#/$defs/demandId"
    },
    "streamRevision": {
      "type": "integer",
      "minimum": 1,
      "maximum": 9007199254740991
    },
    "recordedAt": {
      "$ref": "urn:wakeflow:foundation:time:utc-instant:v1"
    },
    "eventType": {
      "enum": [
        "publication.demand-published",
        "lifecycle.demand-cancelled"
      ]
    },
    "eventVersion": {
      "const": 1
    },
    "data": {
      "oneOf": [
        {
          "$ref": "#/$defs/demandPublishedData"
        },
        {
          "$ref": "#/$defs/demandCancelledData"
        }
      ]
    },
    "resultingStateDigest": {
      "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
    }
  },
  "$defs": {
    "eventId": {
      "type": "string",
      "pattern": "^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    },
    "demandId": {
      "type": "string",
      "pattern": "^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    },
    "nonEmptyText": {
      "type": "string",
      "minLength": 1,
      "maxLength": 8192,
      "pattern": "^(?!\\s)[\\s\\S]*\\S$"
    },
    "demandPublishedData": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "identityRef",
        "identityDigest",
        "authorityRef",
        "authorityDigest"
      ],
      "properties": {
        "identityRef": {
          "const": "identity.json"
        },
        "identityDigest": {
          "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
        },
        "authorityRef": {
          "const": "authority.json"
        },
        "authorityDigest": {
          "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
        }
      }
    },
    "demandCancelledData": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "reason"
      ],
      "properties": {
        "reason": {
          "$ref": "#/$defs/nonEmptyText"
        }
      }
    }
  }
} as const);
