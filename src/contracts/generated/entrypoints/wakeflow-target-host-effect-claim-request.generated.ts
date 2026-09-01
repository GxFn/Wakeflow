/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-target-host-effect-claim-request.schema.json
 */

/**
 * Closed MCP request for acquiring one durable Target Host Effect Claim from a fresh Agent observation without performing the host effect.
 */
export type WakeflowTargetHostEffectClaimRequestV1 = (ImplementationRequest | TestRequest)
/**
 * Absolute path of the existing Wakeflow workspace root.
 */
export type WorkspaceRoot = string
export type DemandId = string
export type TargetTaskId = string
export type TargetDeliveryId = string
export type Sha256Digest = string
export type HostId = ("codex" | "claude-code")
export type WindowId = string
export type BindingId = string
export type LogicalRoot = (ProgramLogicalRoot | SupportSurfaceLogicalRoot | RepositoryLogicalRoot)
export type ProgramId = string
export type SurfaceId = string
export type RepositoryId = string
export type ConfiguredPlacement = string
export type UtcInstant = string

export interface ImplementationRequest {
root: WorkspaceRoot
workType: "implementation"
demandId: DemandId
targetTaskId: TargetTaskId
targetDeliveryId: TargetDeliveryId
intentDigest: Sha256Digest
observation: Observation
}
export interface Observation {
kind: "WakeflowAgentHostWindowObservation"
schemaVersion: 1
source: "agent-host-inspection-result"
hostId: HostId
windowId: WindowId
bindingId: BindingId
handle: HostHandle
attestedRoot: AttestedRoot
observedAt: UtcInstant
}
export interface HostHandle {
kind: string
/**
 * Opaque request-only host handle. It must not be persisted, logged, or returned.
 */
value: string
}
export interface AttestedRoot {
status: "matches-configured-root"
logicalRoot: LogicalRoot
configuredPlacement: ConfiguredPlacement
}
export interface ProgramLogicalRoot {
kind: "program"
programId: ProgramId
}
export interface SupportSurfaceLogicalRoot {
kind: "support-surface"
surfaceId: SurfaceId
}
export interface RepositoryLogicalRoot {
kind: "repository"
repositoryId: RepositoryId
}
export interface TestRequest {
root: WorkspaceRoot
workType: "test"
demandId: DemandId
targetTaskId: TargetTaskId
targetDeliveryId: TargetDeliveryId
intentDigest: Sha256Digest
testDispatchPacketDigest: Sha256Digest
observation: Observation
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
export const WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:target-host-effect-claim-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_REQUEST_SCHEMA\",\"title\":\"WakeflowTargetHostEffectClaimRequestV1\",\"description\":\"Closed MCP request for acquiring one durable Target Host Effect Claim from a fresh Agent observation without performing the host effect.\",\"$comment\":\"The implementation and test variants share one Claim owner. The raw handle is request-only secret input used to match the current private Binding and must never be persisted or returned.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/implementationRequest\"},{\"$ref\":\"#/$defs/testRequest\"}],\"$defs\":{\"implementationRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"workType\",\"demandId\",\"targetTaskId\",\"targetDeliveryId\",\"intentDigest\",\"observation\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"workType\":{\"const\":\"implementation\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"targetDeliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"},\"intentDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"observation\":{\"$ref\":\"#/$defs/observation\"}}},\"testRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"workType\",\"demandId\",\"targetTaskId\",\"targetDeliveryId\",\"intentDigest\",\"testDispatchPacketDigest\",\"observation\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"workType\":{\"const\":\"test\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"targetDeliveryId\":{\"$ref\":\"#/$defs/targetDeliveryId\"},\"intentDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"testDispatchPacketDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"observation\":{\"$ref\":\"#/$defs/observation\"}}},\"observation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"source\",\"hostId\",\"windowId\",\"bindingId\",\"handle\",\"attestedRoot\",\"observedAt\"],\"properties\":{\"kind\":{\"const\":\"WakeflowAgentHostWindowObservation\"},\"schemaVersion\":{\"const\":1},\"source\":{\"const\":\"agent-host-inspection-result\"},\"hostId\":{\"$ref\":\"#/$defs/hostId\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"bindingId\":{\"$ref\":\"#/$defs/bindingId\"},\"handle\":{\"$ref\":\"#/$defs/hostHandle\"},\"attestedRoot\":{\"$ref\":\"#/$defs/attestedRoot\"},\"observedAt\":{\"$ref\":\"#/$defs/utcInstant\"}}},\"hostHandle\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"value\"],\"properties\":{\"kind\":{\"type\":\"string\",\"pattern\":\"^[a-z][a-z0-9-]{0,63}$\"},\"value\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":1024,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\",\"description\":\"Opaque request-only host handle. It must not be persisted, logged, or returned.\"}}},\"attestedRoot\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"logicalRoot\",\"configuredPlacement\"],\"properties\":{\"status\":{\"const\":\"matches-configured-root\"},\"logicalRoot\":{\"$ref\":\"#/$defs/logicalRoot\"},\"configuredPlacement\":{\"$ref\":\"#/$defs/configuredPlacement\"}}},\"logicalRoot\":{\"oneOf\":[{\"$ref\":\"#/$defs/programLogicalRoot\"},{\"$ref\":\"#/$defs/supportSurfaceLogicalRoot\"},{\"$ref\":\"#/$defs/repositoryLogicalRoot\"}]},\"programLogicalRoot\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"programId\"],\"properties\":{\"kind\":{\"const\":\"program\"},\"programId\":{\"$ref\":\"#/$defs/programId\"}}},\"supportSurfaceLogicalRoot\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"surfaceId\"],\"properties\":{\"kind\":{\"const\":\"support-surface\"},\"surfaceId\":{\"$ref\":\"#/$defs/surfaceId\"}}},\"repositoryLogicalRoot\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"repositoryId\"],\"properties\":{\"kind\":{\"const\":\"repository\"},\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"}}},\"workspaceRoot\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"configuredPlacement\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":4096,\"pattern\":\"^(?!.*[\\\\\\\\\\\\u0000-\\\\u001f\\\\u007f-\\\\u009f])\\\\S(?:.*\\\\S)?$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"hostId\":{\"enum\":[\"codex\",\"claude-code\"]},\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"surfaceId\":{\"type\":\"string\",\"pattern\":\"^surface_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetDeliveryId\":{\"type\":\"string\",\"pattern\":\"^target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"bindingId\":{\"type\":\"string\",\"pattern\":\"^window_binding_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}");
