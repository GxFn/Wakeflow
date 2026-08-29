/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/workspace/window-runtime-registered-projection.schema.json
 */

/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string

/**
 * Regenerable, redacted host-local projection for one durable window after a private current-host binding has been registered.
 */
export interface WakeflowWindowRuntimeRegisteredProjection {
kind: "WakeflowWindowRuntimeProjection"
schemaVersion: 1
programId: string
hostId: ("codex" | "claude-code")
windowId: string
role: ("controller" | "design" | "test" | "product")
logicalRoot: ({
kind: "program"
programId: string
} | {
kind: "support-surface"
surfaceId: string
} | {
kind: "repository"
repositoryId: string
})
configuredPlacement: string
identity: {
status: "registered"
bindingRef: string
bindingId: string
}
rootObservation: RootObservation
preflight: {
status: "blocked"
/**
 * @minItems 1
 * @maxItems 1
 */
blockingReasons: [{
code: "root-unobserved"
source: "root-observation"
}]
}
sourceFingerprints: {
desiredTopologyDigest: WakeflowSha256DigestText
windowTopologyDigest: WakeflowSha256DigestText
rootObservationDigest: WakeflowSha256DigestText
}
projectionDigest: WakeflowSha256DigestText
}
export interface RootObservation {
status: "unobserved"
observationDigest: WakeflowSha256DigestText
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
export const WAKEFLOW_WINDOW_RUNTIME_REGISTERED_PROJECTION_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:workspace:window-runtime:registered-projection:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_WINDOW_RUNTIME_REGISTERED_PROJECTION_SCHEMA\",\"title\":\"WakeflowWindowRuntimeRegisteredProjection\",\"description\":\"Regenerable, redacted host-local projection for one durable window after a private current-host binding has been registered.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"programId\",\"hostId\",\"windowId\",\"role\",\"logicalRoot\",\"configuredPlacement\",\"identity\",\"rootObservation\",\"preflight\",\"sourceFingerprints\",\"projectionDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowWindowRuntimeProjection\"},\"schemaVersion\":{\"const\":1},\"programId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:unregistered-projection:v1#/properties/programId\"},\"hostId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:unregistered-projection:v1#/properties/hostId\"},\"windowId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:unregistered-projection:v1#/properties/windowId\"},\"role\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:unregistered-projection:v1#/properties/role\"},\"logicalRoot\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:unregistered-projection:v1#/properties/logicalRoot\"},\"configuredPlacement\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:unregistered-projection:v1#/properties/configuredPlacement\"},\"identity\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"bindingRef\",\"bindingId\"],\"properties\":{\"status\":{\"const\":\"registered\"},\"bindingRef\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":4096},\"bindingId\":{\"type\":\"string\",\"pattern\":\"^window_binding_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}},\"rootObservation\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:unregistered-projection:v1#/properties/rootObservation\"},\"preflight\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"blockingReasons\"],\"properties\":{\"status\":{\"const\":\"blocked\"},\"blockingReasons\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":1,\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"code\",\"source\"],\"properties\":{\"code\":{\"const\":\"root-unobserved\"},\"source\":{\"const\":\"root-observation\"}}}}}},\"sourceFingerprints\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"desiredTopologyDigest\",\"windowTopologyDigest\",\"rootObservationDigest\"],\"properties\":{\"desiredTopologyDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"windowTopologyDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"rootObservationDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"projectionDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}}");
