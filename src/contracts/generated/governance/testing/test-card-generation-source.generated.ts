/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/testing/test-card-generation-source.schema.json
 */

/**
 * TestCard创建Event记录的代际原因；不进入TestCard执行合同。
 */
export type WakeflowTestCardGenerationSource = (Initial | ProductDefectRetest)
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string

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
export const WAKEFLOW_TEST_CARD_GENERATION_SOURCE_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:testing:test-card-generation-source:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TEST_CARD_GENERATION_SOURCE_SCHEMA\",\"title\":\"WakeflowTestCardGenerationSource\",\"description\":\"TestCard创建Event记录的代际原因；不进入TestCard执行合同。\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/initial\"},{\"$ref\":\"#/$defs/productDefectRetest\"}],\"$defs\":{\"initial\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\"],\"properties\":{\"kind\":{\"const\":\"initial\"}}},\"productDefectRetest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"previousTestCard\",\"testReviewDecision\",\"productDefectRemediation\"],\"properties\":{\"kind\":{\"const\":\"product-defect-retest\"},\"previousTestCard\":{\"$ref\":\"#/$defs/testCard\"},\"testReviewDecision\":{\"$ref\":\"#/$defs/testReviewDecision\"},\"productDefectRemediation\":{\"$ref\":\"#/$defs/productDefectRemediation\"}}},\"testCard\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"testCardId\",\"testCardDigest\"],\"properties\":{\"testCardId\":{\"type\":\"string\",\"pattern\":\"^test-card_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"testCardDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"testReviewDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetReviewDecisionId\",\"decisionDigest\"],\"properties\":{\"targetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"decisionDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"productDefectRemediation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"productDefectRemediationId\",\"authorizationDigest\"],\"properties\":{\"productDefectRemediationId\":{\"type\":\"string\",\"pattern\":\"^product-defect-remediation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"authorizationDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}}}}");
