/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/demand-published-event-data-v1.schema.json
 */

/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string

/**
 * publication.demand-published persisted event v1 的严格 payload。
 */
export interface WakeflowDemandPublishedEventDataV1 {
identityRef: "identity.json"
identityDigest: WakeflowSha256DigestText
authorityRef: "authority.json"
authorityDigest: WakeflowSha256DigestText
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
export const WAKEFLOW_DEMAND_PUBLISHED_EVENT_DATA_V1_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-sourcing:demand-published-data:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_PUBLISHED_EVENT_DATA_V1_SCHEMA\",\"title\":\"WakeflowDemandPublishedEventDataV1\",\"description\":\"publication.demand-published persisted event v1 的严格 payload。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"identityRef\",\"identityDigest\",\"authorityRef\",\"authorityDigest\"],\"properties\":{\"identityRef\":{\"const\":\"identity.json\"},\"identityDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"authorityRef\":{\"const\":\"authority.json\"},\"authorityDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}}");
