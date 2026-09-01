/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/demand-completed-event-data-v1.schema.json
 */

/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * TODO intake 使用的稳定、用户可读 opaque ID；允许字母、数字、点、下划线、冒号和连字符，不从标题或路径推导。
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
 * lifecycle.demand-completed persisted event v1 的严格payload。
 */
export interface WakeflowDemandCompletedEventDataV1 {
completion: WakeflowDemandCompletion
}
/**
 * Controller在全部必要implementation与Test Target接受后形成的Demand成功终态记录。
 */
export interface WakeflowDemandCompletion {
kind: "WakeflowDemandCompletion"
schemaVersion: 1
programId: string
demandId: string
controllerWindowId: string
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
lastEventId: string
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
export const WAKEFLOW_DEMAND_COMPLETED_EVENT_DATA_V1_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-sourcing:demand-completed-data:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_COMPLETED_EVENT_DATA_V1_SCHEMA\",\"title\":\"WakeflowDemandCompletedEventDataV1\",\"description\":\"lifecycle.demand-completed persisted event v1 的严格payload。\",\"$comment\":\"完整DemandCompletion是已发生的成功终态事实；TODO归档、BusinessArchive和宿主关闭仍由后续owner持有。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"completion\"],\"properties\":{\"completion\":{\"$ref\":\"urn:wakeflow:governance:lifecycle:demand-completion:v1\"}}}");
