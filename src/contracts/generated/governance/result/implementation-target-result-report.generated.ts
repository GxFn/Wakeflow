/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/result/implementation-target-result-report.schema.json
 */

export type HumanText = string
export type RepositoryChange = ({
[k: string]: unknown | undefined
} & {
repositoryId: RepositoryId
disposition: ("committed" | "left-uncommitted" | "no-changes")
/**
 * @maxItems 64
 */
commits: WakeflowGitObjectId[]
})
export type RepositoryId = string
/**
 * Git完整对象身份及其显式对象格式；支持SHA-1和SHA-256仓库。
 */
export type WakeflowGitObjectId = (Sha1 | Sha256)
export type Token = string
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
export type AnchorId = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string

/**
 * 目标Agent对一个implementation Target Task提交的严格业务结果陈述。
 */
export interface WakeflowImplementationTargetResultReport {
kind: "WakeflowImplementationTargetResultReport"
schemaVersion: 1
outcome: ("completed" | "blocked" | "needs-review")
summary: HumanText
repositoryChange: RepositoryChange
/**
 * @maxItems 64
 */
evidenceLocators: EvidenceLocator[]
/**
 * @maxItems 64
 */
verification: HumanText[]
/**
 * @maxItems 64
 */
risks: HumanText[]
/**
 * @maxItems 32
 */
anchorEvidence: AnchorEvidence[]
reportedAt: WakeflowUtcInstantText
reportDigest: WakeflowSha256DigestText
}
export interface Sha1 {
algorithm: "sha1"
value: string
}
export interface Sha256 {
algorithm: "sha256"
value: string
}
export interface EvidenceLocator {
kind: Token
ref: WakeflowPortableResourcePathText
digest: WakeflowSha256DigestText
}
export interface AnchorEvidence {
anchorId: AnchorId
/**
 * @minItems 1
 * @maxItems 32
 */
evidenceRefs: [EvidenceRef, ...(EvidenceRef)[]]
}
export interface EvidenceRef {
ref: WakeflowPortableResourcePathText
digest: WakeflowSha256DigestText
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
export const WAKEFLOW_IMPLEMENTATION_TARGET_RESULT_REPORT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:result:implementation-target-result-report:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_IMPLEMENTATION_TARGET_RESULT_REPORT_SCHEMA\",\"title\":\"WakeflowImplementationTargetResultReport\",\"description\":\"目标Agent对一个implementation Target Task提交的严格业务结果陈述。\",\"$comment\":\"Report不声明transport、Claim或Controller acceptance；Wakeflow import owner从当前Event Sourcing authority补齐这些事实。当前v1仅支持单仓库implementation，不包含Test mapping、supersedes或多round兼容字段。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"outcome\",\"summary\",\"repositoryChange\",\"evidenceLocators\",\"verification\",\"risks\",\"anchorEvidence\",\"reportedAt\",\"reportDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowImplementationTargetResultReport\"},\"schemaVersion\":{\"const\":1},\"outcome\":{\"enum\":[\"completed\",\"blocked\",\"needs-review\"]},\"summary\":{\"$ref\":\"#/$defs/humanText\"},\"repositoryChange\":{\"$ref\":\"#/$defs/repositoryChange\"},\"evidenceLocators\":{\"type\":\"array\",\"maxItems\":64,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/evidenceLocator\"}},\"verification\":{\"type\":\"array\",\"maxItems\":64,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/humanText\"}},\"risks\":{\"type\":\"array\",\"maxItems\":64,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/humanText\"}},\"anchorEvidence\":{\"type\":\"array\",\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/anchorEvidence\"}},\"reportedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"reportDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}},\"$defs\":{\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"anchorId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"token\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"humanText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"repositoryChange\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"repositoryId\",\"disposition\",\"commits\"],\"properties\":{\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"disposition\":{\"enum\":[\"committed\",\"left-uncommitted\",\"no-changes\"]},\"commits\":{\"type\":\"array\",\"maxItems\":64,\"uniqueItems\":true,\"items\":{\"$ref\":\"urn:wakeflow:foundation:version-control:git-object-id:v1\"}}},\"allOf\":[{\"if\":{\"properties\":{\"disposition\":{\"const\":\"committed\"}},\"required\":[\"disposition\"]},\"then\":{\"properties\":{\"commits\":{\"type\":\"array\",\"minItems\":1}}},\"else\":{\"properties\":{\"commits\":{\"type\":\"array\",\"maxItems\":0}}}}]},\"evidenceLocator\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"ref\",\"digest\"],\"properties\":{\"kind\":{\"$ref\":\"#/$defs/token\"},\"ref\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"digest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"evidenceRef\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"ref\",\"digest\"],\"properties\":{\"ref\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"digest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"anchorEvidence\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"anchorId\",\"evidenceRefs\"],\"properties\":{\"anchorId\":{\"$ref\":\"#/$defs/anchorId\"},\"evidenceRefs\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/evidenceRef\"}}}}}}");
