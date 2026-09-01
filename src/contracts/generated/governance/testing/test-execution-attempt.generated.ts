/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/testing/test-execution-attempt.schema.json
 */

/**
 * Controller为一次真实环境Test执行授权的逻辑attempt。
 */
export type WakeflowTestExecutionAttempt = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowTestExecutionAttempt"
schemaVersion: 1
testAttemptId: TestAttemptId
targetTaskId: string
testCard: TestCardTuple
ordinal: number
mode: ("initial" | "rerun")
environmentSetup: EnvironmentSetup
rerunSource?: RerunSource
})
export type TestAttemptId = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
export type TargetResultId = string
export type TargetReviewDecisionId = string

export interface TestCardTuple {
testCardId: string
testCardDigest: WakeflowSha256DigestText
}
export interface EnvironmentSetup {
policy: ("fresh-once" | "fresh-per-attempt" | "reuse-existing")
directive: ("prepare-fresh-environment" | "reuse-confirmed-environment")
}
export interface RerunSource {
previousAttemptId: TestAttemptId
previousResult: {
targetResultId: TargetResultId
resultDigest: WakeflowSha256DigestText
}
reviewDecision: {
targetReviewDecisionId: TargetReviewDecisionId
decisionDigest: WakeflowSha256DigestText
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
export const WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:testing:test-execution-attempt:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA\",\"title\":\"WakeflowTestExecutionAttempt\",\"description\":\"Controller为一次真实环境Test执行授权的逻辑attempt。\",\"$comment\":\"initial与rerun都是有独立身份和连续ordinal的logical Test attempt；host-send替代授权不创建新attempt。rerun绑定上一attempt、精确Result和Controller request-another-attempt Decision。environmentSetup是按TestCard策略派生的执行指令，不是环境已准备回执。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"testAttemptId\",\"targetTaskId\",\"testCard\",\"ordinal\",\"mode\",\"environmentSetup\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTestExecutionAttempt\"},\"schemaVersion\":{\"const\":1},\"testAttemptId\":{\"$ref\":\"#/$defs/testAttemptId\"},\"targetTaskId\":{\"$ref\":\"urn:wakeflow:governance:testing:test-card:v1#/properties/targetTaskId\"},\"testCard\":{\"$ref\":\"#/$defs/testCardTuple\"},\"ordinal\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":10},\"mode\":{\"enum\":[\"initial\",\"rerun\"]},\"environmentSetup\":{\"$ref\":\"#/$defs/environmentSetup\"},\"rerunSource\":{\"$ref\":\"#/$defs/rerunSource\"}},\"allOf\":[{\"if\":{\"properties\":{\"mode\":{\"const\":\"initial\"}},\"required\":[\"mode\"]},\"then\":{\"properties\":{\"ordinal\":{\"const\":1},\"rerunSource\":false}},\"else\":{\"required\":[\"rerunSource\"],\"properties\":{\"ordinal\":{\"type\":\"integer\",\"minimum\":2,\"maximum\":10}}}},{\"if\":{\"properties\":{\"environmentSetup\":{\"type\":\"object\",\"properties\":{\"policy\":{\"const\":\"reuse-existing\"}},\"required\":[\"policy\"]}}},\"then\":{\"properties\":{\"environmentSetup\":{\"type\":\"object\",\"properties\":{\"directive\":{\"const\":\"reuse-confirmed-environment\"}}}}}},{\"if\":{\"properties\":{\"environmentSetup\":{\"type\":\"object\",\"properties\":{\"policy\":{\"const\":\"fresh-per-attempt\"}},\"required\":[\"policy\"]}}},\"then\":{\"properties\":{\"environmentSetup\":{\"type\":\"object\",\"properties\":{\"directive\":{\"const\":\"prepare-fresh-environment\"}}}}}},{\"if\":{\"properties\":{\"environmentSetup\":{\"type\":\"object\",\"properties\":{\"policy\":{\"const\":\"fresh-once\"}},\"required\":[\"policy\"]}}},\"then\":{\"if\":{\"properties\":{\"mode\":{\"const\":\"initial\"}}},\"then\":{\"properties\":{\"environmentSetup\":{\"type\":\"object\",\"properties\":{\"directive\":{\"const\":\"prepare-fresh-environment\"}}}}},\"else\":{\"properties\":{\"environmentSetup\":{\"type\":\"object\",\"properties\":{\"directive\":{\"const\":\"reuse-confirmed-environment\"}}}}}}}],\"$defs\":{\"testAttemptId\":{\"type\":\"string\",\"pattern\":\"^test-attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"testCardTuple\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"testCardId\",\"testCardDigest\"],\"properties\":{\"testCardId\":{\"$ref\":\"urn:wakeflow:governance:testing:test-card:v1#/properties/testCardId\"},\"testCardDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"targetResultId\":{\"type\":\"string\",\"pattern\":\"^target-result_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"rerunSource\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"previousAttemptId\",\"previousResult\",\"reviewDecision\"],\"properties\":{\"previousAttemptId\":{\"$ref\":\"#/$defs/testAttemptId\"},\"previousResult\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetResultId\",\"resultDigest\"],\"properties\":{\"targetResultId\":{\"$ref\":\"#/$defs/targetResultId\"},\"resultDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"reviewDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetReviewDecisionId\",\"decisionDigest\"],\"properties\":{\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"decisionDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}}}},\"environmentSetup\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"policy\",\"directive\"],\"properties\":{\"policy\":{\"$ref\":\"urn:wakeflow:governance:testing:test-card:v1#/properties/setupPolicy\"},\"directive\":{\"enum\":[\"prepare-fresh-environment\",\"reuse-confirmed-environment\"]}}}}}");
