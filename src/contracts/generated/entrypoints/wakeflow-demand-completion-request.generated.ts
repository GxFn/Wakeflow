/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-demand-completion-request.schema.json
 */

/**
 * Closed MCP preview/apply request for one exact Demand completion transition.
 */
export type WakeflowDemandCompletionRequestV1 = (PreviewRequest | ApplyRequest)
export type DemandId = string
export type CommitId = string
export type EventId = string
export type Sha256Digest = string
export type PortableResourcePath = string
export type NonEmptyText = string
export type ProgramId = string
export type WindowId = string
export type TodoId = string
export type UtcInstant = string

export interface PreviewRequest {
/**
 * Absolute path of the existing Wakeflow workspace root.
 */
root: string
mode: "preview"
demandId: DemandId
}
export interface ApplyRequest {
/**
 * Absolute path of the existing Wakeflow workspace root.
 */
root: string
mode: "apply"
plan: Plan
planDigest: Sha256Digest
}
export interface Plan {
kind: "WakeflowDemandCompletionPlan"
schemaVersion: 1
demandId: DemandId
expectedStreamRevision: number
commitId: CommitId
eventId: EventId
authority: Authority
completion: Completion
}
export interface Authority {
artifactKind: "wakeflow-demand-authority"
schemaVersion: 1
demandId: DemandId
identityDigest: Sha256Digest
/**
 * @minItems 1
 * @maxItems 32
 */
authorityRefs: [AuthorityMemberReference, ...(AuthorityMemberReference)[]]
testingDecision: TestingDecision
}
export interface AuthorityMemberReference {
artifactKind: "wakeflow-ledger-authority-member-reference"
schemaVersion: 1
family: ("requirement" | "confirmation")
recordId: string
recordRef: PortableResourcePath
recordDigest: Sha256Digest
memberPath: PortableResourcePath
memberRef: PortableResourcePath
memberDigest: Sha256Digest
role: ("original-plan" | "requirement-design" | "code-facts" | "landing-plan" | "non-goals" | "user-confirmation" | "reproduction" | "scope" | "requirement-delta" | "research-question" | "boundaries" | "test-environment" | "supporting-evidence" | "goal-stage-decision")
mediaType: string
}
export interface TestingDecision {
mode: ("controller-only" | "real-environment" | "not-applicable")
summary: NonEmptyText
environmentMemberRef: (null | PortableResourcePath)
}
export interface Completion {
kind: "WakeflowDemandCompletion"
schemaVersion: 1
programId: ProgramId
demandId: DemandId
controllerWindowId: WindowId
authorityDigest: Sha256Digest
testingMode: ("controller-only" | "real-environment")
postAcceptanceRouteDigest: Sha256Digest
reviewSnapshotDigest: Sha256Digest
observedState: ObservedState
todoSource: TodoSource
completedAt: UtcInstant
completionDigest: Sha256Digest
}
export interface ObservedState {
streamRevision: number
stateDigest: Sha256Digest
lastEventId: EventId
lastEventDigest: Sha256Digest
}
export interface TodoSource {
todoId: TodoId
intakeRef: PortableResourcePath
intakeDigest: Sha256Digest
stateRevision: number
stateDigest: Sha256Digest
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
export const WAKEFLOW_DEMAND_COMPLETION_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:demand-completion-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_COMPLETION_REQUEST_SCHEMA\",\"title\":\"WakeflowDemandCompletionRequestV1\",\"description\":\"Closed MCP preview/apply request for one exact Demand completion transition.\",\"$comment\":\"Preview selects one current Demand only. Apply must replay the exact preview plan and digest; the caller cannot provide Controller, TODO, Route, Review, testing, time, Event, Archive, host-close, or cleanup authority.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/previewRequest\"},{\"$ref\":\"#/$defs/applyRequest\"}],\"$defs\":{\"previewRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"demandId\"],\"properties\":{\"root\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"mode\":{\"const\":\"preview\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"}}},\"applyRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"plan\",\"planDigest\"],\"properties\":{\"root\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"mode\":{\"const\":\"apply\"},\"plan\":{\"$ref\":\"#/$defs/plan\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"plan\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"demandId\",\"expectedStreamRevision\",\"commitId\",\"eventId\",\"authority\",\"completion\"],\"properties\":{\"kind\":{\"const\":\"WakeflowDemandCompletionPlan\"},\"schemaVersion\":{\"const\":1},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"expectedStreamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"commitId\":{\"$ref\":\"#/$defs/commitId\"},\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"authority\":{\"$ref\":\"#/$defs/authority\"},\"completion\":{\"$ref\":\"#/$defs/completion\"}}},\"authority\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"demandId\",\"identityDigest\",\"authorityRefs\",\"testingDecision\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-demand-authority\"},\"schemaVersion\":{\"const\":1},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"identityDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"authorityRefs\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/authorityMemberReference\"}},\"testingDecision\":{\"$ref\":\"#/$defs/testingDecision\"}}},\"completion\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"programId\",\"demandId\",\"controllerWindowId\",\"authorityDigest\",\"testingMode\",\"postAcceptanceRouteDigest\",\"reviewSnapshotDigest\",\"observedState\",\"todoSource\",\"completedAt\",\"completionDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowDemandCompletion\"},\"schemaVersion\":{\"const\":1},\"programId\":{\"$ref\":\"#/$defs/programId\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"controllerWindowId\":{\"$ref\":\"#/$defs/windowId\"},\"authorityDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"testingMode\":{\"enum\":[\"controller-only\",\"real-environment\"]},\"postAcceptanceRouteDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"reviewSnapshotDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"observedState\":{\"$ref\":\"#/$defs/observedState\"},\"todoSource\":{\"$ref\":\"#/$defs/todoSource\"},\"completedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"completionDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"authorityMemberReference\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"family\",\"recordId\",\"recordRef\",\"recordDigest\",\"memberPath\",\"memberRef\",\"memberDigest\",\"role\",\"mediaType\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-ledger-authority-member-reference\"},\"schemaVersion\":{\"const\":1},\"family\":{\"enum\":[\"requirement\",\"confirmation\"]},\"recordId\":{\"type\":\"string\",\"pattern\":\"^(?:requirement|confirmation)_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"recordRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"recordDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"memberPath\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"memberRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"memberDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"role\":{\"enum\":[\"original-plan\",\"requirement-design\",\"code-facts\",\"landing-plan\",\"non-goals\",\"user-confirmation\",\"reproduction\",\"scope\",\"requirement-delta\",\"research-question\",\"boundaries\",\"test-environment\",\"supporting-evidence\",\"goal-stage-decision\"]},\"mediaType\":{\"type\":\"string\",\"pattern\":\"^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$\"}}},\"testingDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"mode\",\"summary\",\"environmentMemberRef\"],\"properties\":{\"mode\":{\"enum\":[\"controller-only\",\"real-environment\",\"not-applicable\"]},\"summary\":{\"$ref\":\"#/$defs/nonEmptyText\"},\"environmentMemberRef\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/portableResourcePath\"}]}}},\"observedState\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"streamRevision\",\"stateDigest\",\"lastEventId\",\"lastEventDigest\"],\"properties\":{\"streamRevision\":{\"type\":\"integer\",\"minimum\":1},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"lastEventId\":{\"$ref\":\"#/$defs/eventId\"},\"lastEventDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"todoSource\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"todoId\",\"intakeRef\",\"intakeDigest\",\"stateRevision\",\"stateDigest\"],\"properties\":{\"todoId\":{\"$ref\":\"#/$defs/todoId\"},\"intakeRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"intakeDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"stateRevision\":{\"type\":\"integer\",\"minimum\":2},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"nonEmptyText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"pattern\":\"^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\\\.{1,2}(?:/|$))(?!.*\\\\/\\\\.{1,2}(?:/|$))(?!.*\\\\\\\\)(?!.*//)(?!.*\\\\/$)(?!\\\\s)(?!.*\\\\s$)(?!.*\\\\/\\\\s)(?!.*\\\\s\\\\/)(?!.*[\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]).+$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"todoId\":{\"type\":\"string\",\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$\"},\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}");
