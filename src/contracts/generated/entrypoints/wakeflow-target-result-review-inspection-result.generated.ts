/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-target-result-review-inspection-result.schema.json
 */

export type DemandId = string
export type Sha256Digest = string
export type EventId = string
export type ReviewUnit = (ReportedReviewUnit | BlockedReviewUnit)
export type ReportedReviewUnit = ({
[k: string]: unknown | undefined
} & {
status: "reported"
workType: ("implementation" | "test")
targetTaskId: TargetTaskId
outcome: ResultOutcome
taskPackageSourceEvent: SourceEvent
taskPackage: ReviewTaskPackage
targetResultSourceEvent: SourceEvent
targetResult: TargetResult
/**
 * @maxItems 10000
 */
priorReviewHistory: ReviewHistoryEntry[]
reviewUnitDigest: Sha256Digest
})
export type TargetTaskId = string
export type ResultOutcome = ("completed" | "blocked" | "needs-review")
export type ReviewTaskPackage = ({
[k: string]: unknown | undefined
} & {
artifactKind: "wakeflow-task-package"
schemaVersion: 1
programId: ReviewTaskPackageProgramId
configDigest: Sha256Digest
demandId: ReviewTaskPackageDemandId
demandAuthorityDigest: Sha256Digest
taskPackageId: ReviewTaskPackageTaskPackageId
targetTaskId: ReviewTaskPackageTargetTaskId
createdAt: UtcInstant
assignment: ReviewTaskPackageAssignment
workType: ("implementation" | "test")
objective: ReviewTaskPackageHumanText
confirmedContext: ReviewTaskPackageNonEmptyTextList
/**
 * @minItems 1
 * @maxItems 32
 */
selectedAuthorityRefs: [AuthorityMemberReference, ...(AuthorityMemberReference)[]]
boundaries: ReviewTaskPackageBoundaries
completionExpectations: ReviewTaskPackageNonEmptyTextList
commitExpectation?: ("commit" | "leave-uncommitted")
/**
 * @maxItems 32
 */
acceptanceAnchors: ReviewTaskPackageAcceptanceAnchor[]
testCard?: ReviewTaskPackageTestCardTuple
})
export type ReviewTaskPackageProgramId = string
export type ReviewTaskPackageDemandId = string
export type ReviewTaskPackageTaskPackageId = string
export type ReviewTaskPackageTargetTaskId = string
export type UtcInstant = string
export type ReviewTaskPackageAssignment = (ReviewTaskPackageImplementationAssignment | ReviewTaskPackageTestAssignment)
export type ReviewTaskPackageRepositoryId = string
export type ReviewTaskPackageWindowId = string
export type ReviewTaskPackageHumanText = string
/**
 * @minItems 1
 * @maxItems 32
 */
export type ReviewTaskPackageNonEmptyTextList = [ReviewTaskPackageHumanText, ...(ReviewTaskPackageHumanText)[]]
export type PortableResourcePath = string
/**
 * @maxItems 32
 */
export type ReviewTaskPackageTextList = ReviewTaskPackageHumanText[]
export type ReviewTaskPackageAnchorId = string
export type ReviewTaskPackageTestCardId = string
export type TargetResult = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowTargetResult"
schemaVersion: 1
workType: ("implementation" | "test")
targetResultId: TargetResultId
programId: ProgramId
demandId: DemandId
targetTaskId: TargetTaskId
targetDeliveryId: TargetDeliveryId
taskPackage: TaskPackage
assignment: (ImplementationAssignment | TestAssignment)
hostEffect: HostEffect
report: (ImplementationReport | TestReport)
testExecution?: TestExecution
resultDigest: Sha256Digest
})
export type TargetResultId = string
export type ProgramId = string
export type TargetDeliveryId = string
export type TaskPackageId = string
export type RepositoryId = string
export type WindowId = string
export type ClaimId = string
export type CommitId = string
export type HumanText = string
export type RepositoryChange = ({
[k: string]: unknown | undefined
} & {
repositoryId: RepositoryId
disposition: ("committed" | "left-uncommitted" | "no-changes")
/**
 * @maxItems 64
 */
commits: GitObjectId[]
})
export type GitObjectId = (GitSha1ObjectId | GitSha256ObjectId)
export type Token = string
/**
 * @maxItems 64
 */
export type EvidenceLocators = EvidenceLocator[]
/**
 * @maxItems 64
 */
export type HumanTextList = HumanText[]
export type TestReport = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowTestTargetResultReport"
schemaVersion: 1
outcome: ResultOutcome
summary: HumanText
evidenceLocators: EvidenceLocators
verification: HumanTextList
risks: HumanTextList
/**
 * @maxItems 32
 */
stepEvidence: StepEvidence[]
reportedAt: UtcInstant
reportDigest: Sha256Digest
})
export type TestAttemptId = string
export type TestCardId = string
export type ReviewHistoryEntry = ({
kind: "decision"
sourceEvent: SourceEvent
decision: ReviewDecisionSummary
} | {
kind: "resume"
sourceEvent: SourceEvent
resume: ReviewResumeSummary
})
export type ReviewDecisionSummary = (ImplementationReviewDecisionSummary | TestReviewDecisionSummary)
export type TargetReviewDecisionId = string
export type TargetReviewResumeId = string
export type BlockedReviewUnit = ({
[k: string]: unknown | undefined
} & {
status: "review-blocked"
workType: ("implementation" | "test")
targetTaskId: TargetTaskId
outcome: ResultOutcome
taskPackageSourceEvent: SourceEvent
taskPackage: ReviewTaskPackage
targetResultSourceEvent: SourceEvent
targetResult: TargetResult
/**
 * @maxItems 10000
 */
priorReviewHistory: ReviewHistoryEntry[]
reviewUnitDigest: Sha256Digest
currentBlockedDecision: CurrentBlockedDecision
})

/**
 * Current read-only review context for one exact reported or review-blocked implementation or test TargetResult.
 */
export interface WakeflowTargetResultReviewInspectionResultV1 {
kind: "WakeflowTargetResultReviewInspectionResult"
schemaVersion: 1
tool: "wakeflow_inspect_target_result_review"
status: "current"
demand: {
demandId: DemandId
lifecycle: "active"
}
eventStream: EventStream
snapshotDigest: Sha256Digest
reviewUnit: ReviewUnit
}
export interface EventStream {
commitSequence: number
streamRevision: number
lastCommitDigest: Sha256Digest
lastEventId: EventId
lastEventDigest: Sha256Digest
stateDigest: Sha256Digest
}
export interface SourceEvent {
eventId: EventId
eventDigest: Sha256Digest
streamRevision: number
}
export interface ReviewTaskPackageImplementationAssignment {
repositoryId: ReviewTaskPackageRepositoryId
windowId: ReviewTaskPackageWindowId
}
export interface ReviewTaskPackageTestAssignment {
windowId: ReviewTaskPackageWindowId
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
export interface ReviewTaskPackageBoundaries {
inScope: ReviewTaskPackageNonEmptyTextList
outOfScope: ReviewTaskPackageTextList
forbidden: ReviewTaskPackageTextList
}
export interface ReviewTaskPackageAcceptanceAnchor {
anchorId: ReviewTaskPackageAnchorId
claim: ReviewTaskPackageHumanText
probe: ReviewTaskPackageHumanText
expected: ReviewTaskPackageHumanText
}
export interface ReviewTaskPackageTestCardTuple {
testCardId: ReviewTaskPackageTestCardId
testCardDigest: Sha256Digest
}
export interface TaskPackage {
taskPackageId: TaskPackageId
ref: PortableResourcePath
digest: Sha256Digest
}
export interface ImplementationAssignment {
repositoryId: RepositoryId
windowId: WindowId
}
export interface TestAssignment {
windowId: WindowId
}
export interface HostEffect {
actionId: ClaimId
claimDigest: Sha256Digest
claimEventId: EventId
claimCommitId: CommitId
observationDigest: Sha256Digest
disposition: ("accepted" | "indeterminate")
readbackStatus: ("confirmed" | "pending" | "unavailable")
observedEventId: EventId
observedAt: UtcInstant
}
export interface ImplementationReport {
kind: "WakeflowImplementationTargetResultReport"
schemaVersion: 1
outcome: ResultOutcome
summary: HumanText
repositoryChange: RepositoryChange
evidenceLocators: EvidenceLocators
verification: HumanTextList
risks: HumanTextList
/**
 * @maxItems 32
 */
anchorEvidence: AnchorEvidence[]
reportedAt: UtcInstant
reportDigest: Sha256Digest
}
export interface GitSha1ObjectId {
algorithm: "sha1"
value: string
}
export interface GitSha256ObjectId {
algorithm: "sha256"
value: string
}
export interface EvidenceLocator {
kind: Token
ref: PortableResourcePath
digest: Sha256Digest
}
export interface AnchorEvidence {
anchorId: Token
/**
 * @minItems 1
 * @maxItems 32
 */
evidenceRefs: [EvidenceRef, ...(EvidenceRef)[]]
}
export interface EvidenceRef {
ref: PortableResourcePath
digest: Sha256Digest
}
export interface StepEvidence {
planIndex: number
step: HumanText
evidence: EvidenceRef
}
export interface TestExecution {
testAttemptId: TestAttemptId
testCard: {
testCardId: TestCardId
testCardDigest: Sha256Digest
}
testDispatchPacketDigest: Sha256Digest
}
export interface ImplementationReviewDecisionSummary {
workType: "implementation"
targetReviewDecisionId: TargetReviewDecisionId
decisionDigest: Sha256Digest
decision: ("accept" | "blocked" | "redesign" | "rework")
assessment: ImplementationAssessment
/**
 * @minItems 1
 * @maxItems 32
 */
independentChecks: [IndependentCheck, ...(IndependentCheck)[]]
rationale: HumanText
blockingReasons: HumanTextList
residualRisks: HumanTextList
decidedAt: UtcInstant
}
export interface ImplementationAssessment {
requirementAlignment: ("aligned" | "mismatch" | "unresolved")
implementationQuality: ("satisfactory" | "defective" | "unverified")
}
export interface IndependentCheck {
checkId: Token
method: HumanText
outcome: ("passed" | "failed" | "inconclusive")
observation: HumanText
}
export interface TestReviewDecisionSummary {
workType: "test"
targetReviewDecisionId: TargetReviewDecisionId
decisionDigest: Sha256Digest
decision: ("accept" | "blocked" | "escalate-product-defect" | "request-another-attempt")
assessment: TestAssessment
/**
 * @minItems 1
 * @maxItems 32
 */
independentChecks: [IndependentCheck, ...(IndependentCheck)[]]
rationale: HumanText
blockingReasons: HumanTextList
residualRisks: HumanTextList
decidedAt: UtcInstant
}
export interface TestAssessment {
conclusion: ("satisfied" | "defect-observed" | "inconclusive")
evidenceSufficiency: ("sufficient" | "insufficient")
}
export interface ReviewResumeSummary {
targetReviewResumeId: TargetReviewResumeId
resumeDigest: Sha256Digest
blockedDecision: {
targetReviewDecisionId: TargetReviewDecisionId
decisionDigest: Sha256Digest
targetResultId: TargetResultId
targetResultDigest: Sha256Digest
}
blockedSource: {
snapshotDigest: Sha256Digest
stateDigest: Sha256Digest
streamRevision: number
}
resolutionSummary: HumanText
resumedAt: UtcInstant
}
export interface CurrentBlockedDecision {
sourceEvent: SourceEvent
decision: ReviewDecisionSummary
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
export const WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:target-result-review-inspection-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_RESULT_SCHEMA\",\"title\":\"WakeflowTargetResultReviewInspectionResultV1\",\"description\":\"Current read-only review context for one exact reported or review-blocked implementation or test TargetResult.\",\"$comment\":\"The result is review input only. A review-blocked unit exposes the current blocked Decision for recovery judgment, but does not decide that its blocker is resolved, create Resume, derive allowed decisions, or create Controller acceptance.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"status\",\"demand\",\"eventStream\",\"snapshotDigest\",\"reviewUnit\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTargetResultReviewInspectionResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_inspect_target_result_review\"},\"status\":{\"const\":\"current\"},\"demand\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"demandId\",\"lifecycle\"],\"properties\":{\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"lifecycle\":{\"const\":\"active\"}}},\"eventStream\":{\"$ref\":\"#/$defs/eventStream\"},\"snapshotDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"reviewUnit\":{\"$ref\":\"#/$defs/reviewUnit\"}},\"$defs\":{\"targetResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"workType\",\"targetResultId\",\"programId\",\"demandId\",\"targetTaskId\",\"targetDeliveryId\",\"taskPackage\",\"assignment\",\"hostEffect\",\"report\",\"resultDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTargetResult\"},\"schemaVersion\":{\"const\":1},\"workType\":{\"enum\":[\"implementation\",\"test\"]},\"targetResultId\":{\"$ref\":\"#/$defs/targetResultId\"},\"programId\":{\"$ref\":\"#/$defs/programId\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"targetDeliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"},\"taskPackage\":{\"$ref\":\"#/$defs/taskPackage\"},\"assignment\":{\"oneOf\":[{\"$ref\":\"#/$defs/implementationAssignment\"},{\"$ref\":\"#/$defs/testAssignment\"}]},\"hostEffect\":{\"$ref\":\"#/$defs/hostEffect\"},\"report\":{\"oneOf\":[{\"$ref\":\"#/$defs/implementationReport\"},{\"$ref\":\"#/$defs/testReport\"}]},\"testExecution\":{\"$ref\":\"#/$defs/testExecution\"},\"resultDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}},\"allOf\":[{\"if\":{\"properties\":{\"workType\":{\"const\":\"test\"}},\"required\":[\"workType\"]},\"then\":{\"required\":[\"testExecution\"],\"properties\":{\"assignment\":{\"$ref\":\"#/$defs/testAssignment\"},\"report\":{\"$ref\":\"#/$defs/testReport\"},\"testExecution\":{\"$ref\":\"#/$defs/testExecution\"}}},\"else\":{\"properties\":{\"assignment\":{\"$ref\":\"#/$defs/implementationAssignment\"},\"report\":{\"$ref\":\"#/$defs/implementationReport\"},\"testExecution\":false}}}]},\"taskPackage\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"taskPackageId\",\"ref\",\"digest\"],\"properties\":{\"taskPackageId\":{\"$ref\":\"#/$defs/taskPackageId\"},\"ref\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"digest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"implementationAssignment\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"repositoryId\",\"windowId\"],\"properties\":{\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"}}},\"testAssignment\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"windowId\"],\"properties\":{\"windowId\":{\"$ref\":\"#/$defs/windowId\"}}},\"hostEffect\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"actionId\",\"claimDigest\",\"claimEventId\",\"claimCommitId\",\"observationDigest\",\"disposition\",\"readbackStatus\",\"observedEventId\",\"observedAt\"],\"properties\":{\"actionId\":{\"$ref\":\"#/$defs/claimId\"},\"claimDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"claimEventId\":{\"$ref\":\"#/$defs/eventId\"},\"claimCommitId\":{\"$ref\":\"#/$defs/commitId\"},\"observationDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"disposition\":{\"enum\":[\"accepted\",\"indeterminate\"]},\"readbackStatus\":{\"enum\":[\"confirmed\",\"pending\",\"unavailable\"]},\"observedEventId\":{\"$ref\":\"#/$defs/eventId\"},\"observedAt\":{\"$ref\":\"#/$defs/utcInstant\"}}},\"testExecution\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"testAttemptId\",\"testCard\",\"testDispatchPacketDigest\"],\"properties\":{\"testAttemptId\":{\"$ref\":\"#/$defs/testAttemptId\"},\"testCard\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"testCardId\",\"testCardDigest\"],\"properties\":{\"testCardId\":{\"$ref\":\"#/$defs/testCardId\"},\"testCardDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"testDispatchPacketDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"implementationReport\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"outcome\",\"summary\",\"repositoryChange\",\"evidenceLocators\",\"verification\",\"risks\",\"anchorEvidence\",\"reportedAt\",\"reportDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowImplementationTargetResultReport\"},\"schemaVersion\":{\"const\":1},\"outcome\":{\"$ref\":\"#/$defs/resultOutcome\"},\"summary\":{\"$ref\":\"#/$defs/humanText\"},\"repositoryChange\":{\"$ref\":\"#/$defs/repositoryChange\"},\"evidenceLocators\":{\"$ref\":\"#/$defs/evidenceLocators\"},\"verification\":{\"$ref\":\"#/$defs/humanTextList\"},\"risks\":{\"$ref\":\"#/$defs/humanTextList\"},\"anchorEvidence\":{\"type\":\"array\",\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/anchorEvidence\"}},\"reportedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"reportDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"testReport\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"outcome\",\"summary\",\"evidenceLocators\",\"verification\",\"risks\",\"stepEvidence\",\"reportedAt\",\"reportDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTestTargetResultReport\"},\"schemaVersion\":{\"const\":1},\"outcome\":{\"$ref\":\"#/$defs/resultOutcome\"},\"summary\":{\"$ref\":\"#/$defs/humanText\"},\"evidenceLocators\":{\"$ref\":\"#/$defs/evidenceLocators\"},\"verification\":{\"$ref\":\"#/$defs/humanTextList\"},\"risks\":{\"$ref\":\"#/$defs/humanTextList\"},\"stepEvidence\":{\"type\":\"array\",\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/stepEvidence\"}},\"reportedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"reportDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}},\"allOf\":[{\"if\":{\"properties\":{\"outcome\":{\"const\":\"completed\"}},\"required\":[\"outcome\"]},\"then\":{\"properties\":{\"stepEvidence\":{\"type\":\"array\",\"minItems\":1}}}}]},\"repositoryChange\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"repositoryId\",\"disposition\",\"commits\"],\"properties\":{\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"disposition\":{\"enum\":[\"committed\",\"left-uncommitted\",\"no-changes\"]},\"commits\":{\"type\":\"array\",\"maxItems\":64,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/gitObjectId\"}}},\"allOf\":[{\"if\":{\"properties\":{\"disposition\":{\"const\":\"committed\"}},\"required\":[\"disposition\"]},\"then\":{\"properties\":{\"commits\":{\"type\":\"array\",\"minItems\":1}}},\"else\":{\"properties\":{\"commits\":{\"type\":\"array\",\"maxItems\":0}}}}]},\"evidenceLocators\":{\"type\":\"array\",\"maxItems\":64,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/evidenceLocator\"}},\"evidenceLocator\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"ref\",\"digest\"],\"properties\":{\"kind\":{\"$ref\":\"#/$defs/token\"},\"ref\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"digest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"evidenceRef\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"ref\",\"digest\"],\"properties\":{\"ref\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"digest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"anchorEvidence\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"anchorId\",\"evidenceRefs\"],\"properties\":{\"anchorId\":{\"$ref\":\"#/$defs/token\"},\"evidenceRefs\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/evidenceRef\"}}}},\"stepEvidence\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"planIndex\",\"step\",\"evidence\"],\"properties\":{\"planIndex\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":31},\"step\":{\"$ref\":\"#/$defs/humanText\"},\"evidence\":{\"$ref\":\"#/$defs/evidenceRef\"}}},\"humanTextList\":{\"type\":\"array\",\"maxItems\":64,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/humanText\"}},\"eventReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"eventId\",\"streamRevision\"],\"properties\":{\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991}}},\"commitReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"commitId\",\"commitSequence\",\"commitDigest\"],\"properties\":{\"commitId\":{\"$ref\":\"#/$defs/commitId\"},\"commitSequence\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"commitDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"resultOutcome\":{\"enum\":[\"completed\",\"blocked\",\"needs-review\"]},\"humanText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"token\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"pattern\":\"^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\\\.{1,2}(?:/|$))(?!.*\\\\/\\\\.{1,2}(?:/|$))(?!.*\\\\\\\\)(?!.*//)(?!.*\\\\/$)(?!\\\\s)(?!.*\\\\s$)(?!.*\\\\/\\\\s)(?!.*\\\\s\\\\/)(?!.*[\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]).+$\"},\"gitObjectId\":{\"oneOf\":[{\"$ref\":\"#/$defs/gitSha1ObjectId\"},{\"$ref\":\"#/$defs/gitSha256ObjectId\"}]},\"gitSha1ObjectId\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"algorithm\",\"value\"],\"properties\":{\"algorithm\":{\"const\":\"sha1\"},\"value\":{\"type\":\"string\",\"pattern\":\"^[0-9a-f]{40}$\"}}},\"gitSha256ObjectId\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"algorithm\",\"value\"],\"properties\":{\"algorithm\":{\"const\":\"sha256\"},\"value\":{\"type\":\"string\",\"pattern\":\"^[0-9a-f]{64}$\"}}},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetDeliveryId\":{\"type\":\"string\",\"pattern\":\"^target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetResultId\":{\"type\":\"string\",\"pattern\":\"^target-result_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"taskPackageId\":{\"type\":\"string\",\"pattern\":\"^task-package_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"testAttemptId\":{\"type\":\"string\",\"pattern\":\"^test-attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"testCardId\":{\"type\":\"string\",\"pattern\":\"^test-card_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"claimId\":{\"type\":\"string\",\"pattern\":\"^window_work_claim_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"reviewTaskPackageProgramId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"reviewTaskPackageDemandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"reviewTaskPackageTaskPackageId\":{\"type\":\"string\",\"pattern\":\"^task-package_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"reviewTaskPackageTargetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"reviewTaskPackageTestCardId\":{\"type\":\"string\",\"pattern\":\"^test-card_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"reviewTaskPackageRepositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"reviewTaskPackageWindowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"reviewTaskPackageHumanText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":16384,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"reviewTaskPackageNonEmptyTextList\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/reviewTaskPackageHumanText\"}},\"reviewTaskPackageAssignment\":{\"oneOf\":[{\"$ref\":\"#/$defs/reviewTaskPackageImplementationAssignment\"},{\"$ref\":\"#/$defs/reviewTaskPackageTestAssignment\"}]},\"reviewTaskPackageImplementationAssignment\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"repositoryId\",\"windowId\"],\"properties\":{\"repositoryId\":{\"$ref\":\"#/$defs/reviewTaskPackageRepositoryId\"},\"windowId\":{\"$ref\":\"#/$defs/reviewTaskPackageWindowId\"}}},\"reviewTaskPackageTestAssignment\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"windowId\"],\"properties\":{\"windowId\":{\"$ref\":\"#/$defs/reviewTaskPackageWindowId\"}}},\"reviewTaskPackageBoundaries\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"inScope\",\"outOfScope\",\"forbidden\"],\"properties\":{\"inScope\":{\"$ref\":\"#/$defs/reviewTaskPackageNonEmptyTextList\"},\"outOfScope\":{\"$ref\":\"#/$defs/reviewTaskPackageTextList\"},\"forbidden\":{\"$ref\":\"#/$defs/reviewTaskPackageTextList\"}}},\"reviewTaskPackageTextList\":{\"type\":\"array\",\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/reviewTaskPackageHumanText\"}},\"reviewTaskPackageAnchorId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"reviewTaskPackageAcceptanceAnchor\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"anchorId\",\"claim\",\"probe\",\"expected\"],\"properties\":{\"anchorId\":{\"$ref\":\"#/$defs/reviewTaskPackageAnchorId\"},\"claim\":{\"$ref\":\"#/$defs/reviewTaskPackageHumanText\"},\"probe\":{\"$ref\":\"#/$defs/reviewTaskPackageHumanText\"},\"expected\":{\"$ref\":\"#/$defs/reviewTaskPackageHumanText\"}}},\"reviewTaskPackageTestCardTuple\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"testCardId\",\"testCardDigest\"],\"properties\":{\"testCardId\":{\"$ref\":\"#/$defs/reviewTaskPackageTestCardId\"},\"testCardDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"reviewTaskPackage\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"programId\",\"configDigest\",\"demandId\",\"demandAuthorityDigest\",\"taskPackageId\",\"targetTaskId\",\"createdAt\",\"assignment\",\"workType\",\"objective\",\"confirmedContext\",\"selectedAuthorityRefs\",\"boundaries\",\"completionExpectations\",\"acceptanceAnchors\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-task-package\"},\"schemaVersion\":{\"const\":1},\"programId\":{\"$ref\":\"#/$defs/reviewTaskPackageProgramId\"},\"configDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"demandId\":{\"$ref\":\"#/$defs/reviewTaskPackageDemandId\"},\"demandAuthorityDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"taskPackageId\":{\"$ref\":\"#/$defs/reviewTaskPackageTaskPackageId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/reviewTaskPackageTargetTaskId\"},\"createdAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"assignment\":{\"$ref\":\"#/$defs/reviewTaskPackageAssignment\"},\"workType\":{\"enum\":[\"implementation\",\"test\"]},\"objective\":{\"$ref\":\"#/$defs/reviewTaskPackageHumanText\"},\"confirmedContext\":{\"$ref\":\"#/$defs/reviewTaskPackageNonEmptyTextList\"},\"selectedAuthorityRefs\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/authorityMemberReference\"}},\"boundaries\":{\"$ref\":\"#/$defs/reviewTaskPackageBoundaries\"},\"completionExpectations\":{\"$ref\":\"#/$defs/reviewTaskPackageNonEmptyTextList\"},\"commitExpectation\":{\"enum\":[\"commit\",\"leave-uncommitted\"]},\"acceptanceAnchors\":{\"type\":\"array\",\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/reviewTaskPackageAcceptanceAnchor\"}},\"testCard\":{\"$ref\":\"#/$defs/reviewTaskPackageTestCardTuple\"}},\"allOf\":[{\"if\":{\"properties\":{\"workType\":{\"const\":\"implementation\"}},\"required\":[\"workType\"]},\"then\":{\"required\":[\"commitExpectation\"],\"properties\":{\"commitExpectation\":{\"enum\":[\"commit\",\"leave-uncommitted\"]},\"assignment\":{\"$ref\":\"#/$defs/reviewTaskPackageImplementationAssignment\"},\"acceptanceAnchors\":{\"type\":\"array\",\"minItems\":1},\"testCard\":false}},\"else\":{\"required\":[\"testCard\"],\"properties\":{\"testCard\":{\"$ref\":\"#/$defs/reviewTaskPackageTestCardTuple\"},\"assignment\":{\"$ref\":\"#/$defs/reviewTaskPackageTestAssignment\"},\"commitExpectation\":false,\"acceptanceAnchors\":{\"type\":\"array\",\"maxItems\":0}}}}]},\"authorityMemberReference\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"family\",\"recordId\",\"recordRef\",\"recordDigest\",\"memberPath\",\"memberRef\",\"memberDigest\",\"role\",\"mediaType\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-ledger-authority-member-reference\"},\"schemaVersion\":{\"const\":1},\"family\":{\"enum\":[\"requirement\",\"confirmation\"]},\"recordId\":{\"type\":\"string\",\"pattern\":\"^(?:requirement|confirmation)_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"recordRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"recordDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"memberPath\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"memberRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"memberDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"role\":{\"enum\":[\"original-plan\",\"requirement-design\",\"code-facts\",\"landing-plan\",\"non-goals\",\"user-confirmation\",\"reproduction\",\"scope\",\"requirement-delta\",\"research-question\",\"boundaries\",\"test-environment\",\"supporting-evidence\",\"goal-stage-decision\"]},\"mediaType\":{\"type\":\"string\",\"pattern\":\"^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$\"}}},\"sourceEvent\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"eventId\",\"eventDigest\",\"streamRevision\"],\"properties\":{\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"eventDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991}}},\"independentCheck\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"checkId\",\"method\",\"outcome\",\"observation\"],\"properties\":{\"checkId\":{\"$ref\":\"#/$defs/token\"},\"method\":{\"$ref\":\"#/$defs/humanText\"},\"outcome\":{\"enum\":[\"passed\",\"failed\",\"inconclusive\"]},\"observation\":{\"$ref\":\"#/$defs/humanText\"}}},\"implementationAssessment\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"requirementAlignment\",\"implementationQuality\"],\"properties\":{\"requirementAlignment\":{\"enum\":[\"aligned\",\"mismatch\",\"unresolved\"]},\"implementationQuality\":{\"enum\":[\"satisfactory\",\"defective\",\"unverified\"]}}},\"testAssessment\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"conclusion\",\"evidenceSufficiency\"],\"properties\":{\"conclusion\":{\"enum\":[\"satisfied\",\"defect-observed\",\"inconclusive\"]},\"evidenceSufficiency\":{\"enum\":[\"sufficient\",\"insufficient\"]}}},\"reviewDecisionSummary\":{\"oneOf\":[{\"$ref\":\"#/$defs/implementationReviewDecisionSummary\"},{\"$ref\":\"#/$defs/testReviewDecisionSummary\"}]},\"implementationReviewDecisionSummary\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"workType\",\"targetReviewDecisionId\",\"decisionDigest\",\"decision\",\"assessment\",\"independentChecks\",\"rationale\",\"blockingReasons\",\"residualRisks\",\"decidedAt\"],\"properties\":{\"workType\":{\"const\":\"implementation\"},\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"decisionDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"decision\":{\"enum\":[\"accept\",\"blocked\",\"redesign\",\"rework\"]},\"assessment\":{\"$ref\":\"#/$defs/implementationAssessment\"},\"independentChecks\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/independentCheck\"}},\"rationale\":{\"$ref\":\"#/$defs/humanText\"},\"blockingReasons\":{\"$ref\":\"#/$defs/humanTextList\"},\"residualRisks\":{\"$ref\":\"#/$defs/humanTextList\"},\"decidedAt\":{\"$ref\":\"#/$defs/utcInstant\"}}},\"testReviewDecisionSummary\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"workType\",\"targetReviewDecisionId\",\"decisionDigest\",\"decision\",\"assessment\",\"independentChecks\",\"rationale\",\"blockingReasons\",\"residualRisks\",\"decidedAt\"],\"properties\":{\"workType\":{\"const\":\"test\"},\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"decisionDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"decision\":{\"enum\":[\"accept\",\"blocked\",\"escalate-product-defect\",\"request-another-attempt\"]},\"assessment\":{\"$ref\":\"#/$defs/testAssessment\"},\"independentChecks\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/independentCheck\"}},\"rationale\":{\"$ref\":\"#/$defs/humanText\"},\"blockingReasons\":{\"$ref\":\"#/$defs/humanTextList\"},\"residualRisks\":{\"$ref\":\"#/$defs/humanTextList\"},\"decidedAt\":{\"$ref\":\"#/$defs/utcInstant\"}}},\"reviewResumeSummary\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetReviewResumeId\",\"resumeDigest\",\"blockedDecision\",\"blockedSource\",\"resolutionSummary\",\"resumedAt\"],\"properties\":{\"targetReviewResumeId\":{\"$ref\":\"#/$defs/targetReviewResumeId\"},\"resumeDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"blockedDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetReviewDecisionId\",\"decisionDigest\",\"targetResultId\",\"targetResultDigest\"],\"properties\":{\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"decisionDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"targetResultId\":{\"$ref\":\"#/$defs/targetResultId\"},\"targetResultDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"blockedSource\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"snapshotDigest\",\"stateDigest\",\"streamRevision\"],\"properties\":{\"snapshotDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991}}},\"resolutionSummary\":{\"$ref\":\"#/$defs/humanText\"},\"resumedAt\":{\"$ref\":\"#/$defs/utcInstant\"}}},\"reviewHistoryEntry\":{\"oneOf\":[{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"sourceEvent\",\"decision\"],\"properties\":{\"kind\":{\"const\":\"decision\"},\"sourceEvent\":{\"$ref\":\"#/$defs/sourceEvent\"},\"decision\":{\"$ref\":\"#/$defs/reviewDecisionSummary\"}}},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"sourceEvent\",\"resume\"],\"properties\":{\"kind\":{\"const\":\"resume\"},\"sourceEvent\":{\"$ref\":\"#/$defs/sourceEvent\"},\"resume\":{\"$ref\":\"#/$defs/reviewResumeSummary\"}}}]},\"currentBlockedDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"sourceEvent\",\"decision\"],\"properties\":{\"sourceEvent\":{\"$ref\":\"#/$defs/sourceEvent\"},\"decision\":{\"$ref\":\"#/$defs/reviewDecisionSummary\"}}},\"reportedReviewUnit\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"workType\",\"targetTaskId\",\"outcome\",\"taskPackageSourceEvent\",\"taskPackage\",\"targetResultSourceEvent\",\"targetResult\",\"priorReviewHistory\",\"reviewUnitDigest\"],\"properties\":{\"status\":{\"const\":\"reported\"},\"workType\":{\"enum\":[\"implementation\",\"test\"]},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"outcome\":{\"$ref\":\"#/$defs/resultOutcome\"},\"taskPackageSourceEvent\":{\"$ref\":\"#/$defs/sourceEvent\"},\"taskPackage\":{\"$ref\":\"#/$defs/reviewTaskPackage\"},\"targetResultSourceEvent\":{\"$ref\":\"#/$defs/sourceEvent\"},\"targetResult\":{\"$ref\":\"#/$defs/targetResult\"},\"priorReviewHistory\":{\"type\":\"array\",\"maxItems\":10000,\"items\":{\"$ref\":\"#/$defs/reviewHistoryEntry\"}},\"reviewUnitDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}},\"allOf\":[{\"if\":{\"properties\":{\"workType\":{\"const\":\"implementation\"}},\"required\":[\"workType\"]},\"then\":{\"properties\":{\"taskPackage\":{\"allOf\":[{\"$ref\":\"#/$defs/reviewTaskPackage\"},{\"type\":\"object\",\"properties\":{\"workType\":{\"const\":\"implementation\"}}}]},\"targetResult\":{\"allOf\":[{\"$ref\":\"#/$defs/targetResult\"},{\"type\":\"object\",\"properties\":{\"workType\":{\"const\":\"implementation\"}}}]}}},\"else\":{\"properties\":{\"taskPackage\":{\"allOf\":[{\"$ref\":\"#/$defs/reviewTaskPackage\"},{\"type\":\"object\",\"properties\":{\"workType\":{\"const\":\"test\"}}}]},\"targetResult\":{\"allOf\":[{\"$ref\":\"#/$defs/targetResult\"},{\"type\":\"object\",\"properties\":{\"workType\":{\"const\":\"test\"}}}]}}}}]},\"blockedReviewUnit\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"workType\",\"targetTaskId\",\"outcome\",\"taskPackageSourceEvent\",\"taskPackage\",\"targetResultSourceEvent\",\"targetResult\",\"priorReviewHistory\",\"reviewUnitDigest\",\"currentBlockedDecision\"],\"properties\":{\"status\":{\"const\":\"review-blocked\"},\"workType\":{\"enum\":[\"implementation\",\"test\"]},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"outcome\":{\"$ref\":\"#/$defs/resultOutcome\"},\"taskPackageSourceEvent\":{\"$ref\":\"#/$defs/sourceEvent\"},\"taskPackage\":{\"$ref\":\"#/$defs/reviewTaskPackage\"},\"targetResultSourceEvent\":{\"$ref\":\"#/$defs/sourceEvent\"},\"targetResult\":{\"$ref\":\"#/$defs/targetResult\"},\"priorReviewHistory\":{\"type\":\"array\",\"maxItems\":10000,\"items\":{\"$ref\":\"#/$defs/reviewHistoryEntry\"}},\"reviewUnitDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"currentBlockedDecision\":{\"$ref\":\"#/$defs/currentBlockedDecision\"}},\"allOf\":[{\"if\":{\"properties\":{\"workType\":{\"const\":\"implementation\"}},\"required\":[\"workType\"]},\"then\":{\"properties\":{\"taskPackage\":{\"allOf\":[{\"$ref\":\"#/$defs/reviewTaskPackage\"},{\"type\":\"object\",\"properties\":{\"workType\":{\"const\":\"implementation\"}}}]},\"targetResult\":{\"allOf\":[{\"$ref\":\"#/$defs/targetResult\"},{\"type\":\"object\",\"properties\":{\"workType\":{\"const\":\"implementation\"}}}]},\"currentBlockedDecision\":{\"type\":\"object\",\"properties\":{\"decision\":{\"allOf\":[{\"$ref\":\"#/$defs/implementationReviewDecisionSummary\"},{\"type\":\"object\",\"properties\":{\"workType\":{\"const\":\"implementation\"},\"decision\":{\"const\":\"blocked\"}}}]}}}}},\"else\":{\"properties\":{\"taskPackage\":{\"allOf\":[{\"$ref\":\"#/$defs/reviewTaskPackage\"},{\"type\":\"object\",\"properties\":{\"workType\":{\"const\":\"test\"}}}]},\"targetResult\":{\"allOf\":[{\"$ref\":\"#/$defs/targetResult\"},{\"type\":\"object\",\"properties\":{\"workType\":{\"const\":\"test\"}}}]},\"currentBlockedDecision\":{\"type\":\"object\",\"properties\":{\"decision\":{\"allOf\":[{\"$ref\":\"#/$defs/testReviewDecisionSummary\"},{\"type\":\"object\",\"properties\":{\"workType\":{\"const\":\"test\"},\"decision\":{\"const\":\"blocked\"}}}]}}}}}}]},\"reviewUnit\":{\"oneOf\":[{\"$ref\":\"#/$defs/reportedReviewUnit\"},{\"$ref\":\"#/$defs/blockedReviewUnit\"}]},\"eventStream\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"commitSequence\",\"streamRevision\",\"lastCommitDigest\",\"lastEventId\",\"lastEventDigest\",\"stateDigest\"],\"properties\":{\"commitSequence\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"lastCommitDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"lastEventId\":{\"$ref\":\"#/$defs/eventId\"},\"lastEventDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"targetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetReviewResumeId\":{\"type\":\"string\",\"pattern\":\"^target-review-resume_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}");
