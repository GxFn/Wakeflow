/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-record-evidence-result.schema.json
 */

/**
 * Result of one record-evidence call: the preview plan summary with blockers and digest, or the mutation disposition with the publication receipt and next.
 */
export type WakeflowRecordEvidenceResultV1 = (PreviewResult | MutationResult)
/**
 * @maxItems 64
 */
export type Blockers = string[]
export type Sha256Digest = string
export type DemandId = string
export type EvidenceId = string
export type EvidenceKind = ("hook-observation" | "transcript" | "test-output" | "diff" | "document" | "link" | "commit")
export type SourceProjection = (ManagedPathSource | ObservationSource | LinkSourceRecord | CommitSource)
export type RepositoryId = string
export type SurfaceId = string
export type PodId = string
export type PortableResourcePath = string
export type HostId = ("codex" | "claude-code")
export type RecordId = string
export type HookEvent = ("session-start" | "user-prompt-submit" | "stop" | "session-end" | "turn-complete")
export type UtcInstant = string
export type HttpsUrl = string
export type CommitOid = string
export type EventId = string
export type CommitId = string

export interface PreviewResult {
kind: "WakeflowRecordEvidencePreview"
schemaVersion: 1
tool: "wakeflow_record_evidence"
mode: "preview"
status: ("ready" | "blocked")
blockers: Blockers
planDigest: (null | Sha256Digest)
demandId: DemandId
plan: (null | EvidencePlan)
next: NextProjection
}
/**
 * Summary of the derived plan; the full manifest stays server-side and is recomputed at apply.
 */
export interface EvidencePlan {
evidenceId: EvidenceId
kind: EvidenceKind
source: SourceProjection
payload: {
artifactDigest: Sha256Digest
fileCount: number
totalBytes: number
}
contentReview: {
disposition: ("controller-confirmed" | "not-required")
opaqueFileCount: number
privacyFindingCount: number
}
/**
 * true when this Demand already holds a record with the same evidenceId; apply then replays it as already-recorded.
 */
recorded: boolean
}
/**
 * Copy one file or one directory tree from a configured repository or support-surface root.
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
export interface ObservationSource {
kind: "observation"
hostId: HostId
recordId: RecordId
event: HookEvent
recordedAt: UtcInstant
turnId: (null | string)
promptDigest: (null | Sha256Digest)
lastAssistantMessageDigest: (null | Sha256Digest)
transcript: ("present" | "absent")
recordDigest: Sha256Digest
}
export interface LinkSourceRecord {
kind: "link"
url: HttpsUrl
digest: (null | Sha256Digest)
}
/**
 * Reference one commit of a configured repository by object id; Wakeflow never reads git objects.
 */
export interface CommitSource {
kind: "commit"
repositoryId: RepositoryId
commitOid: CommitOid
}
/**
 * Next Controller responsibility derived from the route after this call.
 */
export interface NextProjection {
frontier: (null | string)
owner: ("controller" | "target" | "test" | "user" | "none")
suggestedTool: (null | string)
blockers: Blockers
}
export interface MutationResult {
kind: "WakeflowRecordEvidenceMutation"
schemaVersion: 1
tool: "wakeflow_record_evidence"
mode: ("apply" | "recover")
disposition: ("recorded" | "already-recorded" | "recovered" | "retired" | "healthy")
demandId: DemandId
publication: (null | Publication)
next: NextProjection
}
export interface Publication {
evidenceId: EvidenceId
kind: EvidenceKind
manifestDigest: Sha256Digest
payloadArtifactDigest: Sha256Digest
event: {
eventId: EventId
streamRevision: number
commitId: CommitId
}
stateDigest: Sha256Digest
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
export const WAKEFLOW_RECORD_EVIDENCE_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:record-evidence-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_RECORD_EVIDENCE_RESULT_SCHEMA\",\"title\":\"WakeflowRecordEvidenceResultV1\",\"description\":\"Result of one record-evidence call: the preview plan summary with blockers and digest, or the mutation disposition with the publication receipt and next.\",\"$comment\":\"Results carry typed IDs, digests, counts, and the source projection only; never a source path outside the configured roots, a Manifest body, payload bytes, a host session handle, or a working directory.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/previewResult\"},{\"$ref\":\"#/$defs/mutationResult\"}],\"$defs\":{\"workspaceRoot\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"evidenceId\":{\"type\":\"string\",\"pattern\":\"^evidence_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"surfaceId\":{\"type\":\"string\",\"pattern\":\"^surface_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":4096,\"pattern\":\"^(?!\\\\.\\\\.?(?:/|$))[^/\\\\u0000]+(?:/(?!\\\\.\\\\.?(?:/|$))[^/\\\\u0000]+)*$\"},\"evidenceKind\":{\"enum\":[\"hook-observation\",\"transcript\",\"test-output\",\"diff\",\"document\",\"link\",\"commit\"]},\"hostId\":{\"enum\":[\"codex\",\"claude-code\"]},\"recordId\":{\"type\":\"string\",\"pattern\":\"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"hookEvent\":{\"enum\":[\"session-start\",\"user-prompt-submit\",\"stop\",\"session-end\",\"turn-complete\"]},\"commitOid\":{\"type\":\"string\",\"pattern\":\"^(?:[0-9a-f]{40}|[0-9a-f]{64})$\"},\"httpsUrl\":{\"type\":\"string\",\"minLength\":9,\"maxLength\":2048,\"pattern\":\"^https://[^\\\\s\\\"'`<>]+$\"},\"repositoryRoot\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"repositoryId\"],\"properties\":{\"kind\":{\"const\":\"repository\"},\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"}}},\"supportSurfaceRoot\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"surfaceId\"],\"properties\":{\"kind\":{\"const\":\"support-surface\"},\"surfaceId\":{\"$ref\":\"#/$defs/surfaceId\"}}},\"managedPathSource\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"root\",\"path\",\"resourceType\"],\"description\":\"Copy one file or one directory tree from a configured repository or support-surface root.\",\"properties\":{\"kind\":{\"const\":\"managed-path\"},\"root\":{\"oneOf\":[{\"$ref\":\"#/$defs/repositoryRoot\"},{\"$ref\":\"#/$defs/supportSurfaceRoot\"},{\"$ref\":\"#/$defs/podWorktreeRoot\"}]},\"path\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"resourceType\":{\"enum\":[\"file\",\"tree\"]}}},\"linkSource\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"url\"],\"description\":\"Reference an https resource by URL; Wakeflow never fetches it. The optional digest is caller-supplied.\",\"properties\":{\"kind\":{\"const\":\"link\"},\"url\":{\"$ref\":\"#/$defs/httpsUrl\"},\"digest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"commitSource\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"repositoryId\",\"commitOid\"],\"description\":\"Reference one commit of a configured repository by object id; Wakeflow never reads git objects.\",\"properties\":{\"kind\":{\"const\":\"commit\"},\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"commitOid\":{\"$ref\":\"#/$defs/commitOid\"}}},\"blockers\":{\"type\":\"array\",\"maxItems\":64,\"items\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":256}},\"nextProjection\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"frontier\",\"owner\",\"suggestedTool\",\"blockers\"],\"description\":\"Next Controller responsibility derived from the route after this call.\",\"properties\":{\"frontier\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":128}]},\"owner\":{\"enum\":[\"controller\",\"target\",\"test\",\"user\",\"none\"]},\"suggestedTool\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":128}]},\"blockers\":{\"$ref\":\"#/$defs/blockers\"}}},\"observationSource\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"hostId\",\"recordId\",\"event\",\"recordedAt\",\"turnId\",\"promptDigest\",\"lastAssistantMessageDigest\",\"transcript\",\"recordDigest\"],\"properties\":{\"kind\":{\"const\":\"observation\"},\"hostId\":{\"$ref\":\"#/$defs/hostId\"},\"recordId\":{\"$ref\":\"#/$defs/recordId\"},\"event\":{\"$ref\":\"#/$defs/hookEvent\"},\"recordedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"turnId\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":256}]},\"promptDigest\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/sha256Digest\"}]},\"lastAssistantMessageDigest\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/sha256Digest\"}]},\"transcript\":{\"enum\":[\"present\",\"absent\"]},\"recordDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"linkSourceRecord\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"url\",\"digest\"],\"properties\":{\"kind\":{\"const\":\"link\"},\"url\":{\"$ref\":\"#/$defs/httpsUrl\"},\"digest\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/sha256Digest\"}]}}},\"sourceProjection\":{\"oneOf\":[{\"$ref\":\"#/$defs/managedPathSource\"},{\"$ref\":\"#/$defs/observationSource\"},{\"$ref\":\"#/$defs/linkSourceRecord\"},{\"$ref\":\"#/$defs/commitSource\"}]},\"evidencePlan\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"evidenceId\",\"kind\",\"source\",\"payload\",\"contentReview\",\"recorded\"],\"description\":\"Summary of the derived plan; the full manifest stays server-side and is recomputed at apply.\",\"properties\":{\"evidenceId\":{\"$ref\":\"#/$defs/evidenceId\"},\"kind\":{\"$ref\":\"#/$defs/evidenceKind\"},\"source\":{\"$ref\":\"#/$defs/sourceProjection\"},\"payload\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactDigest\",\"fileCount\",\"totalBytes\"],\"properties\":{\"artifactDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"fileCount\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":4096},\"totalBytes\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":9007199254740991}}},\"contentReview\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"disposition\",\"opaqueFileCount\",\"privacyFindingCount\"],\"properties\":{\"disposition\":{\"enum\":[\"controller-confirmed\",\"not-required\"]},\"opaqueFileCount\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":4096},\"privacyFindingCount\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":64}}},\"recorded\":{\"type\":\"boolean\",\"description\":\"true when this Demand already holds a record with the same evidenceId; apply then replays it as already-recorded.\"}}},\"publication\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"evidenceId\",\"kind\",\"manifestDigest\",\"payloadArtifactDigest\",\"event\",\"stateDigest\"],\"properties\":{\"evidenceId\":{\"$ref\":\"#/$defs/evidenceId\"},\"kind\":{\"$ref\":\"#/$defs/evidenceKind\"},\"manifestDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"payloadArtifactDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"event\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"eventId\",\"streamRevision\",\"commitId\"],\"properties\":{\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"commitId\":{\"$ref\":\"#/$defs/commitId\"}}},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"previewResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"status\",\"blockers\",\"planDigest\",\"demandId\",\"plan\",\"next\"],\"properties\":{\"kind\":{\"const\":\"WakeflowRecordEvidencePreview\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_record_evidence\"},\"mode\":{\"const\":\"preview\"},\"status\":{\"enum\":[\"ready\",\"blocked\"]},\"blockers\":{\"$ref\":\"#/$defs/blockers\"},\"planDigest\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/sha256Digest\"}]},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"plan\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/evidencePlan\"}]},\"next\":{\"$ref\":\"#/$defs/nextProjection\"}}},\"mutationResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"disposition\",\"demandId\",\"publication\",\"next\"],\"properties\":{\"kind\":{\"const\":\"WakeflowRecordEvidenceMutation\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_record_evidence\"},\"mode\":{\"enum\":[\"apply\",\"recover\"]},\"disposition\":{\"enum\":[\"recorded\",\"already-recorded\",\"recovered\",\"retired\",\"healthy\"]},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"publication\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/publication\"}]},\"next\":{\"$ref\":\"#/$defs/nextProjection\"}}},\"podId\":{\"type\":\"string\",\"pattern\":\"^pod_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"podWorktreeRoot\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"podId\",\"repositoryId\"],\"description\":\"The git worktree checkout a worktree pod's product window registered for one repository; resolved through the pod's worktree receipt.\",\"properties\":{\"kind\":{\"const\":\"pod-worktree\"},\"podId\":{\"$ref\":\"#/$defs/podId\"},\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"}}}}}");
