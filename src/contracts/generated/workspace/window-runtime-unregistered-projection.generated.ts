/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/workspace/window-runtime-unregistered-projection.schema.json
 */

/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string

/**
 * Regenerable host-local Fresh projection for one durable window before any real host binding exists.
 */
export interface WakeflowWindowRuntimeUnregisteredProjection {
kind: "WakeflowWindowRuntimeProjection"
schemaVersion: 1
programId: string
hostId: ("codex" | "claude-code")
windowId: string
role: ("controller" | "design" | "test" | "product")
logicalRoot: ({
kind: "program"
programId: string
} | {
kind: "support-surface"
surfaceId: string
} | {
kind: "repository"
repositoryId: string
})
configuredPlacement: string
identity: {
status: "unregistered"
}
rootObservation: {
status: "unobserved"
observationDigest: WakeflowSha256DigestText
}
preflight: {
status: "blocked"
/**
 * @minItems 1
 * @maxItems 1
 */
blockingReasons: [{
code: "identity-unregistered"
source: "identity"
}]
}
sourceFingerprints: {
desiredTopologyDigest: WakeflowSha256DigestText
windowTopologyDigest: WakeflowSha256DigestText
identitySourceDigest: WakeflowSha256DigestText
rootObservationDigest: WakeflowSha256DigestText
}
projectionDigest: WakeflowSha256DigestText
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
export const WAKEFLOW_WINDOW_RUNTIME_UNREGISTERED_PROJECTION_SCHEMA = freezeGeneratedSchema({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:wakeflow:workspace:window-runtime:unregistered-projection:v1",
  "x-wakeflow-runtime-export": "WAKEFLOW_WINDOW_RUNTIME_UNREGISTERED_PROJECTION_SCHEMA",
  "title": "WakeflowWindowRuntimeUnregisteredProjection",
  "description": "Regenerable host-local Fresh projection for one durable window before any real host binding exists.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "kind",
    "schemaVersion",
    "programId",
    "hostId",
    "windowId",
    "role",
    "logicalRoot",
    "configuredPlacement",
    "identity",
    "rootObservation",
    "preflight",
    "sourceFingerprints",
    "projectionDigest"
  ],
  "properties": {
    "kind": {
      "const": "WakeflowWindowRuntimeProjection"
    },
    "schemaVersion": {
      "const": 1
    },
    "programId": {
      "type": "string",
      "pattern": "^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
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
    "role": {
      "enum": [
        "controller",
        "design",
        "test",
        "product"
      ]
    },
    "logicalRoot": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "kind",
            "programId"
          ],
          "properties": {
            "kind": {
              "const": "program"
            },
            "programId": {
              "type": "string",
              "pattern": "^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "kind",
            "surfaceId"
          ],
          "properties": {
            "kind": {
              "const": "support-surface"
            },
            "surfaceId": {
              "type": "string",
              "pattern": "^surface_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "kind",
            "repositoryId"
          ],
          "properties": {
            "kind": {
              "const": "repository"
            },
            "repositoryId": {
              "type": "string",
              "pattern": "^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
            }
          }
        }
      ]
    },
    "configuredPlacement": {
      "type": "string",
      "minLength": 1,
      "maxLength": 4096,
      "pattern": "^(?!.*[\\\\\\u0000-\\u001f\\u007f-\\u009f])\\S(?:.*\\S)?$"
    },
    "identity": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status"
      ],
      "properties": {
        "status": {
          "const": "unregistered"
        }
      }
    },
    "rootObservation": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status",
        "observationDigest"
      ],
      "properties": {
        "status": {
          "const": "unobserved"
        },
        "observationDigest": {
          "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
        }
      }
    },
    "preflight": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status",
        "blockingReasons"
      ],
      "properties": {
        "status": {
          "const": "blocked"
        },
        "blockingReasons": {
          "type": "array",
          "minItems": 1,
          "maxItems": 1,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "code",
              "source"
            ],
            "properties": {
              "code": {
                "const": "identity-unregistered"
              },
              "source": {
                "const": "identity"
              }
            }
          }
        }
      }
    },
    "sourceFingerprints": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "desiredTopologyDigest",
        "windowTopologyDigest",
        "identitySourceDigest",
        "rootObservationDigest"
      ],
      "properties": {
        "desiredTopologyDigest": {
          "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
        },
        "windowTopologyDigest": {
          "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
        },
        "identitySourceDigest": {
          "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
        },
        "rootObservationDigest": {
          "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
        }
      }
    },
    "projectionDigest": {
      "$ref": "urn:wakeflow:foundation:crypto:sha256-digest:v1"
    }
  }
} as const);
