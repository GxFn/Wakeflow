import type { WakeflowDemandCompletion as DemandCompletionWire } from "../../contracts/generated/governance/lifecycle/demand-completion.generated.js";
import { WAKEFLOW_DEMAND_COMPLETION_SCHEMA } from "../../contracts/generated/governance/lifecycle/demand-completion.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_TODO_ITEM_ID_SCHEMA } from "../../contracts/generated/governance/todo/todo-item-id.generated.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../foundation/time/utc-instant.js";
import {
  readUtcWallClock,
  UtcWallClockError,
  type UtcWallClock,
} from "../../foundation/time/wall-clock.js";
import {
  parseTodoItemId,
  TodoItemIdError,
  type TodoItemId,
} from "../todo/todo-item-id.js";
import { todoIntakeRef } from "../todo/todo-paths.js";

/**
 * Wakeflow Governance / Lifecycle：Demand成功终态的不可变事件载荷。
 *
 * Completion绑定Controller、冻结Authority、testing mode、post-acceptance route、Review
 * Snapshot、Event Stream和claimed TODO来源。它不删除Test lineage，也不执行TODO归档、
 * BusinessArchive或宿主关闭。
 */

const COMPLETION_KIND = "WakeflowDemandCompletion" as const;
const COMPLETION_SCHEMA_VERSION = 1 as const;

export type DemandCompletionTestingMode =
  "controller-only" | "real-environment";

export interface DemandCompletionTodoSource {
  readonly todoId: TodoItemId;
  readonly intakeRef: PortableResourcePath;
  readonly intakeDigest: Sha256Digest;
  readonly stateRevision: number;
  readonly stateDigest: Sha256Digest;
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
  readonly todoSource: Readonly<DemandCompletionTodoSource>;
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
  readonly todoSource: Readonly<DemandCompletionTodoSource>;
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
  | "todo"
  | "relation";

const ERROR_MESSAGES = {
  json: "Demand Completion is not passive JSON data.",
  schema: "Demand Completion does not satisfy its Schema.",
  identifier: "Demand Completion contains an invalid typed identity.",
  digest: "Demand Completion contains an invalid or inconsistent digest.",
  path: "Demand Completion contains an invalid TODO reference.",
  position: "Demand Completion contains an invalid revision.",
  time: "Demand Completion contains an invalid completion time.",
  route: "Demand Completion requires a valid completion-preflight route.",
  todo: "Demand Completion TODO source is invalid.",
  relation: "Demand Completion sources are inconsistent.",
} as const satisfies Readonly<Record<DemandCompletionErrorReason, string>>;

/** Demand成功终态记录准入、创建或来源闭合失败时的稳定错误。 */
export class DemandCompletionError extends Error {
  override readonly name = "DemandCompletionError";
  readonly code = "wakeflow-demand-completion" as const;
  readonly reason: DemandCompletionErrorReason;
  readonly path: string;

  constructor(reason: DemandCompletionErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<DemandCompletionWire>(
  WAKEFLOW_DEMAND_COMPLETION_SCHEMA,
  [
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_TODO_ITEM_ID_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
  ],
);

function fail(reason: DemandCompletionErrorReason, path: string): never {
  throw new DemandCompletionError(reason, path);
}

function id<Kind extends "program" | "demand" | "window" | "demand-event">(
  value: unknown,
  kind: Kind,
  path: string,
): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
}

function digest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path);
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
    todoSource: value.todoSource,
    completedAt: value.completedAt,
  };
}

/** 严格解析并复验self-excluding digest的Demand Completion。 */
export function parseDemandCompletion(
  value: unknown,
): Readonly<DemandCompletion> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$completion");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const validated = validateWire(json);
  if (!validated.ok) fail("schema", validated.path);
  const wire = validated.value;
  let todoId: TodoItemId;
  try {
    todoId = parseTodoItemId(wire.todoSource.todoId, "$/todoSource/todoId");
  } catch (error: unknown) {
    if (error instanceof TodoItemIdError) {
      fail("todo", "$/todoSource/todoId");
    }
    throw error;
  }
  let intakeRef: PortableResourcePath;
  try {
    intakeRef = parsePortableResourcePath(
      wire.todoSource.intakeRef,
      "$/todoSource/intakeRef",
    );
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      fail("path", "$/todoSource/intakeRef");
    }
    throw error;
  }
  if (intakeRef !== todoIntakeRef(todoId)) {
    fail("relation", "$/todoSource/intakeRef");
  }
  if (
    !Number.isSafeInteger(wire.observedState.streamRevision) ||
    wire.observedState.streamRevision < 1 ||
    !Number.isSafeInteger(wire.todoSource.stateRevision) ||
    wire.todoSource.stateRevision < 2
  ) {
    fail("position", "$completion");
  }
  let completedAt: UtcInstant;
  try {
    completedAt = parseUtcInstant(wire.completedAt, "$/completedAt");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", "$/completedAt");
    throw error;
  }
  const basis = completionBasis({
    kind: COMPLETION_KIND,
    schemaVersion: COMPLETION_SCHEMA_VERSION,
    programId: id(wire.programId, "program", "$/programId"),
    demandId: id(wire.demandId, "demand", "$/demandId"),
    controllerWindowId: id(
      wire.controllerWindowId,
      "window",
      "$/controllerWindowId",
    ),
    authorityDigest: digest(wire.authorityDigest, "$/authorityDigest"),
    testingMode: wire.testingMode,
    postAcceptanceRouteDigest: digest(
      wire.postAcceptanceRouteDigest,
      "$/postAcceptanceRouteDigest",
    ),
    reviewSnapshotDigest: digest(
      wire.reviewSnapshotDigest,
      "$/reviewSnapshotDigest",
    ),
    observedState: Object.freeze({
      streamRevision: wire.observedState.streamRevision,
      stateDigest: digest(
        wire.observedState.stateDigest,
        "$/observedState/stateDigest",
      ),
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
    todoSource: Object.freeze({
      todoId,
      intakeRef,
      intakeDigest: digest(
        wire.todoSource.intakeDigest,
        "$/todoSource/intakeDigest",
      ),
      stateRevision: wire.todoSource.stateRevision,
      stateDigest: digest(
        wire.todoSource.stateDigest,
        "$/todoSource/stateDigest",
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

/** 从completion-preflight route和精确claimed TODO来源创建成功终态记录。 */
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
      options.clock === undefined
        ? readUtcWallClock()
        : readUtcWallClock(options.clock);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("time", "$clock");
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
    todoSource: input.todoSource,
    completedAt,
  });
  return parseDemandCompletion({
    ...basis,
    completionDigest: computeCanonicalJsonSha256Digest(basis),
  });
}

export function computeDemandCompletionDigest(value: unknown): Sha256Digest {
  return parseDemandCompletion(value).completionDigest;
}
