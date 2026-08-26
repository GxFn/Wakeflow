/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/demand-aggregate-state.schema.json
 */

export type DemandId = string
/**
 * @maxItems 0
 */
export type EmptyFacts = []

/**
 * 由 Demand domain event reducer 唯一生成的纯业务 Aggregate state。
 */
export interface WakeflowDemandAggregateState {
artifactKind: "wakeflow-demand-aggregate-state"
schemaVersion: 1
demandId: DemandId
lifecycle: ("active" | "completed" | "cancelled")
tasking: Tasking
delivery: Delivery
result: Result
testing: Testing
review: Review
evidence: Evidence
pod: null
}
export interface Tasking {
taskPackages: EmptyFacts
targetTasks: EmptyFacts
}
export interface Delivery {
currentDeliveries: EmptyFacts
}
export interface Result {
currentResults: EmptyFacts
}
export interface Testing {
testCards: EmptyFacts
testAttempts: EmptyFacts
}
export interface Review {
pendingCandidate: null
}
export interface Evidence {
items: EmptyFacts
}

/** 递归冻结生成的 Schema，阻止 validator 首次消费前发生嵌套漂移。 */
function freezeGeneratedSchema<Value>(value: Value): Readonly<Value> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeGeneratedSchema(child);
    Object.freeze(value);
  }
  return value;
}

/** Ajv strict validator 使用的 Schema 派生运行时权威；不得手工修改。 */
export const WAKEFLOW_DEMAND_AGGREGATE_STATE_SCHEMA = freezeGeneratedSchema({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:wakeflow:governance:demand:aggregate-state:v1",
  "x-wakeflow-runtime-export": "WAKEFLOW_DEMAND_AGGREGATE_STATE_SCHEMA",
  "title": "WakeflowDemandAggregateState",
  "description": "由 Demand domain event reducer 唯一生成的纯业务 Aggregate state。",
  "$comment": "stream revision、event tail 与 snapshot metadata 不进入本状态；RH-2 只允许零业务成员，后续 Owner 垂直切片再扩展对应关闭 section。",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "artifactKind",
    "schemaVersion",
    "demandId",
    "lifecycle",
    "tasking",
    "delivery",
    "result",
    "testing",
    "review",
    "evidence",
    "pod"
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
    },
    "tasking": {
      "$ref": "#/$defs/tasking"
    },
    "delivery": {
      "$ref": "#/$defs/delivery"
    },
    "result": {
      "$ref": "#/$defs/result"
    },
    "testing": {
      "$ref": "#/$defs/testing"
    },
    "review": {
      "$ref": "#/$defs/review"
    },
    "evidence": {
      "$ref": "#/$defs/evidence"
    },
    "pod": {
      "type": "null"
    }
  },
  "$defs": {
    "demandId": {
      "type": "string",
      "pattern": "^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    },
    "emptyFacts": {
      "type": "array",
      "maxItems": 0
    },
    "tasking": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "taskPackages",
        "targetTasks"
      ],
      "properties": {
        "taskPackages": {
          "$ref": "#/$defs/emptyFacts"
        },
        "targetTasks": {
          "$ref": "#/$defs/emptyFacts"
        }
      }
    },
    "delivery": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "currentDeliveries"
      ],
      "properties": {
        "currentDeliveries": {
          "$ref": "#/$defs/emptyFacts"
        }
      }
    },
    "result": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "currentResults"
      ],
      "properties": {
        "currentResults": {
          "$ref": "#/$defs/emptyFacts"
        }
      }
    },
    "testing": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "testCards",
        "testAttempts"
      ],
      "properties": {
        "testCards": {
          "$ref": "#/$defs/emptyFacts"
        },
        "testAttempts": {
          "$ref": "#/$defs/emptyFacts"
        }
      }
    },
    "review": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "pendingCandidate"
      ],
      "properties": {
        "pendingCandidate": {
          "type": "null"
        }
      }
    },
    "evidence": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "items"
      ],
      "properties": {
        "items": {
          "$ref": "#/$defs/emptyFacts"
        }
      }
    }
  }
} as const);
