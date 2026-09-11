/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-target-result-review-inspection-result.schema.json
 */

export type DemandId = string
export type Sha256Digest = string
export type EventId = string
export type ReviewUnit = ({
[k: string]: unknown | undefined
} & {
status: ("reported" | "review-blocked" | "escalated")
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
currentDecision: (null | CurrentDecision)
resumptionBasis: ResumptionBasis
callback: CallbackStatus
targetCompletion: TargetCompletion
/**
 * @maxItems 4
 */
allowedDecisions: []|[("accept" | "rework" | "blocked" | "escalate" | "request-another-attempt")]|[("accept" | "rework" | "blocked" | "escalate" | "request-another-attempt"), ("accept" | "rework" | "blocked" | "escalate" | "request-another-attempt")]|[("accept" | "rework" | "blocked" | "escalate" | "request-another-attempt"), ("accept" | "rework" | "blocked" | "escalate" | "request-another-attempt"), ("accept" | "rework" | "blocked" | "escalate" | "request-another-attempt")]|[("accept" | "rework" | "blocked" | "escalate" | "request-another-attempt"), ("accept" | "rework" | "blocked" | "escalate" | "request-another-attempt"), ("accept" | "rework" | "blocked" | "escalate" | "request-another-attempt"), ("accept" | "rework" | "blocked" | "escalate" | "request-another-attempt")]
testSteps: (null | [StepView]|[StepView, StepView]|[StepView, StepView, StepView]|[StepView, StepView, StepView, StepView]|[StepView, StepView, StepView, StepView, StepView]|[StepView, StepView, StepView, StepView, StepView, StepView]|[StepView, StepView, StepView, StepView, StepView, StepView, StepView]|[StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView]|[StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView]|[StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView]|[StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView]|[StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView]|[StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView]|[StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView]|[StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView]|[StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView]|[StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView]|[StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView]|[StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView]|[StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView, StepView])
attemptScope: (null | {
ordinal: number
stepIds: (null | [StepId]|[StepId, StepId]|[StepId, StepId, StepId]|[StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId])
})
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
lineage?: (ReviewTaskPackageLineage | ReviewTaskPackageTestLineage)
planReview?: ReviewTaskPackagePlanReview
sectionAnchors?: ReviewTaskPackageSectionAnchors
testContract?: ReviewTaskPackageTestContract
implementationBaselines?: ReviewTaskPackageImplementationBaselines
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
export type ReviewTaskPackageLineage = (null | {
kind: "replacement"
replacesTargetTaskId: ReviewTaskPackageTargetTaskId
} | {
kind: "continuation"
continuesTargetTaskId: ReviewTaskPackageTargetTaskId
})
export type ReviewTaskPackageTestLineage = (null | {
kind: "retest"
retestsTargetTaskId: ReviewTaskPackageTargetTaskId
productDefectRemediationId: ReviewTaskPackageProductDefectRemediationId
authorizationDigest: Sha256Digest
})
export type ReviewTaskPackageProductDefectRemediationId = string
export type ReviewTaskPackagePlanReview = ({
reviewer: "controller"
} | {
reviewer: "user"
confirmedAt: UtcInstant
})
/**
 * @maxItems 32
 */
export type ReviewTaskPackageSectionAnchors = string[]
export type ReviewTaskPackageStepId = string
export type ReviewTaskPackageSkillPath = string
/**
 * @minItems 1
 * @maxItems 32
 */
export type ReviewTaskPackageImplementationBaselines = [ReviewTaskPackageImplementationBaseline, ...(ReviewTaskPackageImplementationBaseline)[]]
export type ReviewTaskPackageTargetResultId = string
export type ReviewTaskPackageTargetReviewDecisionId = string
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
deliveryId: TargetDeliveryId
taskPackage: TaskPackage
assignment: (ImplementationAssignment | TestAssignment)
delivery: Delivery
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
branch: (null | BranchName)
})
export type GitObjectId = (GitSha1ObjectId | GitSha256ObjectId)
export type BranchName = string
export type EvidenceKind = ("hook-observation" | "transcript" | "test-output" | "diff" | "document" | "link" | "commit")
/**
 * @maxItems 64
 */
export type EvidenceLocators = EvidenceLocator[]
/**
 * @maxItems 64
 */
export type HumanTextList = HumanText[]
export type Token = string
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
reportedAt: UtcInstant
reportDigest: Sha256Digest
/**
 * @maxItems 20
 */
steps: []|[Step]|[Step, Step]|[Step, Step, Step]|[Step, Step, Step, Step]|[Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
})
export type Step = ({
[k: string]: unknown | undefined
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
})
export type StepId = string
export type TestAttemptId = string
export type ReviewDecisionSummary = (ImplementationReviewDecisionSummary | TestReviewDecisionSummary)
export type TargetReviewDecisionId = string
export type DemandEventId = string
export type CallbackLanding = (null | {
recordId: string
landedAt: UtcInstant
})
export type TargetCompletionRecord = (null | {
recordId: string
event: ("stop" | "turn-complete")
observedAt: UtcInstant
})
export type TestEscalation = ({
[k: string]: unknown | undefined
} & {
classification: ("product-defect" | "needs-decision")
remediation?: Remediation
userDecision?: Escalation
})
export type ResumptionBasis = (null | ({
kind: "condition-cleared"
} | {
kind: "decision-recorded"
escalationEventId: DemandEventId
answered: boolean
}))
export type RecordId = string
export type TargetCompletion = ({
status: "pending"
} | {
status: "confirmed"
recordId: RecordId
event: ("stop" | "turn-complete")
observedAt: UtcInstant
})

/**
 * Current read-only review context for one reported, review-blocked, or escalated TargetResult: the complete task package and result, prior decisions, callback and completion evidence status, the decisions the rules allow, and, for test results, the per-step record with approved baselines.
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
family: "requirement"
recordId: string
recordRef: PortableResourcePath
recordDigest: Sha256Digest
memberPath: PortableResourcePath
memberRef: PortableResourcePath
memberDigest: Sha256Digest
role: ("requirement" | "landing" | "attachment")
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
requirementRef: ReviewTaskPackageRequirementRef
}
export interface ReviewTaskPackageRequirementRef {
recordDigest: Sha256Digest
sectionAnchor: string
itemId: string
}
export interface ReviewTaskPackageTestContract {
question: ReviewTaskPackageHumanText
objectBoundary: ReviewTaskPackageHumanText
/**
 * @minItems 1
 * @maxItems 20
 */
steps: [ReviewTaskPackageTestContractStep]|[ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep]|[ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep]|[ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep]|[ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep]|[ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep]|[ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep]|[ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep]|[ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep]|[ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep]|[ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep]|[ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep]|[ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep]|[ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep]|[ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep]|[ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep]|[ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep]|[ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep]|[ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep]|[ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep, ReviewTaskPackageTestContractStep]
environment: AuthorityMemberReference
/**
 * @maxItems 8
 */
allowedSkills: []|[ReviewTaskPackageSkillPath]|[ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath]|[ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath]|[ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath]|[ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath]|[ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath]|[ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath]|[ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath, ReviewTaskPackageSkillPath]
setupPolicy: ("fresh-once" | "fresh-per-attempt" | "reuse-existing")
maxAttempts: number
/**
 * @minItems 1
 * @maxItems 8
 */
stopConditions: [ReviewTaskPackageHumanText]|[ReviewTaskPackageHumanText, ReviewTaskPackageHumanText]|[ReviewTaskPackageHumanText, ReviewTaskPackageHumanText, ReviewTaskPackageHumanText]|[ReviewTaskPackageHumanText, ReviewTaskPackageHumanText, ReviewTaskPackageHumanText, ReviewTaskPackageHumanText]|[ReviewTaskPackageHumanText, ReviewTaskPackageHumanText, ReviewTaskPackageHumanText, ReviewTaskPackageHumanText, ReviewTaskPackageHumanText]|[ReviewTaskPackageHumanText, ReviewTaskPackageHumanText, ReviewTaskPackageHumanText, ReviewTaskPackageHumanText, ReviewTaskPackageHumanText, ReviewTaskPackageHumanText]|[ReviewTaskPackageHumanText, ReviewTaskPackageHumanText, ReviewTaskPackageHumanText, ReviewTaskPackageHumanText, ReviewTaskPackageHumanText, ReviewTaskPackageHumanText, ReviewTaskPackageHumanText]|[ReviewTaskPackageHumanText, ReviewTaskPackageHumanText, ReviewTaskPackageHumanText, ReviewTaskPackageHumanText, ReviewTaskPackageHumanText, ReviewTaskPackageHumanText, ReviewTaskPackageHumanText, ReviewTaskPackageHumanText]
}
export interface ReviewTaskPackageTestContractStep {
stepId: ReviewTaskPackageStepId
given: ReviewTaskPackageHumanText
when: ReviewTaskPackageHumanText
then: ReviewTaskPackageHumanText
requirementRef: ReviewTaskPackageRequirementRef
}
export interface ReviewTaskPackageImplementationBaseline {
targetTaskId: ReviewTaskPackageTargetTaskId
taskPackageId: ReviewTaskPackageTaskPackageId
taskPackageDigest: Sha256Digest
repositoryId: ReviewTaskPackageRepositoryId
windowId: ReviewTaskPackageWindowId
targetResultId: ReviewTaskPackageTargetResultId
resultDigest: Sha256Digest
targetReviewDecisionId: ReviewTaskPackageTargetReviewDecisionId
decisionDigest: Sha256Digest
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
export interface Delivery {
generation: number
fence: {
claimId: ClaimId
claimDigest: Sha256Digest
}
outcomeDigest: Sha256Digest
disposition: ("accepted" | "indeterminate")
readbackStatus: ("confirmed" | "pending" | "unavailable")
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
kind: EvidenceKind
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
export interface Failure {
classification: ("product-defect" | "harness-defect" | "environment" | "flaky" | "missing-evidence" | "out-of-scope" | "needs-decision")
likelyOwner: ("implementation" | "test" | "environment" | "user")
recommendedAction: HumanText
}
export interface TestExecution {
testAttemptId: TestAttemptId
ordinal: number
stepIds: (null | [StepId]|[StepId, StepId]|[StepId, StepId, StepId]|[StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId])
}
export interface ReviewHistoryEntry {
sourceEvent: SourceEvent
decision: ReviewDecisionSummary
}
export interface ImplementationReviewDecisionSummary {
workType: "implementation"
decision: ("accept" | "rework" | "blocked" | "escalate")
assessment: ImplementationAssessment
escalation: (null | Escalation)
targetReviewDecisionId: TargetReviewDecisionId
decisionDigest: Sha256Digest
/**
 * @minItems 1
 * @maxItems 32
 */
independentChecks: [IndependentCheck, ...(IndependentCheck)[]]
rationale: HumanText
blockingReasons: HumanTextList
residualRisks: HumanTextList
resumption: (null | Resumption)
callbackLanding: CallbackLanding
targetCompletion: TargetCompletionRecord
decidedAt: UtcInstant
}
export interface ImplementationAssessment {
requirementAlignment: ("aligned" | "mismatch" | "unresolved")
implementationQuality: ("satisfactory" | "defective" | "unverified")
}
export interface Escalation {
issue: string
/**
 * @maxItems 16
 */
requirementRefs: []|[{
recordDigest: Sha256Digest
sectionAnchor: string
}]|[{
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}]|[{
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}]|[{
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}]|[{
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}]|[{
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}]|[{
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}]|[{
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}]|[{
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}]|[{
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}]|[{
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}]|[{
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}]|[{
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}]|[{
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}]|[{
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}]|[{
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}, {
recordDigest: Sha256Digest
sectionAnchor: string
}]
/**
 * @maxItems 16
 */
evidence: []|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: Sha256Digest
}]
/**
 * @minItems 1
 * @maxItems 4
 */
options: [{
option: string
impact: string
}]|[{
option: string
impact: string
}, {
option: string
impact: string
}]|[{
option: string
impact: string
}, {
option: string
impact: string
}, {
option: string
impact: string
}]|[{
option: string
impact: string
}, {
option: string
impact: string
}, {
option: string
impact: string
}, {
option: string
impact: string
}]
recommendation: string
}
export interface IndependentCheck {
checkId: Token
method: HumanText
outcome: ("passed" | "failed" | "inconclusive")
observation: HumanText
}
export interface Resumption {
previousDecisionId: TargetReviewDecisionId
basis: ({
kind: "condition-cleared"
} | {
kind: "decision-recorded"
escalationEventId: DemandEventId
})
summary: HumanText
}
export interface TestReviewDecisionSummary {
workType: "test"
decision: ("accept" | "request-another-attempt" | "blocked" | "escalate")
assessment: TestAssessment
stepIds: (null | [StepId]|[StepId, StepId]|[StepId, StepId, StepId]|[StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId])
escalation: (null | TestEscalation)
targetReviewDecisionId: TargetReviewDecisionId
decisionDigest: Sha256Digest
/**
 * @minItems 1
 * @maxItems 32
 */
independentChecks: [IndependentCheck, ...(IndependentCheck)[]]
rationale: HumanText
blockingReasons: HumanTextList
residualRisks: HumanTextList
resumption: (null | Resumption)
callbackLanding: CallbackLanding
targetCompletion: TargetCompletionRecord
decidedAt: UtcInstant
}
export interface TestAssessment {
conclusion: ("satisfied" | "defect-observed" | "inconclusive")
evidenceSufficiency: ("sufficient" | "insufficient")
}
export interface Remediation {
/**
 * @minItems 1
 * @maxItems 32
 */
affectedTargets: [{
targetTaskId: TargetTaskId
/**
 * @minItems 1
 * @maxItems 20
 */
failedStepIds: [StepId]|[StepId, StepId]|[StepId, StepId, StepId]|[StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]
correctionObjective: HumanText
}, ...({
targetTaskId: TargetTaskId
/**
 * @minItems 1
 * @maxItems 20
 */
failedStepIds: [StepId]|[StepId, StepId]|[StepId, StepId, StepId]|[StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]
correctionObjective: HumanText
})[]]
authorizationRationale: HumanText
}
export interface CurrentDecision {
sourceEvent: SourceEvent
decision: ReviewDecisionSummary
}
/**
 * wake-controller 回调的落地状态：由 Controller 会话的 user-prompt-submit 记录派生；silent 表示签发后超过静默阈值仍无记录。
 */
export interface CallbackStatus {
status: ("pending" | "landed" | "silent" | "acknowledged")
generation: number
issuedAt: UtcInstant
landedRecordId: (null | RecordId)
}
export interface StepView {
stepId: StepId
given: HumanText
when: HumanText
expected: HumanText
observed: (null | HumanText)
evidence: (null | EvidenceRef)
verdict: (null | ("pass" | "fail" | "blocked" | "cannot-conclude"))
failure: (null | Failure)
baseline: (null | {
attemptOrdinal: number
targetTaskId: TargetTaskId
observed: HumanText
evidence: EvidenceRef
})
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
export const WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:target-result-review-inspection-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_RESULT_SCHEMA\",\"title\":\"WakeflowTargetResultReviewInspectionResultV1\",\"description\":\"Current read-only review context for one reported, review-blocked, or escalated TargetResult: the complete task package and result, prior decisions, callback and completion evidence status, the decisions the rules allow, and, for test results, the per-step record with approved baselines.\",\"$comment\":\"The result is review input only. It performs no checks, derives no verdict, and creates no Controller acceptance; allowedDecisions only restates the admissibility rules of the two decision tools.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"status\",\"demand\",\"eventStream\",\"snapshotDigest\",\"reviewUnit\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTargetResultReviewInspectionResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_inspect_target_result_review\"},\"status\":{\"const\":\"current\"},\"demand\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"demandId\",\"lifecycle\"],\"properties\":{\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"lifecycle\":{\"const\":\"active\"}}},\"eventStream\":{\"$ref\":\"#/$defs/eventStream\"},\"snapshotDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"reviewUnit\":{\"$ref\":\"#/$defs/reviewUnit\"}},\"$defs\":{\"targetResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"workType\",\"targetResultId\",\"programId\",\"demandId\",\"targetTaskId\",\"deliveryId\",\"taskPackage\",\"assignment\",\"delivery\",\"report\",\"resultDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTargetResult\"},\"schemaVersion\":{\"const\":1},\"workType\":{\"enum\":[\"implementation\",\"test\"]},\"targetResultId\":{\"$ref\":\"#/$defs/targetResultId\"},\"programId\":{\"$ref\":\"#/$defs/programId\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"deliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"},\"taskPackage\":{\"$ref\":\"#/$defs/taskPackage\"},\"assignment\":{\"oneOf\":[{\"$ref\":\"#/$defs/implementationAssignment\"},{\"$ref\":\"#/$defs/testAssignment\"}]},\"delivery\":{\"$ref\":\"#/$defs/delivery\"},\"report\":{\"oneOf\":[{\"$ref\":\"#/$defs/implementationReport\"},{\"$ref\":\"#/$defs/testReport\"}]},\"testExecution\":{\"$ref\":\"#/$defs/testExecution\"},\"resultDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}},\"allOf\":[{\"if\":{\"properties\":{\"workType\":{\"const\":\"test\"}},\"required\":[\"workType\"]},\"then\":{\"required\":[\"testExecution\"],\"properties\":{\"assignment\":{\"$ref\":\"#/$defs/testAssignment\"},\"report\":{\"$ref\":\"#/$defs/testReport\"},\"testExecution\":{\"$ref\":\"#/$defs/testExecution\"}}},\"else\":{\"properties\":{\"assignment\":{\"$ref\":\"#/$defs/implementationAssignment\"},\"report\":{\"$ref\":\"#/$defs/implementationReport\"},\"testExecution\":false}}}]},\"taskPackage\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"taskPackageId\",\"ref\",\"digest\"],\"properties\":{\"taskPackageId\":{\"$ref\":\"#/$defs/taskPackageId\"},\"ref\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"digest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"implementationAssignment\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"repositoryId\",\"windowId\"],\"properties\":{\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"}}},\"testAssignment\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"windowId\"],\"properties\":{\"windowId\":{\"$ref\":\"#/$defs/windowId\"}}},\"testExecution\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"testAttemptId\",\"ordinal\",\"stepIds\"],\"properties\":{\"testAttemptId\":{\"$ref\":\"#/$defs/testAttemptId\"},\"ordinal\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":10},\"stepIds\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"array\",\"minItems\":1,\"maxItems\":20,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/stepId\"}}]}}},\"implementationReport\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"outcome\",\"summary\",\"repositoryChange\",\"evidenceLocators\",\"verification\",\"risks\",\"anchorEvidence\",\"reportedAt\",\"reportDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowImplementationTargetResultReport\"},\"schemaVersion\":{\"const\":1},\"outcome\":{\"$ref\":\"#/$defs/resultOutcome\"},\"summary\":{\"$ref\":\"#/$defs/humanText\"},\"repositoryChange\":{\"$ref\":\"#/$defs/repositoryChange\"},\"evidenceLocators\":{\"$ref\":\"#/$defs/evidenceLocators\"},\"verification\":{\"$ref\":\"#/$defs/humanTextList\"},\"risks\":{\"$ref\":\"#/$defs/humanTextList\"},\"anchorEvidence\":{\"type\":\"array\",\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/anchorEvidence\"}},\"reportedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"reportDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"testReport\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"outcome\",\"summary\",\"evidenceLocators\",\"verification\",\"risks\",\"steps\",\"verdict\",\"reportedAt\",\"reportDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTestTargetResultReport\"},\"schemaVersion\":{\"const\":1},\"outcome\":{\"$ref\":\"#/$defs/resultOutcome\"},\"summary\":{\"$ref\":\"#/$defs/humanText\"},\"evidenceLocators\":{\"$ref\":\"#/$defs/evidenceLocators\"},\"verification\":{\"$ref\":\"#/$defs/humanTextList\"},\"risks\":{\"$ref\":\"#/$defs/humanTextList\"},\"reportedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"reportDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"steps\":{\"type\":\"array\",\"maxItems\":20,\"items\":{\"$ref\":\"#/$defs/step\"}},\"verdict\":{\"enum\":[\"pass\",\"fail\",\"blocked\",\"cannot-conclude\"]}},\"allOf\":[{\"if\":{\"properties\":{\"outcome\":{\"const\":\"completed\"}},\"required\":[\"outcome\"]},\"then\":{\"properties\":{\"steps\":{\"type\":\"array\",\"minItems\":1}}}}]},\"repositoryChange\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"repositoryId\",\"disposition\",\"branch\",\"commits\"],\"properties\":{\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"disposition\":{\"enum\":[\"committed\",\"left-uncommitted\",\"no-changes\"]},\"commits\":{\"type\":\"array\",\"maxItems\":64,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/gitObjectId\"}},\"branch\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/branchName\"}]}},\"allOf\":[{\"if\":{\"properties\":{\"disposition\":{\"const\":\"committed\"}},\"required\":[\"disposition\"]},\"then\":{\"properties\":{\"commits\":{\"type\":\"array\",\"minItems\":1}}},\"else\":{\"properties\":{\"commits\":{\"type\":\"array\",\"maxItems\":0}}}}]},\"evidenceLocators\":{\"type\":\"array\",\"maxItems\":64,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/evidenceLocator\"}},\"evidenceLocator\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"ref\",\"digest\"],\"properties\":{\"kind\":{\"$ref\":\"#/$defs/evidenceKind\"},\"ref\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"digest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"evidenceRef\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"ref\",\"digest\"],\"properties\":{\"ref\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"digest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"anchorEvidence\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"anchorId\",\"evidenceRefs\"],\"properties\":{\"anchorId\":{\"$ref\":\"#/$defs/token\"},\"evidenceRefs\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/evidenceRef\"}}}},\"humanTextList\":{\"type\":\"array\",\"maxItems\":64,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/humanText\"}},\"eventReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"eventId\",\"streamRevision\"],\"properties\":{\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991}}},\"commitReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"commitId\",\"commitSequence\",\"commitDigest\"],\"properties\":{\"commitId\":{\"$ref\":\"#/$defs/commitId\"},\"commitSequence\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"commitDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"resultOutcome\":{\"enum\":[\"completed\",\"blocked\",\"needs-review\"]},\"humanText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"token\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"pattern\":\"^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\\\.{1,2}(?:/|$))(?!.*\\\\/\\\\.{1,2}(?:/|$))(?!.*\\\\\\\\)(?!.*//)(?!.*\\\\/$)(?!\\\\s)(?!.*\\\\s$)(?!.*\\\\/\\\\s)(?!.*\\\\s\\\\/)(?!.*[\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]).+$\"},\"gitObjectId\":{\"oneOf\":[{\"$ref\":\"#/$defs/gitSha1ObjectId\"},{\"$ref\":\"#/$defs/gitSha256ObjectId\"}]},\"gitSha1ObjectId\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"algorithm\",\"value\"],\"properties\":{\"algorithm\":{\"const\":\"sha1\"},\"value\":{\"type\":\"string\",\"pattern\":\"^[0-9a-f]{40}$\"}}},\"gitSha256ObjectId\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"algorithm\",\"value\"],\"properties\":{\"algorithm\":{\"const\":\"sha256\"},\"value\":{\"type\":\"string\",\"pattern\":\"^[0-9a-f]{64}$\"}}},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetDeliveryId\":{\"type\":\"string\",\"pattern\":\"^target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetResultId\":{\"type\":\"string\",\"pattern\":\"^target-result_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"taskPackageId\":{\"type\":\"string\",\"pattern\":\"^task-package_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"testAttemptId\":{\"type\":\"string\",\"pattern\":\"^test-attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"claimId\":{\"type\":\"string\",\"pattern\":\"^work-claim_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"reviewTaskPackageProgramId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"reviewTaskPackageDemandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"reviewTaskPackageTaskPackageId\":{\"type\":\"string\",\"pattern\":\"^task-package_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"reviewTaskPackageTargetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"reviewTaskPackageRepositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"reviewTaskPackageWindowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"reviewTaskPackageHumanText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":16384,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"reviewTaskPackageNonEmptyTextList\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/reviewTaskPackageHumanText\"}},\"reviewTaskPackageAssignment\":{\"oneOf\":[{\"$ref\":\"#/$defs/reviewTaskPackageImplementationAssignment\"},{\"$ref\":\"#/$defs/reviewTaskPackageTestAssignment\"}]},\"reviewTaskPackageImplementationAssignment\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"repositoryId\",\"windowId\"],\"properties\":{\"repositoryId\":{\"$ref\":\"#/$defs/reviewTaskPackageRepositoryId\"},\"windowId\":{\"$ref\":\"#/$defs/reviewTaskPackageWindowId\"}}},\"reviewTaskPackageTestAssignment\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"windowId\"],\"properties\":{\"windowId\":{\"$ref\":\"#/$defs/reviewTaskPackageWindowId\"}}},\"reviewTaskPackageBoundaries\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"inScope\",\"outOfScope\",\"forbidden\"],\"properties\":{\"inScope\":{\"$ref\":\"#/$defs/reviewTaskPackageNonEmptyTextList\"},\"outOfScope\":{\"$ref\":\"#/$defs/reviewTaskPackageTextList\"},\"forbidden\":{\"$ref\":\"#/$defs/reviewTaskPackageTextList\"}}},\"reviewTaskPackageTextList\":{\"type\":\"array\",\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/reviewTaskPackageHumanText\"}},\"reviewTaskPackageAnchorId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"reviewTaskPackageAcceptanceAnchor\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"anchorId\",\"claim\",\"probe\",\"expected\",\"requirementRef\"],\"properties\":{\"anchorId\":{\"$ref\":\"#/$defs/reviewTaskPackageAnchorId\"},\"claim\":{\"$ref\":\"#/$defs/reviewTaskPackageHumanText\"},\"probe\":{\"$ref\":\"#/$defs/reviewTaskPackageHumanText\"},\"expected\":{\"$ref\":\"#/$defs/reviewTaskPackageHumanText\"},\"requirementRef\":{\"$ref\":\"#/$defs/reviewTaskPackageRequirementRef\"}}},\"reviewTaskPackageRequirementRef\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"recordDigest\",\"sectionAnchor\",\"itemId\"],\"properties\":{\"recordDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"sectionAnchor\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":64,\"pattern\":\"^[a-z0-9]+(?:-[a-z0-9]+)*$\"},\"itemId\":{\"type\":\"string\",\"pattern\":\"^ac-[1-9][0-9]{0,2}$\"}}},\"reviewTaskPackageLineage\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"replacesTargetTaskId\"],\"properties\":{\"kind\":{\"const\":\"replacement\"},\"replacesTargetTaskId\":{\"$ref\":\"#/$defs/reviewTaskPackageTargetTaskId\"}}},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"continuesTargetTaskId\"],\"properties\":{\"kind\":{\"const\":\"continuation\"},\"continuesTargetTaskId\":{\"$ref\":\"#/$defs/reviewTaskPackageTargetTaskId\"}}}]},\"reviewTaskPackagePlanReview\":{\"oneOf\":[{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"reviewer\"],\"properties\":{\"reviewer\":{\"const\":\"controller\"}}},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"reviewer\",\"confirmedAt\"],\"properties\":{\"reviewer\":{\"const\":\"user\"},\"confirmedAt\":{\"$ref\":\"#/$defs/utcInstant\"}}}]},\"reviewTaskPackageSectionAnchors\":{\"type\":\"array\",\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":64,\"pattern\":\"^[a-z0-9]+(?:-[a-z0-9]+)*$\"}},\"reviewTaskPackage\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"programId\",\"configDigest\",\"demandId\",\"demandAuthorityDigest\",\"taskPackageId\",\"targetTaskId\",\"createdAt\",\"assignment\",\"workType\",\"objective\",\"confirmedContext\",\"selectedAuthorityRefs\",\"boundaries\",\"completionExpectations\",\"acceptanceAnchors\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-task-package\"},\"schemaVersion\":{\"const\":1},\"programId\":{\"$ref\":\"#/$defs/reviewTaskPackageProgramId\"},\"configDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"demandId\":{\"$ref\":\"#/$defs/reviewTaskPackageDemandId\"},\"demandAuthorityDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"taskPackageId\":{\"$ref\":\"#/$defs/reviewTaskPackageTaskPackageId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/reviewTaskPackageTargetTaskId\"},\"createdAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"assignment\":{\"$ref\":\"#/$defs/reviewTaskPackageAssignment\"},\"workType\":{\"enum\":[\"implementation\",\"test\"]},\"objective\":{\"$ref\":\"#/$defs/reviewTaskPackageHumanText\"},\"confirmedContext\":{\"$ref\":\"#/$defs/reviewTaskPackageNonEmptyTextList\"},\"selectedAuthorityRefs\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/authorityMemberReference\"}},\"boundaries\":{\"$ref\":\"#/$defs/reviewTaskPackageBoundaries\"},\"completionExpectations\":{\"$ref\":\"#/$defs/reviewTaskPackageNonEmptyTextList\"},\"commitExpectation\":{\"enum\":[\"commit\",\"leave-uncommitted\"]},\"acceptanceAnchors\":{\"type\":\"array\",\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/reviewTaskPackageAcceptanceAnchor\"}},\"lineage\":{\"anyOf\":[{\"$ref\":\"#/$defs/reviewTaskPackageLineage\"},{\"$ref\":\"#/$defs/reviewTaskPackageTestLineage\"}]},\"planReview\":{\"$ref\":\"#/$defs/reviewTaskPackagePlanReview\"},\"sectionAnchors\":{\"$ref\":\"#/$defs/reviewTaskPackageSectionAnchors\"},\"testContract\":{\"$ref\":\"#/$defs/reviewTaskPackageTestContract\"},\"implementationBaselines\":{\"$ref\":\"#/$defs/reviewTaskPackageImplementationBaselines\"}},\"allOf\":[{\"if\":{\"properties\":{\"workType\":{\"const\":\"implementation\"}},\"required\":[\"workType\"]},\"then\":{\"required\":[\"commitExpectation\",\"lineage\",\"planReview\",\"sectionAnchors\"],\"properties\":{\"commitExpectation\":{\"enum\":[\"commit\",\"leave-uncommitted\"]},\"assignment\":{\"$ref\":\"#/$defs/reviewTaskPackageImplementationAssignment\"},\"acceptanceAnchors\":{\"type\":\"array\",\"minItems\":1},\"lineage\":{\"$ref\":\"#/$defs/reviewTaskPackageLineage\"},\"planReview\":{\"$ref\":\"#/$defs/reviewTaskPackagePlanReview\"},\"sectionAnchors\":{\"$ref\":\"#/$defs/reviewTaskPackageSectionAnchors\"},\"testContract\":false,\"implementationBaselines\":false}},\"else\":{\"required\":[\"testContract\",\"implementationBaselines\",\"lineage\"],\"properties\":{\"testContract\":{\"$ref\":\"#/$defs/reviewTaskPackageTestContract\"},\"implementationBaselines\":{\"$ref\":\"#/$defs/reviewTaskPackageImplementationBaselines\"},\"assignment\":{\"$ref\":\"#/$defs/reviewTaskPackageTestAssignment\"},\"commitExpectation\":false,\"acceptanceAnchors\":{\"type\":\"array\",\"maxItems\":0},\"lineage\":{\"$ref\":\"#/$defs/reviewTaskPackageTestLineage\"},\"planReview\":false,\"sectionAnchors\":false}}}]},\"authorityMemberReference\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"family\",\"recordId\",\"recordRef\",\"recordDigest\",\"memberPath\",\"memberRef\",\"memberDigest\",\"role\",\"mediaType\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-ledger-authority-member-reference\"},\"schemaVersion\":{\"const\":1},\"family\":{\"enum\":[\"requirement\"]},\"recordId\":{\"type\":\"string\",\"pattern\":\"^requirement_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"recordRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"recordDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"memberPath\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"memberRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"memberDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"role\":{\"enum\":[\"requirement\",\"landing\",\"attachment\"]},\"mediaType\":{\"type\":\"string\",\"pattern\":\"^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$\"}}},\"sourceEvent\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"eventId\",\"eventDigest\",\"streamRevision\"],\"properties\":{\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"eventDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991}}},\"independentCheck\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"checkId\",\"method\",\"outcome\",\"observation\"],\"properties\":{\"checkId\":{\"$ref\":\"#/$defs/token\"},\"method\":{\"$ref\":\"#/$defs/humanText\"},\"outcome\":{\"enum\":[\"passed\",\"failed\",\"inconclusive\"]},\"observation\":{\"$ref\":\"#/$defs/humanText\"}}},\"implementationAssessment\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"requirementAlignment\",\"implementationQuality\"],\"properties\":{\"requirementAlignment\":{\"enum\":[\"aligned\",\"mismatch\",\"unresolved\"]},\"implementationQuality\":{\"enum\":[\"satisfactory\",\"defective\",\"unverified\"]}}},\"testAssessment\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"conclusion\",\"evidenceSufficiency\"],\"properties\":{\"conclusion\":{\"enum\":[\"satisfied\",\"defect-observed\",\"inconclusive\"]},\"evidenceSufficiency\":{\"enum\":[\"sufficient\",\"insufficient\"]}}},\"reviewDecisionSummary\":{\"oneOf\":[{\"$ref\":\"#/$defs/implementationReviewDecisionSummary\"},{\"$ref\":\"#/$defs/testReviewDecisionSummary\"}]},\"implementationReviewDecisionSummary\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"workType\",\"targetReviewDecisionId\",\"decisionDigest\",\"decision\",\"assessment\",\"independentChecks\",\"rationale\",\"blockingReasons\",\"residualRisks\",\"escalation\",\"resumption\",\"callbackLanding\",\"targetCompletion\",\"decidedAt\"],\"properties\":{\"workType\":{\"const\":\"implementation\"},\"decision\":{\"enum\":[\"accept\",\"rework\",\"blocked\",\"escalate\"]},\"assessment\":{\"$ref\":\"#/$defs/implementationAssessment\"},\"escalation\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/escalation\"}]},\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"decisionDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"independentChecks\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/independentCheck\"}},\"rationale\":{\"$ref\":\"#/$defs/humanText\"},\"blockingReasons\":{\"$ref\":\"#/$defs/humanTextList\"},\"residualRisks\":{\"$ref\":\"#/$defs/humanTextList\"},\"resumption\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/resumption\"}]},\"callbackLanding\":{\"$ref\":\"#/$defs/callbackLanding\"},\"targetCompletion\":{\"$ref\":\"#/$defs/targetCompletionRecord\"},\"decidedAt\":{\"$ref\":\"#/$defs/utcInstant\"}}},\"testReviewDecisionSummary\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"workType\",\"targetReviewDecisionId\",\"decisionDigest\",\"decision\",\"assessment\",\"independentChecks\",\"rationale\",\"blockingReasons\",\"residualRisks\",\"stepIds\",\"escalation\",\"resumption\",\"callbackLanding\",\"targetCompletion\",\"decidedAt\"],\"properties\":{\"workType\":{\"const\":\"test\"},\"decision\":{\"enum\":[\"accept\",\"request-another-attempt\",\"blocked\",\"escalate\"]},\"assessment\":{\"$ref\":\"#/$defs/testAssessment\"},\"stepIds\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"array\",\"minItems\":1,\"maxItems\":20,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/stepId\"}}]},\"escalation\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/testEscalation\"}]},\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"decisionDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"independentChecks\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/independentCheck\"}},\"rationale\":{\"$ref\":\"#/$defs/humanText\"},\"blockingReasons\":{\"$ref\":\"#/$defs/humanTextList\"},\"residualRisks\":{\"$ref\":\"#/$defs/humanTextList\"},\"resumption\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/resumption\"}]},\"callbackLanding\":{\"$ref\":\"#/$defs/callbackLanding\"},\"targetCompletion\":{\"$ref\":\"#/$defs/targetCompletionRecord\"},\"decidedAt\":{\"$ref\":\"#/$defs/utcInstant\"}}},\"reviewHistoryEntry\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"sourceEvent\",\"decision\"],\"properties\":{\"sourceEvent\":{\"$ref\":\"#/$defs/sourceEvent\"},\"decision\":{\"$ref\":\"#/$defs/reviewDecisionSummary\"}}},\"reviewUnit\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"workType\",\"targetTaskId\",\"outcome\",\"taskPackageSourceEvent\",\"taskPackage\",\"targetResultSourceEvent\",\"targetResult\",\"priorReviewHistory\",\"reviewUnitDigest\",\"currentDecision\",\"resumptionBasis\",\"callback\",\"targetCompletion\",\"allowedDecisions\",\"testSteps\",\"attemptScope\"],\"properties\":{\"status\":{\"enum\":[\"reported\",\"review-blocked\",\"escalated\"]},\"workType\":{\"enum\":[\"implementation\",\"test\"]},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"outcome\":{\"$ref\":\"#/$defs/resultOutcome\"},\"taskPackageSourceEvent\":{\"$ref\":\"#/$defs/sourceEvent\"},\"taskPackage\":{\"$ref\":\"#/$defs/reviewTaskPackage\"},\"targetResultSourceEvent\":{\"$ref\":\"#/$defs/sourceEvent\"},\"targetResult\":{\"$ref\":\"#/$defs/targetResult\"},\"priorReviewHistory\":{\"type\":\"array\",\"maxItems\":10000,\"items\":{\"$ref\":\"#/$defs/reviewHistoryEntry\"}},\"reviewUnitDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"currentDecision\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/currentDecision\"}]},\"resumptionBasis\":{\"$ref\":\"#/$defs/resumptionBasis\"},\"callback\":{\"$ref\":\"#/$defs/callbackStatus\"},\"targetCompletion\":{\"$ref\":\"#/$defs/targetCompletion\"},\"allowedDecisions\":{\"type\":\"array\",\"maxItems\":4,\"uniqueItems\":true,\"items\":{\"enum\":[\"accept\",\"rework\",\"blocked\",\"escalate\",\"request-another-attempt\"]}},\"testSteps\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"array\",\"minItems\":1,\"maxItems\":20,\"items\":{\"$ref\":\"#/$defs/stepView\"}}]},\"attemptScope\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"ordinal\",\"stepIds\"],\"properties\":{\"ordinal\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":10},\"stepIds\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"array\",\"minItems\":1,\"maxItems\":20,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/stepId\"}}]}}}]}},\"allOf\":[{\"if\":{\"properties\":{\"workType\":{\"const\":\"implementation\"}},\"required\":[\"workType\"]},\"then\":{\"properties\":{\"taskPackage\":{\"allOf\":[{\"$ref\":\"#/$defs/reviewTaskPackage\"},{\"type\":\"object\",\"properties\":{\"workType\":{\"const\":\"implementation\"}}}]},\"targetResult\":{\"allOf\":[{\"$ref\":\"#/$defs/targetResult\"},{\"type\":\"object\",\"properties\":{\"workType\":{\"const\":\"implementation\"}}}]},\"testSteps\":{\"type\":\"null\"},\"attemptScope\":{\"type\":\"null\"}}},\"else\":{\"properties\":{\"taskPackage\":{\"allOf\":[{\"$ref\":\"#/$defs/reviewTaskPackage\"},{\"type\":\"object\",\"properties\":{\"workType\":{\"const\":\"test\"}}}]},\"targetResult\":{\"allOf\":[{\"$ref\":\"#/$defs/targetResult\"},{\"type\":\"object\",\"properties\":{\"workType\":{\"const\":\"test\"}}}]},\"testSteps\":{\"type\":\"array\"},\"attemptScope\":{\"type\":\"object\"}}}},{\"if\":{\"properties\":{\"status\":{\"const\":\"reported\"}},\"required\":[\"status\"]},\"then\":{\"properties\":{\"currentDecision\":{\"type\":\"null\"},\"resumptionBasis\":{\"type\":\"null\"}}},\"else\":{\"properties\":{\"currentDecision\":{\"type\":\"object\"},\"resumptionBasis\":{\"type\":\"object\"}}}}]},\"eventStream\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"commitSequence\",\"streamRevision\",\"lastCommitDigest\",\"lastEventId\",\"lastEventDigest\",\"stateDigest\"],\"properties\":{\"commitSequence\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"lastCommitDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"lastEventId\":{\"$ref\":\"#/$defs/eventId\"},\"lastEventDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"targetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"delivery\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"generation\",\"fence\",\"outcomeDigest\",\"disposition\",\"readbackStatus\",\"observedAt\"],\"properties\":{\"generation\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":4},\"fence\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"claimId\",\"claimDigest\"],\"properties\":{\"claimId\":{\"$ref\":\"#/$defs/claimId\"},\"claimDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"outcomeDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"disposition\":{\"enum\":[\"accepted\",\"indeterminate\"]},\"readbackStatus\":{\"enum\":[\"confirmed\",\"pending\",\"unavailable\"]},\"observedAt\":{\"$ref\":\"#/$defs/utcInstant\"}}},\"stepId\":{\"type\":\"string\",\"pattern\":\"^ts-[1-9][0-9]?$\"},\"reviewTaskPackageStepId\":{\"type\":\"string\",\"pattern\":\"^ts-[1-9][0-9]?$\"},\"reviewTaskPackageSkillPath\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^skills/[a-z0-9]+(?:-[a-z0-9]+)*/SKILL\\\\.md$\"},\"reviewTaskPackageTestContractStep\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"stepId\",\"given\",\"when\",\"then\",\"requirementRef\"],\"properties\":{\"stepId\":{\"$ref\":\"#/$defs/reviewTaskPackageStepId\"},\"given\":{\"$ref\":\"#/$defs/reviewTaskPackageHumanText\"},\"when\":{\"$ref\":\"#/$defs/reviewTaskPackageHumanText\"},\"then\":{\"$ref\":\"#/$defs/reviewTaskPackageHumanText\"},\"requirementRef\":{\"$ref\":\"#/$defs/reviewTaskPackageRequirementRef\"}}},\"reviewTaskPackageTestContract\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"question\",\"objectBoundary\",\"steps\",\"environment\",\"allowedSkills\",\"setupPolicy\",\"maxAttempts\",\"stopConditions\"],\"properties\":{\"question\":{\"$ref\":\"#/$defs/reviewTaskPackageHumanText\"},\"objectBoundary\":{\"$ref\":\"#/$defs/reviewTaskPackageHumanText\"},\"steps\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":20,\"items\":{\"$ref\":\"#/$defs/reviewTaskPackageTestContractStep\"}},\"environment\":{\"$ref\":\"#/$defs/authorityMemberReference\"},\"allowedSkills\":{\"type\":\"array\",\"maxItems\":8,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/reviewTaskPackageSkillPath\"}},\"setupPolicy\":{\"enum\":[\"fresh-once\",\"fresh-per-attempt\",\"reuse-existing\"]},\"maxAttempts\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":10},\"stopConditions\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":8,\"items\":{\"$ref\":\"#/$defs/reviewTaskPackageHumanText\"}}}},\"reviewTaskPackageImplementationBaseline\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetTaskId\",\"taskPackageId\",\"taskPackageDigest\",\"repositoryId\",\"windowId\",\"targetResultId\",\"resultDigest\",\"targetReviewDecisionId\",\"decisionDigest\"],\"properties\":{\"targetTaskId\":{\"$ref\":\"#/$defs/reviewTaskPackageTargetTaskId\"},\"taskPackageId\":{\"$ref\":\"#/$defs/reviewTaskPackageTaskPackageId\"},\"taskPackageDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"repositoryId\":{\"$ref\":\"#/$defs/reviewTaskPackageRepositoryId\"},\"windowId\":{\"$ref\":\"#/$defs/reviewTaskPackageWindowId\"},\"targetResultId\":{\"$ref\":\"#/$defs/reviewTaskPackageTargetResultId\"},\"resultDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/reviewTaskPackageTargetReviewDecisionId\"},\"decisionDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"reviewTaskPackageImplementationBaselines\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/reviewTaskPackageImplementationBaseline\"}},\"reviewTaskPackageTestLineage\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"retestsTargetTaskId\",\"productDefectRemediationId\",\"authorizationDigest\"],\"properties\":{\"kind\":{\"const\":\"retest\"},\"retestsTargetTaskId\":{\"$ref\":\"#/$defs/reviewTaskPackageTargetTaskId\"},\"productDefectRemediationId\":{\"$ref\":\"#/$defs/reviewTaskPackageProductDefectRemediationId\"},\"authorizationDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}}]},\"reviewTaskPackageTargetResultId\":{\"type\":\"string\",\"pattern\":\"^target-result_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"reviewTaskPackageTargetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"reviewTaskPackageProductDefectRemediationId\":{\"type\":\"string\",\"pattern\":\"^product-defect-remediation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"evidenceKind\":{\"enum\":[\"hook-observation\",\"transcript\",\"test-output\",\"diff\",\"document\",\"link\",\"commit\"]},\"branchName\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":255,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$\"},\"failure\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"classification\",\"likelyOwner\",\"recommendedAction\"],\"properties\":{\"classification\":{\"enum\":[\"product-defect\",\"harness-defect\",\"environment\",\"flaky\",\"missing-evidence\",\"out-of-scope\",\"needs-decision\"]},\"likelyOwner\":{\"enum\":[\"implementation\",\"test\",\"environment\",\"user\"]},\"recommendedAction\":{\"$ref\":\"#/$defs/humanText\"}}},\"step\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"stepId\",\"observed\",\"evidence\",\"verdict\"],\"properties\":{\"stepId\":{\"$ref\":\"#/$defs/stepId\"},\"observed\":{\"$ref\":\"#/$defs/humanText\"},\"evidence\":{\"$ref\":\"#/$defs/evidenceRef\"},\"verdict\":{\"enum\":[\"pass\",\"fail\",\"blocked\",\"cannot-conclude\"]},\"failure\":{\"$ref\":\"#/$defs/failure\"}},\"allOf\":[{\"if\":{\"properties\":{\"verdict\":{\"const\":\"pass\"}},\"required\":[\"verdict\"]},\"then\":{\"properties\":{\"failure\":false}},\"else\":{\"required\":[\"failure\"],\"properties\":{\"failure\":{\"$ref\":\"#/$defs/failure\"}}}}]},\"demandEventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"recordId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":256,\"pattern\":\"^[A-Za-z0-9._:-]{1,256}$\"},\"escalation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"issue\",\"requirementRefs\",\"evidence\",\"options\",\"recommendation\"],\"properties\":{\"issue\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"requirementRefs\":{\"type\":\"array\",\"maxItems\":16,\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"recordDigest\",\"sectionAnchor\"],\"properties\":{\"recordDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"sectionAnchor\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":64,\"pattern\":\"^[a-z0-9]+(?:-[a-z0-9]+)*$\"}}}},\"evidence\":{\"type\":\"array\",\"maxItems\":16,\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"id\",\"digest\"],\"properties\":{\"kind\":{\"enum\":[\"target-result\",\"review-decision\",\"managed-evidence\",\"host-effect\"]},\"id\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128},\"digest\":{\"$ref\":\"#/$defs/sha256Digest\"}}}},\"options\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":4,\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"option\",\"impact\"],\"properties\":{\"option\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":1024,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"impact\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":2048,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"}}}},\"recommendation\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":4096,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"}}},\"remediation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"affectedTargets\",\"authorizationRationale\"],\"properties\":{\"affectedTargets\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetTaskId\",\"failedStepIds\",\"correctionObjective\"],\"properties\":{\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"failedStepIds\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":20,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/stepId\"}},\"correctionObjective\":{\"$ref\":\"#/$defs/humanText\"}}}},\"authorizationRationale\":{\"$ref\":\"#/$defs/humanText\"}}},\"testEscalation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"classification\"],\"properties\":{\"classification\":{\"enum\":[\"product-defect\",\"needs-decision\"]},\"remediation\":{\"$ref\":\"#/$defs/remediation\"},\"userDecision\":{\"$ref\":\"#/$defs/escalation\"}},\"allOf\":[{\"if\":{\"properties\":{\"classification\":{\"const\":\"product-defect\"}},\"required\":[\"classification\"]},\"then\":{\"required\":[\"remediation\"],\"properties\":{\"remediation\":{\"$ref\":\"#/$defs/remediation\"},\"userDecision\":false}},\"else\":{\"required\":[\"userDecision\"],\"properties\":{\"userDecision\":{\"$ref\":\"#/$defs/escalation\"},\"remediation\":false}}}]},\"resumption\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"previousDecisionId\",\"basis\",\"summary\"],\"properties\":{\"previousDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"basis\":{\"oneOf\":[{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\"],\"properties\":{\"kind\":{\"const\":\"condition-cleared\"}}},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"escalationEventId\"],\"properties\":{\"kind\":{\"const\":\"decision-recorded\"},\"escalationEventId\":{\"$ref\":\"#/$defs/demandEventId\"}}}]},\"summary\":{\"$ref\":\"#/$defs/humanText\"}}},\"callbackLanding\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"recordId\",\"landedAt\"],\"properties\":{\"recordId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":256,\"pattern\":\"^[A-Za-z0-9._:-]{1,256}$\"},\"landedAt\":{\"$ref\":\"#/$defs/utcInstant\"}}}]},\"targetCompletionRecord\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"recordId\",\"event\",\"observedAt\"],\"properties\":{\"recordId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":256,\"pattern\":\"^[A-Za-z0-9._:-]{1,256}$\"},\"event\":{\"enum\":[\"stop\",\"turn-complete\"]},\"observedAt\":{\"$ref\":\"#/$defs/utcInstant\"}}}]},\"currentDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"sourceEvent\",\"decision\"],\"properties\":{\"sourceEvent\":{\"$ref\":\"#/$defs/sourceEvent\"},\"decision\":{\"$ref\":\"#/$defs/reviewDecisionSummary\"}}},\"resumptionBasis\":{\"oneOf\":[{\"type\":\"null\"},{\"oneOf\":[{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\"],\"properties\":{\"kind\":{\"const\":\"condition-cleared\"}}},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"escalationEventId\",\"answered\"],\"properties\":{\"kind\":{\"const\":\"decision-recorded\"},\"escalationEventId\":{\"$ref\":\"#/$defs/demandEventId\"},\"answered\":{\"type\":\"boolean\"}}}]}]},\"callbackStatus\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"generation\",\"issuedAt\",\"landedRecordId\"],\"description\":\"wake-controller 回调的落地状态：由 Controller 会话的 user-prompt-submit 记录派生；silent 表示签发后超过静默阈值仍无记录。\",\"properties\":{\"status\":{\"enum\":[\"pending\",\"landed\",\"silent\",\"acknowledged\"]},\"generation\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":4},\"issuedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"landedRecordId\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/recordId\"}]}}},\"targetCompletion\":{\"oneOf\":[{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\"],\"properties\":{\"status\":{\"const\":\"pending\"}}},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"recordId\",\"event\",\"observedAt\"],\"properties\":{\"status\":{\"const\":\"confirmed\"},\"recordId\":{\"$ref\":\"#/$defs/recordId\"},\"event\":{\"enum\":[\"stop\",\"turn-complete\"]},\"observedAt\":{\"$ref\":\"#/$defs/utcInstant\"}}}]},\"stepView\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"stepId\",\"given\",\"when\",\"expected\",\"observed\",\"evidence\",\"verdict\",\"failure\",\"baseline\"],\"properties\":{\"stepId\":{\"$ref\":\"#/$defs/stepId\"},\"given\":{\"$ref\":\"#/$defs/humanText\"},\"when\":{\"$ref\":\"#/$defs/humanText\"},\"expected\":{\"$ref\":\"#/$defs/humanText\"},\"observed\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/humanText\"}]},\"evidence\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/evidenceRef\"}]},\"verdict\":{\"oneOf\":[{\"type\":\"null\"},{\"enum\":[\"pass\",\"fail\",\"blocked\",\"cannot-conclude\"]}]},\"failure\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/failure\"}]},\"baseline\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"attemptOrdinal\",\"targetTaskId\",\"observed\",\"evidence\"],\"properties\":{\"attemptOrdinal\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":10},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"observed\":{\"$ref\":\"#/$defs/humanText\"},\"evidence\":{\"$ref\":\"#/$defs/evidenceRef\"}}}]}}}}}");
