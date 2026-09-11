/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-record-evidence-request.schema.json
 */

/**
 * Effect-shaped request recording one immutable managed evidence record for an active Demand: preview derives the plan without writing, apply recomputes the same plan from the same selection and executes it when the plan digest matches, recover finishes an interrupted publication by demandId.
 */
export type WakeflowRecordEvidenceRequestV1 = (EffectRequest | RecoverRequest)
/**
 * Absolute path of the existing Wakeflow workspace root.
 */
export type WorkspaceRoot = string
export type Sha256Digest = string
export type DemandId = string
export type EvidenceKind = ("hook-observation" | "transcript" | "test-output" | "diff" | "document" | "link" | "commit")
export type RepositoryId = string
export type SurfaceId = string
export type PodId = string
export type PortableResourcePath = string
export type HostId = ("codex" | "claude-code")
export type RecordId = string
export type HttpsUrl = string
export type CommitOid = string

export interface EffectRequest {
root: WorkspaceRoot
mode: ("preview" | "apply")
planDigest?: Sha256Digest
demandId: DemandId
selection: Selection
}
export interface Selection {
kind: EvidenceKind
source: (ManagedPathSource | ObservationSelection | LinkSource | CommitSource)
contentReview: ("reject" | "controller-confirmed")
}
/**
 * Copy one file or one directory tree from a configured repository or support-surface root, or from a worktree pod's registered checkout.
 */
export interface ManagedPathSource {
kind: "managed-path"
root: (RepositoryRoot | SupportSurfaceRoot | PodWorktreeRoot)
path: PortableResourcePath
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
/**
 * The git worktree checkout a worktree pod's product window registered for one repository; resolved through the pod's worktree receipt.
 */
export interface PodWorktreeRoot {
kind: "pod-worktree"
podId: PodId
repositoryId: RepositoryId
}
/**
 * Reference one host hook observation record of this workspace by host and record id.
 */
export interface ObservationSelection {
kind: "observation"
hostId: HostId
recordId: RecordId
}
/**
 * Reference an https resource by URL; Wakeflow never fetches it. The optional digest is caller-supplied.
 */
export interface LinkSource {
kind: "link"
url: HttpsUrl
digest?: Sha256Digest
}
/**
 * Reference one commit of a configured repository by object id; Wakeflow never reads git objects.
 */
export interface CommitSource {
kind: "commit"
repositoryId: RepositoryId
commitOid: CommitOid
}
export interface RecoverRequest {
root: WorkspaceRoot
mode: "recover"
demandId: DemandId
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
export const WAKEFLOW_RECORD_EVIDENCE_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:record-evidence-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_RECORD_EVIDENCE_REQUEST_SCHEMA\",\"title\":\"WakeflowRecordEvidenceRequestV1\",\"description\":\"Effect-shaped request recording one immutable managed evidence record for an active Demand: preview derives the plan without writing, apply recomputes the same plan from the same selection and executes it when the plan digest matches, recover finishes an interrupted publication by demandId.\",\"$comment\":\"The selection names a kind from the closed vocabulary and one of four sources: managed-path copies bytes from a configured root; observation projects one host hook record without its session handle or working directory; link and commit are reference-only. contentReview=controller-confirmed lets opaque members and non-credential privacy findings through; credential findings always block.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/effectRequest\"},{\"$ref\":\"#/$defs/recoverRequest\"}],\"$defs\":{\"workspaceRoot\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"evidenceId\":{\"type\":\"string\",\"pattern\":\"^evidence_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"surfaceId\":{\"type\":\"string\",\"pattern\":\"^surface_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":4096,\"pattern\":\"^(?!\\\\.\\\\.?(?:/|$))[^/\\\\u0000]+(?:/(?!\\\\.\\\\.?(?:/|$))[^/\\\\u0000]+)*$\"},\"evidenceKind\":{\"enum\":[\"hook-observation\",\"transcript\",\"test-output\",\"diff\",\"document\",\"link\",\"commit\"]},\"hostId\":{\"enum\":[\"codex\",\"claude-code\"]},\"recordId\":{\"type\":\"string\",\"pattern\":\"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"hookEvent\":{\"enum\":[\"session-start\",\"user-prompt-submit\",\"stop\",\"session-end\",\"turn-complete\"]},\"commitOid\":{\"type\":\"string\",\"pattern\":\"^(?:[0-9a-f]{40}|[0-9a-f]{64})$\"},\"httpsUrl\":{\"type\":\"string\",\"minLength\":9,\"maxLength\":2048,\"pattern\":\"^https://[^\\\\s\\\"'`<>]+$\"},\"repositoryRoot\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"repositoryId\"],\"properties\":{\"kind\":{\"const\":\"repository\"},\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"}}},\"supportSurfaceRoot\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"surfaceId\"],\"properties\":{\"kind\":{\"const\":\"support-surface\"},\"surfaceId\":{\"$ref\":\"#/$defs/surfaceId\"}}},\"managedPathSource\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"root\",\"path\",\"resourceType\"],\"description\":\"Copy one file or one directory tree from a configured repository or support-surface root, or from a worktree pod's registered checkout.\",\"properties\":{\"kind\":{\"const\":\"managed-path\"},\"root\":{\"oneOf\":[{\"$ref\":\"#/$defs/repositoryRoot\"},{\"$ref\":\"#/$defs/supportSurfaceRoot\"},{\"$ref\":\"#/$defs/podWorktreeRoot\"}]},\"path\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"resourceType\":{\"enum\":[\"file\",\"tree\"]}}},\"linkSource\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"url\"],\"description\":\"Reference an https resource by URL; Wakeflow never fetches it. The optional digest is caller-supplied.\",\"properties\":{\"kind\":{\"const\":\"link\"},\"url\":{\"$ref\":\"#/$defs/httpsUrl\"},\"digest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"commitSource\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"repositoryId\",\"commitOid\"],\"description\":\"Reference one commit of a configured repository by object id; Wakeflow never reads git objects.\",\"properties\":{\"kind\":{\"const\":\"commit\"},\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"commitOid\":{\"$ref\":\"#/$defs/commitOid\"}}},\"effectRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"demandId\",\"selection\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"enum\":[\"preview\",\"apply\"]},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"selection\":{\"$ref\":\"#/$defs/selection\"}}},\"recoverRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"demandId\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"const\":\"recover\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"}}},\"selection\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"source\",\"contentReview\"],\"properties\":{\"kind\":{\"$ref\":\"#/$defs/evidenceKind\"},\"source\":{\"oneOf\":[{\"$ref\":\"#/$defs/managedPathSource\"},{\"$ref\":\"#/$defs/observationSelection\"},{\"$ref\":\"#/$defs/linkSource\"},{\"$ref\":\"#/$defs/commitSource\"}]},\"contentReview\":{\"enum\":[\"reject\",\"controller-confirmed\"]}}},\"observationSelection\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"hostId\",\"recordId\"],\"description\":\"Reference one host hook observation record of this workspace by host and record id.\",\"properties\":{\"kind\":{\"const\":\"observation\"},\"hostId\":{\"$ref\":\"#/$defs/hostId\"},\"recordId\":{\"$ref\":\"#/$defs/recordId\"}}},\"podId\":{\"type\":\"string\",\"pattern\":\"^pod_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"podWorktreeRoot\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"podId\",\"repositoryId\"],\"description\":\"The git worktree checkout a worktree pod's product window registered for one repository; resolved through the pod's worktree receipt.\",\"properties\":{\"kind\":{\"const\":\"pod-worktree\"},\"podId\":{\"$ref\":\"#/$defs/podId\"},\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"}}}}}");
