/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/workspace/window-host-binding.schema.json
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
export const WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:workspace:window-runtime:host-binding:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA\",\"title\":\"WakeflowWindowHostBinding\",\"description\":\"Portable shape of one private current-host binding. The TypeScript owner additionally validates hostId and the opaque handle against the supplied Host Identity Profile.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"programId\",\"hostId\",\"windowId\",\"bindingId\",\"handle\",\"source\",\"registeredAt\"],\"properties\":{\"kind\":{\"const\":\"WakeflowWindowHostBinding\"},\"schemaVersion\":{\"const\":1},\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"hostId\":{\"enum\":[\"codex\",\"claude-code\"]},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"bindingId\":{\"type\":\"string\",\"pattern\":\"^window_binding_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"handle\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"value\"],\"properties\":{\"kind\":{\"type\":\"string\",\"pattern\":\"^[a-z][a-z0-9-]{0,63}$\"},\"value\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":1024,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"}}},\"source\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"launchIntentDigest\",\"observedAt\"],\"properties\":{\"kind\":{\"const\":\"agent-host-create-result\"},\"launchIntentDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"observedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"}}},\"registeredAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"}}}");
