/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-managed-evidence-publication-result.schema.json
 */

/**
 * Successful preview, apply, or recovery metadata result for one Managed Evidence publication.
 */
export type WakeflowManagedEvidencePublicationResultV1 = (PreviewResult | ApplyResult | CurrentRecoveryResult | RetiredRecoveryResult | HealthyRecoveryResult)
export type Sha256Digest = string
export type DemandId = string
export type EvidenceId = string
export type EventId = string
export type PositiveSafeInteger = number
export type CommitId = string

export interface PreviewResult {
kind: "WakeflowManagedEvidencePublicationPreviewResult"
schemaVersion: 1
tool: "wakeflow_record_evidence"
mode: "preview"
status: "ready"
plan: PublicationPlan
planDigest: Sha256Digest
}
/**
 * Complete owner-produced Managed Evidence Publication Transaction.
 */
export interface PublicationPlan {
[k: string]: unknown | undefined
}
export interface ApplyResult {
kind: "WakeflowManagedEvidencePublicationApplyResult"
schemaVersion: 1
tool: "wakeflow_record_evidence"
mode: "apply"
status: "current"
planDigest: Sha256Digest
publication: PublicationReceipt
}
export interface PublicationReceipt {
demandId: DemandId
evidenceId: EvidenceId
transactionDigest: Sha256Digest
manifestDigest: Sha256Digest
payloadArtifactDigest: Sha256Digest
recordTreePlanDigest: Sha256Digest
commandDigest: Sha256Digest
event: EventReceipt
commit: CommitReceipt
aggregate: AggregateReceipt
}
export interface EventReceipt {
eventId: EventId
streamRevision: PositiveSafeInteger
}
export interface CommitReceipt {
commitId: CommitId
commitSequence: PositiveSafeInteger
commitDigest: Sha256Digest
}
export interface AggregateReceipt {
streamRevision: PositiveSafeInteger
stateDigest: Sha256Digest
}
export interface CurrentRecoveryResult {
kind: "WakeflowManagedEvidencePublicationRecoveryResult"
schemaVersion: 1
tool: "wakeflow_record_evidence"
mode: "recover"
status: "current"
publication: PublicationReceipt
}
export interface RetiredRecoveryResult {
kind: "WakeflowManagedEvidencePublicationRecoveryResult"
schemaVersion: 1
tool: "wakeflow_record_evidence"
mode: "recover"
status: "retired-stale"
retirement: RetirementReceipt
}
export interface RetirementReceipt {
demandId: DemandId
evidenceId: EvidenceId
transactionDigest: Sha256Digest
manifestDigest: Sha256Digest
payloadArtifactDigest: Sha256Digest
}
export interface HealthyRecoveryResult {
kind: "WakeflowManagedEvidencePublicationRecoveryResult"
schemaVersion: 1
tool: "wakeflow_record_evidence"
mode: "recover"
status: "healthy"
health: HealthReceipt
}
export interface HealthReceipt {
demandId: DemandId
streamRevision: PositiveSafeInteger
stateDigest: Sha256Digest
managedEvidenceCount: number
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
export const WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:managed-evidence-publication-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_RESULT_SCHEMA\",\"title\":\"WakeflowManagedEvidencePublicationResultV1\",\"description\":\"Successful preview, apply, or recovery metadata result for one Managed Evidence publication.\",\"$comment\":\"Preview returns the complete owner-produced transaction, including the caller-selected logical source ref, for confirmation. Apply and completed recovery return only immutable IDs and digests. Retired recovery reports the exact retired transaction identity. Healthy recovery reports only current Demand cursor metadata. Apply/recover results expose no source ref, Config/window identity, physical path, Manifest body, payload bytes, inode, handle, or internal capability.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/previewResult\"},{\"$ref\":\"#/$defs/applyResult\"},{\"$ref\":\"#/$defs/currentRecoveryResult\"},{\"$ref\":\"#/$defs/retiredRecoveryResult\"},{\"$ref\":\"#/$defs/healthyRecoveryResult\"}],\"$defs\":{\"previewResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"status\",\"plan\",\"planDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowManagedEvidencePublicationPreviewResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_record_evidence\"},\"mode\":{\"const\":\"preview\"},\"status\":{\"const\":\"ready\"},\"plan\":{\"$ref\":\"#/$defs/publicationPlan\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"applyResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"status\",\"planDigest\",\"publication\"],\"properties\":{\"kind\":{\"const\":\"WakeflowManagedEvidencePublicationApplyResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_record_evidence\"},\"mode\":{\"const\":\"apply\"},\"status\":{\"const\":\"current\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"publication\":{\"$ref\":\"#/$defs/publicationReceipt\"}}},\"currentRecoveryResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"status\",\"publication\"],\"properties\":{\"kind\":{\"const\":\"WakeflowManagedEvidencePublicationRecoveryResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_record_evidence\"},\"mode\":{\"const\":\"recover\"},\"status\":{\"const\":\"current\"},\"publication\":{\"$ref\":\"#/$defs/publicationReceipt\"}}},\"retiredRecoveryResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"status\",\"retirement\"],\"properties\":{\"kind\":{\"const\":\"WakeflowManagedEvidencePublicationRecoveryResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_record_evidence\"},\"mode\":{\"const\":\"recover\"},\"status\":{\"const\":\"retired-stale\"},\"retirement\":{\"$ref\":\"#/$defs/retirementReceipt\"}}},\"healthyRecoveryResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"status\",\"health\"],\"properties\":{\"kind\":{\"const\":\"WakeflowManagedEvidencePublicationRecoveryResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_record_evidence\"},\"mode\":{\"const\":\"recover\"},\"status\":{\"const\":\"healthy\"},\"health\":{\"$ref\":\"#/$defs/healthReceipt\"}}},\"publicationReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"demandId\",\"evidenceId\",\"transactionDigest\",\"manifestDigest\",\"payloadArtifactDigest\",\"recordTreePlanDigest\",\"commandDigest\",\"event\",\"commit\",\"aggregate\"],\"properties\":{\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"evidenceId\":{\"$ref\":\"#/$defs/evidenceId\"},\"transactionDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"manifestDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"payloadArtifactDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"recordTreePlanDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"commandDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"event\":{\"$ref\":\"#/$defs/eventReceipt\"},\"commit\":{\"$ref\":\"#/$defs/commitReceipt\"},\"aggregate\":{\"$ref\":\"#/$defs/aggregateReceipt\"}}},\"retirementReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"demandId\",\"evidenceId\",\"transactionDigest\",\"manifestDigest\",\"payloadArtifactDigest\"],\"properties\":{\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"evidenceId\":{\"$ref\":\"#/$defs/evidenceId\"},\"transactionDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"manifestDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"payloadArtifactDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"healthReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"demandId\",\"streamRevision\",\"stateDigest\",\"managedEvidenceCount\"],\"properties\":{\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"streamRevision\":{\"$ref\":\"#/$defs/positiveSafeInteger\"},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"managedEvidenceCount\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":10000}}},\"eventReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"eventId\",\"streamRevision\"],\"properties\":{\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"streamRevision\":{\"$ref\":\"#/$defs/positiveSafeInteger\"}}},\"commitReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"commitId\",\"commitSequence\",\"commitDigest\"],\"properties\":{\"commitId\":{\"$ref\":\"#/$defs/commitId\"},\"commitSequence\":{\"$ref\":\"#/$defs/positiveSafeInteger\"},\"commitDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"aggregateReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"streamRevision\",\"stateDigest\"],\"properties\":{\"streamRevision\":{\"$ref\":\"#/$defs/positiveSafeInteger\"},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"publicationPlan\":{\"type\":\"object\",\"description\":\"Complete owner-produced Managed Evidence Publication Transaction.\",\"minProperties\":1},\"positiveSafeInteger\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"evidenceId\":{\"type\":\"string\",\"pattern\":\"^evidence_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"}}}");
