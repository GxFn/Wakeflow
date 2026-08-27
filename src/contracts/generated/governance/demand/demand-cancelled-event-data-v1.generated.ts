/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/demand-cancelled-event-data-v1.schema.json
 */

/**
 * lifecycle.demand-cancelled persisted event v1 的严格 payload。
 */
export interface WakeflowDemandCancelledEventDataV1 {
reason: string
}

/** 递归冻结生成的 Schema，阻止校验器首次使用前发生嵌套漂移。 */
function freezeGeneratedSchema<Value>(value: Value): Readonly<Value> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeGeneratedSchema(child);
    Object.freeze(value);
  }
  return value;
}

/** Ajv 严格校验器使用的 Schema 派生运行时权威；不得手工修改。 */
export const WAKEFLOW_DEMAND_CANCELLED_EVENT_DATA_V1_SCHEMA = freezeGeneratedSchema({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:wakeflow:governance:demand:event-sourcing:demand-cancelled-data:v1",
  "x-wakeflow-runtime-export": "WAKEFLOW_DEMAND_CANCELLED_EVENT_DATA_V1_SCHEMA",
  "title": "WakeflowDemandCancelledEventDataV1",
  "description": "lifecycle.demand-cancelled persisted event v1 的严格 payload。",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "reason"
  ],
  "properties": {
    "reason": {
      "type": "string",
      "minLength": 1,
      "maxLength": 8192,
      "pattern": "^(?!\\s)[\\s\\S]*\\S$"
    }
  }
} as const);
