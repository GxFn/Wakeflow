/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/demand-identity.schema.json
 */

export type ProgramId = string
export type DemandId = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
export type NonEmptyText = string
/**
 * TODO intake 使用的 Wakeflow 持久类型化身份；由 owner 分配，不从标题、路径、时间或集合位置推导。
 */
export type WakeflowTodoItemIdText = string
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * 跨领域只读消费一份已验证 Ledger authority member 的完整 ref/digest 关系。
 */
export type WakeflowLedgerAuthorityMemberReference = ({
[k: string]: unknown | undefined
} & {
artifactKind: "wakeflow-ledger-authority-member-reference"
schemaVersion: 1
family: ("requirement" | "confirmation")
recordId: string
recordRef: WakeflowPortableResourcePathText
recordDigest: WakeflowSha256DigestText
memberPath: WakeflowPortableResourcePathText
memberRef: WakeflowPortableResourcePathText
memberDigest: WakeflowSha256DigestText
role: ("original-plan" | "requirement-design" | "code-facts" | "landing-plan" | "non-goals" | "user-confirmation" | "reproduction" | "scope" | "requirement-delta" | "research-question" | "boundaries" | "test-environment" | "supporting-evidence" | "goal-stage-decision")
mediaType: string
})

/**
 * Demand Event Sourcing Aggregate 创建后不可变的 identity authority。
 */
export interface WakeflowDemandIdentity {
artifactKind: "wakeflow-demand-identity"
schemaVersion: 1
programId: ProgramId
demandId: DemandId
createdAt: WakeflowUtcInstantText
title: NonEmptyText
goal: NonEmptyText
completionDefinition: NonEmptyText
demandType: ("requirement" | "bug" | "supplement" | "research")
source: WakeflowTodoIntakeLineageReference
executionPlacement: (MainPlacement | IsolatedPlacement)
}
/**
 * 跨 Aggregate 绑定一份 immutable TODO intake 的 portable ref/digest。
 */
export interface WakeflowTodoIntakeLineageReference {
artifactKind: "wakeflow-todo-intake-lineage"
schemaVersion: 1
todoId: WakeflowTodoItemIdText
intakeRef: WakeflowPortableResourcePathText
intakeDigest: WakeflowSha256DigestText
}
export interface MainPlacement {
mode: "main"
}
export interface IsolatedPlacement {
mode: "isolated"
authorizationRef: WakeflowLedgerAuthorityMemberReference
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
export const WAKEFLOW_DEMAND_IDENTITY_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:identity:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_IDENTITY_SCHEMA\",\"title\":\"WakeflowDemandIdentity\",\"description\":\"Demand Event Sourcing Aggregate 创建后不可变的 identity authority。\",\"$comment\":\"TODO lineage、isolated placement authorization 和 typed identity 的跨记录解析由 Demand identity codec 继续校验。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"programId\",\"demandId\",\"createdAt\",\"title\",\"goal\",\"completionDefinition\",\"demandType\",\"source\",\"executionPlacement\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-demand-identity\"},\"schemaVersion\":{\"const\":1},\"programId\":{\"$ref\":\"#/$defs/programId\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"createdAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"title\":{\"$ref\":\"#/$defs/nonEmptyText\"},\"goal\":{\"$ref\":\"#/$defs/nonEmptyText\"},\"completionDefinition\":{\"$ref\":\"#/$defs/nonEmptyText\"},\"demandType\":{\"enum\":[\"requirement\",\"bug\",\"supplement\",\"research\"]},\"source\":{\"$ref\":\"urn:wakeflow:governance:todo:intake-lineage:v1\"},\"executionPlacement\":{\"oneOf\":[{\"$ref\":\"#/$defs/mainPlacement\"},{\"$ref\":\"#/$defs/isolatedPlacement\"}]}},\"$defs\":{\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"nonEmptyText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":16384,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"mainPlacement\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"mode\"],\"properties\":{\"mode\":{\"const\":\"main\"}}},\"isolatedPlacement\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"mode\",\"authorizationRef\"],\"properties\":{\"mode\":{\"const\":\"isolated\"},\"authorizationRef\":{\"$ref\":\"urn:wakeflow:governance:ledger:authority-member-reference:v1\"}}}}}");
