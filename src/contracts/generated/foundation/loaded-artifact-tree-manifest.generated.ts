/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/foundation/loaded-artifact-tree-manifest.schema.json
 */

/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string

/**
 * Wakeflow 已加载制品树的位置无关内容身份：按 portable ref 排序的 regular-file 摘要、字节数与 executable bit。
 */
export interface LoadedArtifactTreeManifest {
artifactKind: "wakeflow-loaded-artifact-tree"
fileCount: number
/**
 * @minItems 1
 * @maxItems 4096
 */
files: [LoadedArtifactTreeFile, ...(LoadedArtifactTreeFile)[]]
schemaVersion: 1
totalBytes: number
}
export interface LoadedArtifactTreeFile {
bytes: number
digest: WakeflowSha256DigestText
executable: boolean
ref: WakeflowPortableResourcePathText
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
export const WAKEFLOW_LOADED_ARTIFACT_TREE_MANIFEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:foundation:artifact:loaded-artifact-tree-manifest:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_LOADED_ARTIFACT_TREE_MANIFEST_SCHEMA\",\"title\":\"LoadedArtifactTreeManifest\",\"description\":\"Wakeflow 已加载制品树的位置无关内容身份：按 portable ref 排序的 regular-file 摘要、字节数与 executable bit。\",\"$comment\":\"本 Schema 只闭合 portable manifest shape。ref 的 UTF-8 字节上限、NFC/case collision、fileCount/totalBytes 派生相等、物理 no-follow 观察与两遍树稳定性由 foundation/artifact/loaded-artifact-tree-identity 运行时能力负责。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"fileCount\",\"files\",\"schemaVersion\",\"totalBytes\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-loaded-artifact-tree\"},\"fileCount\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":4096},\"files\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":4096,\"items\":{\"$ref\":\"#/$defs/loadedArtifactTreeFile\"}},\"schemaVersion\":{\"const\":1},\"totalBytes\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":268435456}},\"$defs\":{\"loadedArtifactTreeFile\":{\"title\":\"LoadedArtifactTreeFile\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"bytes\",\"digest\",\"executable\",\"ref\"],\"properties\":{\"bytes\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":33554432},\"digest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"executable\":{\"type\":\"boolean\"},\"ref\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"}}}}}");
