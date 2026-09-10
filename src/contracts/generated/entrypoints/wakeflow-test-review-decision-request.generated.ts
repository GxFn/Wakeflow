/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-test-review-decision-request.schema.json
 */

/**
 * Single-call Controller command recording one test TargetResult review decision (accept, request-another-attempt with stepIds, blocked, escalate with a classification) against an inspected Snapshot baseline; the same idempotency key and body replays the first result.
 */
export type WakeflowTestReviewDecisionRequestV1 = ({
[k: string]: unknown | undefined
} & {
root: WorkspaceRoot
demandId: DemandId
/**
 * Client-generated key binding this request to at most one commit.
 */
idempotencyKey: string
/**
 * Demand stream revision the caller observed; a stale value is rejected.
 */
expectedStreamRevision: number
targetResultId: TargetResultId
snapshotDigest: Sha256Digest
reviewUnitDigest: Sha256Digest
decision: ("accept" | "request-another-attempt" | "blocked" | "escalate")
assessment: Assessment
/**
 * @minItems 1
 * @maxItems 32
 */
independentChecks: [IndependentCheck, ...(IndependentCheck)[]]
rationale: HumanText
blockingReasons: TextList
residualRisks: TextList
resumption?: Resumption
/**
 * @minItems 1
 * @maxItems 20
 */
stepIds?: [StepId]|[StepId, StepId]|[StepId, StepId, StepId]|[StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]
escalation?: TestEscalation
})
/**
 * Absolute path of the existing Wakeflow workspace root.
 */
export type WorkspaceRoot = string
export type DemandId = string
export type TargetResultId = string
export type Sha256Digest = string
export type Token = string
export type HumanText = string
/**
 * @maxItems 32
 */
export type TextList = HumanText[]
export type TargetReviewDecisionId = string
export type DemandEventId = string
export type StepId = string
export type TestEscalation = ({
[k: string]: unknown | undefined
} & {
classification: ("product-defect" | "needs-decision")
remediation?: Remediation
userDecision?: Escalation
})
export type TargetTaskId = string

export interface Assessment {
conclusion: ("satisfied" | "defect-observed" | "inconclusive")
evidenceSufficiency: ("sufficient" | "insufficient")
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
export const WAKEFLOW_TEST_REVIEW_DECISION_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:test-review-decision-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TEST_REVIEW_DECISION_REQUEST_SCHEMA\",\"title\":\"WakeflowTestReviewDecisionRequestV1\",\"description\":\"Single-call Controller command recording one test TargetResult review decision (accept, request-another-attempt with stepIds, blocked, escalate with a classification) against an inspected Snapshot baseline; the same idempotency key and body replays the first result.\",\"$comment\":\"escalate{product-defect} carries the remediation mapping and appends the product-defect remediation authorization in the same commit; escalate{needs-decision} carries the user decision request and appends the Demand escalation event. Admissibility follows the failure classifications of the reported steps.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"demandId\",\"idempotencyKey\",\"expectedStreamRevision\",\"targetResultId\",\"snapshotDigest\",\"reviewUnitDigest\",\"decision\",\"assessment\",\"independentChecks\",\"rationale\",\"blockingReasons\",\"residualRisks\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"idempotencyKey\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9._:-]+$\",\"description\":\"Client-generated key binding this request to at most one commit.\"},\"expectedStreamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991,\"description\":\"Demand stream revision the caller observed; a stale value is rejected.\"},\"targetResultId\":{\"$ref\":\"#/$defs/targetResultId\"},\"snapshotDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"reviewUnitDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"decision\":{\"enum\":[\"accept\",\"request-another-attempt\",\"blocked\",\"escalate\"]},\"assessment\":{\"$ref\":\"#/$defs/assessment\"},\"independentChecks\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/independentCheck\"}},\"rationale\":{\"$ref\":\"#/$defs/humanText\"},\"blockingReasons\":{\"$ref\":\"#/$defs/textList\"},\"residualRisks\":{\"$ref\":\"#/$defs/textList\"},\"resumption\":{\"$ref\":\"#/$defs/resumption\"},\"stepIds\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":20,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/stepId\"}},\"escalation\":{\"$ref\":\"#/$defs/testEscalation\"}},\"allOf\":[{\"if\":{\"properties\":{\"decision\":{\"const\":\"escalate\"}},\"required\":[\"decision\"]},\"then\":{\"required\":[\"escalation\"],\"properties\":{\"escalation\":{\"$ref\":\"#/$defs/testEscalation\"},\"stepIds\":false}},\"else\":{\"properties\":{\"escalation\":false}}},{\"if\":{\"properties\":{\"decision\":{\"const\":\"request-another-attempt\"}},\"required\":[\"decision\"]},\"then\":{\"required\":[\"stepIds\"],\"properties\":{\"stepIds\":{\"type\":\"array\"}}},\"else\":{\"properties\":{\"stepIds\":false}}}],\"$defs\":{\"workspaceRoot\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetResultId\":{\"type\":\"string\",\"pattern\":\"^target-result_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandEventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"humanText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"token\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"textList\":{\"type\":\"array\",\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/humanText\"}},\"independentCheck\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"checkId\",\"method\",\"outcome\",\"observation\"],\"properties\":{\"checkId\":{\"$ref\":\"#/$defs/token\"},\"method\":{\"$ref\":\"#/$defs/humanText\"},\"outcome\":{\"enum\":[\"passed\",\"failed\",\"inconclusive\"]},\"observation\":{\"$ref\":\"#/$defs/humanText\"}}},\"stepId\":{\"type\":\"string\",\"pattern\":\"^ts-[1-9][0-9]?$\"},\"escalation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"issue\",\"requirementRefs\",\"evidence\",\"options\",\"recommendation\"],\"properties\":{\"issue\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"requirementRefs\":{\"type\":\"array\",\"maxItems\":16,\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"recordDigest\",\"sectionAnchor\"],\"properties\":{\"recordDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"sectionAnchor\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":64,\"pattern\":\"^[a-z0-9]+(?:-[a-z0-9]+)*$\"}}}},\"evidence\":{\"type\":\"array\",\"maxItems\":16,\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"id\",\"digest\"],\"properties\":{\"kind\":{\"enum\":[\"target-result\",\"review-decision\",\"managed-evidence\",\"host-effect\"]},\"id\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128},\"digest\":{\"$ref\":\"#/$defs/sha256Digest\"}}}},\"options\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":4,\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"option\",\"impact\"],\"properties\":{\"option\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":1024,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"impact\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":2048,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"}}}},\"recommendation\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":4096,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"}}},\"resumption\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"previousDecisionId\",\"basis\",\"summary\"],\"properties\":{\"previousDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"basis\":{\"oneOf\":[{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\"],\"properties\":{\"kind\":{\"const\":\"condition-cleared\"}}},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"escalationEventId\"],\"properties\":{\"kind\":{\"const\":\"decision-recorded\"},\"escalationEventId\":{\"$ref\":\"#/$defs/demandEventId\"}}}]},\"summary\":{\"$ref\":\"#/$defs/humanText\"}}},\"assessment\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"conclusion\",\"evidenceSufficiency\"],\"properties\":{\"conclusion\":{\"enum\":[\"satisfied\",\"defect-observed\",\"inconclusive\"]},\"evidenceSufficiency\":{\"enum\":[\"sufficient\",\"insufficient\"]}}},\"remediation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"affectedTargets\",\"authorizationRationale\"],\"properties\":{\"affectedTargets\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetTaskId\",\"failedStepIds\",\"correctionObjective\"],\"properties\":{\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"failedStepIds\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":20,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/stepId\"}},\"correctionObjective\":{\"$ref\":\"#/$defs/humanText\"}}}},\"authorizationRationale\":{\"$ref\":\"#/$defs/humanText\"}}},\"testEscalation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"classification\"],\"properties\":{\"classification\":{\"enum\":[\"product-defect\",\"needs-decision\"]},\"remediation\":{\"$ref\":\"#/$defs/remediation\"},\"userDecision\":{\"$ref\":\"#/$defs/escalation\"}},\"allOf\":[{\"if\":{\"properties\":{\"classification\":{\"const\":\"product-defect\"}},\"required\":[\"classification\"]},\"then\":{\"required\":[\"remediation\"],\"properties\":{\"remediation\":{\"$ref\":\"#/$defs/remediation\"},\"userDecision\":false}},\"else\":{\"required\":[\"userDecision\"],\"properties\":{\"userDecision\":{\"$ref\":\"#/$defs/escalation\"},\"remediation\":false}}}]}}}");
