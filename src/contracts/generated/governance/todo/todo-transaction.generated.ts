/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/todo/todo-transaction.schema.json
 */

/**
 * TODO intake 使用的 Wakeflow 持久类型化身份；由 owner 分配，不从标题、路径、时间或集合位置推导。
 */
export type WakeflowTodoItemIdText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
export type NullableDigest = (null | WakeflowSha256DigestText)
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string
/**
 * 跨领域只读消费一份已验证 Ledger authority member 的完整 ref/digest 关系。
 */
export type WakeflowLedgerAuthorityMemberReference = ({
[k: string]: unknown | undefined
} & {
[k: string]: unknown | undefined
} & {
artifactKind: "wakeflow-ledger-authority-member-reference"
schemaVersion: 1
family: ("requirement" | "confirmation")
recordId: (string | string)
recordRef: WakeflowPortableResourcePathText
recordDigest: WakeflowSha256DigestText
memberPath: WakeflowPortableResourcePathText
memberRef: WakeflowPortableResourcePathText
memberDigest: WakeflowSha256DigestText
role: ("original-plan" | "requirement-design" | "code-facts" | "landing-plan" | "non-goals" | "user-confirmation" | "reproduction" | "scope" | "requirement-delta" | "research-question" | "boundaries" | "test-environment" | "supporting-evidence" | "goal-stage-decision")
mediaType: string
} & {
artifactKind: "wakeflow-ledger-authority-member-reference"
schemaVersion: 1
family: ("requirement" | "confirmation")
recordId: (string | string)
recordRef: WakeflowPortableResourcePathText
recordDigest: WakeflowSha256DigestText
memberPath: WakeflowPortableResourcePathText
memberRef: WakeflowPortableResourcePathText
memberDigest: WakeflowSha256DigestText
role: ("original-plan" | "requirement-design" | "code-facts" | "landing-plan" | "non-goals" | "user-confirmation" | "reproduction" | "scope" | "requirement-delta" | "research-question" | "boundaries" | "test-environment" | "supporting-evidence" | "goal-stage-decision")
mediaType: string
})

/**
 * TODO 条目 append、activate、withdraw、claim 或 archive 的不可变恢复计划；前序与目标摘要用于判断前向恢复、幂等重放或冲突。
 */
export interface WakeflowTodoTransaction {
artifactKind: "wakeflow-todo-transaction"
schemaVersion: 1
todoId: WakeflowTodoItemIdText
operation: ("append" | "activate" | "withdraw" | "claim" | "archive")
createdAt: WakeflowUtcInstantText
expectedCollectionDigest: WakeflowSha256DigestText
expectedIntakeDigest: NullableDigest
expectedStateDigest: NullableDigest
targetIntake: (null | WakeflowTodoIntake)
targetState: WakeflowTodoState
targetIntakeDigest: WakeflowSha256DigestText
targetStateDigest: WakeflowSha256DigestText
targetCollectionDigest: WakeflowSha256DigestText
}
/**
 * TODO 条目创建后不可变的 Demand 前调度接收权威；Ledger 来源、初始就绪条件与调度策略在创建时冻结。
 */
export interface WakeflowTodoIntake {
artifactKind: "wakeflow-todo-intake"
schemaVersion: 1
programId: string
todoId: WakeflowTodoItemIdText
createdAt: WakeflowUtcInstantText
demandType: ("requirement" | "bug" | "supplement" | "research")
priority: ("P0" | "P1" | "P2" | "P3")
originWindowId: string
controllerWindowId: string
summary: string
intakeRationale: string
readiness: (ReadyReadiness | ParkedReadiness)
autoClaim: boolean
testingDecision: TestingDecision
/**
 * @minItems 1
 * @maxItems 32
 */
authorityRefs: [WakeflowLedgerAuthorityMemberReference, ...(WakeflowLedgerAuthorityMemberReference)[]]
}
export interface ReadyReadiness {
status: "ready"
}
export interface ParkedReadiness {
status: "parked"
trigger: string
}
export interface TestingDecision {
mode: ("controller-only" | "real-environment" | "not-applicable")
summary: string
environmentMemberRef: (null | WakeflowPortableResourcePathText)
}
/**
 * TODO 条目唯一可更新的当前状态快照；修订链、Demand 挂载、撤回事实与归档回执绑定每次前向转换。
 */
export interface WakeflowTodoState {
artifactKind: "wakeflow-todo-state"
schemaVersion: 1
todoId: WakeflowTodoItemIdText
revision: number
previousStateDigest: (null | WakeflowSha256DigestText)
status: ("pending-claim" | "parked" | "claimed" | "withdrawn" | "archived")
updatedAt: WakeflowUtcInstantText
mount: (null | DemandMount)
withdrawal: (null | Withdrawal)
archive: (null | ArchiveReceipt)
}
export interface DemandMount {
demandId: string
stateRootRef: WakeflowPortableResourcePathText
identityDigest: WakeflowSha256DigestText
}
export interface Withdrawal {
reason: string
withdrawnAt: WakeflowUtcInstantText
}
export interface ArchiveReceipt {
artifactKind: "wakeflow-business-archive-receipt"
schemaVersion: 1
archiveId: string
demandId: string
todoId: WakeflowTodoItemIdText
intakeDigest: WakeflowSha256DigestText
claimedStateDigest: WakeflowSha256DigestText
manifestDigest: WakeflowSha256DigestText
archivedAt: WakeflowUtcInstantText
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
export const WAKEFLOW_TODO_TRANSACTION_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:todo:transaction:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TODO_TRANSACTION_SCHEMA\",\"title\":\"WakeflowTodoTransaction\",\"description\":\"TODO 条目 append、activate、withdraw、claim 或 archive 的不可变恢复计划；前序与目标摘要用于判断前向恢复、幂等重放或冲突。\",\"$comment\":\"Journal 不保存可变阶段。操作与目标状态关系由 Transaction codec 校验；源状态授权、磁盘效果顺序、锁、投影发布和精确退休由 TODO Collection owner 负责。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"todoId\",\"operation\",\"createdAt\",\"expectedCollectionDigest\",\"expectedIntakeDigest\",\"expectedStateDigest\",\"targetIntake\",\"targetState\",\"targetIntakeDigest\",\"targetStateDigest\",\"targetCollectionDigest\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-todo-transaction\"},\"schemaVersion\":{\"const\":1},\"todoId\":{\"$ref\":\"urn:wakeflow:governance:todo:item-id:v1\"},\"operation\":{\"enum\":[\"append\",\"activate\",\"withdraw\",\"claim\",\"archive\"]},\"createdAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"expectedCollectionDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"expectedIntakeDigest\":{\"$ref\":\"#/$defs/nullableDigest\"},\"expectedStateDigest\":{\"$ref\":\"#/$defs/nullableDigest\"},\"targetIntake\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"urn:wakeflow:governance:todo:intake:v1\"}]},\"targetState\":{\"$ref\":\"urn:wakeflow:governance:todo:state:v1\"},\"targetIntakeDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"targetStateDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"targetCollectionDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}},\"$defs\":{\"nullableDigest\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}]}}}");
