/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/ledger/requirement-lineage.schema.json
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
 * 跨 Aggregate 绑定一份不可变需求包记录的可移植 ref/digest；Demand 身份以此记录来源需求包。
 */
export interface WakeflowRequirementLineageReference {
artifactKind: "wakeflow-requirement-lineage"
schemaVersion: 1
requirementId: string
recordRef: WakeflowPortableResourcePathText
recordDigest: WakeflowSha256DigestText
}

/** 递归冻结生成的 Schema，阻止校验器首次使用前发生嵌套漂移。 */
function freezeGeneratedSchema<Value>(value: Value): Readonly<Value> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeGeneratedSchema(child);
    Object.freeze(value);
  }
  return value;
}

/** 从 JSON 文本恢复 Schema，保留 `__proto__` 等普通 JSON 自有键。 */
function restoreGeneratedSchema(
  serialized: string,
): Readonly<Record<string, unknown>> {
  const value: unknown = JSON.parse(serialized);
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError("Generated Schema must be an object.");
  }
  return freezeGeneratedSchema(value as Record<string, unknown>);
}

/** Ajv 严格校验器使用的 Schema 派生运行时权威；不得手工修改。 */
export const WAKEFLOW_REQUIREMENT_LINEAGE_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:ledger:requirement-lineage:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_REQUIREMENT_LINEAGE_SCHEMA\",\"title\":\"WakeflowRequirementLineageReference\",\"description\":\"跨 Aggregate 绑定一份不可变需求包记录的可移植 ref/digest；Demand 身份以此记录来源需求包。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"requirementId\",\"recordRef\",\"recordDigest\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-requirement-lineage\"},\"schemaVersion\":{\"const\":1},\"requirementId\":{\"type\":\"string\",\"pattern\":\"^requirement_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"recordRef\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"recordDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}}");
