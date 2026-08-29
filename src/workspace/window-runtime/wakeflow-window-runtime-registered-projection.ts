import {
  WAKEFLOW_SHA256_DIGEST_SCHEMA,
} from "../../contracts/generated/foundation/sha256-digest.generated.js";
import {
  WAKEFLOW_WINDOW_RUNTIME_REGISTERED_PROJECTION_SCHEMA,
  type WakeflowWindowRuntimeRegisteredProjection as RegisteredProjectionWire,
} from "../../contracts/generated/workspace/window-runtime-registered-projection.generated.js";
import {
  WAKEFLOW_WINDOW_RUNTIME_UNREGISTERED_PROJECTION_SCHEMA,
} from "../../contracts/generated/workspace/window-runtime-unregistered-projection.generated.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import {
  computeSha256Digest,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  renderDeterministicJsonDocument,
} from "../../foundation/data/deterministic-json-document.js";
import {
  parseJsonValue,
} from "../../foundation/data/json-value.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import {
  createRuntimeJsonSchemaValidator,
} from "../../foundation/schema/runtime-json-schema.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  type WakeflowWorkspaceHostId,
  type WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import {
  parseWakeflowWindowHostBinding,
  type WakeflowWindowHostBinding,
} from "./wakeflow-window-host-binding.js";
import type { WakeflowWindowHostBindingId } from "./wakeflow-window-host-binding-id.js";
import type {
  WakeflowWindowRuntimeLogicalRoot,
} from "./wakeflow-window-runtime-desired-topology.js";
import {
  wakeflowWindowHostBindingRef,
  wakeflowWindowRuntimeProjectionRef,
} from "./wakeflow-window-runtime-paths.js";
import {
  parseWakeflowWindowRuntimeUnregisteredProjection,
  WAKEFLOW_WINDOW_RUNTIME_PROJECTION_KIND,
  WAKEFLOW_WINDOW_RUNTIME_PROJECTION_VERSION,
  type WakeflowWindowRuntimeUnregisteredProjection,
} from "./wakeflow-window-runtime-unregistered-projection.js";

/**
 * Wakeflow Workspace / Window Runtime：已注册身份的脱敏派生投影。
 *
 * 编译输入只有当前 desired/unregistered 投影与私有 Binding authority。输出删除 raw
 * handle，只携带Binding ref与代际ID。身份注册不会伪造configured root已被
 * 观察，因此 preflight 仍以 `root-unobserved` 明确阻断。
 */

export interface WakeflowWindowRuntimeRegisteredProjection {
  readonly kind: typeof WAKEFLOW_WINDOW_RUNTIME_PROJECTION_KIND;
  readonly schemaVersion: typeof WAKEFLOW_WINDOW_RUNTIME_PROJECTION_VERSION;
  readonly programId: WakeflowDurableId<"program">;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly windowId: WakeflowDurableId<"window">;
  readonly role: WakeflowWindowRuntimeUnregisteredProjection["role"];
  readonly logicalRoot: WakeflowWindowRuntimeLogicalRoot;
  readonly configuredPlacement:
    WakeflowWindowRuntimeUnregisteredProjection["configuredPlacement"];
  readonly identity: Readonly<{
    readonly status: "registered";
    readonly bindingRef: PortableResourcePath;
    readonly bindingId: WakeflowWindowHostBindingId;
  }>;
  readonly rootObservation:
    WakeflowWindowRuntimeUnregisteredProjection["rootObservation"];
  readonly preflight: Readonly<{
    readonly status: "blocked";
    readonly blockingReasons: readonly [Readonly<{
      readonly code: "root-unobserved";
      readonly source: "root-observation";
    }>];
  }>;
  readonly sourceFingerprints: Readonly<{
    readonly desiredTopologyDigest: Sha256Digest;
    readonly windowTopologyDigest: Sha256Digest;
    readonly rootObservationDigest: Sha256Digest;
  }>;
  readonly projectionDigest: Sha256Digest;
}

export interface WakeflowWindowRuntimeRegisteredProjectionEntry {
  readonly windowId: WakeflowDurableId<"window">;
  readonly resourceRef: PortableResourcePath;
  readonly projection: Readonly<WakeflowWindowRuntimeRegisteredProjection>;
  readonly document: string;
  readonly documentDigest: Sha256Digest;
}

type WakeflowWindowRuntimeRegisteredProjectionErrorReason =
  | "input"
  | "schema"
  | "source";

const ERROR_MESSAGES = {
  input: "Window Runtime registered projection input is invalid.",
  schema: "Window Runtime registered projection does not satisfy its Schema.",
  source: "Window Runtime registered projection sources are inconsistent.",
} as const satisfies Readonly<Record<
  WakeflowWindowRuntimeRegisteredProjectionErrorReason,
  string
>>;

/** Registered projection 编译或准入失败的稳定、脱敏错误。 */
export class WakeflowWindowRuntimeRegisteredProjectionError extends Error {
  override readonly name = "WakeflowWindowRuntimeRegisteredProjectionError";
  readonly code = "wakeflow-window-runtime-registered-projection" as const;
  readonly reason: WakeflowWindowRuntimeRegisteredProjectionErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowWindowRuntimeRegisteredProjectionErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<RegisteredProjectionWire>(
  WAKEFLOW_WINDOW_RUNTIME_REGISTERED_PROJECTION_SCHEMA,
  [
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_WINDOW_RUNTIME_UNREGISTERED_PROJECTION_SCHEMA,
  ],
);

function fail(
  reason: WakeflowWindowRuntimeRegisteredProjectionErrorReason,
  path: string,
): never {
  throw new WakeflowWindowRuntimeRegisteredProjectionError(reason, path);
}

function projectionBasis(
  value: Omit<WakeflowWindowRuntimeRegisteredProjection, "projectionDigest">,
) {
  return {
    kind: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_KIND,
    schemaVersion: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_VERSION,
    programId: value.programId,
    hostId: value.hostId,
    windowId: value.windowId,
    role: value.role,
    logicalRoot: value.logicalRoot,
    configuredPlacement: value.configuredPlacement,
    identity: value.identity,
    rootObservation: value.rootObservation,
    preflight: value.preflight,
    sourceFingerprints: value.sourceFingerprints,
  };
}

function assertSources(
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  source: Readonly<WakeflowWindowRuntimeUnregisteredProjection>,
  binding: Readonly<WakeflowWindowHostBinding>,
): void {
  if (
    !profile.surfaces.windowIdentity
    || profile.hostId !== source.hostId
    || source.programId !== binding.programId
    || source.hostId !== binding.hostId
    || source.windowId !== binding.windowId
  ) {
    fail("source", "$sources");
  }
}

/** 从当前 topology 投影与私有 Binding 编译脱敏 registered 投影。 */
function compileWakeflowWindowRuntimeRegisteredProjection(
  profileValue: unknown,
  identityProfileValue: unknown,
  unregisteredValue: unknown,
  bindingValue: unknown,
): Readonly<WakeflowWindowRuntimeRegisteredProjection> {
  let profile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  let source: Readonly<WakeflowWindowRuntimeUnregisteredProjection>;
  let binding: Readonly<WakeflowWindowHostBinding>;
  try {
    profile = parseWakeflowWorkspaceHostResourceProfile(profileValue);
    source = parseWakeflowWindowRuntimeUnregisteredProjection(unregisteredValue);
    binding = parseWakeflowWindowHostBinding(
      bindingValue,
      identityProfileValue,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
      fail("input", "$profile");
    }
    fail("input", "$sources");
  }
  assertSources(profile, source, binding);
  const reason = Object.freeze({
    code: "root-unobserved" as const,
    source: "root-observation" as const,
  });
  const basis = {
    kind: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_KIND,
    schemaVersion: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_VERSION,
    programId: source.programId,
    hostId: source.hostId,
    windowId: source.windowId,
    role: source.role,
    logicalRoot: source.logicalRoot,
    configuredPlacement: source.configuredPlacement,
    identity: Object.freeze({
      status: "registered" as const,
      bindingRef: wakeflowWindowHostBindingRef(profile, binding.windowId),
      bindingId: binding.bindingId,
    }),
    rootObservation: source.rootObservation,
    preflight: Object.freeze({
      status: "blocked" as const,
      blockingReasons: Object.freeze([reason]) as readonly [typeof reason],
    }),
    sourceFingerprints: Object.freeze({
      desiredTopologyDigest: source.sourceFingerprints.desiredTopologyDigest,
      windowTopologyDigest: source.sourceFingerprints.windowTopologyDigest,
      rootObservationDigest: source.sourceFingerprints.rootObservationDigest,
    }),
  } satisfies Omit<
    WakeflowWindowRuntimeRegisteredProjection,
    "projectionDigest"
  >;
  const projection = Object.freeze({
    ...projectionBasis(basis),
    projectionDigest: computeCanonicalJsonSha256Digest(
      projectionBasis(basis),
    ),
  });
  const validated = validateWire(
    parseJsonValue(projection, "$projection"),
  );
  if (!validated.ok) fail("schema", validated.path);
  return projection;
}

/** 编译一份带资源引用、确定性文档和物理字节摘要的 registered 投影目标。 */
export function compileWakeflowWindowRuntimeRegisteredProjectionEntry(
  profileValue: unknown,
  identityProfileValue: unknown,
  unregisteredValue: unknown,
  bindingValue: unknown,
): Readonly<WakeflowWindowRuntimeRegisteredProjectionEntry> {
  const projection = compileWakeflowWindowRuntimeRegisteredProjection(
    profileValue,
    identityProfileValue,
    unregisteredValue,
    bindingValue,
  );
  const document = renderDeterministicJsonDocument(
    projection,
    "$windowRuntimeProjection",
  );
  return Object.freeze({
    windowId: projection.windowId,
    resourceRef: wakeflowWindowRuntimeProjectionRef(
      profileValue,
      projection.windowId,
    ),
    projection,
    document,
    documentDigest: computeSha256Digest(
      encodeUtf8(document, "$windowRuntimeProjection"),
    ),
  });
}
