import type {
  ArchiveReceipt as TodoArchiveReceiptWire,
  DemandMount as TodoDemandMountWire,
  WakeflowTodoState as TodoStateWire,
} from "../../contracts/generated/governance/todo/todo-state.generated.js";
import { WAKEFLOW_TODO_STATE_SCHEMA } from "../../contracts/generated/governance/todo/todo-state.generated.js";
import { WAKEFLOW_TODO_ITEM_ID_SCHEMA } from "../../contracts/generated/governance/todo/todo-item-id.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../../foundation/data/deterministic-json-document.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
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
import type { TodoIntake } from "./todo-intake.js";
import {
  parseTodoItemId,
  TodoItemIdError,
  type TodoItemId,
} from "./todo-item-id.js";

/**
 * Wakeflow Governance / TODO：TODO 条目的唯一可变状态快照与前向转换。
 *
 * 修订 1 从不可变接收记录创建为待领取或等待依赖；领取操作绑定 Demand 挂载；Archive
 * 只能从指定的已申领状态创建 `archived` 终态，并写入业务归档回执。Demand/Task 的
 * blocked、observing、completed 与 cancelled 生命周期不在 TODO 状态中重复保存。
 * 领域事务负责互斥锁、恢复意图、磁盘条件替换和投影发布，本模块保持为纯函数。
 */

const TODO_STATE_ARTIFACT_KIND = "wakeflow-todo-state" as const;
const TODO_STATE_SCHEMA_VERSION = 1 as const;

export type TodoStatus =
  | "pending-claim"
  | "parked"
  | "claimed"
  | "archived";

export interface TodoDemandMount {
  readonly demandId: WakeflowDurableId<"demand">;
  readonly stateRootRef: PortableResourcePath;
  readonly identityDigest: Sha256Digest;
}

export interface TodoArchiveReceipt {
  readonly artifactKind: "wakeflow-business-archive-receipt";
  readonly schemaVersion: 1;
  readonly archiveId: WakeflowDurableId<"archive">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly todoId: TodoItemId;
  readonly intakeDigest: Sha256Digest;
  readonly claimedStateDigest: Sha256Digest;
  readonly manifestDigest: Sha256Digest;
  readonly archivedAt: UtcInstant;
}

export interface TodoState {
  readonly artifactKind: typeof TODO_STATE_ARTIFACT_KIND;
  readonly schemaVersion: typeof TODO_STATE_SCHEMA_VERSION;
  readonly todoId: TodoItemId;
  readonly revision: number;
  readonly previousStateDigest: Sha256Digest | null;
  readonly status: TodoStatus;
  readonly updatedAt: UtcInstant;
  readonly mount: Readonly<TodoDemandMount> | null;
  readonly archive: Readonly<TodoArchiveReceipt> | null;
}

export interface TodoStateTransitionOptions {
  readonly clock?: UtcWallClock;
}

export type TodoStateErrorReason =
  | "input"
  | "json"
  | "schema"
  | "identifier"
  | "digest"
  | "time"
  | "mount"
  | "revision"
  | "status"
  | "archive"
  | "representation";

const ERROR_MESSAGES = {
  "input": "TODO state input is invalid.",
  "json": "TODO state is not passive JSON data.",
  "schema": "TODO state does not satisfy its portable Schema.",
  "identifier": "TODO state contains an invalid typed identifier.",
  "digest": "TODO state contains an invalid digest.",
  "time": "TODO state contains an invalid UTC instant.",
  "mount": "TODO state demand mount is inconsistent.",
  "revision": "TODO state revision chain is inconsistent.",
  "status": "TODO state status and payload are inconsistent.",
  "archive": "TODO state archive receipt is inconsistent.",
  "representation": "TODO state bytes are not its deterministic domain representation.",
} as const satisfies Readonly<Record<TodoStateErrorReason, string>>;

/** TODO State 准入、关系、转换或持久化表示验证失败时返回的稳定错误。 */
export class TodoStateError extends Error {
  override readonly name = "TodoStateError";
  readonly code = "wakeflow-todo-state" as const;
  readonly reason: TodoStateErrorReason;
  readonly path: string;

  constructor(reason: TodoStateErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWireState = createRuntimeJsonSchemaValidator<TodoStateWire>(
  WAKEFLOW_TODO_STATE_SCHEMA,
  [
    WAKEFLOW_TODO_ITEM_ID_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
  ],
);

const MOUNT_FIELDS = Object.freeze([
  "demandId",
  "identityDigest",
  "stateRootRef",
] as const);
const ARCHIVE_INPUT_FIELDS = Object.freeze([
  "archiveId",
  "artifactKind",
  "claimedStateDigest",
  "demandId",
  "intakeDigest",
  "manifestDigest",
  "schemaVersion",
  "todoId",
] as const);

function fail(reason: TodoStateErrorReason, path: string): never {
  throw new TodoStateError(reason, path);
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path);
    throw error;
  }
}

function parseTime(value: unknown, path: string): UtcInstant {
  try {
    return parseUtcInstant(value, path);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", path);
    throw error;
  }
}

function parseDurableId<K extends "demand" | "archive">(
  value: unknown,
  kind: K,
  path: string,
): WakeflowDurableId<K> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
}

function normalizeMount(
  value: Readonly<TodoDemandMountWire>,
): Readonly<TodoDemandMount> {
  const demandId = parseDurableId(value.demandId, "demand", "$/mount/demandId");
  let stateRootRef: PortableResourcePath;
  try {
    stateRootRef = parsePortableResourcePath(
      value.stateRootRef,
      "$/mount/stateRootRef",
    );
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      fail("mount", "$/mount/stateRootRef");
    }
    throw error;
  }
  if (stateRootRef !== `.wakeflow-active/current/${demandId}`) {
    fail("mount", "$/mount/stateRootRef");
  }
  return Object.freeze({
    demandId,
    stateRootRef,
    identityDigest: parseDigest(value.identityDigest, "$/mount/identityDigest"),
  });
}

function normalizeArchive(
  value: Readonly<TodoArchiveReceiptWire>,
): Readonly<TodoArchiveReceipt> {
  return Object.freeze({
    artifactKind: "wakeflow-business-archive-receipt" as const,
    schemaVersion: 1 as const,
    archiveId: parseDurableId(value.archiveId, "archive", "$/archive/archiveId"),
    demandId: parseDurableId(value.demandId, "demand", "$/archive/demandId"),
    todoId: parseTodoId(value.todoId, "$/archive/todoId"),
    intakeDigest: parseDigest(value.intakeDigest, "$/archive/intakeDigest"),
    claimedStateDigest: parseDigest(
      value.claimedStateDigest,
      "$/archive/claimedStateDigest",
    ),
    manifestDigest: parseDigest(
      value.manifestDigest,
      "$/archive/manifestDigest",
    ),
    archivedAt: parseTime(value.archivedAt, "$/archive/archivedAt"),
  });
}

function assertStateRelations(state: Readonly<TodoState>): void {
  if (
    (state.revision === 1 && state.previousStateDigest !== null)
    || (state.revision > 1 && state.previousStateDigest === null)
  ) {
    fail("revision", "$/previousStateDigest");
  }
  const mounted = state.mount !== null;
  const requiresMount = state.status === "claimed"
    || state.status === "archived";
  if (mounted !== requiresMount) fail("status", "$/mount");

  if (state.status !== "archived") {
    if (state.archive !== null) fail("status", "$/archive");
    return;
  }
  if (
    state.archive === null
    || state.mount === null
    || state.todoId !== state.archive.todoId
    || state.previousStateDigest !== state.archive.claimedStateDigest
    || state.mount.demandId !== state.archive.demandId
    || state.updatedAt !== state.archive.archivedAt
  ) {
    fail("archive", "$/archive");
  }
}

function normalizeWireState(
  wire: Readonly<TodoStateWire>,
): Readonly<TodoState> {
  let todoId: TodoItemId;
  try {
    todoId = parseTodoItemId(wire.todoId, "$/todoId");
  } catch (error: unknown) {
    if (error instanceof TodoItemIdError) fail("identifier", "$/todoId");
    throw error;
  }
  const state = Object.freeze({
    artifactKind: TODO_STATE_ARTIFACT_KIND,
    schemaVersion: TODO_STATE_SCHEMA_VERSION,
    todoId,
    revision: wire.revision,
    previousStateDigest: wire.previousStateDigest === null
      ? null
      : parseDigest(wire.previousStateDigest, "$/previousStateDigest"),
    status: wire.status,
    updatedAt: parseTime(wire.updatedAt, "$/updatedAt"),
    mount: wire.mount === null ? null : normalizeMount(wire.mount),
    archive: wire.archive === null ? null : normalizeArchive(wire.archive),
  });
  assertStateRelations(state);
  return state;
}

function parseTodoId(value: unknown, path: string): TodoItemId {
  try {
    return parseTodoItemId(value, path);
  } catch (error: unknown) {
    if (error instanceof TodoItemIdError) fail("identifier", path);
    throw error;
  }
}

/** 把任意内存值解析为规范化 TODO 状态。 */
export function parseTodoState(value: unknown): Readonly<TodoState> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$state");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const result = validateWireState(json);
  if (!result.ok) fail("schema", result.path);
  return normalizeWireState(result.value);
}

/** 解析公开接口与领域领取流程使用的精确 Demand 挂载关系。 */
export function parseTodoDemandMount(value: unknown): Readonly<TodoDemandMount> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$mount");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$mount");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== MOUNT_FIELDS.length
    || keys.some((key, index) => key !== MOUNT_FIELDS[index])
  ) {
    fail("input", "$mount");
  }
  return normalizeMount({
    demandId: record.demandId as string,
    stateRootRef: record.stateRootRef as string,
    identityDigest: record.identityDigest as string,
  });
}

/** 从 immutable intake 创建 revision 1 状态。 */
export function createInitialTodoState(
  intake: Readonly<TodoIntake>,
): Readonly<TodoState> {
  return parseTodoState({
    artifactKind: TODO_STATE_ARTIFACT_KIND,
    schemaVersion: TODO_STATE_SCHEMA_VERSION,
    todoId: intake.todoId,
    revision: 1,
    previousStateDigest: null,
    status: intake.initialStatus,
    updatedAt: intake.createdAt,
    mount: null,
    archive: null,
  });
}

function readTransitionClock(options: TodoStateTransitionOptions): UtcInstant {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(options, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (Object.keys(record).some((key) => key !== "clock")) {
    fail("input", "$options");
  }
  try {
    return readUtcWallClock(record.clock as UtcWallClock | undefined);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("time", "$options.clock");
    throw error;
  }
}

function nextRevision(current: Readonly<TodoState>): number {
  if (current.revision >= Number.MAX_SAFE_INTEGER) {
    fail("revision", "$/revision");
  }
  return current.revision + 1;
}

/** 从指定的待领取状态纯计算已领取状态。 */
export function claimTodoState(
  currentValue: unknown,
  mountValue: unknown,
  options: TodoStateTransitionOptions = {},
): Readonly<TodoState> {
  const current = parseTodoState(currentValue);
  if (current.status !== "pending-claim" || current.archive !== null) {
    fail("status", "$/status");
  }
  const mount = parseTodoDemandMount(mountValue);
  const revision = nextRevision(current);
  const previousStateDigest = computeTodoStateDigest(current);
  const updatedAt = readTransitionClock(options);
  return parseTodoState({
    artifactKind: TODO_STATE_ARTIFACT_KIND,
    schemaVersion: TODO_STATE_SCHEMA_VERSION,
    todoId: current.todoId,
    revision,
    previousStateDigest,
    status: "claimed",
    updatedAt,
    mount,
    archive: null,
  });
}

/** 从指定的已领取状态和 Business Archive 回执纯计算已归档状态。 */
export function archiveTodoState(
  currentValue: unknown,
  receiptValue: unknown,
  options: TodoStateTransitionOptions = {},
): Readonly<TodoState> {
  const current = parseTodoState(currentValue);
  if (current.status !== "claimed" || current.mount === null) {
    fail("status", "$/status");
  }
  let receipt: Readonly<Record<string, unknown>>;
  try {
    receipt = parsePlainRecord(receiptValue, "$archiveReceipt");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$archiveReceipt");
    throw error;
  }
  const keys = Object.keys(receipt).sort();
  if (
    keys.length !== ARCHIVE_INPUT_FIELDS.length
    || keys.some((key, index) => key !== ARCHIVE_INPUT_FIELDS[index])
  ) {
    fail("input", "$archiveReceipt");
  }
  if (
    receipt.artifactKind !== "wakeflow-business-archive-receipt"
    || receipt.schemaVersion !== 1
  ) {
    fail("archive", "$/archive");
  }
  const todoId = parseTodoId(receipt.todoId, "$/archive/todoId");
  if (todoId !== current.todoId) fail("archive", "$/archive/todoId");
  const demandId = parseDurableId(
    receipt.demandId,
    "demand",
    "$/archive/demandId",
  );
  if (demandId !== current.mount.demandId) fail("archive", "$/archive/demandId");
  const claimedStateDigest = computeTodoStateDigest(current);
  const admittedClaimedStateDigest = parseDigest(
    receipt.claimedStateDigest,
    "$/archive/claimedStateDigest",
  );
  if (admittedClaimedStateDigest !== claimedStateDigest) {
    fail("archive", "$/archive/claimedStateDigest");
  }
  const archiveId = parseDurableId(
    receipt.archiveId,
    "archive",
    "$/archive/archiveId",
  );
  const intakeDigest = parseDigest(
    receipt.intakeDigest,
    "$/archive/intakeDigest",
  );
  const manifestDigest = parseDigest(
    receipt.manifestDigest,
    "$/archive/manifestDigest",
  );
  const revision = nextRevision(current);
  const archivedAt = readTransitionClock(options);
  return parseTodoState({
    artifactKind: TODO_STATE_ARTIFACT_KIND,
    schemaVersion: TODO_STATE_SCHEMA_VERSION,
    todoId: current.todoId,
    revision,
    previousStateDigest: claimedStateDigest,
    status: "archived",
    updatedAt: archivedAt,
    mount: current.mount,
    archive: {
      artifactKind: "wakeflow-business-archive-receipt",
      schemaVersion: 1,
      archiveId,
      demandId,
      todoId,
      intakeDigest,
      claimedStateDigest,
      manifestDigest,
      archivedAt,
    },
  });
}

/** 渲染 state 的唯一 deterministic pretty 表示。 */
export function renderTodoState(state: unknown): string {
  return renderDeterministicJsonDocument(parseTodoState(state), "$state");
}

/** 解析磁盘 State 文档，并拒绝领域顺序或持久化表示发生漂移。 */
export function parseTodoStateDocument(text: unknown): Readonly<TodoState> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$state");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", error.path);
    }
    throw error;
  }
  const state = parseTodoState(json);
  if (renderTodoState(state) !== text) fail("representation", "$state");
  return state;
}

/** 计算 State 的 Canonical JSON 语义摘要。 */
export function computeTodoStateDigest(state: unknown): Sha256Digest {
  return computeCanonicalJsonSha256Digest(
    parseTodoState(state),
  );
}
