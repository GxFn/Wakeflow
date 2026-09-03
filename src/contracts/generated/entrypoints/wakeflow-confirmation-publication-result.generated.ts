/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-confirmation-publication-result.schema.json
 */

/**
 * Successful preview, apply, or exact recovery result for one immutable Confirmation authority publication.
 */
export type WakeflowConfirmationPublicationResultV1 = (PreviewResult | ApplyResult | RecoveryResult)
export type Sha256Digest = string
export type ConfirmationId = string
export type DemandId = string
export type PortableResourcePath = string
export type ConfirmationDocumentRole = ("goal-stage-decision" | "user-confirmation" | "requirement-delta" | "supporting-evidence")
export type RecoveryPublicationReceipt = (PublicationReceipt & {
disposition?: ("recovered" | "current")
[k: string]: unknown | undefined
})

export interface PreviewResult {
kind: "WakeflowConfirmationPublicationPreviewResult"
schemaVersion: 1
tool: "wakeflow_publish_confirmation"
mode: "preview"
status: "ready"
plan: PublicationPlan
planDigest: Sha256Digest
}
/**
 * Complete owner-produced Ledger authority publication plan. Its exact domain shape is revalidated before Apply or Recover.
 */
export interface PublicationPlan {
[k: string]: unknown | undefined
}
export interface ApplyResult {
kind: "WakeflowConfirmationPublicationApplyResult"
schemaVersion: 1
tool: "wakeflow_publish_confirmation"
mode: "apply"
status: "current"
planDigest: Sha256Digest
publication: PublicationReceipt
}
export interface PublicationReceipt {
publicationAuthority: "current"
disposition: ("published" | "recovered" | "current")
confirmationId: ConfirmationId
demandId: DemandId
recordRef: PortableResourcePath
recordDigest: Sha256Digest
/**
 * @minItems 1
 * @maxItems 32
 */
memberReferences: [ConfirmationMemberReference, ...(ConfirmationMemberReference)[]]
}
/**
 * Self-contained public mirror of one Confirmation-family Ledger authority member reference.
 */
export interface ConfirmationMemberReference {
artifactKind: "wakeflow-ledger-authority-member-reference"
schemaVersion: 1
family: "confirmation"
recordId: ConfirmationId
recordRef: PortableResourcePath
recordDigest: Sha256Digest
memberPath: PortableResourcePath
memberRef: PortableResourcePath
memberDigest: Sha256Digest
role: ConfirmationDocumentRole
mediaType: "text/markdown"
}
export interface RecoveryResult {
kind: "WakeflowConfirmationPublicationRecoveryResult"
schemaVersion: 1
tool: "wakeflow_publish_confirmation"
mode: "recover"
status: "current"
planDigest: Sha256Digest
publication: RecoveryPublicationReceipt
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
export const WAKEFLOW_CONFIRMATION_PUBLICATION_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:confirmation-publication-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_CONFIRMATION_PUBLICATION_RESULT_SCHEMA\",\"title\":\"WakeflowConfirmationPublicationResultV1\",\"description\":\"Successful preview, apply, or exact recovery result for one immutable Confirmation authority publication.\",\"$comment\":\"Preview returns the complete owner-produced plan, including the allocated future Demand identity, for confirmation. Apply and recover return only stable Confirmation, future Demand and member-reference metadata. They expose no Workspace/Design/Ledger physical path, source node, source bytes, loaded record internals, lock, stage, file handle or private recovery capability.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/previewResult\"},{\"$ref\":\"#/$defs/applyResult\"},{\"$ref\":\"#/$defs/recoveryResult\"}],\"$defs\":{\"previewResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"status\",\"plan\",\"planDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowConfirmationPublicationPreviewResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_publish_confirmation\"},\"mode\":{\"const\":\"preview\"},\"status\":{\"const\":\"ready\"},\"plan\":{\"$ref\":\"#/$defs/publicationPlan\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"applyResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"status\",\"planDigest\",\"publication\"],\"properties\":{\"kind\":{\"const\":\"WakeflowConfirmationPublicationApplyResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_publish_confirmation\"},\"mode\":{\"const\":\"apply\"},\"status\":{\"const\":\"current\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"publication\":{\"$ref\":\"#/$defs/publicationReceipt\"}}},\"recoveryResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"status\",\"planDigest\",\"publication\"],\"properties\":{\"kind\":{\"const\":\"WakeflowConfirmationPublicationRecoveryResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_publish_confirmation\"},\"mode\":{\"const\":\"recover\"},\"status\":{\"const\":\"current\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"publication\":{\"$ref\":\"#/$defs/recoveryPublicationReceipt\"}}},\"recoveryPublicationReceipt\":{\"allOf\":[{\"$ref\":\"#/$defs/publicationReceipt\"},{\"type\":\"object\",\"properties\":{\"disposition\":{\"enum\":[\"recovered\",\"current\"]}}}]},\"publicationReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"publicationAuthority\",\"disposition\",\"confirmationId\",\"demandId\",\"recordRef\",\"recordDigest\",\"memberReferences\"],\"properties\":{\"publicationAuthority\":{\"const\":\"current\"},\"disposition\":{\"enum\":[\"published\",\"recovered\",\"current\"]},\"confirmationId\":{\"$ref\":\"#/$defs/confirmationId\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"recordRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"recordDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"memberReferences\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/confirmationMemberReference\"}}}},\"confirmationMemberReference\":{\"description\":\"Self-contained public mirror of one Confirmation-family Ledger authority member reference.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"family\",\"recordId\",\"recordRef\",\"recordDigest\",\"memberPath\",\"memberRef\",\"memberDigest\",\"role\",\"mediaType\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-ledger-authority-member-reference\"},\"schemaVersion\":{\"const\":1},\"family\":{\"const\":\"confirmation\"},\"recordId\":{\"$ref\":\"#/$defs/confirmationId\"},\"recordRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"recordDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"memberPath\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"memberRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"memberDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"role\":{\"$ref\":\"#/$defs/confirmationDocumentRole\"},\"mediaType\":{\"const\":\"text/markdown\"}}},\"publicationPlan\":{\"type\":\"object\",\"description\":\"Complete owner-produced Ledger authority publication plan. Its exact domain shape is revalidated before Apply or Recover.\",\"minProperties\":1},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"pattern\":\"^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\\\.{1,2}(?:/|$))(?!.*\\\\/\\\\.{1,2}(?:/|$))(?!.*\\\\\\\\)(?!.*//)(?!.*\\\\/$)(?!\\\\s)(?!.*\\\\s$)(?!.*\\\\/\\\\s)(?!.*\\\\s\\\\/)(?!.*[\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]).+$\"},\"confirmationDocumentRole\":{\"enum\":[\"goal-stage-decision\",\"user-confirmation\",\"requirement-delta\",\"supporting-evidence\"]},\"confirmationId\":{\"type\":\"string\",\"pattern\":\"^confirmation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"}}}");
