/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/demand-aggregate-state.schema.json
 */

/**
 * 由 Demand domain event reducer 唯一生成的最小业务 Aggregate state。
 */
export type WakeflowDemandAggregateState = ({
[k: string]: unknown | undefined
} & {
artifactKind: "wakeflow-demand-aggregate-state"
schemaVersion: 1
demandId: DemandId
authorityDigest: WakeflowSha256DigestText
lifecycle: ("active" | "cancelled" | "completed")
/**
 * @maxItems 10000
 */
targetTasks: TargetTask[]
/**
 * @minItems 1
 * @maxItems 10000
 */
managedEvidence?: [ManagedEvidenceSummary, ...(ManagedEvidenceSummary)[]]
currentTestCard?: TestCard
pendingTestRetest?: PendingTestRetest
})
export type DemandId = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
export type TargetTask = ({
[k: string]: unknown | undefined
} & {
targetTaskId: TargetTaskId
taskPackageId: TaskPackageId
taskPackageDigest: WakeflowSha256DigestText
workType?: "test"
repositoryId?: RepositoryId
windowId: WindowId
commitExpectation?: ("commit" | "leave-uncommitted")
/**
 * @minItems 1
 * @maxItems 32
 */
acceptanceAnchorIds?: [AnchorId, ...(AnchorId)[]]
phase: ("planned" | "test-delivery-prepared" | "test-host-effect-claimed" | "test-host-effect-accepted" | "test-host-effect-indeterminate" | "test-host-effect-rejected" | "test-result-reported" | "test-accepted" | "test-another-attempt-requested" | "test-product-defect" | "test-review-blocked" | "delivery-prepared" | "host-effect-claimed" | "host-effect-accepted" | "host-effect-indeterminate" | "host-effect-rejected" | "result-reported" | "accepted" | "product-defect-rework-requested" | "rework-requested" | "redesign-requested" | "review-blocked")
currentDelivery?: (CurrentDelivery | TestCurrentDelivery | TestClaimedCurrentDelivery | TestObservedCurrentDelivery | TestResultCurrentDelivery | TestReviewedCurrentDelivery)
testCard?: TestCard
/**
 * @minItems 1
 * @maxItems 10
 */
testAttempts?: [TestAttemptState]|[TestAttemptState, TestAttemptState]|[TestAttemptState, TestAttemptState, TestAttemptState]|[TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState]|[TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState]|[TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState]|[TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState]|[TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState]|[TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState]|[TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState, TestAttemptState]
productDefectRemediation?: ProductDefectRemediation
})
export type TargetTaskId = string
export type TaskPackageId = string
export type RepositoryId = string
export type WindowId = string
export type AnchorId = string
export type TargetDeliveryId = string
export type BindingId = string
export type ClaimId = string
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
export type DemandEventId = string
export type DemandEventCommitId = string
export type TargetReviewDecisionId = string
/**
 * Controller为一次真实环境Test执行授权的逻辑attempt。
 */
export type WakeflowTestExecutionAttempt = ({
[k: string]: unknown | undefined
} & {
[k: string]: unknown | undefined
} & {
[k: string]: unknown | undefined
} & {
[k: string]: unknown | undefined
} & {
kind: "WakeflowTestExecutionAttempt"
schemaVersion: 1
testAttemptId: string
targetTaskId: string
testCard: TestCardTuple
ordinal: number
mode: ("initial" | "rerun")
environmentSetup: EnvironmentSetup
rerunSource?: RerunSource
})
export type CheckId = string
export type EvidenceId = string

export interface CurrentDelivery {
targetDeliveryId: TargetDeliveryId
intentDigest: WakeflowSha256DigestText
hostId: ("codex" | "claude-code")
bindingId: BindingId
workClaim?: WorkClaim
hostEffect?: HostEffect
targetResult?: TargetResult
reviewDecision?: ReviewDecision
}
export interface WorkClaim {
claimId: ClaimId
claimRef: WakeflowPortableResourcePathText
claimDigest: WakeflowSha256DigestText
claimedAt: WakeflowUtcInstantText
hostObservationAuthorityDigest: WakeflowSha256DigestText
claimEventId: DemandEventId
claimCommitId: DemandEventCommitId
claimEventStreamRevision: number
claimExpectedStateDigest: WakeflowSha256DigestText
}
export interface HostEffect {
observationDigest: WakeflowSha256DigestText
disposition: ("accepted" | "indeterminate" | "rejected-before-effect")
readbackStatus: ("confirmed" | "pending" | "unavailable")
claimHandling: ("retain" | "release-authorized")
observedAt: WakeflowUtcInstantText
}
export interface TargetResult {
targetResultId: string
resultDigest: WakeflowSha256DigestText
outcome: ("completed" | "blocked" | "needs-review")
reportedAt: WakeflowUtcInstantText
claimHandling: "release-authorized"
}
export interface ReviewDecision {
targetReviewDecisionId: TargetReviewDecisionId
decisionDigest: WakeflowSha256DigestText
decision: ("accept" | "blocked" | "redesign" | "rework")
controllerWindowId: WindowId
decidedAt: WakeflowUtcInstantText
}
export interface TestCurrentDelivery {
targetDeliveryId: TargetDeliveryId
intentDigest: WakeflowSha256DigestText
hostId: ("codex" | "claude-code")
bindingId: BindingId
testAttemptId: string
}
export interface TestClaimedCurrentDelivery {
targetDeliveryId: TargetDeliveryId
intentDigest: WakeflowSha256DigestText
hostId: ("codex" | "claude-code")
bindingId: BindingId
testAttemptId: string
workClaim: TestWorkClaim
}
export interface TestWorkClaim {
claimId: ClaimId
claimRef: WakeflowPortableResourcePathText
claimDigest: WakeflowSha256DigestText
claimedAt: WakeflowUtcInstantText
hostObservationAuthorityDigest: WakeflowSha256DigestText
claimEventId: DemandEventId
claimCommitId: DemandEventCommitId
claimEventStreamRevision: number
claimExpectedStateDigest: WakeflowSha256DigestText
testDispatchPacketDigest: WakeflowSha256DigestText
}
export interface TestObservedCurrentDelivery {
targetDeliveryId: TargetDeliveryId
intentDigest: WakeflowSha256DigestText
hostId: ("codex" | "claude-code")
bindingId: BindingId
testAttemptId: string
workClaim: TestWorkClaim
hostEffect: HostEffect
}
export interface TestResultCurrentDelivery {
targetDeliveryId: TargetDeliveryId
intentDigest: WakeflowSha256DigestText
hostId: ("codex" | "claude-code")
bindingId: BindingId
testAttemptId: string
workClaim: TestWorkClaim
hostEffect: HostEffect
targetResult: TargetResult
}
export interface TestReviewedCurrentDelivery {
targetDeliveryId: TargetDeliveryId
intentDigest: WakeflowSha256DigestText
hostId: ("codex" | "claude-code")
bindingId: BindingId
testAttemptId: string
workClaim: TestWorkClaim
hostEffect: HostEffect
targetResult: TargetResult
reviewDecision: TestReviewDecision
}
export interface TestReviewDecision {
targetReviewDecisionId: TargetReviewDecisionId
decisionDigest: WakeflowSha256DigestText
decision: ("accept" | "request-another-attempt" | "escalate-product-defect" | "blocked")
controllerWindowId: WindowId
decidedAt: WakeflowUtcInstantText
}
export interface TestCard {
testCardId: string
testCardDigest: WakeflowSha256DigestText
targetTaskId: TargetTaskId
testWindowId: WindowId
}
export interface TestAttemptState {
attempt: WakeflowTestExecutionAttempt
/**
 * @minItems 1
 * @maxItems 32
 */
deliveryAuthorizations: [TestDeliveryAuthorization, ...(TestDeliveryAuthorization)[]]
}
export interface TestCardTuple {
testCardId: string
testCardDigest: WakeflowSha256DigestText
}
export interface EnvironmentSetup {
policy: ("fresh-once" | "fresh-per-attempt" | "reuse-existing")
directive: ("prepare-fresh-environment" | "reuse-confirmed-environment")
}
export interface RerunSource {
previousAttemptId: string
previousResult: {
targetResultId: string
resultDigest: WakeflowSha256DigestText
}
reviewDecision: {
targetReviewDecisionId: string
decisionDigest: WakeflowSha256DigestText
}
}
export interface TestDeliveryAuthorization {
ordinal: number
targetDeliveryId: TargetDeliveryId
intentDigest: WakeflowSha256DigestText
preparedAt: WakeflowUtcInstantText
}
export interface ProductDefectRemediation {
productDefectRemediationId: string
authorizationDigest: WakeflowSha256DigestText
testReviewDecisionId: TargetReviewDecisionId
testReviewDecisionDigest: WakeflowSha256DigestText
/**
 * @minItems 1
 * @maxItems 32
 */
failedCheckIds: [CheckId, ...(CheckId)[]]
correctionObjective: string
authorizedAt: WakeflowUtcInstantText
}
export interface ManagedEvidenceSummary {
evidenceId: EvidenceId
manifestDigest: WakeflowSha256DigestText
payloadArtifactDigest: WakeflowSha256DigestText
}
export interface PendingTestRetest {
kind: "product-defect-retest"
previousTestCard: {
testCardId: string
testCardDigest: WakeflowSha256DigestText
}
testReviewDecision: {
targetReviewDecisionId: TargetReviewDecisionId
decisionDigest: WakeflowSha256DigestText
}
productDefectRemediation: {
productDefectRemediationId: string
authorizationDigest: WakeflowSha256DigestText
}
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
export const WAKEFLOW_DEMAND_AGGREGATE_STATE_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:aggregate-state:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_AGGREGATE_STATE_SCHEMA\",\"title\":\"WakeflowDemandAggregateState\",\"description\":\"由 Demand domain event reducer 唯一生成的最小业务 Aggregate state。\",\"$comment\":\"stream revision、event tail 与 snapshot metadata 不进入本状态；authorityDigest 是 TaskPackage 准入所需的 publication 派生事实。managedEvidence 只在首个Evidence Event后出现，并仅投影ID与双摘要selector；完整Manifest留在Event。currentTestCard 只指向当前测试合同；旧 Test Target 保留其 Card、attempt、Result 与 Decision 历史。pendingTestRetest 只投影已授权但尚未由新 Card 消费的一次复测，不复制完整 Authorization。Pod不以空占位字段提前进入状态模型。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"demandId\",\"authorityDigest\",\"lifecycle\",\"targetTasks\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-demand-aggregate-state\"},\"schemaVersion\":{\"const\":1},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"authorityDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"lifecycle\":{\"enum\":[\"active\",\"cancelled\",\"completed\"]},\"targetTasks\":{\"type\":\"array\",\"maxItems\":10000,\"items\":{\"$ref\":\"#/$defs/targetTask\"}},\"managedEvidence\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":10000,\"items\":{\"$ref\":\"#/$defs/managedEvidenceSummary\"}},\"currentTestCard\":{\"$ref\":\"#/$defs/testCard\"},\"pendingTestRetest\":{\"$ref\":\"#/$defs/pendingTestRetest\"}},\"allOf\":[{\"if\":{\"type\":\"object\",\"properties\":{\"lifecycle\":{\"const\":\"completed\"}},\"required\":[\"lifecycle\"]},\"then\":{\"type\":\"object\",\"properties\":{\"targetTasks\":{\"type\":\"array\",\"minItems\":1,\"items\":{\"type\":\"object\",\"allOf\":[{\"if\":{\"properties\":{\"workType\":{\"const\":\"test\"}},\"required\":[\"workType\"]},\"then\":{\"properties\":{\"phase\":{\"enum\":[\"test-accepted\",\"test-product-defect\"]}}},\"else\":{\"properties\":{\"phase\":{\"const\":\"accepted\"}}}}]}}}}}],\"$defs\":{\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"evidenceId\":{\"type\":\"string\",\"pattern\":\"^evidence_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"managedEvidenceSummary\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"evidenceId\",\"manifestDigest\",\"payloadArtifactDigest\"],\"properties\":{\"evidenceId\":{\"$ref\":\"#/$defs/evidenceId\"},\"manifestDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"payloadArtifactDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"taskPackageId\":{\"type\":\"string\",\"pattern\":\"^task-package_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"anchorId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"checkId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"targetTask\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetTaskId\",\"taskPackageId\",\"taskPackageDigest\",\"windowId\",\"phase\"],\"properties\":{\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"taskPackageId\":{\"$ref\":\"#/$defs/taskPackageId\"},\"taskPackageDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"workType\":{\"const\":\"test\"},\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"commitExpectation\":{\"enum\":[\"commit\",\"leave-uncommitted\"]},\"acceptanceAnchorIds\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/anchorId\"}},\"phase\":{\"enum\":[\"planned\",\"test-delivery-prepared\",\"test-host-effect-claimed\",\"test-host-effect-accepted\",\"test-host-effect-indeterminate\",\"test-host-effect-rejected\",\"test-result-reported\",\"test-accepted\",\"test-another-attempt-requested\",\"test-product-defect\",\"test-review-blocked\",\"delivery-prepared\",\"host-effect-claimed\",\"host-effect-accepted\",\"host-effect-indeterminate\",\"host-effect-rejected\",\"result-reported\",\"accepted\",\"product-defect-rework-requested\",\"rework-requested\",\"redesign-requested\",\"review-blocked\"]},\"currentDelivery\":{\"oneOf\":[{\"$ref\":\"#/$defs/currentDelivery\"},{\"$ref\":\"#/$defs/testCurrentDelivery\"},{\"$ref\":\"#/$defs/testClaimedCurrentDelivery\"},{\"$ref\":\"#/$defs/testObservedCurrentDelivery\"},{\"$ref\":\"#/$defs/testResultCurrentDelivery\"},{\"$ref\":\"#/$defs/testReviewedCurrentDelivery\"}]},\"testCard\":{\"$ref\":\"#/$defs/testCard\"},\"testAttempts\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":10,\"items\":{\"$ref\":\"#/$defs/testAttemptState\"}},\"productDefectRemediation\":{\"$ref\":\"#/$defs/productDefectRemediation\"}},\"allOf\":[{\"if\":{\"properties\":{\"phase\":{\"const\":\"test-host-effect-accepted\"}},\"required\":[\"phase\"]},\"then\":{\"properties\":{\"currentDelivery\":{\"type\":\"object\",\"properties\":{\"hostEffect\":{\"type\":\"object\",\"properties\":{\"disposition\":{\"const\":\"accepted\"},\"claimHandling\":{\"const\":\"retain\"}}}}}}}},{\"if\":{\"properties\":{\"phase\":{\"const\":\"test-host-effect-indeterminate\"}},\"required\":[\"phase\"]},\"then\":{\"properties\":{\"currentDelivery\":{\"type\":\"object\",\"properties\":{\"hostEffect\":{\"type\":\"object\",\"properties\":{\"disposition\":{\"const\":\"indeterminate\"},\"claimHandling\":{\"const\":\"retain\"}}}}}}}},{\"if\":{\"properties\":{\"phase\":{\"const\":\"test-host-effect-rejected\"}},\"required\":[\"phase\"]},\"then\":{\"properties\":{\"currentDelivery\":{\"type\":\"object\",\"properties\":{\"hostEffect\":{\"type\":\"object\",\"properties\":{\"disposition\":{\"const\":\"rejected-before-effect\"},\"claimHandling\":{\"const\":\"release-authorized\"}}}}}}}},{\"if\":{\"properties\":{\"workType\":{\"const\":\"test\"}},\"required\":[\"workType\"]},\"then\":{\"required\":[\"testCard\"],\"properties\":{\"testCard\":{\"$ref\":\"#/$defs/testCard\"},\"repositoryId\":false,\"commitExpectation\":false,\"acceptanceAnchorIds\":false,\"productDefectRemediation\":false,\"phase\":{\"enum\":[\"planned\",\"test-delivery-prepared\",\"test-host-effect-claimed\",\"test-host-effect-accepted\",\"test-host-effect-indeterminate\",\"test-host-effect-rejected\",\"test-result-reported\",\"test-accepted\",\"test-another-attempt-requested\",\"test-product-defect\",\"test-review-blocked\"]}}},\"else\":{\"required\":[\"repositoryId\",\"commitExpectation\",\"acceptanceAnchorIds\"],\"properties\":{\"workType\":false,\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"commitExpectation\":{\"enum\":[\"commit\",\"leave-uncommitted\"]},\"acceptanceAnchorIds\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/anchorId\"}},\"testCard\":false,\"testAttempts\":false,\"phase\":{\"enum\":[\"planned\",\"delivery-prepared\",\"host-effect-claimed\",\"host-effect-accepted\",\"host-effect-indeterminate\",\"host-effect-rejected\",\"result-reported\",\"accepted\",\"product-defect-rework-requested\",\"rework-requested\",\"redesign-requested\",\"review-blocked\"]}}}},{\"if\":{\"properties\":{\"phase\":{\"const\":\"product-defect-rework-requested\"}},\"required\":[\"phase\"]},\"then\":{\"required\":[\"productDefectRemediation\"],\"properties\":{\"workType\":false,\"productDefectRemediation\":{\"$ref\":\"#/$defs/productDefectRemediation\"}}},\"else\":{\"properties\":{\"productDefectRemediation\":false}}},{\"if\":{\"properties\":{\"workType\":{\"const\":\"test\"},\"phase\":{\"enum\":[\"test-accepted\",\"test-another-attempt-requested\",\"test-product-defect\",\"test-review-blocked\"]}},\"required\":[\"workType\",\"phase\"]},\"then\":{\"required\":[\"currentDelivery\",\"testAttempts\"],\"properties\":{\"currentDelivery\":{\"$ref\":\"#/$defs/testReviewedCurrentDelivery\"},\"testAttempts\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":10,\"items\":{\"$ref\":\"#/$defs/testAttemptState\"}}}}},{\"if\":{\"properties\":{\"workType\":{\"const\":\"test\"},\"phase\":{\"const\":\"test-result-reported\"}},\"required\":[\"workType\",\"phase\"]},\"then\":{\"required\":[\"currentDelivery\",\"testAttempts\"],\"properties\":{\"currentDelivery\":{\"$ref\":\"#/$defs/testResultCurrentDelivery\"},\"testAttempts\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":10,\"items\":{\"$ref\":\"#/$defs/testAttemptState\"}}}}},{\"if\":{\"properties\":{\"workType\":{\"const\":\"test\"},\"phase\":{\"enum\":[\"test-host-effect-accepted\",\"test-host-effect-indeterminate\",\"test-host-effect-rejected\"]}},\"required\":[\"workType\",\"phase\"]},\"then\":{\"required\":[\"currentDelivery\",\"testAttempts\"],\"properties\":{\"currentDelivery\":{\"$ref\":\"#/$defs/testObservedCurrentDelivery\"},\"testAttempts\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":10,\"items\":{\"$ref\":\"#/$defs/testAttemptState\"}}}}},{\"if\":{\"properties\":{\"workType\":{\"const\":\"test\"},\"phase\":{\"const\":\"planned\"}},\"required\":[\"workType\",\"phase\"]},\"then\":{\"properties\":{\"currentDelivery\":false,\"testAttempts\":false}}},{\"if\":{\"properties\":{\"workType\":{\"const\":\"test\"},\"phase\":{\"const\":\"test-host-effect-claimed\"}},\"required\":[\"workType\",\"phase\"]},\"then\":{\"required\":[\"currentDelivery\",\"testAttempts\"],\"properties\":{\"currentDelivery\":{\"$ref\":\"#/$defs/testClaimedCurrentDelivery\"},\"testAttempts\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":10,\"items\":{\"$ref\":\"#/$defs/testAttemptState\"}}}}},{\"if\":{\"properties\":{\"workType\":{\"const\":\"test\"},\"phase\":{\"const\":\"test-delivery-prepared\"}},\"required\":[\"workType\",\"phase\"]},\"then\":{\"required\":[\"currentDelivery\",\"testAttempts\"],\"properties\":{\"currentDelivery\":{\"$ref\":\"#/$defs/testCurrentDelivery\"},\"testAttempts\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":10,\"items\":{\"$ref\":\"#/$defs/testAttemptState\"}}}}},{\"if\":{\"properties\":{\"phase\":{\"const\":\"planned\"}},\"required\":[\"phase\"]},\"then\":{\"properties\":{\"currentDelivery\":false}}},{\"if\":{\"properties\":{\"phase\":{\"const\":\"delivery-prepared\"}},\"required\":[\"phase\"]},\"then\":{\"required\":[\"currentDelivery\"],\"properties\":{\"currentDelivery\":{\"type\":\"object\",\"properties\":{\"workClaim\":false,\"hostEffect\":false,\"targetResult\":false,\"reviewDecision\":false}}}}},{\"if\":{\"properties\":{\"phase\":{\"const\":\"host-effect-claimed\"}},\"required\":[\"phase\"]},\"then\":{\"required\":[\"currentDelivery\"],\"properties\":{\"currentDelivery\":{\"type\":\"object\",\"required\":[\"workClaim\"],\"properties\":{\"workClaim\":{},\"hostEffect\":false,\"targetResult\":false,\"reviewDecision\":false}}}}},{\"if\":{\"properties\":{\"phase\":{\"const\":\"host-effect-accepted\"}},\"required\":[\"phase\"]},\"then\":{\"required\":[\"currentDelivery\"],\"properties\":{\"currentDelivery\":{\"type\":\"object\",\"required\":[\"workClaim\",\"hostEffect\"],\"properties\":{\"workClaim\":{},\"targetResult\":false,\"reviewDecision\":false,\"hostEffect\":{\"type\":\"object\",\"required\":[\"disposition\",\"claimHandling\"],\"properties\":{\"disposition\":{\"const\":\"accepted\"},\"claimHandling\":{\"const\":\"retain\"}}}}}}}},{\"if\":{\"properties\":{\"phase\":{\"const\":\"host-effect-indeterminate\"}},\"required\":[\"phase\"]},\"then\":{\"required\":[\"currentDelivery\"],\"properties\":{\"currentDelivery\":{\"type\":\"object\",\"required\":[\"workClaim\",\"hostEffect\"],\"properties\":{\"workClaim\":{},\"targetResult\":false,\"reviewDecision\":false,\"hostEffect\":{\"type\":\"object\",\"required\":[\"disposition\",\"claimHandling\"],\"properties\":{\"disposition\":{\"const\":\"indeterminate\"},\"claimHandling\":{\"const\":\"retain\"}}}}}}}},{\"if\":{\"properties\":{\"phase\":{\"const\":\"host-effect-rejected\"}},\"required\":[\"phase\"]},\"then\":{\"required\":[\"currentDelivery\"],\"properties\":{\"currentDelivery\":{\"type\":\"object\",\"required\":[\"workClaim\",\"hostEffect\"],\"properties\":{\"workClaim\":{},\"targetResult\":false,\"reviewDecision\":false,\"hostEffect\":{\"type\":\"object\",\"required\":[\"disposition\",\"claimHandling\"],\"properties\":{\"disposition\":{\"const\":\"rejected-before-effect\"},\"claimHandling\":{\"const\":\"release-authorized\"}}}}}}}},{\"if\":{\"properties\":{\"phase\":{\"const\":\"result-reported\"}},\"required\":[\"phase\"]},\"then\":{\"required\":[\"currentDelivery\"],\"properties\":{\"currentDelivery\":{\"type\":\"object\",\"required\":[\"workClaim\",\"hostEffect\",\"targetResult\"],\"properties\":{\"workClaim\":{},\"hostEffect\":{\"type\":\"object\",\"required\":[\"disposition\"],\"properties\":{\"disposition\":{\"enum\":[\"accepted\",\"indeterminate\"]}}},\"targetResult\":{},\"reviewDecision\":false}}}}},{\"if\":{\"properties\":{\"phase\":{\"enum\":[\"accepted\",\"product-defect-rework-requested\",\"rework-requested\",\"redesign-requested\",\"review-blocked\"]}},\"required\":[\"phase\"]},\"then\":{\"required\":[\"currentDelivery\"],\"properties\":{\"currentDelivery\":{\"type\":\"object\",\"required\":[\"workClaim\",\"hostEffect\",\"targetResult\",\"reviewDecision\"],\"properties\":{\"workClaim\":{},\"hostEffect\":{\"type\":\"object\",\"required\":[\"disposition\"],\"properties\":{\"disposition\":{\"enum\":[\"accepted\",\"indeterminate\"]}}},\"targetResult\":{},\"reviewDecision\":{}}}}}},{\"if\":{\"properties\":{\"phase\":{\"const\":\"product-defect-rework-requested\"}},\"required\":[\"phase\"]},\"then\":{\"properties\":{\"currentDelivery\":{\"type\":\"object\",\"properties\":{\"reviewDecision\":{\"type\":\"object\",\"properties\":{\"decision\":{\"const\":\"accept\"}}}}}}}},{\"if\":{\"properties\":{\"phase\":{\"const\":\"accepted\"}},\"required\":[\"phase\"]},\"then\":{\"properties\":{\"currentDelivery\":{\"type\":\"object\",\"properties\":{\"reviewDecision\":{\"type\":\"object\",\"properties\":{\"decision\":{\"const\":\"accept\"}}}}}}}},{\"if\":{\"properties\":{\"phase\":{\"const\":\"rework-requested\"}},\"required\":[\"phase\"]},\"then\":{\"properties\":{\"currentDelivery\":{\"type\":\"object\",\"properties\":{\"reviewDecision\":{\"type\":\"object\",\"properties\":{\"decision\":{\"const\":\"rework\"}}}}}}}},{\"if\":{\"properties\":{\"phase\":{\"const\":\"redesign-requested\"}},\"required\":[\"phase\"]},\"then\":{\"properties\":{\"currentDelivery\":{\"type\":\"object\",\"properties\":{\"reviewDecision\":{\"type\":\"object\",\"properties\":{\"decision\":{\"const\":\"redesign\"}}}}}}}},{\"if\":{\"properties\":{\"phase\":{\"const\":\"review-blocked\"}},\"required\":[\"phase\"]},\"then\":{\"properties\":{\"currentDelivery\":{\"type\":\"object\",\"properties\":{\"reviewDecision\":{\"type\":\"object\",\"properties\":{\"decision\":{\"const\":\"blocked\"}}}}}}}}]},\"targetDeliveryId\":{\"type\":\"string\",\"pattern\":\"^target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"bindingId\":{\"type\":\"string\",\"pattern\":\"^window_binding_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"currentDelivery\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetDeliveryId\",\"intentDigest\",\"hostId\",\"bindingId\"],\"properties\":{\"targetDeliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"},\"intentDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"hostId\":{\"enum\":[\"codex\",\"claude-code\"]},\"bindingId\":{\"$ref\":\"#/$defs/bindingId\"},\"workClaim\":{\"$ref\":\"#/$defs/workClaim\"},\"hostEffect\":{\"$ref\":\"#/$defs/hostEffect\"},\"targetResult\":{\"$ref\":\"#/$defs/targetResult\"},\"reviewDecision\":{\"$ref\":\"#/$defs/reviewDecision\"}}},\"testCurrentDelivery\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetDeliveryId\",\"intentDigest\",\"hostId\",\"bindingId\",\"testAttemptId\"],\"properties\":{\"targetDeliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"},\"intentDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"hostId\":{\"enum\":[\"codex\",\"claude-code\"]},\"bindingId\":{\"$ref\":\"#/$defs/bindingId\"},\"testAttemptId\":{\"type\":\"string\",\"pattern\":\"^test-attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}},\"testClaimedCurrentDelivery\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetDeliveryId\",\"intentDigest\",\"hostId\",\"bindingId\",\"testAttemptId\",\"workClaim\"],\"properties\":{\"targetDeliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"},\"intentDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"hostId\":{\"enum\":[\"codex\",\"claude-code\"]},\"bindingId\":{\"$ref\":\"#/$defs/bindingId\"},\"testAttemptId\":{\"type\":\"string\",\"pattern\":\"^test-attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"workClaim\":{\"$ref\":\"#/$defs/testWorkClaim\"}}},\"testObservedCurrentDelivery\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetDeliveryId\",\"intentDigest\",\"hostId\",\"bindingId\",\"testAttemptId\",\"workClaim\",\"hostEffect\"],\"properties\":{\"targetDeliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"},\"intentDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"hostId\":{\"enum\":[\"codex\",\"claude-code\"]},\"bindingId\":{\"$ref\":\"#/$defs/bindingId\"},\"testAttemptId\":{\"type\":\"string\",\"pattern\":\"^test-attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"workClaim\":{\"$ref\":\"#/$defs/testWorkClaim\"},\"hostEffect\":{\"$ref\":\"#/$defs/hostEffect\"}}},\"testResultCurrentDelivery\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetDeliveryId\",\"intentDigest\",\"hostId\",\"bindingId\",\"testAttemptId\",\"workClaim\",\"hostEffect\",\"targetResult\"],\"properties\":{\"targetDeliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"},\"intentDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"hostId\":{\"enum\":[\"codex\",\"claude-code\"]},\"bindingId\":{\"$ref\":\"#/$defs/bindingId\"},\"testAttemptId\":{\"type\":\"string\",\"pattern\":\"^test-attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"workClaim\":{\"$ref\":\"#/$defs/testWorkClaim\"},\"hostEffect\":{\"$ref\":\"#/$defs/hostEffect\"},\"targetResult\":{\"$ref\":\"#/$defs/targetResult\"}}},\"testReviewedCurrentDelivery\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetDeliveryId\",\"intentDigest\",\"hostId\",\"bindingId\",\"testAttemptId\",\"workClaim\",\"hostEffect\",\"targetResult\",\"reviewDecision\"],\"properties\":{\"targetDeliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"},\"intentDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"hostId\":{\"enum\":[\"codex\",\"claude-code\"]},\"bindingId\":{\"$ref\":\"#/$defs/bindingId\"},\"testAttemptId\":{\"type\":\"string\",\"pattern\":\"^test-attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"workClaim\":{\"$ref\":\"#/$defs/testWorkClaim\"},\"hostEffect\":{\"$ref\":\"#/$defs/hostEffect\"},\"targetResult\":{\"$ref\":\"#/$defs/targetResult\"},\"reviewDecision\":{\"$ref\":\"#/$defs/testReviewDecision\"}}},\"testAttemptState\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"attempt\",\"deliveryAuthorizations\"],\"properties\":{\"attempt\":{\"$ref\":\"urn:wakeflow:governance:testing:test-execution-attempt:v1\"},\"deliveryAuthorizations\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/testDeliveryAuthorization\"}}}},\"testDeliveryAuthorization\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"ordinal\",\"targetDeliveryId\",\"intentDigest\",\"preparedAt\"],\"properties\":{\"ordinal\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":32},\"targetDeliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"},\"intentDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"preparedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"}}},\"claimId\":{\"type\":\"string\",\"pattern\":\"^window_work_claim_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"workClaim\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"claimId\",\"claimRef\",\"claimDigest\",\"claimedAt\",\"hostObservationAuthorityDigest\",\"claimEventId\",\"claimCommitId\",\"claimEventStreamRevision\",\"claimExpectedStateDigest\"],\"properties\":{\"claimId\":{\"$ref\":\"#/$defs/claimId\"},\"claimRef\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"claimDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"claimedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"hostObservationAuthorityDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"claimEventId\":{\"$ref\":\"#/$defs/demandEventId\"},\"claimCommitId\":{\"$ref\":\"#/$defs/demandEventCommitId\"},\"claimEventStreamRevision\":{\"type\":\"integer\",\"minimum\":4,\"maximum\":9007199254740991},\"claimExpectedStateDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"testWorkClaim\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"claimId\",\"claimRef\",\"claimDigest\",\"claimedAt\",\"hostObservationAuthorityDigest\",\"claimEventId\",\"claimCommitId\",\"claimEventStreamRevision\",\"claimExpectedStateDigest\",\"testDispatchPacketDigest\"],\"properties\":{\"claimId\":{\"$ref\":\"#/$defs/claimId\"},\"claimRef\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"claimDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"claimedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"hostObservationAuthorityDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"claimEventId\":{\"$ref\":\"#/$defs/demandEventId\"},\"claimCommitId\":{\"$ref\":\"#/$defs/demandEventCommitId\"},\"claimEventStreamRevision\":{\"type\":\"integer\",\"minimum\":4,\"maximum\":9007199254740991},\"claimExpectedStateDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"testDispatchPacketDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"demandEventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandEventCommitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"hostEffect\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"observationDigest\",\"disposition\",\"readbackStatus\",\"claimHandling\",\"observedAt\"],\"properties\":{\"observationDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"disposition\":{\"enum\":[\"accepted\",\"indeterminate\",\"rejected-before-effect\"]},\"readbackStatus\":{\"enum\":[\"confirmed\",\"pending\",\"unavailable\"]},\"claimHandling\":{\"enum\":[\"retain\",\"release-authorized\"]},\"observedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"}}},\"targetResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetResultId\",\"resultDigest\",\"outcome\",\"reportedAt\",\"claimHandling\"],\"properties\":{\"targetResultId\":{\"type\":\"string\",\"pattern\":\"^target-result_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"resultDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"outcome\":{\"enum\":[\"completed\",\"blocked\",\"needs-review\"]},\"reportedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"claimHandling\":{\"const\":\"release-authorized\"}}},\"targetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"reviewDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetReviewDecisionId\",\"decisionDigest\",\"decision\",\"controllerWindowId\",\"decidedAt\"],\"properties\":{\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"decisionDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"decision\":{\"enum\":[\"accept\",\"blocked\",\"redesign\",\"rework\"]},\"controllerWindowId\":{\"$ref\":\"#/$defs/windowId\"},\"decidedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"}}},\"productDefectRemediation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"productDefectRemediationId\",\"authorizationDigest\",\"testReviewDecisionId\",\"testReviewDecisionDigest\",\"failedCheckIds\",\"correctionObjective\",\"authorizedAt\"],\"properties\":{\"productDefectRemediationId\":{\"type\":\"string\",\"pattern\":\"^product-defect-remediation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"authorizationDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"testReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"testReviewDecisionDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"failedCheckIds\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/checkId\"}},\"correctionObjective\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"authorizedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"}}},\"testReviewDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetReviewDecisionId\",\"decisionDigest\",\"decision\",\"controllerWindowId\",\"decidedAt\"],\"properties\":{\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"decisionDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"decision\":{\"enum\":[\"accept\",\"request-another-attempt\",\"escalate-product-defect\",\"blocked\"]},\"controllerWindowId\":{\"$ref\":\"#/$defs/windowId\"},\"decidedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"}}},\"testCard\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"testCardId\",\"testCardDigest\",\"targetTaskId\",\"testWindowId\"],\"properties\":{\"testCardId\":{\"type\":\"string\",\"pattern\":\"^test-card_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"testCardDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"testWindowId\":{\"$ref\":\"#/$defs/windowId\"}}},\"pendingTestRetest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"previousTestCard\",\"testReviewDecision\",\"productDefectRemediation\"],\"properties\":{\"kind\":{\"const\":\"product-defect-retest\"},\"previousTestCard\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"testCardId\",\"testCardDigest\"],\"properties\":{\"testCardId\":{\"type\":\"string\",\"pattern\":\"^test-card_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"testCardDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"testReviewDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetReviewDecisionId\",\"decisionDigest\"],\"properties\":{\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"decisionDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"productDefectRemediation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"productDefectRemediationId\",\"authorizationDigest\"],\"properties\":{\"productDefectRemediationId\":{\"type\":\"string\",\"pattern\":\"^product-defect-remediation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"authorizationDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}}}}}}");
