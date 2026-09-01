/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/demand-event-sourcing-snapshot.schema.json
 */

/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
export type DemandId = string
export type EventId = string
/**
 * 由 Demand domain event reducer 唯一生成的最小业务 Aggregate state。
 */
export type WakeflowDemandAggregateState = ({
[k: string]: unknown | undefined
} & {
artifactKind: "wakeflow-demand-aggregate-state"
schemaVersion: 1
demandId: string
authorityDigest: WakeflowSha256DigestText
lifecycle: ("active" | "cancelled" | "completed")
/**
 * @maxItems 10000
 */
targetTasks: TargetTask[]
currentTestCard?: TestCard
pendingTestRetest?: PendingTestRetest
})
export type TargetTask = ({
[k: string]: unknown | undefined
} & {
targetTaskId: string
taskPackageId: string
taskPackageDigest: WakeflowSha256DigestText
workType?: "test"
repositoryId?: string
windowId: string
commitExpectation?: ("commit" | "leave-uncommitted")
/**
 * @minItems 1
 * @maxItems 32
 */
acceptanceAnchorIds?: [string, ...(string)[]]
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
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
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

/**
 * Demand Event Stream 某一 immutable commit boundary 的可删除 Aggregate checkpoint。
 */
export interface WakeflowDemandEventSourcingSnapshot {
artifactKind: "wakeflow-demand-event-sourcing-snapshot"
schemaVersion: 1
versionCompatibilityDigest: WakeflowSha256DigestText
demandId: DemandId
commitSequence: number
streamRevision: number
lastCommitDigest: WakeflowSha256DigestText
lastEventId: EventId
lastEventDigest: WakeflowSha256DigestText
state: WakeflowDemandAggregateState
stateDigest: WakeflowSha256DigestText
}
export interface CurrentDelivery {
targetDeliveryId: string
intentDigest: WakeflowSha256DigestText
hostId: ("codex" | "claude-code")
bindingId: string
workClaim?: WorkClaim
hostEffect?: HostEffect
targetResult?: TargetResult
reviewDecision?: ReviewDecision
}
export interface WorkClaim {
claimId: string
claimRef: WakeflowPortableResourcePathText
claimDigest: WakeflowSha256DigestText
claimedAt: WakeflowUtcInstantText
hostObservationAuthorityDigest: WakeflowSha256DigestText
claimEventId: string
claimCommitId: string
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
targetReviewDecisionId: string
decisionDigest: WakeflowSha256DigestText
decision: ("accept" | "blocked" | "redesign" | "rework")
controllerWindowId: string
decidedAt: WakeflowUtcInstantText
}
export interface TestCurrentDelivery {
targetDeliveryId: string
intentDigest: WakeflowSha256DigestText
hostId: ("codex" | "claude-code")
bindingId: string
testAttemptId: string
}
export interface TestClaimedCurrentDelivery {
targetDeliveryId: string
intentDigest: WakeflowSha256DigestText
hostId: ("codex" | "claude-code")
bindingId: string
testAttemptId: string
workClaim: TestWorkClaim
}
export interface TestWorkClaim {
claimId: string
claimRef: WakeflowPortableResourcePathText
claimDigest: WakeflowSha256DigestText
claimedAt: WakeflowUtcInstantText
hostObservationAuthorityDigest: WakeflowSha256DigestText
claimEventId: string
claimCommitId: string
claimEventStreamRevision: number
claimExpectedStateDigest: WakeflowSha256DigestText
testDispatchPacketDigest: WakeflowSha256DigestText
}
export interface TestObservedCurrentDelivery {
targetDeliveryId: string
intentDigest: WakeflowSha256DigestText
hostId: ("codex" | "claude-code")
bindingId: string
testAttemptId: string
workClaim: TestWorkClaim
hostEffect: HostEffect
}
export interface TestResultCurrentDelivery {
targetDeliveryId: string
intentDigest: WakeflowSha256DigestText
hostId: ("codex" | "claude-code")
bindingId: string
testAttemptId: string
workClaim: TestWorkClaim
hostEffect: HostEffect
targetResult: TargetResult
}
export interface TestReviewedCurrentDelivery {
targetDeliveryId: string
intentDigest: WakeflowSha256DigestText
hostId: ("codex" | "claude-code")
bindingId: string
testAttemptId: string
workClaim: TestWorkClaim
hostEffect: HostEffect
targetResult: TargetResult
reviewDecision: TestReviewDecision
}
export interface TestReviewDecision {
targetReviewDecisionId: string
decisionDigest: WakeflowSha256DigestText
decision: ("accept" | "request-another-attempt" | "escalate-product-defect" | "blocked")
controllerWindowId: string
decidedAt: WakeflowUtcInstantText
}
export interface TestCard {
testCardId: string
testCardDigest: WakeflowSha256DigestText
targetTaskId: string
testWindowId: string
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
targetDeliveryId: string
intentDigest: WakeflowSha256DigestText
preparedAt: WakeflowUtcInstantText
}
export interface ProductDefectRemediation {
productDefectRemediationId: string
authorizationDigest: WakeflowSha256DigestText
testReviewDecisionId: string
testReviewDecisionDigest: WakeflowSha256DigestText
/**
 * @minItems 1
 * @maxItems 32
 */
failedCheckIds: [string, ...(string)[]]
correctionObjective: string
authorizedAt: WakeflowUtcInstantText
}
export interface PendingTestRetest {
kind: "product-defect-retest"
previousTestCard: {
testCardId: string
testCardDigest: WakeflowSha256DigestText
}
testReviewDecision: {
targetReviewDecisionId: string
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
export const WAKEFLOW_DEMAND_EVENT_SOURCING_SNAPSHOT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-sourcing-snapshot:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_EVENT_SOURCING_SNAPSHOT_SCHEMA\",\"title\":\"WakeflowDemandEventSourcingSnapshot\",\"description\":\"Demand Event Stream 某一 immutable commit boundary 的可删除 Aggregate checkpoint。\",\"$comment\":\"正常 load 从最新兼容 snapshot 加载并只 replay 后续 commits；full audit 仍从 commit 1 验证完整 authority。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"versionCompatibilityDigest\",\"demandId\",\"commitSequence\",\"streamRevision\",\"lastCommitDigest\",\"lastEventId\",\"lastEventDigest\",\"state\",\"stateDigest\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-demand-event-sourcing-snapshot\"},\"schemaVersion\":{\"const\":1},\"versionCompatibilityDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"commitSequence\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"lastCommitDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"lastEventId\":{\"$ref\":\"#/$defs/eventId\"},\"lastEventDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"state\":{\"$ref\":\"urn:wakeflow:governance:demand:aggregate-state:v1\"},\"stateDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}},\"$defs\":{\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}");
