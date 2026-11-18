/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/result/target-result-v2.schema.json
 */

/**
 * Wakeflow 从当前任务包与投递处置事件权威补齐的不可变 implementation 或 Test TargetResult；文档版本 2 让报告可以是记录版本 1 或 2（ADR-0030），结果自己的记录形状没有变。
 */
export type WakeflowTargetResultV2 = ({
kind: "WakeflowTargetResult"
schemaVersion: 1
workType: ("implementation" | "test")
targetResultId: TargetResultId
programId: string
demandId: string
targetTaskId: string
deliveryId: TargetDeliveryId
taskPackage: TaskPackage
assignment: (ImplementationAssignment | TestAssignment)
delivery: Delivery
report: (WakeflowImplementationTargetResultReport | WakeflowImplementationTargetResultReportV2 | WakeflowTestTargetResultReport | WakeflowTestTargetResultReportV2)
testExecution?: TestExecution
resultDigest: WakeflowSha256DigestText
/**
 * 评审前被这份结果取代的上一份结果（同一投递、同一声明，R5）；没有取代时缺席。
 */
supersedes?: string
})
export type TargetResultId = string
export type TargetDeliveryId = string
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
export type ClaimId = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
export type RepositoryChange = ({
repositoryId: string
disposition: ("committed" | "left-uncommitted" | "no-changes")
/**
 * @maxItems 64
 */
commits: WakeflowGitObjectId[]
branch: (null | string)
})
/**
 * Git完整对象身份及其显式对象格式；支持SHA-1和SHA-256仓库。
 */
export type WakeflowGitObjectId = (Sha1 | Sha256)
export type RepositoryChange1 = ({
repositoryId: string
disposition: ("committed" | "left-uncommitted" | "no-changes")
/**
 * @maxItems 64
 */
commits: WakeflowGitObjectId[]
branch: (null | string)
})
/**
 * Test Agent 按测试合同逐步记录的执行结果陈述：每步 observed、证据、verdict 与失败分类；整体 verdict 由 Wakeflow 从步骤派生。
 */
export type WakeflowTestTargetResultReport = ({
kind: "WakeflowTestTargetResultReport"
schemaVersion: 1
outcome: ("completed" | "blocked" | "needs-review")
summary: string
/**
 * @maxItems 64
 */
evidenceLocators: EvidenceLocator2[]
/**
 * @maxItems 64
 */
verification: string[]
/**
 * @maxItems 64
 */
risks: string[]
reportedAt: WakeflowUtcInstantText
reportDigest: WakeflowSha256DigestText
/**
 * @maxItems 20
 */
steps: []|[Step]|[Step, Step]|[Step, Step, Step]|[Step, Step, Step, Step]|[Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
})
export type Step = ({
stepId: string
observed: string
evidence: EvidenceRef2
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: string
observed: string
evidence: EvidenceRef2
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: string
observed: string
evidence: EvidenceRef2
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: string
observed: string
evidence: EvidenceRef2
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: string
observed: string
evidence: EvidenceRef2
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: string
observed: string
evidence: EvidenceRef2
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: string
observed: string
evidence: EvidenceRef2
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: string
observed: string
evidence: EvidenceRef2
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: string
observed: string
evidence: EvidenceRef2
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: string
observed: string
evidence: EvidenceRef2
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: string
observed: string
evidence: EvidenceRef2
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: string
observed: string
evidence: EvidenceRef2
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: string
observed: string
evidence: EvidenceRef2
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: string
observed: string
evidence: EvidenceRef2
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: string
observed: string
evidence: EvidenceRef2
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: string
observed: string
evidence: EvidenceRef2
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: string
observed: string
evidence: EvidenceRef2
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: string
observed: string
evidence: EvidenceRef2
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: string
observed: string
evidence: EvidenceRef2
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: string
observed: string
evidence: EvidenceRef2
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
})
/**
 * Test Agent 按测试合同逐步记录的执行结果陈述：每步 observed、证据、verdict 与失败分类；整体 verdict 由 Wakeflow 从步骤派生（记录版本 2，ADR-0030）。
 */
export type WakeflowTestTargetResultReportV2 = ({
kind: "WakeflowTestTargetResultReport"
schemaVersion: 2
outcome: ("completed" | "blocked" | "needs-review")
summary: string
/**
 * @maxItems 64
 */
evidenceLocators: EvidenceLocator3[]
/**
 * @maxItems 64
 */
verification: string[]
/**
 * @maxItems 64
 */
risks: string[]
reportedAt: WakeflowUtcInstantText
reportDigest: WakeflowSha256DigestText
/**
 * @maxItems 20
 */
steps: []|[Step1]|[Step1, Step1]|[Step1, Step1, Step1]|[Step1, Step1, Step1, Step1]|[Step1, Step1, Step1, Step1, Step1]|[Step1, Step1, Step1, Step1, Step1, Step1]|[Step1, Step1, Step1, Step1, Step1, Step1, Step1]|[Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1]|[Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1]|[Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1]|[Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1]|[Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1]|[Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1]|[Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1]|[Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1]|[Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1]|[Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1]|[Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1]|[Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1]|[Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1, Step1]
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
/**
 * 任务包之外收到的指示；没有收到就是空数组，不省略。
 *
 * @maxItems 16
 */
outsideInstructions: []|[OutsideInstruction1]|[OutsideInstruction1, OutsideInstruction1]|[OutsideInstruction1, OutsideInstruction1, OutsideInstruction1]|[OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1]|[OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1]|[OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1]|[OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1]|[OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1]|[OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1]|[OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1]|[OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1]|[OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1]|[OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1]|[OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1]|[OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1]|[OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1, OutsideInstruction1]
})
export type Step1 = ({
stepId: string
observed: string
evidence: EvidenceRef3
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure1
} & {
stepId: string
observed: string
evidence: EvidenceRef3
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure1
} & {
stepId: string
observed: string
evidence: EvidenceRef3
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure1
} & {
stepId: string
observed: string
evidence: EvidenceRef3
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure1
} & {
stepId: string
observed: string
evidence: EvidenceRef3
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure1
} & {
stepId: string
observed: string
evidence: EvidenceRef3
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure1
} & {
stepId: string
observed: string
evidence: EvidenceRef3
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure1
} & {
stepId: string
observed: string
evidence: EvidenceRef3
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure1
} & {
stepId: string
observed: string
evidence: EvidenceRef3
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure1
} & {
stepId: string
observed: string
evidence: EvidenceRef3
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure1
} & {
stepId: string
observed: string
evidence: EvidenceRef3
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure1
} & {
stepId: string
observed: string
evidence: EvidenceRef3
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure1
} & {
stepId: string
observed: string
evidence: EvidenceRef3
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure1
} & {
stepId: string
observed: string
evidence: EvidenceRef3
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure1
} & {
stepId: string
observed: string
evidence: EvidenceRef3
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure1
} & {
stepId: string
observed: string
evidence: EvidenceRef3
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure1
} & {
stepId: string
observed: string
evidence: EvidenceRef3
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure1
} & {
stepId: string
observed: string
evidence: EvidenceRef3
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure1
} & {
stepId: string
observed: string
evidence: EvidenceRef3
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure1
} & {
stepId: string
observed: string
evidence: EvidenceRef3
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure1
})
export type TestAttemptId = string
export type StepId = string

export interface TaskPackage {
taskPackageId: string
ref: WakeflowPortableResourcePathText
digest: WakeflowSha256DigestText
}
export interface ImplementationAssignment {
repositoryId: string
windowId: string
}
export interface TestAssignment {
windowId: string
}
export interface Delivery {
generation: number
fence: {
claimId: ClaimId
claimDigest: WakeflowSha256DigestText
}
outcomeDigest: WakeflowSha256DigestText
disposition: ("accepted" | "indeterminate")
readbackStatus: ("confirmed" | "pending" | "unavailable")
observedAt: WakeflowUtcInstantText
}
/**
 * 目标Agent对一个implementation Target Task提交的严格业务结果陈述。
 */
export interface WakeflowImplementationTargetResultReport {
kind: "WakeflowImplementationTargetResultReport"
schemaVersion: 1
outcome: ("completed" | "blocked" | "needs-review")
summary: string
repositoryChange: RepositoryChange
/**
 * @maxItems 64
 */
evidenceLocators: EvidenceLocator[]
/**
 * @maxItems 64
 */
verification: string[]
/**
 * @maxItems 64
 */
risks: string[]
/**
 * @maxItems 32
 */
anchorEvidence: AnchorEvidence[]
reportedAt: WakeflowUtcInstantText
reportDigest: WakeflowSha256DigestText
}
export interface Sha1 {
algorithm: "sha1"
value: string
}
export interface Sha256 {
algorithm: "sha256"
value: string
}
export interface EvidenceLocator {
kind: ("hook-observation" | "transcript" | "test-output" | "diff" | "document" | "link" | "commit")
ref: WakeflowPortableResourcePathText
digest: WakeflowSha256DigestText
}
export interface AnchorEvidence {
anchorId: string
/**
 * @minItems 1
 * @maxItems 32
 */
evidenceRefs: [EvidenceRef, ...(EvidenceRef)[]]
}
export interface EvidenceRef {
ref: WakeflowPortableResourcePathText
digest: WakeflowSha256DigestText
}
/**
 * 目标Agent对一个implementation Target Task提交的严格业务结果陈述（记录版本 2，ADR-0030）。
 */
export interface WakeflowImplementationTargetResultReportV2 {
kind: "WakeflowImplementationTargetResultReport"
schemaVersion: 2
outcome: ("completed" | "blocked" | "needs-review")
summary: string
repositoryChange: RepositoryChange1
/**
 * @maxItems 64
 */
evidenceLocators: EvidenceLocator1[]
/**
 * @maxItems 64
 */
verification: string[]
/**
 * @maxItems 64
 */
risks: string[]
/**
 * @maxItems 32
 */
anchorEvidence: AnchorEvidence1[]
reportedAt: WakeflowUtcInstantText
reportDigest: WakeflowSha256DigestText
/**
 * 任务包里的每条验收锚点恰好一项。
 *
 * @maxItems 32
 */
anchorResults: AnchorResult[]
/**
 * 任务包之外收到的指示；没有收到就是空数组，不省略。
 *
 * @maxItems 16
 */
outsideInstructions: []|[OutsideInstruction]|[OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]
}
export interface EvidenceLocator1 {
kind: ("hook-observation" | "transcript" | "test-output" | "diff" | "document" | "link" | "commit")
ref: WakeflowPortableResourcePathText
digest: WakeflowSha256DigestText
}
export interface AnchorEvidence1 {
anchorId: string
/**
 * @minItems 1
 * @maxItems 32
 */
evidenceRefs: [EvidenceRef1, ...(EvidenceRef1)[]]
}
export interface EvidenceRef1 {
ref: WakeflowPortableResourcePathText
digest: WakeflowSha256DigestText
}
/**
 * 一条验收锚点的结论：passed 核对过且成立，failed 核对过且不成立，blocked 想核对但被挡住，not-run 没有核对。observed 是目标实际看到的事实。
 */
export interface AnchorResult {
anchorId: string
status: ("passed" | "failed" | "blocked" | "not-run")
observed: string
}
/**
 * 任务包之外收到的一条指示：谁给的、说了什么、怎么处理的。followed 是不改合同、照做了；declined 是与任务包冲突、没有照做；escalated 是停下来上报。
 */
export interface OutsideInstruction {
source: ("user" | "other-session" | "unknown")
summary: string
handling: ("followed" | "declined" | "escalated")
}
export interface EvidenceLocator2 {
kind: ("hook-observation" | "transcript" | "test-output" | "diff" | "document" | "link" | "commit")
ref: WakeflowPortableResourcePathText
digest: WakeflowSha256DigestText
}
export interface EvidenceRef2 {
ref: WakeflowPortableResourcePathText
digest: WakeflowSha256DigestText
}
export interface Failure {
classification: ("product-defect" | "harness-defect" | "environment" | "flaky" | "missing-evidence" | "out-of-scope" | "needs-decision")
likelyOwner: ("implementation" | "test" | "environment" | "user")
recommendedAction: string
}
export interface EvidenceLocator3 {
kind: ("hook-observation" | "transcript" | "test-output" | "diff" | "document" | "link" | "commit")
ref: WakeflowPortableResourcePathText
digest: WakeflowSha256DigestText
}
export interface EvidenceRef3 {
ref: WakeflowPortableResourcePathText
digest: WakeflowSha256DigestText
}
export interface Failure1 {
classification: ("product-defect" | "harness-defect" | "environment" | "flaky" | "missing-evidence" | "out-of-scope" | "needs-decision")
likelyOwner: ("implementation" | "test" | "environment" | "user")
recommendedAction: string
}
/**
 * 任务包之外收到的一条指示：谁给的、说了什么、怎么处理的。followed 是不改合同、照做了；declined 是与任务包冲突、没有照做；escalated 是停下来上报。
 */
export interface OutsideInstruction1 {
source: ("user" | "other-session" | "unknown")
summary: string
handling: ("followed" | "declined" | "escalated")
}
export interface TestExecution {
testAttemptId: TestAttemptId
ordinal: number
stepIds: (null | [StepId]|[StepId, StepId]|[StepId, StepId, StepId]|[StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId]|[StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId, StepId])
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
export const WAKEFLOW_TARGET_RESULT_V2_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:result:target-result:v2\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TARGET_RESULT_V2_SCHEMA\",\"title\":\"WakeflowTargetResultV2\",\"description\":\"Wakeflow 从当前任务包与投递处置事件权威补齐的不可变 implementation 或 Test TargetResult；文档版本 2 让报告可以是记录版本 1 或 2（ADR-0030），结果自己的记录形状没有变。\",\"$comment\":\"workType显式区分单仓库implementation结果与无repository mutation的Test结果；完整Result进入Demand Event Sourcing，Aggregate只保存review选择所需摘要。本记录是Controller review输入，不是自动acceptance或Test verdict。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"workType\",\"targetResultId\",\"programId\",\"demandId\",\"targetTaskId\",\"deliveryId\",\"taskPackage\",\"assignment\",\"delivery\",\"report\",\"resultDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTargetResult\"},\"schemaVersion\":{\"const\":1},\"workType\":{\"enum\":[\"implementation\",\"test\"]},\"targetResultId\":{\"$ref\":\"#/$defs/targetResultId\"},\"programId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/programId\"},\"demandId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/demandId\"},\"targetTaskId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/targetTaskId\"},\"deliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"},\"taskPackage\":{\"$ref\":\"#/$defs/taskPackage\"},\"assignment\":{\"oneOf\":[{\"$ref\":\"#/$defs/implementationAssignment\"},{\"$ref\":\"#/$defs/testAssignment\"}]},\"delivery\":{\"$ref\":\"#/$defs/delivery\"},\"report\":{\"oneOf\":[{\"$ref\":\"urn:wakeflow:governance:result:implementation-target-result-report:v1\"},{\"$ref\":\"urn:wakeflow:governance:result:implementation-target-result-report:v2\"},{\"$ref\":\"urn:wakeflow:governance:result:test-target-result-report:v1\"},{\"$ref\":\"urn:wakeflow:governance:result:test-target-result-report:v2\"}]},\"testExecution\":{\"$ref\":\"#/$defs/testExecution\"},\"resultDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"supersedes\":{\"$ref\":\"#/$defs/targetResultId\",\"description\":\"评审前被这份结果取代的上一份结果（同一投递、同一声明，R5）；没有取代时缺席。\"}},\"allOf\":[{\"if\":{\"properties\":{\"workType\":{\"const\":\"test\"}},\"required\":[\"workType\"]},\"then\":{\"required\":[\"testExecution\"],\"properties\":{\"assignment\":{\"$ref\":\"#/$defs/testAssignment\"},\"report\":{\"oneOf\":[{\"$ref\":\"urn:wakeflow:governance:result:test-target-result-report:v1\"},{\"$ref\":\"urn:wakeflow:governance:result:test-target-result-report:v2\"}]},\"testExecution\":{\"$ref\":\"#/$defs/testExecution\"}}},\"else\":{\"properties\":{\"assignment\":{\"$ref\":\"#/$defs/implementationAssignment\"},\"report\":{\"oneOf\":[{\"$ref\":\"urn:wakeflow:governance:result:implementation-target-result-report:v1\"},{\"$ref\":\"urn:wakeflow:governance:result:implementation-target-result-report:v2\"}]},\"testExecution\":false}}}],\"$defs\":{\"targetResultId\":{\"type\":\"string\",\"pattern\":\"^target-result_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetDeliveryId\":{\"type\":\"string\",\"pattern\":\"^target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"testAttemptId\":{\"type\":\"string\",\"pattern\":\"^test-attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"claimId\":{\"type\":\"string\",\"pattern\":\"^work-claim_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"taskPackage\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"taskPackageId\",\"ref\",\"digest\"],\"properties\":{\"taskPackageId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/taskPackageId\"},\"ref\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"digest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"implementationAssignment\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"repositoryId\",\"windowId\"],\"properties\":{\"repositoryId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/$defs/repositoryId\"},\"windowId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/$defs/windowId\"}}},\"testAssignment\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"windowId\"],\"properties\":{\"windowId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/$defs/windowId\"}}},\"testExecution\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"testAttemptId\",\"ordinal\",\"stepIds\"],\"properties\":{\"testAttemptId\":{\"$ref\":\"#/$defs/testAttemptId\"},\"ordinal\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":10},\"stepIds\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"array\",\"minItems\":1,\"maxItems\":20,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/stepId\"}}]}}},\"delivery\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"generation\",\"fence\",\"outcomeDigest\",\"disposition\",\"readbackStatus\",\"observedAt\"],\"properties\":{\"generation\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":4},\"fence\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"claimId\",\"claimDigest\"],\"properties\":{\"claimId\":{\"$ref\":\"#/$defs/claimId\"},\"claimDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"outcomeDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"disposition\":{\"enum\":[\"accepted\",\"indeterminate\"]},\"readbackStatus\":{\"enum\":[\"confirmed\",\"pending\",\"unavailable\"]},\"observedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"}}},\"stepId\":{\"type\":\"string\",\"pattern\":\"^ts-[1-9][0-9]?$\"}}}");
