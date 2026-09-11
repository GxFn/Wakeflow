/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-pod-result.schema.json
 */

/**
 * Result of one wakeflow_pod call: the preview plan (pod identity, derived windows and worktree intents, blockers, planDigest) or the mutation disposition with the pod's derived state and next.
 */
export type WakeflowPodResultV1 = (PreviewResult | MutationResult)
export type Sha256Digest = string
export type PodId = string
export type PodName = string
/**
 * Derived from the config record plus receipts: creating until every window is bound and every worktree receipt is valid, ready after that, closing once the Controller requested closing, closed once no window binding and no checkout remain.
 */
export type PodState = ("creating" | "ready" | "closing" | "closed")
export type WindowId = string
export type RepositoryId = string

export interface PreviewResult {
kind: "WakeflowPodPreview"
schemaVersion: 1
tool: "wakeflow_pod"
mode: "preview"
status: ("ready" | "blocked")
/**
 * @maxItems 64
 */
blockers: string[]
planDigest: (Sha256Digest | null)
plan: (PlanView | null)
next: Next
}
export interface PlanView {
kind: ("create" | "close-request" | "close-complete")
pod: PodView
/**
 * @maxItems 256
 */
windows: WindowView[]
/**
 * @maxItems 64
 */
worktrees: WorktreeView[]
}
export interface PodView {
podId: PodId
name: PodName
placement: ("primary" | "worktree")
state: PodState
}
export interface WindowView {
windowId: WindowId
role: ("controller" | "design" | "test" | "product")
displayTitle: string
bound: boolean
}
export interface WorktreeView {
repositoryId: RepositoryId
windowId: WindowId
suggestedName: string
/**
 * absent: no worktree receipt yet; present: receipt admitted and the checkout still exists; checkout-missing: receipt exists but the checkout directory is gone.
 */
receipt: ("absent" | "present" | "checkout-missing")
}
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
kind: "WakeflowPodMutation"
schemaVersion: 1
tool: "wakeflow_pod"
mode: ("apply" | "recover")
disposition: ("created" | "already-created" | "closing" | "closed" | "healthy" | "retired")
/**
 * The pod after the mutation; null once it is closed (removed from config) or when recover found no such pod.
 */
pod: (PodView | null)
/**
 * @maxItems 256
 */
windows: WindowView[]
/**
 * @maxItems 64
 */
worktrees: WorktreeView[]
/**
 * Receipt files retired by this call (recover retires receipts that no longer match a binding or a checkout; closed removes the pod's receipt directory).
 */
retiredReceipts: number
next: Next
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
export const WAKEFLOW_POD_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:pod-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_POD_RESULT_SCHEMA\",\"title\":\"WakeflowPodResultV1\",\"description\":\"Result of one wakeflow_pod call: the preview plan (pod identity, derived windows and worktree intents, blockers, planDigest) or the mutation disposition with the pod's derived state and next.\",\"$comment\":\"Results carry typed IDs, names, roles and states only; never a worktree path, a host handle, or a workspace path.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/previewResult\"},{\"$ref\":\"#/$defs/mutationResult\"}],\"$defs\":{\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"podId\":{\"type\":\"string\",\"pattern\":\"^pod_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"podName\":{\"type\":\"string\",\"pattern\":\"^[a-z][a-z0-9-]{0,31}$\"},\"podState\":{\"enum\":[\"creating\",\"ready\",\"closing\",\"closed\"],\"description\":\"Derived from the config record plus receipts: creating until every window is bound and every worktree receipt is valid, ready after that, closing once the Controller requested closing, closed once no window binding and no checkout remain.\"},\"podView\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"podId\",\"name\",\"placement\",\"state\"],\"properties\":{\"podId\":{\"$ref\":\"#/$defs/podId\"},\"name\":{\"$ref\":\"#/$defs/podName\"},\"placement\":{\"enum\":[\"primary\",\"worktree\"]},\"state\":{\"$ref\":\"#/$defs/podState\"}}},\"windowView\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"windowId\",\"role\",\"displayTitle\",\"bound\"],\"properties\":{\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"role\":{\"enum\":[\"controller\",\"design\",\"test\",\"product\"]},\"displayTitle\":{\"type\":\"string\",\"maxLength\":256},\"bound\":{\"type\":\"boolean\"}}},\"worktreeView\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"repositoryId\",\"windowId\",\"suggestedName\",\"receipt\"],\"properties\":{\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"suggestedName\":{\"type\":\"string\",\"pattern\":\"^[a-z][a-z0-9-]{0,63}$\"},\"receipt\":{\"enum\":[\"absent\",\"present\",\"checkout-missing\"],\"description\":\"absent: no worktree receipt yet; present: receipt admitted and the checkout still exists; checkout-missing: receipt exists but the checkout directory is gone.\"}}},\"next\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"frontier\",\"owner\",\"suggestedTool\",\"blockers\"],\"properties\":{\"frontier\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":128}]},\"owner\":{\"enum\":[\"controller\",\"target\",\"test\",\"user\",\"none\"]},\"suggestedTool\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":128}]},\"blockers\":{\"type\":\"array\",\"maxItems\":32,\"items\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128}}}},\"planView\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"pod\",\"windows\",\"worktrees\"],\"properties\":{\"kind\":{\"enum\":[\"create\",\"close-request\",\"close-complete\"]},\"pod\":{\"$ref\":\"#/$defs/podView\"},\"windows\":{\"type\":\"array\",\"maxItems\":256,\"items\":{\"$ref\":\"#/$defs/windowView\"}},\"worktrees\":{\"type\":\"array\",\"maxItems\":64,\"items\":{\"$ref\":\"#/$defs/worktreeView\"}}}},\"previewResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"status\",\"blockers\",\"planDigest\",\"plan\",\"next\"],\"properties\":{\"kind\":{\"const\":\"WakeflowPodPreview\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_pod\"},\"mode\":{\"const\":\"preview\"},\"status\":{\"enum\":[\"ready\",\"blocked\"]},\"blockers\":{\"type\":\"array\",\"maxItems\":64,\"items\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":256}},\"planDigest\":{\"oneOf\":[{\"$ref\":\"#/$defs/sha256Digest\"},{\"type\":\"null\"}]},\"plan\":{\"oneOf\":[{\"$ref\":\"#/$defs/planView\"},{\"type\":\"null\"}]},\"next\":{\"$ref\":\"#/$defs/next\"}}},\"mutationResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"disposition\",\"pod\",\"windows\",\"worktrees\",\"retiredReceipts\",\"next\"],\"properties\":{\"kind\":{\"const\":\"WakeflowPodMutation\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_pod\"},\"mode\":{\"enum\":[\"apply\",\"recover\"]},\"disposition\":{\"enum\":[\"created\",\"already-created\",\"closing\",\"closed\",\"healthy\",\"retired\"]},\"pod\":{\"oneOf\":[{\"$ref\":\"#/$defs/podView\"},{\"type\":\"null\"}],\"description\":\"The pod after the mutation; null once it is closed (removed from config) or when recover found no such pod.\"},\"windows\":{\"type\":\"array\",\"maxItems\":256,\"items\":{\"$ref\":\"#/$defs/windowView\"}},\"worktrees\":{\"type\":\"array\",\"maxItems\":64,\"items\":{\"$ref\":\"#/$defs/worktreeView\"}},\"retiredReceipts\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":4096,\"description\":\"Receipt files retired by this call (recover retires receipts that no longer match a binding or a checkout; closed removes the pod's receipt directory).\"},\"next\":{\"$ref\":\"#/$defs/next\"}}}}}");
