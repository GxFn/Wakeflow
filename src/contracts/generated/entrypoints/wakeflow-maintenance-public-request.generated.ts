/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-maintenance-public-request.schema.json
 */

/**
 * Closed MCP input contract for one Wakeflow workspace Maintenance effect: preview derives a plan without writing, apply re-derives the same plan and executes it only when planDigest matches, recover finishes an interrupted transaction by its operation ID. Nested domain values are revalidated by their owning domain modules.
 */
export type WakeflowMaintenancePublicRequestV1 = (FreshInitializePreviewRequest | FreshInitializeApplyRequest | ReconfigurePreviewRequest | ReconfigureApplyRequest | ReconcilePreviewRequest | ReconcileApplyRequest | RecoverRequest)
/**
 * Absolute path of the existing workspace root. Physical root validation remains owned by RootedDirectory.
 */
export type Root = string
/**
 * Selection-local logical key; unique across repositories, surfaces and windows.
 */
export type FreshSelectionKey = string
/**
 * Algorithm-prefixed lowercase SHA-256 digest of the exact execution plan returned by preview. Apply re-derives the plan and rejects a different digest.
 */
export type Sha256Digest = string
/**
 * A passive JSON value. The receiving domain owner applies its narrower contract.
 */
export type JsonValue = (null | boolean | number | string | JsonValue[] | {
[k: string]: JsonValue
})
/**
 * Typed identifier of one prepared Maintenance transaction.
 */
export type MaintenanceOperationId = string

export interface FreshInitializePreviewRequest {
root: Root
mode: "preview"
action: "fresh-initialize"
request: FreshInitializeBody
}
export interface FreshInitializeBody {
selection: FreshSelection
}
/**
 * The fresh-initialize selection: six parts, compiled by the Configuration owner into the typed Config. Every repository and window keeps its own selectionKey; windows reference repositories and surfaces by those keys. A refusal names the failing path in details.at and the rule in details.selection.
 */
export interface FreshSelection {
program: {
displayName: string
description?: string
}
presentation: {
/**
 * Language of Wakeflow-generated text; en when omitted.
 */
language?: ("en" | "zh-Hans")
}
topology: {
/**
 * @maxItems 256
 */
repositories: FreshRepository[]
/**
 * @maxItems 256
 */
supportSurfaces: FreshSupportSurface[]
/**
 * @maxItems 256
 */
windows: FreshWindow[]
}
storage: {
/**
 * Ledger placement relative to the workspace root, inside it (ledger) or beside it (../<name>-ledger).
 */
ledgerRoot: string
}
/**
 * Reserved; must be an empty object.
 */
governance: {

}
/**
 * Optional launch and container preferences by host (claude-code, codex); the empty object inherits the tested profile. Its shape is the Config schema's hosts object.
 */
hosts: {
[k: string]: unknown | undefined
}
}
export interface FreshRepository {
selectionKey: FreshSelectionKey
/**
 * Repository root relative to the workspace root; it must already be its own Git repository.
 */
path: string
displayName: string
description?: string
/**
 * owner-managed leaves the repository's instruction files alone; managed-block lets Wakeflow keep one bounded block there.
 */
instructionManagement: ("owner-managed" | "managed-block")
}
export interface FreshSupportSurface {
selectionKey: FreshSelectionKey
capability: ("design" | "test")
/**
 * Surface root relative to the workspace root (inside it for wakeflow-managed, anywhere for external-owned).
 */
path: string
displayName: string
description?: string
ownership: ("wakeflow-managed" | "external-owned")
/**
 * Only for external-owned surfaces.
 */
instructionManagement?: ("owner-managed" | "managed-block")
}
export interface FreshWindow {
selectionKey: FreshSelectionKey
role: ("controller" | "design" | "test" | "product")
displayName: string
description?: string
/**
 * Where the window works: the program root, one repository (by its selectionKey) or one support surface (by its selectionKey).
 */
root: ({
kind: "program"
} | {
kind: ("repository" | "support-surface")
selectionKey: FreshSelectionKey
})
}
export interface FreshInitializeApplyRequest {
root: Root
mode: "apply"
action: "fresh-initialize"
request: FreshInitializeBody
planDigest: Sha256Digest
}
export interface ReconfigurePreviewRequest {
root: Root
mode: "preview"
action: "reconfigure"
request: ReconfigureBody
}
export interface ReconfigureBody {
/**
 * Complete desired Config document revalidated by the Configuration owner.
 */
desiredConfig: (null | boolean | number | string | JsonValue[] | {
[k: string]: JsonValue
})
}
export interface ReconfigureApplyRequest {
root: Root
mode: "apply"
action: "reconfigure"
request: ReconfigureBody
planDigest: Sha256Digest
}
export interface ReconcilePreviewRequest {
root: Root
mode: "preview"
action: "reconcile"
request: ReconcileBody
}
export interface ReconcileBody {

}
export interface ReconcileApplyRequest {
root: Root
mode: "apply"
action: "reconcile"
request: ReconcileBody
planDigest: Sha256Digest
}
export interface RecoverRequest {
root: Root
mode: "recover"
operationId: MaintenanceOperationId
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
export const WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:maintenance-public-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA\",\"title\":\"WakeflowMaintenancePublicRequestV1\",\"description\":\"Closed MCP input contract for one Wakeflow workspace Maintenance effect: preview derives a plan without writing, apply re-derives the same plan and executes it only when planDigest matches, recover finishes an interrupted transaction by its operation ID. Nested domain values are revalidated by their owning domain modules.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/freshInitializePreviewRequest\"},{\"$ref\":\"#/$defs/freshInitializeApplyRequest\"},{\"$ref\":\"#/$defs/reconfigurePreviewRequest\"},{\"$ref\":\"#/$defs/reconfigureApplyRequest\"},{\"$ref\":\"#/$defs/reconcilePreviewRequest\"},{\"$ref\":\"#/$defs/reconcileApplyRequest\"},{\"$ref\":\"#/$defs/recoverRequest\"}],\"$defs\":{\"jsonValue\":{\"description\":\"A passive JSON value. The receiving domain owner applies its narrower contract.\",\"oneOf\":[{\"type\":\"null\"},{\"type\":\"boolean\"},{\"type\":\"number\"},{\"type\":\"string\"},{\"type\":\"array\",\"items\":{\"$ref\":\"#/$defs/jsonValue\"}},{\"type\":\"object\",\"additionalProperties\":{\"$ref\":\"#/$defs/jsonValue\"}}]},\"root\":{\"type\":\"string\",\"description\":\"Absolute path of the existing workspace root. Physical root validation remains owned by RootedDirectory.\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\",\"description\":\"Algorithm-prefixed lowercase SHA-256 digest of the exact execution plan returned by preview. Apply re-derives the plan and rejects a different digest.\"},\"maintenanceOperationId\":{\"type\":\"string\",\"pattern\":\"^maintenance_operation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\",\"description\":\"Typed identifier of one prepared Maintenance transaction.\"},\"freshInitializeBody\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"selection\"],\"properties\":{\"selection\":{\"$ref\":\"#/$defs/freshSelection\"}}},\"reconfigureBody\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"desiredConfig\"],\"properties\":{\"desiredConfig\":{\"$ref\":\"#/$defs/jsonValue\",\"description\":\"Complete desired Config document revalidated by the Configuration owner.\"}}},\"reconcileBody\":{\"type\":\"object\",\"additionalProperties\":false,\"maxProperties\":0},\"freshInitializePreviewRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"action\",\"request\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/root\"},\"mode\":{\"const\":\"preview\"},\"action\":{\"const\":\"fresh-initialize\"},\"request\":{\"$ref\":\"#/$defs/freshInitializeBody\"}}},\"freshInitializeApplyRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"action\",\"request\",\"planDigest\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/root\"},\"mode\":{\"const\":\"apply\"},\"action\":{\"const\":\"fresh-initialize\"},\"request\":{\"$ref\":\"#/$defs/freshInitializeBody\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"reconfigurePreviewRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"action\",\"request\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/root\"},\"mode\":{\"const\":\"preview\"},\"action\":{\"const\":\"reconfigure\"},\"request\":{\"$ref\":\"#/$defs/reconfigureBody\"}}},\"reconfigureApplyRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"action\",\"request\",\"planDigest\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/root\"},\"mode\":{\"const\":\"apply\"},\"action\":{\"const\":\"reconfigure\"},\"request\":{\"$ref\":\"#/$defs/reconfigureBody\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"reconcilePreviewRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"action\",\"request\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/root\"},\"mode\":{\"const\":\"preview\"},\"action\":{\"const\":\"reconcile\"},\"request\":{\"$ref\":\"#/$defs/reconcileBody\"}}},\"reconcileApplyRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"action\",\"request\",\"planDigest\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/root\"},\"mode\":{\"const\":\"apply\"},\"action\":{\"const\":\"reconcile\"},\"request\":{\"$ref\":\"#/$defs/reconcileBody\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"recoverRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"operationId\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/root\"},\"mode\":{\"const\":\"recover\"},\"operationId\":{\"$ref\":\"#/$defs/maintenanceOperationId\"}}},\"freshSelectionKey\":{\"type\":\"string\",\"pattern\":\"^[a-z][a-z0-9-]{0,63}$\",\"description\":\"Selection-local logical key; unique across repositories, surfaces and windows.\"},\"freshRepository\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"selectionKey\",\"path\",\"displayName\",\"instructionManagement\"],\"properties\":{\"selectionKey\":{\"$ref\":\"#/$defs/freshSelectionKey\"},\"path\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":512,\"description\":\"Repository root relative to the workspace root; it must already be its own Git repository.\"},\"displayName\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":512},\"description\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":512},\"instructionManagement\":{\"enum\":[\"owner-managed\",\"managed-block\"],\"description\":\"owner-managed leaves the repository's instruction files alone; managed-block lets Wakeflow keep one bounded block there.\"}}},\"freshSupportSurface\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"selectionKey\",\"capability\",\"path\",\"displayName\",\"ownership\"],\"properties\":{\"selectionKey\":{\"$ref\":\"#/$defs/freshSelectionKey\"},\"capability\":{\"enum\":[\"design\",\"test\"]},\"path\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":512,\"description\":\"Surface root relative to the workspace root (inside it for wakeflow-managed, anywhere for external-owned).\"},\"displayName\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":512},\"description\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":512},\"ownership\":{\"enum\":[\"wakeflow-managed\",\"external-owned\"]},\"instructionManagement\":{\"enum\":[\"owner-managed\",\"managed-block\"],\"description\":\"Only for external-owned surfaces.\"}}},\"freshWindowRoot\":{\"oneOf\":[{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\"],\"properties\":{\"kind\":{\"const\":\"program\"}}},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"selectionKey\"],\"properties\":{\"kind\":{\"enum\":[\"repository\",\"support-surface\"]},\"selectionKey\":{\"$ref\":\"#/$defs/freshSelectionKey\"}}}]},\"freshWindow\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"selectionKey\",\"role\",\"displayName\",\"root\"],\"properties\":{\"selectionKey\":{\"$ref\":\"#/$defs/freshSelectionKey\"},\"role\":{\"enum\":[\"controller\",\"design\",\"test\",\"product\"]},\"displayName\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":512},\"description\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":512},\"root\":{\"$ref\":\"#/$defs/freshWindowRoot\",\"description\":\"Where the window works: the program root, one repository (by its selectionKey) or one support surface (by its selectionKey).\"}}},\"freshSelection\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"program\",\"presentation\",\"topology\",\"storage\",\"governance\",\"hosts\"],\"description\":\"The fresh-initialize selection: six parts, compiled by the Configuration owner into the typed Config. Every repository and window keeps its own selectionKey; windows reference repositories and surfaces by those keys. A refusal names the failing path in details.at and the rule in details.selection.\",\"properties\":{\"program\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"displayName\"],\"properties\":{\"displayName\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":512},\"description\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":512}}},\"presentation\":{\"type\":\"object\",\"additionalProperties\":false,\"properties\":{\"language\":{\"enum\":[\"en\",\"zh-Hans\"],\"description\":\"Language of Wakeflow-generated text; en when omitted.\"}}},\"topology\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"repositories\",\"supportSurfaces\",\"windows\"],\"properties\":{\"repositories\":{\"type\":\"array\",\"maxItems\":256,\"items\":{\"$ref\":\"#/$defs/freshRepository\"}},\"supportSurfaces\":{\"type\":\"array\",\"maxItems\":256,\"items\":{\"$ref\":\"#/$defs/freshSupportSurface\"}},\"windows\":{\"type\":\"array\",\"maxItems\":256,\"items\":{\"$ref\":\"#/$defs/freshWindow\"}}}},\"storage\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"ledgerRoot\"],\"properties\":{\"ledgerRoot\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":512,\"description\":\"Ledger placement relative to the workspace root, inside it (ledger) or beside it (../<name>-ledger).\"}}},\"governance\":{\"type\":\"object\",\"additionalProperties\":false,\"properties\":{},\"description\":\"Reserved; must be an empty object.\"},\"hosts\":{\"type\":\"object\",\"description\":\"Optional launch and container preferences by host (claude-code, codex); the empty object inherits the tested profile. Its shape is the Config schema's hosts object.\"}}}}}");
