/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/controller-target-review-decided-event-data-v1.schema.json
 */

/**
 * Controller基于精确Result Review Snapshot作出的单implementation Target审查决定：accept、rework、blocked 或 escalate（ADR-0012 D5）。
 */
export type WakeflowControllerImplementationReviewDecision = ({
[k: string]: unknown | undefined
} & {
anchorEvidence?: (null | [AnchorEvidence, ...(AnchorEvidence)[]])
kind: "WakeflowControllerImplementationReviewDecision"
schemaVersion: 1
targetReviewDecisionId: string
programId: string
demandId: string
targetTaskId: string
controllerWindowId: string
reviewed: Reviewed
decision: ("accept" | "rework" | "blocked" | "escalate")
assessment: Assessment
/**
 * @minItems 1
 * @maxItems 32
 */
independentChecks: [IndependentCheck, ...(IndependentCheck)[]]
rationale: string
blockingReasons: TextList
residualRisks: TextList
decidedAt: WakeflowUtcInstantText
decisionDigest: WakeflowSha256DigestText
escalation: (null | Escalation)
resumption: (null | Resumption)
callbackLanding: (null | {
recordId: string
landedAt: WakeflowUtcInstantText
})
targetCompletion: (null | {
recordId: string
event: ("stop" | "turn-complete")
observedAt: WakeflowUtcInstantText
})
})
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
/**
 * @maxItems 32
 */
export type TextList = string[]
/**
 * Controller基于精确Result Review Snapshot作出的单test Target审查决定：accept、request-another-attempt（附 stepIds）、blocked 或 escalate（附分类；product-defect 走授权返工，needs-decision 走用户决策）。
 */
export type WakeflowControllerTestReviewDecision = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowControllerTestReviewDecision"
schemaVersion: 1
targetReviewDecisionId: string
programId: string
demandId: string
targetTaskId: string
controllerWindowId: string
reviewed: Reviewed1
testExecution: TestExecution
decision: ("accept" | "request-another-attempt" | "blocked" | "escalate")
assessment: Assessment1
/**
 * @minItems 1
 * @maxItems 32
 */
independentChecks: [IndependentCheck1, ...(IndependentCheck1)[]]
rationale: string
blockingReasons: TextList1
residualRisks: TextList1
decidedAt: WakeflowUtcInstantText
decisionDigest: WakeflowSha256DigestText
stepIds: (null | [string]|[string, string]|[string, string, string]|[string, string, string, string]|[string, string, string, string, string]|[string, string, string, string, string, string]|[string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string])
escalation: (null | TestEscalation)
resumption: (null | Resumption1)
callbackLanding: (null | {
recordId: string
landedAt: WakeflowUtcInstantText
})
targetCompletion: (null | {
recordId: string
event: ("stop" | "turn-complete")
observedAt: WakeflowUtcInstantText
})
})
/**
 * @maxItems 32
 */
export type TextList1 = string[]
export type TestEscalation = ({
[k: string]: unknown | undefined
} & {
classification: ("product-defect" | "needs-decision")
remediation?: Remediation
userDecision?: Escalation1
})

/**
 * review.target-result-decided事件版本1的持久化数据。
 */
export interface WakeflowControllerTargetReviewDecidedEventDataV1 {
decision: (WakeflowControllerImplementationReviewDecision | WakeflowControllerTestReviewDecision)
}
export interface AnchorEvidence {
anchorId: string
/**
 * @minItems 1
 * @maxItems 16
 */
evidenceIds: [string]|[string, string]|[string, string, string]|[string, string, string, string]|[string, string, string, string, string]|[string, string, string, string, string, string]|[string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]
}
export interface Reviewed {
snapshotDigest: WakeflowSha256DigestText
reviewUnitDigest: WakeflowSha256DigestText
stateDigest: WakeflowSha256DigestText
streamRevision: number
taskPackageId: string
taskPackageDigest: WakeflowSha256DigestText
targetResultId: string
targetResultDigest: WakeflowSha256DigestText
targetResultOutcome: ("completed" | "blocked" | "needs-review")
targetResultReportedAt: WakeflowUtcInstantText
}
export interface Assessment {
requirementAlignment: ("aligned" | "mismatch" | "unresolved")
implementationQuality: ("satisfactory" | "defective" | "unverified")
}
export interface IndependentCheck {
checkId: string
method: string
outcome: ("passed" | "failed" | "inconclusive")
observation: string
}
export interface Escalation {
issue: string
/**
 * @maxItems 16
 */
requirementRefs: []|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]
/**
 * @maxItems 16
 */
evidence: []|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
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
export interface Resumption {
previousDecisionId: string
basis: ({
kind: "condition-cleared"
} | {
kind: "decision-recorded"
escalationEventId: string
})
summary: string
}
export interface Reviewed1 {
snapshotDigest: WakeflowSha256DigestText
reviewUnitDigest: WakeflowSha256DigestText
stateDigest: WakeflowSha256DigestText
streamRevision: number
taskPackageId: string
taskPackageDigest: WakeflowSha256DigestText
targetResultId: string
targetResultDigest: WakeflowSha256DigestText
targetResultOutcome: ("completed" | "blocked" | "needs-review")
targetResultReportedAt: WakeflowUtcInstantText
}
export interface TestExecution {
testAttemptId: string
}
export interface Assessment1 {
conclusion: ("satisfied" | "defect-observed" | "inconclusive")
evidenceSufficiency: ("sufficient" | "insufficient")
}
export interface IndependentCheck1 {
checkId: string
method: string
outcome: ("passed" | "failed" | "inconclusive")
observation: string
}
export interface Remediation {
/**
 * @minItems 1
 * @maxItems 32
 */
affectedTargets: [{
targetTaskId: string
/**
 * @minItems 1
 * @maxItems 20
 */
failedStepIds: [string]|[string, string]|[string, string, string]|[string, string, string, string]|[string, string, string, string, string]|[string, string, string, string, string, string]|[string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]
correctionObjective: string
}, ...({
targetTaskId: string
/**
 * @minItems 1
 * @maxItems 20
 */
failedStepIds: [string]|[string, string]|[string, string, string]|[string, string, string, string]|[string, string, string, string, string]|[string, string, string, string, string, string]|[string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]
correctionObjective: string
})[]]
authorizationRationale: string
}
export interface Escalation1 {
issue: string
/**
 * @maxItems 16
 */
requirementRefs: []|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]|[{
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}, {
recordDigest: WakeflowSha256DigestText
sectionAnchor: string
}]
/**
 * @maxItems 16
 */
evidence: []|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}]|[{
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
}, {
kind: ("target-result" | "review-decision" | "managed-evidence" | "host-effect")
id: string
digest: WakeflowSha256DigestText
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
export interface Resumption1 {
previousDecisionId: string
basis: ({
kind: "condition-cleared"
} | {
kind: "decision-recorded"
escalationEventId: string
})
summary: string
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
export const WAKEFLOW_CONTROLLER_TARGET_REVIEW_DECIDED_EVENT_DATA_V1_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:controller-target-review-decided-event-data:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_CONTROLLER_TARGET_REVIEW_DECIDED_EVENT_DATA_V1_SCHEMA\",\"title\":\"WakeflowControllerTargetReviewDecidedEventDataV1\",\"description\":\"review.target-result-decided事件版本1的持久化数据。\",\"$comment\":\"Event保存完整ControllerImplementationReviewDecision业务事实；Aggregate状态摘要与后续route不进入Event data。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"decision\"],\"properties\":{\"decision\":{\"oneOf\":[{\"$ref\":\"urn:wakeflow:governance:review:controller-implementation-review-decision:v1\"},{\"$ref\":\"urn:wakeflow:governance:review:controller-test-review-decision:v1\"}]}}}");
