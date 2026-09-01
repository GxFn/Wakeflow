/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-target-host-effect-outcome-result.schema.json
 */

/**
 * Successful result for one idempotently recorded implementation or test Target Host Effect observation.
 */
export type WakeflowTargetHostEffectOutcomeResultV1 = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowTargetHostEffectOutcomeResult"
schemaVersion: 1
tool: "wakeflow_record_target_host_effect_outcome"
status: ("recorded" | "already-recorded")
disposition: ("committed" | "idempotent")
effectDisposition: ("accepted" | "indeterminate" | "rejected-before-effect")
claimHandling: ("retain" | "release-authorized")
claimAuthority: ("current" | "released")
eventAuthority: "current"
target: (ImplementationTarget | TestTarget)
claim: Claim
observation: Observation
event: EventReceipt
commit: CommitReceipt
stateDigest: Sha256Digest
})
export type DemandId = string
export type TargetTaskId = string
export type TargetDeliveryId = string
export type TestAttemptId = string
export type Sha256Digest = string
export type ClaimId = string
export type Readback = (UnavailableReadback | ObservedReadback)
export type UtcInstant = string
export type EventId = string
export type CommitId = string

export interface ImplementationTarget {
workType: "implementation"
demandId: DemandId
targetTaskId: TargetTaskId
targetDeliveryId: TargetDeliveryId
}
export interface TestTarget {
workType: "test"
demandId: DemandId
targetTaskId: TargetTaskId
targetDeliveryId: TargetDeliveryId
testAttemptId: TestAttemptId
testDispatchPacketDigest: Sha256Digest
}
export interface Claim {
actionId: ClaimId
claimDigest: Sha256Digest
}
export interface Observation {
kind: "WakeflowTargetHostEffectObservationSummary"
schemaVersion: 1
source: "agent-host-effect-observation"
attempt: Attempt
readback: Readback
observedAt: UtcInstant
observationDigest: Sha256Digest
}
export interface Attempt {
status: ("accepted" | "indeterminate" | "rejected-before-effect")
evidenceDigest: Sha256Digest
}
export interface UnavailableReadback {
status: "unavailable"
}
export interface ObservedReadback {
status: ("confirmed" | "pending")
evidenceDigest: Sha256Digest
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
export const WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:target-host-effect-outcome-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_RESULT_SCHEMA\",\"title\":\"WakeflowTargetHostEffectOutcomeResultV1\",\"description\":\"Successful result for one idempotently recorded implementation or test Target Host Effect observation.\",\"$comment\":\"The result contains only Claim-selected identity, digest-only observation facts, Event/Commit receipts, and Claim settlement state. It never contains raw evidence, a Host handle, prompt, or workspace root.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"status\",\"disposition\",\"effectDisposition\",\"claimHandling\",\"claimAuthority\",\"eventAuthority\",\"target\",\"claim\",\"observation\",\"event\",\"commit\",\"stateDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTargetHostEffectOutcomeResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_record_target_host_effect_outcome\"},\"status\":{\"enum\":[\"recorded\",\"already-recorded\"]},\"disposition\":{\"enum\":[\"committed\",\"idempotent\"]},\"effectDisposition\":{\"enum\":[\"accepted\",\"indeterminate\",\"rejected-before-effect\"]},\"claimHandling\":{\"enum\":[\"retain\",\"release-authorized\"]},\"claimAuthority\":{\"enum\":[\"current\",\"released\"]},\"eventAuthority\":{\"const\":\"current\"},\"target\":{\"oneOf\":[{\"$ref\":\"#/$defs/implementationTarget\"},{\"$ref\":\"#/$defs/testTarget\"}]},\"claim\":{\"$ref\":\"#/$defs/claim\"},\"observation\":{\"$ref\":\"#/$defs/observation\"},\"event\":{\"$ref\":\"#/$defs/eventReceipt\"},\"commit\":{\"$ref\":\"#/$defs/commitReceipt\"},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}},\"allOf\":[{\"if\":{\"type\":\"object\",\"properties\":{\"status\":{\"const\":\"recorded\"}},\"required\":[\"status\"]},\"then\":{\"type\":\"object\",\"properties\":{\"disposition\":{\"const\":\"committed\"}}}},{\"if\":{\"type\":\"object\",\"properties\":{\"status\":{\"const\":\"already-recorded\"}},\"required\":[\"status\"]},\"then\":{\"type\":\"object\",\"properties\":{\"disposition\":{\"const\":\"idempotent\"}}}},{\"if\":{\"type\":\"object\",\"properties\":{\"effectDisposition\":{\"const\":\"accepted\"}},\"required\":[\"effectDisposition\"]},\"then\":{\"type\":\"object\",\"properties\":{\"claimHandling\":{\"const\":\"retain\"},\"claimAuthority\":{\"const\":\"current\"},\"observation\":{\"allOf\":[{\"$ref\":\"#/$defs/observation\"},{\"oneOf\":[{\"type\":\"object\",\"properties\":{\"attempt\":{\"type\":\"object\",\"properties\":{\"status\":{\"const\":\"accepted\"}}}}},{\"type\":\"object\",\"properties\":{\"attempt\":{\"type\":\"object\",\"properties\":{\"status\":{\"const\":\"indeterminate\"}}},\"readback\":{\"type\":\"object\",\"properties\":{\"status\":{\"const\":\"confirmed\"}}}}}]}]}}}},{\"if\":{\"type\":\"object\",\"properties\":{\"effectDisposition\":{\"const\":\"indeterminate\"}},\"required\":[\"effectDisposition\"]},\"then\":{\"type\":\"object\",\"properties\":{\"claimHandling\":{\"const\":\"retain\"},\"claimAuthority\":{\"const\":\"current\"},\"observation\":{\"allOf\":[{\"$ref\":\"#/$defs/observation\"},{\"type\":\"object\",\"properties\":{\"attempt\":{\"type\":\"object\",\"properties\":{\"status\":{\"const\":\"indeterminate\"}}},\"readback\":{\"type\":\"object\",\"properties\":{\"status\":{\"enum\":[\"pending\",\"unavailable\"]}}}}}]}}}},{\"if\":{\"type\":\"object\",\"properties\":{\"effectDisposition\":{\"const\":\"rejected-before-effect\"}},\"required\":[\"effectDisposition\"]},\"then\":{\"type\":\"object\",\"properties\":{\"claimHandling\":{\"const\":\"release-authorized\"},\"claimAuthority\":{\"const\":\"released\"},\"observation\":{\"allOf\":[{\"$ref\":\"#/$defs/observation\"},{\"type\":\"object\",\"properties\":{\"attempt\":{\"type\":\"object\",\"properties\":{\"status\":{\"const\":\"rejected-before-effect\"}}},\"readback\":{\"type\":\"object\",\"properties\":{\"status\":{\"const\":\"unavailable\"}}}}}]}}}}],\"$defs\":{\"implementationTarget\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"workType\",\"demandId\",\"targetTaskId\",\"targetDeliveryId\"],\"properties\":{\"workType\":{\"const\":\"implementation\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"targetDeliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"}}},\"testTarget\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"workType\",\"demandId\",\"targetTaskId\",\"targetDeliveryId\",\"testAttemptId\",\"testDispatchPacketDigest\"],\"properties\":{\"workType\":{\"const\":\"test\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"targetDeliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"},\"testAttemptId\":{\"$ref\":\"#/$defs/testAttemptId\"},\"testDispatchPacketDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"claim\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"actionId\",\"claimDigest\"],\"properties\":{\"actionId\":{\"$ref\":\"#/$defs/claimId\"},\"claimDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"observation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"source\",\"attempt\",\"readback\",\"observedAt\",\"observationDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTargetHostEffectObservationSummary\"},\"schemaVersion\":{\"const\":1},\"source\":{\"const\":\"agent-host-effect-observation\"},\"attempt\":{\"$ref\":\"#/$defs/attempt\"},\"readback\":{\"$ref\":\"#/$defs/readback\"},\"observedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"observationDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"attempt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"evidenceDigest\"],\"properties\":{\"status\":{\"enum\":[\"accepted\",\"indeterminate\",\"rejected-before-effect\"]},\"evidenceDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"readback\":{\"oneOf\":[{\"$ref\":\"#/$defs/unavailableReadback\"},{\"$ref\":\"#/$defs/observedReadback\"}]},\"unavailableReadback\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\"],\"properties\":{\"status\":{\"const\":\"unavailable\"}}},\"observedReadback\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"evidenceDigest\"],\"properties\":{\"status\":{\"enum\":[\"confirmed\",\"pending\"]},\"evidenceDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"eventReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"eventId\",\"streamRevision\"],\"properties\":{\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991}}},\"commitReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"commitId\",\"commitSequence\",\"commitDigest\"],\"properties\":{\"commitId\":{\"$ref\":\"#/$defs/commitId\"},\"commitSequence\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"commitDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetDeliveryId\":{\"type\":\"string\",\"pattern\":\"^target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"testAttemptId\":{\"type\":\"string\",\"pattern\":\"^test-attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"claimId\":{\"type\":\"string\",\"pattern\":\"^window_work_claim_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}");
