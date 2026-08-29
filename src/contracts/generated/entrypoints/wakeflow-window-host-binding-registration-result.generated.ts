/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-window-host-binding-registration-result.schema.json
 */

export type Sha256Digest = string
export type UtcInstant = string

/**
 * Redacted successful result of registering one Agent-observed current-host window identity and rebuilding its runtime projection.
 */
export interface WakeflowWindowHostBindingRegistrationResultV1 {
kind: "WakeflowWindowHostBindingRegistrationResult"
schemaVersion: 1
tool: "wakeflow_register_window_binding"
hostId: ("codex" | "claude-code")
windowId: string
disposition: ("registered" | "replayed")
binding: {
bindingId: string
bindingRef: string
bindingDigest: Sha256Digest
registeredAt: UtcInstant
source: {
kind: "agent-host-create-result"
launchIntentDigest: Sha256Digest
observedAt: UtcInstant
}
}
projection: {
resourceRef: string
projectionDigest: Sha256Digest
documentDigest: Sha256Digest
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

/** Ajv 严格校验器使用的 Schema 派生运行时权威；不得手工修改。 */
export const WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_RESULT_SCHEMA = freezeGeneratedSchema({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:wakeflow:entrypoints:window-host-binding-registration-result:v1",
  "x-wakeflow-runtime-export": "WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_RESULT_SCHEMA",
  "title": "WakeflowWindowHostBindingRegistrationResultV1",
  "description": "Redacted successful result of registering one Agent-observed current-host window identity and rebuilding its runtime projection.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "kind",
    "schemaVersion",
    "tool",
    "hostId",
    "windowId",
    "disposition",
    "binding",
    "projection"
  ],
  "properties": {
    "kind": {
      "const": "WakeflowWindowHostBindingRegistrationResult"
    },
    "schemaVersion": {
      "const": 1
    },
    "tool": {
      "const": "wakeflow_register_window_binding"
    },
    "hostId": {
      "enum": [
        "codex",
        "claude-code"
      ]
    },
    "windowId": {
      "type": "string",
      "pattern": "^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    },
    "disposition": {
      "enum": [
        "registered",
        "replayed"
      ]
    },
    "binding": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "bindingId",
        "bindingRef",
        "bindingDigest",
        "registeredAt",
        "source"
      ],
      "properties": {
        "bindingId": {
          "type": "string",
          "pattern": "^window_binding_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
        },
        "bindingRef": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4096
        },
        "bindingDigest": {
          "$ref": "#/$defs/sha256Digest"
        },
        "registeredAt": {
          "$ref": "#/$defs/utcInstant"
        },
        "source": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "kind",
            "launchIntentDigest",
            "observedAt"
          ],
          "properties": {
            "kind": {
              "const": "agent-host-create-result"
            },
            "launchIntentDigest": {
              "$ref": "#/$defs/sha256Digest"
            },
            "observedAt": {
              "$ref": "#/$defs/utcInstant"
            }
          }
        }
      }
    },
    "projection": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "resourceRef",
        "projectionDigest",
        "documentDigest"
      ],
      "properties": {
        "resourceRef": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4096
        },
        "projectionDigest": {
          "$ref": "#/$defs/sha256Digest"
        },
        "documentDigest": {
          "$ref": "#/$defs/sha256Digest"
        }
      }
    }
  },
  "$defs": {
    "sha256Digest": {
      "type": "string",
      "pattern": "^sha256:[0-9a-f]{64}$"
    },
    "utcInstant": {
      "type": "string",
      "minLength": 20,
      "maxLength": 30,
      "pattern": "^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\.[0-9]{1,9})?Z$"
    }
  }
} as const);
