/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-maintenance-public-request.schema.json
 */

/**
 * Closed MCP input contract for previewing, applying, or recovering one Wakeflow workspace Maintenance operation. Nested domain values are revalidated by their owning domain modules.
 */
export type WakeflowMaintenancePublicRequestV1 = (FreshPreviewRequest | ReconfigurePreviewRequest | ReconcilePreviewRequest | ApplyRequest | RecoverRequest)
/**
 * Absolute path of the existing workspace root. Physical root validation remains owned by RootedDirectory.
 */
export type Root = string
/**
 * A passive JSON value. The receiving domain owner applies its narrower contract.
 */
export type JsonValue = (null | boolean | number | string | JsonValue[] | {
[k: string]: JsonValue
})
/**
 * Lowercase SHA-256 digest of the exact confirmation returned by preview.
 */
export type Sha256Digest = string
/**
 * Typed identifier of one prepared Maintenance transaction.
 */
export type MaintenanceOperationId = string

export interface FreshPreviewRequest {
root: Root
action: "fresh-initialize"
mode: "preview"
request: {
/**
 * Fresh user selection compiled by the Configuration owner into a typed Config v3 model.
 */
selection: (null | boolean | number | string | JsonValue[] | {
[k: string]: JsonValue
})
}
}
export interface ReconfigurePreviewRequest {
root: Root
action: "reconfigure"
mode: "preview"
request: {
/**
 * A passive JSON value. The receiving domain owner applies its narrower contract.
 */
desiredConfig: (null | boolean | number | string | JsonValue[] | {
[k: string]: JsonValue
})
}
}
export interface ReconcilePreviewRequest {
root: Root
action: "reconcile"
mode: "preview"
request: {

}
}
export interface ApplyRequest {
root: Root
mode: "apply"
/**
 * A passive JSON value. The receiving domain owner applies its narrower contract.
 */
confirmation: (null | boolean | number | string | JsonValue[] | {
[k: string]: JsonValue
})
confirmationDigest: Sha256Digest
}
export interface RecoverRequest {
root: Root
mode: "recover"
operationId: MaintenanceOperationId
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
export const WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA = freezeGeneratedSchema({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:wakeflow:entrypoints:maintenance-public-request:v1",
  "x-wakeflow-runtime-export": "WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA",
  "title": "WakeflowMaintenancePublicRequestV1",
  "description": "Closed MCP input contract for previewing, applying, or recovering one Wakeflow workspace Maintenance operation. Nested domain values are revalidated by their owning domain modules.",
  "type": "object",
  "oneOf": [
    {
      "$ref": "#/$defs/freshPreviewRequest"
    },
    {
      "$ref": "#/$defs/reconfigurePreviewRequest"
    },
    {
      "$ref": "#/$defs/reconcilePreviewRequest"
    },
    {
      "$ref": "#/$defs/applyRequest"
    },
    {
      "$ref": "#/$defs/recoverRequest"
    }
  ],
  "$defs": {
    "jsonValue": {
      "description": "A passive JSON value. The receiving domain owner applies its narrower contract.",
      "oneOf": [
        {
          "type": "null"
        },
        {
          "type": "boolean"
        },
        {
          "type": "number"
        },
        {
          "type": "string"
        },
        {
          "type": "array",
          "items": {
            "$ref": "#/$defs/jsonValue"
          }
        },
        {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/jsonValue"
          }
        }
      ]
    },
    "root": {
      "type": "string",
      "description": "Absolute path of the existing workspace root. Physical root validation remains owned by RootedDirectory."
    },
    "sha256Digest": {
      "type": "string",
      "pattern": "^[0-9a-f]{64}$",
      "description": "Lowercase SHA-256 digest of the exact confirmation returned by preview."
    },
    "maintenanceOperationId": {
      "type": "string",
      "pattern": "^maintenance_operation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
      "description": "Typed identifier of one prepared Maintenance transaction."
    },
    "freshPreviewRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "root",
        "action",
        "mode",
        "request"
      ],
      "properties": {
        "root": {
          "$ref": "#/$defs/root"
        },
        "action": {
          "const": "fresh-initialize"
        },
        "mode": {
          "const": "preview"
        },
        "request": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "selection"
          ],
          "properties": {
            "selection": {
              "$ref": "#/$defs/jsonValue",
              "description": "Fresh user selection compiled by the Configuration owner into a typed Config v3 model."
            }
          }
        }
      }
    },
    "reconfigurePreviewRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "root",
        "action",
        "mode",
        "request"
      ],
      "properties": {
        "root": {
          "$ref": "#/$defs/root"
        },
        "action": {
          "const": "reconfigure"
        },
        "mode": {
          "const": "preview"
        },
        "request": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "desiredConfig"
          ],
          "properties": {
            "desiredConfig": {
              "$ref": "#/$defs/jsonValue",
              "description": "Complete desired Config document revalidated by the Configuration owner."
            }
          }
        }
      }
    },
    "reconcilePreviewRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "root",
        "action",
        "mode",
        "request"
      ],
      "properties": {
        "root": {
          "$ref": "#/$defs/root"
        },
        "action": {
          "const": "reconcile"
        },
        "mode": {
          "const": "preview"
        },
        "request": {
          "type": "object",
          "additionalProperties": false,
          "maxProperties": 0
        }
      }
    },
    "applyRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "root",
        "mode",
        "confirmation",
        "confirmationDigest"
      ],
      "properties": {
        "root": {
          "$ref": "#/$defs/root"
        },
        "mode": {
          "const": "apply"
        },
        "confirmation": {
          "$ref": "#/$defs/jsonValue",
          "description": "Exact confirmation envelope returned by a ready preview and revalidated by the Maintenance owner."
        },
        "confirmationDigest": {
          "$ref": "#/$defs/sha256Digest"
        }
      }
    },
    "recoverRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "root",
        "mode",
        "operationId"
      ],
      "properties": {
        "root": {
          "$ref": "#/$defs/root"
        },
        "mode": {
          "const": "recover"
        },
        "operationId": {
          "$ref": "#/$defs/maintenanceOperationId"
        }
      }
    }
  }
} as const);
