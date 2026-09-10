/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-demand-publication-result.schema.json
 */

/**
 * wakeflow_create_demand 的结果：preview 给出确定性计划摘要、派生的 demandId 与阻塞项；apply 与 recover 只返回稳定回执（身份与权威摘要、事件与提交、看板认领），不回显聚合、权威内容或路径。
 */
export type WakeflowDemandPublicationResultV1 = (PreviewResult | MutationResult)
/**
 * @maxItems 64
 */
export type Blockers = string[]
export type Sha256Digest = string
export type DemandId = string
export type RequirementId = string
export type EventId = string
export type CommitId = string

export interface PreviewResult {
kind: "WakeflowDemandCreationPreview"
schemaVersion: 1
tool: "wakeflow_create_demand"
mode: "preview"
status: ("ready" | "blocked")
blockers: Blockers
planDigest: (null | Sha256Digest)
demandId: (null | DemandId)
requirementId: RequirementId
next: NextProjection
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
kind: "WakeflowDemandCreationMutation"
schemaVersion: 1
tool: "wakeflow_create_demand"
mode: ("apply" | "recover")
disposition: ("created" | "current" | "recovered")
publication: PublicationReceipt
next: NextProjection
}
export interface PublicationReceipt {
demandId: DemandId
identityDigest: Sha256Digest
authorityDigest: Sha256Digest
commandDigest: Sha256Digest
event: {
eventId: EventId
streamRevision: 1
}
commit: {
commitId: CommitId
commitSequence: 1
commitDigest: Sha256Digest
}
stateDigest: Sha256Digest
claim: {
requirementId: RequirementId
stateRevision: number
stateDigest: Sha256Digest
}
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
export const WAKEFLOW_DEMAND_PUBLICATION_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:demand-publication-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_PUBLICATION_RESULT_SCHEMA\",\"title\":\"WakeflowDemandPublicationResultV1\",\"description\":\"wakeflow_create_demand 的结果：preview 给出确定性计划摘要、派生的 demandId 与阻塞项；apply 与 recover 只返回稳定回执（身份与权威摘要、事件与提交、看板认领），不回显聚合、权威内容或路径。\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/previewResult\"},{\"$ref\":\"#/$defs/mutationResult\"}],\"$defs\":{\"previewResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"status\",\"blockers\",\"planDigest\",\"demandId\",\"requirementId\",\"next\"],\"properties\":{\"kind\":{\"const\":\"WakeflowDemandCreationPreview\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_create_demand\"},\"mode\":{\"const\":\"preview\"},\"status\":{\"enum\":[\"ready\",\"blocked\"]},\"blockers\":{\"$ref\":\"#/$defs/blockers\"},\"planDigest\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/sha256Digest\"}]},\"demandId\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/demandId\"}]},\"requirementId\":{\"$ref\":\"#/$defs/requirementId\"},\"next\":{\"$ref\":\"#/$defs/nextProjection\"}}},\"mutationResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"mode\",\"disposition\",\"publication\",\"next\"],\"properties\":{\"kind\":{\"const\":\"WakeflowDemandCreationMutation\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_create_demand\"},\"mode\":{\"enum\":[\"apply\",\"recover\"]},\"disposition\":{\"enum\":[\"created\",\"current\",\"recovered\"]},\"publication\":{\"$ref\":\"#/$defs/publicationReceipt\"},\"next\":{\"$ref\":\"#/$defs/nextProjection\"}}},\"publicationReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"demandId\",\"identityDigest\",\"authorityDigest\",\"commandDigest\",\"event\",\"commit\",\"stateDigest\",\"claim\"],\"properties\":{\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"identityDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"authorityDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"commandDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"event\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"eventId\",\"streamRevision\"],\"properties\":{\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"streamRevision\":{\"const\":1}}},\"commit\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"commitId\",\"commitSequence\",\"commitDigest\"],\"properties\":{\"commitId\":{\"$ref\":\"#/$defs/commitId\"},\"commitSequence\":{\"const\":1},\"commitDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"claim\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"requirementId\",\"stateRevision\",\"stateDigest\"],\"properties\":{\"requirementId\":{\"$ref\":\"#/$defs/requirementId\"},\"stateRevision\":{\"type\":\"integer\",\"minimum\":2,\"maximum\":9007199254740991},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}}}},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"workspaceRoot\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root; never returned.\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"requirementId\":{\"type\":\"string\",\"pattern\":\"^requirement_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"nextProjection\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"frontier\",\"owner\",\"suggestedTool\",\"blockers\"],\"properties\":{\"frontier\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":128}]},\"owner\":{\"enum\":[\"controller\",\"target\",\"test\",\"user\",\"none\"]},\"suggestedTool\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":128}]},\"blockers\":{\"type\":\"array\",\"maxItems\":64,\"items\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":256}}}},\"blockers\":{\"type\":\"array\",\"maxItems\":64,\"items\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":256}}}}");
