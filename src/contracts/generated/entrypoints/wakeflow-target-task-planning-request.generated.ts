/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-target-task-planning-request.schema.json
 */

export type DemandId = string
export type RequestedTaskPackage = (ImplementationTaskPackageRequest | TestTaskPackageRequest)
export type RepositoryId = string
export type WindowId = string
export type HumanText = string
/**
 * @minItems 1
 * @maxItems 32
 */
export type NonEmptyTextList = [HumanText, ...(HumanText)[]]
export type PortableResourcePath = string
/**
 * @maxItems 32
 */
export type TextList = HumanText[]
export type AnchorId = string

/**
 * Single-call request appending one immutable Implementation or Test TaskPackage plan to an existing Demand. The client supplies an idempotency key and the stream revision it observed; a retry with the same key and body returns the first result.
 */
export interface WakeflowTargetTaskPlanningRequestV1 {
/**
 * Absolute path of the existing Wakeflow workspace root.
 */
root: string
demandId: DemandId
/**
 * Client-generated key binding this request to at most one commit.
 */
idempotencyKey: string
/**
 * Demand stream revision the caller observed; a stale value is rejected.
 */
expectedStreamRevision: number
taskPackage: RequestedTaskPackage
}
export interface ImplementationTaskPackageRequest {
assignment: ImplementationAssignment
workType: "implementation"
objective: HumanText
confirmedContext: NonEmptyTextList
/**
 * @minItems 1
 * @maxItems 32
 */
selectedAuthorityMemberRefs: [PortableResourcePath, ...(PortableResourcePath)[]]
boundaries: Boundaries
completionExpectations: NonEmptyTextList
commitExpectation: ("commit" | "leave-uncommitted")
/**
 * @minItems 1
 * @maxItems 32
 */
acceptanceAnchors: [AcceptanceAnchor, ...(AcceptanceAnchor)[]]
}
export interface ImplementationAssignment {
repositoryId: RepositoryId
windowId: WindowId
}
export interface Boundaries {
inScope: NonEmptyTextList
outOfScope: TextList
forbidden: TextList
}
export interface AcceptanceAnchor {
anchorId: AnchorId
claim: HumanText
probe: HumanText
expected: HumanText
}
export interface TestTaskPackageRequest {
workType: "test"
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
export const WAKEFLOW_TARGET_TASK_PLANNING_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:target-task-planning-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TARGET_TASK_PLANNING_REQUEST_SCHEMA\",\"title\":\"WakeflowTargetTaskPlanningRequestV1\",\"description\":\"Single-call request appending one immutable Implementation or Test TaskPackage plan to an existing Demand. The client supplies an idempotency key and the stream revision it observed; a retry with the same key and body returns the first result.\",\"type\":\"object\",\"$defs\":{\"requestedTaskPackage\":{\"oneOf\":[{\"$ref\":\"#/$defs/implementationTaskPackageRequest\"},{\"$ref\":\"#/$defs/testTaskPackageRequest\"}]},\"implementationTaskPackageRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"assignment\",\"workType\",\"objective\",\"confirmedContext\",\"selectedAuthorityMemberRefs\",\"boundaries\",\"completionExpectations\",\"commitExpectation\",\"acceptanceAnchors\"],\"properties\":{\"assignment\":{\"$ref\":\"#/$defs/implementationAssignment\"},\"workType\":{\"const\":\"implementation\"},\"objective\":{\"$ref\":\"#/$defs/humanText\"},\"confirmedContext\":{\"$ref\":\"#/$defs/nonEmptyTextList\"},\"selectedAuthorityMemberRefs\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/portableResourcePath\"}},\"boundaries\":{\"$ref\":\"#/$defs/boundaries\"},\"completionExpectations\":{\"$ref\":\"#/$defs/nonEmptyTextList\"},\"commitExpectation\":{\"enum\":[\"commit\",\"leave-uncommitted\"]},\"acceptanceAnchors\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/acceptanceAnchor\"}}}},\"testTaskPackageRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"workType\"],\"properties\":{\"workType\":{\"const\":\"test\"}}},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"humanText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":16384,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"nonEmptyTextList\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/humanText\"}},\"implementationAssignment\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"repositoryId\",\"windowId\"],\"properties\":{\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"}}},\"boundaries\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"inScope\",\"outOfScope\",\"forbidden\"],\"properties\":{\"inScope\":{\"$ref\":\"#/$defs/nonEmptyTextList\"},\"outOfScope\":{\"$ref\":\"#/$defs/textList\"},\"forbidden\":{\"$ref\":\"#/$defs/textList\"}}},\"textList\":{\"type\":\"array\",\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/humanText\"}},\"anchorId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"acceptanceAnchor\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"anchorId\",\"claim\",\"probe\",\"expected\"],\"properties\":{\"anchorId\":{\"$ref\":\"#/$defs/anchorId\"},\"claim\":{\"$ref\":\"#/$defs/humanText\"},\"probe\":{\"$ref\":\"#/$defs/humanText\"},\"expected\":{\"$ref\":\"#/$defs/humanText\"}}},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"pattern\":\"^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\\\.{1,2}(?:/|$))(?!.*\\\\/\\\\.{1,2}(?:/|$))(?!.*\\\\\\\\)(?!.*//)(?!.*\\\\/$)(?!\\\\s)(?!.*\\\\s$)(?!.*\\\\/\\\\s)(?!.*\\\\s\\\\/)(?!.*[\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]).+$\"}},\"additionalProperties\":false,\"required\":[\"root\",\"demandId\",\"idempotencyKey\",\"expectedStreamRevision\",\"taskPackage\"],\"properties\":{\"root\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"idempotencyKey\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9._:-]+$\",\"description\":\"Client-generated key binding this request to at most one commit.\"},\"expectedStreamRevision\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":9007199254740991,\"description\":\"Demand stream revision the caller observed; a stale value is rejected.\"},\"taskPackage\":{\"$ref\":\"#/$defs/requestedTaskPackage\"}}}");
