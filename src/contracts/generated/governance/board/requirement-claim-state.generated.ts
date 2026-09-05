/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/board/requirement-claim-state.schema.json
 */

/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string

/**
 * 需求包在看板上的认领状态：pending、parked、claimed、withdrawn、archived 的修订链快照（ADR-0011 D1 D5）。
 */
export interface WakeflowRequirementClaimState {
artifactKind: "wakeflow-requirement-claim-state"
schemaVersion: 1
requirementId: string
programId: string
recordDigest: WakeflowSha256DigestText
title: string
demandType: ("requirement" | "bug" | "supplement" | "research")
priority: ("P0" | "P1" | "P2" | "P3")
publishedAt: WakeflowUtcInstantText
supersedes: (null | string)
revision: number
previousStateDigest: (null | WakeflowSha256DigestText)
status: ("pending" | "parked" | "claimed" | "withdrawn" | "archived")
updatedAt: WakeflowUtcInstantText
parked: (null | {
trigger: string
})
claim: (null | {
demandId: string
claimedAt: WakeflowUtcInstantText
})
withdrawal: (null | {
reason: string
withdrawnAt: WakeflowUtcInstantText
})
archive: (null | {
demandId: string
archivedAt: WakeflowUtcInstantText
})
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
export const WAKEFLOW_REQUIREMENT_CLAIM_STATE_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:board:requirement-claim-state:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_REQUIREMENT_CLAIM_STATE_SCHEMA\",\"title\":\"WakeflowRequirementClaimState\",\"description\":\"需求包在看板上的认领状态：pending、parked、claimed、withdrawn、archived 的修订链快照（ADR-0011 D1 D5）。\",\"$comment\":\"Schema 负责可移植结构；转移矩阵、修订链与状态载荷的一致性由内核 requirement-board 校验。整文件 CAS 替换是唯一变更方式。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"requirementId\",\"programId\",\"recordDigest\",\"title\",\"demandType\",\"priority\",\"publishedAt\",\"supersedes\",\"revision\",\"previousStateDigest\",\"status\",\"updatedAt\",\"parked\",\"claim\",\"withdrawal\",\"archive\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-requirement-claim-state\"},\"schemaVersion\":{\"const\":1},\"requirementId\":{\"type\":\"string\",\"pattern\":\"^requirement_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"recordDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"title\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":256,\"pattern\":\"^(?!\\\\s)[^\\\\u0000-\\\\u001F\\\\u007F]*\\\\S$\"},\"demandType\":{\"enum\":[\"requirement\",\"bug\",\"supplement\",\"research\"]},\"priority\":{\"enum\":[\"P0\",\"P1\",\"P2\",\"P3\"]},\"publishedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"supersedes\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"pattern\":\"^requirement_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}]},\"revision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"previousStateDigest\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}]},\"status\":{\"enum\":[\"pending\",\"parked\",\"claimed\",\"withdrawn\",\"archived\"]},\"updatedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"parked\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"trigger\"],\"properties\":{\"trigger\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":4096,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"}}}]},\"claim\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"demandId\",\"claimedAt\"],\"properties\":{\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"claimedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"}}}]},\"withdrawal\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"reason\",\"withdrawnAt\"],\"properties\":{\"reason\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":4096,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"withdrawnAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"}}}]},\"archive\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"demandId\",\"archivedAt\"],\"properties\":{\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"archivedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"}}}]}}}");
