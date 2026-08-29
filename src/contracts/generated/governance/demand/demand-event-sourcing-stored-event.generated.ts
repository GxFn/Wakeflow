/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/demand-event-sourcing-stored-event.schema.json
 */

export type EventId = string
export type DemandId = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string

/**
 * Demand Event Store 中稳定的 persisted event envelope；eventType 与 eventVersion 由版本 Registry 路由到严格 payload codec。
 */
export interface WakeflowDemandEventSourcingStoredEvent {
artifactKind: "wakeflow-demand-event-sourcing-event"
schemaVersion: 1
eventId: EventId
demandId: DemandId
streamRevision: number
recordedAt: WakeflowUtcInstantText
eventType: string
eventVersion: number
data: {
[k: string]: unknown | undefined
}
resultingStateModelVersion: number
resultingStateDigest: WakeflowSha256DigestText
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
export const WAKEFLOW_DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-sourcing-stored-event:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA\",\"title\":\"WakeflowDemandEventSourcingStoredEvent\",\"description\":\"Demand Event Store 中稳定的 persisted event envelope；eventType 与 eventVersion 由版本 Registry 路由到严格 payload codec。\",\"$comment\":\"Envelope 只拥有跨版本稳定字段。受支持版本的 data 结构由独立版本 Schema 与 codec 验证；未知版本必须进入 Registry 后稳定拒绝。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"eventId\",\"demandId\",\"streamRevision\",\"recordedAt\",\"eventType\",\"eventVersion\",\"data\",\"resultingStateModelVersion\",\"resultingStateDigest\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-demand-event-sourcing-event\"},\"schemaVersion\":{\"const\":1},\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"recordedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"eventType\":{\"type\":\"string\",\"minLength\":3,\"maxLength\":128,\"pattern\":\"^[a-z][a-z0-9-]*(?:\\\\.[a-z][a-z0-9-]*)+$\"},\"eventVersion\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"data\":{\"type\":\"object\",\"maxProperties\":64},\"resultingStateModelVersion\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"resultingStateDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}},\"$defs\":{\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}");
