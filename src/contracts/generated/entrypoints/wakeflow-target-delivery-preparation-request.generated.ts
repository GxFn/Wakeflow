/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-target-delivery-preparation-request.schema.json
 */

/**
 * Closed MCP preview/apply request for preparing one immutable implementation Target Delivery without claiming or performing a host effect.
 */
export type WakeflowTargetDeliveryPreparationRequestV1 = (PreviewRequest | ApplyRequest)
export type DemandId = string
export type TargetTaskId = string
export type CommitId = string
export type EventId = string
export type Intent = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowTargetDeliveryIntent"
schemaVersion: 1
targetDeliveryId: TargetDeliveryId
programId: ProgramId
configDigest: Sha256Digest
demandId: DemandId
target: IntentTarget
route: IntentRoute
language: ("en" | "zh-Hans")
portablePrompt: string
rework?: Rework
productDefectRemediation?: ProductDefectRemediation
preparedAt: UtcInstant
intentDigest: Sha256Digest
})
export type TargetDeliveryId = string
export type ProgramId = string
export type Sha256Digest = string
export type TaskPackageId = string
export type PortableResourcePath = string
export type HostId = ("codex" | "claude-code")
export type WindowId = string
export type BindingId = string
export type TargetReviewDecisionId = string
export type TargetResultId = string
export type LongSummary = string
export type CheckId = string
export type MethodSummary = string
export type ObservationSummary = string
export type ProductDefectRemediationId = string
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
kind: "WakeflowTargetDeliveryPreparationPlan"
schemaVersion: 1
demandId: DemandId
targetTaskId: TargetTaskId
expectedStreamRevision: number
commitId: CommitId
eventId: EventId
intent: Intent
}
export interface IntentTarget {
targetTaskId: TargetTaskId
taskPackageId: TaskPackageId
taskPackageRef: PortableResourcePath
taskPackageDigest: Sha256Digest
}
export interface IntentRoute {
hostId: HostId
windowId: WindowId
bindingId: BindingId
}
export interface Rework {
decision: ReviewDecisionReference
previousResult: PreviousResultReference
rationaleSummary: LongSummary
/**
 * @minItems 1
 * @maxItems 32
 */
requiredCorrections: [RequiredCorrection, ...(RequiredCorrection)[]]
}
export interface ReviewDecisionReference {
targetReviewDecisionId: TargetReviewDecisionId
decisionDigest: Sha256Digest
}
export interface PreviousResultReference {
targetResultId: TargetResultId
resultDigest: Sha256Digest
}
export interface RequiredCorrection {
checkId: CheckId
outcome: ("failed" | "inconclusive")
methodSummary: MethodSummary
observationSummary: ObservationSummary
}
export interface ProductDefectRemediation {
authorization: {
productDefectRemediationId: ProductDefectRemediationId
authorizationDigest: Sha256Digest
}
testReviewDecision: ReviewDecisionReference
previousResult: PreviousResultReference
authorizationRationaleSummary: LongSummary
correctionObjectiveSummary: LongSummary
/**
 * @minItems 1
 * @maxItems 32
 */
requiredCorrections: [ProductDefectRequiredCorrection, ...(ProductDefectRequiredCorrection)[]]
}
export interface ProductDefectRequiredCorrection {
checkId: CheckId
outcome: "failed"
methodSummary: MethodSummary
observationSummary: ObservationSummary
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
export const WAKEFLOW_TARGET_DELIVERY_PREPARATION_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:target-delivery-preparation-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TARGET_DELIVERY_PREPARATION_REQUEST_SCHEMA\",\"title\":\"WakeflowTargetDeliveryPreparationRequestV1\",\"description\":\"Closed MCP preview/apply request for preparing one immutable implementation Target Delivery without claiming or performing a host effect.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/previewRequest\"},{\"$ref\":\"#/$defs/applyRequest\"}],\"$defs\":{\"previewRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"demandId\",\"targetTaskId\"],\"properties\":{\"root\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"mode\":{\"const\":\"preview\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"}}},\"applyRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"plan\",\"planDigest\"],\"properties\":{\"root\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"mode\":{\"const\":\"apply\"},\"plan\":{\"$ref\":\"#/$defs/plan\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"plan\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"demandId\",\"targetTaskId\",\"expectedStreamRevision\",\"commitId\",\"eventId\",\"intent\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTargetDeliveryPreparationPlan\"},\"schemaVersion\":{\"const\":1},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"expectedStreamRevision\":{\"type\":\"integer\",\"minimum\":2,\"maximum\":9007199254740991},\"commitId\":{\"$ref\":\"#/$defs/commitId\"},\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"intent\":{\"$ref\":\"#/$defs/intent\"}}},\"intent\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"targetDeliveryId\",\"programId\",\"configDigest\",\"demandId\",\"target\",\"route\",\"language\",\"portablePrompt\",\"preparedAt\",\"intentDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTargetDeliveryIntent\"},\"schemaVersion\":{\"const\":1},\"targetDeliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"},\"programId\":{\"$ref\":\"#/$defs/programId\"},\"configDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"target\":{\"$ref\":\"#/$defs/intentTarget\"},\"route\":{\"$ref\":\"#/$defs/intentRoute\"},\"language\":{\"enum\":[\"en\",\"zh-Hans\"]},\"portablePrompt\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":32768,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"rework\":{\"$ref\":\"#/$defs/rework\"},\"productDefectRemediation\":{\"$ref\":\"#/$defs/productDefectRemediation\"},\"preparedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"intentDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}},\"allOf\":[{\"not\":{\"type\":\"object\",\"properties\":{\"rework\":{},\"productDefectRemediation\":{}},\"required\":[\"rework\",\"productDefectRemediation\"]}}]},\"intentTarget\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetTaskId\",\"taskPackageId\",\"taskPackageRef\",\"taskPackageDigest\"],\"properties\":{\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"taskPackageId\":{\"$ref\":\"#/$defs/taskPackageId\"},\"taskPackageRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"taskPackageDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"intentRoute\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"hostId\",\"windowId\",\"bindingId\"],\"properties\":{\"hostId\":{\"$ref\":\"#/$defs/hostId\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"bindingId\":{\"$ref\":\"#/$defs/bindingId\"}}},\"rework\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"decision\",\"previousResult\",\"rationaleSummary\",\"requiredCorrections\"],\"properties\":{\"decision\":{\"$ref\":\"#/$defs/reviewDecisionReference\"},\"previousResult\":{\"$ref\":\"#/$defs/previousResultReference\"},\"rationaleSummary\":{\"$ref\":\"#/$defs/longSummary\"},\"requiredCorrections\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/requiredCorrection\"},\"contains\":{\"type\":\"object\",\"properties\":{\"outcome\":{\"const\":\"failed\"}},\"required\":[\"outcome\"]},\"minContains\":1}}},\"productDefectRemediation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"authorization\",\"testReviewDecision\",\"previousResult\",\"authorizationRationaleSummary\",\"correctionObjectiveSummary\",\"requiredCorrections\"],\"properties\":{\"authorization\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"productDefectRemediationId\",\"authorizationDigest\"],\"properties\":{\"productDefectRemediationId\":{\"$ref\":\"#/$defs/productDefectRemediationId\"},\"authorizationDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"testReviewDecision\":{\"$ref\":\"#/$defs/reviewDecisionReference\"},\"previousResult\":{\"$ref\":\"#/$defs/previousResultReference\"},\"authorizationRationaleSummary\":{\"$ref\":\"#/$defs/longSummary\"},\"correctionObjectiveSummary\":{\"$ref\":\"#/$defs/longSummary\"},\"requiredCorrections\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/productDefectRequiredCorrection\"}}}},\"reviewDecisionReference\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetReviewDecisionId\",\"decisionDigest\"],\"properties\":{\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"decisionDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"previousResultReference\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetResultId\",\"resultDigest\"],\"properties\":{\"targetResultId\":{\"$ref\":\"#/$defs/targetResultId\"},\"resultDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"requiredCorrection\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"checkId\",\"outcome\",\"methodSummary\",\"observationSummary\"],\"properties\":{\"checkId\":{\"$ref\":\"#/$defs/checkId\"},\"outcome\":{\"enum\":[\"failed\",\"inconclusive\"]},\"methodSummary\":{\"$ref\":\"#/$defs/methodSummary\"},\"observationSummary\":{\"$ref\":\"#/$defs/observationSummary\"}}},\"productDefectRequiredCorrection\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"checkId\",\"outcome\",\"methodSummary\",\"observationSummary\"],\"properties\":{\"checkId\":{\"$ref\":\"#/$defs/checkId\"},\"outcome\":{\"const\":\"failed\"},\"methodSummary\":{\"$ref\":\"#/$defs/methodSummary\"},\"observationSummary\":{\"$ref\":\"#/$defs/observationSummary\"}}},\"checkId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"longSummary\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":1024,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"methodSummary\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"observationSummary\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":256,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"pattern\":\"^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\\\.{1,2}(?:/|$))(?!.*\\\\/\\\\.{1,2}(?:/|$))(?!.*\\\\\\\\)(?!.*//)(?!.*\\\\/$)(?!\\\\s)(?!.*\\\\s$)(?!.*\\\\/\\\\s)(?!.*\\\\s\\\\/)(?!.*[\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]).+$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"hostId\":{\"enum\":[\"codex\",\"claude-code\"]},\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"taskPackageId\":{\"type\":\"string\",\"pattern\":\"^task-package_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"bindingId\":{\"type\":\"string\",\"pattern\":\"^window_binding_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetDeliveryId\":{\"type\":\"string\",\"pattern\":\"^target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetResultId\":{\"type\":\"string\",\"pattern\":\"^target-result_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"productDefectRemediationId\":{\"type\":\"string\",\"pattern\":\"^product-defect-remediation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}");
