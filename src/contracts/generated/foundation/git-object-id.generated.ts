/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/foundation/git-object-id.schema.json
 */

/**
 * Git完整对象身份及其显式对象格式；支持SHA-1和SHA-256仓库。
 */
export type WakeflowGitObjectId = (Sha1 | Sha256)

export interface Sha1 {
algorithm: "sha1"
value: string
}
export interface Sha256 {
algorithm: "sha256"
value: string
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
export const WAKEFLOW_GIT_OBJECT_ID_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:foundation:version-control:git-object-id:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_GIT_OBJECT_ID_SCHEMA\",\"title\":\"WakeflowGitObjectId\",\"description\":\"Git完整对象身份及其显式对象格式；支持SHA-1和SHA-256仓库。\",\"$comment\":\"本合同只拥有完整object ID词法，不执行rev解析、对象存在性、commit类型、repository选择或Git进程调用。\",\"oneOf\":[{\"$ref\":\"#/$defs/sha1\"},{\"$ref\":\"#/$defs/sha256\"}],\"$defs\":{\"sha1\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"algorithm\",\"value\"],\"properties\":{\"algorithm\":{\"const\":\"sha1\"},\"value\":{\"type\":\"string\",\"pattern\":\"^[0-9a-f]{40}$\"}}},\"sha256\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"algorithm\",\"value\"],\"properties\":{\"algorithm\":{\"const\":\"sha256\"},\"value\":{\"type\":\"string\",\"pattern\":\"^[0-9a-f]{64}$\"}}}}}");
