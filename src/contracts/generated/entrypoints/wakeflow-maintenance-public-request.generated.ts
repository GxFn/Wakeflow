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
 * A passive JSON value. The receiving domain owner applies its narrower contract.
 */
export type JsonValue = (null | boolean | number | string | JsonValue[] | {
[k: string]: JsonValue
})
/**
 * Algorithm-prefixed lowercase SHA-256 digest of the exact execution plan returned by preview. Apply re-derives the plan and rejects a different digest.
 */
export type Sha256Digest = string
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
/**
 * Fresh user selection compiled by the Configuration owner into a typed Config v3 model.
 */
selection: (null | boolean | number | string | JsonValue[] | {
[k: string]: JsonValue
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
 * A passive JSON value. The receiving domain owner applies its narrower contract.
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
export const WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:maintenance-public-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA\",\"title\":\"WakeflowMaintenancePublicRequestV1\",\"description\":\"Closed MCP input contract for one Wakeflow workspace Maintenance effect: preview derives a plan without writing, apply re-derives the same plan and executes it only when planDigest matches, recover finishes an interrupted transaction by its operation ID. Nested domain values are revalidated by their owning domain modules.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/freshInitializePreviewRequest\"},{\"$ref\":\"#/$defs/freshInitializeApplyRequest\"},{\"$ref\":\"#/$defs/reconfigurePreviewRequest\"},{\"$ref\":\"#/$defs/reconfigureApplyRequest\"},{\"$ref\":\"#/$defs/reconcilePreviewRequest\"},{\"$ref\":\"#/$defs/reconcileApplyRequest\"},{\"$ref\":\"#/$defs/recoverRequest\"}],\"$defs\":{\"jsonValue\":{\"description\":\"A passive JSON value. The receiving domain owner applies its narrower contract.\",\"oneOf\":[{\"type\":\"null\"},{\"type\":\"boolean\"},{\"type\":\"number\"},{\"type\":\"string\"},{\"type\":\"array\",\"items\":{\"$ref\":\"#/$defs/jsonValue\"}},{\"type\":\"object\",\"additionalProperties\":{\"$ref\":\"#/$defs/jsonValue\"}}]},\"root\":{\"type\":\"string\",\"description\":\"Absolute path of the existing workspace root. Physical root validation remains owned by RootedDirectory.\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\",\"description\":\"Algorithm-prefixed lowercase SHA-256 digest of the exact execution plan returned by preview. Apply re-derives the plan and rejects a different digest.\"},\"maintenanceOperationId\":{\"type\":\"string\",\"pattern\":\"^maintenance_operation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\",\"description\":\"Typed identifier of one prepared Maintenance transaction.\"},\"freshInitializeBody\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"selection\"],\"properties\":{\"selection\":{\"$ref\":\"#/$defs/jsonValue\",\"description\":\"Fresh user selection compiled by the Configuration owner into a typed Config v3 model.\"}}},\"reconfigureBody\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"desiredConfig\"],\"properties\":{\"desiredConfig\":{\"$ref\":\"#/$defs/jsonValue\",\"description\":\"Complete desired Config document revalidated by the Configuration owner.\"}}},\"reconcileBody\":{\"type\":\"object\",\"additionalProperties\":false,\"maxProperties\":0},\"freshInitializePreviewRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"action\",\"request\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/root\"},\"mode\":{\"const\":\"preview\"},\"action\":{\"const\":\"fresh-initialize\"},\"request\":{\"$ref\":\"#/$defs/freshInitializeBody\"}}},\"freshInitializeApplyRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"action\",\"request\",\"planDigest\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/root\"},\"mode\":{\"const\":\"apply\"},\"action\":{\"const\":\"fresh-initialize\"},\"request\":{\"$ref\":\"#/$defs/freshInitializeBody\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"reconfigurePreviewRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"action\",\"request\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/root\"},\"mode\":{\"const\":\"preview\"},\"action\":{\"const\":\"reconfigure\"},\"request\":{\"$ref\":\"#/$defs/reconfigureBody\"}}},\"reconfigureApplyRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"action\",\"request\",\"planDigest\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/root\"},\"mode\":{\"const\":\"apply\"},\"action\":{\"const\":\"reconfigure\"},\"request\":{\"$ref\":\"#/$defs/reconfigureBody\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"reconcilePreviewRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"action\",\"request\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/root\"},\"mode\":{\"const\":\"preview\"},\"action\":{\"const\":\"reconcile\"},\"request\":{\"$ref\":\"#/$defs/reconcileBody\"}}},\"reconcileApplyRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"action\",\"request\",\"planDigest\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/root\"},\"mode\":{\"const\":\"apply\"},\"action\":{\"const\":\"reconcile\"},\"request\":{\"$ref\":\"#/$defs/reconcileBody\"},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"recoverRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"operationId\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/root\"},\"mode\":{\"const\":\"recover\"},\"operationId\":{\"$ref\":\"#/$defs/maintenanceOperationId\"}}}}}");
