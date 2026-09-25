/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-window-host-binding-registration-result.schema.json
 */

/**
 * Closed successful MCP output contract for one execution-endpoint operation: an inspection with the recomputed launch intent and current state, or a mutation receipt. Raw host handles, tmux coordinates, and workspace paths never appear; every result carries next.
 */
export type WakeflowWindowHostBindingRegistrationResultV1 = (InspectionResult | MutationResult)
export type HostId = ("codex" | "claude-code")
export type WindowId = string
export type Role = ("controller" | "design" | "test" | "product")
export type Sha256Digest = string
export type PodId = string
export type RepositoryId = string
export type BindingId = string
export type UtcInstant = string
export type PortableResourcePath = string

export interface InspectionResult {
kind: "WakeflowWindowBindingInspection"
schemaVersion: 1
tool: "wakeflow_register_window_binding"
hostId: HostId
windowId: WindowId
role: Role
launchIntent: {
intentDigest: Sha256Digest
podId: PodId
podName: string
podPlacement: ("primary" | "worktree")
displayTitle: string
root: {
kind: ("program" | "repository" | "support-surface")
rootId: string
configuredPlacement: string
}
worktree: (WorktreeIntent | null)
/**
 * @maxItems 64
 */
attachedWorktrees: AttachedWorktree[]
execution: DomainObject
}
binding: ({
status: "unregistered"
} | {
status: "registered"
bindingId: BindingId
bindingDigest: Sha256Digest
registeredAt: UtcInstant
launchIntentDigest: Sha256Digest
})
claim: ({
status: "absent"
} | {
status: "held"
claimId: string
claimDigest: Sha256Digest
demandId: string
claimedAt: UtcInstant
expiresAt: UtcInstant
expired: boolean
})
locator: {
status: ("present" | "absent" | "not-applicable")
}
next: Next
}
/**
 * Worktree intent attached to the product window of a worktree pod: the host creates the checkout from the local HEAD under the suggested name; the actual path and branch come back in the registration receipt.
 */
export interface WorktreeIntent {
repositoryId: RepositoryId
suggestedName: string
basePolicy: "local-head"
}
export interface AttachedWorktree {
repositoryId: RepositoryId
productWindowId: WindowId
}
/**
 * A JSON object whose narrower relation contract is enforced by its producing domain owner.
 */
export interface DomainObject {
[k: string]: unknown | undefined
}
/**
 * Next responsibility derived after this call: who acts, which tool, and what blocks.
 */
export interface Next {
frontier: (null | string)
owner: ("controller" | "target" | "test" | "user" | "none")
suggestedTool: (null | string)
/**
 * @maxItems 32
 */
blockers: string[]
}
export interface MutationResult {
kind: "WakeflowWindowBindingMutation"
schemaVersion: 1
tool: "wakeflow_register_window_binding"
hostId: HostId
windowId: WindowId
operation: ("register" | "replace" | "relocate" | "decommission" | "release-claim")
disposition: ("registered" | "replayed" | "replaced" | "relocated" | "decommissioned" | "claim-released")
binding: (BindingSummary | null)
worktree: (WorktreeSummary | null)
verification: (("machine-verified" | "manual-host-gate") | null)
claim: ({
claimId: string
claimDigest: Sha256Digest
} | null)
projection: (ProjectionReceipt | null)
next: Next
}
export interface BindingSummary {
bindingId: BindingId
bindingDigest: Sha256Digest
registeredAt: UtcInstant
launchIntentDigest: Sha256Digest
}
/**
 * The admitted worktree receipt without its path: HEAD, branch (null when detached), and lock state.
 */
export interface WorktreeSummary {
head: string
branch: (string | null)
detached: boolean
locked: boolean
}
export interface ProjectionReceipt {
resourceRef: PortableResourcePath
projectionDigest: Sha256Digest
documentDigest: Sha256Digest
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
export const WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:window-host-binding-registration-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_RESULT_SCHEMA\",\"title\":\"WakeflowWindowHostBindingRegistrationResultV1\",\"description\":\"Closed successful MCP output contract for one execution-endpoint operation: an inspection with the recomputed launch intent and current state, or a mutation receipt. Raw host handles, tmux coordinates, and workspace paths never appear; every result carries next.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/inspectionResult\"},{\"$ref\":\"#/$defs/mutationResult\"}],\"$defs\":{\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"bindingId\":{\"type\":\"string\",\"pattern\":\"^window_binding_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"hostId\":{\"enum\":[\"codex\",\"claude-code\"]},\"role\":{\"enum\":[\"controller\",\"design\",\"test\",\"product\"]},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":1024,\"pattern\":\"^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\\\.{1,2}(?:/|$))(?!.*\\\\/\\\\.{1,2}(?:/|$))(?!.*\\\\\\\\)(?!.*//)(?!.*\\\\/$)(?!\\\\s)(?!.*\\\\s$)(?!.*\\\\/\\\\s)(?!.*\\\\s\\\\/)(?!.*[\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]).+$\"},\"domainObject\":{\"type\":\"object\",\"description\":\"A JSON object whose narrower relation contract is enforced by its producing domain owner.\"},\"next\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"frontier\",\"owner\",\"suggestedTool\",\"blockers\"],\"properties\":{\"frontier\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":128}]},\"owner\":{\"enum\":[\"controller\",\"target\",\"test\",\"user\",\"none\"]},\"suggestedTool\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":128}]},\"blockers\":{\"type\":\"array\",\"maxItems\":32,\"items\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128}}},\"description\":\"Next responsibility derived after this call: who acts, which tool, and what blocks.\"},\"bindingSummary\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"bindingId\",\"bindingDigest\",\"registeredAt\",\"launchIntentDigest\"],\"properties\":{\"bindingId\":{\"$ref\":\"#/$defs/bindingId\"},\"bindingDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"registeredAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"launchIntentDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"projectionReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"resourceRef\",\"projectionDigest\",\"documentDigest\"],\"properties\":{\"resourceRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"projectionDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"documentDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"inspectionResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"hostId\",\"windowId\",\"role\",\"launchIntent\",\"binding\",\"claim\",\"locator\",\"next\"],\"properties\":{\"kind\":{\"const\":\"WakeflowWindowBindingInspection\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_register_window_binding\"},\"hostId\":{\"$ref\":\"#/$defs/hostId\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"role\":{\"$ref\":\"#/$defs/role\"},\"launchIntent\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"intentDigest\",\"podId\",\"podName\",\"podPlacement\",\"displayTitle\",\"root\",\"worktree\",\"attachedWorktrees\",\"execution\"],\"properties\":{\"intentDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"podId\":{\"$ref\":\"#/$defs/podId\"},\"podName\":{\"type\":\"string\",\"pattern\":\"^[a-z][a-z0-9-]{0,31}$\"},\"podPlacement\":{\"enum\":[\"primary\",\"worktree\"]},\"displayTitle\":{\"type\":\"string\",\"maxLength\":256},\"root\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"rootId\",\"configuredPlacement\"],\"properties\":{\"kind\":{\"enum\":[\"program\",\"repository\",\"support-surface\"]},\"rootId\":{\"type\":\"string\",\"maxLength\":256},\"configuredPlacement\":{\"type\":\"string\",\"maxLength\":1024}}},\"worktree\":{\"oneOf\":[{\"$ref\":\"#/$defs/worktreeIntent\"},{\"type\":\"null\"}]},\"attachedWorktrees\":{\"type\":\"array\",\"maxItems\":64,\"items\":{\"$ref\":\"#/$defs/attachedWorktree\"}},\"execution\":{\"$ref\":\"#/$defs/domainObject\"}}},\"binding\":{\"oneOf\":[{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\"],\"properties\":{\"status\":{\"const\":\"unregistered\"}}},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"bindingId\",\"bindingDigest\",\"registeredAt\",\"launchIntentDigest\"],\"properties\":{\"status\":{\"const\":\"registered\"},\"bindingId\":{\"$ref\":\"#/$defs/bindingId\"},\"bindingDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"registeredAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"launchIntentDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}}]},\"claim\":{\"oneOf\":[{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\"],\"properties\":{\"status\":{\"const\":\"absent\"}}},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"claimId\",\"claimDigest\",\"demandId\",\"claimedAt\",\"expiresAt\",\"expired\"],\"properties\":{\"status\":{\"const\":\"held\"},\"claimId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128},\"claimDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"claimedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"expiresAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"expired\":{\"type\":\"boolean\"}}}]},\"locator\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\"],\"properties\":{\"status\":{\"enum\":[\"present\",\"absent\",\"not-applicable\"]}}},\"next\":{\"$ref\":\"#/$defs/next\"}}},\"mutationResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"hostId\",\"windowId\",\"operation\",\"disposition\",\"binding\",\"worktree\",\"verification\",\"claim\",\"projection\",\"next\"],\"properties\":{\"kind\":{\"const\":\"WakeflowWindowBindingMutation\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_register_window_binding\"},\"hostId\":{\"$ref\":\"#/$defs/hostId\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"operation\":{\"enum\":[\"register\",\"replace\",\"relocate\",\"decommission\",\"release-claim\"]},\"disposition\":{\"enum\":[\"registered\",\"replayed\",\"replaced\",\"relocated\",\"decommissioned\",\"claim-released\"]},\"binding\":{\"oneOf\":[{\"$ref\":\"#/$defs/bindingSummary\"},{\"type\":\"null\"}]},\"worktree\":{\"oneOf\":[{\"$ref\":\"#/$defs/worktreeSummary\"},{\"type\":\"null\"}]},\"verification\":{\"oneOf\":[{\"enum\":[\"machine-verified\",\"manual-host-gate\"]},{\"type\":\"null\"}]},\"claim\":{\"oneOf\":[{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"claimId\",\"claimDigest\"],\"properties\":{\"claimId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128},\"claimDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},{\"type\":\"null\"}]},\"projection\":{\"oneOf\":[{\"$ref\":\"#/$defs/projectionReceipt\"},{\"type\":\"null\"}]},\"next\":{\"$ref\":\"#/$defs/next\"}}},\"podId\":{\"type\":\"string\",\"pattern\":\"^pod_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"worktreeIntent\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"repositoryId\",\"suggestedName\",\"basePolicy\"],\"description\":\"Worktree intent attached to the product window of a worktree pod: the host creates the checkout from the local HEAD under the suggested name; the actual path and branch come back in the registration receipt.\",\"properties\":{\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"suggestedName\":{\"type\":\"string\",\"pattern\":\"^[a-z][a-z0-9-]{0,63}$\"},\"basePolicy\":{\"const\":\"local-head\"}}},\"attachedWorktree\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"repositoryId\",\"productWindowId\"],\"properties\":{\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"productWindowId\":{\"$ref\":\"#/$defs/windowId\"}}},\"worktreeSummary\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"head\",\"branch\",\"detached\",\"locked\"],\"description\":\"The admitted worktree receipt without its path: HEAD, branch (null when detached), and lock state.\",\"properties\":{\"head\":{\"type\":\"string\",\"pattern\":\"^(?:[0-9a-f]{40}|[0-9a-f]{64})$\"},\"branch\":{\"oneOf\":[{\"type\":\"string\",\"minLength\":1,\"maxLength\":255},{\"type\":\"null\"}]},\"detached\":{\"type\":\"boolean\"},\"locked\":{\"type\":\"boolean\"}}}}}");
