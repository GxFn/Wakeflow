/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-test-card-planning-request.schema.json
 */

/**
 * Closed MCP preview/apply request for one Controller-authored real-environment TestCard plan.
 */
export type WakeflowTestCardPlanningRequestV1 = (PreviewRequest | ApplyRequest)
export type DemandId = string
/**
 * @minItems 1
 * @maxItems 32
 */
export type NonEmptyTextList = [string, ...(string)[]]
/**
 * @maxItems 32
 */
export type AllowedSkills = string[]
export type CommitId = string
export type EventId = string
export type Sha256Digest = string
/**
 * 跨领域只读消费一份已验证 Ledger authority member 的完整 ref/digest 关系。
 */
export type AuthorityMemberReference = ({
[k: string]: unknown | undefined
} & {
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
})
export type PortableResourcePath = string
export type UtcInstant = string
/**
 * TestCard创建Event记录的代际原因；不进入TestCard执行合同。
 */
export type GenerationSource = (Initial | ProductDefectRetest)

export interface PreviewRequest {
/**
 * Absolute path of the existing Wakeflow workspace root.
 */
root: string
mode: "preview"
demandId: DemandId
testCard: AuthoredContent
}
export interface AuthoredContent {
allowedOperations: NonEmptyTextList
allowedSkills: AllowedSkills
approvedPlan: NonEmptyTextList
cannotConclude: NonEmptyTextList
controllerSelfChecks: NonEmptyTextList
evidenceRequired: NonEmptyTextList
failureMeans: NonEmptyTextList
forbiddenOperations: NonEmptyTextList
maxAttempts: number
objectBoundary: string
question: string
realScenarioConditions: NonEmptyTextList
setupPolicy: ("fresh-once" | "fresh-per-attempt" | "reuse-existing")
stopConditions: NonEmptyTextList
successMeans: NonEmptyTextList
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
kind: "WakeflowTestCardPlanningPlan"
schemaVersion: 1
demandId: DemandId
expectedStreamRevision: number
commitId: CommitId
eventId: EventId
authority: DemandAuthority
testCard: TestCard
generationSource: GenerationSource
}
/**
 * Demand publication 时必须存在并永久冻结的 Ledger authority closure。
 */
export interface DemandAuthority {
artifactKind: "wakeflow-demand-authority"
schemaVersion: 1
demandId: string
identityDigest: Sha256Digest
/**
 * @minItems 1
 * @maxItems 32
 */
authorityRefs: [AuthorityMemberReference, ...(AuthorityMemberReference)[]]
testingDecision: TestingDecision
}
export interface TestingDecision {
mode: ("controller-only" | "real-environment" | "not-applicable")
summary: string
environmentMemberRef: (null | PortableResourcePath)
}
/**
 * Controller在产品功能接受后冻结的真实环境Test执行合同。
 */
export interface TestCard {
artifactKind: "wakeflow-test-card"
schemaVersion: 1
testCardId: string
targetTaskId: string
programId: string
demandId: string
demandAuthorityDigest: Sha256Digest
testWindowId: string
environmentAuthority: AuthorityMemberReference
/**
 * @minItems 1
 * @maxItems 32
 */
testBasisAuthorities: [AuthorityMemberReference, ...(AuthorityMemberReference)[]]
source: Source
requirementGoal: string
/**
 * @minItems 1
 * @maxItems 32
 */
implementationBaselines: [ImplementationBaseline, ...(ImplementationBaseline)[]]
approvedPlan: NonEmptyTextList
allowedSkills: AllowedSkills
setupPolicy: ("fresh-once" | "fresh-per-attempt" | "reuse-existing")
maxAttempts: number
changeControl: "return-blocked-to-controller"
productSourcePolicy: "read-only"
question: string
objectBoundary: string
controllerSelfChecks: NonEmptyTextList
realScenarioConditions: NonEmptyTextList
successMeans: NonEmptyTextList
failureMeans: NonEmptyTextList
cannotConclude: NonEmptyTextList
stopConditions: NonEmptyTextList
evidenceRequired: NonEmptyTextList
allowedOperations: NonEmptyTextList
forbiddenOperations: NonEmptyTextList
createdAt: UtcInstant
testCardDigest: Sha256Digest
}
export interface Source {
postAcceptanceRouteDigest: Sha256Digest
reviewSnapshotDigest: Sha256Digest
streamRevision: number
stateDigest: Sha256Digest
lastEventId: string
lastEventDigest: Sha256Digest
}
export interface ImplementationBaseline {
targetTaskId: string
taskPackageId: string
taskPackageDigest: Sha256Digest
repositoryId: string
windowId: string
targetResultId: string
resultDigest: Sha256Digest
targetReviewDecisionId: string
decisionDigest: Sha256Digest
}
export interface Initial {
kind: "initial"
}
export interface ProductDefectRetest {
kind: "product-defect-retest"
previousTestCard: TestCard1
testReviewDecision: TestReviewDecision
productDefectRemediation: ProductDefectRemediation
}
export interface TestCard1 {
testCardId: string
testCardDigest: Sha256Digest
}
export interface TestReviewDecision {
targetReviewDecisionId: string
decisionDigest: Sha256Digest
}
export interface ProductDefectRemediation {
productDefectRemediationId: string
authorizationDigest: Sha256Digest
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
export const WAKEFLOW_TEST_CARD_PLANNING_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:test-card-planning-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TEST_CARD_PLANNING_REQUEST_SCHEMA\",\"title\":\"WakeflowTestCardPlanningRequestV1\",\"description\":\"Closed MCP preview/apply request for one Controller-authored real-environment TestCard plan.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/previewRequest\"},{\"$ref\":\"#/$defs/applyRequest\"}],\"$defs\":{\"previewRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"demandId\",\"testCard\"],\"properties\":{\"root\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"mode\":{\"const\":\"preview\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"testCard\":{\"$ref\":\"#/$defs/authoredContent\"}}},\"applyRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"plan\",\"planDigest\"],\"properties\":{\"root\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"mode\":{\"const\":\"apply\"},\"plan\":{\"$ref\":\"#/$defs/plan\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"authoredContent\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"allowedOperations\",\"allowedSkills\",\"approvedPlan\",\"cannotConclude\",\"controllerSelfChecks\",\"evidenceRequired\",\"failureMeans\",\"forbiddenOperations\",\"maxAttempts\",\"objectBoundary\",\"question\",\"realScenarioConditions\",\"setupPolicy\",\"stopConditions\",\"successMeans\"],\"properties\":{\"allowedOperations\":{\"$ref\":\"#/$defs/testCard/properties/allowedOperations\"},\"allowedSkills\":{\"$ref\":\"#/$defs/testCard/properties/allowedSkills\"},\"approvedPlan\":{\"$ref\":\"#/$defs/testCard/properties/approvedPlan\"},\"cannotConclude\":{\"$ref\":\"#/$defs/testCard/properties/cannotConclude\"},\"controllerSelfChecks\":{\"$ref\":\"#/$defs/testCard/properties/controllerSelfChecks\"},\"evidenceRequired\":{\"$ref\":\"#/$defs/testCard/properties/evidenceRequired\"},\"failureMeans\":{\"$ref\":\"#/$defs/testCard/properties/failureMeans\"},\"forbiddenOperations\":{\"$ref\":\"#/$defs/testCard/properties/forbiddenOperations\"},\"maxAttempts\":{\"$ref\":\"#/$defs/testCard/properties/maxAttempts\"},\"objectBoundary\":{\"$ref\":\"#/$defs/testCard/properties/objectBoundary\"},\"question\":{\"$ref\":\"#/$defs/testCard/properties/question\"},\"realScenarioConditions\":{\"$ref\":\"#/$defs/testCard/properties/realScenarioConditions\"},\"setupPolicy\":{\"$ref\":\"#/$defs/testCard/properties/setupPolicy\"},\"stopConditions\":{\"$ref\":\"#/$defs/testCard/properties/stopConditions\"},\"successMeans\":{\"$ref\":\"#/$defs/testCard/properties/successMeans\"}}},\"plan\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"demandId\",\"expectedStreamRevision\",\"commitId\",\"eventId\",\"authority\",\"testCard\",\"generationSource\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTestCardPlanningPlan\"},\"schemaVersion\":{\"const\":1},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"expectedStreamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"commitId\":{\"$ref\":\"#/$defs/commitId\"},\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"authority\":{\"$ref\":\"#/$defs/demandAuthority\"},\"testCard\":{\"$ref\":\"#/$defs/testCard\"},\"generationSource\":{\"$ref\":\"#/$defs/generationSource\"}}},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"pattern\":\"^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\\\.{1,2}(?:/|$))(?!.*\\\\/\\\\.{1,2}(?:/|$))(?!.*\\\\\\\\)(?!.*//)(?!.*\\\\/$)(?!\\\\s)(?!.*\\\\s$)(?!.*\\\\/\\\\s)(?!.*\\\\s\\\\/)(?!.*[\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]).+$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"authorityMemberReference\":{\"description\":\"跨领域只读消费一份已验证 Ledger authority member 的完整 ref/digest 关系。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"family\",\"recordId\",\"recordRef\",\"recordDigest\",\"memberPath\",\"memberRef\",\"memberDigest\",\"role\",\"mediaType\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-ledger-authority-member-reference\"},\"schemaVersion\":{\"const\":1},\"family\":{\"enum\":[\"requirement\",\"confirmation\"]},\"recordId\":{\"oneOf\":[{\"type\":\"string\",\"pattern\":\"^requirement_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},{\"type\":\"string\",\"pattern\":\"^confirmation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}]},\"recordRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"recordDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"memberPath\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"memberRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"memberDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"role\":{\"enum\":[\"original-plan\",\"requirement-design\",\"code-facts\",\"landing-plan\",\"non-goals\",\"user-confirmation\",\"reproduction\",\"scope\",\"requirement-delta\",\"research-question\",\"boundaries\",\"test-environment\",\"supporting-evidence\",\"goal-stage-decision\"]},\"mediaType\":{\"type\":\"string\",\"pattern\":\"^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$\"}},\"allOf\":[{\"if\":{\"properties\":{\"family\":{\"const\":\"requirement\"}},\"required\":[\"family\"]},\"then\":{\"properties\":{\"recordId\":{\"type\":\"string\",\"pattern\":\"^requirement_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"role\":{\"enum\":[\"original-plan\",\"requirement-design\",\"code-facts\",\"landing-plan\",\"non-goals\",\"user-confirmation\",\"reproduction\",\"scope\",\"requirement-delta\",\"research-question\",\"boundaries\",\"test-environment\",\"supporting-evidence\"]}}}},{\"if\":{\"properties\":{\"family\":{\"const\":\"confirmation\"}},\"required\":[\"family\"]},\"then\":{\"properties\":{\"recordId\":{\"type\":\"string\",\"pattern\":\"^confirmation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"role\":{\"enum\":[\"goal-stage-decision\",\"user-confirmation\",\"requirement-delta\",\"supporting-evidence\"]}}}}]},\"demandAuthority\":{\"description\":\"Demand publication 时必须存在并永久冻结的 Ledger authority closure。\",\"$comment\":\"Demand type role completeness、identity digest、Ledger resolution、same-demand confirmation、placement 和 testing relations 由 Demand authority codec 继续校验。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"demandId\",\"identityDigest\",\"authorityRefs\",\"testingDecision\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-demand-authority\"},\"schemaVersion\":{\"const\":1},\"demandId\":{\"$ref\":\"#/$defs/demandAuthority/$defs/demandId\"},\"identityDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"authorityRefs\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/authorityMemberReference\"}},\"testingDecision\":{\"$ref\":\"#/$defs/demandAuthority/$defs/testingDecision\"}},\"$defs\":{\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"nonEmptyText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"testingDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"mode\",\"summary\",\"environmentMemberRef\"],\"properties\":{\"mode\":{\"enum\":[\"controller-only\",\"real-environment\",\"not-applicable\"]},\"summary\":{\"$ref\":\"#/$defs/demandAuthority/$defs/nonEmptyText\"},\"environmentMemberRef\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/portableResourcePath\"}]}}}}},\"testCard\":{\"description\":\"Controller在产品功能接受后冻结的真实环境Test执行合同。\",\"$comment\":\"TestCard绑定real-environment Authority、非空且有序的Test Basis Authority来源、当前accepted implementation baselines与明确边界；它不创建Test TaskPackage、不执行环境操作，也不把Test结果升级为Controller acceptance。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"testCardId\",\"targetTaskId\",\"programId\",\"demandId\",\"demandAuthorityDigest\",\"testWindowId\",\"environmentAuthority\",\"testBasisAuthorities\",\"source\",\"requirementGoal\",\"implementationBaselines\",\"approvedPlan\",\"allowedSkills\",\"setupPolicy\",\"maxAttempts\",\"changeControl\",\"productSourcePolicy\",\"question\",\"objectBoundary\",\"controllerSelfChecks\",\"realScenarioConditions\",\"successMeans\",\"failureMeans\",\"cannotConclude\",\"stopConditions\",\"evidenceRequired\",\"allowedOperations\",\"forbiddenOperations\",\"createdAt\",\"testCardDigest\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-test-card\"},\"schemaVersion\":{\"const\":1},\"testCardId\":{\"$ref\":\"#/$defs/testCard/$defs/testCardId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/testCard/$defs/targetTaskId\"},\"programId\":{\"$ref\":\"#/$defs/testCard/$defs/programId\"},\"demandId\":{\"$ref\":\"#/$defs/testCard/$defs/demandId\"},\"demandAuthorityDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"testWindowId\":{\"$ref\":\"#/$defs/testCard/$defs/windowId\"},\"environmentAuthority\":{\"$ref\":\"#/$defs/authorityMemberReference\"},\"testBasisAuthorities\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/authorityMemberReference\"}},\"source\":{\"$ref\":\"#/$defs/testCard/$defs/source\"},\"requirementGoal\":{\"$ref\":\"#/$defs/testCard/$defs/humanText\"},\"implementationBaselines\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/testCard/$defs/implementationBaseline\"}},\"approvedPlan\":{\"$ref\":\"#/$defs/testCard/$defs/nonEmptyTextList\"},\"allowedSkills\":{\"type\":\"array\",\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/testCard/$defs/token\"}},\"setupPolicy\":{\"enum\":[\"fresh-once\",\"fresh-per-attempt\",\"reuse-existing\"]},\"maxAttempts\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":10},\"changeControl\":{\"const\":\"return-blocked-to-controller\"},\"productSourcePolicy\":{\"const\":\"read-only\"},\"question\":{\"$ref\":\"#/$defs/testCard/$defs/humanText\"},\"objectBoundary\":{\"$ref\":\"#/$defs/testCard/$defs/humanText\"},\"controllerSelfChecks\":{\"$ref\":\"#/$defs/testCard/$defs/nonEmptyTextList\"},\"realScenarioConditions\":{\"$ref\":\"#/$defs/testCard/$defs/nonEmptyTextList\"},\"successMeans\":{\"$ref\":\"#/$defs/testCard/$defs/nonEmptyTextList\"},\"failureMeans\":{\"$ref\":\"#/$defs/testCard/$defs/nonEmptyTextList\"},\"cannotConclude\":{\"$ref\":\"#/$defs/testCard/$defs/nonEmptyTextList\"},\"stopConditions\":{\"$ref\":\"#/$defs/testCard/$defs/nonEmptyTextList\"},\"evidenceRequired\":{\"$ref\":\"#/$defs/testCard/$defs/nonEmptyTextList\"},\"allowedOperations\":{\"$ref\":\"#/$defs/testCard/$defs/nonEmptyTextList\"},\"forbiddenOperations\":{\"$ref\":\"#/$defs/testCard/$defs/nonEmptyTextList\"},\"createdAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"testCardDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}},\"$defs\":{\"testCardId\":{\"type\":\"string\",\"pattern\":\"^test-card_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"token\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$\"},\"humanText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"nonEmptyTextList\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/testCard/$defs/humanText\"}},\"source\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"postAcceptanceRouteDigest\",\"reviewSnapshotDigest\",\"streamRevision\",\"stateDigest\",\"lastEventId\",\"lastEventDigest\"],\"properties\":{\"postAcceptanceRouteDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"reviewSnapshotDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"lastEventId\":{\"$ref\":\"#/$defs/testCard/$defs/eventId\"},\"lastEventDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"implementationBaseline\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetTaskId\",\"taskPackageId\",\"taskPackageDigest\",\"repositoryId\",\"windowId\",\"targetResultId\",\"resultDigest\",\"targetReviewDecisionId\",\"decisionDigest\"],\"properties\":{\"targetTaskId\":{\"$ref\":\"#/$defs/testCard/$defs/targetTaskId\"},\"taskPackageId\":{\"type\":\"string\",\"pattern\":\"^task-package_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"taskPackageDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"$ref\":\"#/$defs/testCard/$defs/windowId\"},\"targetResultId\":{\"type\":\"string\",\"pattern\":\"^target-result_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"resultDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"targetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"decisionDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}}}},\"generationSource\":{\"description\":\"TestCard创建Event记录的代际原因；不进入TestCard执行合同。\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/generationSource/$defs/initial\"},{\"$ref\":\"#/$defs/generationSource/$defs/productDefectRetest\"}],\"$defs\":{\"initial\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\"],\"properties\":{\"kind\":{\"const\":\"initial\"}}},\"productDefectRetest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"previousTestCard\",\"testReviewDecision\",\"productDefectRemediation\"],\"properties\":{\"kind\":{\"const\":\"product-defect-retest\"},\"previousTestCard\":{\"$ref\":\"#/$defs/generationSource/$defs/testCard\"},\"testReviewDecision\":{\"$ref\":\"#/$defs/generationSource/$defs/testReviewDecision\"},\"productDefectRemediation\":{\"$ref\":\"#/$defs/generationSource/$defs/productDefectRemediation\"}}},\"testCard\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"testCardId\",\"testCardDigest\"],\"properties\":{\"testCardId\":{\"type\":\"string\",\"pattern\":\"^test-card_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"testCardDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"testReviewDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetReviewDecisionId\",\"decisionDigest\"],\"properties\":{\"targetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"decisionDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"productDefectRemediation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"productDefectRemediationId\",\"authorizationDigest\"],\"properties\":{\"productDefectRemediationId\":{\"type\":\"string\",\"pattern\":\"^product-defect-remediation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"authorizationDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}}}}}}");
