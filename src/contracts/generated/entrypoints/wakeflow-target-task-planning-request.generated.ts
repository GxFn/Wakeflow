/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-target-task-planning-request.schema.json
 */

/**
 * Closed MCP preview/apply request for one immutable implementation Target Task plan.
 */
export type WakeflowTargetTaskPlanningRequestV1 = (PreviewRequest | ApplyRequest)
export type DemandId = string
export type RepositoryId = string
export type WindowId = string
export type HumanText = string
/**
 * @minItems 1
 * @maxItems 32
 */
export type NonEmptyTextList = [HumanText, ...(HumanText)[]]
export type PortableResourcePath = string
/**
 * @maxItems 32
 */
export type TextList = HumanText[]
export type CommitId = string
export type EventId = string
export type ProgramId = string
export type Sha256Digest = string
export type TaskPackageId = string
export type TargetTaskId = string
export type UtcInstant = string

export interface PreviewRequest {
/**
 * Absolute path of the existing Wakeflow workspace root.
 */
root: string
mode: "preview"
demandId: DemandId
taskPackage: AuthoredTaskPackage
}
export interface AuthoredTaskPackage {
assignment: Assignment
workType: "implementation"
objective: HumanText
confirmedContext: NonEmptyTextList
/**
 * @minItems 1
 * @maxItems 32
 */
selectedAuthorityMemberRefs: [PortableResourcePath, ...(PortableResourcePath)[]]
boundaries: Boundaries
completionExpectations: NonEmptyTextList
commitExpectation: ("commit" | "leave-uncommitted")
/**
 * @minItems 1
 * @maxItems 32
 */
acceptanceAnchors: [AcceptanceAnchor, ...(AcceptanceAnchor)[]]
}
export interface Assignment {
repositoryId: RepositoryId
windowId: WindowId
}
export interface Boundaries {
inScope: NonEmptyTextList
outOfScope: TextList
forbidden: TextList
}
export interface AcceptanceAnchor {
anchorId: string
claim: HumanText
probe: HumanText
expected: HumanText
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
kind: "WakeflowTargetTaskPlanningPlan"
schemaVersion: 1
demandId: DemandId
expectedStreamRevision: number
commitId: CommitId
eventId: EventId
taskPackage: TaskPackage
}
export interface TaskPackage {
artifactKind: "wakeflow-task-package"
schemaVersion: 1
programId: ProgramId
configDigest: Sha256Digest
demandId: DemandId
demandAuthorityDigest: Sha256Digest
taskPackageId: TaskPackageId
targetTaskId: TargetTaskId
createdAt: UtcInstant
assignment: Assignment
workType: "implementation"
objective: HumanText
confirmedContext: NonEmptyTextList
/**
 * @minItems 1
 * @maxItems 32
 */
selectedAuthorityRefs: [AuthorityMemberReference, ...(AuthorityMemberReference)[]]
boundaries: Boundaries
completionExpectations: NonEmptyTextList
commitExpectation: ("commit" | "leave-uncommitted")
/**
 * @minItems 1
 * @maxItems 32
 */
acceptanceAnchors: [AcceptanceAnchor, ...(AcceptanceAnchor)[]]
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
export const WAKEFLOW_TARGET_TASK_PLANNING_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:target-task-planning-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TARGET_TASK_PLANNING_REQUEST_SCHEMA\",\"title\":\"WakeflowTargetTaskPlanningRequestV1\",\"description\":\"Closed MCP preview/apply request for one immutable implementation Target Task plan.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/previewRequest\"},{\"$ref\":\"#/$defs/applyRequest\"}],\"$defs\":{\"previewRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"demandId\",\"taskPackage\"],\"properties\":{\"root\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"mode\":{\"const\":\"preview\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"taskPackage\":{\"$ref\":\"#/$defs/authoredTaskPackage\"}}},\"applyRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"plan\",\"planDigest\"],\"properties\":{\"root\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"mode\":{\"const\":\"apply\"},\"plan\":{\"$ref\":\"#/$defs/plan\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"plan\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"demandId\",\"expectedStreamRevision\",\"commitId\",\"eventId\",\"taskPackage\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTargetTaskPlanningPlan\"},\"schemaVersion\":{\"const\":1},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"expectedStreamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"commitId\":{\"$ref\":\"#/$defs/commitId\"},\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"taskPackage\":{\"$ref\":\"#/$defs/taskPackage\"}}},\"authoredTaskPackage\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"assignment\",\"workType\",\"objective\",\"confirmedContext\",\"selectedAuthorityMemberRefs\",\"boundaries\",\"completionExpectations\",\"commitExpectation\",\"acceptanceAnchors\"],\"properties\":{\"assignment\":{\"$ref\":\"#/$defs/assignment\"},\"workType\":{\"const\":\"implementation\"},\"objective\":{\"$ref\":\"#/$defs/humanText\"},\"confirmedContext\":{\"$ref\":\"#/$defs/nonEmptyTextList\"},\"selectedAuthorityMemberRefs\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/portableResourcePath\"}},\"boundaries\":{\"$ref\":\"#/$defs/boundaries\"},\"completionExpectations\":{\"$ref\":\"#/$defs/nonEmptyTextList\"},\"commitExpectation\":{\"enum\":[\"commit\",\"leave-uncommitted\"]},\"acceptanceAnchors\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/acceptanceAnchor\"}}}},\"taskPackage\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"programId\",\"configDigest\",\"demandId\",\"demandAuthorityDigest\",\"taskPackageId\",\"targetTaskId\",\"createdAt\",\"assignment\",\"workType\",\"objective\",\"confirmedContext\",\"selectedAuthorityRefs\",\"boundaries\",\"completionExpectations\",\"commitExpectation\",\"acceptanceAnchors\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-task-package\"},\"schemaVersion\":{\"const\":1},\"programId\":{\"$ref\":\"#/$defs/programId\"},\"configDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"demandAuthorityDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"taskPackageId\":{\"$ref\":\"#/$defs/taskPackageId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"createdAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"assignment\":{\"$ref\":\"#/$defs/assignment\"},\"workType\":{\"const\":\"implementation\"},\"objective\":{\"$ref\":\"#/$defs/humanText\"},\"confirmedContext\":{\"$ref\":\"#/$defs/nonEmptyTextList\"},\"selectedAuthorityRefs\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/authorityMemberReference\"}},\"boundaries\":{\"$ref\":\"#/$defs/boundaries\"},\"completionExpectations\":{\"$ref\":\"#/$defs/nonEmptyTextList\"},\"commitExpectation\":{\"enum\":[\"commit\",\"leave-uncommitted\"]},\"acceptanceAnchors\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/acceptanceAnchor\"}}}},\"authorityMemberReference\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"family\",\"recordId\",\"recordRef\",\"recordDigest\",\"memberPath\",\"memberRef\",\"memberDigest\",\"role\",\"mediaType\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-ledger-authority-member-reference\"},\"schemaVersion\":{\"const\":1},\"family\":{\"enum\":[\"requirement\",\"confirmation\"]},\"recordId\":{\"type\":\"string\",\"pattern\":\"^(?:requirement|confirmation)_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"recordRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"recordDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"memberPath\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"memberRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"memberDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"role\":{\"enum\":[\"original-plan\",\"requirement-design\",\"code-facts\",\"landing-plan\",\"non-goals\",\"user-confirmation\",\"reproduction\",\"scope\",\"requirement-delta\",\"research-question\",\"boundaries\",\"test-environment\",\"supporting-evidence\",\"goal-stage-decision\"]},\"mediaType\":{\"type\":\"string\",\"pattern\":\"^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$\"}}},\"assignment\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"repositoryId\",\"windowId\"],\"properties\":{\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"}}},\"boundaries\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"inScope\",\"outOfScope\",\"forbidden\"],\"properties\":{\"inScope\":{\"$ref\":\"#/$defs/nonEmptyTextList\"},\"outOfScope\":{\"$ref\":\"#/$defs/textList\"},\"forbidden\":{\"$ref\":\"#/$defs/textList\"}}},\"acceptanceAnchor\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"anchorId\",\"claim\",\"probe\",\"expected\"],\"properties\":{\"anchorId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"claim\":{\"$ref\":\"#/$defs/humanText\"},\"probe\":{\"$ref\":\"#/$defs/humanText\"},\"expected\":{\"$ref\":\"#/$defs/humanText\"}}},\"nonEmptyTextList\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/humanText\"}},\"textList\":{\"type\":\"array\",\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/humanText\"}},\"humanText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":16384,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"pattern\":\"^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\\\.{1,2}(?:/|$))(?!.*\\\\/\\\\.{1,2}(?:/|$))(?!.*\\\\\\\\)(?!.*//)(?!.*\\\\/$)(?!\\\\s)(?!.*\\\\s$)(?!.*\\\\/\\\\s)(?!.*\\\\s\\\\/)(?!.*[\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]).+$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"taskPackageId\":{\"type\":\"string\",\"pattern\":\"^task-package_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}");
