/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/demand-event-stream-commit.schema.json
 */

export type CommitId = string
export type DemandId = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string

/**
 * 一次 Demand Event Store append 的不可变、原子 commit batch。
 */
export interface WakeflowDemandEventStreamCommit {
artifactKind: "wakeflow-demand-event-stream-commit"
schemaVersion: 1
commitId: CommitId
demandId: DemandId
commitSequence: number
commandDigest: WakeflowSha256DigestText
expectedStreamRevision: number
firstStreamRevision: number
lastStreamRevision: number
previousCommitDigest: (null | WakeflowSha256DigestText)
/**
 * @minItems 1
 * @maxItems 64
 */
events: [WakeflowDemandEventSourcingStoredEvent, ...(WakeflowDemandEventSourcingStoredEvent)[]]
}
/**
 * Demand Event Store 中稳定的 persisted event envelope；eventType 与 eventVersion 由版本 Registry 路由到严格 payload codec。
 */
export interface WakeflowDemandEventSourcingStoredEvent {
artifactKind: "wakeflow-demand-event-sourcing-event"
schemaVersion: 1
eventId: string
demandId: string
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
export const WAKEFLOW_DEMAND_EVENT_STREAM_COMMIT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-stream-commit:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_EVENT_STREAM_COMMIT_SCHEMA\",\"title\":\"WakeflowDemandEventStreamCommit\",\"description\":\"一次 Demand Event Store append 的不可变、原子 commit batch。\",\"$comment\":\"commitSequence 是连续物理槽位；一个 commit 可以包含多个连续 stream revision，previousCommitDigest 形成 append chain。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"commitId\",\"demandId\",\"commitSequence\",\"commandDigest\",\"expectedStreamRevision\",\"firstStreamRevision\",\"lastStreamRevision\",\"previousCommitDigest\",\"events\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-demand-event-stream-commit\"},\"schemaVersion\":{\"const\":1},\"commitId\":{\"$ref\":\"#/$defs/commitId\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"commitSequence\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"commandDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"expectedStreamRevision\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":9007199254740991},\"firstStreamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"lastStreamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"previousCommitDigest\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}]},\"events\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":64,\"items\":{\"$ref\":\"urn:wakeflow:governance:demand:event-sourcing-stored-event:v1\"}}},\"$defs\":{\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}");
