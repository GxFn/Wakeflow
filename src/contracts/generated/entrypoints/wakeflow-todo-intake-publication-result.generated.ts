/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-todo-intake-publication-result.schema.json
 */

/**
 * Successful preview, apply, or exact recovery result for one immutable TODO Intake publication.
 */
export type WakeflowTodoIntakePublicationResultV1 = (PreviewResult | ApplyResult | RecoveryResult)
export type Sha256Digest = string
export type ApplyReceipt = (PublicationReceipt & {
disposition?: ("published" | "current")
[k: string]: unknown | undefined
})
export type TodoId = string
export type RecoveryReceipt = (PublicationReceipt & {
disposition?: ("recovered" | "current")
[k: string]: unknown | undefined
})

export interface PreviewResult {
kind: "WakeflowTodoIntakePublicationPreviewResult"
schemaVersion: 1
tool: "wakeflow_intake_todo"
mode: "preview"
status: "ready"
plan: PublicationPlan
planDigest: Sha256Digest
}
/**
 * Complete owner-produced TODO Intake plan. Its exact domain shape is revalidated before Apply or Recover.
 */
export interface PublicationPlan {
[k: string]: unknown | undefined
}
export interface ApplyResult {
kind: "WakeflowTodoIntakePublicationApplyResult"
schemaVersion: 1
tool: "wakeflow_intake_todo"
mode: "apply"
status: "current"
planDigest: Sha256Digest
publication: ApplyReceipt
}
export interface PublicationReceipt {
publicationAuthority: "current"
disposition: ("published" | "recovered" | "current")
todoId: TodoId
todoStatus: ("pending-claim" | "parked")
intakeDigest: Sha256Digest
stateDigest: Sha256Digest
collectionDigest: Sha256Digest
}
export interface RecoveryResult {
kind: "WakeflowTodoIntakePublicationRecoveryResult"
schemaVersion: 1
tool: "wakeflow_intake_todo"
mode: "recover"
status: "current"
planDigest: Sha256Digest
publication: RecoveryReceipt
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
export const WAKEFLOW_TODO_INTAKE_PUBLICATION_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:todo-intake-publication-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TODO_INTAKE_PUBLICATION_RESULT_SCHEMA\",\"title\":\"WakeflowTodoIntakePublicationResultV1\",\"description\":\"Successful preview, apply, or exact recovery result for one immutable TODO Intake publication.\",\"$comment\":\"Preview returns the complete owner-produced plan. Apply and recover return only stable TODO identity, state and digest metadata; they expose no full Intake, Ledger records, workspace root, file node, transaction, lock, stage or Board content.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/previewResult\"},{\"$ref\":\"#/$defs/applyResult\"},{\"$ref\":\"#/$defs/recoveryResult\"}],\"$defs\":{\"previewResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"status\",\"plan\",\"planDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTodoIntakePublicationPreviewResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_intake_todo\"},\"mode\":{\"const\":\"preview\"},\"status\":{\"const\":\"ready\"},\"plan\":{\"$ref\":\"#/$defs/publicationPlan\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"applyResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"status\",\"planDigest\",\"publication\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTodoIntakePublicationApplyResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_intake_todo\"},\"mode\":{\"const\":\"apply\"},\"status\":{\"const\":\"current\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"publication\":{\"$ref\":\"#/$defs/applyReceipt\"}}},\"recoveryResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"status\",\"planDigest\",\"publication\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTodoIntakePublicationRecoveryResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_intake_todo\"},\"mode\":{\"const\":\"recover\"},\"status\":{\"const\":\"current\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"publication\":{\"$ref\":\"#/$defs/recoveryReceipt\"}}},\"applyReceipt\":{\"allOf\":[{\"$ref\":\"#/$defs/publicationReceipt\"},{\"type\":\"object\",\"properties\":{\"disposition\":{\"enum\":[\"published\",\"current\"]}}}]},\"recoveryReceipt\":{\"allOf\":[{\"$ref\":\"#/$defs/publicationReceipt\"},{\"type\":\"object\",\"properties\":{\"disposition\":{\"enum\":[\"recovered\",\"current\"]}}}]},\"publicationReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"publicationAuthority\",\"disposition\",\"todoId\",\"todoStatus\",\"intakeDigest\",\"stateDigest\",\"collectionDigest\"],\"properties\":{\"publicationAuthority\":{\"const\":\"current\"},\"disposition\":{\"enum\":[\"published\",\"recovered\",\"current\"]},\"todoId\":{\"$ref\":\"#/$defs/todoId\"},\"todoStatus\":{\"enum\":[\"pending-claim\",\"parked\"]},\"intakeDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"collectionDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"publicationPlan\":{\"type\":\"object\",\"minProperties\":1,\"description\":\"Complete owner-produced TODO Intake plan. Its exact domain shape is revalidated before Apply or Recover.\"},\"todoId\":{\"type\":\"string\",\"pattern\":\"^todo_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"}}}");
