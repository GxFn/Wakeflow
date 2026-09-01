/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-target-host-effect-rearm-result.schema.json
 */

/**
 * Successful result for one idempotently rearmed implementation Host Effect generation.
 */
export type WakeflowTargetHostEffectRearmResultV1 = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowTargetHostEffectRearmResult"
schemaVersion: 1
tool: "wakeflow_rearm_target_host_effect"
status: ("rearmed" | "already-rearmed")
disposition: ("committed" | "idempotent")
claimAuthority: "released"
eventAuthority: "current"
rearm: Rearm
event: EventReceipt
commit: CommitReceipt
stateDigest: Sha256Digest
})
export type DemandId = string
export type TargetTaskId = string
export type TargetDeliveryId = string
export type ClaimId = string
export type Sha256Digest = string
export type EventId = string
export type CommitId = string
export type UtcInstant = string

export interface Rearm {
kind: "WakeflowTargetHostEffectRearm"
schemaVersion: 1
target: Target
rejectedAttempt: RejectedAttempt
rearmedAt: UtcInstant
rearmDigest: Sha256Digest
}
export interface Target {
demandId: DemandId
targetTaskId: TargetTaskId
targetDeliveryId: TargetDeliveryId
}
export interface RejectedAttempt {
claimId: ClaimId
claimDigest: Sha256Digest
claimEventId: EventId
claimCommitId: CommitId
observationDigest: Sha256Digest
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
export const WAKEFLOW_TARGET_HOST_EFFECT_REARM_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:target-host-effect-rearm-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TARGET_HOST_EFFECT_REARM_RESULT_SCHEMA\",\"title\":\"WakeflowTargetHostEffectRearmResultV1\",\"description\":\"Successful result for one idempotently rearmed implementation Host Effect generation.\",\"$comment\":\"A successful Rearm only appends its Event and proves the rejected Claim selected by actionId was released before that Event. It never performs the Host effect, creates a new Claim, or returns an Agent Host Action.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"status\",\"disposition\",\"claimAuthority\",\"eventAuthority\",\"rearm\",\"event\",\"commit\",\"stateDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTargetHostEffectRearmResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_rearm_target_host_effect\"},\"status\":{\"enum\":[\"rearmed\",\"already-rearmed\"]},\"disposition\":{\"enum\":[\"committed\",\"idempotent\"]},\"claimAuthority\":{\"const\":\"released\"},\"eventAuthority\":{\"const\":\"current\"},\"rearm\":{\"$ref\":\"#/$defs/rearm\"},\"event\":{\"$ref\":\"#/$defs/eventReceipt\"},\"commit\":{\"$ref\":\"#/$defs/commitReceipt\"},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}},\"allOf\":[{\"if\":{\"properties\":{\"status\":{\"const\":\"rearmed\"}},\"required\":[\"status\"]},\"then\":{\"properties\":{\"disposition\":{\"const\":\"committed\"}}}},{\"if\":{\"properties\":{\"status\":{\"const\":\"already-rearmed\"}},\"required\":[\"status\"]},\"then\":{\"properties\":{\"disposition\":{\"const\":\"idempotent\"}}}}],\"$defs\":{\"rearm\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"target\",\"rejectedAttempt\",\"rearmedAt\",\"rearmDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTargetHostEffectRearm\"},\"schemaVersion\":{\"const\":1},\"target\":{\"$ref\":\"#/$defs/target\"},\"rejectedAttempt\":{\"$ref\":\"#/$defs/rejectedAttempt\"},\"rearmedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"rearmDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"target\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"demandId\",\"targetTaskId\",\"targetDeliveryId\"],\"properties\":{\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"targetDeliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"}}},\"rejectedAttempt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"claimId\",\"claimDigest\",\"claimEventId\",\"claimCommitId\",\"observationDigest\"],\"properties\":{\"claimId\":{\"$ref\":\"#/$defs/claimId\"},\"claimDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"claimEventId\":{\"$ref\":\"#/$defs/eventId\"},\"claimCommitId\":{\"$ref\":\"#/$defs/commitId\"},\"observationDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"eventReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"eventId\",\"streamRevision\"],\"properties\":{\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991}}},\"commitReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"commitId\",\"commitSequence\",\"commitDigest\"],\"properties\":{\"commitId\":{\"$ref\":\"#/$defs/commitId\"},\"commitSequence\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"commitDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetDeliveryId\":{\"type\":\"string\",\"pattern\":\"^target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"claimId\":{\"type\":\"string\",\"pattern\":\"^window_work_claim_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"}}}");
