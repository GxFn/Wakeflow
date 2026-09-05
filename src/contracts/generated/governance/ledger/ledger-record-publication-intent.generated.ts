/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/ledger/ledger-record-publication-intent.schema.json
 */

/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string

/**
 * Ledger immutable record tree 整体发布的短期元数据意图。
 */
export interface WakeflowLedgerRecordPublicationIntent {
artifactKind: "wakeflow-ledger-record-publication-intent"
schemaVersion: 1
record: WakeflowRequirementRecord
finalRootRef: WakeflowPortableResourcePathText
intentRef: WakeflowPortableResourcePathText
lockRef: WakeflowPortableResourcePathText
stageRef: WakeflowPortableResourcePathText
treePlan: WakeflowDirectoryTreeCandidatePlan
}
/**
 * 需求包在 Ledger 中的不可变记录：头部元数据（含发布时的 parked 触发条件）、requirement.md 与 landing.md 加可选附件的成员摘要、章节锚点与确认点 1 的摘要（ADR-0011 D1 D3 D4）。recordedAt 取确认时间，使记录字节由请求完全决定。
 */
export interface WakeflowRequirementRecord {
artifactKind: "wakeflow-requirement-record"
schemaVersion: 1
requirementId: string
programId: string
recordedAt: WakeflowUtcInstantText
title: string
demandType: ("requirement" | "bug" | "supplement" | "research")
priority: ("P0" | "P1" | "P2" | "P3")
originWindowId: string
testingDecision: {
mode: ("controller-only" | "real-environment" | "not-applicable")
summary: string
}
taskPlanReview: ("controller" | "user")
supersedes: (null | string)
parked: (null | {
trigger: string
})
confirmation: {
confirmedAt: WakeflowUtcInstantText
sectionDigest: WakeflowSha256DigestText
}
/**
 * @minItems 2
 * @maxItems 18
 */
documents: [Document, Document]|[Document, Document, Document]|[Document, Document, Document, Document]|[Document, Document, Document, Document, Document]|[Document, Document, Document, Document, Document, Document]|[Document, Document, Document, Document, Document, Document, Document]|[Document, Document, Document, Document, Document, Document, Document, Document]|[Document, Document, Document, Document, Document, Document, Document, Document, Document]|[Document, Document, Document, Document, Document, Document, Document, Document, Document, Document]|[Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document]|[Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document]|[Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document]|[Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document]|[Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document]|[Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document]|[Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document]|[Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document, Document]
/**
 * @maxItems 256
 */
sections: Section[]
}
export interface Document {
role: ("requirement" | "landing" | "attachment")
path: WakeflowPortableResourcePathText
mediaType: string
digest: WakeflowSha256DigestText
}
export interface Section {
path: WakeflowPortableResourcePathText
anchor: string
heading: string
line: number
bodyDigest: WakeflowSha256DigestText
}
/**
 * 可整体发布的关闭目录树候选元数据计划。
 */
export interface WakeflowDirectoryTreeCandidatePlan {
artifactKind: "wakeflow-directory-tree-candidate-plan"
schemaVersion: 1
directoryMode: number
/**
 * @maxItems 8192
 */
directories: WakeflowPortableResourcePathText[]
/**
 * @minItems 1
 * @maxItems 4096
 */
files: [File, ...(File)[]]
totalBytes: number
treeDigest: WakeflowSha256DigestText
}
export interface File {
path: WakeflowPortableResourcePathText
byteCount: number
digest: WakeflowSha256DigestText
mode: number
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
export const WAKEFLOW_LEDGER_RECORD_PUBLICATION_INTENT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:ledger:record-publication-intent:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_LEDGER_RECORD_PUBLICATION_INTENT_SCHEMA\",\"title\":\"WakeflowLedgerRecordPublicationIntent\",\"description\":\"Ledger immutable record tree 整体发布的短期元数据意图。\",\"$comment\":\"Intent 保存 exact record、物理 refs 与关闭树摘要，但不重复保存可由 record 推导的 family/recordId，也不复制 member payload；完整 stage 是待发布数据，final directory rename 是 authority commit point。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"record\",\"finalRootRef\",\"intentRef\",\"lockRef\",\"stageRef\",\"treePlan\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-ledger-record-publication-intent\"},\"schemaVersion\":{\"const\":1},\"record\":{\"$ref\":\"urn:wakeflow:governance:ledger:requirement-record:v1\"},\"finalRootRef\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"intentRef\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"lockRef\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"stageRef\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"treePlan\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:directory-tree-candidate-plan:v1\"}}}");
