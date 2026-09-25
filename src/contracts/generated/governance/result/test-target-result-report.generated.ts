/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/result/test-target-result-report.schema.json
 */

/**
 * Test Agent 按测试合同逐步记录的执行结果陈述：每步 observed、证据、verdict 与失败分类；整体 verdict 由 Wakeflow 从步骤派生。
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
reportedAt: WakeflowUtcInstantText
reportDigest: WakeflowSha256DigestText
/**
 * @maxItems 20
 */
steps: []|[Step]|[Step, Step]|[Step, Step, Step]|[Step, Step, Step, Step]|[Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]|[Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step, Step]
verdict: Verdict
})
export type HumanText = string
export type EvidenceKind = ("hook-observation" | "transcript" | "test-output" | "diff" | "document" | "link" | "commit")
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
export type Step = ({
[k: string]: unknown | undefined
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
} & {
stepId: StepId
observed: HumanText
evidence: EvidenceRef
verdict: ("pass" | "fail" | "blocked" | "cannot-conclude")
failure?: Failure
})
export type StepId = string
export type Verdict = ("pass" | "fail" | "blocked" | "cannot-conclude")

export interface EvidenceLocator {
kind: EvidenceKind
ref: WakeflowPortableResourcePathText
digest: WakeflowSha256DigestText
}
export interface EvidenceRef {
ref: WakeflowPortableResourcePathText
digest: WakeflowSha256DigestText
}
export interface Failure {
classification: ("product-defect" | "harness-defect" | "environment" | "flaky" | "missing-evidence" | "out-of-scope" | "needs-decision")
likelyOwner: ("implementation" | "test" | "environment" | "user")
recommendedAction: HumanText
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
export const WAKEFLOW_TEST_TARGET_RESULT_REPORT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:result:test-target-result-report:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TEST_TARGET_RESULT_REPORT_SCHEMA\",\"title\":\"WakeflowTestTargetResultReport\",\"description\":\"Test Agent 按测试合同逐步记录的执行结果陈述：每步 observed、证据、verdict 与失败分类；整体 verdict 由 Wakeflow 从步骤派生。\",\"$comment\":\"Report 只陈述做了什么与证据在哪里；verdict 由步骤派生（无步骤即 cannot-conclude，含 fail 即 fail，否则含 blocked 即 blocked，否则含 cannot-conclude 即 cannot-conclude，否则 pass）；非 pass 步骤必带 failure（classification、likelyOwner、recommendedAction）（ADR-0012 D4）。真伪仍由 Controller 判断。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"outcome\",\"summary\",\"evidenceLocators\",\"verification\",\"risks\",\"steps\",\"verdict\",\"reportedAt\",\"reportDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowTestTargetResultReport\"},\"schemaVersion\":{\"const\":1},\"outcome\":{\"enum\":[\"completed\",\"blocked\",\"needs-review\"]},\"summary\":{\"$ref\":\"#/$defs/humanText\"},\"evidenceLocators\":{\"type\":\"array\",\"maxItems\":64,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/evidenceLocator\"}},\"verification\":{\"type\":\"array\",\"maxItems\":64,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/humanText\"}},\"risks\":{\"type\":\"array\",\"maxItems\":64,\"uniqueItems\":true,\"items\":{\"$ref\":\"#/$defs/humanText\"}},\"reportedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"reportDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"steps\":{\"type\":\"array\",\"maxItems\":20,\"items\":{\"$ref\":\"#/$defs/step\"}},\"verdict\":{\"$ref\":\"#/$defs/verdict\"}},\"allOf\":[{\"if\":{\"properties\":{\"outcome\":{\"const\":\"completed\"}},\"required\":[\"outcome\"]},\"then\":{\"properties\":{\"steps\":{\"type\":\"array\",\"minItems\":1}}}},{\"if\":{\"properties\":{\"outcome\":{\"const\":\"blocked\"}},\"required\":[\"outcome\"]},\"then\":{\"properties\":{\"steps\":{\"type\":\"array\",\"items\":{\"type\":\"object\",\"properties\":{\"verdict\":{\"not\":{\"const\":\"fail\"}}}}}}}}],\"$defs\":{\"humanText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\"},\"evidenceLocator\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"ref\",\"digest\"],\"properties\":{\"kind\":{\"$ref\":\"#/$defs/evidenceKind\"},\"ref\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"digest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"evidenceRef\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"ref\",\"digest\"],\"properties\":{\"ref\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"digest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}},\"stepId\":{\"type\":\"string\",\"pattern\":\"^ts-[1-9][0-9]?$\"},\"evidenceKind\":{\"enum\":[\"hook-observation\",\"transcript\",\"test-output\",\"diff\",\"document\",\"link\",\"commit\"]},\"failure\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"classification\",\"likelyOwner\",\"recommendedAction\"],\"properties\":{\"classification\":{\"enum\":[\"product-defect\",\"harness-defect\",\"environment\",\"flaky\",\"missing-evidence\",\"out-of-scope\",\"needs-decision\"]},\"likelyOwner\":{\"enum\":[\"implementation\",\"test\",\"environment\",\"user\"]},\"recommendedAction\":{\"$ref\":\"#/$defs/humanText\"}}},\"step\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"stepId\",\"observed\",\"evidence\",\"verdict\"],\"properties\":{\"stepId\":{\"$ref\":\"#/$defs/stepId\"},\"observed\":{\"$ref\":\"#/$defs/humanText\"},\"evidence\":{\"$ref\":\"#/$defs/evidenceRef\"},\"verdict\":{\"enum\":[\"pass\",\"fail\",\"blocked\",\"cannot-conclude\"]},\"failure\":{\"$ref\":\"#/$defs/failure\"}},\"allOf\":[{\"if\":{\"properties\":{\"verdict\":{\"const\":\"pass\"}},\"required\":[\"verdict\"]},\"then\":{\"properties\":{\"failure\":false}},\"else\":{\"required\":[\"failure\"],\"properties\":{\"failure\":{\"$ref\":\"#/$defs/failure\"}}}}]},\"verdict\":{\"enum\":[\"pass\",\"fail\",\"blocked\",\"cannot-conclude\"]}}}");
