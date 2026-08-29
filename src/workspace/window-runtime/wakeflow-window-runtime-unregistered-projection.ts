import {
  parseWakeflowConfigPlacement,
  WakeflowConfigV3Error,
} from "../../configuration/wakeflow-config-v3.js";
import {
  WAKEFLOW_WINDOW_RUNTIME_UNREGISTERED_PROJECTION_SCHEMA,
  type WakeflowWindowRuntimeUnregisteredProjection as WindowRuntimeProjectionWire,
} from "../../contracts/generated/workspace/window-runtime-unregistered-projection.generated.js";
import {
  WAKEFLOW_SHA256_DIGEST_SCHEMA,
} from "../../contracts/generated/foundation/sha256-digest.generated.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import {
  computeSha256Digest,
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
  DeterministicJsonDocumentError,
} from "../../foundation/data/deterministic-json-document.js";
import {
  parseJsonValue,
  JsonValueError,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../foundation/identity/wakeflow-durable-id.js";
import {
  createRuntimeJsonSchemaValidator,
} from "../../foundation/schema/runtime-json-schema.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import type { WakeflowWorkspaceHostId } from "../workspace-host-resource-profile.js";
import {
  compileWakeflowWindowRuntimeDesiredTopology,
  type WakeflowWindowRuntimeDesiredWindow,
  type WakeflowWindowRuntimeLogicalRoot,
} from "./wakeflow-window-runtime-desired-topology.js";
import {
  wakeflowWindowRuntimeProjectionRef,
  wakeflowWindowRuntimeProjectionRootRef,
} from "./wakeflow-window-runtime-paths.js";
import {
  compileWakeflowWindowRuntimeUnregisteredIdentitySource,
} from "./wakeflow-window-runtime-unregistered-identity-source.js";

/**
 * Wakeflow Workspace / Window Runtime：Fresh 初始化的未注册窗口投影集合。
 *
 * 每条记录只连接 desired topology 与 exact-empty identity source，固定表达
 * `identity=unregistered`、`rootObservation=unobserved` 和 identity preflight blocker。
 * 它不探测目录、不生成 Binding、不判断 dispatch policy/host availability，也不保存
 * display title、raw handle、绝对路径或时间字段。
 */

export const WAKEFLOW_WINDOW_RUNTIME_PROJECTION_KIND =
  "WakeflowWindowRuntimeProjection" as const;
export const WAKEFLOW_WINDOW_RUNTIME_PROJECTION_VERSION = 1 as const;
export const WAKEFLOW_WINDOW_RUNTIME_PROJECTION_SET_KIND =
  "WakeflowWindowRuntimeProjectionSet" as const;

export type WakeflowWindowRuntimeUnregisteredProjectionErrorReason =
  | "input"
  | "schema"
  | "identity"
  | "placement"
  | "relation"
  | "digest"
  | "representation";

const ERROR_MESSAGES = {
  input: "Window Runtime unregistered projection input is invalid.",
  schema: "Window Runtime unregistered projection does not satisfy its Schema.",
  identity: "Window Runtime unregistered projection identity is invalid.",
  placement: "Window Runtime unregistered projection placement is invalid.",
  relation: "Window Runtime unregistered projection fields are inconsistent.",
  digest: "Window Runtime unregistered projection digest is invalid.",
  representation: "Window Runtime unregistered projection bytes are not deterministic.",
} as const satisfies Readonly<Record<
  WakeflowWindowRuntimeUnregisteredProjectionErrorReason,
  string
>>;

/** 未注册 Window Runtime 投影准入失败的稳定、脱敏错误。 */
export class WakeflowWindowRuntimeUnregisteredProjectionRecordError
  extends Error {
  override readonly name =
    "WakeflowWindowRuntimeUnregisteredProjectionRecordError";
  readonly code = "wakeflow-window-runtime-unregistered-projection-record" as const;
  readonly reason: WakeflowWindowRuntimeUnregisteredProjectionErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowWindowRuntimeUnregisteredProjectionErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

export interface WakeflowWindowRuntimeUnregisteredProjection {
  readonly kind: typeof WAKEFLOW_WINDOW_RUNTIME_PROJECTION_KIND;
  readonly schemaVersion: typeof WAKEFLOW_WINDOW_RUNTIME_PROJECTION_VERSION;
  readonly programId: WakeflowDurableId<"program">;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly windowId: WakeflowDurableId<"window">;
  readonly role: WakeflowWindowRuntimeDesiredWindow["role"];
  readonly logicalRoot: WakeflowWindowRuntimeLogicalRoot;
  readonly configuredPlacement:
    WakeflowWindowRuntimeDesiredWindow["configuredPlacement"];
  readonly identity: Readonly<{ readonly status: "unregistered" }>;
  readonly rootObservation: Readonly<{
    readonly status: "unobserved";
    readonly observationDigest: Sha256Digest;
  }>;
  readonly preflight: Readonly<{
    readonly status: "blocked";
    readonly blockingReasons: readonly [Readonly<{
      readonly code: "identity-unregistered";
      readonly source: "identity";
    }>];
  }>;
  readonly sourceFingerprints: Readonly<{
    readonly desiredTopologyDigest: Sha256Digest;
    readonly windowTopologyDigest: Sha256Digest;
    readonly identitySourceDigest: Sha256Digest;
    readonly rootObservationDigest: Sha256Digest;
  }>;
  readonly projectionDigest: Sha256Digest;
}

export interface WakeflowWindowRuntimeUnregisteredProjectionEntry {
  readonly windowId: WakeflowDurableId<"window">;
  readonly resourceRef: PortableResourcePath;
  readonly projection: Readonly<WakeflowWindowRuntimeUnregisteredProjection>;
  readonly document: string;
  readonly documentDigest: Sha256Digest;
}

export interface WakeflowWindowRuntimeUnregisteredProjectionSet {
  readonly kind: typeof WAKEFLOW_WINDOW_RUNTIME_PROJECTION_SET_KIND;
  readonly schemaVersion: 1;
  readonly programId: WakeflowDurableId<"program">;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly projectionRootRef: PortableResourcePath;
  readonly desiredTopologyDigest: Sha256Digest;
  readonly identitySourceDigest: Sha256Digest;
  readonly entries:
    readonly Readonly<WakeflowWindowRuntimeUnregisteredProjectionEntry>[];
  readonly projectionSetDigest: Sha256Digest;
}

/** 由同一 Config/Host 编译出的纯 source 发生内部关系漂移。 */
export class WakeflowWindowRuntimeUnregisteredProjectionError extends Error {
  override readonly name = "WakeflowWindowRuntimeUnregisteredProjectionError";
  readonly code = "wakeflow-window-runtime-unregistered-projection" as const;
  readonly reason = "source-inconsistency" as const;
  readonly path = "$sources" as const;

  constructor() {
    super("Window Runtime unregistered projection sources are inconsistent.");
  }
}

const validateProjectionWire =
  createRuntimeJsonSchemaValidator<WindowRuntimeProjectionWire>(
    WAKEFLOW_WINDOW_RUNTIME_UNREGISTERED_PROJECTION_SCHEMA,
    [WAKEFLOW_SHA256_DIGEST_SCHEMA],
  );

function failRecord(
  reason: WakeflowWindowRuntimeUnregisteredProjectionErrorReason,
  path: string,
): never {
  throw new WakeflowWindowRuntimeUnregisteredProjectionRecordError(
    reason,
    path,
  );
}

function typedId<Kind extends "program" | "window" | "surface" | "repository">(
  value: unknown,
  kind: Kind,
  path: string,
): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) failRecord("identity", path);
    throw error;
  }
}

function digest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) failRecord("digest", path);
    throw error;
  }
}

function logicalRoot(
  value: WindowRuntimeProjectionWire["logicalRoot"],
  role: WindowRuntimeProjectionWire["role"],
  programId: WakeflowDurableId<"program">,
): WakeflowWindowRuntimeLogicalRoot {
  if (value.kind === "program") {
    const rootProgramId = typedId(value.programId, "program", "$/logicalRoot/programId");
    if (role !== "controller" || rootProgramId !== programId) {
      failRecord("relation", "$/logicalRoot");
    }
    return Object.freeze({ kind: "program", programId: rootProgramId });
  }
  if (value.kind === "support-surface") {
    if (role !== "design" && role !== "test") {
      failRecord("relation", "$/logicalRoot");
    }
    return Object.freeze({
      kind: "support-surface",
      surfaceId: typedId(
        value.surfaceId,
        "surface",
        "$/logicalRoot/surfaceId",
      ),
    });
  }
  if (role !== "product") failRecord("relation", "$/logicalRoot");
  return Object.freeze({
    kind: "repository",
    repositoryId: typedId(
      value.repositoryId,
      "repository",
      "$/logicalRoot/repositoryId",
    ),
  });
}

function configuredPlacement(
  value: string,
  role: WindowRuntimeProjectionWire["role"],
) {
  if (value === ".") {
    if (role !== "controller") failRecord("relation", "$/configuredPlacement");
    return value;
  }
  if (role === "controller") failRecord("relation", "$/configuredPlacement");
  try {
    return parseWakeflowConfigPlacement(value, "$/configuredPlacement");
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigV3Error) {
      failRecord("placement", "$/configuredPlacement");
    }
    throw error;
  }
}

function unregisteredPreflight():
  WakeflowWindowRuntimeUnregisteredProjection["preflight"] {
  const reason = Object.freeze({
    code: "identity-unregistered" as const,
    source: "identity" as const,
  });
  const blockingReasons: readonly [typeof reason] = Object.freeze([reason]);
  return Object.freeze({
    status: "blocked" as const,
    blockingReasons,
  });
}

function rootObservation(
  root: WakeflowWindowRuntimeLogicalRoot,
  placement: WakeflowWindowRuntimeDesiredWindow["configuredPlacement"],
) {
  const basis = {
    kind: "WakeflowWindowRuntimeRootObservation",
    schemaVersion: 1,
    logicalRoot: root,
    configuredPlacement: placement,
    status: "unobserved" as const,
  };
  return Object.freeze({
    status: "unobserved" as const,
    observationDigest: computeCanonicalJsonSha256Digest(
      basis as unknown as JsonValue,
    ),
  });
}

function projectionBasis(
  value: Omit<WakeflowWindowRuntimeUnregisteredProjection, "projectionDigest">,
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

/** 对任意内存值执行 Schema、类型化关系和全部摘要准入。 */
export function parseWakeflowWindowRuntimeUnregisteredProjection(
  value: unknown,
): Readonly<WakeflowWindowRuntimeUnregisteredProjection> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$projection");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) failRecord("input", error.path);
    throw error;
  }
  const validated = validateProjectionWire(json);
  if (!validated.ok) failRecord("schema", validated.path);
  const wire = validated.value;
  const programId = typedId(wire.programId, "program", "$/programId");
  const windowId = typedId(wire.windowId, "window", "$/windowId");
  const root = logicalRoot(wire.logicalRoot, wire.role, programId);
  const placement = configuredPlacement(wire.configuredPlacement, wire.role);
  const expectedObservation = rootObservation(root, placement);
  const actualObservationDigest = digest(
    wire.rootObservation.observationDigest,
    "$/rootObservation/observationDigest",
  );
  const sourceFingerprints = Object.freeze({
    desiredTopologyDigest: digest(
      wire.sourceFingerprints.desiredTopologyDigest,
      "$/sourceFingerprints/desiredTopologyDigest",
    ),
    windowTopologyDigest: digest(
      wire.sourceFingerprints.windowTopologyDigest,
      "$/sourceFingerprints/windowTopologyDigest",
    ),
    identitySourceDigest: digest(
      wire.sourceFingerprints.identitySourceDigest,
      "$/sourceFingerprints/identitySourceDigest",
    ),
    rootObservationDigest: digest(
      wire.sourceFingerprints.rootObservationDigest,
      "$/sourceFingerprints/rootObservationDigest",
    ),
  });
  const expectedWindowTopologyDigest = computeCanonicalJsonSha256Digest({
    windowId,
    role: wire.role,
    logicalRoot: root,
    configuredPlacement: placement,
  } as unknown as JsonValue);
  if (
    actualObservationDigest !== expectedObservation.observationDigest
    || sourceFingerprints.rootObservationDigest
      !== expectedObservation.observationDigest
    || sourceFingerprints.windowTopologyDigest !== expectedWindowTopologyDigest
  ) {
    failRecord("relation", "$/sourceFingerprints");
  }
  const normalized = {
    kind: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_KIND,
    schemaVersion: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_VERSION,
    programId,
    hostId: wire.hostId,
    windowId,
    role: wire.role,
    logicalRoot: root,
    configuredPlacement: placement,
    identity: Object.freeze({ status: "unregistered" as const }),
    rootObservation: expectedObservation,
    preflight: unregisteredPreflight(),
    sourceFingerprints,
  } satisfies Omit<
    WakeflowWindowRuntimeUnregisteredProjection,
    "projectionDigest"
  >;
  const suppliedProjectionDigest = digest(
    wire.projectionDigest,
    "$/projectionDigest",
  );
  const expectedProjectionDigest = computeCanonicalJsonSha256Digest(
    projectionBasis(normalized) as unknown as JsonValue,
  );
  if (suppliedProjectionDigest !== expectedProjectionDigest) {
    failRecord("digest", "$/projectionDigest");
  }
  return Object.freeze({
    ...projectionBasis(normalized),
    projectionDigest: expectedProjectionDigest,
  });
}

/** 渲染经完整准入的确定性 JSON 文档。 */
export function renderWakeflowWindowRuntimeUnregisteredProjection(
  value: unknown,
): string {
  return renderDeterministicJsonDocument(
    parseWakeflowWindowRuntimeUnregisteredProjection(value),
    "$windowRuntimeProjection",
  );
}

/** 解析确定性 JSON 文档并重验领域关系和自身摘要。 */
export function parseWakeflowWindowRuntimeUnregisteredProjectionDocument(
  text: unknown,
): Readonly<WakeflowWindowRuntimeUnregisteredProjection> {
  let value: JsonValue;
  try {
    value = parseDeterministicJsonDocument(
      text,
      "$windowRuntimeProjection",
    );
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      failRecord("representation", error.path);
    }
    throw error;
  }
  const projection = parseWakeflowWindowRuntimeUnregisteredProjection(value);
  if (
    renderDeterministicJsonDocument(projection, "$windowRuntimeProjection")
      !== text
  ) {
    failRecord("representation", "$windowRuntimeProjection");
  }
  return projection;
}

function projectionFor(
  programId: WakeflowDurableId<"program">,
  hostId: WakeflowWorkspaceHostId,
  desiredTopologyDigest: Sha256Digest,
  identitySourceDigest: Sha256Digest,
  window: Readonly<WakeflowWindowRuntimeDesiredWindow>,
): Readonly<WakeflowWindowRuntimeUnregisteredProjection> {
  const observation = rootObservation(
    window.logicalRoot,
    window.configuredPlacement,
  );
  const basis = {
    kind: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_KIND,
    schemaVersion: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_VERSION,
    programId,
    hostId,
    windowId: window.windowId,
    role: window.role,
    logicalRoot: window.logicalRoot,
    configuredPlacement: window.configuredPlacement,
    identity: Object.freeze({ status: "unregistered" as const }),
    rootObservation: observation,
    preflight: unregisteredPreflight(),
    sourceFingerprints: Object.freeze({
      desiredTopologyDigest,
      windowTopologyDigest: window.windowTopologyDigest,
      identitySourceDigest,
      rootObservationDigest: observation.observationDigest,
    }),
  };
  return parseWakeflowWindowRuntimeUnregisteredProjection({
    ...projectionBasis(basis),
    projectionDigest: computeCanonicalJsonSha256Digest(
      projectionBasis(basis) as unknown as JsonValue,
    ),
  });
}

function entryFor(
  profileValue: unknown,
  projection: Readonly<WakeflowWindowRuntimeUnregisteredProjection>,
): Readonly<WakeflowWindowRuntimeUnregisteredProjectionEntry> {
  const document = renderDeterministicJsonDocument(
    parseWakeflowWindowRuntimeUnregisteredProjection(projection),
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

/** 从同一 Config/Host 的 desired topology 与空 identity source 生成全部未注册投影。 */
export function compileWakeflowWindowRuntimeUnregisteredProjectionSet(
  configValue: unknown,
  profileValue: unknown,
): Readonly<WakeflowWindowRuntimeUnregisteredProjectionSet> {
  const desired = compileWakeflowWindowRuntimeDesiredTopology(
    configValue,
    profileValue,
  );
  const identity = compileWakeflowWindowRuntimeUnregisteredIdentitySource(
    configValue,
    profileValue,
  );
  const identityByWindowId = new Map(identity.entries.map((entry) => (
    [entry.windowId, entry] as const
  )));
  if (
    identity.programId !== desired.programId
    || identity.hostId !== desired.hostId
    || identity.desiredTopologyDigest !== desired.desiredTopologyDigest
    || identity.entries.length !== desired.windows.length
    || desired.windows.some((window) => (
      identityByWindowId.get(window.windowId)?.status !== "unregistered"
    ))
  ) {
    throw new WakeflowWindowRuntimeUnregisteredProjectionError();
  }
  const entries = Object.freeze(desired.windows.map((window) => entryFor(
    profileValue,
    projectionFor(
      desired.programId,
      desired.hostId,
      desired.desiredTopologyDigest,
      identity.identitySourceDigest,
      window,
    ),
  )));
  const basis = {
    kind: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_SET_KIND,
    schemaVersion: 1 as const,
    programId: desired.programId,
    hostId: desired.hostId,
    projectionRootRef: wakeflowWindowRuntimeProjectionRootRef(profileValue),
    desiredTopologyDigest: desired.desiredTopologyDigest,
    identitySourceDigest: identity.identitySourceDigest,
    entries: entries.map((entry) => ({
      windowId: entry.windowId,
      resourceRef: entry.resourceRef,
      projectionDigest: entry.projection.projectionDigest,
      documentDigest: entry.documentDigest,
    })),
  };
  return Object.freeze({
    ...basis,
    entries,
    projectionSetDigest: computeCanonicalJsonSha256Digest(
      basis as unknown as JsonValue,
    ),
  });
}
