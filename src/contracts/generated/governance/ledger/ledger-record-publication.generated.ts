/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/ledger/ledger-record-publication.schema.json
 */

/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string

/**
 * Ledger immutable record publish 的自包含短期恢复计划。
 */
export interface WakeflowLedgerRecordPublication {
artifactKind: "wakeflow-ledger-record-publication"
schemaVersion: 1
family: ("requirement" | "confirmation")
recordId: string
recordRef: WakeflowPortableResourcePathText
recordDigest: WakeflowSha256DigestText
recordBytes: string
/**
 * @minItems 1
 * @maxItems 32
 */
documents: [Document, ...(Document)[]]
}
export interface Document {
path: WakeflowPortableResourcePathText
digest: WakeflowSha256DigestText
bytes: string
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
export const WAKEFLOW_LEDGER_RECORD_PUBLICATION_SCHEMA = freezeGeneratedSchema({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:wakeflow:governance:ledger:record-publication:v1",
  "x-wakeflow-runtime-export": "WAKEFLOW_LEDGER_RECORD_PUBLICATION_SCHEMA",
  "title": "WakeflowLedgerRecordPublication",
  "description": "Ledger immutable record publish 的自包含短期恢复计划。",
  "$comment": "Journal 使用 canonical unpadded base64url 保存 exact record/member bytes；恢复不依赖原 publish 调用仍持有输入。",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "artifactKind",
    "schemaVersion",
    "family",
    "recordId",
    "recordRef",
    "recordDigest",
    "recordBytes",
    "documents"
  ],
  "properties": {
    "artifactKind": {
      "const": "wakeflow-ledger-record-publication"
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
    "recordRef": {
      "$ref": "urn:wakeflow:foundation:filesystem:portable-resource-path:v1"
    },
    "recordDigest": {
      "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
    },
    "recordBytes": {
      "type": "string",
      "maxLength": 699052,
      "pattern": "^[A-Za-z0-9_-]*$"
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
    "document": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "path",
        "digest",
        "bytes"
      ],
      "properties": {
        "path": {
          "$ref": "urn:wakeflow:foundation:filesystem:portable-resource-path:v1"
        },
        "digest": {
          "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
        },
        "bytes": {
          "type": "string",
          "maxLength": 5592406,
          "pattern": "^[A-Za-z0-9_-]*$"
        }
      }
    }
  }
} as const);
