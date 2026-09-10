/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-demand-cancellation-request.schema.json
 */

/**
 * wakeflow_cancel_demand 的请求：取消任何非终态 Demand。preview 零写；apply 带 planDigest 在一个事务里写取消事件、封归档包、释放本 Demand 的窗口工作声明、撤回需求包、删活动根；有待评审结果时拒绝。recover 带 operationId（即 demandId）。
 */
export type WakeflowDemandCancellationRequestV1 = (EffectRequest | RecoverRequest)
/**
 * Absolute path of the existing Wakeflow workspace root; never returned.
 */
export type WorkspaceRoot = string
export type Sha256Digest = string
export type DemandId = string
export type Text = string

export interface EffectRequest {
root: WorkspaceRoot
mode: ("preview" | "apply")
planDigest?: Sha256Digest
demandId: DemandId
reason: Text
}
export interface RecoverRequest {
root: WorkspaceRoot
mode: "recover"
operationId: DemandId
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
export const WAKEFLOW_DEMAND_CANCELLATION_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:demand-cancellation-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_CANCELLATION_REQUEST_SCHEMA\",\"title\":\"WakeflowDemandCancellationRequestV1\",\"description\":\"wakeflow_cancel_demand 的请求：取消任何非终态 Demand。preview 零写；apply 带 planDigest 在一个事务里写取消事件、封归档包、释放本 Demand 的窗口工作声明、撤回需求包、删活动根；有待评审结果时拒绝。recover 带 operationId（即 demandId）。\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/effectRequest\"},{\"$ref\":\"#/$defs/recoverRequest\"}],\"$defs\":{\"effectRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"demandId\",\"reason\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"enum\":[\"preview\",\"apply\"]},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"reason\":{\"$ref\":\"#/$defs/text\"}}},\"recoverRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"operationId\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"const\":\"recover\"},\"operationId\":{\"$ref\":\"#/$defs/demandId\"}}},\"workspaceRoot\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root; never returned.\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"text\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"}}}");
