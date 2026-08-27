/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/ledger/ledger-record-publication-intent.schema.json
 */

/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string

/**
 * Ledger immutable record tree 整体发布的短期元数据意图。
 */
export interface WakeflowLedgerRecordPublicationIntent {
artifactKind: "wakeflow-ledger-record-publication-intent"
schemaVersion: 1
family: ("requirement" | "confirmation")
recordId: string
record: (WakeflowRequirementRecord | WakeflowConfirmationRecord)
finalRootRef: WakeflowPortableResourcePathText
intentRef: WakeflowPortableResourcePathText
lockRef: WakeflowPortableResourcePathText
stageRef: WakeflowPortableResourcePathText
treePlan: WakeflowDirectoryTreeCandidatePlan
}
/**
 * Wakeflow Ledger 中一次确认后不可变的 requirement authority record。
 */
export interface WakeflowRequirementRecord {
artifactKind: "wakeflow-requirement-record"
schemaVersion: 1
requirementId: string
programId: string
recordedAt: WakeflowUtcInstantText
title: string
/**
 * @minItems 1
 * @maxItems 32
 */
documents: [Document, ...(Document)[]]
}
export interface Document {
role: ("original-plan" | "requirement-design" | "code-facts" | "landing-plan" | "non-goals" | "user-confirmation" | "reproduction" | "scope" | "requirement-delta" | "research-question" | "boundaries" | "test-environment" | "supporting-evidence")
path: WakeflowPortableResourcePathText
mediaType: string
digest: WakeflowSha256DigestText
}
/**
 * Wakeflow Ledger 中绑定一个预分配 Demand ID 的不可变确认记录。
 */
export interface WakeflowConfirmationRecord {
artifactKind: "wakeflow-confirmation-record"
schemaVersion: 1
confirmationId: string
programId: string
demandId: string
recordedAt: WakeflowUtcInstantText
title: string
/**
 * @minItems 1
 * @maxItems 32
 */
documents: [Document1, ...(Document1)[]]
}
export interface Document1 {
role: ("goal-stage-decision" | "user-confirmation" | "requirement-delta" | "supporting-evidence")
path: WakeflowPortableResourcePathText
mediaType: string
digest: WakeflowSha256DigestText
}
/**
 * 可整体发布的关闭目录树候选元数据计划。
 */
export interface WakeflowDirectoryTreeCandidatePlan {
artifactKind: "wakeflow-directory-tree-candidate-plan"
schemaVersion: 1
directoryMode: number
/**
 * @maxItems 8192
 */
directories: WakeflowPortableResourcePathText[]
/**
 * @minItems 1
 * @maxItems 4096
 */
files: [File, ...(File)[]]
totalBytes: number
treeDigest: WakeflowSha256DigestText
}
export interface File {
path: WakeflowPortableResourcePathText
byteCount: number
digest: WakeflowSha256DigestText
mode: number
}

/** 递归冻结生成的 Schema，阻止校验器首次使用前发生嵌套漂移。 */
function freezeGeneratedSchema<Value>(value: Value): Readonly<Value> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeGeneratedSchema(child);
    Object.freeze(value);
  }
  return value;
}

/** Ajv 严格校验器使用的 Schema 派生运行时权威；不得手工修改。 */
export const WAKEFLOW_LEDGER_RECORD_PUBLICATION_INTENT_SCHEMA = freezeGeneratedSchema({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:wakeflow:governance:ledger:record-publication-intent:v1",
  "x-wakeflow-runtime-export": "WAKEFLOW_LEDGER_RECORD_PUBLICATION_INTENT_SCHEMA",
  "title": "WakeflowLedgerRecordPublicationIntent",
  "description": "Ledger immutable record tree 整体发布的短期元数据意图。",
  "$comment": "Intent 保存 exact record 与关闭树摘要，但不复制 member payload；完整 stage 是待发布数据，final directory rename 是 authority commit point。",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "artifactKind",
    "schemaVersion",
    "family",
    "recordId",
    "record",
    "finalRootRef",
    "intentRef",
    "lockRef",
    "stageRef",
    "treePlan"
  ],
  "properties": {
    "artifactKind": {
      "const": "wakeflow-ledger-record-publication-intent"
    },
    "schemaVersion": {
      "const": 1
    },
    "family": {
      "enum": [
        "requirement",
        "confirmation"
      ]
    },
    "recordId": {
      "oneOf": [
        {
          "type": "string",
          "pattern": "^requirement_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
        },
        {
          "type": "string",
          "pattern": "^confirmation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
        }
      ]
    },
    "record": {
      "oneOf": [
        {
          "$ref": "urn:wakeflow:governance:ledger:requirement-record:v1"
        },
        {
          "$ref": "urn:wakeflow:governance:ledger:confirmation-record:v1"
        }
      ]
    },
    "finalRootRef": {
      "$ref": "urn:wakeflow:foundation:filesystem:portable-resource-path:v1"
    },
    "intentRef": {
      "$ref": "urn:wakeflow:foundation:filesystem:portable-resource-path:v1"
    },
    "lockRef": {
      "$ref": "urn:wakeflow:foundation:filesystem:portable-resource-path:v1"
    },
    "stageRef": {
      "$ref": "urn:wakeflow:foundation:filesystem:portable-resource-path:v1"
    },
    "treePlan": {
      "$ref": "urn:wakeflow:foundation:filesystem:directory-tree-candidate-plan:v1"
    }
  }
} as const);
