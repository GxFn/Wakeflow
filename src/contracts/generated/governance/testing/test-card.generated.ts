/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/testing/test-card.schema.json
 */

export type TestCardId = string
export type TargetTaskId = string
export type ProgramId = string
export type DemandId = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
export type WindowId = string
/**
 * 跨领域只读消费一份已验证 Ledger authority member 的完整 ref/digest 关系。
 */
export type WakeflowLedgerAuthorityMemberReference = ({
[k: string]: unknown | undefined
} & {
artifactKind: "wakeflow-ledger-authority-member-reference"
schemaVersion: 1
family: ("requirement" | "confirmation")
recordId: string
recordRef: WakeflowPortableResourcePathText
recordDigest: WakeflowSha256DigestText
memberPath: WakeflowPortableResourcePathText
memberRef: WakeflowPortableResourcePathText
memberDigest: WakeflowSha256DigestText
role: ("original-plan" | "requirement-design" | "code-facts" | "landing-plan" | "non-goals" | "user-confirmation" | "reproduction" | "scope" | "requirement-delta" | "research-question" | "boundaries" | "test-environment" | "supporting-evidence" | "goal-stage-decision")
mediaType: string
})
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string
export type EventId = string
export type HumanText = string
/**
 * @minItems 1
 * @maxItems 32
 */
export type NonEmptyTextList = [HumanText, ...(HumanText)[]]
export type Token = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string

/**
 * Controller在产品功能接受后冻结的真实环境Test执行合同。
 */
export interface WakeflowTestCard {
artifactKind: "wakeflow-test-card"
schemaVersion: 1
testCardId: TestCardId
targetTaskId: TargetTaskId
programId: ProgramId
demandId: DemandId
demandAuthorityDigest: WakeflowSha256DigestText
testWindowId: WindowId
environmentAuthority: WakeflowLedgerAuthorityMemberReference
/**
 * @minItems 1
 * @maxItems 32
 */
testBasisAuthorities: [WakeflowLedgerAuthorityMemberReference, ...(WakeflowLedgerAuthorityMemberReference)[]]
source: Source
requirementGoal: HumanText
/**
 * @minItems 1
 * @maxItems 32
 */
implementationBaselines: [ImplementationBaseline, ...(ImplementationBaseline)[]]
approvedPlan: NonEmptyTextList
/**
 * @maxItems 32
 */
allowedSkills: Token[]
setupPolicy: ("fresh-once" | "fresh-per-attempt" | "reuse-existing")
maxAttempts: number
changeControl: "return-blocked-to-controller"
productSourcePolicy: "read-only"
question: HumanText
objectBoundary: HumanText
controllerSelfChecks: NonEmptyTextList
realScenarioConditions: NonEmptyTextList
successMeans: NonEmptyTextList
failureMeans: NonEmptyTextList
cannotConclude: NonEmptyTextList
stopConditions: NonEmptyTextList
evidenceRequired: NonEmptyTextList
allowedOperations: NonEmptyTextList
forbiddenOperations: NonEmptyTextList
createdAt: WakeflowUtcInstantText
testCardDigest: WakeflowSha256DigestText
}
export interface Source {
postAcceptanceRouteDigest: WakeflowSha256DigestText
reviewSnapshotDigest: WakeflowSha256DigestText
streamRevision: number
stateDigest: WakeflowSha256DigestText
lastEventId: EventId
lastEventDigest: WakeflowSha256DigestText
}
export interface ImplementationBaseline {
targetTaskId: TargetTaskId
taskPackageId: string
taskPackageDigest: WakeflowSha256DigestText
repositoryId: string
windowId: WindowId
targetResultId: string
resultDigest: WakeflowSha256DigestText
targetReviewDecisionId: string
decisionDigest: WakeflowSha256DigestText
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
export const WAKEFLOW_TEST_CARD_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:testing:test-card:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TEST_CARD_SCHEMA\",\"title\":\"WakeflowTestCard\",\"description\":\"Controller在产品功能接受后冻结的真实环境Test执行合同。\",\"$comment\":\"TestCard绑定real-environment Authority、非空且有序的Test Basis Authority来源、当前accepted implementation baselines与明确边界；它不创建Test TaskPackage、不执行环境操作，也不把Test结果升级为Controller acceptance。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"testCardId\",\"targetTaskId\",\"programId\",\"demandId\",\"demandAuthorityDigest\",\"testWindowId\",\"environmentAuthority\",\"testBasisAuthorities\",\"source\",\"requirementGoal\",\"implementationBaselines\",\"approvedPlan\",\"allowedSkills\",\"setupPolicy\",\"maxAttempts\",\"changeControl\",\"productSourcePolicy\",\"question\",\"objectBoundary\",\"controllerSelfChecks\",\"realScenarioConditions\",\"successMeans\",\"failureMeans\",\"cannotConclude\",\"stopConditions\",\"evidenceRequired\",\"allowedOperations\",\"forbiddenOperations\",\"createdAt\",\"testCardDigest\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-test-card\"},\"schemaVersion\":{\"const\":1},\"testCardId\":{\"$ref\":\"#/$defs/testCardId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"programId\":{\"$ref\":\"#/$defs/programId\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"demandAuthorityDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"testWindowId\":{\"$ref\":\"#/$defs/windowId\"},\"environmentAuthority\":{\"$ref\":\"urn:wakeflow:governance:ledger:authority-member-reference:v1\"},\"testBasisAuthorities\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"urn:wakeflow:governance:ledger:authority-member-reference:v1\"}},\"source\":{\"$ref\":\"#/$defs/source\"},\"requirementGoal\":{\"$ref\":\"#/$defs/humanText\"},\"implementationBaselines\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/implementationBaseline\"}},\"approvedPlan\":{\"$ref\":\"#/$defs/nonEmptyTextList\"},\"allowedSkills\":{\"type\":\"array\",\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/token\"}},\"setupPolicy\":{\"enum\":[\"fresh-once\",\"fresh-per-attempt\",\"reuse-existing\"]},\"maxAttempts\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":10},\"changeControl\":{\"const\":\"return-blocked-to-controller\"},\"productSourcePolicy\":{\"const\":\"read-only\"},\"question\":{\"$ref\":\"#/$defs/humanText\"},\"objectBoundary\":{\"$ref\":\"#/$defs/humanText\"},\"controllerSelfChecks\":{\"$ref\":\"#/$defs/nonEmptyTextList\"},\"realScenarioConditions\":{\"$ref\":\"#/$defs/nonEmptyTextList\"},\"successMeans\":{\"$ref\":\"#/$defs/nonEmptyTextList\"},\"failureMeans\":{\"$ref\":\"#/$defs/nonEmptyTextList\"},\"cannotConclude\":{\"$ref\":\"#/$defs/nonEmptyTextList\"},\"stopConditions\":{\"$ref\":\"#/$defs/nonEmptyTextList\"},\"evidenceRequired\":{\"$ref\":\"#/$defs/nonEmptyTextList\"},\"allowedOperations\":{\"$ref\":\"#/$defs/nonEmptyTextList\"},\"forbiddenOperations\":{\"$ref\":\"#/$defs/nonEmptyTextList\"},\"createdAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"testCardDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}},\"$defs\":{\"testCardId\":{\"type\":\"string\",\"pattern\":\"^test-card_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"token\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$\"},\"humanText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"nonEmptyTextList\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/humanText\"}},\"source\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"postAcceptanceRouteDigest\",\"reviewSnapshotDigest\",\"streamRevision\",\"stateDigest\",\"lastEventId\",\"lastEventDigest\"],\"properties\":{\"postAcceptanceRouteDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"reviewSnapshotDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1},\"stateDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"lastEventId\":{\"$ref\":\"#/$defs/eventId\"},\"lastEventDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"implementationBaseline\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetTaskId\",\"taskPackageId\",\"taskPackageDigest\",\"repositoryId\",\"windowId\",\"targetResultId\",\"resultDigest\",\"targetReviewDecisionId\",\"decisionDigest\"],\"properties\":{\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"taskPackageId\":{\"type\":\"string\",\"pattern\":\"^task-package_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"taskPackageDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"targetResultId\":{\"type\":\"string\",\"pattern\":\"^target-result_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"resultDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"targetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"decisionDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}}}}");
