import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import type { WakeflowDemandCompletion as DemandCompletionWire } from "../../contracts/generated/governance/lifecycle/demand-completion.generated.js";
import { WAKEFLOW_DEMAND_COMPLETION_SCHEMA } from "../../contracts/generated/governance/lifecycle/demand-completion.generated.js";
import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
  WakeflowDurableIdError,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  type Sha256Digest,
  Sha256Error,
} from "../../foundation/crypto/sha256.js";
import {
  type JsonValue,
  JsonValueError,
  parseJsonValue,
} from "../../foundation/data/json-value.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  parseUtcInstant,
  type UtcInstant,
  UtcInstantError,
} from "../../foundation/time/utc-instant.js";
import {
  readUtcWallClock,
  type UtcWallClock,
  UtcWallClockError,
} from "../../foundation/time/wall-clock.js";
import {
  parseRequirementLineageReference,
  RequirementLineageError,
} from "../ledger/requirement-lineage.js";

/**
 * Wakeflow Governance / Lifecycle：Demand成功终态的不可变事件载荷。
 *
 * Completion绑定Controller、冻结Authority、testing mode、post-acceptance route、Review
 * Snapshot、Event Stream和已认领的需求包来源。它不删除Test lineage，也不执行看板归档、
 * BusinessArchive或宿主关闭。
 */

const COMPLETION_KIND = "WakeflowDemandCompletion" as const;
const COMPLETION_SCHEMA_VERSION = 1 as const;

/** `not-applicable` 只属于 research Demand：完成物是 document 类受管证据（§13.94 D8）。 */
export type DemandCompletionTestingMode = "controller-only" | "real-environment" | "not-applicable";

/** 完成时看板上需求包的认领状态与其 Ledger 记录谱系。 */
export interface DemandCompletionPackageSource {
  readonly requirementId: WakeflowDurableId<"requirement">;
  readonly recordRef: PortableResourcePath;
  readonly recordDigest: Sha256Digest;
  readonly claimStateRevision: number;
  readonly claimStateDigest: Sha256Digest;
}

export interface DemandCompletion {
  readonly kind: typeof COMPLETION_KIND;
  readonly schemaVersion: typeof COMPLETION_SCHEMA_VERSION;
  readonly programId: WakeflowDurableId<"program">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly controllerWindowId: WakeflowDurableId<"window">;
  readonly authorityDigest: Sha256Digest;
  readonly testingMode: DemandCompletionTestingMode;
  readonly postAcceptanceRouteDigest: Sha256Digest;
  readonly reviewSnapshotDigest: Sha256Digest;
  readonly observedState: Readonly<{
    readonly streamRevision: number;
    readonly stateDigest: Sha256Digest;
    readonly lastEventId: WakeflowDurableId<"demand-event">;
    readonly lastEventDigest: Sha256Digest;
  }>;
  readonly packageSource: Readonly<DemandCompletionPackageSource>;
  readonly completedAt: UtcInstant;
  readonly completionDigest: Sha256Digest;
}

/** 上层Route owner验证后交给Completion codec的最小来源投影。 */
export interface DemandCompletionRouteSource {
  readonly status: "completion-preflight";
  readonly testingClosure: Readonly<{
    readonly mode: DemandCompletionTestingMode;
  }>;
  readonly programId: WakeflowDurableId<"program">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly authorityDigest: Sha256Digest;
  readonly routeDigest: Sha256Digest;
  readonly reviewSnapshotDigest: Sha256Digest;
  readonly observedState: DemandCompletion["observedState"];
}

export interface CreateDemandCompletionInput {
  readonly controllerWindowId: WakeflowDurableId<"window">;
  readonly routeSource: Readonly<DemandCompletionRouteSource>;
  readonly packageSource: Readonly<DemandCompletionPackageSource>;
}

export interface CreateDemandCompletionOptions {
  readonly clock?: UtcWallClock;
}

export type DemandCompletionErrorReason =
  | "json"
  | "schema"
  | "identifier"
  | "digest"
  | "path"
  | "position"
  | "time"
  | "route"
  | "package";

/** Demand成功终态记录准入、创建或来源闭合失败时的稳定错误。 */
export class DemandCompletionError extends ModuleError<DemandCompletionErrorReason> {
  static override readonly code = "wakeflow-demand-completion";
}

const fail: Fail<DemandCompletionErrorReason> = failWith(DemandCompletionError);

const validateWire = createRuntimeJsonSchemaValidator<DemandCompletionWire>(
  WAKEFLOW_DEMAND_COMPLETION_SCHEMA,
  [
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
  ],
);

function id<Kind extends "program" | "demand" | "window" | "demand-event">(
  value: unknown,
  kind: Kind,
  path: string,
): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path, error);
    throw error;
  }
}

function digest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path, error);
    throw error;
  }
}

function completionBasis(
  value: Omit<DemandCompletion, "completionDigest">,
): Omit<DemandCompletion, "completionDigest"> {
  return {
    kind: COMPLETION_KIND,
    schemaVersion: COMPLETION_SCHEMA_VERSION,
    programId: value.programId,
    demandId: value.demandId,
    controllerWindowId: value.controllerWindowId,
    authorityDigest: value.authorityDigest,
    testingMode: value.testingMode,
    postAcceptanceRouteDigest: value.postAcceptanceRouteDigest,
    reviewSnapshotDigest: value.reviewSnapshotDigest,
    observedState: value.observedState,
    packageSource: value.packageSource,
    completedAt: value.completedAt,
  };
}

/** 完成记录里的需求包来源：按需求谱系引用的合同解析，错误路径改写到 `$/packageSource` 之下。 */
function parsePackageSourceLineage(
  source: Readonly<{ requirementId: unknown; recordRef: unknown; recordDigest: unknown }>,
): ReturnType<typeof parseRequirementLineageReference> {
  try {
    return parseRequirementLineageReference({
      artifactKind: "wakeflow-requirement-lineage",
      schemaVersion: 1,
      requirementId: source.requirementId,
      recordRef: source.recordRef,
      recordDigest: source.recordDigest,
    });
  } catch (error: unknown) {
    if (error instanceof RequirementLineageError) {
      fail(
        error.reason === "path" ? "path" : "package",
        `$/packageSource${error.path.slice(1)}`,
        error,
      );
    }
    throw error;
  }
}

function parseCompletedAt(value: unknown): UtcInstant {
  try {
    return parseUtcInstant(value, "$/completedAt");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", "$/completedAt", error);
    throw error;
  }
}

/** 严格解析并复验self-excluding digest的Demand Completion。 */
export function parseDemandCompletion(value: unknown): Readonly<DemandCompletion> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$completion");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path, error);
    throw error;
  }
  const validated = validateWire(json);
  if (!validated.ok) fail("schema", validated.path);
  const wire = validated.value;
  const lineage = parsePackageSourceLineage(wire.packageSource);
  if (
    !Number.isSafeInteger(wire.observedState.streamRevision) ||
    wire.observedState.streamRevision < 1 ||
    !Number.isSafeInteger(wire.packageSource.claimStateRevision) ||
    wire.packageSource.claimStateRevision < 2
  ) {
    fail("position", "$completion");
  }
  const completedAt = parseCompletedAt(wire.completedAt);
  const basis = completionBasis({
    kind: COMPLETION_KIND,
    schemaVersion: COMPLETION_SCHEMA_VERSION,
    programId: id(wire.programId, "program", "$/programId"),
    demandId: id(wire.demandId, "demand", "$/demandId"),
    controllerWindowId: id(wire.controllerWindowId, "window", "$/controllerWindowId"),
    authorityDigest: digest(wire.authorityDigest, "$/authorityDigest"),
    testingMode: wire.testingMode,
    postAcceptanceRouteDigest: digest(
      wire.postAcceptanceRouteDigest,
      "$/postAcceptanceRouteDigest",
    ),
    reviewSnapshotDigest: digest(wire.reviewSnapshotDigest, "$/reviewSnapshotDigest"),
    observedState: Object.freeze({
      streamRevision: wire.observedState.streamRevision,
      stateDigest: digest(wire.observedState.stateDigest, "$/observedState/stateDigest"),
      lastEventId: id(
        wire.observedState.lastEventId,
        "demand-event",
        "$/observedState/lastEventId",
      ),
      lastEventDigest: digest(
        wire.observedState.lastEventDigest,
        "$/observedState/lastEventDigest",
      ),
    }),
    packageSource: Object.freeze({
      requirementId: lineage.requirementId,
      recordRef: lineage.recordRef,
      recordDigest: lineage.recordDigest,
      claimStateRevision: wire.packageSource.claimStateRevision,
      claimStateDigest: digest(
        wire.packageSource.claimStateDigest,
        "$/packageSource/claimStateDigest",
      ),
    }),
    completedAt,
  });
  const completionDigest = digest(wire.completionDigest, "$/completionDigest");
  if (computeCanonicalJsonSha256Digest(basis) !== completionDigest) {
    fail("digest", "$/completionDigest");
  }
  return Object.freeze({ ...basis, completionDigest });
}

/** 从completion-preflight route和精确claimed需求包来源创建成功终态记录。 */
export function createDemandCompletion(
  input: Readonly<CreateDemandCompletionInput>,
  options: CreateDemandCompletionOptions = {},
): Readonly<DemandCompletion> {
  if (input.routeSource.status !== "completion-preflight") {
    fail("route", "$routeSource");
  }
  let completedAt: UtcInstant;
  try {
    completedAt =
      options.clock === undefined ? readUtcWallClock() : readUtcWallClock(options.clock);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("time", "$clock", error);
    throw error;
  }
  const basis = completionBasis({
    kind: COMPLETION_KIND,
    schemaVersion: COMPLETION_SCHEMA_VERSION,
    programId: input.routeSource.programId,
    demandId: input.routeSource.demandId,
    controllerWindowId: input.controllerWindowId,
    authorityDigest: input.routeSource.authorityDigest,
    testingMode: input.routeSource.testingClosure.mode,
    postAcceptanceRouteDigest: input.routeSource.routeDigest,
    reviewSnapshotDigest: input.routeSource.reviewSnapshotDigest,
    observedState: input.routeSource.observedState,
    packageSource: input.packageSource,
    completedAt,
  });
  return parseDemandCompletion({
    ...basis,
    completionDigest: computeCanonicalJsonSha256Digest(basis),
  });
}
