/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-record-delivery-outcome-result.schema.json
 */

export type DemandId = string
export type DeliveryId = string
export type UtcInstant = string
export type Sha256Digest = string
export type TargetTaskId = string
export type EventId = string
export type CommitId = string

/**
 * Result of recording one delivery outcome: the derived disposition with its evidence kind, the target phase, the appended event, and next.
 */
export interface WakeflowRecordDeliveryOutcomeResultV1 {
kind: "WakeflowRecordDeliveryOutcomeResult"
schemaVersion: 1
tool: "wakeflow_record_delivery_outcome"
status: ("recorded" | "idempotent")
demandId: DemandId
outcome: Outcome
target: Target
event: Event
commit: Commit
stateDigest: Sha256Digest
next: Next
}
export interface Outcome {
deliveryId: DeliveryId
generation: number
disposition: ("accepted" | "indeterminate" | "rejected-before-send")
evidenceKind: ("hook-record" | "host-send-return" | "agent-declaration" | "controller-resolution")
hookRecordId: (null | string)
claimHandling: ("retain" | "release-authorized")
observedAt: UtcInstant
outcomeDigest: Sha256Digest
}
export interface Target {
targetTaskId: TargetTaskId
workType: ("implementation" | "test")
phase: ("host-effect-accepted" | "host-effect-indeterminate" | "host-effect-rejected" | "test-host-effect-accepted" | "test-host-effect-indeterminate" | "test-host-effect-rejected")
}
export interface Event {
eventId: EventId
streamRevision: number
}
export interface Commit {
commitId: CommitId
commitSequence: number
commitDigest: Sha256Digest
}
/**
 * Next Controller responsibility derived from the route after this append.
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
export const WAKEFLOW_RECORD_DELIVERY_OUTCOME_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:record-delivery-outcome-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_RECORD_DELIVERY_OUTCOME_RESULT_SCHEMA\",\"title\":\"WakeflowRecordDeliveryOutcomeResultV1\",\"description\":\"Result of recording one delivery outcome: the derived disposition with its evidence kind, the target phase, the appended event, and next.\",\"$comment\":\"indeterminate keeps the work claim; only rejected-before-send releases it. Landing evidence that arrives later is applied by calling this tool again with a new idempotency key.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"status\",\"demandId\",\"outcome\",\"target\",\"event\",\"commit\",\"stateDigest\",\"next\"],\"properties\":{\"kind\":{\"const\":\"WakeflowRecordDeliveryOutcomeResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_record_delivery_outcome\"},\"status\":{\"enum\":[\"recorded\",\"idempotent\"]},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"outcome\":{\"$ref\":\"#/$defs/outcome\"},\"target\":{\"$ref\":\"#/$defs/target\"},\"event\":{\"$ref\":\"#/$defs/event\"},\"commit\":{\"$ref\":\"#/$defs/commit\"},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"next\":{\"$ref\":\"#/$defs/next\"}},\"$defs\":{\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"deliveryId\":{\"type\":\"string\",\"pattern\":\"^target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"claimId\":{\"type\":\"string\",\"pattern\":\"^work-claim_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"bindingId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$\"},\"next\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"frontier\",\"owner\",\"suggestedTool\",\"blockers\"],\"description\":\"Next Controller responsibility derived from the route after this append.\",\"properties\":{\"frontier\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":128}]},\"owner\":{\"enum\":[\"controller\",\"target\",\"test\",\"user\",\"none\"]},\"suggestedTool\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":128}]},\"blockers\":{\"type\":\"array\",\"maxItems\":64,\"items\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":256}}}},\"event\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"eventId\",\"streamRevision\"],\"properties\":{\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991}}},\"commit\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"commitId\",\"commitSequence\",\"commitDigest\"],\"properties\":{\"commitId\":{\"$ref\":\"#/$defs/commitId\"},\"commitSequence\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"commitDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"outcome\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"deliveryId\",\"generation\",\"disposition\",\"evidenceKind\",\"hookRecordId\",\"claimHandling\",\"observedAt\",\"outcomeDigest\"],\"properties\":{\"deliveryId\":{\"$ref\":\"#/$defs/deliveryId\"},\"generation\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":4},\"disposition\":{\"enum\":[\"accepted\",\"indeterminate\",\"rejected-before-send\"]},\"evidenceKind\":{\"enum\":[\"hook-record\",\"host-send-return\",\"agent-declaration\",\"controller-resolution\"]},\"hookRecordId\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":256}]},\"claimHandling\":{\"enum\":[\"retain\",\"release-authorized\"]},\"observedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"outcomeDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"target\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetTaskId\",\"workType\",\"phase\"],\"properties\":{\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"workType\":{\"enum\":[\"implementation\",\"test\"]},\"phase\":{\"enum\":[\"host-effect-accepted\",\"host-effect-indeterminate\",\"host-effect-rejected\",\"test-host-effect-accepted\",\"test-host-effect-indeterminate\",\"test-host-effect-rejected\"]}}}}}");
