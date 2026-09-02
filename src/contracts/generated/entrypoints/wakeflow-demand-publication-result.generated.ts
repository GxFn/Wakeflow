/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-demand-publication-result.schema.json
 */

/**
 * Successful preview, apply, or recovery result for one TODO-backed Demand Event Sourcing publication.
 */
export type WakeflowDemandPublicationResultV1 = (PreviewResult | ApplyResult | RecoveryResult)
export type Sha256Digest = string
export type DemandId = string
export type EventId = string
export type CommitId = string
export type TodoId = string

export interface PreviewResult {
kind: "WakeflowDemandPublicationPreviewResult"
schemaVersion: 1
tool: "wakeflow_create_demand"
mode: "preview"
status: "ready"
plan: PublicationPlan
planDigest: Sha256Digest
}
/**
 * Complete owner-produced Demand Event Sourcing publication transaction. Its exact domain shape is revalidated before Apply.
 */
export interface PublicationPlan {
[k: string]: unknown | undefined
}
export interface ApplyResult {
kind: "WakeflowDemandPublicationApplyResult"
schemaVersion: 1
tool: "wakeflow_create_demand"
mode: "apply"
status: "current"
planDigest: Sha256Digest
publication: PublicationReceipt
}
export interface PublicationReceipt {
publicationAuthority: "current"
demandId: DemandId
identityDigest: Sha256Digest
authorityDigest: Sha256Digest
commandDigest: Sha256Digest
event: EventReceipt
commit: CommitReceipt
stateDigest: Sha256Digest
todoClaim: TodoClaimReceipt
}
export interface EventReceipt {
eventId: EventId
streamRevision: 1
}
export interface CommitReceipt {
commitId: CommitId
commitSequence: 1
commitDigest: Sha256Digest
}
export interface TodoClaimReceipt {
todoId: TodoId
intakeDigest: Sha256Digest
stateRevision: 2
stateDigest: Sha256Digest
}
export interface RecoveryResult {
kind: "WakeflowDemandPublicationRecoveryResult"
schemaVersion: 1
tool: "wakeflow_create_demand"
mode: "recover"
status: "current"
publication: PublicationReceipt
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
export const WAKEFLOW_DEMAND_PUBLICATION_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:demand-publication-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_PUBLICATION_RESULT_SCHEMA\",\"title\":\"WakeflowDemandPublicationResultV1\",\"description\":\"Successful preview, apply, or recovery result for one TODO-backed Demand Event Sourcing publication.\",\"$comment\":\"Preview carries the complete owner-produced plan for review. Apply and recover return only stable publication receipts; full Aggregate, Demand Authority content, TODO snapshots, machine paths, and host effects are not public results.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/previewResult\"},{\"$ref\":\"#/$defs/applyResult\"},{\"$ref\":\"#/$defs/recoveryResult\"}],\"$defs\":{\"previewResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"status\",\"plan\",\"planDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowDemandPublicationPreviewResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_create_demand\"},\"mode\":{\"const\":\"preview\"},\"status\":{\"const\":\"ready\"},\"plan\":{\"$ref\":\"#/$defs/publicationPlan\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"applyResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"status\",\"planDigest\",\"publication\"],\"properties\":{\"kind\":{\"const\":\"WakeflowDemandPublicationApplyResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_create_demand\"},\"mode\":{\"const\":\"apply\"},\"status\":{\"const\":\"current\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"publication\":{\"$ref\":\"#/$defs/publicationReceipt\"}}},\"recoveryResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"status\",\"publication\"],\"properties\":{\"kind\":{\"const\":\"WakeflowDemandPublicationRecoveryResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_create_demand\"},\"mode\":{\"const\":\"recover\"},\"status\":{\"const\":\"current\"},\"publication\":{\"$ref\":\"#/$defs/publicationReceipt\"}}},\"publicationReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"publicationAuthority\",\"demandId\",\"identityDigest\",\"authorityDigest\",\"commandDigest\",\"event\",\"commit\",\"stateDigest\",\"todoClaim\"],\"properties\":{\"publicationAuthority\":{\"const\":\"current\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"identityDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"authorityDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"commandDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"event\":{\"$ref\":\"#/$defs/eventReceipt\"},\"commit\":{\"$ref\":\"#/$defs/commitReceipt\"},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"todoClaim\":{\"$ref\":\"#/$defs/todoClaimReceipt\"}}},\"eventReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"eventId\",\"streamRevision\"],\"properties\":{\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"streamRevision\":{\"const\":1}}},\"commitReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"commitId\",\"commitSequence\",\"commitDigest\"],\"properties\":{\"commitId\":{\"$ref\":\"#/$defs/commitId\"},\"commitSequence\":{\"const\":1},\"commitDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"todoClaimReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"todoId\",\"intakeDigest\",\"stateRevision\",\"stateDigest\"],\"properties\":{\"todoId\":{\"$ref\":\"#/$defs/todoId\"},\"intakeDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"stateRevision\":{\"const\":2},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"publicationPlan\":{\"type\":\"object\",\"description\":\"Complete owner-produced Demand Event Sourcing publication transaction. Its exact domain shape is revalidated before Apply.\",\"minProperties\":1},\"todoId\":{\"type\":\"string\",\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"}}}");
