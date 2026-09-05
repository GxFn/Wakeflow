/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/ledger/requirement-record.schema.json
 */

export type RequirementId = string
export type ProgramId = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
export type SingleLineText = string
export type WindowId = string
export type Text = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string

/**
 * 需求包在 Ledger 中的不可变记录：头部元数据（含发布时的 parked 触发条件）、requirement.md 与 landing.md 加可选附件的成员摘要、章节锚点与确认点 1 的摘要（ADR-0011 D1 D3 D4）。recordedAt 取确认时间，使记录字节由请求完全决定。
 */
export interface WakeflowRequirementRecord {
artifactKind: "wakeflow-requirement-record"
schemaVersion: 1
requirementId: RequirementId
programId: ProgramId
recordedAt: WakeflowUtcInstantText
title: SingleLineText
demandType: ("requirement" | "bug" | "supplement" | "research")
priority: ("P0" | "P1" | "P2" | "P3")
originWindowId: WindowId
testingDecision: {
mode: ("controller-only" | "real-environment" | "not-applicable")
summary: Text
}
taskPlanReview: ("controller" | "user")
supersedes: (null | RequirementId)
parked: (null | {
trigger: Text
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
heading: SingleLineText
line: number
bodyDigest: WakeflowSha256DigestText
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
export const WAKEFLOW_REQUIREMENT_RECORD_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:ledger:requirement-record:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_REQUIREMENT_RECORD_SCHEMA\",\"title\":\"WakeflowRequirementRecord\",\"description\":\"需求包在 Ledger 中的不可变记录：头部元数据（含发布时的 parked 触发条件）、requirement.md 与 landing.md 加可选附件的成员摘要、章节锚点与确认点 1 的摘要（ADR-0011 D1 D3 D4）。recordedAt 取确认时间，使记录字节由请求完全决定。\",\"$comment\":\"Schema 负责可移植结构；成员路径与角色的一致性、章节必需表、隐私扫描与 requirementId 的内容派生由 requirement 切片校验。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"requirementId\",\"programId\",\"recordedAt\",\"title\",\"demandType\",\"priority\",\"originWindowId\",\"testingDecision\",\"taskPlanReview\",\"supersedes\",\"parked\",\"confirmation\",\"documents\",\"sections\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-requirement-record\"},\"schemaVersion\":{\"const\":1},\"requirementId\":{\"$ref\":\"#/$defs/requirementId\"},\"programId\":{\"$ref\":\"#/$defs/programId\"},\"recordedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"title\":{\"$ref\":\"#/$defs/singleLineText\"},\"demandType\":{\"enum\":[\"requirement\",\"bug\",\"supplement\",\"research\"]},\"priority\":{\"enum\":[\"P0\",\"P1\",\"P2\",\"P3\"]},\"originWindowId\":{\"$ref\":\"#/$defs/windowId\"},\"testingDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"mode\",\"summary\"],\"properties\":{\"mode\":{\"enum\":[\"controller-only\",\"real-environment\",\"not-applicable\"]},\"summary\":{\"$ref\":\"#/$defs/text\"}}},\"taskPlanReview\":{\"enum\":[\"controller\",\"user\"]},\"supersedes\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/requirementId\"}]},\"parked\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"trigger\"],\"properties\":{\"trigger\":{\"$ref\":\"#/$defs/text\"}}}]},\"confirmation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"confirmedAt\",\"sectionDigest\"],\"properties\":{\"confirmedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"sectionDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"documents\":{\"type\":\"array\",\"minItems\":2,\"maxItems\":18,\"items\":{\"$ref\":\"#/$defs/document\"}},\"sections\":{\"type\":\"array\",\"maxItems\":256,\"items\":{\"$ref\":\"#/$defs/section\"}}},\"$defs\":{\"requirementId\":{\"type\":\"string\",\"pattern\":\"^requirement_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"singleLineText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":256,\"pattern\":\"^(?!\\\\s)[^\\\\u0000-\\\\u001F\\\\u007F]*\\\\S$\"},\"text\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":4096,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"document\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"role\",\"path\",\"mediaType\",\"digest\"],\"properties\":{\"role\":{\"enum\":[\"requirement\",\"landing\",\"attachment\"]},\"path\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"mediaType\":{\"type\":\"string\",\"pattern\":\"^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$\"},\"digest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"section\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"path\",\"anchor\",\"heading\",\"line\",\"bodyDigest\"],\"properties\":{\"path\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"anchor\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[\\\\p{L}\\\\p{N}][\\\\p{L}\\\\p{N}-]{0,127}$\"},\"heading\":{\"$ref\":\"#/$defs/singleLineText\"},\"line\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":1000000},\"bodyDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}}}}");
