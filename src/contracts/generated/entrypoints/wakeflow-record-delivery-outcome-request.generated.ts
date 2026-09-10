/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-record-delivery-outcome-request.schema.json
 */

export type DemandId = string
export type DeliveryId = string
export type Sha256Digest = string
export type UtcInstant = string

/**
 * Record the outcome of one delivery generation: Wakeflow derives accepted, indeterminate, or rejected-before-send from host hook records and the Agent declaration.
 */
export interface WakeflowRecordDeliveryOutcomeRequestV1 {
/**
 * Absolute path of the existing Wakeflow workspace root.
 */
root: string
demandId: DemandId
/**
 * Client-generated key binding this request to at most one commit.
 */
idempotencyKey: string
/**
 * Demand stream revision the caller observed; a stale value is rejected.
 */
expectedStreamRevision: number
deliveryId: DeliveryId
claimDigest: Sha256Digest
attempt: Attempt
readback?: Readback
resolution?: Resolution
observedAt: UtcInstant
}
/**
 * Agent 对发送调用本身的声明：sent 已送出、failed-before-send 调用失败且未触碰目标会话、unknown 结果未知。
 */
export interface Attempt {
status: ("sent" | "failed-before-send" | "unknown")
evidenceDigest?: Sha256Digest
}
/**
 * 补充回读观察：缺失或超时不降级。
 */
export interface Readback {
status: ("confirmed" | "pending" | "unavailable")
evidenceDigest?: Sha256Digest
}
/**
 * Controller 对 indeterminate 投递的显式解决（能力卡 6 Q3）：accepted 必须引用目标会话 issuedAt 之后的一条 hook 记录。
 */
export interface Resolution {
disposition: ("accepted" | "rejected-before-send")
hookRecordId?: string
rationale: string
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
export const WAKEFLOW_RECORD_DELIVERY_OUTCOME_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:record-delivery-outcome-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_RECORD_DELIVERY_OUTCOME_REQUEST_SCHEMA\",\"title\":\"WakeflowRecordDeliveryOutcomeRequestV1\",\"description\":\"Record the outcome of one delivery generation: Wakeflow derives accepted, indeterminate, or rejected-before-send from host hook records and the Agent declaration.\",\"$comment\":\"accepted comes only from the target session user-prompt-submit hook record whose prompt digest matches the envelope, a Codex host send-call success return, or an explicit Controller resolution; rejected-before-send only when the send call failed without touching the session.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"demandId\",\"idempotencyKey\",\"expectedStreamRevision\",\"deliveryId\",\"claimDigest\",\"attempt\",\"observedAt\"],\"properties\":{\"root\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"idempotencyKey\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9._:-]+$\",\"description\":\"Client-generated key binding this request to at most one commit.\"},\"expectedStreamRevision\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":9007199254740991,\"description\":\"Demand stream revision the caller observed; a stale value is rejected.\"},\"deliveryId\":{\"$ref\":\"#/$defs/deliveryId\"},\"claimDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"attempt\":{\"$ref\":\"#/$defs/attempt\"},\"readback\":{\"$ref\":\"#/$defs/readback\"},\"resolution\":{\"$ref\":\"#/$defs/resolution\"},\"observedAt\":{\"$ref\":\"#/$defs/utcInstant\"}},\"$defs\":{\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"deliveryId\":{\"type\":\"string\",\"pattern\":\"^target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"claimId\":{\"type\":\"string\",\"pattern\":\"^work-claim_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"eventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"commitId\":{\"type\":\"string\",\"pattern\":\"^demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"bindingId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$\"},\"attempt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\"],\"description\":\"Agent 对发送调用本身的声明：sent 已送出、failed-before-send 调用失败且未触碰目标会话、unknown 结果未知。\",\"properties\":{\"status\":{\"enum\":[\"sent\",\"failed-before-send\",\"unknown\"]},\"evidenceDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"readback\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\"],\"description\":\"补充回读观察：缺失或超时不降级。\",\"properties\":{\"status\":{\"enum\":[\"confirmed\",\"pending\",\"unavailable\"]},\"evidenceDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"resolution\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"disposition\",\"rationale\"],\"description\":\"Controller 对 indeterminate 投递的显式解决（能力卡 6 Q3）：accepted 必须引用目标会话 issuedAt 之后的一条 hook 记录。\",\"properties\":{\"disposition\":{\"enum\":[\"accepted\",\"rejected-before-send\"]},\"hookRecordId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":256,\"pattern\":\"^[A-Za-z0-9._:-]{1,256}$\"},\"rationale\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":2048,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"}}}}}");
