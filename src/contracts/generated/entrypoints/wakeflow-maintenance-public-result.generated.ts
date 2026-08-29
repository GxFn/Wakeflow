/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-maintenance-public-result.schema.json
 */

/**
 * Closed successful MCP output contract for one Wakeflow workspace Maintenance operation. Nested receipts remain owned by their producing domains.
 */
export type WakeflowMaintenancePublicResultV1 = (PreviewResult | MutationResult)
export type PreviewResult = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowMaintenancePublicPreviewResult"
schemaVersion: 1
tool: "wakeflow_maintain_workspace"
hostId: HostId
mode: "preview"
action: Action
status: ("ready" | "blocked")
blockerCodes: string[]
confirmation: (DomainObject | null)
confirmationDigest: NullableSha256Digest
freshConfigCompilation: (DomainObject | null)
launchIntents: LaunchIntents
launchSetDigest: NullableSha256Digest
})
export type HostId = ("codex" | "claude-code")
export type Action = ("fresh-initialize" | "reconfigure" | "reconcile")
export type NullableSha256Digest = (Sha256Digest | null)
export type Sha256Digest = string
export type LaunchIntents = DomainObject[]
export type MutationResult = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowMaintenancePublicMutationResult"
schemaVersion: 1
tool: "wakeflow_maintain_workspace"
hostId: HostId
mode: ("apply" | "recover")
action: (Action | null)
status: ("completed" | "no-op" | "recovered")
operationId: (MaintenanceOperationId | null)
planDigest: Sha256Digest
stepReceipts: DomainObject[]
confirmationDigest: NullableSha256Digest
launchIntents: LaunchIntents
launchSetDigest: NullableSha256Digest
})
export type MaintenanceOperationId = string

/**
 * A JSON object whose narrower relation contract is enforced by its producing domain owner.
 */
export interface DomainObject {
[k: string]: unknown | undefined
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
export const WAKEFLOW_MAINTENANCE_PUBLIC_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:maintenance-public-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_MAINTENANCE_PUBLIC_RESULT_SCHEMA\",\"title\":\"WakeflowMaintenancePublicResultV1\",\"description\":\"Closed successful MCP output contract for one Wakeflow workspace Maintenance operation. Nested receipts remain owned by their producing domains.\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/previewResult\"},{\"$ref\":\"#/$defs/mutationResult\"}],\"$defs\":{\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"nullableSha256Digest\":{\"oneOf\":[{\"$ref\":\"#/$defs/sha256Digest\"},{\"type\":\"null\"}]},\"maintenanceOperationId\":{\"type\":\"string\",\"pattern\":\"^maintenance_operation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"hostId\":{\"enum\":[\"codex\",\"claude-code\"]},\"action\":{\"enum\":[\"fresh-initialize\",\"reconfigure\",\"reconcile\"]},\"domainObject\":{\"type\":\"object\",\"description\":\"A JSON object whose narrower relation contract is enforced by its producing domain owner.\"},\"launchIntents\":{\"type\":\"array\",\"items\":{\"$ref\":\"#/$defs/domainObject\"}},\"previewResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"hostId\",\"mode\",\"action\",\"status\",\"blockerCodes\",\"confirmation\",\"confirmationDigest\",\"freshConfigCompilation\",\"launchIntents\",\"launchSetDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowMaintenancePublicPreviewResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_maintain_workspace\"},\"hostId\":{\"$ref\":\"#/$defs/hostId\"},\"mode\":{\"const\":\"preview\"},\"action\":{\"$ref\":\"#/$defs/action\"},\"status\":{\"enum\":[\"ready\",\"blocked\"]},\"blockerCodes\":{\"type\":\"array\",\"items\":{\"type\":\"string\"}},\"confirmation\":{\"oneOf\":[{\"$ref\":\"#/$defs/domainObject\"},{\"type\":\"null\"}]},\"confirmationDigest\":{\"$ref\":\"#/$defs/nullableSha256Digest\"},\"freshConfigCompilation\":{\"oneOf\":[{\"$ref\":\"#/$defs/domainObject\"},{\"type\":\"null\"}]},\"launchIntents\":{\"$ref\":\"#/$defs/launchIntents\"},\"launchSetDigest\":{\"$ref\":\"#/$defs/nullableSha256Digest\"}},\"allOf\":[{\"if\":{\"required\":[\"status\"],\"properties\":{\"status\":{\"const\":\"ready\"}}},\"then\":{\"properties\":{\"blockerCodes\":{\"type\":\"array\",\"maxItems\":0},\"confirmation\":{\"$ref\":\"#/$defs/domainObject\"},\"confirmationDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"else\":{\"properties\":{\"blockerCodes\":{\"type\":\"array\",\"minItems\":1},\"confirmation\":{\"type\":\"null\"},\"confirmationDigest\":{\"type\":\"null\"},\"launchIntents\":{\"type\":\"array\",\"maxItems\":0},\"launchSetDigest\":{\"type\":\"null\"}}}}]},\"mutationResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"hostId\",\"mode\",\"action\",\"status\",\"operationId\",\"planDigest\",\"stepReceipts\",\"confirmationDigest\",\"launchIntents\",\"launchSetDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowMaintenancePublicMutationResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_maintain_workspace\"},\"hostId\":{\"$ref\":\"#/$defs/hostId\"},\"mode\":{\"enum\":[\"apply\",\"recover\"]},\"action\":{\"oneOf\":[{\"$ref\":\"#/$defs/action\"},{\"type\":\"null\"}]},\"status\":{\"enum\":[\"completed\",\"no-op\",\"recovered\"]},\"operationId\":{\"oneOf\":[{\"$ref\":\"#/$defs/maintenanceOperationId\"},{\"type\":\"null\"}]},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"stepReceipts\":{\"type\":\"array\",\"items\":{\"$ref\":\"#/$defs/domainObject\"}},\"confirmationDigest\":{\"$ref\":\"#/$defs/nullableSha256Digest\"},\"launchIntents\":{\"$ref\":\"#/$defs/launchIntents\"},\"launchSetDigest\":{\"$ref\":\"#/$defs/nullableSha256Digest\"}},\"allOf\":[{\"if\":{\"required\":[\"mode\"],\"properties\":{\"mode\":{\"const\":\"apply\"}}},\"then\":{\"properties\":{\"action\":{\"$ref\":\"#/$defs/action\"},\"status\":{\"enum\":[\"completed\",\"no-op\"]},\"confirmationDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"else\":{\"properties\":{\"action\":{\"type\":\"null\"},\"status\":{\"const\":\"recovered\"},\"operationId\":{\"$ref\":\"#/$defs/maintenanceOperationId\"},\"confirmationDigest\":{\"type\":\"null\"},\"launchIntents\":{\"type\":\"array\",\"maxItems\":0},\"launchSetDigest\":{\"type\":\"null\"}}}}]}}}");
