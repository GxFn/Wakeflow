/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/workspace/agent-host-window-observation.schema.json
 */

/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string

/**
 * Transient Agent report identifying one current host window candidate and attesting that its observed context matches the current Config logical root. Raw handles are request-only secrets and must not be persisted or returned.
 */
export interface WakeflowAgentHostWindowObservation {
kind: "WakeflowAgentHostWindowObservation"
schemaVersion: 1
source: "agent-host-inspection-result"
hostId: ("codex" | "claude-code")
windowId: string
bindingId: string
handle: Handle
attestedRoot: {
status: "matches-configured-root"
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
}
observedAt: WakeflowUtcInstantText
}
export interface Handle {
kind: string
value: string
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
export const WAKEFLOW_AGENT_HOST_WINDOW_OBSERVATION_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:workspace:window-runtime:agent-host-window-observation:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_AGENT_HOST_WINDOW_OBSERVATION_SCHEMA\",\"title\":\"WakeflowAgentHostWindowObservation\",\"description\":\"Transient Agent report identifying one current host window candidate and attesting that its observed context matches the current Config logical root. Raw handles are request-only secrets and must not be persisted or returned.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"source\",\"hostId\",\"windowId\",\"bindingId\",\"handle\",\"attestedRoot\",\"observedAt\"],\"properties\":{\"kind\":{\"const\":\"WakeflowAgentHostWindowObservation\"},\"schemaVersion\":{\"const\":1},\"source\":{\"const\":\"agent-host-inspection-result\"},\"hostId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:host-binding:v1#/properties/hostId\"},\"windowId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:host-binding:v1#/properties/windowId\"},\"bindingId\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:host-binding:v1#/properties/bindingId\"},\"handle\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:host-binding:v1#/properties/handle\"},\"attestedRoot\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"logicalRoot\",\"configuredPlacement\"],\"properties\":{\"status\":{\"const\":\"matches-configured-root\"},\"logicalRoot\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:unregistered-projection:v1#/properties/logicalRoot\"},\"configuredPlacement\":{\"$ref\":\"urn:wakeflow:workspace:window-runtime:unregistered-projection:v1#/properties/configuredPlacement\"}}},\"observedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"}}}");
