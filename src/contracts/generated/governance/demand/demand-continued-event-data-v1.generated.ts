/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/demand-continued-event-data-v1.schema.json
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
 * lifecycle.demand-continued persisted event v1 的严格 payload：从归档重开一个已完成 Demand 的续接谱系。
 */
export interface WakeflowDemandContinuedEventDataV1 {
continuation: {
kind: ("optimization" | "requirement-supplement" | "verified-bug")
summary: string
archiveRef: WakeflowPortableResourcePathText
archiveManifestDigest: WakeflowSha256DigestText
previousStreamRevision: number
}
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
export const WAKEFLOW_DEMAND_CONTINUED_EVENT_DATA_V1_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-sourcing:demand-continued-data:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_CONTINUED_EVENT_DATA_V1_SCHEMA\",\"title\":\"WakeflowDemandContinuedEventDataV1\",\"description\":\"lifecycle.demand-continued persisted event v1 的严格 payload：从归档重开一个已完成 Demand 的续接谱系。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"continuation\"],\"properties\":{\"continuation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"summary\",\"archiveRef\",\"archiveManifestDigest\",\"previousStreamRevision\"],\"properties\":{\"kind\":{\"enum\":[\"optimization\",\"requirement-supplement\",\"verified-bug\"]},\"summary\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":4096,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"archiveRef\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"archiveManifestDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"previousStreamRevision\":{\"type\":\"integer\",\"minimum\":2,\"maximum\":9007199254740991}}}}}");
