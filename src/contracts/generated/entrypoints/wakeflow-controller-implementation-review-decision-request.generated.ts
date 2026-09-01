/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-controller-implementation-review-decision-request.schema.json
 */

/**
 * Closed Controller-authored command for recording one implementation TargetResult review decision against an inspected Snapshot baseline.
 */
export type WakeflowControllerImplementationReviewDecisionRequestV1 = ({
[k: string]: unknown | undefined
} & {
root: WorkspaceRoot
demandId: DemandId
targetResultId: TargetResultId
snapshotDigest: Sha256Digest
reviewUnitDigest: Sha256Digest
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
})
/**
 * Absolute path of the existing Wakeflow workspace root.
 */
export type WorkspaceRoot = string
export type DemandId = string
export type TargetResultId = string
export type Sha256Digest = string
export type Token = string
export type HumanText = string
/**
 * @maxItems 32
 */
export type TextList = HumanText[]

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
export const WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:controller-implementation-review-decision-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_REQUEST_SCHEMA\",\"title\":\"WakeflowControllerImplementationReviewDecisionRequestV1\",\"description\":\"Closed Controller-authored command for recording one implementation TargetResult review decision against an inspected Snapshot baseline.\",\"$comment\":\"The caller supplies only the inspected TargetResult/Snapshot identity and Controller judgment. Wakeflow derives Target Task, Controller Window, state/revision, Decision/Event/Commit identity, and decision time.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"demandId\",\"targetResultId\",\"snapshotDigest\",\"reviewUnitDigest\",\"decision\",\"assessment\",\"independentChecks\",\"rationale\",\"blockingReasons\",\"residualRisks\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"targetResultId\":{\"$ref\":\"#/$defs/targetResultId\"},\"snapshotDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"reviewUnitDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"decision\":{\"enum\":[\"accept\",\"blocked\",\"redesign\",\"rework\"]},\"assessment\":{\"$ref\":\"#/$defs/assessment\"},\"independentChecks\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/independentCheck\"}},\"rationale\":{\"$ref\":\"#/$defs/humanText\"},\"blockingReasons\":{\"$ref\":\"#/$defs/textList\"},\"residualRisks\":{\"$ref\":\"#/$defs/textList\"}},\"allOf\":[{\"if\":{\"properties\":{\"decision\":{\"const\":\"accept\"}},\"required\":[\"decision\"]},\"then\":{\"properties\":{\"assessment\":{\"type\":\"object\",\"properties\":{\"requirementAlignment\":{\"const\":\"aligned\"},\"implementationQuality\":{\"const\":\"satisfactory\"}}},\"independentChecks\":{\"type\":\"array\",\"items\":{\"type\":\"object\",\"properties\":{\"outcome\":{\"const\":\"passed\"}}}},\"blockingReasons\":{\"type\":\"array\",\"maxItems\":0}}}},{\"if\":{\"properties\":{\"decision\":{\"const\":\"rework\"}},\"required\":[\"decision\"]},\"then\":{\"properties\":{\"assessment\":{\"type\":\"object\",\"properties\":{\"requirementAlignment\":{\"const\":\"aligned\"},\"implementationQuality\":{\"const\":\"defective\"}}},\"independentChecks\":{\"type\":\"array\",\"contains\":{\"type\":\"object\",\"properties\":{\"outcome\":{\"const\":\"failed\"}},\"required\":[\"outcome\"]},\"minContains\":1},\"blockingReasons\":{\"type\":\"array\",\"maxItems\":0}}}},{\"if\":{\"properties\":{\"decision\":{\"const\":\"redesign\"}},\"required\":[\"decision\"]},\"then\":{\"properties\":{\"assessment\":{\"type\":\"object\",\"properties\":{\"requirementAlignment\":{\"const\":\"mismatch\"}}},\"independentChecks\":{\"type\":\"array\",\"contains\":{\"type\":\"object\",\"properties\":{\"outcome\":{\"enum\":[\"failed\",\"inconclusive\"]}},\"required\":[\"outcome\"]},\"minContains\":1},\"blockingReasons\":{\"type\":\"array\",\"maxItems\":0}}}},{\"if\":{\"properties\":{\"decision\":{\"const\":\"blocked\"}},\"required\":[\"decision\"]},\"then\":{\"properties\":{\"blockingReasons\":{\"type\":\"array\",\"minItems\":1},\"assessment\":{\"type\":\"object\",\"not\":{\"type\":\"object\",\"properties\":{\"requirementAlignment\":{\"const\":\"aligned\"},\"implementationQuality\":{\"const\":\"satisfactory\"}},\"required\":[\"requirementAlignment\",\"implementationQuality\"]}}}}}],\"$defs\":{\"workspaceRoot\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetResultId\":{\"type\":\"string\",\"pattern\":\"^target-result_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"assessment\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"requirementAlignment\",\"implementationQuality\"],\"properties\":{\"requirementAlignment\":{\"enum\":[\"aligned\",\"mismatch\",\"unresolved\"]},\"implementationQuality\":{\"enum\":[\"satisfactory\",\"defective\",\"unverified\"]}}},\"independentCheck\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"checkId\",\"method\",\"outcome\",\"observation\"],\"properties\":{\"checkId\":{\"$ref\":\"#/$defs/token\"},\"method\":{\"$ref\":\"#/$defs/humanText\"},\"outcome\":{\"enum\":[\"passed\",\"failed\",\"inconclusive\"]},\"observation\":{\"$ref\":\"#/$defs/humanText\"}}},\"textList\":{\"type\":\"array\",\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/humanText\"}},\"token\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"humanText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"}}}");
