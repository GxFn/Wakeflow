/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-demand-completion-result.schema.json
 */

/**
 * wakeflow_complete_demand 的结果：preview 给出 verify 报告、归档引用与阻塞项；apply 与 recover 返回终态事件回执、归档回执、需求包回执与释放的工作声明数。
 */
export type WakeflowDemandCompletionResultV1 = (PreviewResult | MutationResult)
/**
 * @maxItems 64
 */
export type Blockers = string[]
export type Sha256Digest = string
export type DemandId = string
export type PortableResourcePath = string
export type EventId = string
export type CommitId = string
export type RequirementId = string

export interface PreviewResult {
kind: "WakeflowDemandCompletionPreview"
schemaVersion: 1
tool: "wakeflow_complete_demand"
mode: "preview"
status: ("ready" | "blocked")
blockers: Blockers
planDigest: (null | Sha256Digest)
demandId: DemandId
verify: (null | VerifyReport)
archiveRef: (null | PortableResourcePath)
next: NextProjection
}
export interface VerifyReport {
observationDigest: Sha256Digest
/**
 * @minItems 1
 * @maxItems 64
 */
gates: [{
gate: string
status: ("pass" | "fail" | "unavailable")
detail: (null | string)
}, ...({
gate: string
status: ("pass" | "fail" | "unavailable")
detail: (null | string)
})[]]
}
export interface NextProjection {
frontier: (null | string)
owner: ("controller" | "target" | "test" | "user" | "none")
suggestedTool: (null | string)
/**
 * @maxItems 64
 */
blockers: string[]
}
export interface MutationResult {
kind: "WakeflowDemandCompletionMutation"
schemaVersion: 1
tool: "wakeflow_complete_demand"
mode: ("apply" | "recover")
disposition: ("completed" | "current" | "recovered")
demandId: DemandId
terminalEvent: EventReceipt
archive: ArchiveReceipt
package: PackageReceipt
releasedClaims: number
next: NextProjection
}
export interface EventReceipt {
eventId: EventId
streamRevision: number
commitId: CommitId
}
export interface ArchiveReceipt {
archiveRef: PortableResourcePath
payloadTreeDigest: Sha256Digest
fileCount: number
totalBytes: number
manifestDigest: Sha256Digest
}
export interface PackageReceipt {
requirementId: RequirementId
recordRef: PortableResourcePath
recordDigest: Sha256Digest
status: ("pending" | "parked" | "claimed" | "withdrawn" | "archived")
revision: number
stateDigest: Sha256Digest
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
export const WAKEFLOW_DEMAND_COMPLETION_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:demand-completion-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_COMPLETION_RESULT_SCHEMA\",\"title\":\"WakeflowDemandCompletionResultV1\",\"description\":\"wakeflow_complete_demand 的结果：preview 给出 verify 报告、归档引用与阻塞项；apply 与 recover 返回终态事件回执、归档回执、需求包回执与释放的工作声明数。\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/previewResult\"},{\"$ref\":\"#/$defs/mutationResult\"}],\"$defs\":{\"previewResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"status\",\"blockers\",\"planDigest\",\"demandId\",\"verify\",\"archiveRef\",\"next\"],\"properties\":{\"kind\":{\"const\":\"WakeflowDemandCompletionPreview\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_complete_demand\"},\"mode\":{\"const\":\"preview\"},\"status\":{\"enum\":[\"ready\",\"blocked\"]},\"blockers\":{\"$ref\":\"#/$defs/blockers\"},\"planDigest\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/sha256Digest\"}]},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"verify\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/verifyReport\"}]},\"archiveRef\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/portableResourcePath\"}]},\"next\":{\"$ref\":\"#/$defs/nextProjection\"}}},\"mutationResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"disposition\",\"demandId\",\"terminalEvent\",\"archive\",\"package\",\"releasedClaims\",\"next\"],\"properties\":{\"kind\":{\"const\":\"WakeflowDemandCompletionMutation\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_complete_demand\"},\"mode\":{\"enum\":[\"apply\",\"recover\"]},\"disposition\":{\"enum\":[\"completed\",\"current\",\"recovered\"]},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"terminalEvent\":{\"$ref\":\"#/$defs/eventReceipt\"},\"archive\":{\"$ref\":\"#/$defs/archiveReceipt\"},\"package\":{\"$ref\":\"#/$defs/packageReceipt\"},\"releasedClaims\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":1024},\"next\":{\"$ref\":\"#/$defs/nextProjection\"}}},\"verifyReport\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"observationDigest\",\"gates\"],\"properties\":{\"observationDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"gates\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":64,\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"gate\",\"status\",\"detail\"],\"properties\":{\"gate\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":64},\"status\":{\"enum\":[\"pass\",\"fail\",\"unavailable\"]},\"detail\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":256}]}}}}}},\"archiveReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"archiveRef\",\"payloadTreeDigest\",\"fileCount\",\"totalBytes\",\"manifestDigest\"],\"properties\":{\"archiveRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"payloadTreeDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"fileCount\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"totalBytes\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":9007199254740991},\"manifestDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"packageReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"requirementId\",\"recordRef\",\"recordDigest\",\"status\",\"revision\",\"stateDigest\"],\"properties\":{\"requirementId\":{\"$ref\":\"#/$defs/requirementId\"},\"recordRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"recordDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"status\":{\"enum\":[\"pending\",\"parked\",\"claimed\",\"withdrawn\",\"archived\"]},\"revision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"eventReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"eventId\",\"streamRevision\",\"commitId\"],\"properties\":{\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"commitId\":{\"$ref\":\"#/$defs/commitId\"}}},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"pattern\":\"^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\\\.{1,2}(?:/|$))(?!.*\\\\/\\\\.{1,2}(?:/|$))(?!.*\\\\\\\\)(?!.*//)(?!.*\\\\/$)(?!\\\\s)(?!.*\\\\s$)(?!.*\\\\/\\\\s)(?!.*\\\\s\\\\/)(?!.*[\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]).+$\"},\"workspaceRoot\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root; never returned.\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"requirementId\":{\"type\":\"string\",\"pattern\":\"^requirement_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"nextProjection\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"frontier\",\"owner\",\"suggestedTool\",\"blockers\"],\"properties\":{\"frontier\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":128}]},\"owner\":{\"enum\":[\"controller\",\"target\",\"test\",\"user\",\"none\"]},\"suggestedTool\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":128}]},\"blockers\":{\"type\":\"array\",\"maxItems\":64,\"items\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":256}}}},\"blockers\":{\"type\":\"array\",\"maxItems\":64,\"items\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":256}}}}");
