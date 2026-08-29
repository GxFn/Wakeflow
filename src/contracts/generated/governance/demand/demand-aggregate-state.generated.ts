/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/demand-aggregate-state.schema.json
 */

export type DemandId = string

/**
 * 由 Demand domain event reducer 唯一生成的最小业务 Aggregate state。
 */
export interface WakeflowDemandAggregateState {
artifactKind: "wakeflow-demand-aggregate-state"
schemaVersion: 1
demandId: DemandId
lifecycle: ("active" | "completed" | "cancelled")
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
export const WAKEFLOW_DEMAND_AGGREGATE_STATE_SCHEMA = freezeGeneratedSchema({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:wakeflow:governance:demand:aggregate-state:v1",
  "x-wakeflow-runtime-export": "WAKEFLOW_DEMAND_AGGREGATE_STATE_SCHEMA",
  "title": "WakeflowDemandAggregateState",
  "description": "由 Demand domain event reducer 唯一生成的最小业务 Aggregate state。",
  "$comment": "stream revision、event tail 与 snapshot metadata 不进入本状态；未实现的 Tasking、Delivery、Result、Testing、Review、Evidence 与 Pod 领域不会以空占位字段提前进入状态模型。",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "artifactKind",
    "schemaVersion",
    "demandId",
    "lifecycle"
  ],
  "properties": {
    "artifactKind": {
      "const": "wakeflow-demand-aggregate-state"
    },
    "schemaVersion": {
      "const": 1
    },
    "demandId": {
      "$ref": "#/$defs/demandId"
    },
    "lifecycle": {
      "enum": [
        "active",
        "completed",
        "cancelled"
      ]
    }
  },
  "$defs": {
    "demandId": {
      "type": "string",
      "pattern": "^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    }
  }
} as const);
