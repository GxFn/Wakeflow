/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/ledger/ledger-authority-member-reference.schema.json
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

/** 递归冻结生成的 Schema，阻止校验器首次使用前发生嵌套漂移。 */
function freezeGeneratedSchema<Value>(value: Value): Readonly<Value> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeGeneratedSchema(child);
    Object.freeze(value);
  }
  return value;
}

/** Ajv 严格校验器使用的 Schema 派生运行时权威；不得手工修改。 */
export const WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA = freezeGeneratedSchema({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:wakeflow:governance:ledger:authority-member-reference:v1",
  "x-wakeflow-runtime-export": "WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA",
  "title": "WakeflowLedgerAuthorityMemberReference",
  "description": "跨领域只读消费一份已验证 Ledger authority member 的完整 ref/digest 关系。",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "artifactKind",
    "schemaVersion",
    "family",
    "recordId",
    "recordRef",
    "recordDigest",
    "memberPath",
    "memberRef",
    "memberDigest",
    "role",
    "mediaType"
  ],
  "properties": {
    "artifactKind": {
      "const": "wakeflow-ledger-authority-member-reference"
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
    "memberPath": {
      "$ref": "urn:wakeflow:foundation:filesystem:portable-resource-path:v1"
    },
    "memberRef": {
      "$ref": "urn:wakeflow:foundation:filesystem:portable-resource-path:v1"
    },
    "memberDigest": {
      "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
    },
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
        "supporting-evidence",
        "goal-stage-decision"
      ]
    },
    "mediaType": {
      "type": "string",
      "pattern": "^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$"
    }
  }
} as const);
