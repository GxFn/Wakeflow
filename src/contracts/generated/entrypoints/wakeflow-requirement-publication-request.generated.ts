/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-requirement-publication-request.schema.json
 */

/**
 * wakeflow_publish_requirement 的请求：publish 发布需求包（记录加上板），activate 让 parked 包回到 pending，withdraw 撤回；preview 零写、apply 带 planDigest、recover 带 operationId。
 */
export type WakeflowRequirementPublicationRequestV1 = (PublishRequest | ActivateRequest | WithdrawRequest | RecoverRequest)
export type WorkspaceRoot = string
export type Sha256Digest = string
export type SurfaceId = string
export type SingleLineText = string
export type DemandType = ("requirement" | "bug" | "supplement" | "research")
export type Priority = ("P0" | "P1" | "P2" | "P3")
export type WindowId = string
export type Text = string
export type RequirementId = string
export type MarkdownPath = PortableResourcePath
export type PortableResourcePath = string
export type TextPath = (PortableResourcePath & string)
export type UtcInstant = string

export interface PublishRequest {
root: WorkspaceRoot
mode: ("preview" | "apply")
planDigest?: Sha256Digest
action: "publish"
package: PackageInput
}
export interface PackageInput {
designSurfaceId: SurfaceId
title: SingleLineText
demandType: DemandType
priority: Priority
originWindowId: WindowId
testingDecision: TestingDecision
taskPlanReview?: ("controller" | "user")
supersedes?: RequirementId
parked?: {
trigger: Text
}
requirementPath: MarkdownPath
landingPath: MarkdownPath
/**
 * @maxItems 16
 */
attachments?: []|[TextPath]|[TextPath, TextPath]|[TextPath, TextPath, TextPath]|[TextPath, TextPath, TextPath, TextPath]|[TextPath, TextPath, TextPath, TextPath, TextPath]|[TextPath, TextPath, TextPath, TextPath, TextPath, TextPath]|[TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath]|[TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath]|[TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath]|[TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath]|[TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath]|[TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath]|[TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath]|[TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath]|[TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath]|[TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath, TextPath]
confirmation?: {
confirmedAt: UtcInstant
}
}
export interface TestingDecision {
mode: ("controller-only" | "real-environment" | "not-applicable")
summary: Text
}
export interface ActivateRequest {
root: WorkspaceRoot
mode: ("preview" | "apply")
planDigest?: Sha256Digest
action: "activate"
requirementId: RequirementId
expectedStateDigest: Sha256Digest
}
export interface WithdrawRequest {
root: WorkspaceRoot
mode: ("preview" | "apply")
planDigest?: Sha256Digest
action: "withdraw"
requirementId: RequirementId
expectedStateDigest: Sha256Digest
reason: Text
}
export interface RecoverRequest {
root: WorkspaceRoot
mode: "recover"
operationId: RequirementId
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
export const WAKEFLOW_REQUIREMENT_PUBLICATION_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:requirement-publication-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_REQUIREMENT_PUBLICATION_REQUEST_SCHEMA\",\"title\":\"WakeflowRequirementPublicationRequestV1\",\"description\":\"wakeflow_publish_requirement 的请求：publish 发布需求包（记录加上板），activate 让 parked 包回到 pending，withdraw 撤回；preview 零写、apply 带 planDigest、recover 带 operationId。\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/publishRequest\"},{\"$ref\":\"#/$defs/activateRequest\"},{\"$ref\":\"#/$defs/withdrawRequest\"},{\"$ref\":\"#/$defs/recoverRequest\"}],\"$defs\":{\"publishRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"action\",\"package\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"enum\":[\"preview\",\"apply\"]},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"action\":{\"const\":\"publish\"},\"package\":{\"$ref\":\"#/$defs/packageInput\"}}},\"activateRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"action\",\"requirementId\",\"expectedStateDigest\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"enum\":[\"preview\",\"apply\"]},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"action\":{\"const\":\"activate\"},\"requirementId\":{\"$ref\":\"#/$defs/requirementId\"},\"expectedStateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"withdrawRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"action\",\"requirementId\",\"expectedStateDigest\",\"reason\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"enum\":[\"preview\",\"apply\"]},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"action\":{\"const\":\"withdraw\"},\"requirementId\":{\"$ref\":\"#/$defs/requirementId\"},\"expectedStateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"reason\":{\"$ref\":\"#/$defs/text\"}}},\"recoverRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"operationId\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"const\":\"recover\"},\"operationId\":{\"$ref\":\"#/$defs/requirementId\"}}},\"packageInput\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"designSurfaceId\",\"title\",\"demandType\",\"priority\",\"originWindowId\",\"testingDecision\",\"requirementPath\",\"landingPath\"],\"properties\":{\"designSurfaceId\":{\"$ref\":\"#/$defs/surfaceId\"},\"title\":{\"$ref\":\"#/$defs/singleLineText\"},\"demandType\":{\"$ref\":\"#/$defs/demandType\"},\"priority\":{\"$ref\":\"#/$defs/priority\"},\"originWindowId\":{\"$ref\":\"#/$defs/windowId\"},\"testingDecision\":{\"$ref\":\"#/$defs/testingDecision\"},\"taskPlanReview\":{\"enum\":[\"controller\",\"user\"]},\"supersedes\":{\"$ref\":\"#/$defs/requirementId\"},\"parked\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"trigger\"],\"properties\":{\"trigger\":{\"$ref\":\"#/$defs/text\"}}},\"requirementPath\":{\"$ref\":\"#/$defs/markdownPath\"},\"landingPath\":{\"$ref\":\"#/$defs/markdownPath\"},\"attachments\":{\"type\":\"array\",\"maxItems\":16,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/textPath\"}},\"confirmation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"confirmedAt\"],\"properties\":{\"confirmedAt\":{\"$ref\":\"#/$defs/utcInstant\"}}}}},\"workspaceRoot\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":4096},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":1024,\"pattern\":\"^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\\\.{1,2}(?:/|$))(?!.*\\\\/\\\\.{1,2}(?:/|$))(?!.*\\\\\\\\)(?!.*//)(?!.*\\\\/$)(?!\\\\s)(?!.*\\\\s$)(?!.*\\\\/\\\\s)(?!.*\\\\s\\\\/)(?!.*[\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]).+$\"},\"markdownPath\":{\"allOf\":[{\"$ref\":\"#/$defs/portableResourcePath\"},{\"type\":\"string\",\"pattern\":\"^(?!(?:\\\\.git|\\\\.wakeflow-active|\\\\.wakeflow-local|record\\\\.json)(?:/|$)).+\\\\.md$\"}]},\"textPath\":{\"allOf\":[{\"$ref\":\"#/$defs/portableResourcePath\"},{\"type\":\"string\",\"pattern\":\"^(?!(?:\\\\.git|\\\\.wakeflow-active|\\\\.wakeflow-local|record\\\\.json)(?:/|$)).+\\\\.(?:md|txt|json|csv|yaml|yml|toml)$\"}]},\"requirementId\":{\"type\":\"string\",\"pattern\":\"^requirement_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"surfaceId\":{\"type\":\"string\",\"pattern\":\"^surface_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"singleLineText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":256,\"pattern\":\"^(?!\\\\s)[^\\\\u0000-\\\\u001F\\\\u007F]*\\\\S$\"},\"text\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":4096,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"demandType\":{\"enum\":[\"requirement\",\"bug\",\"supplement\",\"research\"]},\"priority\":{\"enum\":[\"P0\",\"P1\",\"P2\",\"P3\"]},\"testingDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"mode\",\"summary\"],\"properties\":{\"mode\":{\"enum\":[\"controller-only\",\"real-environment\",\"not-applicable\"]},\"summary\":{\"$ref\":\"#/$defs/text\"}}}}}");
