/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-window-host-binding-registration-request.schema.json
 */

export type Sha256Digest = string
export type UtcInstant = string

/**
 * Closed MCP request carrying an Agent-observed host create result into the current-host Window Host Binding owner.
 */
export interface WakeflowWindowHostBindingRegistrationRequestV1 {
/**
 * Absolute path of the existing Wakeflow workspace root.
 */
root: string
observation: {
kind: "WakeflowAgentHostWindowCreationObservation"
schemaVersion: 1
source: "agent-host-create-result"
hostId: ("codex" | "claude-code")
windowId: string
launchIntentDigest: Sha256Digest
handle: {
kind: string
value: string
}
observedAt: UtcInstant
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
export const WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:window-host-binding-registration-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_REQUEST_SCHEMA\",\"title\":\"WakeflowWindowHostBindingRegistrationRequestV1\",\"description\":\"Closed MCP request carrying an Agent-observed host create result into the current-host Window Host Binding owner.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"observation\"],\"properties\":{\"root\":{\"type\":\"string\",\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"observation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"source\",\"hostId\",\"windowId\",\"launchIntentDigest\",\"handle\",\"observedAt\"],\"properties\":{\"kind\":{\"const\":\"WakeflowAgentHostWindowCreationObservation\"},\"schemaVersion\":{\"const\":1},\"source\":{\"const\":\"agent-host-create-result\"},\"hostId\":{\"enum\":[\"codex\",\"claude-code\"]},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"launchIntentDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"handle\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"value\"],\"properties\":{\"kind\":{\"type\":\"string\",\"pattern\":\"^[a-z][a-z0-9-]{0,63}$\"},\"value\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":1024}}},\"observedAt\":{\"$ref\":\"#/$defs/utcInstant\"}}}},\"$defs\":{\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"}}}");
