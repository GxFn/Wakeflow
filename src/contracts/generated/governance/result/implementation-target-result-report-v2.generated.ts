/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/result/implementation-target-result-report-v2.schema.json
 */

export type HumanText = string
export type RepositoryChange = ({
repositoryId: RepositoryId
disposition: ("committed" | "left-uncommitted" | "no-changes")
/**
 * @maxItems 64
 */
commits: WakeflowGitObjectId[]
branch: (null | BranchName)
})
export type RepositoryId = string
/**
 * Git完整对象身份及其显式对象格式；支持SHA-1和SHA-256仓库。
 */
export type WakeflowGitObjectId = (Sha1 | Sha256)
export type BranchName = string
export type EvidenceKind = ("hook-observation" | "transcript" | "test-output" | "diff" | "document" | "link" | "commit")
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
 * 目标Agent对一个implementation Target Task提交的严格业务结果陈述（记录版本 2，ADR-0030）。
 */
export interface WakeflowImplementationTargetResultReportV2 {
kind: "WakeflowImplementationTargetResultReport"
schemaVersion: 2
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
/**
 * 任务包里的每条验收锚点恰好一项。
 *
 * @maxItems 32
 */
anchorResults: AnchorResult[]
/**
 * 任务包之外收到的指示；没有收到就是空数组，不省略。
 *
 * @maxItems 16
 */
outsideInstructions: []|[OutsideInstruction]|[OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]|[OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction, OutsideInstruction]
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
kind: EvidenceKind
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
/**
 * 一条验收锚点的结论：passed 核对过且成立，failed 核对过且不成立，blocked 想核对但被挡住，not-run 没有核对。observed 是目标实际看到的事实。
 */
export interface AnchorResult {
anchorId: AnchorId
status: ("passed" | "failed" | "blocked" | "not-run")
observed: HumanText
}
/**
 * 任务包之外收到的一条指示：谁给的、说了什么、怎么处理的。followed 是不改合同、照做了；declined 是与任务包冲突、没有照做；escalated 是停下来上报。
 */
export interface OutsideInstruction {
source: ("user" | "other-session" | "unknown")
summary: HumanText
handling: ("followed" | "declined" | "escalated")
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
export const WAKEFLOW_IMPLEMENTATION_TARGET_RESULT_REPORT_V2_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:result:implementation-target-result-report:v2\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_IMPLEMENTATION_TARGET_RESULT_REPORT_V2_SCHEMA\",\"title\":\"WakeflowImplementationTargetResultReportV2\",\"description\":\"目标Agent对一个implementation Target Task提交的严格业务结果陈述（记录版本 2，ADR-0030）。\",\"$comment\":\"记录版本 2 在版本 1 之上多两项：anchorResults 是任务包里每条验收锚点恰好一项的逐条结论，outsideInstructions 是任务包之外收到的指示。版本 1 的记录没有这两项，读作\\\"未记录\\\"，不补造。其余约定同版本 1：Report不声明transport、Claim或Controller acceptance；evidenceLocator.kind 是闭集词汇；repositoryChange.branch 记录结果所在分支（主检出为 null，ADR-0010）。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"outcome\",\"summary\",\"repositoryChange\",\"evidenceLocators\",\"verification\",\"risks\",\"anchorEvidence\",\"anchorResults\",\"outsideInstructions\",\"reportedAt\",\"reportDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowImplementationTargetResultReport\"},\"schemaVersion\":{\"const\":2},\"outcome\":{\"enum\":[\"completed\",\"blocked\",\"needs-review\"]},\"summary\":{\"$ref\":\"#/$defs/humanText\"},\"repositoryChange\":{\"$ref\":\"#/$defs/repositoryChange\"},\"evidenceLocators\":{\"type\":\"array\",\"maxItems\":64,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/evidenceLocator\"}},\"verification\":{\"type\":\"array\",\"maxItems\":64,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/humanText\"}},\"risks\":{\"type\":\"array\",\"maxItems\":64,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/humanText\"}},\"anchorEvidence\":{\"type\":\"array\",\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/anchorEvidence\"}},\"reportedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"reportDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"anchorResults\":{\"type\":\"array\",\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/anchorResult\"},\"description\":\"任务包里的每条验收锚点恰好一项。\"},\"outsideInstructions\":{\"type\":\"array\",\"maxItems\":16,\"items\":{\"$ref\":\"#/$defs/outsideInstruction\"},\"description\":\"任务包之外收到的指示；没有收到就是空数组，不省略。\"}},\"$defs\":{\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"anchorId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"humanText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"repositoryChange\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"repositoryId\",\"disposition\",\"branch\",\"commits\"],\"properties\":{\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"disposition\":{\"enum\":[\"committed\",\"left-uncommitted\",\"no-changes\"]},\"commits\":{\"type\":\"array\",\"maxItems\":64,\"uniqueItems\":true,\"items\":{\"$ref\":\"urn:wakeflow:foundation:version-control:git-object-id:v1\"}},\"branch\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/branchName\"}]}},\"allOf\":[{\"if\":{\"properties\":{\"disposition\":{\"const\":\"committed\"}},\"required\":[\"disposition\"]},\"then\":{\"properties\":{\"commits\":{\"type\":\"array\",\"minItems\":1}}},\"else\":{\"properties\":{\"commits\":{\"type\":\"array\",\"maxItems\":0}}}}]},\"evidenceLocator\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"ref\",\"digest\"],\"properties\":{\"kind\":{\"$ref\":\"#/$defs/evidenceKind\"},\"ref\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"digest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"evidenceRef\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"ref\",\"digest\"],\"properties\":{\"ref\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"digest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"anchorEvidence\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"anchorId\",\"evidenceRefs\"],\"properties\":{\"anchorId\":{\"$ref\":\"#/$defs/anchorId\"},\"evidenceRefs\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/evidenceRef\"}}}},\"evidenceKind\":{\"enum\":[\"hook-observation\",\"transcript\",\"test-output\",\"diff\",\"document\",\"link\",\"commit\"]},\"branchName\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":255,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$\"},\"anchorResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"anchorId\",\"status\",\"observed\"],\"description\":\"一条验收锚点的结论：passed 核对过且成立，failed 核对过且不成立，blocked 想核对但被挡住，not-run 没有核对。observed 是目标实际看到的事实。\",\"properties\":{\"anchorId\":{\"$ref\":\"#/$defs/anchorId\"},\"status\":{\"enum\":[\"passed\",\"failed\",\"blocked\",\"not-run\"]},\"observed\":{\"$ref\":\"#/$defs/humanText\"}}},\"outsideInstruction\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"source\",\"summary\",\"handling\"],\"description\":\"任务包之外收到的一条指示：谁给的、说了什么、怎么处理的。followed 是不改合同、照做了；declined 是与任务包冲突、没有照做；escalated 是停下来上报。\",\"properties\":{\"source\":{\"enum\":[\"user\",\"other-session\",\"unknown\"]},\"summary\":{\"$ref\":\"#/$defs/humanText\"},\"handling\":{\"enum\":[\"followed\",\"declined\",\"escalated\"]}}}}}");
