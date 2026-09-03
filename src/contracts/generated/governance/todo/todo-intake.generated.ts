/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/todo/todo-intake.schema.json
 */

export type ProgramId = string
/**
 * TODO intake 使用的 Wakeflow 持久类型化身份；由 owner 分配，不从标题、路径、时间或集合位置推导。
 */
export type WakeflowTodoItemIdText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string
export type WindowId = string
export type NonEmptyText = string
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
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string

/**
 * TODO 条目创建后不可变的 Demand 前调度接收权威；Ledger 来源、初始就绪条件与调度策略在创建时冻结。
 */
export interface WakeflowTodoIntake {
artifactKind: "wakeflow-todo-intake"
schemaVersion: 1
programId: ProgramId
todoId: WakeflowTodoItemIdText
createdAt: WakeflowUtcInstantText
demandType: ("requirement" | "bug" | "supplement" | "research")
priority: ("P0" | "P1" | "P2" | "P3")
originWindowId: WindowId
controllerWindowId: WindowId
summary: NonEmptyText
intakeRationale: NonEmptyText
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
export const WAKEFLOW_TODO_INTAKE_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:todo:intake:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_TODO_INTAKE_SCHEMA\",\"title\":\"WakeflowTodoIntake\",\"description\":\"TODO 条目创建后不可变的 Demand 前调度接收权威；Ledger 来源、初始就绪条件与调度策略在创建时冻结。\",\"$comment\":\"Schema 负责可移植数据结构；类型化标识、Ledger 引用排序与角色闭包、Config 窗口关系、就绪状态与自动领取策略、测试环境关系分别由 TODO Intake 编解码器及后续规划层继续验证。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"programId\",\"todoId\",\"createdAt\",\"demandType\",\"priority\",\"originWindowId\",\"controllerWindowId\",\"summary\",\"intakeRationale\",\"readiness\",\"autoClaim\",\"testingDecision\",\"authorityRefs\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-todo-intake\"},\"schemaVersion\":{\"const\":1},\"programId\":{\"$ref\":\"#/$defs/programId\"},\"todoId\":{\"$ref\":\"urn:wakeflow:governance:todo:item-id:v1\"},\"createdAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"demandType\":{\"enum\":[\"requirement\",\"bug\",\"supplement\",\"research\"]},\"priority\":{\"enum\":[\"P0\",\"P1\",\"P2\",\"P3\"]},\"originWindowId\":{\"$ref\":\"#/$defs/windowId\"},\"controllerWindowId\":{\"$ref\":\"#/$defs/windowId\"},\"summary\":{\"$ref\":\"#/$defs/nonEmptyText\"},\"intakeRationale\":{\"$ref\":\"#/$defs/nonEmptyText\"},\"readiness\":{\"oneOf\":[{\"$ref\":\"#/$defs/readyReadiness\"},{\"$ref\":\"#/$defs/parkedReadiness\"}]},\"autoClaim\":{\"type\":\"boolean\"},\"testingDecision\":{\"$ref\":\"#/$defs/testingDecision\"},\"authorityRefs\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"uniqueItems\":true,\"items\":{\"$ref\":\"urn:wakeflow:governance:ledger:authority-member-reference:v1\"}}},\"$defs\":{\"nonEmptyText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"readyReadiness\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\"],\"properties\":{\"status\":{\"const\":\"ready\"}}},\"parkedReadiness\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"trigger\"],\"properties\":{\"status\":{\"const\":\"parked\"},\"trigger\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":4096,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"}}},\"testingDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"mode\",\"summary\",\"environmentMemberRef\"],\"properties\":{\"mode\":{\"enum\":[\"controller-only\",\"real-environment\",\"not-applicable\"]},\"summary\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":4096,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"environmentMemberRef\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"}]}}}}}");
