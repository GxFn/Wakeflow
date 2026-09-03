/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-todo-inspection-result.schema.json
 */

/**
 * Successful bounded TODO list page or exact redacted TODO item inspection.
 */
export type WakeflowTodoInspectionResultV1 = (ListResult | ItemResult)
export type Sha256Digest = string
export type Summary = ({
[k: string]: unknown | undefined
} & {
todoId: TodoId
createdAt: UtcInstant
updatedAt: UtcInstant
status: TodoStatus
revision: Revision
demandType: DemandType
priority: TodoPriority
originWindowId: WindowId
controllerWindowId: WindowId
summary: NonEmptyText
parkedTrigger: (null | ReasonText)
autoClaim: boolean
testingMode: TestingMode
mountedDemandId: (null | DemandId)
intakeDigest: Sha256Digest
stateDigest: Sha256Digest
})
export type TodoId = string
export type UtcInstant = string
export type TodoStatus = ("pending-claim" | "parked" | "claimed" | "withdrawn" | "archived")
export type Revision = number
export type DemandType = ("requirement" | "bug" | "supplement" | "research")
export type TodoPriority = ("P0" | "P1" | "P2" | "P3")
export type WindowId = string
export type NonEmptyText = string
export type ReasonText = string
export type TestingMode = ("controller-only" | "real-environment" | "not-applicable")
export type DemandId = string
export type ProgramId = string
export type PortableResourcePath = string
export type AuthorityMemberReference = ({
[k: string]: unknown | undefined
} & {
[k: string]: unknown | undefined
} & {
artifactKind: "wakeflow-ledger-authority-member-reference"
schemaVersion: 1
family: ("requirement" | "confirmation")
recordId: (RequirementId | ConfirmationId)
recordRef: PortableResourcePath
recordDigest: Sha256Digest
memberPath: PortableResourcePath
memberRef: PortableResourcePath
memberDigest: Sha256Digest
role: AuthorityRole
mediaType: "text/markdown"
} & {
artifactKind: "wakeflow-ledger-authority-member-reference"
schemaVersion: 1
family: ("requirement" | "confirmation")
recordId: (RequirementId | ConfirmationId)
recordRef: PortableResourcePath
recordDigest: Sha256Digest
memberPath: PortableResourcePath
memberRef: PortableResourcePath
memberDigest: Sha256Digest
role: AuthorityRole
mediaType: "text/markdown"
})
export type RequirementId = string
export type ConfirmationId = string
export type AuthorityRole = ("original-plan" | "requirement-design" | "code-facts" | "landing-plan" | "non-goals" | "user-confirmation" | "reproduction" | "scope" | "requirement-delta" | "research-question" | "boundaries" | "test-environment" | "supporting-evidence" | "goal-stage-decision")
export type StateDetail = ({
[k: string]: unknown | undefined
} & {
status: TodoStatus
revision: Revision
updatedAt: UtcInstant
mountedDemandId: (null | DemandId)
withdrawal: (null | Withdrawal)
archive: (null | ArchiveDetail)
})
export type ArchiveId = string

export interface ListResult {
kind: "WakeflowTodoInspectionList"
schemaVersion: 1
tool: "wakeflow_inspect_todo"
status: "current"
view: "list"
collection: CollectionReference
totalMatched: number
/**
 * @maxItems 100
 */
items: Summary[]
nextPageToken: string
}
export interface CollectionReference {
collectionDigest: Sha256Digest
itemCount: number
activeItemCount: number
}
export interface ItemResult {
kind: "WakeflowTodoInspectionItem"
schemaVersion: 1
tool: "wakeflow_inspect_todo"
status: "current"
view: "item"
collection: CollectionReference
item: ItemDetail
}
export interface ItemDetail {
todoId: TodoId
intakeDigest: Sha256Digest
stateDigest: Sha256Digest
intake: Intake
state: StateDetail
}
export interface Intake {
artifactKind: "wakeflow-todo-intake"
schemaVersion: 1
programId: ProgramId
todoId: TodoId
createdAt: UtcInstant
demandType: DemandType
priority: TodoPriority
originWindowId: WindowId
controllerWindowId: WindowId
summary: NonEmptyText
intakeRationale: NonEmptyText
readiness: (ReadyReadiness | ParkedReadiness)
autoClaim: boolean
testingDecision: TestingDecision
/**
 * @minItems 1
 * @maxItems 32
 */
authorityRefs: [AuthorityMemberReference, ...(AuthorityMemberReference)[]]
}
export interface ReadyReadiness {
status: "ready"
}
export interface ParkedReadiness {
status: "parked"
trigger: ReasonText
}
export interface TestingDecision {
mode: TestingMode
summary: ReasonText
environmentMemberRef: (null | PortableResourcePath)
}
export interface Withdrawal {
reason: ReasonText
withdrawnAt: UtcInstant
}
export interface ArchiveDetail {
archiveId: ArchiveId
demandId: DemandId
manifestDigest: Sha256Digest
archivedAt: UtcInstant
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
export const WAKEFLOW_TODO_INSPECTION_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:todo-inspection-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TODO_INSPECTION_RESULT_SCHEMA\",\"title\":\"WakeflowTodoInspectionResultV1\",\"description\":\"Successful bounded TODO list page or exact redacted TODO item inspection.\",\"$comment\":\"The result is observation only. It exposes no workspace root, file node, storage key, Board/projection content, lock, transaction, state-root ref, mount identity digest, eligibility decision, claim authority, or mutation capability.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/listResult\"},{\"$ref\":\"#/$defs/itemResult\"}],\"$defs\":{\"listResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"status\",\"view\",\"collection\",\"totalMatched\",\"items\",\"nextPageToken\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTodoInspectionList\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_inspect_todo\"},\"status\":{\"const\":\"current\"},\"view\":{\"const\":\"list\"},\"collection\":{\"$ref\":\"#/$defs/collectionReference\"},\"totalMatched\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":65536},\"items\":{\"type\":\"array\",\"maxItems\":100,\"items\":{\"$ref\":\"#/$defs/summary\"}},\"nextPageToken\":{\"type\":\"string\",\"maxLength\":256,\"pattern\":\"^[A-Za-z0-9_-]*$\"}}},\"itemResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"status\",\"view\",\"collection\",\"item\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTodoInspectionItem\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_inspect_todo\"},\"status\":{\"const\":\"current\"},\"view\":{\"const\":\"item\"},\"collection\":{\"$ref\":\"#/$defs/collectionReference\"},\"item\":{\"$ref\":\"#/$defs/itemDetail\"}}},\"collectionReference\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"collectionDigest\",\"itemCount\",\"activeItemCount\"],\"properties\":{\"collectionDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"itemCount\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":65536},\"activeItemCount\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":65536}}},\"summary\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"todoId\",\"createdAt\",\"updatedAt\",\"status\",\"revision\",\"demandType\",\"priority\",\"originWindowId\",\"controllerWindowId\",\"summary\",\"parkedTrigger\",\"autoClaim\",\"testingMode\",\"mountedDemandId\",\"intakeDigest\",\"stateDigest\"],\"properties\":{\"todoId\":{\"$ref\":\"#/$defs/todoId\"},\"createdAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"updatedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"status\":{\"$ref\":\"#/$defs/todoStatus\"},\"revision\":{\"$ref\":\"#/$defs/revision\"},\"demandType\":{\"$ref\":\"#/$defs/demandType\"},\"priority\":{\"$ref\":\"#/$defs/todoPriority\"},\"originWindowId\":{\"$ref\":\"#/$defs/windowId\"},\"controllerWindowId\":{\"$ref\":\"#/$defs/windowId\"},\"summary\":{\"$ref\":\"#/$defs/nonEmptyText\"},\"parkedTrigger\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/reasonText\"}]},\"autoClaim\":{\"type\":\"boolean\"},\"testingMode\":{\"$ref\":\"#/$defs/testingMode\"},\"mountedDemandId\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/demandId\"}]},\"intakeDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}},\"allOf\":[{\"if\":{\"properties\":{\"status\":{\"const\":\"parked\"}},\"required\":[\"status\"]},\"then\":{\"properties\":{\"parkedTrigger\":{\"$ref\":\"#/$defs/reasonText\"}}},\"else\":{\"properties\":{\"parkedTrigger\":{\"type\":\"null\"}}}},{\"if\":{\"properties\":{\"status\":{\"enum\":[\"claimed\",\"archived\"]}},\"required\":[\"status\"]},\"then\":{\"properties\":{\"mountedDemandId\":{\"$ref\":\"#/$defs/demandId\"}}},\"else\":{\"properties\":{\"mountedDemandId\":{\"type\":\"null\"}}}}]},\"itemDetail\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"todoId\",\"intakeDigest\",\"stateDigest\",\"intake\",\"state\"],\"properties\":{\"todoId\":{\"$ref\":\"#/$defs/todoId\"},\"intakeDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"intake\":{\"$ref\":\"#/$defs/intake\"},\"state\":{\"$ref\":\"#/$defs/stateDetail\"}}},\"intake\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"programId\",\"todoId\",\"createdAt\",\"demandType\",\"priority\",\"originWindowId\",\"controllerWindowId\",\"summary\",\"intakeRationale\",\"readiness\",\"autoClaim\",\"testingDecision\",\"authorityRefs\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-todo-intake\"},\"schemaVersion\":{\"const\":1},\"programId\":{\"$ref\":\"#/$defs/programId\"},\"todoId\":{\"$ref\":\"#/$defs/todoId\"},\"createdAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"demandType\":{\"$ref\":\"#/$defs/demandType\"},\"priority\":{\"$ref\":\"#/$defs/todoPriority\"},\"originWindowId\":{\"$ref\":\"#/$defs/windowId\"},\"controllerWindowId\":{\"$ref\":\"#/$defs/windowId\"},\"summary\":{\"$ref\":\"#/$defs/nonEmptyText\"},\"intakeRationale\":{\"$ref\":\"#/$defs/nonEmptyText\"},\"readiness\":{\"oneOf\":[{\"$ref\":\"#/$defs/readyReadiness\"},{\"$ref\":\"#/$defs/parkedReadiness\"}]},\"autoClaim\":{\"type\":\"boolean\"},\"testingDecision\":{\"$ref\":\"#/$defs/testingDecision\"},\"authorityRefs\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/authorityMemberReference\"}}}},\"readyReadiness\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\"],\"properties\":{\"status\":{\"const\":\"ready\"}}},\"parkedReadiness\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"trigger\"],\"properties\":{\"status\":{\"const\":\"parked\"},\"trigger\":{\"$ref\":\"#/$defs/reasonText\"}}},\"testingDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"mode\",\"summary\",\"environmentMemberRef\"],\"properties\":{\"mode\":{\"$ref\":\"#/$defs/testingMode\"},\"summary\":{\"$ref\":\"#/$defs/reasonText\"},\"environmentMemberRef\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/portableResourcePath\"}]}}},\"stateDetail\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"revision\",\"updatedAt\",\"mountedDemandId\",\"withdrawal\",\"archive\"],\"properties\":{\"status\":{\"$ref\":\"#/$defs/todoStatus\"},\"revision\":{\"$ref\":\"#/$defs/revision\"},\"updatedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"mountedDemandId\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/demandId\"}]},\"withdrawal\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/withdrawal\"}]},\"archive\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/archiveDetail\"}]}},\"allOf\":[{\"if\":{\"properties\":{\"status\":{\"const\":\"withdrawn\"}},\"required\":[\"status\"]},\"then\":{\"properties\":{\"mountedDemandId\":{\"type\":\"null\"},\"withdrawal\":{\"$ref\":\"#/$defs/withdrawal\"},\"archive\":{\"type\":\"null\"}}},\"else\":{\"properties\":{\"withdrawal\":{\"type\":\"null\"}}}},{\"if\":{\"properties\":{\"status\":{\"const\":\"archived\"}},\"required\":[\"status\"]},\"then\":{\"properties\":{\"mountedDemandId\":{\"$ref\":\"#/$defs/demandId\"},\"archive\":{\"$ref\":\"#/$defs/archiveDetail\"}}},\"else\":{\"properties\":{\"archive\":{\"type\":\"null\"}}}},{\"if\":{\"properties\":{\"status\":{\"const\":\"claimed\"}},\"required\":[\"status\"]},\"then\":{\"properties\":{\"mountedDemandId\":{\"$ref\":\"#/$defs/demandId\"}}}},{\"if\":{\"properties\":{\"status\":{\"enum\":[\"pending-claim\",\"parked\"]}},\"required\":[\"status\"]},\"then\":{\"properties\":{\"mountedDemandId\":{\"type\":\"null\"}}}}]},\"withdrawal\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"reason\",\"withdrawnAt\"],\"properties\":{\"reason\":{\"$ref\":\"#/$defs/reasonText\"},\"withdrawnAt\":{\"$ref\":\"#/$defs/utcInstant\"}}},\"archiveDetail\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"archiveId\",\"demandId\",\"manifestDigest\",\"archivedAt\"],\"properties\":{\"archiveId\":{\"$ref\":\"#/$defs/archiveId\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"manifestDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"archivedAt\":{\"$ref\":\"#/$defs/utcInstant\"}}},\"authorityMemberReference\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"family\",\"recordId\",\"recordRef\",\"recordDigest\",\"memberPath\",\"memberRef\",\"memberDigest\",\"role\",\"mediaType\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-ledger-authority-member-reference\"},\"schemaVersion\":{\"const\":1},\"family\":{\"enum\":[\"requirement\",\"confirmation\"]},\"recordId\":{\"oneOf\":[{\"$ref\":\"#/$defs/requirementId\"},{\"$ref\":\"#/$defs/confirmationId\"}]},\"recordRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"recordDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"memberPath\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"memberRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"memberDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"role\":{\"$ref\":\"#/$defs/authorityRole\"},\"mediaType\":{\"const\":\"text/markdown\"}},\"allOf\":[{\"if\":{\"properties\":{\"family\":{\"const\":\"requirement\"}},\"required\":[\"family\"]},\"then\":{\"properties\":{\"recordId\":{\"$ref\":\"#/$defs/requirementId\"},\"role\":{\"$ref\":\"#/$defs/requirementRole\"}}}},{\"if\":{\"properties\":{\"family\":{\"const\":\"confirmation\"}},\"required\":[\"family\"]},\"then\":{\"properties\":{\"recordId\":{\"$ref\":\"#/$defs/confirmationId\"},\"role\":{\"$ref\":\"#/$defs/confirmationRole\"}}}}]},\"todoStatus\":{\"enum\":[\"pending-claim\",\"parked\",\"claimed\",\"withdrawn\",\"archived\"]},\"todoPriority\":{\"enum\":[\"P0\",\"P1\",\"P2\",\"P3\"]},\"demandType\":{\"enum\":[\"requirement\",\"bug\",\"supplement\",\"research\"]},\"testingMode\":{\"enum\":[\"controller-only\",\"real-environment\",\"not-applicable\"]},\"authorityRole\":{\"enum\":[\"original-plan\",\"requirement-design\",\"code-facts\",\"landing-plan\",\"non-goals\",\"user-confirmation\",\"reproduction\",\"scope\",\"requirement-delta\",\"research-question\",\"boundaries\",\"test-environment\",\"supporting-evidence\",\"goal-stage-decision\"]},\"requirementRole\":{\"enum\":[\"original-plan\",\"requirement-design\",\"code-facts\",\"landing-plan\",\"non-goals\",\"user-confirmation\",\"reproduction\",\"scope\",\"requirement-delta\",\"research-question\",\"boundaries\",\"test-environment\",\"supporting-evidence\"]},\"confirmationRole\":{\"enum\":[\"goal-stage-decision\",\"user-confirmation\",\"requirement-delta\",\"supporting-evidence\"]},\"revision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"nonEmptyText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"reasonText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":4096,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"pattern\":\"^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\\\.{1,2}(?:/|$))(?!.*\\\\/\\\\.{1,2}(?:/|$))(?!.*\\\\\\\\)(?!.*//)(?!.*\\\\/$)(?!\\\\s)(?!.*\\\\s$)(?!.*\\\\/\\\\s)(?!.*\\\\s\\\\/)(?!.*[\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]).+$\"},\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"todoId\":{\"type\":\"string\",\"pattern\":\"^todo_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"archiveId\":{\"type\":\"string\",\"pattern\":\"^archive_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"requirementId\":{\"type\":\"string\",\"pattern\":\"^requirement_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"confirmationId\":{\"type\":\"string\",\"pattern\":\"^confirmation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}");
