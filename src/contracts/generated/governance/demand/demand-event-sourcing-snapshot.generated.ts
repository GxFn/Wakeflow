/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/demand-event-sourcing-snapshot.schema.json
 */

/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
export type DemandId = string
export type EventId = string
/**
 * @maxItems 0
 */
export type EmptyFacts = []

/**
 * Demand Event Stream 某一 immutable commit boundary 的可删除 Aggregate checkpoint。
 */
export interface WakeflowDemandEventSourcingSnapshot {
artifactKind: "wakeflow-demand-event-sourcing-snapshot"
schemaVersion: 1
aggregateVersion: 1
versionCompatibilityDigest: WakeflowSha256DigestText
demandId: DemandId
commitSequence: number
streamRevision: number
lastCommitDigest: WakeflowSha256DigestText
lastEventId: EventId
lastEventDigest: WakeflowSha256DigestText
state: WakeflowDemandAggregateState
stateDigest: WakeflowSha256DigestText
}
/**
 * 由 Demand domain event reducer 唯一生成的纯业务 Aggregate state。
 */
export interface WakeflowDemandAggregateState {
artifactKind: "wakeflow-demand-aggregate-state"
schemaVersion: 1
demandId: string
lifecycle: ("active" | "completed" | "cancelled")
tasking: Tasking
delivery: Delivery
result: Result
testing: Testing
review: Review
evidence: Evidence
pod: null
}
export interface Tasking {
taskPackages: EmptyFacts
targetTasks: EmptyFacts
}
export interface Delivery {
currentDeliveries: EmptyFacts
}
export interface Result {
currentResults: EmptyFacts
}
export interface Testing {
testCards: EmptyFacts
testAttempts: EmptyFacts
}
export interface Review {
pendingCandidate: null
}
export interface Evidence {
items: EmptyFacts
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
export const WAKEFLOW_DEMAND_EVENT_SOURCING_SNAPSHOT_SCHEMA = freezeGeneratedSchema({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:wakeflow:governance:demand:event-sourcing-snapshot:v1",
  "x-wakeflow-runtime-export": "WAKEFLOW_DEMAND_EVENT_SOURCING_SNAPSHOT_SCHEMA",
  "title": "WakeflowDemandEventSourcingSnapshot",
  "description": "Demand Event Stream 某一 immutable commit boundary 的可删除 Aggregate checkpoint。",
  "$comment": "正常 load 从最新兼容 snapshot 加载并只 replay 后续 commits；full audit 仍从 commit 1 验证完整 authority。",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "artifactKind",
    "schemaVersion",
    "aggregateVersion",
    "versionCompatibilityDigest",
    "demandId",
    "commitSequence",
    "streamRevision",
    "lastCommitDigest",
    "lastEventId",
    "lastEventDigest",
    "state",
    "stateDigest"
  ],
  "properties": {
    "artifactKind": {
      "const": "wakeflow-demand-event-sourcing-snapshot"
    },
    "schemaVersion": {
      "const": 1
    },
    "aggregateVersion": {
      "const": 1
    },
    "versionCompatibilityDigest": {
      "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
    },
    "demandId": {
      "$ref": "#/$defs/demandId"
    },
    "commitSequence": {
      "type": "integer",
      "minimum": 1,
      "maximum": 9007199254740991
    },
    "streamRevision": {
      "type": "integer",
      "minimum": 1,
      "maximum": 9007199254740991
    },
    "lastCommitDigest": {
      "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
    },
    "lastEventId": {
      "$ref": "#/$defs/eventId"
    },
    "lastEventDigest": {
      "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
    },
    "state": {
      "$ref": "urn:wakeflow:governance:demand:aggregate-state:v1"
    },
    "stateDigest": {
      "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
    }
  },
  "$defs": {
    "demandId": {
      "type": "string",
      "pattern": "^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    },
    "eventId": {
      "type": "string",
      "pattern": "^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    }
  }
} as const);
