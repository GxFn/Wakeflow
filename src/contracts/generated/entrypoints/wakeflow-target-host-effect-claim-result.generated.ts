/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-target-host-effect-claim-result.schema.json
 */

/**
 * Successful result for one shared implementation or test Target Host Effect Claim.
 */
export type WakeflowTargetHostEffectClaimResultV1 = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowTargetHostEffectClaimResult"
schemaVersion: 1
tool: "wakeflow_claim_target_host_effect"
status: ("issued" | "already-claimed")
disposition: ("committed" | "idempotent")
claimAuthority: "current"
eventAuthority: "current"
claim: (ImplementationClaim | TestClaim)
event: EventReceipt
commit: CommitReceipt
stateDigest: Sha256Digest
action: (ImplementationAction | TestAction | null)
} & ({
claim: ImplementationClaim
action: (ImplementationAction | null)
[k: string]: unknown | undefined
} | {
claim: TestClaim
action: (TestAction | null)
[k: string]: unknown | undefined
}))
export type ClaimId = string
export type ClaimRef = string
export type Sha256Digest = string
export type UtcInstant = string
export type DemandId = string
export type TargetTaskId = string
export type TargetDeliveryId = string
export type HostId = ("codex" | "claude-code")
export type WindowId = string
export type BindingId = string
export type TestAttemptId = string
export type EventId = string
export type CommitId = string
export type ActionPrompt = string
export type PortableResourcePath = string

export interface ImplementationClaim {
claimId: ClaimId
claimRef: ClaimRef
claimDigest: Sha256Digest
claimedAt: UtcInstant
target: ImplementationTarget
route: Route
}
export interface ImplementationTarget {
workType: "implementation"
demandId: DemandId
targetTaskId: TargetTaskId
targetDeliveryId: TargetDeliveryId
intentDigest: Sha256Digest
}
export interface Route {
hostId: HostId
windowId: WindowId
bindingId: BindingId
}
export interface TestClaim {
claimId: ClaimId
claimRef: ClaimRef
claimDigest: Sha256Digest
claimedAt: UtcInstant
target: TestTarget
route: Route
}
export interface TestTarget {
workType: "test"
demandId: DemandId
targetTaskId: TargetTaskId
targetDeliveryId: TargetDeliveryId
intentDigest: Sha256Digest
testAttemptId: TestAttemptId
testDispatchPacketDigest: Sha256Digest
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
export interface ImplementationAction {
kind: "WakeflowTargetDeliveryAgentHostAction"
schemaVersion: 1
actionId: ClaimId
effect: "send-message-to-observed-target-window"
hostId: HostId
windowId: WindowId
bindingId: BindingId
targetDeliveryId: TargetDeliveryId
intentDigest: Sha256Digest
workClaim: ActionWorkClaim
hostObservation: ActionHostObservation
prompt: ActionPrompt
issuedAt: UtcInstant
claimEvent: ActionClaimEvent
}
export interface ActionWorkClaim {
claimId: ClaimId
claimRef: ClaimRef
claimDigest: Sha256Digest
expectedStateDigest: Sha256Digest
claimCommitId: CommitId
}
export interface ActionHostObservation {
authorityDigest: Sha256Digest
observedAt: UtcInstant
}
export interface ActionClaimEvent {
eventId: EventId
streamRevision: number
stateDigest: Sha256Digest
}
export interface TestAction {
kind: "WakeflowTestDeliveryAgentHostAction"
schemaVersion: 1
actionId: ClaimId
effect: "send-message-to-observed-target-window"
hostId: HostId
windowId: WindowId
bindingId: BindingId
targetDeliveryId: TargetDeliveryId
intentDigest: Sha256Digest
testAttemptId: TestAttemptId
testDispatchPacket: TestDispatchPacketReference
workClaim: ActionWorkClaim
hostObservation: ActionHostObservation
prompt: ActionPrompt
issuedAt: UtcInstant
claimEvent: ActionClaimEvent
}
export interface TestDispatchPacketReference {
ref: PortableResourcePath
digest: Sha256Digest
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
export const WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:target-host-effect-claim-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_RESULT_SCHEMA\",\"title\":\"WakeflowTargetHostEffectClaimResultV1\",\"description\":\"Successful result for one shared implementation or test Target Host Effect Claim.\",\"$comment\":\"Only status=issued carries the transient Agent Host Action. Idempotent replay returns action=null and never reissues permission for a possibly performed host effect. Raw handles are forbidden from every result shape; the canonical workspace root may occur only inside the issued action prompt.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"status\",\"disposition\",\"claimAuthority\",\"eventAuthority\",\"claim\",\"event\",\"commit\",\"stateDigest\",\"action\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTargetHostEffectClaimResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_claim_target_host_effect\"},\"status\":{\"enum\":[\"issued\",\"already-claimed\"]},\"disposition\":{\"enum\":[\"committed\",\"idempotent\"]},\"claimAuthority\":{\"const\":\"current\"},\"eventAuthority\":{\"const\":\"current\"},\"claim\":{\"oneOf\":[{\"$ref\":\"#/$defs/implementationClaim\"},{\"$ref\":\"#/$defs/testClaim\"}]},\"event\":{\"$ref\":\"#/$defs/eventReceipt\"},\"commit\":{\"$ref\":\"#/$defs/commitReceipt\"},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"action\":{\"oneOf\":[{\"$ref\":\"#/$defs/implementationAction\"},{\"$ref\":\"#/$defs/testAction\"},{\"type\":\"null\"}]}},\"allOf\":[{\"if\":{\"type\":\"object\",\"properties\":{\"status\":{\"const\":\"issued\"}},\"required\":[\"status\"]},\"then\":{\"type\":\"object\",\"properties\":{\"disposition\":{\"const\":\"committed\"},\"action\":{\"oneOf\":[{\"$ref\":\"#/$defs/implementationAction\"},{\"$ref\":\"#/$defs/testAction\"}]}}}},{\"if\":{\"type\":\"object\",\"properties\":{\"status\":{\"const\":\"already-claimed\"}},\"required\":[\"status\"]},\"then\":{\"type\":\"object\",\"properties\":{\"disposition\":{\"const\":\"idempotent\"},\"action\":{\"type\":\"null\"}}}}],\"oneOf\":[{\"type\":\"object\",\"required\":[\"claim\",\"action\"],\"properties\":{\"claim\":{\"$ref\":\"#/$defs/implementationClaim\"},\"action\":{\"oneOf\":[{\"$ref\":\"#/$defs/implementationAction\"},{\"type\":\"null\"}]}}},{\"type\":\"object\",\"required\":[\"claim\",\"action\"],\"properties\":{\"claim\":{\"$ref\":\"#/$defs/testClaim\"},\"action\":{\"oneOf\":[{\"$ref\":\"#/$defs/testAction\"},{\"type\":\"null\"}]}}}],\"$defs\":{\"implementationClaim\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"claimId\",\"claimRef\",\"claimDigest\",\"claimedAt\",\"target\",\"route\"],\"properties\":{\"claimId\":{\"$ref\":\"#/$defs/claimId\"},\"claimRef\":{\"$ref\":\"#/$defs/claimRef\"},\"claimDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"claimedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"target\":{\"$ref\":\"#/$defs/implementationTarget\"},\"route\":{\"$ref\":\"#/$defs/route\"}}},\"testClaim\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"claimId\",\"claimRef\",\"claimDigest\",\"claimedAt\",\"target\",\"route\"],\"properties\":{\"claimId\":{\"$ref\":\"#/$defs/claimId\"},\"claimRef\":{\"$ref\":\"#/$defs/claimRef\"},\"claimDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"claimedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"target\":{\"$ref\":\"#/$defs/testTarget\"},\"route\":{\"$ref\":\"#/$defs/route\"}}},\"implementationTarget\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"workType\",\"demandId\",\"targetTaskId\",\"targetDeliveryId\",\"intentDigest\"],\"properties\":{\"workType\":{\"const\":\"implementation\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"targetDeliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"},\"intentDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"testTarget\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"workType\",\"demandId\",\"targetTaskId\",\"targetDeliveryId\",\"intentDigest\",\"testAttemptId\",\"testDispatchPacketDigest\"],\"properties\":{\"workType\":{\"const\":\"test\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"targetDeliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"},\"intentDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"testAttemptId\":{\"$ref\":\"#/$defs/testAttemptId\"},\"testDispatchPacketDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"route\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"hostId\",\"windowId\",\"bindingId\"],\"properties\":{\"hostId\":{\"$ref\":\"#/$defs/hostId\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"bindingId\":{\"$ref\":\"#/$defs/bindingId\"}}},\"implementationAction\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"actionId\",\"effect\",\"hostId\",\"windowId\",\"bindingId\",\"targetDeliveryId\",\"intentDigest\",\"workClaim\",\"hostObservation\",\"prompt\",\"issuedAt\",\"claimEvent\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTargetDeliveryAgentHostAction\"},\"schemaVersion\":{\"const\":1},\"actionId\":{\"$ref\":\"#/$defs/claimId\"},\"effect\":{\"const\":\"send-message-to-observed-target-window\"},\"hostId\":{\"$ref\":\"#/$defs/hostId\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"bindingId\":{\"$ref\":\"#/$defs/bindingId\"},\"targetDeliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"},\"intentDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"workClaim\":{\"$ref\":\"#/$defs/actionWorkClaim\"},\"hostObservation\":{\"$ref\":\"#/$defs/actionHostObservation\"},\"prompt\":{\"$ref\":\"#/$defs/actionPrompt\"},\"issuedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"claimEvent\":{\"$ref\":\"#/$defs/actionClaimEvent\"}}},\"testAction\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"actionId\",\"effect\",\"hostId\",\"windowId\",\"bindingId\",\"targetDeliveryId\",\"intentDigest\",\"testAttemptId\",\"testDispatchPacket\",\"workClaim\",\"hostObservation\",\"prompt\",\"issuedAt\",\"claimEvent\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTestDeliveryAgentHostAction\"},\"schemaVersion\":{\"const\":1},\"actionId\":{\"$ref\":\"#/$defs/claimId\"},\"effect\":{\"const\":\"send-message-to-observed-target-window\"},\"hostId\":{\"$ref\":\"#/$defs/hostId\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"bindingId\":{\"$ref\":\"#/$defs/bindingId\"},\"targetDeliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"},\"intentDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"testAttemptId\":{\"$ref\":\"#/$defs/testAttemptId\"},\"testDispatchPacket\":{\"$ref\":\"#/$defs/testDispatchPacketReference\"},\"workClaim\":{\"$ref\":\"#/$defs/actionWorkClaim\"},\"hostObservation\":{\"$ref\":\"#/$defs/actionHostObservation\"},\"prompt\":{\"$ref\":\"#/$defs/actionPrompt\"},\"issuedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"claimEvent\":{\"$ref\":\"#/$defs/actionClaimEvent\"}}},\"actionWorkClaim\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"claimId\",\"claimRef\",\"claimDigest\",\"expectedStateDigest\",\"claimCommitId\"],\"properties\":{\"claimId\":{\"$ref\":\"#/$defs/claimId\"},\"claimRef\":{\"$ref\":\"#/$defs/claimRef\"},\"claimDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"expectedStateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"claimCommitId\":{\"$ref\":\"#/$defs/commitId\"}}},\"actionHostObservation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"authorityDigest\",\"observedAt\"],\"properties\":{\"authorityDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"observedAt\":{\"$ref\":\"#/$defs/utcInstant\"}}},\"actionClaimEvent\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"eventId\",\"streamRevision\",\"stateDigest\"],\"properties\":{\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"testDispatchPacketReference\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"ref\",\"digest\"],\"properties\":{\"ref\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"digest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"eventReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"eventId\",\"streamRevision\"],\"properties\":{\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991}}},\"commitReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"commitId\",\"commitSequence\",\"commitDigest\"],\"properties\":{\"commitId\":{\"$ref\":\"#/$defs/commitId\"},\"commitSequence\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"commitDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"actionPrompt\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":131072,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"pattern\":\"^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\\\.{1,2}(?:/|$))(?!.*\\\\/\\\\.{1,2}(?:/|$))(?!.*\\\\\\\\)(?!.*//)(?!.*\\\\/$)(?!\\\\s)(?!.*\\\\s$)(?!.*\\\\/\\\\s)(?!.*\\\\s\\\\/)(?!.*[\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]).+$\"},\"claimRef\":{\"type\":\"string\",\"pattern\":\"^\\\\.wakeflow-local/runtime/shared/coordination/window-work-claims/window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\\\.json$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"hostId\":{\"enum\":[\"codex\",\"claude-code\"]},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetDeliveryId\":{\"type\":\"string\",\"pattern\":\"^target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"testAttemptId\":{\"type\":\"string\",\"pattern\":\"^test-attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"bindingId\":{\"type\":\"string\",\"pattern\":\"^window_binding_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"claimId\":{\"type\":\"string\",\"pattern\":\"^window_work_claim_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}");
