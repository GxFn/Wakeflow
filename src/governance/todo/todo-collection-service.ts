import { types } from "node:util";

import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  RootedExclusiveFileLockError,
  withRootedExclusiveFileLock,
} from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import {
  UtcWallClockError,
  type UtcWallClock,
} from "../../foundation/time/wall-clock.js";
import {
  inspectTodoCollectionAuthority,
  TodoCollectionAuthorityError,
  type StoredTodoCollectionItem,
  type TodoCollectionAuthoritySnapshot,
} from "./todo-collection-authority.js";
import {
  TodoCollectionServiceError,
  type TodoCollectionServiceErrorReason,
} from "./todo-collection-service-error.js";
import {
  commitTodoCollectionTransaction,
  materializeTodoPrivateDirectory,
  prepareTodoCollectionTransactionRecovery,
  publishTodoBoardProjection,
  recoverTodoCollectionTransactionUnderLock,
  type TodoCollectionTransactionApplication,
} from "./todo-collection-transaction-storage.js";
import {
  createTodoIntake,
  TodoIntakeError,
  type TodoIntake,
} from "./todo-intake.js";
import {
  parseTodoItemId,
  TodoItemIdError,
  type TodoItemId,
} from "./todo-item-id.js";
import {
  parseTodoIntakeLineageReference,
  type TodoIntakeLineageReference,
} from "./todo-intake-lineage.js";
import {
  TODO_COLLECTION_LOCK_REF,
  TODO_COLLECTION_ROOT_REF,
  TODO_ITEMS_ROOT_REF,
  TODO_TRANSACTIONS_ROOT_REF,
} from "./todo-paths.js";
import {
  archiveTodoState,
  claimTodoState,
  createInitialTodoState,
  TodoStateError,
  type TodoState,
} from "./todo-state.js";
import type { TodoTransactionOperation } from "./todo-transaction.js";

export {
  TodoCollectionServiceError,
  type TodoCollectionServiceErrorReason,
} from "./todo-collection-service-error.js";
export { TODO_TRANSACTION_MAXIMUM_BYTES } from "./todo-collection-transaction-storage.js";

/**
 * Wakeflow Governance / TODO：JSON Intake/State 集合的唯一公共职责所有者。
 *
 * Service 负责公共输入、领域状态转换、集合锁和返回结果；领域专属事务存储负责恢复
 * 意图、暂存资源、基于精确源预期的替换和投影发布等物理副作用。两者都只使用固定的
 * TODO 权威引用，不提供通用仓储、`FileManager` 或存储适配器。
 */

export const TODO_COLLECTION_LOCK_TIMEOUT_MILLISECONDS = 10_000;

export interface TodoCollectionMutationOptions {
  readonly expectedCollectionDigest?: Sha256Digest;
  readonly clock?: UtcWallClock;
  readonly signal?: AbortSignal;
}

export interface InitializeTodoCollectionOptions {
  readonly freshWorkspace: true;
  readonly signal?: AbortSignal;
}

export interface TodoCollectionMutationResult {
  readonly operation: TodoTransactionOperation;
  readonly wroteAuthority: boolean;
  readonly wroteProjection: boolean;
  readonly item: Readonly<StoredTodoCollectionItem>;
  readonly lineageRef: Readonly<TodoIntakeLineageReference>;
  readonly snapshot: Readonly<TodoCollectionAuthoritySnapshot>;
}

interface ParsedMutationOptions {
  readonly expectedCollectionDigest: Sha256Digest | undefined;
  readonly clock: UtcWallClock | undefined;
  readonly signal: AbortSignal | undefined;
}

interface ParsedSignalOptions {
  readonly signal: AbortSignal | undefined;
}

const CLAIM_FIELDS = Object.freeze([
  "intakeDigest",
  "mount",
  "stateDigest",
  "todoId",
] as const);
const ARCHIVE_FIELDS = Object.freeze([
  "intakeDigest",
  "receipt",
  "stateDigest",
  "todoId",
] as const);

function fail(reason: TodoCollectionServiceErrorReason, path: string): never {
  throw new TodoCollectionServiceError(reason, path);
}

function mapLockError(error: RootedExclusiveFileLockError): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "timeout") fail("lock-timeout", "$lock");
  if (
    error.reason === "unsafe-lock"
    || error.reason === "parent"
    || error.reason === "root-scope"
  ) {
    fail("lock-unsafe", `$lock/${error.reason}`);
  }
  fail("recovery-required", error.path);
}

function collectionLockOptions(signal: AbortSignal | undefined) {
  return {
    acquireTimeoutMilliseconds: TODO_COLLECTION_LOCK_TIMEOUT_MILLISECONDS,
    ...(signal === undefined ? {} : { signal }),
  };
}

async function runLocked<Result>(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
  operationPath: string,
  operation: () => Result | Promise<Result>,
): Promise<Result> {
  try {
    return await withRootedExclusiveFileLock(
      root,
      TODO_COLLECTION_LOCK_REF,
      operation,
      collectionLockOptions(signal),
    );
  } catch (error: unknown) {
    if (error instanceof TodoCollectionServiceError) throw error;
    if (error instanceof RootedExclusiveFileLockError) mapLockError(error);
    throw new TodoCollectionServiceError("operation-failure", operationPath);
  }
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal;
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("input", path);
    throw error;
  }
}

function optionsRecord(value: unknown): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
}

function parseMutationOptions(value: unknown): Readonly<ParsedMutationOptions> {
  const record = optionsRecord(value);
  const allowed = new Set(["clock", "expectedCollectionDigest", "signal"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    fail("input", "$options");
  }
  if (record.signal !== undefined && !isAbortSignal(record.signal)) {
    fail("input", "$options/signal");
  }
  if (
    record.clock !== undefined
    && (typeof record.clock !== "function" || types.isProxy(record.clock))
  ) {
    fail("input", "$options/clock");
  }
  return Object.freeze({
    expectedCollectionDigest: record.expectedCollectionDigest === undefined
      ? undefined
      : parseDigest(record.expectedCollectionDigest, "$options/expectedCollectionDigest"),
    clock: record.clock as UtcWallClock | undefined,
    signal: record.signal,
  });
}

function parseSignalOptions(value: unknown): Readonly<ParsedSignalOptions> {
  const record = optionsRecord(value);
  if (Object.keys(record).some((key) => key !== "signal")) {
    fail("input", "$options");
  }
  if (record.signal !== undefined && !isAbortSignal(record.signal)) {
    fail("input", "$options/signal");
  }
  return Object.freeze({ signal: record.signal });
}

function exactInput(
  value: unknown,
  fields: readonly string[],
  path: string,
): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", path);
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== fields.length
    || keys.some((key, index) => key !== fields[index])
  ) {
    fail("input", path);
  }
  return record;
}

function parseItemId(value: unknown, path: string): TodoItemId {
  try {
    return parseTodoItemId(value, path);
  } catch (error: unknown) {
    if (error instanceof TodoItemIdError) fail("input", path);
    throw error;
  }
}

function mapAuthorityError(error: TodoCollectionAuthorityError): never {
  if (error.reason === "input") fail("input", error.path);
  if (error.reason === "not-initialized") fail("not-initialized", error.path);
  if (error.reason === "recovery-required") fail("recovery-required", error.path);
  if (error.reason === "aborted") fail("aborted", error.path);
  fail("transaction-conflict", error.path);
}

async function inspectStrict(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<TodoCollectionAuthoritySnapshot>> {
  try {
    return await inspectTodoCollectionAuthority(
      root,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof TodoCollectionAuthorityError) mapAuthorityError(error);
    throw error;
  }
}

function assertCollectionExpectation(
  snapshot: Readonly<TodoCollectionAuthoritySnapshot>,
  expected: Sha256Digest | undefined,
): void {
  if (
    expected !== undefined
    && snapshot.collection.collectionDigest !== expected
  ) {
    fail("cas-mismatch", "$options/expectedCollectionDigest");
  }
}

function createIntakeForAppend(
  draft: unknown,
  clock: UtcWallClock | undefined,
): Readonly<TodoIntake> {
  try {
    return createTodoIntake(draft, clock === undefined ? {} : { clock });
  } catch (error: unknown) {
    if (error instanceof TodoIntakeError) fail("input", "$draft");
    if (error instanceof UtcWallClockError) fail("input", "$options/clock");
    throw error;
  }
}

function claimStateForMutation(
  current: Readonly<TodoState>,
  mount: unknown,
  clock: UtcWallClock | undefined,
): Readonly<TodoState> {
  try {
    return claimTodoState(current, mount, clock === undefined ? {} : { clock });
  } catch (error: unknown) {
    if (error instanceof TodoStateError) {
      if (error.reason === "status") fail("transition", "$claim");
      fail("input", "$claim");
    }
    if (error instanceof UtcWallClockError) fail("input", "$options/clock");
    throw error;
  }
}

function archiveStateForMutation(
  current: Readonly<TodoState>,
  receipt: unknown,
  clock: UtcWallClock | undefined,
): Readonly<TodoState> {
  try {
    return archiveTodoState(
      current,
      receipt,
      clock === undefined ? {} : { clock },
    );
  } catch (error: unknown) {
    if (error instanceof TodoStateError) {
      if (error.reason === "status") fail("transition", "$archive");
      if (error.reason === "archive") {
        fail("authorization", "$archive/receipt");
      }
      fail("input", "$archive/receipt");
    }
    if (error instanceof UtcWallClockError) fail("input", "$options/clock");
    throw error;
  }
}

function lineageFor(
  item: Readonly<StoredTodoCollectionItem>,
): Readonly<TodoIntakeLineageReference> {
  return parseTodoIntakeLineageReference({
    artifactKind: "wakeflow-todo-intake-lineage",
    schemaVersion: 1,
    todoId: item.todoId,
    intakeRef: item.intakeSource.resourcePath,
    intakeDigest: item.intakeDigest,
  });
}

function itemResult(
  applied: Readonly<TodoCollectionTransactionApplication>,
): Readonly<TodoCollectionMutationResult> {
  const item = applied.snapshot.items.find(
    (entry) => entry.todoId === applied.transaction.todoId,
  );
  if (item === undefined) fail("operation-failure", "$item");
  return Object.freeze({
    operation: applied.transaction.operation,
    wroteAuthority: applied.wroteAuthority,
    wroteProjection: applied.wroteProjection,
    item,
    lineageRef: lineageFor(item),
    snapshot: applied.snapshot,
  });
}

/** 为新 Workspace 幂等初始化静态根目录和空投影。 */
export async function initializeTodoCollection(
  root: RootedDirectory,
  options: InitializeTodoCollectionOptions,
): Promise<Readonly<TodoCollectionAuthoritySnapshot>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(options, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (
    !Object.hasOwn(record, "freshWorkspace")
    || Object.keys(record).some(
      (key) => key !== "freshWorkspace" && key !== "signal",
    )
  ) {
    fail("input", "$options");
  }
  if (record.freshWorkspace !== true) fail("input", "$options/freshWorkspace");
  if (record.signal !== undefined && !isAbortSignal(record.signal)) {
    fail("input", "$options/signal");
  }
  const signal = record.signal as AbortSignal | undefined;
  try {
    await materializeTodoPrivateDirectory(root, TODO_COLLECTION_ROOT_REF, signal);
    await materializeTodoPrivateDirectory(root, TODO_ITEMS_ROOT_REF, signal);
    await materializeTodoPrivateDirectory(root, TODO_TRANSACTIONS_ROOT_REF, signal);
    let snapshot = await inspectStrict(root, signal);
    if (snapshot.projection.status !== "current") {
      await publishTodoBoardProjection(root, snapshot, signal);
      snapshot = await inspectStrict(root, signal);
    }
    return snapshot;
  } catch (error: unknown) {
    if (error instanceof TodoCollectionServiceError) throw error;
    throw new TodoCollectionServiceError("operation-failure", "$initialize");
  }
}

/** 创建全新的不可变 Intake 和修订 1 State，并发布投影。 */
export async function appendTodoItem(
  root: RootedDirectory,
  draft: unknown,
  options?: TodoCollectionMutationOptions,
): Promise<Readonly<TodoCollectionMutationResult>> {
  const parsed = parseMutationOptions(options);
  return runLocked(root, parsed.signal, "$append", async () => {
    const current = await inspectStrict(root, parsed.signal);
    assertCollectionExpectation(current, parsed.expectedCollectionDigest);
    const intake = createIntakeForAppend(draft, parsed.clock);
    if (current.items.some((item) => item.todoId === intake.todoId)) {
      fail("duplicate", "$draft/todoId");
    }
    const state = createInitialTodoState(intake);
    return itemResult(await commitTodoCollectionTransaction(
      root,
      "append",
      current,
      intake,
      null,
      state,
      parsed.signal,
    ));
  });
}

/** 根据精确的接收记录/状态预期前向提交领取操作。 */
export async function claimTodoItem(
  root: RootedDirectory,
  input: unknown,
  options?: TodoCollectionMutationOptions,
): Promise<Readonly<TodoCollectionMutationResult>> {
  const values = exactInput(input, CLAIM_FIELDS, "$claim");
  const todoId = parseItemId(values.todoId, "$claim/todoId");
  const intakeDigest = parseDigest(values.intakeDigest, "$claim/intakeDigest");
  const stateDigest = parseDigest(values.stateDigest, "$claim/stateDigest");
  const parsed = parseMutationOptions(options);
  return runLocked(root, parsed.signal, "$claim", async () => {
    const current = await inspectStrict(root, parsed.signal);
    assertCollectionExpectation(current, parsed.expectedCollectionDigest);
    const item = current.items.find((entry) => entry.todoId === todoId);
    if (item === undefined) fail("not-found", "$claim/todoId");
    if (item.intakeDigest !== intakeDigest || item.stateDigest !== stateDigest) {
      fail("cas-mismatch", "$claim");
    }
    const target = claimStateForMutation(item.state, values.mount, parsed.clock);
    return itemResult(await commitTodoCollectionTransaction(
      root,
      "claim",
      current,
      item.intake,
      item.state,
      target,
      parsed.signal,
    ));
  });
}

/** 根据指定的已申领 State 和完整 BusinessArchive 回执提交归档终态。 */
export async function archiveTodoItem(
  root: RootedDirectory,
  input: unknown,
  options?: TodoCollectionMutationOptions,
): Promise<Readonly<TodoCollectionMutationResult>> {
  const values = exactInput(input, ARCHIVE_FIELDS, "$archive");
  const todoId = parseItemId(values.todoId, "$archive/todoId");
  const intakeDigest = parseDigest(values.intakeDigest, "$archive/intakeDigest");
  const stateDigest = parseDigest(values.stateDigest, "$archive/stateDigest");
  const parsed = parseMutationOptions(options);
  return runLocked(root, parsed.signal, "$archive", async () => {
    const current = await inspectStrict(root, parsed.signal);
    assertCollectionExpectation(current, parsed.expectedCollectionDigest);
    const item = current.items.find((entry) => entry.todoId === todoId);
    if (item === undefined) fail("not-found", "$archive/todoId");
    if (item.intakeDigest !== intakeDigest || item.stateDigest !== stateDigest) {
      fail("cas-mismatch", "$archive");
    }
    const target = archiveStateForMutation(
      item.state,
      values.receipt,
      parsed.clock,
    );
    if (
      target.archive === null
      || target.archive.intakeDigest !== item.intakeDigest
    ) {
      fail("authorization", "$archive/receipt/intakeDigest");
    }
    return itemResult(await commitTodoCollectionTransaction(
      root,
      "archive",
      current,
      item.intake,
      item.state,
      target,
      parsed.signal,
    ));
  });
}

/** 读取不可变恢复意图记录，并幂等前向完成权威写入、投影发布和清理。 */
export async function recoverTodoItemTransaction(
  root: RootedDirectory,
  todoIdValue: unknown,
  options?: Pick<TodoCollectionMutationOptions, "signal">,
): Promise<Readonly<TodoCollectionMutationResult>> {
  const todoId = parseItemId(todoIdValue, "$todoId");
  const parsed = parseSignalOptions(options);
  try {
    await prepareTodoCollectionTransactionRecovery(root, todoId, parsed.signal);
  } catch (error: unknown) {
    if (error instanceof TodoCollectionServiceError) throw error;
    throw new TodoCollectionServiceError("operation-failure", "$recover");
  }
  return runLocked(root, parsed.signal, "$recover", async () => (
    itemResult(await recoverTodoCollectionTransactionUnderLock(
      root,
      todoId,
      parsed.signal,
    ))
  ));
}

/** 对外只读入口，保持 collection service 错误面。 */
export async function inspectTodoItems(
  root: RootedDirectory,
  signal?: AbortSignal,
): Promise<Readonly<TodoCollectionAuthoritySnapshot>> {
  return inspectStrict(root, signal);
}
