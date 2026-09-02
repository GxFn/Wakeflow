/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/evidence/managed-evidence-manifest.schema.json
 */

export type EvidenceId = string
export type ProgramId = string
export type DemandId = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
export type WindowId = string
export type RepositoryId = string
export type SurfaceId = string
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string
export type ContentReview = ({
[k: string]: unknown | undefined
} & {
disposition: ("controller-confirmed" | "not-required")
/**
 * @maxItems 4095
 */
opaqueFileRefs: WakeflowPortableResourcePathText[]
})

/**
 * Wakeflow从已配置本地资源根捕获的一份不可变managed evidence内容与provenance清单。
 */
export interface WakeflowManagedEvidenceManifest {
artifactKind: "wakeflow-managed-evidence-manifest"
schemaVersion: 1
evidenceId: EvidenceId
programId: ProgramId
demandId: DemandId
demandAuthorityDigest: WakeflowSha256DigestText
/**
 * 用于审阅和检索的领域标签；未知标签不得被消费者解释为权限、充分性或验收策略。
 */
evidenceType: string
capturedAt: WakeflowUtcInstantText
recordedBy: RecordedBy
source: Source
sensitivity: ("internal" | "public")
payload: Payload
contentReview: ContentReview
manifestDigest: WakeflowSha256DigestText
}
export interface RecordedBy {
windowId: WindowId
configDigest: WakeflowSha256DigestText
}
export interface Source {
root: (RepositoryRoot | SupportSurfaceRoot)
path: WakeflowPortableResourcePathText
resourceType: ("file" | "tree")
}
export interface RepositoryRoot {
kind: "repository"
repositoryId: RepositoryId
}
export interface SupportSurfaceRoot {
kind: "support-surface"
surfaceId: SurfaceId
}
export interface Payload {
artifactDigest: WakeflowSha256DigestText
treeManifest: LoadedArtifactTreeManifest
}
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
export const WAKEFLOW_MANAGED_EVIDENCE_MANIFEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:evidence:managed-evidence-manifest:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_MANAGED_EVIDENCE_MANIFEST_SCHEMA\",\"title\":\"WakeflowManagedEvidenceManifest\",\"description\":\"Wakeflow从已配置本地资源根捕获的一份不可变managed evidence内容与provenance清单。\",\"$comment\":\"本Schema闭合portable manifest shape。typed ID、真实UTC、NFC、payload artifactDigest、file-source单文件映射、opaque ref子集/顺序、为final record的manifest.json与payload/前缀预留的容量，以及manifestDigest由governance/evidence/managed-evidence-manifest运行时codec复验。Manifest不包含payload字节、外部URL/Git locator、Event位置、Controller acceptance或隐含privacy scan结论。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"evidenceId\",\"programId\",\"demandId\",\"demandAuthorityDigest\",\"evidenceType\",\"capturedAt\",\"recordedBy\",\"source\",\"sensitivity\",\"payload\",\"contentReview\",\"manifestDigest\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-managed-evidence-manifest\"},\"schemaVersion\":{\"const\":1},\"evidenceId\":{\"$ref\":\"#/$defs/evidenceId\"},\"programId\":{\"$ref\":\"#/$defs/programId\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"demandAuthorityDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"evidenceType\":{\"$ref\":\"#/$defs/token\",\"description\":\"用于审阅和检索的领域标签；未知标签不得被消费者解释为权限、充分性或验收策略。\"},\"capturedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"recordedBy\":{\"$ref\":\"#/$defs/recordedBy\"},\"source\":{\"$ref\":\"#/$defs/source\"},\"sensitivity\":{\"enum\":[\"internal\",\"public\"]},\"payload\":{\"$ref\":\"#/$defs/payload\"},\"contentReview\":{\"$ref\":\"#/$defs/contentReview\"},\"manifestDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}},\"$defs\":{\"evidenceId\":{\"type\":\"string\",\"pattern\":\"^evidence_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"surfaceId\":{\"type\":\"string\",\"pattern\":\"^surface_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"token\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"recordedBy\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"windowId\",\"configDigest\"],\"properties\":{\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"configDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"source\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"path\",\"resourceType\"],\"properties\":{\"root\":{\"oneOf\":[{\"$ref\":\"#/$defs/repositoryRoot\"},{\"$ref\":\"#/$defs/supportSurfaceRoot\"}]},\"path\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"resourceType\":{\"enum\":[\"file\",\"tree\"]}}},\"repositoryRoot\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"repositoryId\"],\"properties\":{\"kind\":{\"const\":\"repository\"},\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"}}},\"supportSurfaceRoot\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"surfaceId\"],\"properties\":{\"kind\":{\"const\":\"support-surface\"},\"surfaceId\":{\"$ref\":\"#/$defs/surfaceId\"}}},\"payload\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactDigest\",\"treeManifest\"],\"properties\":{\"artifactDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"treeManifest\":{\"$ref\":\"urn:wakeflow:foundation:artifact:loaded-artifact-tree-manifest:v1\"}}},\"contentReview\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"disposition\",\"opaqueFileRefs\"],\"properties\":{\"disposition\":{\"enum\":[\"controller-confirmed\",\"not-required\"]},\"opaqueFileRefs\":{\"type\":\"array\",\"maxItems\":4095,\"uniqueItems\":true,\"items\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"}}},\"allOf\":[{\"if\":{\"properties\":{\"disposition\":{\"const\":\"not-required\"}},\"required\":[\"disposition\"]},\"then\":{\"properties\":{\"opaqueFileRefs\":{\"type\":\"array\",\"maxItems\":0}}},\"else\":{\"properties\":{\"opaqueFileRefs\":{\"type\":\"array\",\"minItems\":1}}}}]}}}");
