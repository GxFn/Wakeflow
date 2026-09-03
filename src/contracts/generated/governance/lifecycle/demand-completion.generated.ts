/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/lifecycle/demand-completion.schema.json
 */

export type ProgramId = string
export type DemandId = string
export type WindowId = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
export type EventId = string
/**
 * TODO intake 使用的 Wakeflow 持久类型化身份；由 owner 分配，不从标题、路径、时间或集合位置推导。
 */
export type WakeflowTodoItemIdText = string
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string

/**
 * Controller在全部必要implementation与Test Target接受后形成的Demand成功终态记录。
 */
export interface WakeflowDemandCompletion {
kind: "WakeflowDemandCompletion"
schemaVersion: 1
programId: ProgramId
demandId: DemandId
controllerWindowId: WindowId
authorityDigest: WakeflowSha256DigestText
testingMode: ("controller-only" | "real-environment")
postAcceptanceRouteDigest: WakeflowSha256DigestText
reviewSnapshotDigest: WakeflowSha256DigestText
observedState: ObservedState
todoSource: TodoSource
completedAt: WakeflowUtcInstantText
completionDigest: WakeflowSha256DigestText
}
export interface ObservedState {
streamRevision: number
stateDigest: WakeflowSha256DigestText
lastEventId: EventId
lastEventDigest: WakeflowSha256DigestText
}
export interface TodoSource {
todoId: WakeflowTodoItemIdText
intakeRef: WakeflowPortableResourcePathText
intakeDigest: WakeflowSha256DigestText
stateRevision: number
stateDigest: WakeflowSha256DigestText
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
export const WAKEFLOW_DEMAND_COMPLETION_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:lifecycle:demand-completion:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_COMPLETION_SCHEMA\",\"title\":\"WakeflowDemandCompletion\",\"description\":\"Controller在全部必要implementation与Test Target接受后形成的Demand成功终态记录。\",\"$comment\":\"testingMode必须与冻结Demand Authority及preflight route一致。Completion绑定post-acceptance route、Review Snapshot、Event Stream与claimed TODO来源；它不删除Test lineage、不归档TODO、不关闭宿主资源，也不表示BusinessArchive已经完成。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"programId\",\"demandId\",\"controllerWindowId\",\"authorityDigest\",\"testingMode\",\"postAcceptanceRouteDigest\",\"reviewSnapshotDigest\",\"observedState\",\"todoSource\",\"completedAt\",\"completionDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowDemandCompletion\"},\"schemaVersion\":{\"const\":1},\"programId\":{\"$ref\":\"#/$defs/programId\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"controllerWindowId\":{\"$ref\":\"#/$defs/windowId\"},\"authorityDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"testingMode\":{\"enum\":[\"controller-only\",\"real-environment\"]},\"postAcceptanceRouteDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"reviewSnapshotDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"observedState\":{\"$ref\":\"#/$defs/observedState\"},\"todoSource\":{\"$ref\":\"#/$defs/todoSource\"},\"completedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"completionDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}},\"$defs\":{\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"observedState\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"streamRevision\",\"stateDigest\",\"lastEventId\",\"lastEventDigest\"],\"properties\":{\"streamRevision\":{\"type\":\"integer\",\"minimum\":1},\"stateDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"lastEventId\":{\"$ref\":\"#/$defs/eventId\"},\"lastEventDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"todoSource\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"todoId\",\"intakeRef\",\"intakeDigest\",\"stateRevision\",\"stateDigest\"],\"properties\":{\"todoId\":{\"$ref\":\"urn:wakeflow:governance:todo:item-id:v1\"},\"intakeRef\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"intakeDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"stateRevision\":{\"type\":\"integer\",\"minimum\":2},\"stateDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}}}}");
