/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-window-host-binding-registration-request.schema.json
 */

/**
 * Closed MCP input contract for one execution-endpoint operation on a logical window: inspect (launch intent and current binding, claim, and locator state), register (bind the handle the Agent observed), replace (bind a new handle with CAS on the old binding), decommission (release the binding with closure evidence), or release-claim (force-release an expired or orphaned work claim with liveness evidence).
 */
export type WakeflowWindowHostBindingRegistrationRequestV1 = (InspectRequest | RegisterRequest | ReplaceRequest | DecommissionRequest | ReleaseClaimRequest)
/**
 * Absolute path of the existing workspace root. Physical root validation remains owned by RootedDirectory.
 */
export type Root = string
export type WindowId = string
export type Sha256Digest = string
export type UtcInstant = string
export type BindingId = string
export type LivenessObservation = ({
kind: "tmux-panes"
/**
 * @maxItems 16
 */
panes: []|[TmuxPaneObservation]|[TmuxPaneObservation, TmuxPaneObservation]|[TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation]|[TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation]|[TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation]|[TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation]|[TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation]|[TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation]|[TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation]|[TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation]|[TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation]|[TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation]|[TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation]|[TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation]|[TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation]|[TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation, TmuxPaneObservation]
} | {
kind: "codex-thread"
status: ("active" | "archived" | "unknown")
} | {
kind: "unobserved"
})

export interface InspectRequest {
root: Root
operation: "inspect"
windowId: WindowId
}
export interface RegisterRequest {
root: Root
operation: "register"
windowId: WindowId
observation: CreationObservation
}
/**
 * What the Agent observed after executing one launch intent: the opaque host handle and, on Claude Code, the tmux coordinates of the pane running the session.
 */
export interface CreationObservation {
handle: HostHandle
launchIntentDigest: Sha256Digest
observedAt: UtcInstant
tmux?: TmuxCoordinates
}
export interface HostHandle {
kind: string
value: string
}
export interface TmuxCoordinates {
socketName: (null | string)
sessionName: string
windowId: string
paneId: string
}
export interface ReplaceRequest {
root: Root
operation: "replace"
windowId: WindowId
observation: CreationObservation
expectedBindingId: BindingId
expectedBindingDigest: Sha256Digest
}
export interface DecommissionRequest {
root: Root
operation: "decommission"
windowId: WindowId
expectedBindingId: BindingId
expectedBindingDigest: Sha256Digest
closure: {
preClose: LivenessObservation
closeResult: {
status: ("closed" | "failed" | "unknown")
}
postClose: LivenessObservation
}
}
/**
 * One row of `tmux list-panes -a` with the five Wakeflow window options the Agent read back; Wakeflow classifies it, the Agent never judges liveness.
 */
export interface TmuxPaneObservation {
socketName: (null | string)
sessionName: string
windowId: string
paneId: string
paneWindowId: string
paneDead: boolean
currentCommand: string
options: {
programId: (null | string)
hostId: (null | string)
windowId: (null | string)
bindingId: (null | string)
locatorId: (null | string)
}
}
export interface ReleaseClaimRequest {
root: Root
operation: "release-claim"
windowId: WindowId
expectedClaimDigest: Sha256Digest
evidence: {
liveness: LivenessObservation
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
export const WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:window-host-binding-registration-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_REQUEST_SCHEMA\",\"title\":\"WakeflowWindowHostBindingRegistrationRequestV1\",\"description\":\"Closed MCP input contract for one execution-endpoint operation on a logical window: inspect (launch intent and current binding, claim, and locator state), register (bind the handle the Agent observed), replace (bind a new handle with CAS on the old binding), decommission (release the binding with closure evidence), or release-claim (force-release an expired or orphaned work claim with liveness evidence).\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/inspectRequest\"},{\"$ref\":\"#/$defs/registerRequest\"},{\"$ref\":\"#/$defs/replaceRequest\"},{\"$ref\":\"#/$defs/decommissionRequest\"},{\"$ref\":\"#/$defs/releaseClaimRequest\"}],\"$defs\":{\"root\":{\"type\":\"string\",\"description\":\"Absolute path of the existing workspace root. Physical root validation remains owned by RootedDirectory.\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"bindingId\":{\"type\":\"string\",\"pattern\":\"^window_binding_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"hostHandle\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"value\"],\"properties\":{\"kind\":{\"type\":\"string\",\"pattern\":\"^[a-z][a-z0-9-]{0,63}$\"},\"value\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":1024}}},\"tmuxCoordinates\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"socketName\",\"sessionName\",\"windowId\",\"paneId\"],\"properties\":{\"socketName\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":128}]},\"sessionName\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128},\"windowId\":{\"type\":\"string\",\"pattern\":\"^@[0-9]{1,9}$\"},\"paneId\":{\"type\":\"string\",\"pattern\":\"^%[0-9]{1,9}$\"}}},\"creationObservation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"handle\",\"launchIntentDigest\",\"observedAt\"],\"properties\":{\"handle\":{\"$ref\":\"#/$defs/hostHandle\"},\"launchIntentDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"observedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"tmux\":{\"$ref\":\"#/$defs/tmuxCoordinates\"}},\"description\":\"What the Agent observed after executing one launch intent: the opaque host handle and, on Claude Code, the tmux coordinates of the pane running the session.\"},\"tmuxPaneObservation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"socketName\",\"sessionName\",\"windowId\",\"paneId\",\"paneWindowId\",\"paneDead\",\"currentCommand\",\"options\"],\"properties\":{\"socketName\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":128}]},\"sessionName\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128},\"windowId\":{\"type\":\"string\",\"pattern\":\"^@[0-9]{1,9}$\"},\"paneId\":{\"type\":\"string\",\"pattern\":\"^%[0-9]{1,9}$\"},\"paneWindowId\":{\"type\":\"string\",\"pattern\":\"^@[0-9]{1,9}$\"},\"paneDead\":{\"type\":\"boolean\"},\"currentCommand\":{\"type\":\"string\",\"maxLength\":256},\"options\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"programId\",\"hostId\",\"windowId\",\"bindingId\",\"locatorId\"],\"properties\":{\"programId\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"maxLength\":256}]},\"hostId\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"maxLength\":64}]},\"windowId\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"maxLength\":256}]},\"bindingId\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"maxLength\":256}]},\"locatorId\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"maxLength\":256}]}}}},\"description\":\"One row of `tmux list-panes -a` with the five Wakeflow window options the Agent read back; Wakeflow classifies it, the Agent never judges liveness.\"},\"livenessObservation\":{\"oneOf\":[{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"panes\"],\"properties\":{\"kind\":{\"const\":\"tmux-panes\"},\"panes\":{\"type\":\"array\",\"maxItems\":16,\"items\":{\"$ref\":\"#/$defs/tmuxPaneObservation\"}}}},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"status\"],\"properties\":{\"kind\":{\"const\":\"codex-thread\"},\"status\":{\"enum\":[\"active\",\"archived\",\"unknown\"]}}},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\"],\"properties\":{\"kind\":{\"const\":\"unobserved\"}}}]},\"inspectRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"operation\",\"windowId\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/root\"},\"operation\":{\"const\":\"inspect\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"}}},\"registerRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"operation\",\"windowId\",\"observation\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/root\"},\"operation\":{\"const\":\"register\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"observation\":{\"$ref\":\"#/$defs/creationObservation\"}}},\"replaceRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"operation\",\"windowId\",\"observation\",\"expectedBindingId\",\"expectedBindingDigest\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/root\"},\"operation\":{\"const\":\"replace\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"observation\":{\"$ref\":\"#/$defs/creationObservation\"},\"expectedBindingId\":{\"$ref\":\"#/$defs/bindingId\"},\"expectedBindingDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"decommissionRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"operation\",\"windowId\",\"expectedBindingId\",\"expectedBindingDigest\",\"closure\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/root\"},\"operation\":{\"const\":\"decommission\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"expectedBindingId\":{\"$ref\":\"#/$defs/bindingId\"},\"expectedBindingDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"closure\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"preClose\",\"closeResult\",\"postClose\"],\"properties\":{\"preClose\":{\"$ref\":\"#/$defs/livenessObservation\"},\"closeResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\"],\"properties\":{\"status\":{\"enum\":[\"closed\",\"failed\",\"unknown\"]}}},\"postClose\":{\"$ref\":\"#/$defs/livenessObservation\"}}}}},\"releaseClaimRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"operation\",\"windowId\",\"expectedClaimDigest\",\"evidence\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/root\"},\"operation\":{\"const\":\"release-claim\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"expectedClaimDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"evidence\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"liveness\"],\"properties\":{\"liveness\":{\"$ref\":\"#/$defs/livenessObservation\"}}}}}}}");
