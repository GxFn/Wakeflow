/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-implementation-review-decision-result.schema.json
 */

export type DemandId = string
export type TargetReviewDecisionId = string
export type Sha256Digest = string
export type UtcInstant = string
export type TargetTaskId = string
export type DemandEventId = string
export type EventId = string
export type CommitId = string

/**
 * Result of one implementation review decision append: the decision summary, the target phase it produced, any attached Demand escalation event, receipts, and the next frontier.
 */
export interface WakeflowImplementationReviewDecisionResultV1 {
kind: "WakeflowImplementationReviewDecisionResult"
schemaVersion: 1
tool: "wakeflow_record_implementation_review_decision"
status: ("committed" | "idempotent")
demandId: DemandId
decision: {
targetReviewDecisionId: TargetReviewDecisionId
decisionDigest: Sha256Digest
decision: ("accept" | "rework" | "blocked" | "escalate")
decidedAt: UtcInstant
callbackLanding: ("landed" | "unlanded")
targetCompletion: ("confirmed" | "pending")
}
target: {
targetTaskId: TargetTaskId
phase: ("accepted" | "rework-requested" | "review-blocked" | "escalated")
reworkCount: number
}
attached: {
escalationEventId: (null | DemandEventId)
}
event: EventReceipt
commit: CommitReceipt
stateDigest: Sha256Digest
next: Next
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
/**
 * Next responsibility derived from the route after this call.
 */
export interface Next {
frontier: (null | string)
owner: ("controller" | "target" | "test" | "user" | "none")
suggestedTool: (null | string)
/**
 * @maxItems 64
 */
blockers: string[]
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
export const WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:implementation-review-decision-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_RESULT_SCHEMA\",\"title\":\"WakeflowImplementationReviewDecisionResultV1\",\"description\":\"Result of one implementation review decision append: the decision summary, the target phase it produced, any attached Demand escalation event, receipts, and the next frontier.\",\"$comment\":\"The Decision is the only implementation Target acceptance authority. It records Controller judgment but does not run checks, dispatch rework, or complete the Demand.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"status\",\"demandId\",\"decision\",\"target\",\"attached\",\"event\",\"commit\",\"stateDigest\",\"next\"],\"properties\":{\"kind\":{\"const\":\"WakeflowImplementationReviewDecisionResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_record_implementation_review_decision\"},\"status\":{\"enum\":[\"committed\",\"idempotent\"]},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"decision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetReviewDecisionId\",\"decisionDigest\",\"decision\",\"decidedAt\",\"callbackLanding\",\"targetCompletion\"],\"properties\":{\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"decisionDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"decision\":{\"enum\":[\"accept\",\"rework\",\"blocked\",\"escalate\"]},\"decidedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"callbackLanding\":{\"enum\":[\"landed\",\"unlanded\"]},\"targetCompletion\":{\"enum\":[\"confirmed\",\"pending\"]}}},\"target\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetTaskId\",\"phase\",\"reworkCount\"],\"properties\":{\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"phase\":{\"enum\":[\"accepted\",\"rework-requested\",\"review-blocked\",\"escalated\"]},\"reworkCount\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":1024}}},\"attached\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"escalationEventId\"],\"properties\":{\"escalationEventId\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/demandEventId\"}]}}},\"event\":{\"$ref\":\"#/$defs/eventReceipt\"},\"commit\":{\"$ref\":\"#/$defs/commitReceipt\"},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"next\":{\"$ref\":\"#/$defs/next\"}},\"$defs\":{\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandEventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"productDefectRemediationId\":{\"type\":\"string\",\"pattern\":\"^product-defect-remediation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"eventId\",\"streamRevision\"],\"properties\":{\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991}}},\"commitReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"commitId\",\"commitSequence\",\"commitDigest\"],\"properties\":{\"commitId\":{\"$ref\":\"#/$defs/commitId\"},\"commitSequence\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"commitDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"next\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"frontier\",\"owner\",\"suggestedTool\",\"blockers\"],\"description\":\"Next responsibility derived from the route after this call.\",\"properties\":{\"frontier\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":128}]},\"owner\":{\"enum\":[\"controller\",\"target\",\"test\",\"user\",\"none\"]},\"suggestedTool\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":128}]},\"blockers\":{\"type\":\"array\",\"maxItems\":64,\"items\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":256}}}},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"}}}");
