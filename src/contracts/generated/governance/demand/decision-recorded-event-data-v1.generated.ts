/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/decision-recorded-event-data-v1.schema.json
 */

/**
 * lifecycle.decision-recorded persisted event v1 的严格 payload：用户对一次升级的回答。
 */
export interface WakeflowDecisionRecordedEventDataV1 {
decision: {
escalationEventId: string
text: string
chosenOption: (null | string)
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
export const WAKEFLOW_DECISION_RECORDED_EVENT_DATA_V1_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:event-sourcing:decision-recorded-data:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DECISION_RECORDED_EVENT_DATA_V1_SCHEMA\",\"title\":\"WakeflowDecisionRecordedEventDataV1\",\"description\":\"lifecycle.decision-recorded persisted event v1 的严格 payload：用户对一次升级的回答。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"decision\"],\"properties\":{\"decision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"escalationEventId\",\"text\",\"chosenOption\"],\"properties\":{\"escalationEventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"text\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"chosenOption\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"minLength\":1,\"maxLength\":1024,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"}]}}}}}");
