/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-demand-publication-request.schema.json
 */

/**
 * Closed MCP preview/apply/recover request for one TODO-backed Demand Event Sourcing publication.
 */
export type WakeflowDemandPublicationRequestV1 = (PreviewRequest | ApplyRequest | RecoverRequest)
/**
 * Absolute path of the existing Wakeflow workspace root. Physical validation remains owned by RootedDirectory and this value is never returned.
 */
export type WorkspaceRoot = string
export type TodoId = string
export type IdentityText = string
export type AuthorityRecordId = string
export type PortableResourcePath = string
export type Sha256Digest = string
export type DemandId = string

export interface PreviewRequest {
root: WorkspaceRoot
mode: "preview"
todoId: TodoId
demand: AuthoredDemand
}
export interface AuthoredDemand {
title: IdentityText
goal: IdentityText
completionDefinition: IdentityText
executionPlacement: (MainPlacement | IsolatedPlacement)
}
export interface MainPlacement {
mode: "main"
}
export interface IsolatedPlacement {
mode: "isolated"
authorizationMember: AuthorityMemberSelection
}
/**
 * Caller selection of one immutable Ledger member. Role, media type, record/member digests, and full refs are resolved by the Publication owner.
 */
export interface AuthorityMemberSelection {
recordId: AuthorityRecordId
memberPath: PortableResourcePath
}
export interface ApplyRequest {
root: WorkspaceRoot
mode: "apply"
plan: PublicationPlan
planDigest: Sha256Digest
}
/**
 * Complete owner-produced Demand Event Sourcing publication transaction. The domain transaction parser revalidates its exact closed shape and relations before Apply.
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
export const WAKEFLOW_DEMAND_PUBLICATION_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:demand-publication-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_PUBLICATION_REQUEST_SCHEMA\",\"title\":\"WakeflowDemandPublicationRequestV1\",\"description\":\"Closed MCP preview/apply/recover request for one TODO-backed Demand Event Sourcing publication.\",\"$comment\":\"Preview accepts only Controller-authored Demand text, execution placement, and TODO identity. The complete Ledger member set comes only from the immutable TODO Intake; Config, Demand type, testing decision, references, digests, time, IDs, paths, Event/Commit data, and TODO CAS are owner-derived. Apply replays the exact preview plan and digest; recover accepts only the Demand identity.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/previewRequest\"},{\"$ref\":\"#/$defs/applyRequest\"},{\"$ref\":\"#/$defs/recoverRequest\"}],\"$defs\":{\"previewRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"todoId\",\"demand\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"const\":\"preview\"},\"todoId\":{\"$ref\":\"#/$defs/todoId\"},\"demand\":{\"$ref\":\"#/$defs/authoredDemand\"}}},\"applyRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"plan\",\"planDigest\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"const\":\"apply\"},\"plan\":{\"$ref\":\"#/$defs/publicationPlan\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"recoverRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"demandId\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"const\":\"recover\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"}}},\"authoredDemand\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"title\",\"goal\",\"completionDefinition\",\"executionPlacement\"],\"properties\":{\"title\":{\"$ref\":\"#/$defs/identityText\"},\"goal\":{\"$ref\":\"#/$defs/identityText\"},\"completionDefinition\":{\"$ref\":\"#/$defs/identityText\"},\"executionPlacement\":{\"oneOf\":[{\"$ref\":\"#/$defs/mainPlacement\"},{\"$ref\":\"#/$defs/isolatedPlacement\"}]}}},\"mainPlacement\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"mode\"],\"properties\":{\"mode\":{\"const\":\"main\"}}},\"isolatedPlacement\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"mode\",\"authorizationMember\"],\"properties\":{\"mode\":{\"const\":\"isolated\"},\"authorizationMember\":{\"$ref\":\"#/$defs/authorityMemberSelection\"}}},\"authorityMemberSelection\":{\"description\":\"Caller selection of one immutable Ledger member. Role, media type, record/member digests, and full refs are resolved by the Publication owner.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"recordId\",\"memberPath\"],\"properties\":{\"recordId\":{\"$ref\":\"#/$defs/authorityRecordId\"},\"memberPath\":{\"$ref\":\"#/$defs/portableResourcePath\"}}},\"publicationPlan\":{\"type\":\"object\",\"description\":\"Complete owner-produced Demand Event Sourcing publication transaction. The domain transaction parser revalidates its exact closed shape and relations before Apply.\",\"minProperties\":1},\"workspaceRoot\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root. Physical validation remains owned by RootedDirectory and this value is never returned.\"},\"identityText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":16384,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"pattern\":\"^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\\\.{1,2}(?:/|$))(?!.*\\\\/\\\\.{1,2}(?:/|$))(?!.*\\\\\\\\)(?!.*//)(?!.*\\\\/$)(?!\\\\s)(?!.*\\\\s$)(?!.*\\\\/\\\\s)(?!.*\\\\s\\\\/)(?!.*[\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]).+$\"},\"todoId\":{\"type\":\"string\",\"pattern\":\"^todo_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"authorityRecordId\":{\"type\":\"string\",\"pattern\":\"^(?:requirement|confirmation)_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"}}}");
