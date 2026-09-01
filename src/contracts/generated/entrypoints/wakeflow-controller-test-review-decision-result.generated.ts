/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-controller-test-review-decision-result.schema.json
 */

/**
 * Successful result for one idempotently recorded Controller Test Review Decision Event.
 */
export type WakeflowControllerTestReviewDecisionResultV1 = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowControllerTestReviewDecisionResult"
schemaVersion: 1
tool: "wakeflow_record_controller_test_review_decision"
status: ("decided" | "already-decided")
disposition: ("committed" | "idempotent")
eventAuthority: "current"
decision: Decision
event: EventReceipt
commit: CommitReceipt
stateDigest: Sha256Digest
})
export type Decision = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowControllerTestReviewDecision"
schemaVersion: 1
targetReviewDecisionId: TargetReviewDecisionId
programId: ProgramId
demandId: DemandId
targetTaskId: TargetTaskId
controllerWindowId: WindowId
reviewed: Reviewed
testExecution: TestExecution
decision: ("accept" | "request-another-attempt" | "escalate-product-defect" | "blocked")
assessment: Assessment
/**
 * @minItems 1
 * @maxItems 32
 */
independentChecks: [IndependentCheck, ...(IndependentCheck)[]]
rationale: HumanText
blockingReasons: TextList
residualRisks: TextList
decidedAt: UtcInstant
decisionDigest: Sha256Digest
})
export type TargetReviewDecisionId = string
export type ProgramId = string
export type DemandId = string
export type TargetTaskId = string
export type WindowId = string
export type Sha256Digest = string
export type TaskPackageId = string
export type TargetResultId = string
export type UtcInstant = string
export type TestAttemptId = string
export type TestCardId = string
export type Token = string
export type HumanText = string
/**
 * @maxItems 32
 */
export type TextList = HumanText[]
export type EventId = string
export type CommitId = string

export interface Reviewed {
snapshotDigest: Sha256Digest
reviewUnitDigest: Sha256Digest
stateDigest: Sha256Digest
streamRevision: number
taskPackageId: TaskPackageId
taskPackageDigest: Sha256Digest
targetResultId: TargetResultId
targetResultDigest: Sha256Digest
targetResultOutcome: ("completed" | "blocked" | "needs-review")
targetResultReportedAt: UtcInstant
}
export interface TestExecution {
testAttemptId: TestAttemptId
testCard: {
testCardId: TestCardId
testCardDigest: Sha256Digest
}
testDispatchPacketDigest: Sha256Digest
}
export interface Assessment {
conclusion: ("satisfied" | "defect-observed" | "inconclusive")
evidenceSufficiency: ("sufficient" | "insufficient")
}
export interface IndependentCheck {
checkId: Token
method: HumanText
outcome: ("passed" | "failed" | "inconclusive")
observation: HumanText
}
export interface EventReceipt {
eventId: EventId
streamRevision: number
}
export interface CommitReceipt {
commitId: CommitId
commitSequence: number
commitDigest: Sha256Digest
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
export const WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:controller-test-review-decision-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_RESULT_SCHEMA\",\"title\":\"WakeflowControllerTestReviewDecisionResultV1\",\"description\":\"Successful result for one idempotently recorded Controller Test Review Decision Event.\",\"$comment\":\"The Decision is the only Test Target review authority. It records Controller judgment but does not create another attempt, authorize product remediation, dispatch work, or complete the Demand.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"status\",\"disposition\",\"eventAuthority\",\"decision\",\"event\",\"commit\",\"stateDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowControllerTestReviewDecisionResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_record_controller_test_review_decision\"},\"status\":{\"enum\":[\"decided\",\"already-decided\"]},\"disposition\":{\"enum\":[\"committed\",\"idempotent\"]},\"eventAuthority\":{\"const\":\"current\"},\"decision\":{\"$ref\":\"#/$defs/decision\"},\"event\":{\"$ref\":\"#/$defs/eventReceipt\"},\"commit\":{\"$ref\":\"#/$defs/commitReceipt\"},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}},\"allOf\":[{\"if\":{\"properties\":{\"status\":{\"const\":\"decided\"}},\"required\":[\"status\"]},\"then\":{\"properties\":{\"disposition\":{\"const\":\"committed\"}}}},{\"if\":{\"properties\":{\"status\":{\"const\":\"already-decided\"}},\"required\":[\"status\"]},\"then\":{\"properties\":{\"disposition\":{\"const\":\"idempotent\"}}}}],\"$defs\":{\"targetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"taskPackageId\":{\"type\":\"string\",\"pattern\":\"^task-package_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetResultId\":{\"type\":\"string\",\"pattern\":\"^target-result_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"testAttemptId\":{\"type\":\"string\",\"pattern\":\"^test-attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"testCardId\":{\"type\":\"string\",\"pattern\":\"^test-card_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"reviewed\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"snapshotDigest\",\"reviewUnitDigest\",\"stateDigest\",\"streamRevision\",\"taskPackageId\",\"taskPackageDigest\",\"targetResultId\",\"targetResultDigest\",\"targetResultOutcome\",\"targetResultReportedAt\"],\"properties\":{\"snapshotDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"reviewUnitDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1},\"taskPackageId\":{\"$ref\":\"#/$defs/taskPackageId\"},\"taskPackageDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"targetResultId\":{\"$ref\":\"#/$defs/targetResultId\"},\"targetResultDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"targetResultOutcome\":{\"enum\":[\"completed\",\"blocked\",\"needs-review\"]},\"targetResultReportedAt\":{\"$ref\":\"#/$defs/utcInstant\"}}},\"testExecution\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"testAttemptId\",\"testCard\",\"testDispatchPacketDigest\"],\"properties\":{\"testAttemptId\":{\"$ref\":\"#/$defs/testAttemptId\"},\"testCard\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"testCardId\",\"testCardDigest\"],\"properties\":{\"testCardId\":{\"$ref\":\"#/$defs/testCardId\"},\"testCardDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"testDispatchPacketDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"assessment\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"conclusion\",\"evidenceSufficiency\"],\"properties\":{\"conclusion\":{\"enum\":[\"satisfied\",\"defect-observed\",\"inconclusive\"]},\"evidenceSufficiency\":{\"enum\":[\"sufficient\",\"insufficient\"]}}},\"independentCheck\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"checkId\",\"method\",\"outcome\",\"observation\"],\"properties\":{\"checkId\":{\"$ref\":\"#/$defs/token\"},\"method\":{\"$ref\":\"#/$defs/humanText\"},\"outcome\":{\"enum\":[\"passed\",\"failed\",\"inconclusive\"]},\"observation\":{\"$ref\":\"#/$defs/humanText\"}}},\"textList\":{\"type\":\"array\",\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/humanText\"}},\"token\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"humanText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"decision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"targetReviewDecisionId\",\"programId\",\"demandId\",\"targetTaskId\",\"controllerWindowId\",\"reviewed\",\"testExecution\",\"decision\",\"assessment\",\"independentChecks\",\"rationale\",\"blockingReasons\",\"residualRisks\",\"decidedAt\",\"decisionDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowControllerTestReviewDecision\"},\"schemaVersion\":{\"const\":1},\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"programId\":{\"$ref\":\"#/$defs/programId\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"controllerWindowId\":{\"$ref\":\"#/$defs/windowId\"},\"reviewed\":{\"$ref\":\"#/$defs/reviewed\"},\"testExecution\":{\"$ref\":\"#/$defs/testExecution\"},\"decision\":{\"enum\":[\"accept\",\"request-another-attempt\",\"escalate-product-defect\",\"blocked\"]},\"assessment\":{\"$ref\":\"#/$defs/assessment\"},\"independentChecks\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"#/$defs/independentCheck\"}},\"rationale\":{\"$ref\":\"#/$defs/humanText\"},\"blockingReasons\":{\"$ref\":\"#/$defs/textList\"},\"residualRisks\":{\"$ref\":\"#/$defs/textList\"},\"decidedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"decisionDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}},\"allOf\":[{\"if\":{\"properties\":{\"decision\":{\"const\":\"accept\"}},\"required\":[\"decision\"]},\"then\":{\"properties\":{\"reviewed\":{\"type\":\"object\",\"properties\":{\"targetResultOutcome\":{\"const\":\"completed\"}}},\"assessment\":{\"type\":\"object\",\"properties\":{\"conclusion\":{\"const\":\"satisfied\"},\"evidenceSufficiency\":{\"const\":\"sufficient\"}}},\"independentChecks\":{\"type\":\"array\",\"items\":{\"type\":\"object\",\"properties\":{\"outcome\":{\"const\":\"passed\"}}}},\"blockingReasons\":{\"type\":\"array\",\"maxItems\":0}}}},{\"if\":{\"properties\":{\"decision\":{\"const\":\"request-another-attempt\"}},\"required\":[\"decision\"]},\"then\":{\"properties\":{\"assessment\":{\"type\":\"object\",\"anyOf\":[{\"properties\":{\"conclusion\":{\"const\":\"inconclusive\"}},\"required\":[\"conclusion\"]},{\"properties\":{\"evidenceSufficiency\":{\"const\":\"insufficient\"}},\"required\":[\"evidenceSufficiency\"]}]},\"independentChecks\":{\"type\":\"array\",\"contains\":{\"type\":\"object\",\"properties\":{\"outcome\":{\"enum\":[\"failed\",\"inconclusive\"]}},\"required\":[\"outcome\"]},\"minContains\":1},\"blockingReasons\":{\"type\":\"array\",\"maxItems\":0}}}},{\"if\":{\"properties\":{\"decision\":{\"const\":\"escalate-product-defect\"}},\"required\":[\"decision\"]},\"then\":{\"properties\":{\"reviewed\":{\"type\":\"object\",\"properties\":{\"targetResultOutcome\":{\"enum\":[\"completed\",\"needs-review\"]}}},\"assessment\":{\"type\":\"object\",\"properties\":{\"conclusion\":{\"const\":\"defect-observed\"},\"evidenceSufficiency\":{\"const\":\"sufficient\"}}},\"independentChecks\":{\"type\":\"array\",\"contains\":{\"type\":\"object\",\"properties\":{\"outcome\":{\"const\":\"failed\"}},\"required\":[\"outcome\"]},\"minContains\":1},\"blockingReasons\":{\"type\":\"array\",\"maxItems\":0}}}},{\"if\":{\"properties\":{\"decision\":{\"const\":\"blocked\"}},\"required\":[\"decision\"]},\"then\":{\"properties\":{\"blockingReasons\":{\"type\":\"array\",\"minItems\":1},\"assessment\":{\"type\":\"object\",\"not\":{\"type\":\"object\",\"properties\":{\"conclusion\":{\"const\":\"satisfied\"},\"evidenceSufficiency\":{\"const\":\"sufficient\"}},\"required\":[\"conclusion\",\"evidenceSufficiency\"]}}}}}]},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"eventId\",\"streamRevision\"],\"properties\":{\"eventId\":{\"$ref\":\"#/$defs/eventId\"},\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991}}},\"commitReceipt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"commitId\",\"commitSequence\",\"commitDigest\"],\"properties\":{\"commitId\":{\"$ref\":\"#/$defs/commitId\"},\"commitSequence\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"commitDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}}}}");
