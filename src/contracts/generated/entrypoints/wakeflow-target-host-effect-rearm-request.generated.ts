/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-target-host-effect-rearm-request.schema.json
 */

/**
 * Absolute path of the existing Wakeflow workspace root.
 */
export type WorkspaceRoot = string
export type DemandId = string
export type ClaimId = string
export type Sha256Digest = string

/**
 * Closed MCP request for explicitly rearming one proved rejected-before-effect implementation Host Effect without performing the Host effect.
 */
export interface WakeflowTargetHostEffectRearmRequestV1 {
root: WorkspaceRoot
demandId: DemandId
actionId: ClaimId
observationDigest: Sha256Digest
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
export const WAKEFLOW_TARGET_HOST_EFFECT_REARM_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:target-host-effect-rearm-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TARGET_HOST_EFFECT_REARM_REQUEST_SCHEMA\",\"title\":\"WakeflowTargetHostEffectRearmRequestV1\",\"description\":\"Closed MCP request for explicitly rearming one proved rejected-before-effect implementation Host Effect without performing the Host effect.\",\"$comment\":\"The stored Claim and Observation derive the implementation Task, Delivery, Intent, Host, Window, Binding, rejected Claim tuple, and Rearm Event identity. The caller supplies only the exact Action and Observation identities returned by the preceding Outcome.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"demandId\",\"actionId\",\"observationDigest\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"actionId\":{\"$ref\":\"#/$defs/claimId\"},\"observationDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}},\"$defs\":{\"workspaceRoot\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"claimId\":{\"type\":\"string\",\"pattern\":\"^window_work_claim_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"}}}");
