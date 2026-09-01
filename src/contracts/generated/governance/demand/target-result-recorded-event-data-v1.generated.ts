/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/target-result-recorded-event-data-v1.schema.json
 */

/**
 * Wakeflow从当前TaskPackage与Host Effect Event authority补齐的不可变implementation或Test TargetResult。
 */
export type WakeflowTargetResult = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowTargetResult"
schemaVersion: 1
workType: ("implementation" | "test")
targetResultId: string
programId: string
demandId: string
targetTaskId: string
targetDeliveryId: string
taskPackage: TaskPackage
assignment: (ImplementationAssignment | TestAssignment)
hostEffect: HostEffect
report: (WakeflowImplementationTargetResultReport | WakeflowTestTargetResultReport)
testExecution?: TestExecution
resultDigest: WakeflowSha256DigestText
})
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
export type RepositoryChange = ({
[k: string]: unknown | undefined
} & {
repositoryId: string
disposition: ("committed" | "left-uncommitted" | "no-changes")
/**
 * @maxItems 64
 */
commits: WakeflowGitObjectId[]
})
/**
 * Git完整对象身份及其显式对象格式；支持SHA-1和SHA-256仓库。
 */
export type WakeflowGitObjectId = (Sha1 | Sha256)
/**
 * Test Agent对一次logical Test attempt提交的严格逐步执行结果陈述。
 */
export type WakeflowTestTargetResultReport = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowTestTargetResultReport"
schemaVersion: 1
outcome: ("completed" | "blocked" | "needs-review")
summary: string
/**
 * @maxItems 64
 */
evidenceLocators: EvidenceLocator1[]
/**
 * @maxItems 64
 */
verification: string[]
/**
 * @maxItems 64
 */
risks: string[]
/**
 * @maxItems 32
 */
stepEvidence: StepEvidence[]
reportedAt: WakeflowUtcInstantText
reportDigest: WakeflowSha256DigestText
})

/**
 * result.target-result-recorded persisted event v1 的严格 payload。
 */
export interface WakeflowTargetResultRecordedEventDataV1 {
result: WakeflowTargetResult
}
export interface TaskPackage {
taskPackageId: string
ref: WakeflowPortableResourcePathText
digest: WakeflowSha256DigestText
}
export interface ImplementationAssignment {
repositoryId: string
windowId: string
}
export interface TestAssignment {
windowId: string
}
export interface HostEffect {
actionId: string
claimDigest: WakeflowSha256DigestText
claimEventId: string
claimCommitId: string
observationDigest: WakeflowSha256DigestText
disposition: ("accepted" | "indeterminate")
readbackStatus: ("confirmed" | "pending" | "unavailable")
observedEventId: string
observedAt: WakeflowUtcInstantText
}
/**
 * 目标Agent对一个implementation Target Task提交的严格业务结果陈述。
 */
export interface WakeflowImplementationTargetResultReport {
kind: "WakeflowImplementationTargetResultReport"
schemaVersion: 1
outcome: ("completed" | "blocked" | "needs-review")
summary: string
repositoryChange: RepositoryChange
/**
 * @maxItems 64
 */
evidenceLocators: EvidenceLocator[]
/**
 * @maxItems 64
 */
verification: string[]
/**
 * @maxItems 64
 */
risks: string[]
/**
 * @maxItems 32
 */
anchorEvidence: AnchorEvidence[]
reportedAt: WakeflowUtcInstantText
reportDigest: WakeflowSha256DigestText
}
export interface Sha1 {
algorithm: "sha1"
value: string
}
export interface Sha256 {
algorithm: "sha256"
value: string
}
export interface EvidenceLocator {
kind: string
ref: WakeflowPortableResourcePathText
digest: WakeflowSha256DigestText
}
export interface AnchorEvidence {
anchorId: string
/**
 * @minItems 1
 * @maxItems 32
 */
evidenceRefs: [EvidenceRef, ...(EvidenceRef)[]]
}
export interface EvidenceRef {
ref: WakeflowPortableResourcePathText
digest: WakeflowSha256DigestText
}
export interface EvidenceLocator1 {
kind: string
ref: WakeflowPortableResourcePathText
digest: WakeflowSha256DigestText
}
export interface StepEvidence {
planIndex: number
step: string
evidence: EvidenceRef1
}
export interface EvidenceRef1 {
ref: WakeflowPortableResourcePathText
digest: WakeflowSha256DigestText
}
export interface TestExecution {
testAttemptId: string
testCard: {
testCardId: string
testCardDigest: WakeflowSha256DigestText
}
testDispatchPacketDigest: WakeflowSha256DigestText
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
export const WAKEFLOW_TARGET_RESULT_RECORDED_EVENT_DATA_V1_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-sourcing:target-result-recorded-data:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TARGET_RESULT_RECORDED_EVENT_DATA_V1_SCHEMA\",\"title\":\"WakeflowTargetResultRecordedEventDataV1\",\"description\":\"result.target-result-recorded persisted event v1 的严格 payload。\",\"$comment\":\"完整TargetResult是目标窗口陈述与Wakeflow authority闭合后的review输入；事件不表示Controller已经接受结果。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"result\"],\"properties\":{\"result\":{\"$ref\":\"urn:wakeflow:governance:result:target-result:v1\"}}}");
