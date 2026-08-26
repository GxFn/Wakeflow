/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/ledger/requirement-record.schema.json
 */

export type RequirementId = string
export type ProgramId = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
export type NonEmptyText = string
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string

/**
 * Wakeflow Ledger 中一次确认后不可变的 requirement authority record。
 */
export interface WakeflowRequirementRecord {
artifactKind: "wakeflow-requirement-record"
schemaVersion: 1
requirementId: RequirementId
programId: ProgramId
recordedAt: WakeflowUtcInstantText
title: NonEmptyText
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

/** 递归冻结生成的 Schema，阻止 validator 首次消费前发生嵌套漂移。 */
function freezeGeneratedSchema<Value>(value: Value): Readonly<Value> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeGeneratedSchema(child);
    Object.freeze(value);
  }
  return value;
}

/** Ajv strict validator 使用的 Schema 派生运行时权威；不得手工修改。 */
export const WAKEFLOW_REQUIREMENT_RECORD_SCHEMA = freezeGeneratedSchema({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:wakeflow:governance:ledger:requirement-record:v1",
  "x-wakeflow-runtime-export": "WAKEFLOW_REQUIREMENT_RECORD_SCHEMA",
  "title": "WakeflowRequirementRecord",
  "description": "Wakeflow Ledger 中一次确认后不可变的 requirement authority record。",
  "$comment": "Schema 负责 portable structure；document role、顺序、路径前缀冲突和领域 representation 由 Ledger codec 继续校验。",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "artifactKind",
    "schemaVersion",
    "requirementId",
    "programId",
    "recordedAt",
    "title",
    "documents"
  ],
  "properties": {
    "artifactKind": {
      "const": "wakeflow-requirement-record"
    },
    "schemaVersion": {
      "const": 1
    },
    "requirementId": {
      "$ref": "#/$defs/requirementId"
    },
    "programId": {
      "$ref": "#/$defs/programId"
    },
    "recordedAt": {
      "$ref": "urn:wakeflow:foundation:time:utc-instant:v1"
    },
    "title": {
      "$ref": "#/$defs/nonEmptyText"
    },
    "documents": {
      "type": "array",
      "minItems": 1,
      "maxItems": 32,
      "items": {
        "$ref": "#/$defs/document"
      }
    }
  },
  "$defs": {
    "requirementId": {
      "type": "string",
      "pattern": "^requirement_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    },
    "programId": {
      "type": "string",
      "pattern": "^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    },
    "nonEmptyText": {
      "type": "string",
      "minLength": 1,
      "maxLength": 8192,
      "pattern": "^(?!\\s)[\\s\\S]*\\S$"
    },
    "document": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "role",
        "path",
        "mediaType",
        "digest"
      ],
      "properties": {
        "role": {
          "enum": [
            "original-plan",
            "requirement-design",
            "code-facts",
            "landing-plan",
            "non-goals",
            "user-confirmation",
            "reproduction",
            "scope",
            "requirement-delta",
            "research-question",
            "boundaries",
            "test-environment",
            "supporting-evidence"
          ]
        },
        "path": {
          "$ref": "urn:wakeflow:foundation:filesystem:portable-resource-path:v1"
        },
        "mediaType": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$"
        },
        "digest": {
          "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
        }
      }
    }
  }
} as const);
