/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/demand-aggregate-state.schema.json
 */

export type DemandId = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
export type TargetTaskId = string
export type TaskPackageId = string
export type RepositoryId = string
export type WindowId = string

/**
 * 由 Demand domain event reducer 唯一生成的最小业务 Aggregate state。
 */
export interface WakeflowDemandAggregateState {
artifactKind: "wakeflow-demand-aggregate-state"
schemaVersion: 1
demandId: DemandId
authorityDigest: WakeflowSha256DigestText
lifecycle: ("active" | "cancelled")
/**
 * @maxItems 10000
 */
targetTasks: TargetTask[]
}
export interface TargetTask {
targetTaskId: TargetTaskId
taskPackageId: TaskPackageId
taskPackageDigest: WakeflowSha256DigestText
repositoryId: RepositoryId
windowId: WindowId
phase: "planned"
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
export const WAKEFLOW_DEMAND_AGGREGATE_STATE_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:aggregate-state:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_AGGREGATE_STATE_SCHEMA\",\"title\":\"WakeflowDemandAggregateState\",\"description\":\"由 Demand domain event reducer 唯一生成的最小业务 Aggregate state。\",\"$comment\":\"stream revision、event tail 与 snapshot metadata 不进入本状态；authorityDigest 是 TaskPackage 准入所需的 publication 派生事实。Delivery、Result、Testing、Review、Evidence 与 Pod 不以空占位字段提前进入状态模型。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"demandId\",\"authorityDigest\",\"lifecycle\",\"targetTasks\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-demand-aggregate-state\"},\"schemaVersion\":{\"const\":1},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"authorityDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"lifecycle\":{\"enum\":[\"active\",\"cancelled\"]},\"targetTasks\":{\"type\":\"array\",\"maxItems\":10000,\"items\":{\"$ref\":\"#/$defs/targetTask\"}}},\"$defs\":{\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"taskPackageId\":{\"type\":\"string\",\"pattern\":\"^task-package_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTask\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetTaskId\",\"taskPackageId\",\"taskPackageDigest\",\"repositoryId\",\"windowId\",\"phase\"],\"properties\":{\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"taskPackageId\":{\"$ref\":\"#/$defs/taskPackageId\"},\"taskPackageDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"phase\":{\"const\":\"planned\"}}}}}");
