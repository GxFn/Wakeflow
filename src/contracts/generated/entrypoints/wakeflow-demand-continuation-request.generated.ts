/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-demand-continuation-request.schema.json
 */

/**
 * wakeflow_continue_demand 的请求：continue 从归档重开一个已完成的 Demand（续接谱系 optimization、requirement-supplement 或 verified-bug），record-decision 记录用户对一次升级的回答；preview 零写、apply 带 planDigest；recover 带 operationId（即 demandId），只续做被中断的 continue apply。
 */
export type WakeflowDemandContinuationRequestV1 = (ContinueRequest | DecisionRequest | RecoverRequest)
/**
 * Absolute path of the existing Wakeflow workspace root; never returned.
 */
export type WorkspaceRoot = string
export type Sha256Digest = string
export type DemandId = string

export interface ContinueRequest {
root: WorkspaceRoot
mode: ("preview" | "apply")
planDigest?: Sha256Digest
demandId: DemandId
action: "continue"
continuation: {
kind: ("optimization" | "requirement-supplement" | "verified-bug")
summary: string
}
}
export interface DecisionRequest {
root: WorkspaceRoot
mode: ("preview" | "apply")
planDigest?: Sha256Digest
demandId: DemandId
action: "record-decision"
decision: {
text: string
chosenOption: (null | string)
}
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
export const WAKEFLOW_DEMAND_CONTINUATION_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:demand-continuation-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_CONTINUATION_REQUEST_SCHEMA\",\"title\":\"WakeflowDemandContinuationRequestV1\",\"description\":\"wakeflow_continue_demand 的请求：continue 从归档重开一个已完成的 Demand（续接谱系 optimization、requirement-supplement 或 verified-bug），record-decision 记录用户对一次升级的回答；preview 零写、apply 带 planDigest；recover 带 operationId（即 demandId），只续做被中断的 continue apply。\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/continueRequest\"},{\"$ref\":\"#/$defs/decisionRequest\"},{\"$ref\":\"#/$defs/recoverRequest\"}],\"$defs\":{\"continueRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"demandId\",\"action\",\"continuation\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"enum\":[\"preview\",\"apply\"]},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"action\":{\"const\":\"continue\"},\"continuation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"summary\"],\"properties\":{\"kind\":{\"enum\":[\"optimization\",\"requirement-supplement\",\"verified-bug\"]},\"summary\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":4096,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"}}}}},\"decisionRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"demandId\",\"action\",\"decision\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"enum\":[\"preview\",\"apply\"]},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"action\":{\"const\":\"record-decision\"},\"decision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"text\",\"chosenOption\"],\"properties\":{\"text\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"chosenOption\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":1024,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"}]}}}}},\"recoverRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"operationId\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"const\":\"recover\"},\"operationId\":{\"$ref\":\"#/$defs/demandId\"}}},\"workspaceRoot\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root; never returned.\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}");
