import {
  parseWakeflowConfigPlacement,
  WakeflowConfigV3Error,
  type WakeflowConfigPlacement,
} from "../../configuration/wakeflow-config-v3.js";
import {
  WAKEFLOW_AGENT_HOST_WINDOW_OBSERVATION_SCHEMA,
  type WakeflowAgentHostWindowObservation as ObservationWire,
} from "../../contracts/generated/workspace/agent-host-window-observation.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA } from "../../contracts/generated/workspace/window-host-binding.generated.js";
import { WAKEFLOW_WINDOW_RUNTIME_UNREGISTERED_PROJECTION_SCHEMA } from "../../contracts/generated/workspace/window-runtime-unregistered-projection.generated.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  parseJsonValue,
  JsonValueError,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../foundation/time/utc-instant.js";
import type { WakeflowWorkspaceHostId } from "../workspace-host-resource-profile.js";
import {
  parseWakeflowWindowHostBindingId,
  WakeflowWindowHostBindingIdError,
  type WakeflowWindowHostBindingId,
} from "./wakeflow-window-host-binding-id.js";
import {
  parseWakeflowWindowHostHandle,
  parseWakeflowWindowHostIdentityProfile,
  WakeflowWindowHostIdentityProfileError,
  type WakeflowWindowHostHandle,
  type WakeflowWindowHostIdentityProfile,
} from "./wakeflow-window-host-identity-profile.js";
import type { WakeflowWindowRuntimeLogicalRoot } from "./wakeflow-window-runtime-desired-topology.js";

/**
 * Wakeflow Workspace / Window Runtime：Agent 回传的瞬时宿主窗口观察。
 *
 * Agent 先通过当前宿主能力取得候选 handle，并声明该窗口当前上下文符合 Config
 * 中的逻辑根。此合同只准入被动数据；它不把声明提升为宿主自身证明，也不授予
 * 发送权限。raw handle 只允许在后续 authority 闭合期间参与私有等值比较，禁止进入
 * 持久记录、投影、日志或公共结果。
 */

export interface WakeflowAgentHostWindowObservation {
  readonly kind: "WakeflowAgentHostWindowObservation";
  readonly schemaVersion: 1;
  readonly source: "agent-host-inspection-result";
  readonly hostId: WakeflowWorkspaceHostId;
  readonly windowId: WakeflowDurableId<"window">;
  readonly bindingId: WakeflowWindowHostBindingId;
  readonly handle: Readonly<WakeflowWindowHostHandle>;
  readonly attestedRoot: Readonly<{
    readonly status: "matches-configured-root";
    readonly logicalRoot: WakeflowWindowRuntimeLogicalRoot;
    readonly configuredPlacement: "." | WakeflowConfigPlacement;
  }>;
  readonly observedAt: UtcInstant;
}

type WakeflowAgentHostWindowObservationErrorReason =
  | "input"
  | "capacity"
  | "schema"
  | "profile"
  | "identity"
  | "handle"
  | "placement"
  | "time";

const ERROR_MESSAGES = {
  input: "Agent Host Window observation is not passive JSON data.",
  capacity: "Agent Host Window observation exceeds its capacity.",
  schema: "Agent Host Window observation does not satisfy its Schema.",
  profile:
    "Agent Host Window observation does not belong to the current host profile.",
  identity: "Agent Host Window observation contains an invalid typed identity.",
  handle: "Agent Host Window observation contains an invalid candidate handle.",
  placement:
    "Agent Host Window observation contains an invalid configured placement.",
  time: "Agent Host Window observation contains an invalid observation time.",
} as const satisfies Readonly<
  Record<WakeflowAgentHostWindowObservationErrorReason, string>
>;

/** Agent Host Window observation 准入失败时返回的稳定、脱敏错误。 */
export class WakeflowAgentHostWindowObservationError extends Error {
  override readonly name = "WakeflowAgentHostWindowObservationError";
  readonly code = "wakeflow-agent-host-window-observation" as const;
  readonly reason: WakeflowAgentHostWindowObservationErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowAgentHostWindowObservationErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const MAXIMUM_OBSERVATION_BYTES = 64 * 1024;
const validateWire = createRuntimeJsonSchemaValidator<ObservationWire>(
  WAKEFLOW_AGENT_HOST_WINDOW_OBSERVATION_SCHEMA,
  [
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
    WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA,
    WAKEFLOW_WINDOW_RUNTIME_UNREGISTERED_PROJECTION_SCHEMA,
  ],
);

function fail(
  reason: WakeflowAgentHostWindowObservationErrorReason,
  path: string,
): never {
  throw new WakeflowAgentHostWindowObservationError(reason, path);
}

function typedId<Kind extends "program" | "repository" | "surface" | "window">(
  value: unknown,
  kind: Kind,
  path: string,
): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identity", path);
    throw error;
  }
}

function logicalRoot(
  value: ObservationWire["attestedRoot"]["logicalRoot"],
): WakeflowWindowRuntimeLogicalRoot {
  if (value.kind === "program") {
    return Object.freeze({
      kind: "program" as const,
      programId: typedId(
        value.programId,
        "program",
        "$/attestedRoot/logicalRoot/programId",
      ),
    });
  }
  if (value.kind === "support-surface") {
    return Object.freeze({
      kind: "support-surface" as const,
      surfaceId: typedId(
        value.surfaceId,
        "surface",
        "$/attestedRoot/logicalRoot/surfaceId",
      ),
    });
  }
  return Object.freeze({
    kind: "repository" as const,
    repositoryId: typedId(
      value.repositoryId,
      "repository",
      "$/attestedRoot/logicalRoot/repositoryId",
    ),
  });
}

function configuredPlacement(value: string): "." | WakeflowConfigPlacement {
  if (value === ".") return value;
  try {
    return parseWakeflowConfigPlacement(
      value,
      "$/attestedRoot/configuredPlacement",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigV3Error) {
      fail("placement", "$/attestedRoot/configuredPlacement");
    }
    throw error;
  }
}

/**
 * 使用当前宿主 Identity Profile 准入一份瞬时窗口观察。
 * 返回值仍含私有 handle，只能继续传给同一调用链内的 authority 编译器。
 */
export function parseWakeflowAgentHostWindowObservation(
  identityProfileValue: unknown,
  value: unknown,
): Readonly<WakeflowAgentHostWindowObservation> {
  let identityProfile: Readonly<WakeflowWindowHostIdentityProfile>;
  try {
    identityProfile =
      parseWakeflowWindowHostIdentityProfile(identityProfileValue);
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostIdentityProfileError) {
      fail("profile", error.path);
    }
    throw error;
  }
  let json;
  try {
    json = parseJsonValue(value, "$observation");
    if (
      encodeCanonicalJson(json, "$observation").byteLength >
      MAXIMUM_OBSERVATION_BYTES
    ) {
      fail("capacity", "$observation");
    }
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("input", error.path);
    if (error instanceof WakeflowAgentHostWindowObservationError) throw error;
    throw error;
  }
  const validated = validateWire(json);
  if (!validated.ok) fail("schema", validated.path);
  const wire = validated.value;
  if (wire.hostId !== identityProfile.hostId) fail("profile", "$/hostId");

  let bindingId: WakeflowWindowHostBindingId;
  try {
    bindingId = parseWakeflowWindowHostBindingId(wire.bindingId, "$/bindingId");
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingIdError) {
      fail("identity", "$/bindingId");
    }
    throw error;
  }
  let handle: Readonly<WakeflowWindowHostHandle>;
  try {
    handle = parseWakeflowWindowHostHandle(identityProfile, wire.handle);
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostIdentityProfileError) {
      fail("handle", "$/handle");
    }
    throw error;
  }
  let observedAt: UtcInstant;
  try {
    observedAt = parseUtcInstant(wire.observedAt, "$/observedAt");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", "$/observedAt");
    throw error;
  }
  return Object.freeze({
    kind: "WakeflowAgentHostWindowObservation" as const,
    schemaVersion: 1 as const,
    source: "agent-host-inspection-result" as const,
    hostId: wire.hostId,
    windowId: typedId(wire.windowId, "window", "$/windowId"),
    bindingId,
    handle,
    attestedRoot: Object.freeze({
      status: "matches-configured-root" as const,
      logicalRoot: logicalRoot(wire.attestedRoot.logicalRoot),
      configuredPlacement: configuredPlacement(
        wire.attestedRoot.configuredPlacement,
      ),
    }),
    observedAt,
  });
}
