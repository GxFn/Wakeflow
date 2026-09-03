/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-requirement-publication-result.schema.json
 */

/**
 * Successful preview, apply, or exact recovery result for one immutable Requirement authority publication.
 */
export type WakeflowRequirementPublicationResultV1 = (PreviewResult | ApplyResult | RecoveryResult)
export type Sha256Digest = string
export type RequirementId = string
export type PortableResourcePath = string
export type RequirementDocumentRole = ("original-plan" | "requirement-design" | "code-facts" | "landing-plan" | "non-goals" | "user-confirmation" | "reproduction" | "scope" | "requirement-delta" | "research-question" | "boundaries" | "test-environment" | "supporting-evidence")
export type RecoveryPublicationReceipt = (PublicationReceipt & {
disposition?: ("recovered" | "current")
[k: string]: unknown | undefined
})

export interface PreviewResult {
kind: "WakeflowRequirementPublicationPreviewResult"
schemaVersion: 1
tool: "wakeflow_publish_requirement"
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
kind: "WakeflowRequirementPublicationApplyResult"
schemaVersion: 1
tool: "wakeflow_publish_requirement"
mode: "apply"
status: "current"
planDigest: Sha256Digest
publication: PublicationReceipt
}
export interface PublicationReceipt {
publicationAuthority: "current"
disposition: ("published" | "recovered" | "current")
requirementId: RequirementId
recordRef: PortableResourcePath
recordDigest: Sha256Digest
/**
 * @minItems 1
 * @maxItems 32
 */
memberReferences: [RequirementMemberReference, ...(RequirementMemberReference)[]]
}
/**
 * Self-contained public mirror of one Requirement-family Ledger authority member reference.
 */
export interface RequirementMemberReference {
artifactKind: "wakeflow-ledger-authority-member-reference"
schemaVersion: 1
family: "requirement"
recordId: RequirementId
recordRef: PortableResourcePath
recordDigest: Sha256Digest
memberPath: PortableResourcePath
memberRef: PortableResourcePath
memberDigest: Sha256Digest
role: RequirementDocumentRole
mediaType: "text/markdown"
}
export interface RecoveryResult {
kind: "WakeflowRequirementPublicationRecoveryResult"
schemaVersion: 1
tool: "wakeflow_publish_requirement"
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
export const WAKEFLOW_REQUIREMENT_PUBLICATION_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:requirement-publication-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_REQUIREMENT_PUBLICATION_RESULT_SCHEMA\",\"title\":\"WakeflowRequirementPublicationResultV1\",\"description\":\"Successful preview, apply, or exact recovery result for one immutable Requirement authority publication.\",\"$comment\":\"Preview returns the complete owner-produced plan for confirmation. Apply and recover return only stable Requirement and member-reference metadata. They expose no Workspace/Design/Ledger physical path, source node, source bytes, loaded record internals, lock, stage, file handle or private recovery capability.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/previewResult\"},{\"$ref\":\"#/$defs/applyResult\"},{\"$ref\":\"#/$defs/recoveryResult\"}],\"$defs\":{\"previewResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"status\",\"plan\",\"planDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowRequirementPublicationPreviewResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_publish_requirement\"},\"mode\":{\"const\":\"preview\"},\"status\":{\"const\":\"ready\"},\"plan\":{\"$ref\":\"#/$defs/publicationPlan\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"applyResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"status\",\"planDigest\",\"publication\"],\"properties\":{\"kind\":{\"const\":\"WakeflowRequirementPublicationApplyResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_publish_requirement\"},\"mode\":{\"const\":\"apply\"},\"status\":{\"const\":\"current\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"publication\":{\"$ref\":\"#/$defs/publicationReceipt\"}}},\"recoveryResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"status\",\"planDigest\",\"publication\"],\"properties\":{\"kind\":{\"const\":\"WakeflowRequirementPublicationRecoveryResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_publish_requirement\"},\"mode\":{\"const\":\"recover\"},\"status\":{\"const\":\"current\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"publication\":{\"$ref\":\"#/$defs/recoveryPublicationReceipt\"}}},\"recoveryPublicationReceipt\":{\"allOf\":[{\"$ref\":\"#/$defs/publicationReceipt\"},{\"type\":\"object\",\"properties\":{\"disposition\":{\"enum\":[\"recovered\",\"current\"]}}}]},\"publicationReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"publicationAuthority\",\"disposition\",\"requirementId\",\"recordRef\",\"recordDigest\",\"memberReferences\"],\"properties\":{\"publicationAuthority\":{\"const\":\"current\"},\"disposition\":{\"enum\":[\"published\",\"recovered\",\"current\"]},\"requirementId\":{\"$ref\":\"#/$defs/requirementId\"},\"recordRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"recordDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"memberReferences\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/requirementMemberReference\"}}}},\"requirementMemberReference\":{\"description\":\"Self-contained public mirror of one Requirement-family Ledger authority member reference.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"family\",\"recordId\",\"recordRef\",\"recordDigest\",\"memberPath\",\"memberRef\",\"memberDigest\",\"role\",\"mediaType\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-ledger-authority-member-reference\"},\"schemaVersion\":{\"const\":1},\"family\":{\"const\":\"requirement\"},\"recordId\":{\"$ref\":\"#/$defs/requirementId\"},\"recordRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"recordDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"memberPath\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"memberRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"memberDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"role\":{\"$ref\":\"#/$defs/requirementDocumentRole\"},\"mediaType\":{\"const\":\"text/markdown\"}}},\"publicationPlan\":{\"type\":\"object\",\"description\":\"Complete owner-produced Ledger authority publication plan. Its exact domain shape is revalidated before Apply or Recover.\",\"minProperties\":1},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"pattern\":\"^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\\\.{1,2}(?:/|$))(?!.*\\\\/\\\\.{1,2}(?:/|$))(?!.*\\\\\\\\)(?!.*//)(?!.*\\\\/$)(?!\\\\s)(?!.*\\\\s$)(?!.*\\\\/\\\\s)(?!.*\\\\s\\\\/)(?!.*[\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]).+$\"},\"requirementDocumentRole\":{\"enum\":[\"original-plan\",\"requirement-design\",\"code-facts\",\"landing-plan\",\"non-goals\",\"user-confirmation\",\"reproduction\",\"scope\",\"requirement-delta\",\"research-question\",\"boundaries\",\"test-environment\",\"supporting-evidence\"]},\"requirementId\":{\"type\":\"string\",\"pattern\":\"^requirement_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"}}}");
