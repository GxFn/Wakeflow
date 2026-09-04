/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-target-task-planning-result.schema.json
 */

export type DemandId = string
export type EventId = string
export type CommitId = string
export type Sha256Digest = string
export type TargetTask = (ImplementationTargetTask | TestTargetTask)
export type TargetTaskId = string
export type TaskPackageId = string
export type RepositoryId = string
export type WindowId = string
export type TestCardId = string
export type PortableResourcePath = string

/**
 * Result of one Target Task Planning append: the committed or idempotently matched planning event, the target task summary, its projection receipt, and the next Controller frontier.
 */
export interface WakeflowTargetTaskPlanningResultV1 {
kind: "WakeflowTargetTaskPlanningResult"
schemaVersion: 1
tool: "wakeflow_plan_target_task"
status: ("committed" | "idempotent")
demandId: DemandId
event: {
eventId: EventId
streamRevision: number
}
commit: {
commitId: CommitId
commitSequence: number
commitDigest: Sha256Digest
}
stateDigest: Sha256Digest
targetTask: TargetTask
taskPackageProjection: TaskPackageProjection
next: Next
}
export interface ImplementationTargetTask {
workType: "implementation"
targetTaskId: TargetTaskId
taskPackageId: TaskPackageId
repositoryId: RepositoryId
windowId: WindowId
phase: "planned"
}
export interface TestTargetTask {
workType: "test"
targetTaskId: TargetTaskId
taskPackageId: TaskPackageId
windowId: WindowId
phase: "planned"
testCard: TestCardTuple
}
export interface TestCardTuple {
testCardId: TestCardId
testCardDigest: Sha256Digest
}
export interface TaskPackageProjection {
disposition: ("created" | "current")
resourceRef: PortableResourcePath
taskPackageDigest: Sha256Digest
documentDigest: Sha256Digest
}
/**
 * Next Controller responsibility derived from the route after this append.
 */
export interface Next {
frontier: (null | string)
owner: ("controller" | "target" | "test" | "user" | "none")
suggestedTool: (null | string)
/**
 * @maxItems 32
 */
blockers: string[]
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
export const WAKEFLOW_TARGET_TASK_PLANNING_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:target-task-planning-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TARGET_TASK_PLANNING_RESULT_SCHEMA\",\"title\":\"WakeflowTargetTaskPlanningResultV1\",\"description\":\"Result of one Target Task Planning append: the committed or idempotently matched planning event, the target task summary, its projection receipt, and the next Controller frontier.\",\"type\":\"object\",\"$defs\":{\"targetTask\":{\"oneOf\":[{\"$ref\":\"#/$defs/implementationTargetTask\"},{\"$ref\":\"#/$defs/testTargetTask\"}]},\"implementationTargetTask\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"workType\",\"targetTaskId\",\"taskPackageId\",\"repositoryId\",\"windowId\",\"phase\"],\"properties\":{\"workType\":{\"const\":\"implementation\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"taskPackageId\":{\"$ref\":\"#/$defs/taskPackageId\"},\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"phase\":{\"const\":\"planned\"}}},\"testTargetTask\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"workType\",\"targetTaskId\",\"taskPackageId\",\"windowId\",\"phase\",\"testCard\"],\"properties\":{\"workType\":{\"const\":\"test\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"taskPackageId\":{\"$ref\":\"#/$defs/taskPackageId\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"phase\":{\"const\":\"planned\"},\"testCard\":{\"$ref\":\"#/$defs/testCardTuple\"}}},\"taskPackageProjection\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"disposition\",\"resourceRef\",\"taskPackageDigest\",\"documentDigest\"],\"properties\":{\"disposition\":{\"enum\":[\"created\",\"current\"]},\"resourceRef\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"taskPackageDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"documentDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"taskPackageId\":{\"type\":\"string\",\"pattern\":\"^task-package_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"testCardId\":{\"type\":\"string\",\"pattern\":\"^test-card_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"testCardTuple\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"testCardId\",\"testCardDigest\"],\"properties\":{\"testCardId\":{\"$ref\":\"#/$defs/testCardId\"},\"testCardDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"pattern\":\"^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\\\.{1,2}(?:/|$))(?!.*\\\\/\\\\.{1,2}(?:/|$))(?!.*\\\\\\\\)(?!.*//)(?!.*\\\\/$)(?!\\\\s)(?!.*\\\\s$)(?!.*\\\\/\\\\s)(?!.*\\\\s\\\\/)(?!.*[\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]).+$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"next\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"frontier\",\"owner\",\"suggestedTool\",\"blockers\"],\"description\":\"Next Controller responsibility derived from the route after this append.\",\"properties\":{\"frontier\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":128}]},\"owner\":{\"enum\":[\"controller\",\"target\",\"test\",\"user\",\"none\"]},\"suggestedTool\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":128}]},\"blockers\":{\"type\":\"array\",\"maxItems\":32,\"items\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128}}}}},\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"status\",\"demandId\",\"event\",\"commit\",\"stateDigest\",\"targetTask\",\"taskPackageProjection\",\"next\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTargetTaskPlanningResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_plan_target_task\"},\"status\":{\"enum\":[\"committed\",\"idempotent\"]},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"event\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"eventId\",\"streamRevision\"],\"properties\":{\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991}}},\"commit\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"commitId\",\"commitSequence\",\"commitDigest\"],\"properties\":{\"commitId\":{\"$ref\":\"#/$defs/commitId\"},\"commitSequence\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"commitDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"targetTask\":{\"$ref\":\"#/$defs/targetTask\"},\"taskPackageProjection\":{\"$ref\":\"#/$defs/taskPackageProjection\"},\"next\":{\"$ref\":\"#/$defs/next\"}}}");
