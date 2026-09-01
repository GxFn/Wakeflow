/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/review/controller-implementation-review-decision.schema.json
 */

/**
 * Controller基于精确Result Review Snapshot作出的单implementation Target审查决定。
 */
export type WakeflowControllerImplementationReviewDecision = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowControllerImplementationReviewDecision"
schemaVersion: 1
targetReviewDecisionId: TargetReviewDecisionId
programId: string
demandId: string
targetTaskId: string
controllerWindowId: string
reviewed: Reviewed
decision: ("accept" | "blocked" | "redesign" | "rework")
assessment: Assessment
/**
 * @minItems 1
 * @maxItems 32
 */
independentChecks: [IndependentCheck, ...(IndependentCheck)[]]
rationale: HumanText
blockingReasons: TextList
residualRisks: TextList
decidedAt: WakeflowUtcInstantText
decisionDigest: WakeflowSha256DigestText
})
export type TargetReviewDecisionId = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
export type TaskPackageId = string
export type TargetResultId = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
export type Token = string
export type HumanText = string
/**
 * @maxItems 32
 */
export type TextList = HumanText[]

export interface Reviewed {
snapshotDigest: WakeflowSha256DigestText
reviewUnitDigest: WakeflowSha256DigestText
stateDigest: WakeflowSha256DigestText
streamRevision: number
taskPackageId: TaskPackageId
taskPackageDigest: WakeflowSha256DigestText
targetResultId: TargetResultId
targetResultDigest: WakeflowSha256DigestText
targetResultOutcome: ("completed" | "blocked" | "needs-review")
targetResultReportedAt: WakeflowUtcInstantText
}
export interface Assessment {
requirementAlignment: ("aligned" | "mismatch" | "unresolved")
implementationQuality: ("satisfactory" | "defective" | "unverified")
}
export interface IndependentCheck {
checkId: Token
method: HumanText
outcome: ("passed" | "failed" | "inconclusive")
observation: HumanText
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
export const WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:review:controller-implementation-review-decision:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_SCHEMA\",\"title\":\"WakeflowControllerImplementationReviewDecision\",\"description\":\"Controller基于精确Result Review Snapshot作出的单implementation Target审查决定。\",\"$comment\":\"本记录保存Controller的独立审查陈述和精确并发基线；它不是TargetResult派生结论，也不创建ReviewCandidate。Schema约束决定与双轴assessment/check outcome的最小一致性，真实性仍由Controller负责。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"targetReviewDecisionId\",\"programId\",\"demandId\",\"targetTaskId\",\"controllerWindowId\",\"reviewed\",\"decision\",\"assessment\",\"independentChecks\",\"rationale\",\"blockingReasons\",\"residualRisks\",\"decidedAt\",\"decisionDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowControllerImplementationReviewDecision\"},\"schemaVersion\":{\"const\":1},\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"programId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/programId\"},\"demandId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/demandId\"},\"targetTaskId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/properties/targetTaskId\"},\"controllerWindowId\":{\"$ref\":\"urn:wakeflow:governance:tasking:task-package:v1#/$defs/windowId\"},\"reviewed\":{\"$ref\":\"#/$defs/reviewed\"},\"decision\":{\"enum\":[\"accept\",\"blocked\",\"redesign\",\"rework\"]},\"assessment\":{\"$ref\":\"#/$defs/assessment\"},\"independentChecks\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/independentCheck\"}},\"rationale\":{\"$ref\":\"#/$defs/humanText\"},\"blockingReasons\":{\"$ref\":\"#/$defs/textList\"},\"residualRisks\":{\"$ref\":\"#/$defs/textList\"},\"decidedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"decisionDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}},\"allOf\":[{\"if\":{\"properties\":{\"decision\":{\"const\":\"accept\"}},\"required\":[\"decision\"]},\"then\":{\"properties\":{\"reviewed\":{\"type\":\"object\",\"properties\":{\"targetResultOutcome\":{\"enum\":[\"completed\",\"needs-review\"]}}},\"assessment\":{\"type\":\"object\",\"properties\":{\"requirementAlignment\":{\"const\":\"aligned\"},\"implementationQuality\":{\"const\":\"satisfactory\"}}},\"independentChecks\":{\"type\":\"array\",\"items\":{\"type\":\"object\",\"properties\":{\"outcome\":{\"const\":\"passed\"}}}},\"blockingReasons\":{\"type\":\"array\",\"maxItems\":0}}}},{\"if\":{\"properties\":{\"decision\":{\"const\":\"rework\"}},\"required\":[\"decision\"]},\"then\":{\"properties\":{\"assessment\":{\"type\":\"object\",\"properties\":{\"requirementAlignment\":{\"const\":\"aligned\"},\"implementationQuality\":{\"const\":\"defective\"}}},\"independentChecks\":{\"type\":\"array\",\"contains\":{\"type\":\"object\",\"properties\":{\"outcome\":{\"const\":\"failed\"}},\"required\":[\"outcome\"]},\"minContains\":1},\"blockingReasons\":{\"type\":\"array\",\"maxItems\":0}}}},{\"if\":{\"properties\":{\"decision\":{\"const\":\"redesign\"}},\"required\":[\"decision\"]},\"then\":{\"properties\":{\"assessment\":{\"type\":\"object\",\"properties\":{\"requirementAlignment\":{\"const\":\"mismatch\"}}},\"independentChecks\":{\"type\":\"array\",\"contains\":{\"type\":\"object\",\"properties\":{\"outcome\":{\"enum\":[\"failed\",\"inconclusive\"]}},\"required\":[\"outcome\"]},\"minContains\":1},\"blockingReasons\":{\"type\":\"array\",\"maxItems\":0}}}},{\"if\":{\"properties\":{\"decision\":{\"const\":\"blocked\"}},\"required\":[\"decision\"]},\"then\":{\"properties\":{\"blockingReasons\":{\"type\":\"array\",\"minItems\":1},\"assessment\":{\"type\":\"object\",\"not\":{\"type\":\"object\",\"properties\":{\"requirementAlignment\":{\"const\":\"aligned\"},\"implementationQuality\":{\"const\":\"satisfactory\"}},\"required\":[\"requirementAlignment\",\"implementationQuality\"]}}}}}],\"$defs\":{\"targetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"taskPackageId\":{\"type\":\"string\",\"pattern\":\"^task-package_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetResultId\":{\"type\":\"string\",\"pattern\":\"^target-result_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"reviewed\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"snapshotDigest\",\"reviewUnitDigest\",\"stateDigest\",\"streamRevision\",\"taskPackageId\",\"taskPackageDigest\",\"targetResultId\",\"targetResultDigest\",\"targetResultOutcome\",\"targetResultReportedAt\"],\"properties\":{\"snapshotDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"reviewUnitDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"stateDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1},\"taskPackageId\":{\"$ref\":\"#/$defs/taskPackageId\"},\"taskPackageDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"targetResultId\":{\"$ref\":\"#/$defs/targetResultId\"},\"targetResultDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"targetResultOutcome\":{\"enum\":[\"completed\",\"blocked\",\"needs-review\"]},\"targetResultReportedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"}}},\"assessment\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"requirementAlignment\",\"implementationQuality\"],\"properties\":{\"requirementAlignment\":{\"enum\":[\"aligned\",\"mismatch\",\"unresolved\"]},\"implementationQuality\":{\"enum\":[\"satisfactory\",\"defective\",\"unverified\"]}}},\"independentCheck\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"checkId\",\"method\",\"outcome\",\"observation\"],\"properties\":{\"checkId\":{\"$ref\":\"#/$defs/token\"},\"method\":{\"$ref\":\"#/$defs/humanText\"},\"outcome\":{\"enum\":[\"passed\",\"failed\",\"inconclusive\"]},\"observation\":{\"$ref\":\"#/$defs/humanText\"}}},\"textList\":{\"type\":\"array\",\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/humanText\"}},\"token\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"humanText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"}}}");
