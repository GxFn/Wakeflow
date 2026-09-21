/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/workspace/window-runtime-registered-projection.schema.json
 */
/** 递归冻结生成的 Schema，阻止校验器首次使用前发生嵌套漂移。 */
function freezeGeneratedSchema(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        for (const child of Object.values(value))
            freezeGeneratedSchema(child);
        Object.freeze(value);
    }
    return value;
}
/** 从 JSON 文本恢复 Schema，保留 `__proto__` 等普通 JSON 自有键。 */
function restoreGeneratedSchema(serialized) {
    const value = JSON.parse(serialized);
    if (value === null || Array.isArray(value) || typeof value !== "object") {
        throw new TypeError("Generated Schema must be an object.");
    }
    return freezeGeneratedSchema(value);
}
/** Ajv 严格校验器使用的 Schema 派生运行时权威；不得手工修改。 */
export const WAKEFLOW_WINDOW_RUNTIME_REGISTERED_PROJECTION_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:workspace:window-runtime:registered-projection:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_WINDOW_RUNTIME_REGISTERED_PROJECTION_SCHEMA\",\"title\":\"WakeflowWindowRuntimeRegisteredProjection\",\"description\":\"Regenerable, redacted host-local projection for one durable window after a private current-host binding has been registered.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"programId\",\"hostId\",\"windowId\",\"role\",\"logicalRoot\",\"configuredPlacement\",\"identity\",\"rootObservation\",\"preflight\",\"sourceFingerprints\",\"projectionDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowWindowRuntimeProjection\"},\"schemaVersion\":{\"const\":1},\"programId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:unregistered-projection:v1#/properties/programId\"},\"hostId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:unregistered-projection:v1#/properties/hostId\"},\"windowId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:unregistered-projection:v1#/properties/windowId\"},\"role\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:unregistered-projection:v1#/properties/role\"},\"logicalRoot\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:unregistered-projection:v1#/properties/logicalRoot\"},\"configuredPlacement\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:unregistered-projection:v1#/properties/configuredPlacement\"},\"identity\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"bindingRef\",\"bindingId\"],\"properties\":{\"status\":{\"const\":\"registered\"},\"bindingRef\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":4096},\"bindingId\":{\"type\":\"string\",\"pattern\":\"^window_binding_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}},\"rootObservation\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:unregistered-projection:v1#/properties/rootObservation\"},\"preflight\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"blockingReasons\"],\"properties\":{\"status\":{\"const\":\"blocked\"},\"blockingReasons\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":1,\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"code\",\"source\"],\"properties\":{\"code\":{\"const\":\"root-unobserved\"},\"source\":{\"const\":\"root-observation\"}}}}}},\"sourceFingerprints\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"desiredTopologyDigest\",\"windowTopologyDigest\",\"rootObservationDigest\"],\"properties\":{\"desiredTopologyDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"windowTopologyDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"rootObservationDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"projectionDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}}");
