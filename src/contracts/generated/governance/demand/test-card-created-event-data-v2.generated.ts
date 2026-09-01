/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/test-card-created-event-data-v2.schema.json
 */

/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
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
/**
 * @minItems 1
 * @maxItems 32
 */
export type NonEmptyTextList = [string, ...(string)[]]
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
/**
 * TestCard创建Event记录的代际原因；不进入TestCard执行合同。
 */
export type WakeflowTestCardGenerationSource = (Initial | ProductDefectRetest)

/**
 * testing.test-card-created persisted event v2 的严格payload。
 */
export interface WakeflowTestCardCreatedEventDataV2 {
testCard: WakeflowTestCard
generationSource: WakeflowTestCardGenerationSource
}
/**
 * Controller在产品功能接受后冻结的真实环境Test执行合同。
 */
export interface WakeflowTestCard {
artifactKind: "wakeflow-test-card"
schemaVersion: 1
testCardId: string
targetTaskId: string
programId: string
demandId: string
demandAuthorityDigest: WakeflowSha256DigestText
testWindowId: string
environmentAuthority: WakeflowLedgerAuthorityMemberReference
/**
 * @minItems 1
 * @maxItems 32
 */
testBasisAuthorities: [WakeflowLedgerAuthorityMemberReference, ...(WakeflowLedgerAuthorityMemberReference)[]]
source: Source
requirementGoal: string
/**
 * @minItems 1
 * @maxItems 32
 */
implementationBaselines: [ImplementationBaseline, ...(ImplementationBaseline)[]]
approvedPlan: NonEmptyTextList
/**
 * @maxItems 32
 */
allowedSkills: string[]
setupPolicy: ("fresh-once" | "fresh-per-attempt" | "reuse-existing")
maxAttempts: number
changeControl: "return-blocked-to-controller"
productSourcePolicy: "read-only"
question: string
objectBoundary: string
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
lastEventId: string
lastEventDigest: WakeflowSha256DigestText
}
export interface ImplementationBaseline {
targetTaskId: string
taskPackageId: string
taskPackageDigest: WakeflowSha256DigestText
repositoryId: string
windowId: string
targetResultId: string
resultDigest: WakeflowSha256DigestText
targetReviewDecisionId: string
decisionDigest: WakeflowSha256DigestText
}
export interface Initial {
kind: "initial"
}
export interface ProductDefectRetest {
kind: "product-defect-retest"
previousTestCard: TestCard
testReviewDecision: TestReviewDecision
productDefectRemediation: ProductDefectRemediation
}
export interface TestCard {
testCardId: string
testCardDigest: WakeflowSha256DigestText
}
export interface TestReviewDecision {
targetReviewDecisionId: string
decisionDigest: WakeflowSha256DigestText
}
export interface ProductDefectRemediation {
productDefectRemediationId: string
authorizationDigest: WakeflowSha256DigestText
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
export const WAKEFLOW_TEST_CARD_CREATED_EVENT_DATA_V2_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-sourcing:test-card-created-data:v2\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TEST_CARD_CREATED_EVENT_DATA_V2_SCHEMA\",\"title\":\"WakeflowTestCardCreatedEventDataV2\",\"description\":\"testing.test-card-created persisted event v2 的严格payload。\",\"$comment\":\"完整TestCard保持当前Test执行合同；generationSource独立记录初始创建或产品缺陷修复后的retest原因。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"testCard\",\"generationSource\"],\"properties\":{\"testCard\":{\"$ref\":\"urn:wakeflow:governance:testing:test-card:v1\"},\"generationSource\":{\"$ref\":\"urn:wakeflow:governance:testing:test-card-generation-source:v1\"}}}");
