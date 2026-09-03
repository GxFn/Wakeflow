/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-todo-intake-publication-request.schema.json
 */

/**
 * Closed MCP preview/apply/recover request for one immutable TODO Intake publication.
 */
export type WakeflowTodoIntakePublicationRequestV1 = (PreviewRequest | ApplyRequest | RecoverRequest)
/**
 * Absolute path of the existing Wakeflow workspace root. It is physically validated and never returned.
 */
export type WorkspaceRoot = string
export type DemandType = ("requirement" | "bug" | "supplement" | "research")
export type TodoPriority = ("P0" | "P1" | "P2" | "P3")
export type WindowId = string
export type NonEmptyText = string
export type ReasonText = string
export type RequirementId = string
export type ConfirmationId = string
export type PortableResourcePath = string
export type Sha256Digest = string

export interface PreviewRequest {
root: WorkspaceRoot
mode: "preview"
intake: AuthoredIntake
}
export interface AuthoredIntake {
demandType: DemandType
priority: TodoPriority
originWindowId: WindowId
summary: NonEmptyText
intakeRationale: NonEmptyText
readiness: (ReadyReadiness | ParkedReadiness)
autoClaim: boolean
testingDecision: TestingDecision
/**
 * @minItems 1
 * @maxItems 32
 */
authorityMembers: [AuthorityMemberSelection, ...(AuthorityMemberSelection)[]]
}
export interface ReadyReadiness {
status: "ready"
}
export interface ParkedReadiness {
status: "parked"
trigger: ReasonText
}
export interface TestingDecision {
mode: ("controller-only" | "real-environment" | "not-applicable")
summary: ReasonText
}
export interface AuthorityMemberSelection {
recordId: (RequirementId | ConfirmationId)
memberPath: PortableResourcePath
}
export interface ApplyRequest {
root: WorkspaceRoot
mode: "apply"
plan: PublicationPlan
planDigest: Sha256Digest
}
/**
 * Complete owner-produced TODO Intake plan. The domain Plan parser revalidates its exact closed shape before Apply or Recover.
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
export const WAKEFLOW_TODO_INTAKE_PUBLICATION_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:todo-intake-publication-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TODO_INTAKE_PUBLICATION_REQUEST_SCHEMA\",\"title\":\"WakeflowTodoIntakePublicationRequestV1\",\"description\":\"Closed MCP preview/apply/recover request for one immutable TODO Intake publication.\",\"$comment\":\"Preview accepts only author-owned queue semantics, one current origin window, a testing decision, and Ledger member selections. Program, Controller, complete refs, environment ref, TODO ID, time, Config/Collection digests and target Intake are owner-derived. Apply and recover require the exact preview plan and digest.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/previewRequest\"},{\"$ref\":\"#/$defs/applyRequest\"},{\"$ref\":\"#/$defs/recoverRequest\"}],\"$defs\":{\"previewRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"intake\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"const\":\"preview\"},\"intake\":{\"$ref\":\"#/$defs/authoredIntake\"}}},\"applyRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"plan\",\"planDigest\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"const\":\"apply\"},\"plan\":{\"$ref\":\"#/$defs/publicationPlan\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"recoverRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"plan\",\"planDigest\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"const\":\"recover\"},\"plan\":{\"$ref\":\"#/$defs/publicationPlan\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"authoredIntake\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"demandType\",\"priority\",\"originWindowId\",\"summary\",\"intakeRationale\",\"readiness\",\"autoClaim\",\"testingDecision\",\"authorityMembers\"],\"properties\":{\"demandType\":{\"$ref\":\"#/$defs/demandType\"},\"priority\":{\"$ref\":\"#/$defs/todoPriority\"},\"originWindowId\":{\"$ref\":\"#/$defs/windowId\"},\"summary\":{\"$ref\":\"#/$defs/nonEmptyText\"},\"intakeRationale\":{\"$ref\":\"#/$defs/nonEmptyText\"},\"readiness\":{\"oneOf\":[{\"$ref\":\"#/$defs/readyReadiness\"},{\"$ref\":\"#/$defs/parkedReadiness\"}]},\"autoClaim\":{\"type\":\"boolean\"},\"testingDecision\":{\"$ref\":\"#/$defs/testingDecision\"},\"authorityMembers\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/authorityMemberSelection\"}}}},\"readyReadiness\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\"],\"properties\":{\"status\":{\"const\":\"ready\"}}},\"parkedReadiness\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"trigger\"],\"properties\":{\"status\":{\"const\":\"parked\"},\"trigger\":{\"$ref\":\"#/$defs/reasonText\"}}},\"testingDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"mode\",\"summary\"],\"properties\":{\"mode\":{\"enum\":[\"controller-only\",\"real-environment\",\"not-applicable\"]},\"summary\":{\"$ref\":\"#/$defs/reasonText\"}}},\"authorityMemberSelection\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"recordId\",\"memberPath\"],\"properties\":{\"recordId\":{\"oneOf\":[{\"$ref\":\"#/$defs/requirementId\"},{\"$ref\":\"#/$defs/confirmationId\"}]},\"memberPath\":{\"$ref\":\"#/$defs/portableResourcePath\"}}},\"publicationPlan\":{\"type\":\"object\",\"minProperties\":1,\"description\":\"Complete owner-produced TODO Intake plan. The domain Plan parser revalidates its exact closed shape before Apply or Recover.\"},\"workspaceRoot\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root. It is physically validated and never returned.\"},\"nonEmptyText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"reasonText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":4096,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"demandType\":{\"enum\":[\"requirement\",\"bug\",\"supplement\",\"research\"]},\"todoPriority\":{\"enum\":[\"P0\",\"P1\",\"P2\",\"P3\"]},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"requirementId\":{\"type\":\"string\",\"pattern\":\"^requirement_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"confirmationId\":{\"type\":\"string\",\"pattern\":\"^confirmation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"pattern\":\"^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\\\.{1,2}(?:/|$))(?!.*\\\\/\\\\.{1,2}(?:/|$))(?!.*\\\\\\\\)(?!.*//)(?!.*\\\\/$)(?!\\\\s)(?!.*\\\\s$)(?!.*\\\\/\\\\s)(?!.*\\\\s\\\\/)(?!.*[\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]).+$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"}}}");
