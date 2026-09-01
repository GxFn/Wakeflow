/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/result/test-target-result-report.schema.json
 */

/**
 * Test Agent对一次logical Test attempt提交的严格逐步执行结果陈述。
 */
export type WakeflowTestTargetResultReport = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowTestTargetResultReport"
schemaVersion: 1
outcome: ("completed" | "blocked" | "needs-review")
summary: HumanText
/**
 * @maxItems 64
 */
evidenceLocators: EvidenceLocator[]
/**
 * @maxItems 64
 */
verification: HumanText[]
/**
 * @maxItems 64
 */
risks: HumanText[]
/**
 * @maxItems 32
 */
stepEvidence: StepEvidence[]
reportedAt: WakeflowUtcInstantText
reportDigest: WakeflowSha256DigestText
})
export type HumanText = string
export type Token = string
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string

export interface EvidenceLocator {
kind: Token
ref: WakeflowPortableResourcePathText
digest: WakeflowSha256DigestText
}
export interface StepEvidence {
planIndex: number
step: HumanText
evidence: EvidenceRef
}
export interface EvidenceRef {
ref: WakeflowPortableResourcePathText
digest: WakeflowSha256DigestText
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
export const WAKEFLOW_TEST_TARGET_RESULT_REPORT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:result:test-target-result-report:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TEST_TARGET_RESULT_REPORT_SCHEMA\",\"title\":\"WakeflowTestTargetResultReport\",\"description\":\"Test Agent对一次logical Test attempt提交的严格逐步执行结果陈述。\",\"$comment\":\"Report只记录approved plan步骤的执行陈述与可定位Evidence；completed表示该Agent完成了当前批准步骤，不表示测试通过、implementation已接受或Demand完成。Report不包含repository change、acceptance anchor、runner通用输出、transport、Claim或Controller判断。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"outcome\",\"summary\",\"evidenceLocators\",\"verification\",\"risks\",\"stepEvidence\",\"reportedAt\",\"reportDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTestTargetResultReport\"},\"schemaVersion\":{\"const\":1},\"outcome\":{\"enum\":[\"completed\",\"blocked\",\"needs-review\"]},\"summary\":{\"$ref\":\"#/$defs/humanText\"},\"evidenceLocators\":{\"type\":\"array\",\"maxItems\":64,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/evidenceLocator\"}},\"verification\":{\"type\":\"array\",\"maxItems\":64,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/humanText\"}},\"risks\":{\"type\":\"array\",\"maxItems\":64,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/humanText\"}},\"stepEvidence\":{\"type\":\"array\",\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/stepEvidence\"}},\"reportedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"reportDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}},\"allOf\":[{\"if\":{\"properties\":{\"outcome\":{\"const\":\"completed\"}},\"required\":[\"outcome\"]},\"then\":{\"properties\":{\"stepEvidence\":{\"type\":\"array\",\"minItems\":1}}}}],\"$defs\":{\"token\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$\"},\"humanText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"evidenceLocator\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"ref\",\"digest\"],\"properties\":{\"kind\":{\"$ref\":\"#/$defs/token\"},\"ref\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"digest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"evidenceRef\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"ref\",\"digest\"],\"properties\":{\"ref\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"digest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"stepEvidence\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"planIndex\",\"step\",\"evidence\"],\"properties\":{\"planIndex\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":31},\"step\":{\"$ref\":\"#/$defs/humanText\"},\"evidence\":{\"$ref\":\"#/$defs/evidenceRef\"}}}}}");
