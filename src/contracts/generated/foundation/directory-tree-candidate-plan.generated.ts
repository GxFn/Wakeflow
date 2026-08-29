/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/foundation/directory-tree-candidate-plan.schema.json
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
 * 可整体发布的关闭目录树候选元数据计划。
 */
export interface WakeflowDirectoryTreeCandidatePlan {
artifactKind: "wakeflow-directory-tree-candidate-plan"
schemaVersion: 1
directoryMode: number
/**
 * @maxItems 8192
 */
directories: WakeflowPortableResourcePathText[]
/**
 * @minItems 1
 * @maxItems 4096
 */
files: [File, ...(File)[]]
totalBytes: number
treeDigest: WakeflowSha256DigestText
}
export interface File {
path: WakeflowPortableResourcePathText
byteCount: number
digest: WakeflowSha256DigestText
mode: number
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
export const WAKEFLOW_DIRECTORY_TREE_CANDIDATE_PLAN_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:foundation:filesystem:directory-tree-candidate-plan:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DIRECTORY_TREE_CANDIDATE_PLAN_SCHEMA\",\"title\":\"WakeflowDirectoryTreeCandidatePlan\",\"description\":\"可整体发布的关闭目录树候选元数据计划。\",\"$comment\":\"Schema 同步闭合 v1 文件数与字节硬上限；owner 可遍历目录/文件所需的权限位、UTF-8 路径字节数、深度、目录与文件合计、严格排序、目录派生、摘要关系和物理树复验由 directory-tree-candidate 运行时能力负责。业务 owner 只能进一步收紧容量。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"directoryMode\",\"directories\",\"files\",\"totalBytes\",\"treeDigest\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-directory-tree-candidate-plan\"},\"schemaVersion\":{\"const\":1},\"directoryMode\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":511},\"directories\":{\"type\":\"array\",\"maxItems\":8192,\"items\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"}},\"files\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":4096,\"items\":{\"$ref\":\"#/$defs/file\"}},\"totalBytes\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":268435456},\"treeDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}},\"$defs\":{\"file\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"path\",\"byteCount\",\"digest\",\"mode\"],\"properties\":{\"path\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"byteCount\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":33554432},\"digest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"mode\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":511}}}}}");
