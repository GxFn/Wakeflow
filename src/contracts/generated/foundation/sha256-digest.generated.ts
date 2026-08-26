/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/foundation/sha256-digest.schema.json
 */

/** Wakeflow SHA-256 digest 的 Schema 派生正则源。 */
export const SHA256_DIGEST_PATTERN_SOURCE = "^sha256:[0-9a-f]{64}$" as const;

/** Schema 层的完整 SHA-256 digest 文本；运行时解析后再授予品牌类型。 */
export type WakeflowSha256DigestText = string;

/** 递归冻结生成的 Schema，阻止 validator 首次消费前发生嵌套漂移。 */
function freezeGeneratedSchema<Value>(value: Value): Readonly<Value> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeGeneratedSchema(child);
    Object.freeze(value);
  }
  return value;
}

/** Ajv strict validator 使用的 Schema 派生运行时权威；不得手工修改。 */
export const WAKEFLOW_SHA256_DIGEST_SCHEMA = freezeGeneratedSchema({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:wakeflow:foundation:crypto:sha256-digest:v1",
  "x-wakeflow-runtime-export": "WAKEFLOW_SHA256_DIGEST_SCHEMA",
  "title": "WakeflowSha256DigestText",
  "description": "Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。",
  "$comment": "摘要只证明 exact bytes 或 canonical semantics 的相等性；它不是签名、授权、来源真实性或抗恶意篡改证明。",
  "type": "string",
  "pattern": "^sha256:[0-9a-f]{64}$",
  "examples": [
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  ]
} as const);
