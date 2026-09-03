/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-requirement-publication-request.schema.json
 */

/**
 * Closed MCP preview/apply/recover request for one immutable Requirement authority publication.
 */
export type WakeflowRequirementPublicationRequestV1 = (PreviewRequest | ApplyRequest | RecoverRequest)
/**
 * Absolute path of the existing Wakeflow workspace root. Physical validation remains owned by RootedDirectory and this value is never returned.
 */
export type WorkspaceRoot = string
export type Title = string
export type SurfaceId = string
export type RequirementDocumentRole = ("original-plan" | "requirement-design" | "code-facts" | "landing-plan" | "non-goals" | "user-confirmation" | "reproduction" | "scope" | "requirement-delta" | "research-question" | "boundaries" | "test-environment" | "supporting-evidence")
export type MarkdownResourcePath = (PortableResourcePath & string)
export type PortableResourcePath = string
export type Sha256Digest = string

export interface PreviewRequest {
root: WorkspaceRoot
mode: "preview"
title: Title
designSurfaceId: SurfaceId
/**
 * @minItems 1
 * @maxItems 32
 */
documents: [DocumentSelection, ...(DocumentSelection)[]]
}
/**
 * One strict Markdown path under the selected Design surface. The path is also the future Ledger member path.
 */
export interface DocumentSelection {
role: RequirementDocumentRole
path: MarkdownResourcePath
}
export interface ApplyRequest {
root: WorkspaceRoot
mode: "apply"
plan: PublicationPlan
planDigest: Sha256Digest
}
/**
 * Complete owner-produced Ledger authority publication plan. The domain Plan parser revalidates its exact shape and all Record/Intent/tree relations.
 */
export interface PublicationPlan {
[k: string]: unknown | undefined
}
export interface RecoverRequest {
root: WorkspaceRoot
mode: "recover"
plan: PublicationPlan
planDigest: Sha256Digest
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
export const WAKEFLOW_REQUIREMENT_PUBLICATION_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:requirement-publication-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_REQUIREMENT_PUBLICATION_REQUEST_SCHEMA\",\"title\":\"WakeflowRequirementPublicationRequestV1\",\"description\":\"Closed MCP preview/apply/recover request for one immutable Requirement authority publication.\",\"$comment\":\"Preview accepts only a title, the current Design surface identity, and family-specific Markdown member selections. Program/Requirement identity, time, media type, size, digests, Ledger paths and publication intent are owner-derived. Apply and recover both require the exact preview plan and digest; no mode accepts inline bytes, family, physical paths or replacement owner fields.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/previewRequest\"},{\"$ref\":\"#/$defs/applyRequest\"},{\"$ref\":\"#/$defs/recoverRequest\"}],\"$defs\":{\"previewRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"title\",\"designSurfaceId\",\"documents\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"const\":\"preview\"},\"title\":{\"$ref\":\"#/$defs/title\"},\"designSurfaceId\":{\"$ref\":\"#/$defs/surfaceId\"},\"documents\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/documentSelection\"}}}},\"applyRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"plan\",\"planDigest\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"const\":\"apply\"},\"plan\":{\"$ref\":\"#/$defs/publicationPlan\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"recoverRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"plan\",\"planDigest\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"const\":\"recover\"},\"plan\":{\"$ref\":\"#/$defs/publicationPlan\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"documentSelection\":{\"description\":\"One strict Markdown path under the selected Design surface. The path is also the future Ledger member path.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"role\",\"path\"],\"properties\":{\"role\":{\"$ref\":\"#/$defs/requirementDocumentRole\"},\"path\":{\"$ref\":\"#/$defs/markdownResourcePath\"}}},\"publicationPlan\":{\"type\":\"object\",\"description\":\"Complete owner-produced Ledger authority publication plan. The domain Plan parser revalidates its exact shape and all Record/Intent/tree relations.\",\"minProperties\":1},\"workspaceRoot\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root. Physical validation remains owned by RootedDirectory and this value is never returned.\"},\"title\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"markdownResourcePath\":{\"allOf\":[{\"$ref\":\"#/$defs/portableResourcePath\"},{\"type\":\"string\",\"pattern\":\"^(?!(?:\\\\.git|\\\\.wakeflow-active|\\\\.wakeflow-local|record\\\\.json)(?:/|$)).+\\\\.md$\"}]},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"pattern\":\"^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\\\.{1,2}(?:/|$))(?!.*\\\\/\\\\.{1,2}(?:/|$))(?!.*\\\\\\\\)(?!.*//)(?!.*\\\\/$)(?!\\\\s)(?!.*\\\\s$)(?!.*\\\\/\\\\s)(?!.*\\\\s\\\\/)(?!.*[\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]).+$\"},\"requirementDocumentRole\":{\"enum\":[\"original-plan\",\"requirement-design\",\"code-facts\",\"landing-plan\",\"non-goals\",\"user-confirmation\",\"reproduction\",\"scope\",\"requirement-delta\",\"research-question\",\"boundaries\",\"test-environment\",\"supporting-evidence\"]},\"surfaceId\":{\"type\":\"string\",\"pattern\":\"^surface_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"}}}");
