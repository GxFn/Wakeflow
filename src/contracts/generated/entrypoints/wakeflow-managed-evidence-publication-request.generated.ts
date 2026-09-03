/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-managed-evidence-publication-request.schema.json
 */

/**
 * Closed MCP preview/apply/recover request for one local Managed Evidence publication.
 */
export type WakeflowManagedEvidencePublicationRequestV1 = (PreviewRequest | ApplyRequest | RecoverRequest)
/**
 * Absolute path of the existing Wakeflow workspace root. It is never returned.
 */
export type WorkspaceRoot = string
export type DemandId = string
export type SourceRoot = (RepositoryRoot | SupportSurfaceRoot)
export type RepositoryId = string
export type SurfaceId = string
export type PortableResourcePath = string
export type Sha256Digest = string

export interface PreviewRequest {
root: WorkspaceRoot
mode: "preview"
demandId: DemandId
selection: SourceSelection
}
export interface SourceSelection {
evidenceType: string
source: Source
sensitivity: ("internal" | "public")
opaqueContentPolicy: ("controller-confirmed" | "reject")
}
export interface Source {
root: SourceRoot
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
export interface ApplyRequest {
root: WorkspaceRoot
mode: "apply"
demandId: DemandId
plan: PublicationPlan
planDigest: Sha256Digest
}
/**
 * Complete owner-produced Managed Evidence Publication Transaction. The domain parser revalidates its exact shape and relations before Apply.
 */
export interface PublicationPlan {
[k: string]: unknown | undefined
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
export const WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:managed-evidence-publication-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_REQUEST_SCHEMA\",\"title\":\"WakeflowManagedEvidencePublicationRequestV1\",\"description\":\"Closed MCP preview/apply/recover request for one local Managed Evidence publication.\",\"$comment\":\"Preview accepts only a Demand identity and logical configured source selection. Evidence/Event/Commit identities, capture time, Config/Demand expectations, source digests, Manifest, record tree and transaction digest are owner-derived. Apply requires the exact preview plan and digest. Recover accepts only the Demand identity and never accepts source bytes or a replacement plan.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/previewRequest\"},{\"$ref\":\"#/$defs/applyRequest\"},{\"$ref\":\"#/$defs/recoverRequest\"}],\"$defs\":{\"previewRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"demandId\",\"selection\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"const\":\"preview\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"selection\":{\"$ref\":\"#/$defs/sourceSelection\"}}},\"applyRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"demandId\",\"plan\",\"planDigest\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"const\":\"apply\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"plan\":{\"$ref\":\"#/$defs/publicationPlan\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"recoverRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"demandId\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"const\":\"recover\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"}}},\"sourceSelection\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"evidenceType\",\"source\",\"sensitivity\",\"opaqueContentPolicy\"],\"properties\":{\"evidenceType\":{\"type\":\"string\",\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"source\":{\"$ref\":\"#/$defs/source\"},\"sensitivity\":{\"enum\":[\"internal\",\"public\"]},\"opaqueContentPolicy\":{\"enum\":[\"controller-confirmed\",\"reject\"]}}},\"source\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"path\",\"resourceType\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/sourceRoot\"},\"path\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"resourceType\":{\"enum\":[\"file\",\"tree\"]}}},\"sourceRoot\":{\"oneOf\":[{\"$ref\":\"#/$defs/repositoryRoot\"},{\"$ref\":\"#/$defs/supportSurfaceRoot\"}]},\"repositoryRoot\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"repositoryId\"],\"properties\":{\"kind\":{\"const\":\"repository\"},\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"}}},\"supportSurfaceRoot\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"surfaceId\"],\"properties\":{\"kind\":{\"const\":\"support-surface\"},\"surfaceId\":{\"$ref\":\"#/$defs/surfaceId\"}}},\"publicationPlan\":{\"type\":\"object\",\"description\":\"Complete owner-produced Managed Evidence Publication Transaction. The domain parser revalidates its exact shape and relations before Apply.\",\"minProperties\":1},\"workspaceRoot\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root. It is never returned.\"},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"pattern\":\"^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\\\.{1,2}(?:/|$))(?!.*\\\\/\\\\.{1,2}(?:/|$))(?!.*\\\\\\\\)(?!.*//)(?!.*\\\\/$)(?!\\\\s)(?!.*\\\\s$)(?!.*\\\\/\\\\s)(?!.*\\\\s\\\\/)(?!.*[\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]).+$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"surfaceId\":{\"type\":\"string\",\"pattern\":\"^surface_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"}}}");
