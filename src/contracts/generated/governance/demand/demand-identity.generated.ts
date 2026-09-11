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
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string

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
source: WakeflowRequirementLineageReference
/**
 * The pod this Demand advances in (ADR-0010 D3); one pod advances one Demand at a time.
 */
podId: string
}
/**
 * 跨 Aggregate 绑定一份不可变需求包记录的可移植 ref/digest；Demand 身份以此记录来源需求包。
 */
export interface WakeflowRequirementLineageReference {
artifactKind: "wakeflow-requirement-lineage"
schemaVersion: 1
requirementId: string
recordRef: WakeflowPortableResourcePathText
recordDigest: WakeflowSha256DigestText
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
export const WAKEFLOW_DEMAND_IDENTITY_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:identity:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_IDENTITY_SCHEMA\",\"title\":\"WakeflowDemandIdentity\",\"description\":\"Demand Event Sourcing Aggregate 创建后不可变的 identity authority。\",\"$comment\":\"需求包谱系、pod 存在性（配置 pods[]）和 typed identity 的跨记录解析由 Demand identity codec 与 demand 切片继续校验。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"programId\",\"demandId\",\"createdAt\",\"title\",\"goal\",\"completionDefinition\",\"demandType\",\"source\",\"podId\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-demand-identity\"},\"schemaVersion\":{\"const\":1},\"programId\":{\"$ref\":\"#/$defs/programId\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"createdAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"title\":{\"$ref\":\"#/$defs/nonEmptyText\"},\"goal\":{\"$ref\":\"#/$defs/nonEmptyText\"},\"completionDefinition\":{\"$ref\":\"#/$defs/nonEmptyText\"},\"demandType\":{\"enum\":[\"requirement\",\"bug\",\"supplement\",\"research\"]},\"source\":{\"$ref\":\"urn:wakeflow:governance:ledger:requirement-lineage:v1\"},\"podId\":{\"$ref\":\"#/$defs/podId\",\"description\":\"The pod this Demand advances in (ADR-0010 D3); one pod advances one Demand at a time.\"}},\"$defs\":{\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"nonEmptyText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":16384,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"podId\":{\"type\":\"string\",\"pattern\":\"^pod_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}");
