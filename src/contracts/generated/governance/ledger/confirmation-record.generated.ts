/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/ledger/confirmation-record.schema.json
 */

export type ConfirmationId = string
export type ProgramId = string
export type DemandId = string
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
 * Wakeflow Ledger 中绑定一个预分配 Demand ID 的不可变确认记录。
 */
export interface WakeflowConfirmationRecord {
artifactKind: "wakeflow-confirmation-record"
schemaVersion: 1
confirmationId: ConfirmationId
programId: ProgramId
demandId: DemandId
recordedAt: WakeflowUtcInstantText
title: NonEmptyText
/**
 * @minItems 1
 * @maxItems 32
 */
documents: [Document, ...(Document)[]]
}
export interface Document {
role: ("goal-stage-decision" | "user-confirmation" | "requirement-delta" | "supporting-evidence")
path: WakeflowPortableResourcePathText
mediaType: string
digest: WakeflowSha256DigestText
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
export const WAKEFLOW_CONFIRMATION_RECORD_SCHEMA = freezeGeneratedSchema({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:wakeflow:governance:ledger:confirmation-record:v1",
  "x-wakeflow-runtime-export": "WAKEFLOW_CONFIRMATION_RECORD_SCHEMA",
  "title": "WakeflowConfirmationRecord",
  "description": "Wakeflow Ledger 中绑定一个预分配 Demand ID 的不可变确认记录。",
  "$comment": "记录只声明 Wakeflow 写入时间，不虚构已认证的人类 actor；document role、顺序和路径关系由 Ledger codec 继续校验。",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "artifactKind",
    "schemaVersion",
    "confirmationId",
    "programId",
    "demandId",
    "recordedAt",
    "title",
    "documents"
  ],
  "properties": {
    "artifactKind": {
      "const": "wakeflow-confirmation-record"
    },
    "schemaVersion": {
      "const": 1
    },
    "confirmationId": {
      "$ref": "#/$defs/confirmationId"
    },
    "programId": {
      "$ref": "#/$defs/programId"
    },
    "demandId": {
      "$ref": "#/$defs/demandId"
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
    "confirmationId": {
      "type": "string",
      "pattern": "^confirmation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    },
    "programId": {
      "type": "string",
      "pattern": "^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
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
            "goal-stage-decision",
            "user-confirmation",
            "requirement-delta",
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
