/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/archive/demand-archive-manifest.schema.json
 */

/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string

/**
 * 一个已完成或已取消 Demand 的归档包清单：谱系、终态事件回执、verify 摘要、负载树摘要（ADR-0012 D3，能力卡 8）。
 */
export interface WakeflowDemandArchiveManifest {
kind: "WakeflowDemandArchiveManifest"
schemaVersion: 1
archiveRef: WakeflowPortableResourcePathText
demandId: string
programId: string
requirementId: string
outcome: ("completed" | "cancelled")
terminalEvent: {
eventId: string
streamRevision: number
commitId: string
}
archivedAt: WakeflowUtcInstantText
controllerWindowId: string
package: {
requirementId: string
recordRef: WakeflowPortableResourcePathText
recordDigest: WakeflowSha256DigestText
claimStateRevision: number
}
verify: {
observationDigest: WakeflowSha256DigestText
reportDigest: WakeflowSha256DigestText
gateCount: number
failedCount: number
}
payload: {
treeDigest: WakeflowSha256DigestText
fileCount: number
totalBytes: number
/**
 * @maxItems 8
 */
excluded: []|[WakeflowPortableResourcePathText]|[WakeflowPortableResourcePathText, WakeflowPortableResourcePathText]|[WakeflowPortableResourcePathText, WakeflowPortableResourcePathText, WakeflowPortableResourcePathText]|[WakeflowPortableResourcePathText, WakeflowPortableResourcePathText, WakeflowPortableResourcePathText, WakeflowPortableResourcePathText]|[WakeflowPortableResourcePathText, WakeflowPortableResourcePathText, WakeflowPortableResourcePathText, WakeflowPortableResourcePathText, WakeflowPortableResourcePathText]|[WakeflowPortableResourcePathText, WakeflowPortableResourcePathText, WakeflowPortableResourcePathText, WakeflowPortableResourcePathText, WakeflowPortableResourcePathText, WakeflowPortableResourcePathText]|[WakeflowPortableResourcePathText, WakeflowPortableResourcePathText, WakeflowPortableResourcePathText, WakeflowPortableResourcePathText, WakeflowPortableResourcePathText, WakeflowPortableResourcePathText, WakeflowPortableResourcePathText]|[WakeflowPortableResourcePathText, WakeflowPortableResourcePathText, WakeflowPortableResourcePathText, WakeflowPortableResourcePathText, WakeflowPortableResourcePathText, WakeflowPortableResourcePathText, WakeflowPortableResourcePathText, WakeflowPortableResourcePathText]
}
worktree: null
manifestDigest: WakeflowSha256DigestText
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
export const WAKEFLOW_DEMAND_ARCHIVE_MANIFEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:archive:demand-archive-manifest:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_ARCHIVE_MANIFEST_SCHEMA\",\"title\":\"WakeflowDemandArchiveManifest\",\"description\":\"一个已完成或已取消 Demand 的归档包清单：谱系、终态事件回执、verify 摘要、负载树摘要（ADR-0012 D3，能力卡 8）。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"archiveRef\",\"demandId\",\"programId\",\"requirementId\",\"outcome\",\"terminalEvent\",\"archivedAt\",\"controllerWindowId\",\"package\",\"verify\",\"payload\",\"worktree\",\"manifestDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowDemandArchiveManifest\"},\"schemaVersion\":{\"const\":1},\"archiveRef\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"requirementId\":{\"type\":\"string\",\"pattern\":\"^requirement_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"outcome\":{\"enum\":[\"completed\",\"cancelled\"]},\"terminalEvent\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"eventId\",\"streamRevision\",\"commitId\"],\"properties\":{\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":2,\"maximum\":9007199254740991},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}},\"archivedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"controllerWindowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"package\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"requirementId\",\"recordRef\",\"recordDigest\",\"claimStateRevision\"],\"properties\":{\"requirementId\":{\"type\":\"string\",\"pattern\":\"^requirement_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"recordRef\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"recordDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"claimStateRevision\":{\"type\":\"integer\",\"minimum\":2,\"maximum\":9007199254740991}}},\"verify\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"observationDigest\",\"reportDigest\",\"gateCount\",\"failedCount\"],\"properties\":{\"observationDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"reportDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"gateCount\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":64},\"failedCount\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":64}}},\"payload\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"treeDigest\",\"fileCount\",\"totalBytes\",\"excluded\"],\"properties\":{\"treeDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"fileCount\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":4096},\"totalBytes\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":9007199254740991},\"excluded\":{\"type\":\"array\",\"maxItems\":8,\"items\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"}}}},\"worktree\":{\"type\":\"null\"},\"manifestDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}}");
