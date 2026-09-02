/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/managed-evidence-recorded-event-data-v1.schema.json
 */

/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
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
 * evidence.managed-evidence-recorded persisted event v1 的严格payload。
 */
export interface WakeflowManagedEvidenceRecordedEventDataV1 {
manifest: WakeflowManagedEvidenceManifest
}
/**
 * Wakeflow从已配置本地资源根捕获的一份不可变managed evidence内容与provenance清单。
 */
export interface WakeflowManagedEvidenceManifest {
artifactKind: "wakeflow-managed-evidence-manifest"
schemaVersion: 1
evidenceId: string
programId: string
demandId: string
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
windowId: string
configDigest: WakeflowSha256DigestText
}
export interface Source {
root: (RepositoryRoot | SupportSurfaceRoot)
path: WakeflowPortableResourcePathText
resourceType: ("file" | "tree")
}
export interface RepositoryRoot {
kind: "repository"
repositoryId: string
}
export interface SupportSurfaceRoot {
kind: "support-surface"
surfaceId: string
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
export const WAKEFLOW_MANAGED_EVIDENCE_RECORDED_EVENT_DATA_V1_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-sourcing:managed-evidence-recorded-data:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_MANAGED_EVIDENCE_RECORDED_EVENT_DATA_V1_SCHEMA\",\"title\":\"WakeflowManagedEvidenceRecordedEventDataV1\",\"description\":\"evidence.managed-evidence-recorded persisted event v1 的严格payload。\",\"$comment\":\"完整Manifest是已经捕获并记录的不可变Evidence事实；Aggregate只投影稳定selector，后续同ID文件是可重建资源投影。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"manifest\"],\"properties\":{\"manifest\":{\"$ref\":\"urn:wakeflow:governance:evidence:managed-evidence-manifest:v1\"}}}");
