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
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
  DeterministicJsonDocumentError,
} from "../../foundation/data/deterministic-json-document.js";
import {
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import type { WakeflowDurableId } from "../../foundation/identity/wakeflow-durable-id.js";
import {
  createRuntimeJsonSchemaValidator,
} from "../../foundation/schema/runtime-json-schema.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import type { WakeflowWorkspaceHostId } from "../workspace-host-resource-profile.js";
import {
  computeWakeflowWindowHostBindingDigest,
  parseWakeflowWindowHostBinding,
  type WakeflowWindowHostBinding,
} from "./wakeflow-window-host-binding.js";
import type { WakeflowWindowHostBindingId } from "./wakeflow-window-host-binding-id.js";
import type {
  WakeflowWindowRuntimeLogicalRoot,
} from "./wakeflow-window-runtime-desired-topology.js";
import {
  wakeflowWindowBindingRef,
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
 * handle，只携带 Binding ref、代际 ID 与摘要。身份注册不会伪造 configured root 已被
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
    readonly bindingDigest: Sha256Digest;
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
    readonly bindingDigest: Sha256Digest;
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

export type WakeflowWindowRuntimeRegisteredProjectionErrorReason =
  | "input"
  | "schema"
  | "source"
  | "representation";

const ERROR_MESSAGES = {
  input: "Window Runtime registered projection input is invalid.",
  schema: "Window Runtime registered projection does not satisfy its Schema.",
  source: "Window Runtime registered projection sources are inconsistent.",
  representation: "Window Runtime registered projection bytes are not deterministic.",
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
  source: Readonly<WakeflowWindowRuntimeUnregisteredProjection>,
  binding: Readonly<WakeflowWindowHostBinding>,
): void {
  if (
    source.programId !== binding.programId
    || source.hostId !== binding.hostId
    || source.windowId !== binding.windowId
  ) {
    fail("source", "$sources");
  }
}

/** 从当前 topology 投影与私有 Binding 编译脱敏 registered 投影。 */
export function compileWakeflowWindowRuntimeRegisteredProjection(
  profileValue: unknown,
  unregisteredValue: unknown,
  bindingValue: unknown,
): Readonly<WakeflowWindowRuntimeRegisteredProjection> {
  let source: Readonly<WakeflowWindowRuntimeUnregisteredProjection>;
  let binding: Readonly<WakeflowWindowHostBinding>;
  try {
    source = parseWakeflowWindowRuntimeUnregisteredProjection(unregisteredValue);
    binding = parseWakeflowWindowHostBinding(bindingValue);
  } catch {
    fail("input", "$sources");
  }
  assertSources(source, binding);
  const bindingDigest = computeWakeflowWindowHostBindingDigest(binding);
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
      bindingRef: wakeflowWindowBindingRef(profileValue, binding.windowId),
      bindingId: binding.bindingId,
      bindingDigest,
    }),
    rootObservation: source.rootObservation,
    preflight: Object.freeze({
      status: "blocked" as const,
      blockingReasons: Object.freeze([reason]) as readonly [typeof reason],
    }),
    sourceFingerprints: Object.freeze({
      desiredTopologyDigest: source.sourceFingerprints.desiredTopologyDigest,
      windowTopologyDigest: source.sourceFingerprints.windowTopologyDigest,
      bindingDigest,
      rootObservationDigest: source.sourceFingerprints.rootObservationDigest,
    }),
  } satisfies Omit<
    WakeflowWindowRuntimeRegisteredProjection,
    "projectionDigest"
  >;
  const projection = Object.freeze({
    ...projectionBasis(basis),
    projectionDigest: computeCanonicalJsonSha256Digest(
      projectionBasis(basis) as unknown as JsonValue,
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
  unregisteredValue: unknown,
  bindingValue: unknown,
): Readonly<WakeflowWindowRuntimeRegisteredProjectionEntry> {
  const projection = compileWakeflowWindowRuntimeRegisteredProjection(
    profileValue,
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

/** 只接受与当前 topology + Binding authority 完全一致的确定性投影文档。 */
export function parseWakeflowWindowRuntimeRegisteredProjectionDocument(
  text: unknown,
  profileValue: unknown,
  unregisteredValue: unknown,
  bindingValue: unknown,
): Readonly<WakeflowWindowRuntimeRegisteredProjection> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$windowRuntimeProjection");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", error.path);
    }
    throw error;
  }
  const validated = validateWire(json);
  if (!validated.ok) fail("schema", validated.path);
  const expected = compileWakeflowWindowRuntimeRegisteredProjection(
    profileValue,
    unregisteredValue,
    bindingValue,
  );
  if (
    renderDeterministicJsonDocument(expected, "$windowRuntimeProjection")
      !== text
  ) {
    fail("source", "$windowRuntimeProjection");
  }
  return expected;
}
