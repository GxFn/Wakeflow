/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/evidence/managed-evidence-publication-transaction.schema.json
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
export type DemandEventId = string
export type DemandEventCommitId = string

/**
 * Managed Evidence record tree与Demand Event Sourcing追加之间的不可变恢复计划。
 */
export interface WakeflowManagedEvidencePublicationTransaction {
artifactKind: "wakeflow-managed-evidence-publication-transaction"
schemaVersion: 1
capturePlanDigest: WakeflowSha256DigestText
manifest: WakeflowManagedEvidenceManifest
recordTreePlanDigest: WakeflowSha256DigestText
demandEventSourcingAppend: DemandEventSourcingAppend
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
export interface DemandEventSourcingAppend {
expectedStreamRevision: number
expectedStateDigest: WakeflowSha256DigestText
expectedLastEventId: DemandEventId
expectedLastEventDigest: WakeflowSha256DigestText
eventId: DemandEventId
commandDigest: WakeflowSha256DigestText
commitId: DemandEventCommitId
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
export const WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:evidence:managed-evidence-publication-transaction:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_SCHEMA\",\"title\":\"WakeflowManagedEvidencePublicationTransaction\",\"description\":\"Managed Evidence record tree与Demand Event Sourcing追加之间的不可变恢复计划。\",\"$comment\":\"Transaction不保存可变phase，也不重复保存可由Manifest派生的Demand/Evidence ID、stage/final路径、Event command或完整record tree plan。capturePlanDigest闭合已确认preview；recordTreePlanDigest闭合待物化目录；demandEventSourcingAppend保存乐观追加所需的exact source expectation与稳定ID。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"capturePlanDigest\",\"manifest\",\"recordTreePlanDigest\",\"demandEventSourcingAppend\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-managed-evidence-publication-transaction\"},\"schemaVersion\":{\"const\":1},\"capturePlanDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"manifest\":{\"$ref\":\"urn:wakeflow:governance:evidence:managed-evidence-manifest:v1\"},\"recordTreePlanDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"demandEventSourcingAppend\":{\"$ref\":\"#/$defs/demandEventSourcingAppend\"}},\"$defs\":{\"demandEventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandEventCommitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandEventSourcingAppend\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"expectedStreamRevision\",\"expectedStateDigest\",\"expectedLastEventId\",\"expectedLastEventDigest\",\"eventId\",\"commandDigest\",\"commitId\"],\"properties\":{\"expectedStreamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740990},\"expectedStateDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"expectedLastEventId\":{\"$ref\":\"#/$defs/demandEventId\"},\"expectedLastEventDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"eventId\":{\"$ref\":\"#/$defs/demandEventId\"},\"commandDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"commitId\":{\"$ref\":\"#/$defs/demandEventCommitId\"}}}}}");
