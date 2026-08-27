/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/demand-event-sourcing-publication-transaction.schema.json
 */

export type DemandId = string
/**
 * TODO intake 使用的稳定、用户可读 opaque ID；允许字母、数字、点、下划线、冒号和连字符，不从标题或路径推导。
 */
export type WakeflowTodoItemIdText = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
export type EventId = string

/**
 * TODO-backed Demand Event Sourcing root publication 的自包含 immutable recovery plan。
 */
export interface WakeflowDemandEventSourcingPublicationTransaction {
artifactKind: "wakeflow-demand-event-sourcing-publication-transaction"
schemaVersion: 1
demandId: DemandId
todoId: WakeflowTodoItemIdText
expectedTodoCollectionDigest: WakeflowSha256DigestText
expectedTodoStateDigest: WakeflowSha256DigestText
stageRef: WakeflowPortableResourcePathText
finalRootRef: WakeflowPortableResourcePathText
identity: WakeflowDemandIdentity
identityDigest: WakeflowSha256DigestText
authority: WakeflowDemandAuthority
authorityDigest: WakeflowSha256DigestText
initialCommand: InitialCommand
initialCommandDigest: WakeflowSha256DigestText
initialCommit: WakeflowDemandEventStreamCommit
initialCommitDigest: WakeflowSha256DigestText
}
/**
 * Demand Event Sourcing Aggregate 创建后不可变的 identity authority。
 */
export interface WakeflowDemandIdentity {
artifactKind: "wakeflow-demand-identity"
schemaVersion: 1
programId: string
demandId: string
createdAt: WakeflowUtcInstantText
title: string
goal: string
completionDefinition: string
demandType: ("requirement" | "bug" | "supplement" | "research")
source: WakeflowTodoIntakeLineageReference
executionPlacement: (MainPlacement | IsolatedPlacement)
}
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
export interface MainPlacement {
mode: "main"
}
export interface IsolatedPlacement {
mode: "isolated"
authorizationRef: WakeflowLedgerAuthorityMemberReference
}
/**
 * 跨领域只读消费一份已验证 Ledger authority member 的完整 ref/digest 关系。
 */
export interface WakeflowLedgerAuthorityMemberReference {
artifactKind: "wakeflow-ledger-authority-member-reference"
schemaVersion: 1
family: ("requirement" | "confirmation")
recordId: string
recordRef: WakeflowPortableResourcePathText
recordDigest: WakeflowSha256DigestText
memberPath: WakeflowPortableResourcePathText
memberRef: WakeflowPortableResourcePathText
memberDigest: WakeflowSha256DigestText
role: ("original-plan" | "requirement-design" | "code-facts" | "landing-plan" | "non-goals" | "user-confirmation" | "reproduction" | "scope" | "requirement-delta" | "research-question" | "boundaries" | "test-environment" | "supporting-evidence" | "goal-stage-decision")
mediaType: string
}
/**
 * Demand publication 时必须存在并永久冻结的 Ledger authority closure。
 */
export interface WakeflowDemandAuthority {
artifactKind: "wakeflow-demand-authority"
schemaVersion: 1
demandId: string
identityDigest: WakeflowSha256DigestText
/**
 * @minItems 1
 * @maxItems 32
 */
authorityRefs: [WakeflowLedgerAuthorityMemberReference, ...(WakeflowLedgerAuthorityMemberReference)[]]
testingDecision: TestingDecision
}
export interface TestingDecision {
mode: ("controller-only" | "real-environment" | "not-applicable")
summary: string
environmentMemberRef: (null | WakeflowPortableResourcePathText)
}
export interface InitialCommand {
commandType: "publication.publish-demand"
commandVersion: 1
demandId: DemandId
eventId: EventId
recordedAt: WakeflowUtcInstantText
identityDigest: WakeflowSha256DigestText
authorityDigest: WakeflowSha256DigestText
}
/**
 * 一次 Demand Event Store append 的不可变、原子 commit batch。
 */
export interface WakeflowDemandEventStreamCommit {
artifactKind: "wakeflow-demand-event-stream-commit"
schemaVersion: 1
commitId: string
demandId: string
commitSequence: number
commandDigest: WakeflowSha256DigestText
expectedStreamRevision: number
firstStreamRevision: number
lastStreamRevision: number
previousCommitDigest: (null | WakeflowSha256DigestText)
/**
 * @minItems 1
 * @maxItems 64
 */
events: [WakeflowDemandEventSourcingStoredEvent, ...(WakeflowDemandEventSourcingStoredEvent)[]]
}
/**
 * Demand Event Store 中稳定的 persisted event envelope；eventType 与 eventVersion 由版本 Registry 路由到严格 payload codec。
 */
export interface WakeflowDemandEventSourcingStoredEvent {
artifactKind: "wakeflow-demand-event-sourcing-event"
schemaVersion: 1
eventId: string
demandId: string
streamRevision: number
recordedAt: WakeflowUtcInstantText
eventType: string
eventVersion: number
data: {
[k: string]: unknown | undefined
}
resultingStateModelVersion: number
resultingStateDigest: WakeflowSha256DigestText
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
export const WAKEFLOW_DEMAND_EVENT_SOURCING_PUBLICATION_TRANSACTION_SCHEMA = freezeGeneratedSchema({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:wakeflow:governance:demand:event-sourcing-publication-transaction:v1",
  "x-wakeflow-runtime-export": "WAKEFLOW_DEMAND_EVENT_SOURCING_PUBLICATION_TRANSACTION_SCHEMA",
  "title": "WakeflowDemandEventSourcingPublicationTransaction",
  "description": "TODO-backed Demand Event Sourcing root publication 的自包含 immutable recovery plan。",
  "$comment": "Plan 保存 initial command 与由纯 Decider/evolve 得到的 exact commit；snapshot 是 derived cache，不进入跨资源 transaction authority。",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "artifactKind",
    "schemaVersion",
    "demandId",
    "todoId",
    "expectedTodoCollectionDigest",
    "expectedTodoStateDigest",
    "stageRef",
    "finalRootRef",
    "identity",
    "identityDigest",
    "authority",
    "authorityDigest",
    "initialCommand",
    "initialCommandDigest",
    "initialCommit",
    "initialCommitDigest"
  ],
  "properties": {
    "artifactKind": {
      "const": "wakeflow-demand-event-sourcing-publication-transaction"
    },
    "schemaVersion": {
      "const": 1
    },
    "demandId": {
      "$ref": "#/$defs/demandId"
    },
    "todoId": {
      "$ref": "urn:wakeflow:governance:todo:item-id:v1"
    },
    "expectedTodoCollectionDigest": {
      "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
    },
    "expectedTodoStateDigest": {
      "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
    },
    "stageRef": {
      "$ref": "urn:wakeflow:foundation:filesystem:portable-resource-path:v1"
    },
    "finalRootRef": {
      "$ref": "urn:wakeflow:foundation:filesystem:portable-resource-path:v1"
    },
    "identity": {
      "$ref": "urn:wakeflow:governance:demand:identity:v1"
    },
    "identityDigest": {
      "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
    },
    "authority": {
      "$ref": "urn:wakeflow:governance:demand:authority:v1"
    },
    "authorityDigest": {
      "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
    },
    "initialCommand": {
      "$ref": "#/$defs/initialCommand"
    },
    "initialCommandDigest": {
      "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
    },
    "initialCommit": {
      "$ref": "urn:wakeflow:governance:demand:event-stream-commit:v1"
    },
    "initialCommitDigest": {
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
    },
    "initialCommand": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "commandType",
        "commandVersion",
        "demandId",
        "eventId",
        "recordedAt",
        "identityDigest",
        "authorityDigest"
      ],
      "properties": {
        "commandType": {
          "const": "publication.publish-demand"
        },
        "commandVersion": {
          "const": 1
        },
        "demandId": {
          "$ref": "#/$defs/demandId"
        },
        "eventId": {
          "$ref": "#/$defs/eventId"
        },
        "recordedAt": {
          "$ref": "urn:wakeflow:foundation:time:utc-instant:v1"
        },
        "identityDigest": {
          "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
        },
        "authorityDigest": {
          "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
        }
      }
    }
  }
} as const);
