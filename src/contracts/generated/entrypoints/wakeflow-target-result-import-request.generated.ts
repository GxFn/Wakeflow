/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-target-result-import-request.schema.json
 */

/**
 * Absolute path of the existing Wakeflow workspace root.
 */
export type WorkspaceRoot = string
export type DemandId = string
export type ClaimId = string
export type Sha256Digest = string
export type ResultOutcome = ("completed" | "blocked" | "needs-review")
export type HumanText = string
export type RepositoryChange = ({
[k: string]: unknown | undefined
} & {
repositoryId: RepositoryId
disposition: ("committed" | "left-uncommitted" | "no-changes")
/**
 * @maxItems 64
 */
commits: GitObjectId[]
})
export type RepositoryId = string
export type GitObjectId = (GitSha1ObjectId | GitSha256ObjectId)
export type Token = string
export type PortableResourcePath = string
/**
 * @maxItems 64
 */
export type EvidenceLocators = EvidenceLocator[]
/**
 * @maxItems 64
 */
export type HumanTextList = HumanText[]
export type TestReportContent = ({
[k: string]: unknown | undefined
} & {
outcome: ResultOutcome
summary: HumanText
evidenceLocators: EvidenceLocators
verification: HumanTextList
risks: HumanTextList
/**
 * @maxItems 32
 */
stepEvidence: StepEvidence[]
})

/**
 * Closed MCP request for importing one target-authored implementation or test Report into an authority-enriched TargetResult.
 */
export interface WakeflowTargetResultImportRequestV1 {
root: WorkspaceRoot
demandId: DemandId
actionId: ClaimId
observationDigest: Sha256Digest
report: (ImplementationReport | TestReport)
}
export interface ImplementationReport {
workType: "implementation"
content: ImplementationReportContent
}
export interface ImplementationReportContent {
outcome: ResultOutcome
summary: HumanText
repositoryChange: RepositoryChange
evidenceLocators: EvidenceLocators
verification: HumanTextList
risks: HumanTextList
/**
 * @maxItems 32
 */
anchorEvidence: AnchorEvidence[]
}
export interface GitSha1ObjectId {
algorithm: "sha1"
value: string
}
export interface GitSha256ObjectId {
algorithm: "sha256"
value: string
}
export interface EvidenceLocator {
kind: Token
ref: PortableResourcePath
digest: Sha256Digest
}
export interface AnchorEvidence {
anchorId: Token
/**
 * @minItems 1
 * @maxItems 32
 */
evidenceRefs: [EvidenceRef, ...(EvidenceRef)[]]
}
export interface EvidenceRef {
ref: PortableResourcePath
digest: Sha256Digest
}
export interface TestReport {
workType: "test"
content: TestReportContent
}
export interface StepEvidence {
planIndex: number
step: HumanText
evidence: EvidenceRef
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
export const WAKEFLOW_TARGET_RESULT_IMPORT_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:target-result-import-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TARGET_RESULT_IMPORT_REQUEST_SCHEMA\",\"title\":\"WakeflowTargetResultImportRequestV1\",\"description\":\"Closed MCP request for importing one target-authored implementation or test Report into an authority-enriched TargetResult.\",\"$comment\":\"The stored Claim and Observation derive work type, Task, Delivery, Host, repository/window, Test lineage, Result identity, and Event identity. report.workType only discriminates the external Agent Report grammar and is rechecked against stored authority.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"demandId\",\"actionId\",\"observationDigest\",\"report\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"actionId\":{\"$ref\":\"#/$defs/claimId\"},\"observationDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"report\":{\"oneOf\":[{\"$ref\":\"#/$defs/implementationReport\"},{\"$ref\":\"#/$defs/testReport\"}]}},\"$defs\":{\"implementationReport\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"workType\",\"content\"],\"properties\":{\"workType\":{\"const\":\"implementation\"},\"content\":{\"$ref\":\"#/$defs/implementationReportContent\"}}},\"testReport\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"workType\",\"content\"],\"properties\":{\"workType\":{\"const\":\"test\"},\"content\":{\"$ref\":\"#/$defs/testReportContent\"}}},\"implementationReportContent\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"outcome\",\"summary\",\"repositoryChange\",\"evidenceLocators\",\"verification\",\"risks\",\"anchorEvidence\"],\"properties\":{\"outcome\":{\"$ref\":\"#/$defs/resultOutcome\"},\"summary\":{\"$ref\":\"#/$defs/humanText\"},\"repositoryChange\":{\"$ref\":\"#/$defs/repositoryChange\"},\"evidenceLocators\":{\"$ref\":\"#/$defs/evidenceLocators\"},\"verification\":{\"$ref\":\"#/$defs/humanTextList\"},\"risks\":{\"$ref\":\"#/$defs/humanTextList\"},\"anchorEvidence\":{\"type\":\"array\",\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/anchorEvidence\"}}}},\"testReportContent\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"outcome\",\"summary\",\"evidenceLocators\",\"verification\",\"risks\",\"stepEvidence\"],\"properties\":{\"outcome\":{\"$ref\":\"#/$defs/resultOutcome\"},\"summary\":{\"$ref\":\"#/$defs/humanText\"},\"evidenceLocators\":{\"$ref\":\"#/$defs/evidenceLocators\"},\"verification\":{\"$ref\":\"#/$defs/humanTextList\"},\"risks\":{\"$ref\":\"#/$defs/humanTextList\"},\"stepEvidence\":{\"type\":\"array\",\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/stepEvidence\"}}},\"allOf\":[{\"if\":{\"properties\":{\"outcome\":{\"const\":\"completed\"}},\"required\":[\"outcome\"]},\"then\":{\"properties\":{\"stepEvidence\":{\"type\":\"array\",\"minItems\":1}}}}]},\"repositoryChange\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"repositoryId\",\"disposition\",\"commits\"],\"properties\":{\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"disposition\":{\"enum\":[\"committed\",\"left-uncommitted\",\"no-changes\"]},\"commits\":{\"type\":\"array\",\"maxItems\":64,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/gitObjectId\"}}},\"allOf\":[{\"if\":{\"properties\":{\"disposition\":{\"const\":\"committed\"}},\"required\":[\"disposition\"]},\"then\":{\"properties\":{\"commits\":{\"type\":\"array\",\"minItems\":1}}},\"else\":{\"properties\":{\"commits\":{\"type\":\"array\",\"maxItems\":0}}}}]},\"evidenceLocators\":{\"type\":\"array\",\"maxItems\":64,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/evidenceLocator\"}},\"evidenceLocator\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"ref\",\"digest\"],\"properties\":{\"kind\":{\"$ref\":\"#/$defs/token\"},\"ref\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"digest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"evidenceRef\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"ref\",\"digest\"],\"properties\":{\"ref\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"digest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"anchorEvidence\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"anchorId\",\"evidenceRefs\"],\"properties\":{\"anchorId\":{\"$ref\":\"#/$defs/token\"},\"evidenceRefs\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/evidenceRef\"}}}},\"stepEvidence\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"planIndex\",\"step\",\"evidence\"],\"properties\":{\"planIndex\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":31},\"step\":{\"$ref\":\"#/$defs/humanText\"},\"evidence\":{\"$ref\":\"#/$defs/evidenceRef\"}}},\"humanTextList\":{\"type\":\"array\",\"maxItems\":64,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/humanText\"}},\"resultOutcome\":{\"enum\":[\"completed\",\"blocked\",\"needs-review\"]},\"workspaceRoot\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"humanText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"token\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"pattern\":\"^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\\\.{1,2}(?:/|$))(?!.*\\\\/\\\\.{1,2}(?:/|$))(?!.*\\\\\\\\)(?!.*//)(?!.*\\\\/$)(?!\\\\s)(?!.*\\\\s$)(?!.*\\\\/\\\\s)(?!.*\\\\s\\\\/)(?!.*[\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]).+$\"},\"gitObjectId\":{\"oneOf\":[{\"$ref\":\"#/$defs/gitSha1ObjectId\"},{\"$ref\":\"#/$defs/gitSha256ObjectId\"}]},\"gitSha1ObjectId\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"algorithm\",\"value\"],\"properties\":{\"algorithm\":{\"const\":\"sha1\"},\"value\":{\"type\":\"string\",\"pattern\":\"^[0-9a-f]{40}$\"}}},\"gitSha256ObjectId\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"algorithm\",\"value\"],\"properties\":{\"algorithm\":{\"const\":\"sha256\"},\"value\":{\"type\":\"string\",\"pattern\":\"^[0-9a-f]{64}$\"}}},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"claimId\":{\"type\":\"string\",\"pattern\":\"^window_work_claim_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}");
