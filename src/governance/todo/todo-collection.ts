import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import { compareUtcInstants } from "../../foundation/time/utc-instant.js";
import {
  computeTodoIntakeDigest,
  parseTodoIntake,
  TodoIntakeError,
  type TodoIntake,
} from "./todo-intake.js";
import type { TodoItemId } from "./todo-item-id.js";
import { todoItemStorageKey, type TodoItemStorageKey } from "./todo-paths.js";
import {
  computeTodoStateDigest,
  parseTodoState,
  TodoStateError,
  type TodoState,
} from "./todo-state.js";

/**
 * Wakeflow Governance / TODO：完整条目清单的确定性集合快照。
 *
 * 每个条目由不可变 Intake 和唯一当前 State 组成。本模块验证 ID 关联、存储键、重复
 * 条目、确定性排序和集合摘要，并把 pending/parked/claimed 计为活动调度条目。
 * withdrawn/archived 仍保留在权威与摘要中，但不计入活动数量。本模块不枚举文件系统、
 * 不持有集合锁，也不把 Markdown 投影作为快照输入。
 */

const TODO_COLLECTION_SNAPSHOT_KIND =
  "wakeflow-todo-collection-snapshot" as const;
const TODO_COLLECTION_SNAPSHOT_VERSION = 1 as const;
export const TODO_COLLECTION_MAXIMUM_ITEMS = 65_536;

export interface TodoCollectionItem {
  readonly todoId: TodoItemId;
  readonly storageKey: TodoItemStorageKey;
  readonly intake: Readonly<TodoIntake>;
  readonly state: Readonly<TodoState>;
  readonly intakeDigest: Sha256Digest;
  readonly stateDigest: Sha256Digest;
}

export interface TodoCollectionSnapshot {
  readonly artifactKind: typeof TODO_COLLECTION_SNAPSHOT_KIND;
  readonly schemaVersion: typeof TODO_COLLECTION_SNAPSHOT_VERSION;
  readonly itemCount: number;
  readonly activeItemCount: number;
  readonly items: readonly Readonly<TodoCollectionItem>[];
  readonly collectionDigest: Sha256Digest;
}

export type TodoCollectionErrorReason =
  | "input"
  | "too-many-items"
  | "item-shape"
  | "item-identity"
  | "item-lineage"
  | "duplicate";

const ERROR_MESSAGES = {
  "input": "TODO collection input is invalid.",
  "too-many-items": "TODO collection exceeds its item budget.",
  "item-shape": "TODO collection item shape is invalid.",
  "item-identity": "TODO collection intake and state identities differ.",
  "item-lineage": "TODO collection state is unreachable from its immutable intake.",
  "duplicate": "TODO collection contains a duplicate TODO item.",
} as const satisfies Readonly<Record<TodoCollectionErrorReason, string>>;

/** TODO collection 归约失败的稳定、脱敏错误。 */
export class TodoCollectionError extends Error {
  override readonly name = "TodoCollectionError";
  readonly code = "wakeflow-todo-collection" as const;
  readonly reason: TodoCollectionErrorReason;
  readonly path: string;

  constructor(reason: TodoCollectionErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(reason: TodoCollectionErrorReason, path: string): never {
  throw new TodoCollectionError(reason, path);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareItems(
  left: Readonly<TodoCollectionItem>,
  right: Readonly<TodoCollectionItem>,
): number {
  const time = compareUtcInstants(left.intake.createdAt, right.intake.createdAt);
  return time === 0 ? compareText(left.todoId, right.todoId) : time;
}

const STATE_REVISION_BY_INITIAL_READINESS = Object.freeze({
  ready: Object.freeze({
    "pending-claim": 1,
    parked: null,
    claimed: 2,
    withdrawn: 2,
    archived: 3,
  }),
  parked: Object.freeze({
    "pending-claim": 2,
    parked: 1,
    claimed: 3,
    withdrawn: 2,
    archived: 4,
  }),
} as const satisfies Readonly<Record<
  TodoIntake["readiness"]["status"],
  Readonly<Record<TodoState["status"], number | null>>
>>);

function normalizeItem(value: unknown, index: number): Readonly<TodoCollectionItem> {
  const path = `$items/${index}`;
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("item-shape", path);
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "intake" || keys[1] !== "state") {
    fail("item-shape", path);
  }
  let intake: Readonly<TodoIntake>;
  let state: Readonly<TodoState>;
  try {
    intake = parseTodoIntake(record.intake);
    state = parseTodoState(record.state);
  } catch (error: unknown) {
    if (error instanceof TodoIntakeError || error instanceof TodoStateError) {
      fail("item-shape", path);
    }
    throw error;
  }
  if (intake.todoId !== state.todoId) fail("item-identity", path);
  const expectedRevision =
    STATE_REVISION_BY_INITIAL_READINESS[intake.readiness.status][state.status];
  if (expectedRevision === null || state.revision !== expectedRevision) {
    fail("item-lineage", path);
  }
  return Object.freeze({
    todoId: intake.todoId,
    storageKey: todoItemStorageKey(intake.todoId),
    intake,
    state,
    intakeDigest: computeTodoIntakeDigest(intake),
    stateDigest: computeTodoStateDigest(state),
  });
}

function digestBasis(items: readonly Readonly<TodoCollectionItem>[]) {
  return {
    artifactKind: TODO_COLLECTION_SNAPSHOT_KIND,
    schemaVersion: TODO_COLLECTION_SNAPSHOT_VERSION,
    items: items.map((item) => ({
      todoId: item.todoId,
      storageKey: item.storageKey,
      intakeDigest: item.intakeDigest,
      stateDigest: item.stateDigest,
    })),
  };
}

/** 判断状态是否仍属于当前调度集合；终态仍保留在权威和集合摘要中。 */
export function isTodoCollectionStatusActive(
  status: TodoState["status"],
): boolean {
  return status !== "withdrawn" && status !== "archived";
}

/** 从一组 Intake/State 配对生成完整、排序且冻结的集合快照。 */
export function createTodoCollectionSnapshot(
  value: unknown,
): Readonly<TodoCollectionSnapshot> {
  let entries: readonly unknown[];
  try {
    entries = parseDenseArray(value, TODO_COLLECTION_MAXIMUM_ITEMS, "$items");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      if (error.reason === "array-length") {
        fail("too-many-items", "$items");
      }
      fail("input", "$items");
    }
    throw error;
  }
  const items = entries.map(normalizeItem).sort(compareItems);
  const ids = new Set<string>();
  const storageKeys = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (ids.has(item.todoId) || storageKeys.has(item.storageKey)) {
      fail("duplicate", `$items/${index}`);
    }
    ids.add(item.todoId);
    storageKeys.add(item.storageKey);
  }
  const frozenItems = Object.freeze(items);
  return Object.freeze({
    artifactKind: TODO_COLLECTION_SNAPSHOT_KIND,
    schemaVersion: TODO_COLLECTION_SNAPSHOT_VERSION,
    itemCount: frozenItems.length,
    activeItemCount: frozenItems.filter(
      (item) => isTodoCollectionStatusActive(item.state.status),
    ).length,
    items: frozenItems,
    collectionDigest: computeCanonicalJsonSha256Digest(digestBasis(frozenItems)),
  });
}
