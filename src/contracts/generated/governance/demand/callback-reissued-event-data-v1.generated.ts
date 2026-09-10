/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/callback-reissued-event-data-v1.schema.json
 */

/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string

/**
 * result.callback-reissued persisted event v1 的严格 payload：同一结果的 wake-controller 回调按当前 Controller 绑定重发一代。
 */
export interface WakeflowCallbackReissuedEventDataV1 {
reissue: {
targetResultId: string
callbackId: string
previousGeneration: number
generation: number
controllerWindowId: string
bindingId: string
bindingDigest: WakeflowSha256DigestText
promptDigest: WakeflowSha256DigestText
issuedAt: WakeflowUtcInstantText
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
export const WAKEFLOW_CALLBACK_REISSUED_EVENT_DATA_V1_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-sourcing:callback-reissued-data:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_CALLBACK_REISSUED_EVENT_DATA_V1_SCHEMA\",\"title\":\"WakeflowCallbackReissuedEventDataV1\",\"description\":\"result.callback-reissued persisted event v1 的严格 payload：同一结果的 wake-controller 回调按当前 Controller 绑定重发一代。\",\"$comment\":\"回调不取工作声明；代际上限 4（三次重发）；prompt 内容不变，绑定按当前 Controller 窗口重算。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"reissue\"],\"properties\":{\"reissue\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"targetResultId\",\"callbackId\",\"previousGeneration\",\"generation\",\"controllerWindowId\",\"bindingId\",\"bindingDigest\",\"promptDigest\",\"issuedAt\"],\"properties\":{\"targetResultId\":{\"type\":\"string\",\"pattern\":\"^target-result_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"callbackId\":{\"type\":\"string\",\"pattern\":\"^target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"previousGeneration\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":3},\"generation\":{\"type\":\"integer\",\"minimum\":2,\"maximum\":4},\"controllerWindowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"bindingId\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$\"},\"bindingDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"promptDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"issuedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"}}}}}");
