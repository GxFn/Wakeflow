/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-controller-product-defect-remediation-result.schema.json
 */

/**
 * Successful result for one idempotently recorded Controller Product Defect Remediation Authorization Event.
 */
export type WakeflowControllerProductDefectRemediationResultV1 = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowControllerProductDefectRemediationResult"
schemaVersion: 1
tool: "wakeflow_authorize_product_defect_remediation"
status: ("authorized" | "already-authorized")
disposition: ("committed" | "idempotent")
eventAuthority: "current"
authorization: Authorization
event: EventReceipt
commit: CommitReceipt
stateDigest: Sha256Digest
})
export type ProductDefectRemediationId = string
export type ProgramId = string
export type DemandId = string
export type WindowId = string
export type Sha256Digest = string
export type TargetTaskId = string
export type TestCardId = string
export type TestAttemptId = string
export type TargetResultId = string
export type TargetReviewDecisionId = string
export type UtcInstant = string
export type CheckId = string
export type HumanText = string
export type TaskPackageId = string
export type RepositoryId = string
export type EventId = string
export type CommitId = string

export interface Authorization {
kind: "WakeflowControllerProductDefectRemediationAuthorization"
schemaVersion: 1
productDefectRemediationId: ProductDefectRemediationId
programId: ProgramId
demandId: DemandId
controllerWindowId: WindowId
source: Source
/**
 * @minItems 1
 * @maxItems 32
 */
failedChecks: [FailedCheck, ...(FailedCheck)[]]
/**
 * @minItems 1
 * @maxItems 10000
 */
affectedTargets: [AffectedTarget, ...(AffectedTarget)[]]
boundary: "existing-task-packages-only"
authorizationRationale: HumanText
authorizedAt: UtcInstant
authorizationDigest: Sha256Digest
}
export interface Source {
postAcceptanceRouteDigest: Sha256Digest
reviewSnapshotDigest: Sha256Digest
stateDigest: Sha256Digest
streamRevision: number
testTargetTaskId: TargetTaskId
testCard: {
testCardId: TestCardId
testCardDigest: Sha256Digest
}
testAttemptId: TestAttemptId
testDispatchPacketDigest: Sha256Digest
targetResult: {
targetResultId: TargetResultId
resultDigest: Sha256Digest
}
testReviewDecision: {
targetReviewDecisionId: TargetReviewDecisionId
decisionDigest: Sha256Digest
decidedAt: UtcInstant
}
}
export interface FailedCheck {
checkId: CheckId
outcome: "failed"
method: HumanText
observation: HumanText
}
export interface AffectedTarget {
baseline: ImplementationBaseline
/**
 * @minItems 1
 * @maxItems 32
 */
failedCheckIds: [CheckId, ...(CheckId)[]]
correctionObjective: HumanText
}
export interface ImplementationBaseline {
targetTaskId: TargetTaskId
taskPackageId: TaskPackageId
taskPackageDigest: Sha256Digest
repositoryId: RepositoryId
windowId: WindowId
targetResultId: TargetResultId
resultDigest: Sha256Digest
targetReviewDecisionId: TargetReviewDecisionId
decisionDigest: Sha256Digest
}
export interface EventReceipt {
eventId: EventId
streamRevision: number
}
export interface CommitReceipt {
commitId: CommitId
commitSequence: number
commitDigest: Sha256Digest
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
export const WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:controller-product-defect-remediation-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_RESULT_SCHEMA\",\"title\":\"WakeflowControllerProductDefectRemediationResultV1\",\"description\":\"Successful result for one idempotently recorded Controller Product Defect Remediation Authorization Event.\",\"$comment\":\"The Authorization opens exact existing product TaskPackage rework. It does not create a Delivery, execute a fix, let Test modify product code, create the next TestCard, or complete the Demand.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"status\",\"disposition\",\"eventAuthority\",\"authorization\",\"event\",\"commit\",\"stateDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowControllerProductDefectRemediationResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_authorize_product_defect_remediation\"},\"status\":{\"enum\":[\"authorized\",\"already-authorized\"]},\"disposition\":{\"enum\":[\"committed\",\"idempotent\"]},\"eventAuthority\":{\"const\":\"current\"},\"authorization\":{\"$ref\":\"#/$defs/authorization\"},\"event\":{\"$ref\":\"#/$defs/eventReceipt\"},\"commit\":{\"$ref\":\"#/$defs/commitReceipt\"},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}},\"allOf\":[{\"if\":{\"properties\":{\"status\":{\"const\":\"authorized\"}},\"required\":[\"status\"]},\"then\":{\"properties\":{\"disposition\":{\"const\":\"committed\"}}}},{\"if\":{\"properties\":{\"status\":{\"const\":\"already-authorized\"}},\"required\":[\"status\"]},\"then\":{\"properties\":{\"disposition\":{\"const\":\"idempotent\"}}}}],\"$defs\":{\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"productDefectRemediationId\":{\"type\":\"string\",\"pattern\":\"^product-defect-remediation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"taskPackageId\":{\"type\":\"string\",\"pattern\":\"^task-package_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"testCardId\":{\"type\":\"string\",\"pattern\":\"^test-card_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"testAttemptId\":{\"type\":\"string\",\"pattern\":\"^test-attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetResultId\":{\"type\":\"string\",\"pattern\":\"^target-result_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"source\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"postAcceptanceRouteDigest\",\"reviewSnapshotDigest\",\"stateDigest\",\"streamRevision\",\"testTargetTaskId\",\"testCard\",\"testAttemptId\",\"testDispatchPacketDigest\",\"targetResult\",\"testReviewDecision\"],\"properties\":{\"postAcceptanceRouteDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"reviewSnapshotDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"testTargetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"testCard\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"testCardId\",\"testCardDigest\"],\"properties\":{\"testCardId\":{\"$ref\":\"#/$defs/testCardId\"},\"testCardDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"testAttemptId\":{\"$ref\":\"#/$defs/testAttemptId\"},\"testDispatchPacketDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"targetResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetResultId\",\"resultDigest\"],\"properties\":{\"targetResultId\":{\"$ref\":\"#/$defs/targetResultId\"},\"resultDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"testReviewDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetReviewDecisionId\",\"decisionDigest\",\"decidedAt\"],\"properties\":{\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"decisionDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"decidedAt\":{\"$ref\":\"#/$defs/utcInstant\"}}}}},\"failedCheck\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"checkId\",\"outcome\",\"method\",\"observation\"],\"properties\":{\"checkId\":{\"$ref\":\"#/$defs/checkId\"},\"outcome\":{\"const\":\"failed\"},\"method\":{\"$ref\":\"#/$defs/humanText\"},\"observation\":{\"$ref\":\"#/$defs/humanText\"}}},\"affectedTarget\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"baseline\",\"failedCheckIds\",\"correctionObjective\"],\"properties\":{\"baseline\":{\"$ref\":\"#/$defs/implementationBaseline\"},\"failedCheckIds\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/checkId\"}},\"correctionObjective\":{\"$ref\":\"#/$defs/humanText\"}}},\"implementationBaseline\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetTaskId\",\"taskPackageId\",\"taskPackageDigest\",\"repositoryId\",\"windowId\",\"targetResultId\",\"resultDigest\",\"targetReviewDecisionId\",\"decisionDigest\"],\"properties\":{\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"taskPackageId\":{\"$ref\":\"#/$defs/taskPackageId\"},\"taskPackageDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"targetResultId\":{\"$ref\":\"#/$defs/targetResultId\"},\"resultDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"decisionDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"checkId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"humanText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"authorization\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"productDefectRemediationId\",\"programId\",\"demandId\",\"controllerWindowId\",\"source\",\"failedChecks\",\"affectedTargets\",\"boundary\",\"authorizationRationale\",\"authorizedAt\",\"authorizationDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowControllerProductDefectRemediationAuthorization\"},\"schemaVersion\":{\"const\":1},\"productDefectRemediationId\":{\"$ref\":\"#/$defs/productDefectRemediationId\"},\"programId\":{\"$ref\":\"#/$defs/programId\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"controllerWindowId\":{\"$ref\":\"#/$defs/windowId\"},\"source\":{\"$ref\":\"#/$defs/source\"},\"failedChecks\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/failedCheck\"}},\"affectedTargets\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":10000,\"items\":{\"$ref\":\"#/$defs/affectedTarget\"}},\"boundary\":{\"const\":\"existing-task-packages-only\"},\"authorizationRationale\":{\"$ref\":\"#/$defs/humanText\"},\"authorizedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"authorizationDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"eventId\",\"streamRevision\"],\"properties\":{\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991}}},\"commitReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"commitId\",\"commitSequence\",\"commitDigest\"],\"properties\":{\"commitId\":{\"$ref\":\"#/$defs/commitId\"},\"commitSequence\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"commitDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}}}}");
