/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-status-result.schema.json
 */

export type UtcInstant = string
export type ProgramId = string
export type SingleLineText = string
export type Sha256Digest = string
export type Count = number
export type DomainStatus = ("observed" | "unavailable")
export type NullableCode = (null | Code)
export type Code = string
export type RequirementId = string
export type DemandId = string
export type NullableSingleLineText = (null | SingleLineText)
export type DemandType = ("requirement" | "bug" | "supplement" | "research")
export type PodId = string
export type Token = string
export type NullableToolName = (null | string)
export type WindowId = string
export type HostId = ("codex" | "claude-code")
export type BindingId = string
export type DeliveryId = string
export type ClaimId = string
export type TargetTaskId = string
export type RepositoryId = string
export type NullableBranch = (null | string)
export type PortableResourcePath = string
export type DemandEventId = string
export type Frontier = (DemandFrontier | ImplementationFrontier | TestFrontier)
export type TaskPackageId = string
export type Blocker = ({
kind: "research-evidence-missing"
owner: "demand-lifecycle"
} | {
kind: "awaiting-decision"
owner: "user"
escalationEventId: DemandEventId
} | {
kind: "external-condition"
owner: ("controller-implementation-review" | "controller-test-review")
targetTaskId: TargetTaskId
targetReviewDecisionId: string
decisionDigest: Sha256Digest
})

/**
 * wakeflow_status 的结果：一次观察派生的工作区定向投影——总体状态、配置摘要、看板摘要、活动 Demand、窗口与工作声明、pod、仓库指针事实、hook 通道、已接受但分支仍在的结果、投影目标、生效阈值与下一步；带 demandId 时附该 Demand 的 Controller Route 或归档回执。不含私有路径、句柄与摘要之外的内容。
 */
export interface WakeflowStatusResultV1 {
kind: "WakeflowStatus"
schemaVersion: 1
tool: "wakeflow_status"
observedAt: UtcInstant
overall: ("maintenance" | "blocked" | "degraded" | "active" | "idle")
config: {
programId: ProgramId
displayName: SingleLineText
language: ("en" | "zh-Hans")
configDigest: Sha256Digest
pods: Count
windows: Count
repositories: Count
}
board: {
status: DomainStatus
issue: NullableCode
counts: {
pending: Count
parked: Count
claimed: Count
withdrawn: Count
archived: Count
}
/**
 * @maxItems 64
 */
pending: {
requirementId: RequirementId
title: SingleLineText
priority: ("P0" | "P1" | "P2" | "P3")
}[]
skipped: Count
}
/**
 * @maxItems 256
 */
demands: DemandSummary[]
/**
 * @maxItems 512
 */
windows: WindowSummary[]
/**
 * @maxItems 512
 */
claims: ClaimSummary[]
/**
 * @maxItems 64
 */
pods: PodSummary[]
/**
 * @maxItems 64
 */
repositories: RepositorySummary[]
/**
 * @maxItems 2
 */
hooks: []|[HookChannel]|[HookChannel, HookChannel]
/**
 * @maxItems 256
 */
unmergedAccepted: AcceptedBranch[]
projection: {
status: ("current" | "stale" | "missing" | "unsafe" | "unavailable")
/**
 * @maxItems 1024
 */
targets: {
resourcePath: PortableResourcePath
status: ("current" | "missing" | "stale" | "unsafe")
reason: NullableCode
}[]
}
policy: {
deliveryLandingSilenceMilliseconds: Count
deliveryRearmLimit: Count
workClaimGenerationLimit: Count
workClaimRecoveryWindowMilliseconds: Count
targetResultCallbackSilenceMilliseconds: Count
targetResultCallbackGenerationLimit: Count
demandReworkEscalationThreshold: Count
}
route: (null | Route)
archive: (null | ArchiveReceipt)
next: NextProjection
/**
 * @maxItems 64
 */
nextActions: {
owner: ("controller" | "target" | "test" | "user" | "none")
tool: NullableToolName
reason: Code
subject: NullableCode
}[]
}
export interface DemandSummary {
demandId: DemandId
status: DomainStatus
issue: NullableCode
title: NullableSingleLineText
demandType: (null | DemandType)
podId: (null | PodId)
lifecycle: (null | ("active" | "cancelled" | "completed"))
disposition: (null | ("work-available" | "blocked" | "terminal" | "awaiting-decision"))
frontier: (null | Token)
owner: (null | ("controller" | "target" | "test" | "user" | "none"))
suggestedTool: NullableToolName
blockerCount: Count
streamRevision: (null | Count)
}
export interface WindowSummary {
windowId: WindowId
podId: PodId
role: ("controller" | "design" | "test" | "product")
identity: ("registered" | "unregistered" | "unobserved")
hostId: (null | HostId)
bindingId: (null | BindingId)
claim: {
status: ("free" | "held")
demandId: (null | DemandId)
deliveryId: (null | DeliveryId)
generation: (null | Count)
}
lastObservation: (null | {
event: ("session-start" | "user-prompt-submit" | "stop" | "session-end" | "turn-complete")
recordedAt: UtcInstant
})
}
export interface ClaimSummary {
windowId: WindowId
claimId: ClaimId
demandId: DemandId
targetTaskId: TargetTaskId
deliveryId: DeliveryId
generation: number
claimedAt: UtcInstant
orphan: boolean
}
export interface PodSummary {
podId: PodId
name: SingleLineText
placement: ("primary" | "worktree")
lifecycle: ("open" | "closing")
state: ("creating" | "ready" | "closing" | "closed" | "unobserved")
activeDemandId: (null | DemandId)
windows: {
total: Count
bound: Count
}
/**
 * @maxItems 64
 */
worktrees: {
repositoryId: RepositoryId
receipt: ("absent" | "present" | "checkout-missing")
disposal: (null | DisposalGuidance)
}[]
}
export interface DisposalGuidance {
suggested: SingleLineText
alternative: SingleLineText
}
export interface RepositorySummary {
repositoryId: RepositoryId
status: DomainStatus
issue: NullableCode
head: (null | string)
branch: NullableBranch
detached: boolean
branches: Count
/**
 * @maxItems 64
 */
worktrees: {
name: SingleLineText
branch: NullableBranch
prunable: boolean
}[]
}
export interface HookChannel {
hostId: HostId
status: DomainStatus
issue: NullableCode
directory: ("absent" | "private" | "mode")
records: Count
skipped: Count
}
export interface AcceptedBranch {
demandId: DemandId
targetTaskId: TargetTaskId
repositoryId: RepositoryId
branch: string
commit: string
acceptedAt: UtcInstant
repositoryObserved: boolean
}
export interface Route {
kind: "WakeflowDemandControllerRoute"
schemaVersion: 1
programId: ProgramId
demandId: DemandId
demandType: DemandType
lifecycle: ("active" | "cancelled" | "completed")
authorityDigest: Sha256Digest
observedEventStream: ObservedEventStream
reviewSnapshotDigest: Sha256Digest
postAcceptanceRouteDigest?: Sha256Digest
disposition: ("work-available" | "blocked" | "terminal" | "awaiting-decision")
/**
 * @maxItems 10000
 */
frontiers: Frontier[]
/**
 * @maxItems 10000
 */
blockers: Blocker[]
routeDigest: Sha256Digest
}
export interface ObservedEventStream {
streamRevision: number
stateDigest: Sha256Digest
lastEventId: DemandEventId
lastEventDigest: Sha256Digest
}
export interface DemandFrontier {
scope: "demand"
kind: ("implementation-task-planning" | "research-completion-required" | "demand-completion-preflight" | "test-task-planning" | "decision-required")
owner: ("target-task-planning" | "demand-lifecycle" | "demand-completion" | "test-task-planning" | "user")
}
export interface ImplementationFrontier {
scope: "target"
kind: ("implementation-delivery-planning" | "implementation-host-effect-execution" | "implementation-target-result-import" | "implementation-host-effect-rearm" | "implementation-result-review" | "implementation-review-blocked")
owner: ("target-delivery-preparation" | "agent-host" | "target-result-import" | "target-host-effect-rearm" | "controller-implementation-review")
target: ImplementationTarget
}
export interface ImplementationTarget {
workType: "implementation"
targetTaskId: TargetTaskId
taskPackageId: TaskPackageId
taskPackageDigest: Sha256Digest
repositoryId: RepositoryId
windowId: WindowId
phase: ("planned" | "delivery-prepared" | "host-effect-accepted" | "host-effect-indeterminate" | "host-effect-rejected" | "result-reported" | "product-defect-rework-requested" | "rework-requested" | "escalated" | "review-blocked" | "superseded")
}
export interface TestFrontier {
scope: "target"
kind: ("test-delivery-planning" | "test-host-effect-execution" | "test-target-result-import" | "test-result-review" | "test-delivery-rerun-planning" | "test-review-blocked" | "test-host-effect-rearm")
owner: ("test-delivery-preparation" | "agent-host" | "target-result-import" | "controller-test-review" | "target-host-effect-rearm")
target: TestTarget
}
export interface TestTarget {
workType: "test"
targetTaskId: TargetTaskId
taskPackageId: TaskPackageId
taskPackageDigest: Sha256Digest
windowId: WindowId
phase: ("planned" | "test-delivery-prepared" | "test-host-effect-accepted" | "test-host-effect-indeterminate" | "test-host-effect-rejected" | "test-result-reported" | "test-another-attempt-requested" | "test-product-defect" | "test-review-blocked" | "test-escalated")
}
export interface ArchiveReceipt {
demandId: DemandId
outcome: ("completed" | "cancelled")
archiveRef: PortableResourcePath
archivedAt: UtcInstant
terminalEvent: {
eventId: DemandEventId
streamRevision: number
}
manifestDigest: Sha256Digest
}
export interface NextProjection {
frontier: (null | Token)
owner: ("controller" | "target" | "test" | "user" | "none")
suggestedTool: NullableToolName
/**
 * @maxItems 64
 */
blockers: Code[]
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
export const WAKEFLOW_STATUS_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:status-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_STATUS_RESULT_SCHEMA\",\"title\":\"WakeflowStatusResultV1\",\"description\":\"wakeflow_status 的结果：一次观察派生的工作区定向投影——总体状态、配置摘要、看板摘要、活动 Demand、窗口与工作声明、pod、仓库指针事实、hook 通道、已接受但分支仍在的结果、投影目标、生效阈值与下一步；带 demandId 时附该 Demand 的 Controller Route 或归档回执。不含私有路径、句柄与摘要之外的内容。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"observedAt\",\"overall\",\"config\",\"board\",\"demands\",\"windows\",\"claims\",\"pods\",\"repositories\",\"hooks\",\"unmergedAccepted\",\"projection\",\"policy\",\"route\",\"archive\",\"next\",\"nextActions\"],\"properties\":{\"kind\":{\"const\":\"WakeflowStatus\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_status\"},\"observedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"overall\":{\"enum\":[\"maintenance\",\"blocked\",\"degraded\",\"active\",\"idle\"]},\"config\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"programId\",\"displayName\",\"language\",\"configDigest\",\"pods\",\"windows\",\"repositories\"],\"properties\":{\"programId\":{\"$ref\":\"#/$defs/programId\"},\"displayName\":{\"$ref\":\"#/$defs/singleLineText\"},\"language\":{\"enum\":[\"en\",\"zh-Hans\"]},\"configDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"pods\":{\"$ref\":\"#/$defs/count\"},\"windows\":{\"$ref\":\"#/$defs/count\"},\"repositories\":{\"$ref\":\"#/$defs/count\"}}},\"board\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"issue\",\"counts\",\"pending\",\"skipped\"],\"properties\":{\"status\":{\"$ref\":\"#/$defs/domainStatus\"},\"issue\":{\"$ref\":\"#/$defs/nullableCode\"},\"counts\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"pending\",\"parked\",\"claimed\",\"withdrawn\",\"archived\"],\"properties\":{\"pending\":{\"$ref\":\"#/$defs/count\"},\"parked\":{\"$ref\":\"#/$defs/count\"},\"claimed\":{\"$ref\":\"#/$defs/count\"},\"withdrawn\":{\"$ref\":\"#/$defs/count\"},\"archived\":{\"$ref\":\"#/$defs/count\"}}},\"pending\":{\"type\":\"array\",\"maxItems\":64,\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"requirementId\",\"title\",\"priority\"],\"properties\":{\"requirementId\":{\"$ref\":\"#/$defs/requirementId\"},\"title\":{\"$ref\":\"#/$defs/singleLineText\"},\"priority\":{\"enum\":[\"P0\",\"P1\",\"P2\",\"P3\"]}}}},\"skipped\":{\"$ref\":\"#/$defs/count\"}}},\"demands\":{\"type\":\"array\",\"maxItems\":256,\"items\":{\"$ref\":\"#/$defs/demandSummary\"}},\"windows\":{\"type\":\"array\",\"maxItems\":512,\"items\":{\"$ref\":\"#/$defs/windowSummary\"}},\"claims\":{\"type\":\"array\",\"maxItems\":512,\"items\":{\"$ref\":\"#/$defs/claimSummary\"}},\"pods\":{\"type\":\"array\",\"maxItems\":64,\"items\":{\"$ref\":\"#/$defs/podSummary\"}},\"repositories\":{\"type\":\"array\",\"maxItems\":64,\"items\":{\"$ref\":\"#/$defs/repositorySummary\"}},\"hooks\":{\"type\":\"array\",\"maxItems\":2,\"items\":{\"$ref\":\"#/$defs/hookChannel\"}},\"unmergedAccepted\":{\"type\":\"array\",\"maxItems\":256,\"items\":{\"$ref\":\"#/$defs/acceptedBranch\"}},\"projection\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"targets\"],\"properties\":{\"status\":{\"enum\":[\"current\",\"stale\",\"missing\",\"unsafe\",\"unavailable\"]},\"targets\":{\"type\":\"array\",\"maxItems\":1024,\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"resourcePath\",\"status\",\"reason\"],\"properties\":{\"resourcePath\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"status\":{\"enum\":[\"current\",\"missing\",\"stale\",\"unsafe\"]},\"reason\":{\"$ref\":\"#/$defs/nullableCode\"}}}}}},\"policy\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"deliveryLandingSilenceMilliseconds\",\"deliveryRearmLimit\",\"workClaimGenerationLimit\",\"workClaimRecoveryWindowMilliseconds\",\"targetResultCallbackSilenceMilliseconds\",\"targetResultCallbackGenerationLimit\",\"demandReworkEscalationThreshold\"],\"properties\":{\"deliveryLandingSilenceMilliseconds\":{\"$ref\":\"#/$defs/count\"},\"deliveryRearmLimit\":{\"$ref\":\"#/$defs/count\"},\"workClaimGenerationLimit\":{\"$ref\":\"#/$defs/count\"},\"workClaimRecoveryWindowMilliseconds\":{\"$ref\":\"#/$defs/count\"},\"targetResultCallbackSilenceMilliseconds\":{\"$ref\":\"#/$defs/count\"},\"targetResultCallbackGenerationLimit\":{\"$ref\":\"#/$defs/count\"},\"demandReworkEscalationThreshold\":{\"$ref\":\"#/$defs/count\"}}},\"route\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/route\"}]},\"archive\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/archiveReceipt\"}]},\"next\":{\"$ref\":\"#/$defs/nextProjection\"},\"nextActions\":{\"type\":\"array\",\"maxItems\":64,\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"owner\",\"tool\",\"reason\",\"subject\"],\"properties\":{\"owner\":{\"enum\":[\"controller\",\"target\",\"test\",\"user\",\"none\"]},\"tool\":{\"$ref\":\"#/$defs/nullableToolName\"},\"reason\":{\"$ref\":\"#/$defs/code\"},\"subject\":{\"$ref\":\"#/$defs/nullableCode\"}}}}},\"$defs\":{\"count\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":9007199254740991},\"domainStatus\":{\"enum\":[\"observed\",\"unavailable\"]},\"token\":{\"type\":\"string\",\"pattern\":\"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$\"},\"code\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":256,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._:,/-]{0,255}$\"},\"nullableCode\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/code\"}]},\"nullableToolName\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"pattern\":\"^wakeflow_[a-z][a-z0-9_]{2,62}$\"}]},\"singleLineText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":512,\"pattern\":\"^\\\\P{Cc}+$\"},\"nullableSingleLineText\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/singleLineText\"}]},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"pattern\":\"^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\\\.{1,2}(?:/|$))(?!.*\\\\/\\\\.{1,2}(?:/|$))(?!.*\\\\\\\\)(?!.*//)(?!.*\\\\/$)(?!\\\\s)(?!.*\\\\s$)(?!.*\\\\/\\\\s)(?!.*\\\\s\\\\/)(?!.*[\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]).+$\"},\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"requirementId\":{\"type\":\"string\",\"pattern\":\"^requirement_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"taskPackageId\":{\"type\":\"string\",\"pattern\":\"^task-package_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"podId\":{\"type\":\"string\",\"pattern\":\"^pod_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"claimId\":{\"type\":\"string\",\"pattern\":\"^work-claim_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"deliveryId\":{\"type\":\"string\",\"pattern\":\"^target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandEventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"bindingId\":{\"type\":\"string\",\"pattern\":\"^window_binding_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"hostId\":{\"enum\":[\"codex\",\"claude-code\"]},\"demandType\":{\"enum\":[\"requirement\",\"bug\",\"supplement\",\"research\"]},\"demandSummary\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"demandId\",\"status\",\"issue\",\"title\",\"demandType\",\"podId\",\"lifecycle\",\"disposition\",\"frontier\",\"owner\",\"suggestedTool\",\"blockerCount\",\"streamRevision\"],\"properties\":{\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"status\":{\"$ref\":\"#/$defs/domainStatus\"},\"issue\":{\"$ref\":\"#/$defs/nullableCode\"},\"title\":{\"$ref\":\"#/$defs/nullableSingleLineText\"},\"demandType\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/demandType\"}]},\"podId\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/podId\"}]},\"lifecycle\":{\"oneOf\":[{\"type\":\"null\"},{\"enum\":[\"active\",\"cancelled\",\"completed\"]}]},\"disposition\":{\"oneOf\":[{\"type\":\"null\"},{\"enum\":[\"work-available\",\"blocked\",\"terminal\",\"awaiting-decision\"]}]},\"frontier\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/token\"}]},\"owner\":{\"oneOf\":[{\"type\":\"null\"},{\"enum\":[\"controller\",\"target\",\"test\",\"user\",\"none\"]}]},\"suggestedTool\":{\"$ref\":\"#/$defs/nullableToolName\"},\"blockerCount\":{\"$ref\":\"#/$defs/count\"},\"streamRevision\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/count\"}]}}},\"windowSummary\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"windowId\",\"podId\",\"role\",\"identity\",\"hostId\",\"bindingId\",\"claim\",\"lastObservation\"],\"properties\":{\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"podId\":{\"$ref\":\"#/$defs/podId\"},\"role\":{\"enum\":[\"controller\",\"design\",\"test\",\"product\"]},\"identity\":{\"enum\":[\"registered\",\"unregistered\",\"unobserved\"]},\"hostId\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/hostId\"}]},\"bindingId\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/bindingId\"}]},\"claim\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"demandId\",\"deliveryId\",\"generation\"],\"properties\":{\"status\":{\"enum\":[\"free\",\"held\"]},\"demandId\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/demandId\"}]},\"deliveryId\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/deliveryId\"}]},\"generation\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/count\"}]}}},\"lastObservation\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"event\",\"recordedAt\"],\"properties\":{\"event\":{\"enum\":[\"session-start\",\"user-prompt-submit\",\"stop\",\"session-end\",\"turn-complete\"]},\"recordedAt\":{\"$ref\":\"#/$defs/utcInstant\"}}}]}}},\"claimSummary\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"windowId\",\"claimId\",\"demandId\",\"targetTaskId\",\"deliveryId\",\"generation\",\"claimedAt\",\"orphan\"],\"properties\":{\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"claimId\":{\"$ref\":\"#/$defs/claimId\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"deliveryId\":{\"$ref\":\"#/$defs/deliveryId\"},\"generation\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":64},\"claimedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"orphan\":{\"type\":\"boolean\"}}},\"podSummary\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"podId\",\"name\",\"placement\",\"lifecycle\",\"state\",\"activeDemandId\",\"windows\",\"worktrees\"],\"properties\":{\"podId\":{\"$ref\":\"#/$defs/podId\"},\"name\":{\"$ref\":\"#/$defs/singleLineText\"},\"placement\":{\"enum\":[\"primary\",\"worktree\"]},\"lifecycle\":{\"enum\":[\"open\",\"closing\"]},\"state\":{\"enum\":[\"creating\",\"ready\",\"closing\",\"closed\",\"unobserved\"]},\"activeDemandId\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/demandId\"}]},\"windows\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"total\",\"bound\"],\"properties\":{\"total\":{\"$ref\":\"#/$defs/count\"},\"bound\":{\"$ref\":\"#/$defs/count\"}}},\"worktrees\":{\"type\":\"array\",\"maxItems\":64,\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"repositoryId\",\"receipt\",\"disposal\"],\"properties\":{\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"receipt\":{\"enum\":[\"absent\",\"present\",\"checkout-missing\"]},\"disposal\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/disposalGuidance\"}]}}}}}},\"disposalGuidance\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"suggested\",\"alternative\"],\"properties\":{\"suggested\":{\"$ref\":\"#/$defs/singleLineText\"},\"alternative\":{\"$ref\":\"#/$defs/singleLineText\"}}},\"repositorySummary\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"repositoryId\",\"status\",\"issue\",\"head\",\"branch\",\"detached\",\"branches\",\"worktrees\"],\"properties\":{\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"status\":{\"$ref\":\"#/$defs/domainStatus\"},\"issue\":{\"$ref\":\"#/$defs/nullableCode\"},\"head\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"pattern\":\"^[0-9a-f]{40}(?:[0-9a-f]{24})?$\"}]},\"branch\":{\"$ref\":\"#/$defs/nullableBranch\"},\"detached\":{\"type\":\"boolean\"},\"branches\":{\"$ref\":\"#/$defs/count\"},\"worktrees\":{\"type\":\"array\",\"maxItems\":64,\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"name\",\"branch\",\"prunable\"],\"properties\":{\"name\":{\"$ref\":\"#/$defs/singleLineText\"},\"branch\":{\"$ref\":\"#/$defs/nullableBranch\"},\"prunable\":{\"type\":\"boolean\"}}}}}},\"nullableBranch\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":255,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$\"}]},\"hookChannel\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"hostId\",\"status\",\"issue\",\"directory\",\"records\",\"skipped\"],\"properties\":{\"hostId\":{\"$ref\":\"#/$defs/hostId\"},\"status\":{\"$ref\":\"#/$defs/domainStatus\"},\"issue\":{\"$ref\":\"#/$defs/nullableCode\"},\"directory\":{\"enum\":[\"absent\",\"private\",\"mode\"]},\"records\":{\"$ref\":\"#/$defs/count\"},\"skipped\":{\"$ref\":\"#/$defs/count\"}}},\"acceptedBranch\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"demandId\",\"targetTaskId\",\"repositoryId\",\"branch\",\"commit\",\"acceptedAt\",\"repositoryObserved\"],\"properties\":{\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"branch\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":255,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$\"},\"commit\":{\"type\":\"string\",\"pattern\":\"^[0-9a-f]{40}(?:[0-9a-f]{24})?$\"},\"acceptedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"repositoryObserved\":{\"type\":\"boolean\"}}},\"archiveReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"demandId\",\"outcome\",\"archiveRef\",\"archivedAt\",\"terminalEvent\",\"manifestDigest\"],\"properties\":{\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"outcome\":{\"enum\":[\"completed\",\"cancelled\"]},\"archiveRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"archivedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"terminalEvent\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"eventId\",\"streamRevision\"],\"properties\":{\"eventId\":{\"$ref\":\"#/$defs/demandEventId\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":2,\"maximum\":9007199254740991}}},\"manifestDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"nextProjection\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"frontier\",\"owner\",\"suggestedTool\",\"blockers\"],\"properties\":{\"frontier\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/token\"}]},\"owner\":{\"enum\":[\"controller\",\"target\",\"test\",\"user\",\"none\"]},\"suggestedTool\":{\"$ref\":\"#/$defs/nullableToolName\"},\"blockers\":{\"type\":\"array\",\"maxItems\":64,\"items\":{\"$ref\":\"#/$defs/code\"}}}},\"route\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"programId\",\"demandId\",\"demandType\",\"lifecycle\",\"authorityDigest\",\"observedEventStream\",\"reviewSnapshotDigest\",\"disposition\",\"frontiers\",\"blockers\",\"routeDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowDemandControllerRoute\"},\"schemaVersion\":{\"const\":1},\"programId\":{\"$ref\":\"#/$defs/programId\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"demandType\":{\"$ref\":\"#/$defs/demandType\"},\"lifecycle\":{\"enum\":[\"active\",\"cancelled\",\"completed\"]},\"authorityDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"observedEventStream\":{\"$ref\":\"#/$defs/observedEventStream\"},\"reviewSnapshotDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"postAcceptanceRouteDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"disposition\":{\"enum\":[\"work-available\",\"blocked\",\"terminal\",\"awaiting-decision\"]},\"frontiers\":{\"type\":\"array\",\"maxItems\":10000,\"items\":{\"$ref\":\"#/$defs/frontier\"}},\"blockers\":{\"type\":\"array\",\"maxItems\":10000,\"items\":{\"$ref\":\"#/$defs/blocker\"}},\"routeDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"observedEventStream\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"streamRevision\",\"stateDigest\",\"lastEventId\",\"lastEventDigest\"],\"properties\":{\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"lastEventId\":{\"$ref\":\"#/$defs/demandEventId\"},\"lastEventDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"frontier\":{\"oneOf\":[{\"$ref\":\"#/$defs/demandFrontier\"},{\"$ref\":\"#/$defs/implementationFrontier\"},{\"$ref\":\"#/$defs/testFrontier\"}]},\"demandFrontier\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"scope\",\"kind\",\"owner\"],\"properties\":{\"scope\":{\"const\":\"demand\"},\"kind\":{\"enum\":[\"implementation-task-planning\",\"research-completion-required\",\"demand-completion-preflight\",\"test-task-planning\",\"decision-required\"]},\"owner\":{\"enum\":[\"target-task-planning\",\"demand-lifecycle\",\"demand-completion\",\"test-task-planning\",\"user\"]}}},\"implementationFrontier\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"scope\",\"kind\",\"owner\",\"target\"],\"properties\":{\"scope\":{\"const\":\"target\"},\"kind\":{\"enum\":[\"implementation-delivery-planning\",\"implementation-host-effect-execution\",\"implementation-target-result-import\",\"implementation-host-effect-rearm\",\"implementation-result-review\",\"implementation-review-blocked\"]},\"owner\":{\"enum\":[\"target-delivery-preparation\",\"agent-host\",\"target-result-import\",\"target-host-effect-rearm\",\"controller-implementation-review\"]},\"target\":{\"$ref\":\"#/$defs/implementationTarget\"}}},\"testFrontier\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"scope\",\"kind\",\"owner\",\"target\"],\"properties\":{\"scope\":{\"const\":\"target\"},\"kind\":{\"enum\":[\"test-delivery-planning\",\"test-host-effect-execution\",\"test-target-result-import\",\"test-result-review\",\"test-delivery-rerun-planning\",\"test-review-blocked\",\"test-host-effect-rearm\"]},\"owner\":{\"enum\":[\"test-delivery-preparation\",\"agent-host\",\"target-result-import\",\"controller-test-review\",\"target-host-effect-rearm\"]},\"target\":{\"$ref\":\"#/$defs/testTarget\"}}},\"implementationTarget\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"workType\",\"targetTaskId\",\"taskPackageId\",\"taskPackageDigest\",\"repositoryId\",\"windowId\",\"phase\"],\"properties\":{\"workType\":{\"const\":\"implementation\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"taskPackageId\":{\"$ref\":\"#/$defs/taskPackageId\"},\"taskPackageDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"phase\":{\"enum\":[\"planned\",\"delivery-prepared\",\"host-effect-accepted\",\"host-effect-indeterminate\",\"host-effect-rejected\",\"result-reported\",\"product-defect-rework-requested\",\"rework-requested\",\"escalated\",\"review-blocked\",\"superseded\"]}}},\"testTarget\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"workType\",\"targetTaskId\",\"taskPackageId\",\"taskPackageDigest\",\"windowId\",\"phase\"],\"properties\":{\"workType\":{\"const\":\"test\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"taskPackageId\":{\"$ref\":\"#/$defs/taskPackageId\"},\"taskPackageDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"phase\":{\"enum\":[\"planned\",\"test-delivery-prepared\",\"test-host-effect-accepted\",\"test-host-effect-indeterminate\",\"test-host-effect-rejected\",\"test-result-reported\",\"test-another-attempt-requested\",\"test-product-defect\",\"test-review-blocked\",\"test-escalated\"]}}},\"blocker\":{\"oneOf\":[{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"owner\"],\"properties\":{\"kind\":{\"const\":\"research-evidence-missing\"},\"owner\":{\"const\":\"demand-lifecycle\"}}},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"owner\",\"escalationEventId\"],\"properties\":{\"kind\":{\"const\":\"awaiting-decision\"},\"owner\":{\"const\":\"user\"},\"escalationEventId\":{\"$ref\":\"#/$defs/demandEventId\"}}},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"owner\",\"targetTaskId\",\"targetReviewDecisionId\",\"decisionDigest\"],\"properties\":{\"kind\":{\"const\":\"external-condition\"},\"owner\":{\"enum\":[\"controller-implementation-review\",\"controller-test-review\"]},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"targetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"decisionDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}}]}}}");
