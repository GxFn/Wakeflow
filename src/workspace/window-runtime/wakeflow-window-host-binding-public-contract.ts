import {
  WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_REQUEST_SCHEMA,
  type WakeflowWindowHostBindingRegistrationRequestV1 as RegistrationRequestWire,
} from "../../contracts/generated/entrypoints/wakeflow-window-host-binding-registration-request.generated.js";
import {
  WAKEFLOW_SHA256_DIGEST_SCHEMA,
} from "../../contracts/generated/foundation/sha256-digest.generated.js";
import {
  WAKEFLOW_UTC_INSTANT_SCHEMA,
} from "../../contracts/generated/foundation/utc-instant.generated.js";
import {
  encodeCanonicalJson,
} from "../../foundation/data/canonical-json.js";
import {
  parseJsonValue,
  JsonValueError,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  createRuntimeJsonSchemaValidator,
} from "../../foundation/schema/runtime-json-schema.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../foundation/time/utc-instant.js";
import type { WakeflowWorkspaceHostId } from "../workspace-host-resource-profile.js";

/**
 * Wakeflow Workspace / Window Runtime：公共 Binding registration 请求合同。
 *
 * 请求只携带 Agent 已通过宿主能力得到的 create result observation；它不要求或允许
 * Wakeflow 选择宿主工具。handle 在本层保持不透明，当前宿主的 identity profile 会在
 * 注册 owner 内继续收窄，任何错误都不会回显 handle value。
 */

export const WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME =
  "wakeflow_register_window_binding" as const;
export const WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_SCHEMA_VERSION = 1 as const;
const WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_MAXIMUM_REQUEST_BYTES =
  64 * 1024;

interface WakeflowAgentHostWindowCreationObservation {
  readonly kind: "WakeflowAgentHostWindowCreationObservation";
  readonly schemaVersion: 1;
  readonly source: "agent-host-create-result";
  readonly hostId: WakeflowWorkspaceHostId;
  readonly windowId: WakeflowDurableId<"window">;
  readonly launchIntentDigest: Sha256Digest;
  readonly handle: Readonly<{
    readonly kind: string;
    readonly value: string;
  }>;
  readonly observedAt: UtcInstant;
}

interface WakeflowWindowHostBindingPublicRequest {
  readonly root: string;
  readonly observation: Readonly<WakeflowAgentHostWindowCreationObservation>;
}

type WakeflowWindowHostBindingPublicContractErrorReason =
  | "input"
  | "capacity"
  | "schema"
  | "time";

const ERROR_MESSAGES = {
  input: "Window Host Binding public request is not passive JSON data.",
  capacity: "Window Host Binding public request exceeds its capacity.",
  schema: "Window Host Binding public request does not satisfy its Schema.",
  time: "Window Host Binding public request contains an invalid observation time.",
} as const satisfies Readonly<Record<
  WakeflowWindowHostBindingPublicContractErrorReason,
  string
>>;

/** 公共 Binding registration 请求准入失败的稳定、脱敏错误。 */
export class WakeflowWindowHostBindingPublicContractError extends Error {
  override readonly name = "WakeflowWindowHostBindingPublicContractError";
  readonly code = "wakeflow-window-host-binding-public-contract" as const;
  readonly reason: WakeflowWindowHostBindingPublicContractErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowWindowHostBindingPublicContractErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<RegistrationRequestWire>(
  WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_REQUEST_SCHEMA,
  [WAKEFLOW_SHA256_DIGEST_SCHEMA, WAKEFLOW_UTC_INSTANT_SCHEMA],
);

function fail(
  reason: WakeflowWindowHostBindingPublicContractErrorReason,
  path: string,
): never {
  throw new WakeflowWindowHostBindingPublicContractError(reason, path);
}

/** 把任意 MCP 参数解析为一份闭合的 Agent host-create observation。 */
export function parseWakeflowWindowHostBindingPublicRequest(
  value: unknown,
): Readonly<WakeflowWindowHostBindingPublicRequest> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
    if (
      encodeCanonicalJson(json, "$request").byteLength
        > WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_MAXIMUM_REQUEST_BYTES
    ) {
      fail("capacity", "$request");
    }
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("input", error.path);
    if (error instanceof WakeflowWindowHostBindingPublicContractError) {
      throw error;
    }
    throw error;
  }
  const validated = validateWire(json);
  if (!validated.ok) fail("schema", validated.path);
  const wire = validated.value;
  let windowId: WakeflowDurableId<"window">;
  try {
    windowId = parseWakeflowDurableIdOfKind(
      wire.observation.windowId,
      "window",
      "$/observation/windowId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("schema", "$/observation/windowId");
    }
    throw error;
  }
  let launchIntentDigest: Sha256Digest;
  try {
    launchIntentDigest = parseSha256Digest(
      wire.observation.launchIntentDigest,
      "$/observation/launchIntentDigest",
    );
  } catch (error: unknown) {
    if (error instanceof Sha256Error) {
      fail("schema", "$/observation/launchIntentDigest");
    }
    throw error;
  }
  let observedAt: UtcInstant;
  try {
    observedAt = parseUtcInstant(
      wire.observation.observedAt,
      "$/observation/observedAt",
    );
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) {
      fail("time", "$/observation/observedAt");
    }
    throw error;
  }
  return Object.freeze({
    root: wire.root,
    observation: Object.freeze({
      kind: "WakeflowAgentHostWindowCreationObservation" as const,
      schemaVersion: 1 as const,
      source: "agent-host-create-result" as const,
      hostId: wire.observation.hostId,
      windowId,
      launchIntentDigest,
      handle: Object.freeze({
        kind: wire.observation.handle.kind,
        value: wire.observation.handle.value,
      }),
      observedAt,
    }),
  });
}
