/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/testing/test-dispatch-packet.schema.json
 */

/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
export type EventId = string
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string
/**
 * Controller为一次真实环境Test执行授权的逻辑attempt。
 */
export type WakeflowTestExecutionAttempt = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowTestExecutionAttempt"
schemaVersion: 1
testAttemptId: string
targetTaskId: string
testCard: TestCardTuple
ordinal: number
mode: ("initial" | "rerun")
environmentSetup: EnvironmentSetup
rerunSource?: RerunSource
})
export type TrimmedText = string
/**
 * @minItems 1
 * @maxItems 32
 */
export type ApprovedPlan = [string, ...(string)[]]
/**
 * @maxItems 32
 */
export type AllowedSkills = string[]
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string

/**
 * Event-derived, target-facing Test dispatch context for one exact prepared Test delivery.
 */
export interface WakeflowTestDispatchPacket {
artifactKind: "wakeflow-test-dispatch-packet"
schemaVersion: 1
programId: string
configDigest: WakeflowSha256DigestText
demandId: string
targetDeliveryId: string
source: {
eventId: EventId
eventDigest: WakeflowSha256DigestText
streamRevision: number
intentDigest: WakeflowSha256DigestText
}
target: {
targetTaskId: string
taskPackage: TaskPackageReference
testCard: TestCardReference
}
route: Route
attempt: WakeflowTestExecutionAttempt
taskBriefing: TaskBriefing
testContract: TestContract
language: ("en" | "zh-Hans")
portablePrompt: string
preparedAt: WakeflowUtcInstantText
packetDigest: WakeflowSha256DigestText
}
export interface TaskPackageReference {
taskPackageId: string
taskPackageRef: WakeflowPortableResourcePathText
taskPackageDigest: WakeflowSha256DigestText
}
export interface TestCardReference {
testCardId: string
testCardRef: WakeflowPortableResourcePathText
testCardDigest: WakeflowSha256DigestText
}
export interface Route {
hostId: ("codex" | "claude-code")
windowId: string
bindingId: string
}
export interface TestCardTuple {
testCardId: string
testCardDigest: WakeflowSha256DigestText
}
export interface EnvironmentSetup {
policy: ("fresh-once" | "fresh-per-attempt" | "reuse-existing")
directive: ("prepare-fresh-environment" | "reuse-confirmed-environment")
}
export interface RerunSource {
previousAttemptId: string
previousResult: {
targetResultId: string
resultDigest: WakeflowSha256DigestText
}
reviewDecision: {
targetReviewDecisionId: string
decisionDigest: WakeflowSha256DigestText
}
}
export interface TaskBriefing {
workType: "test"
objective: TrimmedText
/**
 * @minItems 1
 * @maxItems 2
 */
completionFocus: [TrimmedText]|[TrimmedText, TrimmedText]
priorityContext: TrimmedText
criticalBoundary: {
kind: ("forbidden" | "outOfScope" | "inScope")
value: TrimmedText
}
/**
 * @minItems 2
 * @maxItems 2
 */
requiredSkills: [("skills/wakeflow-target/SKILL.md" | "skills/wakeflow-test/SKILL.md"), ("skills/wakeflow-target/SKILL.md" | "skills/wakeflow-test/SKILL.md")]
}
export interface TestContract {
executionContract: ExecutionContract
}
export interface ExecutionContract {
requirementGoal: string
approvedPlan: ApprovedPlan
allowedSkills: AllowedSkills
environmentSetup: EnvironmentSetup
maxAttempts: number
changeControl: "return-blocked-to-controller"
productSourcePolicy: "read-only"
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
export const WAKEFLOW_TEST_DISPATCH_PACKET_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:testing:test-dispatch-packet:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TEST_DISPATCH_PACKET_SCHEMA\",\"title\":\"WakeflowTestDispatchPacket\",\"description\":\"Event-derived, target-facing Test dispatch context for one exact prepared Test delivery.\",\"$comment\":\"The Demand event stream remains authority. This create-only read model has no separate packet identity, host handle, claim, send observation, environment receipt, TargetResult, or acceptance fact.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"programId\",\"configDigest\",\"demandId\",\"targetDeliveryId\",\"source\",\"target\",\"route\",\"attempt\",\"taskBriefing\",\"testContract\",\"language\",\"portablePrompt\",\"preparedAt\",\"packetDigest\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-test-dispatch-packet\"},\"schemaVersion\":{\"const\":1},\"programId\":{\"$ref\":\"urn:wakeflow:governance:testing:test-delivery-intent:v1#/properties/programId\"},\"configDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"demandId\":{\"$ref\":\"urn:wakeflow:governance:testing:test-delivery-intent:v1#/properties/demandId\"},\"targetDeliveryId\":{\"$ref\":\"urn:wakeflow:governance:testing:test-delivery-intent:v1#/properties/targetDeliveryId\"},\"source\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"eventId\",\"eventDigest\",\"streamRevision\",\"intentDigest\"],\"properties\":{\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"eventDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"intentDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"target\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetTaskId\",\"taskPackage\",\"testCard\"],\"properties\":{\"targetTaskId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/targetTaskId\"},\"taskPackage\":{\"$ref\":\"#/$defs/taskPackageReference\"},\"testCard\":{\"$ref\":\"#/$defs/testCardReference\"}}},\"route\":{\"$ref\":\"urn:wakeflow:governance:testing:test-delivery-intent:v1#/properties/route\"},\"attempt\":{\"$ref\":\"urn:wakeflow:governance:testing:test-execution-attempt:v1\"},\"taskBriefing\":{\"$ref\":\"#/$defs/taskBriefing\"},\"testContract\":{\"$ref\":\"#/$defs/testContract\"},\"language\":{\"$ref\":\"urn:wakeflow:governance:testing:test-delivery-intent:v1#/properties/language\"},\"portablePrompt\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":32768,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"preparedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"packetDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}},\"$defs\":{\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"taskPackageReference\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"taskPackageId\",\"taskPackageRef\",\"taskPackageDigest\"],\"properties\":{\"taskPackageId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/taskPackageId\"},\"taskPackageRef\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"taskPackageDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"testCardReference\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"testCardId\",\"testCardRef\",\"testCardDigest\"],\"properties\":{\"testCardId\":{\"$ref\":\"urn:wakeflow:governance:testing:test-card:v1#/properties/testCardId\"},\"testCardRef\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"testCardDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"trimmedText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"taskBriefing\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"workType\",\"objective\",\"completionFocus\",\"priorityContext\",\"criticalBoundary\",\"requiredSkills\"],\"properties\":{\"workType\":{\"const\":\"test\"},\"objective\":{\"$ref\":\"#/$defs/trimmedText\"},\"completionFocus\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":2,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/trimmedText\"}},\"priorityContext\":{\"$ref\":\"#/$defs/trimmedText\"},\"criticalBoundary\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"value\"],\"properties\":{\"kind\":{\"enum\":[\"forbidden\",\"outOfScope\",\"inScope\"]},\"value\":{\"$ref\":\"#/$defs/trimmedText\"}}},\"requiredSkills\":{\"type\":\"array\",\"minItems\":2,\"maxItems\":2,\"uniqueItems\":true,\"items\":{\"enum\":[\"skills/wakeflow-target/SKILL.md\",\"skills/wakeflow-test/SKILL.md\"]}}}},\"testContract\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"executionContract\"],\"properties\":{\"executionContract\":{\"$ref\":\"#/$defs/executionContract\"}}},\"executionContract\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"requirementGoal\",\"approvedPlan\",\"allowedSkills\",\"environmentSetup\",\"maxAttempts\",\"changeControl\",\"productSourcePolicy\"],\"properties\":{\"requirementGoal\":{\"$ref\":\"urn:wakeflow:governance:testing:test-card:v1#/properties/requirementGoal\"},\"approvedPlan\":{\"$ref\":\"urn:wakeflow:governance:testing:test-card:v1#/properties/approvedPlan\"},\"allowedSkills\":{\"$ref\":\"urn:wakeflow:governance:testing:test-card:v1#/properties/allowedSkills\"},\"environmentSetup\":{\"$ref\":\"urn:wakeflow:governance:testing:test-execution-attempt:v1#/properties/environmentSetup\"},\"maxAttempts\":{\"$ref\":\"urn:wakeflow:governance:testing:test-card:v1#/properties/maxAttempts\"},\"changeControl\":{\"const\":\"return-blocked-to-controller\"},\"productSourcePolicy\":{\"const\":\"read-only\"}}}}}");
