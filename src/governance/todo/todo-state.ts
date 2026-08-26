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
} from "../../foundation/identity/wakeflow-durable-id.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../foundation/time/utc-instant.js";
import {
  readUtcWallClock,
  type UtcWallClock,
} from "../../foundation/time/wall-clock.js";
import type { TodoIntake } from "./todo-intake.js";
import {
  parseTodoItemId,
  TodoItemIdError,
  type TodoItemId,
} from "./todo-item-id.js";

/**
 * Wakeflow Governance / TODO：TODO item 的唯一可变状态快照与前向转换。
 *
 * revision 1 从 immutable intake 创建；后续状态保存 previousStateDigest。Claim 绑定
 * demand mount，Archive 只从 exact claimed state 创建 `archived` 终态并写入业务归档
 * receipt。领域 transaction 负责锁、journal、磁盘 exact-source replace 和 projection，
 * 本文件保持纯函数。
 */

export const TODO_STATE_ARTIFACT_KIND = "wakeflow-todo-state" as const;
export const TODO_STATE_SCHEMA_VERSION = 1 as const;

export type TodoStatus =
  | "pending-claim"
  | "parked"
  | "claimed"
  | "blocked"
  | "observing"
  | "completed"
  | "cancelled"
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

/** BusinessArchive owner 交给 TODO owner 的完整归档授权。 */
export type TodoArchiveAuthorizationReceipt = Readonly<
  Omit<TodoArchiveReceipt, "archivedAt">
>;

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

/** TODO state 准入、关系、转换或 representation 失败的稳定错误。 */
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
    || state.status === "completed"
    || state.status === "cancelled"
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

/** 解析任意内存值为规范化 TODO state。 */
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

/** 解析 public/domain claim 使用的精确 demand mount。 */
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
  return readUtcWallClock(record.clock as UtcWallClock | undefined);
}

/** 从 exact pending-claim state 纯计算 claimed state。 */
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
  return parseTodoState({
    artifactKind: TODO_STATE_ARTIFACT_KIND,
    schemaVersion: TODO_STATE_SCHEMA_VERSION,
    todoId: current.todoId,
    revision: current.revision + 1,
    previousStateDigest: computeTodoStateDigest(current),
    status: "claimed",
    updatedAt: readTransitionClock(options),
    mount,
    archive: null,
  });
}

/** 从 exact claimed state 和 BusinessArchive receipt 纯计算 archived state。 */
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
  const archivedAt = readTransitionClock(options);
  const claimedStateDigest = computeTodoStateDigest(current);
  if (
    parseDigest(
      receipt.claimedStateDigest,
      "$/archive/claimedStateDigest",
    ) !== claimedStateDigest
  ) {
    fail("archive", "$/archive/claimedStateDigest");
  }
  return parseTodoState({
    artifactKind: TODO_STATE_ARTIFACT_KIND,
    schemaVersion: TODO_STATE_SCHEMA_VERSION,
    todoId: current.todoId,
    revision: current.revision + 1,
    previousStateDigest: claimedStateDigest,
    status: "archived",
    updatedAt: archivedAt,
    mount: current.mount,
    archive: {
      artifactKind: "wakeflow-business-archive-receipt",
      schemaVersion: 1,
      archiveId: receipt.archiveId,
      demandId,
      todoId,
      intakeDigest: parseDigest(
        receipt.intakeDigest,
        "$/archive/intakeDigest",
      ),
      claimedStateDigest,
      manifestDigest: receipt.manifestDigest,
      archivedAt,
    },
  });
}

/** 渲染 state 的唯一 deterministic pretty 表示。 */
export function renderTodoState(state: unknown): string {
  return renderDeterministicJsonDocument(parseTodoState(state), "$state");
}

/** 解析磁盘 state 文档并拒绝领域顺序或 representation 漂移。 */
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

/** 计算 state canonical semantic digest。 */
export function computeTodoStateDigest(state: unknown): Sha256Digest {
  return computeCanonicalJsonSha256Digest(
    parseTodoState(state) as unknown as JsonValue,
  );
}
