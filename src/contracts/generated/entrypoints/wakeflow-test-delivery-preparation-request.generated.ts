/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-test-delivery-preparation-request.schema.json
 */

/**
 * Closed MCP preview/apply request for preparing one immutable Test Delivery authorization without creating a dispatch packet, claim, agent action, or host effect.
 */
export type WakeflowTestDeliveryPreparationRequestV1 = (PreviewRequest | ApplyRequest)
export type DemandId = string
export type TargetTaskId = string
export type CommitId = string
export type EventId = string
export type TargetDeliveryId = string
export type ProgramId = string
export type Sha256Digest = string
export type TaskPackageId = string
export type PortableResourcePath = string
export type TestCardId = string
export type HostId = ("codex" | "claude-code")
export type WindowId = string
export type BindingId = string
export type TestExecutionAttempt = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowTestExecutionAttempt"
schemaVersion: 1
testAttemptId: TestAttemptId
targetTaskId: TargetTaskId
testCard: TestCardTuple
ordinal: number
mode: ("initial" | "rerun")
environmentSetup: EnvironmentSetup
rerunSource?: RerunSource
})
export type TestAttemptId = string
export type SetupPolicy = ("fresh-once" | "fresh-per-attempt" | "reuse-existing")
export type TargetResultId = string
export type TargetReviewDecisionId = string
export type ClaimId = string
export type UtcInstant = string

export interface PreviewRequest {
/**
 * Absolute path of the existing Wakeflow workspace root.
 */
root: string
mode: "preview"
demandId: DemandId
targetTaskId: TargetTaskId
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
kind: "WakeflowTestDeliveryPreparationPlan"
schemaVersion: 1
demandId: DemandId
targetTaskId: TargetTaskId
expectedStreamRevision: number
commitId: CommitId
eventId: EventId
intent: Intent
}
export interface Intent {
kind: "WakeflowTestDeliveryIntent"
schemaVersion: 1
targetDeliveryId: TargetDeliveryId
programId: ProgramId
configDigest: Sha256Digest
demandId: DemandId
target: IntentTarget
route: IntentRoute
attempt: TestExecutionAttempt
replacement?: Replacement
language: ("en" | "zh-Hans")
preparedAt: UtcInstant
intentDigest: Sha256Digest
}
export interface IntentTarget {
targetTaskId: TargetTaskId
taskPackageId: TaskPackageId
taskPackageRef: PortableResourcePath
taskPackageDigest: Sha256Digest
testCard: TestCardTuple
}
export interface TestCardTuple {
testCardId: TestCardId
testCardDigest: Sha256Digest
}
export interface IntentRoute {
hostId: HostId
windowId: WindowId
bindingId: BindingId
}
export interface EnvironmentSetup {
policy: SetupPolicy
directive: ("prepare-fresh-environment" | "reuse-confirmed-environment")
}
export interface RerunSource {
previousAttemptId: TestAttemptId
previousResult: {
targetResultId: TargetResultId
resultDigest: Sha256Digest
}
reviewDecision: {
targetReviewDecisionId: TargetReviewDecisionId
decisionDigest: Sha256Digest
}
}
export interface Replacement {
kind: "rejected-before-effect"
authorizationOrdinal: number
previousDelivery: {
targetDeliveryId: TargetDeliveryId
intentDigest: Sha256Digest
testDispatchPacketDigest: Sha256Digest
}
rejectedHostEffect: {
claimId: ClaimId
claimDigest: Sha256Digest
claimEventId: EventId
claimCommitId: CommitId
observationDigest: Sha256Digest
observedAt: UtcInstant
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
export const WAKEFLOW_TEST_DELIVERY_PREPARATION_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:test-delivery-preparation-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TEST_DELIVERY_PREPARATION_REQUEST_SCHEMA\",\"title\":\"WakeflowTestDeliveryPreparationRequestV1\",\"description\":\"Closed MCP preview/apply request for preparing one immutable Test Delivery authorization without creating a dispatch packet, claim, agent action, or host effect.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/previewRequest\"},{\"$ref\":\"#/$defs/applyRequest\"}],\"$defs\":{\"previewRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"demandId\",\"targetTaskId\"],\"properties\":{\"root\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"mode\":{\"const\":\"preview\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"}}},\"applyRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"plan\",\"planDigest\"],\"properties\":{\"root\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"mode\":{\"const\":\"apply\"},\"plan\":{\"$ref\":\"#/$defs/plan\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"plan\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"demandId\",\"targetTaskId\",\"expectedStreamRevision\",\"commitId\",\"eventId\",\"intent\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTestDeliveryPreparationPlan\"},\"schemaVersion\":{\"const\":1},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"expectedStreamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"commitId\":{\"$ref\":\"#/$defs/commitId\"},\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"intent\":{\"$ref\":\"#/$defs/intent\"}}},\"intent\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"targetDeliveryId\",\"programId\",\"configDigest\",\"demandId\",\"target\",\"route\",\"attempt\",\"language\",\"preparedAt\",\"intentDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTestDeliveryIntent\"},\"schemaVersion\":{\"const\":1},\"targetDeliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"},\"programId\":{\"$ref\":\"#/$defs/programId\"},\"configDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"target\":{\"$ref\":\"#/$defs/intentTarget\"},\"route\":{\"$ref\":\"#/$defs/intentRoute\"},\"attempt\":{\"$ref\":\"#/$defs/testExecutionAttempt\"},\"replacement\":{\"$ref\":\"#/$defs/replacement\"},\"language\":{\"enum\":[\"en\",\"zh-Hans\"]},\"preparedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"intentDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"targetDeliveryId\":{\"type\":\"string\",\"pattern\":\"^target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"intentTarget\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetTaskId\",\"taskPackageId\",\"taskPackageRef\",\"taskPackageDigest\",\"testCard\"],\"properties\":{\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"taskPackageId\":{\"$ref\":\"#/$defs/taskPackageId\"},\"taskPackageRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"taskPackageDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"testCard\":{\"$ref\":\"#/$defs/testCardTuple\"}}},\"intentRoute\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"hostId\",\"windowId\",\"bindingId\"],\"properties\":{\"hostId\":{\"$ref\":\"#/$defs/hostId\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"bindingId\":{\"$ref\":\"#/$defs/bindingId\"}}},\"claimId\":{\"type\":\"string\",\"pattern\":\"^window_work_claim_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"replacement\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"authorizationOrdinal\",\"previousDelivery\",\"rejectedHostEffect\"],\"properties\":{\"kind\":{\"const\":\"rejected-before-effect\"},\"authorizationOrdinal\":{\"type\":\"integer\",\"minimum\":2,\"maximum\":32},\"previousDelivery\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetDeliveryId\",\"intentDigest\",\"testDispatchPacketDigest\"],\"properties\":{\"targetDeliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"},\"intentDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"testDispatchPacketDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"rejectedHostEffect\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"claimId\",\"claimDigest\",\"claimEventId\",\"claimCommitId\",\"observationDigest\",\"observedAt\"],\"properties\":{\"claimId\":{\"$ref\":\"#/$defs/claimId\"},\"claimDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"claimEventId\":{\"$ref\":\"#/$defs/eventId\"},\"claimCommitId\":{\"$ref\":\"#/$defs/commitId\"},\"observationDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"observedAt\":{\"$ref\":\"#/$defs/utcInstant\"}}}}},\"testExecutionAttempt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"testAttemptId\",\"targetTaskId\",\"testCard\",\"ordinal\",\"mode\",\"environmentSetup\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTestExecutionAttempt\"},\"schemaVersion\":{\"const\":1},\"testAttemptId\":{\"$ref\":\"#/$defs/testAttemptId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"testCard\":{\"$ref\":\"#/$defs/testCardTuple\"},\"ordinal\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":10},\"mode\":{\"enum\":[\"initial\",\"rerun\"]},\"environmentSetup\":{\"$ref\":\"#/$defs/environmentSetup\"},\"rerunSource\":{\"$ref\":\"#/$defs/rerunSource\"}},\"allOf\":[{\"if\":{\"properties\":{\"mode\":{\"const\":\"initial\"}},\"required\":[\"mode\"]},\"then\":{\"properties\":{\"ordinal\":{\"const\":1},\"rerunSource\":false}},\"else\":{\"required\":[\"rerunSource\"],\"properties\":{\"ordinal\":{\"type\":\"integer\",\"minimum\":2,\"maximum\":10}}}},{\"if\":{\"properties\":{\"environmentSetup\":{\"type\":\"object\",\"properties\":{\"policy\":{\"const\":\"reuse-existing\"}},\"required\":[\"policy\"]}}},\"then\":{\"properties\":{\"environmentSetup\":{\"type\":\"object\",\"properties\":{\"directive\":{\"const\":\"reuse-confirmed-environment\"}}}}}},{\"if\":{\"properties\":{\"environmentSetup\":{\"type\":\"object\",\"properties\":{\"policy\":{\"const\":\"fresh-per-attempt\"}},\"required\":[\"policy\"]}}},\"then\":{\"properties\":{\"environmentSetup\":{\"type\":\"object\",\"properties\":{\"directive\":{\"const\":\"prepare-fresh-environment\"}}}}}},{\"if\":{\"properties\":{\"environmentSetup\":{\"type\":\"object\",\"properties\":{\"policy\":{\"const\":\"fresh-once\"}},\"required\":[\"policy\"]}}},\"then\":{\"if\":{\"properties\":{\"mode\":{\"const\":\"initial\"}}},\"then\":{\"properties\":{\"environmentSetup\":{\"type\":\"object\",\"properties\":{\"directive\":{\"const\":\"prepare-fresh-environment\"}}}}},\"else\":{\"properties\":{\"environmentSetup\":{\"type\":\"object\",\"properties\":{\"directive\":{\"const\":\"reuse-confirmed-environment\"}}}}}}}]},\"testAttemptId\":{\"type\":\"string\",\"pattern\":\"^test-attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"testCardTuple\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"testCardId\",\"testCardDigest\"],\"properties\":{\"testCardId\":{\"$ref\":\"#/$defs/testCardId\"},\"testCardDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"targetResultId\":{\"type\":\"string\",\"pattern\":\"^target-result_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"rerunSource\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"previousAttemptId\",\"previousResult\",\"reviewDecision\"],\"properties\":{\"previousAttemptId\":{\"$ref\":\"#/$defs/testAttemptId\"},\"previousResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetResultId\",\"resultDigest\"],\"properties\":{\"targetResultId\":{\"$ref\":\"#/$defs/targetResultId\"},\"resultDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"reviewDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetReviewDecisionId\",\"decisionDigest\"],\"properties\":{\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"decisionDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}}}},\"environmentSetup\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"policy\",\"directive\"],\"properties\":{\"policy\":{\"$ref\":\"#/$defs/setupPolicy\"},\"directive\":{\"enum\":[\"prepare-fresh-environment\",\"reuse-confirmed-environment\"]}}},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"pattern\":\"^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\\\.{1,2}(?:/|$))(?!.*\\\\/\\\\.{1,2}(?:/|$))(?!.*\\\\\\\\)(?!.*//)(?!.*\\\\/$)(?!\\\\s)(?!.*\\\\s$)(?!.*\\\\/\\\\s)(?!.*\\\\s\\\\/)(?!.*[\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]).+$\",\"examples\":[\".wakeflow-active/current/demand.json\",\"requirement-designs/需求说明.md\",\"docs/My Plan.md\"]},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"taskPackageId\":{\"type\":\"string\",\"pattern\":\"^task-package_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"testCardId\":{\"type\":\"string\",\"pattern\":\"^test-card_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"setupPolicy\":{\"enum\":[\"fresh-once\",\"fresh-per-attempt\",\"reuse-existing\"]},\"hostId\":{\"enum\":[\"codex\",\"claude-code\"]},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"bindingId\":{\"type\":\"string\",\"pattern\":\"^window_binding_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}");
