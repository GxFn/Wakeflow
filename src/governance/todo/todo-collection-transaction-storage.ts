import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { DeterministicJsonDocumentError } from "../../foundation/data/deterministic-json-document.js";
import {
  readDeterministicJsonFile,
  type DeterministicJsonFileResult,
} from "../../foundation/filesystem/deterministic-json-file.js";
import {
  createFileAtomically,
  replaceFileAtomically,
  DurableAtomicFileWriteError,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  recoverDurableAtomicFileStagesInDirectory,
  DurableAtomicFileStageRecoveryError,
} from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import {
  materializeDirectoryPath,
  DurableDirectoryMaterializationError,
} from "../../foundation/filesystem/durable-directory-materialization.js";
import {
  renameResourceDurably,
  DurableResourceRenameError,
} from "../../foundation/filesystem/durable-resource-rename.js";
import {
  unlinkRegularFileExactly,
  ExactRegularFileUnlinkError,
} from "../../foundation/filesystem/exact-regular-file-unlink.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  inspectRootedExclusiveFileLock,
  retireRootedExclusiveFileLockResidue,
  RootedExclusiveFileLockError,
} from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../../foundation/filesystem/stable-directory-read.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../foundation/filesystem/strict-text-file.js";
import {
  parseByteCount,
  type ByteCount,
} from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  inspectTodoCollectionAuthority,
  inspectTodoCollectionAuthorityForRecovery,
  TodoCollectionAuthorityError,
  TODO_AUTHORITY_DIRECTORY_MODE,
  TODO_AUTHORITY_FILE_MODE,
  TODO_INTAKE_MAXIMUM_BYTES,
  TODO_PROJECTION_MAXIMUM_BYTES,
  TODO_STATE_MAXIMUM_BYTES,
  type TodoCollectionAuthoritySnapshot,
} from "./todo-collection-authority.js";
import { renderTodoBoardProjection } from "./todo-board-projection.js";
import { createTodoCollectionSnapshot } from "./todo-collection.js";
import {
  TodoCollectionServiceError,
  type TodoCollectionServiceErrorReason,
} from "./todo-collection-service-error.js";
import {
  computeTodoIntakeDigest,
  parseTodoIntake,
  renderTodoIntake,
  type TodoIntake,
} from "./todo-intake.js";
import type { TodoItemId } from "./todo-item-id.js";
import {
  TODO_BOARD_PROJECTION_REF,
  TODO_COLLECTION_LOCK_REF,
  TODO_TRANSACTIONS_ROOT_REF,
  todoAppendStageRef,
  todoItemRootRef,
  todoStateRef,
  todoTransactionRef,
} from "./todo-paths.js";
import {
  computeTodoStateDigest,
  parseTodoState,
  renderTodoState,
  type TodoState,
} from "./todo-state.js";
import {
  parseTodoTransaction,
  renderTodoTransaction,
  type TodoTransaction,
  type TodoTransactionOperation,
} from "./todo-transaction.js";

/**
 * Wakeflow Governance / TODO：collection transaction 的领域专属物理执行层。
 *
 * 本文件只消费已验证 TODO intake/state/transaction 与固定 TODO refs，执行 journal、
 * stage、exact-source replace、projection publish 和恢复。公共输入、状态选择、
 * collection lock critical section 与结果语义仍只由 `todo-collection-service` 拥有；
 * 本模块不是通用 repository、storage backend 或第二个 authority owner。
 */

export const TODO_TRANSACTION_MAXIMUM_BYTES = parseByteCount(1024 * 1024);

interface JournalSource {
  readonly resourcePath: PortableResourcePath;
  readonly node: Readonly<FileNodeSnapshot>;
  readonly digest: Sha256Digest;
}

interface AppliedTransaction {
  readonly snapshot: Readonly<TodoCollectionAuthoritySnapshot>;
  readonly wroteAuthority: boolean;
  readonly wroteProjection: boolean;
}

export interface TodoCollectionTransactionApplication
  extends AppliedTransaction {
  readonly transaction: Readonly<TodoTransaction>;
}

function fail(reason: TodoCollectionServiceErrorReason, path: string): never {
  throw new TodoCollectionServiceError(reason, path);
}

function encodeBoundedContent(
  content: string,
  maximumBytes: ByteCount,
  path: string,
): Uint8Array {
  const bytes = encodeUtf8(content, path);
  if (bytes.byteLength > maximumBytes) fail("capacity", path);
  return bytes;
}

function mapAuthorityError(error: TodoCollectionAuthorityError): never {
  if (error.reason === "input") fail("input", error.path);
  if (error.reason === "not-initialized") fail("not-initialized", error.path);
  if (error.reason === "recovery-required") fail("recovery-required", error.path);
  if (error.reason === "aborted") fail("aborted", error.path);
  fail("transaction-conflict", error.path);
}

async function inspectRecovery(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<TodoCollectionAuthoritySnapshot>> {
  try {
    return await inspectTodoCollectionAuthorityForRecovery(
      root,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof TodoCollectionAuthorityError) mapAuthorityError(error);
    throw error;
  }
}

async function inspectSettled(
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

function pairs(snapshot: Readonly<TodoCollectionAuthoritySnapshot>) {
  return snapshot.items.map((item) => ({ intake: item.intake, state: item.state }));
}

function targetPairs(
  snapshot: Readonly<TodoCollectionAuthoritySnapshot>,
  todoId: TodoItemId,
  intake: Readonly<TodoIntake>,
  state: Readonly<TodoState>,
) {
  const existing = snapshot.items.some((item) => item.todoId === todoId);
  return existing
    ? snapshot.items.map((item) => item.todoId === todoId
      ? { intake, state }
      : { intake: item.intake, state: item.state })
    : [...pairs(snapshot), { intake, state }];
}

function buildTransaction(
  operation: TodoTransactionOperation,
  current: Readonly<TodoCollectionAuthoritySnapshot>,
  intake: Readonly<TodoIntake>,
  expectedState: Readonly<TodoState> | null,
  targetState: Readonly<TodoState>,
): Readonly<TodoTransaction> {
  const targets = targetPairs(current, intake.todoId, intake, targetState);
  const targetCollection = createTodoCollectionSnapshot(targets);
  encodeBoundedContent(
    renderTodoBoardProjection(targets).content,
    TODO_PROJECTION_MAXIMUM_BYTES,
    "$projection",
  );
  return parseTodoTransaction({
    artifactKind: "wakeflow-todo-transaction",
    schemaVersion: 1,
    todoId: intake.todoId,
    operation,
    createdAt: targetState.updatedAt,
    expectedCollectionDigest: current.collection.collectionDigest,
    expectedIntakeDigest: expectedState === null
      ? null
      : computeTodoIntakeDigest(intake),
    expectedStateDigest: expectedState === null
      ? null
      : computeTodoStateDigest(expectedState),
    targetIntake: operation === "append" ? intake : null,
    targetState,
    targetIntakeDigest: computeTodoIntakeDigest(intake),
    targetStateDigest: computeTodoStateDigest(targetState),
    targetCollectionDigest: targetCollection.collectionDigest,
  });
}

function assertTransactionStorageCapacity(
  transaction: Readonly<TodoTransaction>,
): void {
  if (transaction.targetIntake !== null) {
    encodeBoundedContent(
      renderTodoIntake(transaction.targetIntake),
      TODO_INTAKE_MAXIMUM_BYTES,
      "$intake",
    );
  }
  encodeBoundedContent(
    renderTodoState(transaction.targetState),
    TODO_STATE_MAXIMUM_BYTES,
    "$state",
  );
  encodeBoundedContent(
    renderTodoTransaction(transaction),
    TODO_TRANSACTION_MAXIMUM_BYTES,
    "$transaction",
  );
}

function mapAtomicWriteError(error: DurableAtomicFileWriteError): never {
  if (error.reason === "aborted") fail("aborted", error.path);
  if (
    error.reason === "target-exists"
    || error.reason === "expectation-changed"
  ) {
    fail("transaction-conflict", error.path);
  }
  fail("write-failure", error.path);
}

async function createJournal(
  root: RootedDirectory,
  transaction: Readonly<TodoTransaction>,
  signal: AbortSignal | undefined,
): Promise<Readonly<JournalSource>> {
  const resourcePath = todoTransactionRef(transaction.todoId);
  const bytes = encodeBoundedContent(
    renderTodoTransaction(transaction),
    TODO_TRANSACTION_MAXIMUM_BYTES,
    "$transaction",
  );
  try {
    const created = await createFileAtomically(
      root,
      resourcePath,
      bytes,
      {
        mode: TODO_AUTHORITY_FILE_MODE,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    return Object.freeze({
      resourcePath,
      node: created.node,
      digest: created.digest,
    });
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) mapAtomicWriteError(error);
    throw error;
  }
}

function assertPrivateNode(
  node: Readonly<FileNodeSnapshot>,
  kind: "file" | "directory",
): void {
  const mode = kind === "file"
    ? TODO_AUTHORITY_FILE_MODE
    : TODO_AUTHORITY_DIRECTORY_MODE;
  if (
    node.kind !== kind
    || node.permissionBits !== mode
    || (kind === "file" && node.linkCount !== 1n)
    || (
      typeof process.geteuid === "function"
      && node.userId !== BigInt(process.geteuid())
    )
  ) {
    fail("transaction-conflict", "$transaction");
  }
}

async function readJournal(
  root: RootedDirectory,
  todoId: TodoItemId,
  signal: AbortSignal | undefined,
): Promise<{
  readonly transaction: Readonly<TodoTransaction>;
  readonly source: Readonly<JournalSource>;
}> {
  const resourcePath = todoTransactionRef(todoId);
  let read: Readonly<DeterministicJsonFileResult>;
  try {
    read = await readDeterministicJsonFile(root, resourcePath, {
      maximumBytes: TODO_TRANSACTION_MAXIMUM_BYTES,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "not-found") fail("not-found", "$transaction");
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("transaction-conflict", "$transaction");
    }
    if (error instanceof StrictTextFileError) {
      fail("transaction-conflict", "$transaction");
    }
    if (error instanceof DeterministicJsonDocumentError) {
      fail("transaction-conflict", "$transaction");
    }
    throw error;
  }
  assertPrivateNode(read.node, "file");
  let transaction: Readonly<TodoTransaction>;
  try {
    transaction = parseTodoTransaction(read.value);
    if (renderTodoTransaction(transaction) !== read.text) {
      fail("transaction-conflict", "$transaction");
    }
  } catch {
    fail("transaction-conflict", "$transaction");
  }
  if (transaction.todoId !== todoId) fail("transaction-conflict", "$transaction");
  return Object.freeze({
    transaction,
    source: Object.freeze({ resourcePath, node: read.node, digest: read.digest }),
  });
}

function basename(resourcePath: PortableResourcePath): string {
  const value = resourcePath.split("/").at(-1);
  if (value === undefined) fail("operation-failure", "$resourcePath");
  return value;
}

async function assertTransactionInventory(
  root: RootedDirectory,
  transaction: Readonly<TodoTransaction>,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    const directory = await readStableResourceDirectory(
      root,
      TODO_TRANSACTIONS_ROOT_REF,
      {
        maximumEntries: 2,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    assertPrivateNode(directory.directoryNode, "directory");
    const allowed = new Set([basename(todoTransactionRef(transaction.todoId))]);
    if (transaction.operation === "append") {
      allowed.add(basename(todoAppendStageRef(transaction.todoId)));
    }
    if (
      !directory.entries.some(
        (entry) => entry.name === basename(todoTransactionRef(transaction.todoId))
          && entry.node.kind === "file"
          && entry.node.permissionBits === TODO_AUTHORITY_FILE_MODE
          && entry.node.linkCount === 1n,
      )
      || directory.entries.some((entry) => !allowed.has(entry.name))
    ) {
      fail("transaction-conflict", "$transactions");
    }
    const stageName = basename(todoAppendStageRef(transaction.todoId));
    const stage = directory.entries.find((entry) => entry.name === stageName);
    if (
      stage !== undefined
      && (
        transaction.operation !== "append"
        || stage.node.kind !== "directory"
        || stage.node.permissionBits !== TODO_AUTHORITY_DIRECTORY_MODE
      )
    ) {
      fail("transaction-conflict", "$transactions");
    }
  } catch (error: unknown) {
    if (error instanceof TodoCollectionServiceError) throw error;
    if (error instanceof StableDirectoryReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("transaction-conflict", "$transactions");
    }
    throw error;
  }
}

/** 创建或观察一个 TODO 私有目录，并立即验证最终节点策略。 */
export async function materializeTodoPrivateDirectory(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    const materialized = await materializeDirectoryPath(root, resourcePath, {
      mode: TODO_AUTHORITY_DIRECTORY_MODE,
      ...(signal === undefined ? {} : { signal }),
    });
    assertPrivateNode(materialized.node, "directory");
  } catch (error: unknown) {
    if (error instanceof TodoCollectionServiceError) throw error;
    if (error instanceof DurableDirectoryMaterializationError) {
      if (error.reason === "aborted") fail("aborted", error.path);
      fail("write-failure", error.path);
    }
    throw error;
  }
}

async function inspectExistingNode(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<Readonly<FileNodeSnapshot> | null> {
  try {
    return (await root.inspectExistingResource(resourcePath)).node;
  } catch (error: unknown) {
    if (
      error instanceof RootedDirectoryError
      && error.reason === "resource-not-found"
    ) return null;
    fail("transaction-conflict", "$resourcePath");
  }
}

async function ensureStageFile(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  content: string,
  maximumBytes: ByteCount,
  parser: (value: unknown) => unknown,
  signal: AbortSignal | undefined,
): Promise<void> {
  const bytes = encodeBoundedContent(content, maximumBytes, "$stage");
  const existing = await inspectExistingNode(root, resourcePath);
  if (existing === null) {
    try {
      await createFileAtomically(root, resourcePath, bytes, {
        mode: TODO_AUTHORITY_FILE_MODE,
        ...(signal === undefined ? {} : { signal }),
      });
      return;
    } catch (error: unknown) {
      if (error instanceof DurableAtomicFileWriteError) mapAtomicWriteError(error);
      throw error;
    }
  }
  assertPrivateNode(existing, "file");
  let read: Readonly<DeterministicJsonFileResult>;
  try {
    read = await readDeterministicJsonFile(root, resourcePath, {
      maximumBytes,
      expectedNode: existing,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch {
    fail("transaction-conflict", "$stage");
  }
  assertPrivateNode(read.node, "file");
  try {
    parser(read.value);
  } catch {
    fail("transaction-conflict", "$stage");
  }
  if (read.text !== content) fail("transaction-conflict", "$stage");
}

async function assertAppendStageClosed(
  root: RootedDirectory,
  stageRef: PortableResourcePath,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    const directory = await readStableResourceDirectory(root, stageRef, {
      maximumEntries: 2,
      ...(signal === undefined ? {} : { signal }),
    });
    assertPrivateNode(directory.directoryNode, "directory");
    if (
      directory.entries.length !== 2
      || directory.entries[0]?.name !== "intake.json"
      || directory.entries[1]?.name !== "state.json"
      || directory.entries.some((entry) => entry.node.kind !== "file")
    ) {
      fail("transaction-conflict", "$stage");
    }
    for (const entry of directory.entries) {
      assertPrivateNode(entry.node, "file");
    }
  } catch (error: unknown) {
    if (error instanceof TodoCollectionServiceError) throw error;
    if (error instanceof StableDirectoryReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("transaction-conflict", "$stage");
    }
    throw error;
  }
}

async function ensureAppendTarget(
  root: RootedDirectory,
  transaction: Readonly<TodoTransaction>,
  snapshot: Readonly<TodoCollectionAuthoritySnapshot>,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  const existing = snapshot.items.find((item) => item.todoId === transaction.todoId);
  if (existing !== undefined) {
    if (
      existing.intakeDigest !== transaction.targetIntakeDigest
      || existing.stateDigest !== transaction.targetStateDigest
    ) {
      fail("transaction-conflict", "$item");
    }
    return false;
  }
  if (transaction.targetIntake === null) fail("transaction-conflict", "$transaction");
  const stageRef = todoAppendStageRef(transaction.todoId);
  await materializeTodoPrivateDirectory(root, stageRef, signal);
  await ensureStageFile(
    root,
    parsePortableResourcePath(`${stageRef}/intake.json`),
    renderTodoIntake(transaction.targetIntake),
    TODO_INTAKE_MAXIMUM_BYTES,
    parseTodoIntake,
    signal,
  );
  await ensureStageFile(
    root,
    parsePortableResourcePath(`${stageRef}/state.json`),
    renderTodoState(transaction.targetState),
    TODO_STATE_MAXIMUM_BYTES,
    parseTodoState,
    signal,
  );
  await assertAppendStageClosed(root, stageRef, signal);
  const stageNode = await inspectExistingNode(root, stageRef);
  if (stageNode === null) fail("transaction-conflict", "$stage");
  assertPrivateNode(stageNode, "directory");
  try {
    await renameResourceDurably(
      root,
      stageRef,
      todoItemRootRef(transaction.todoId),
      {
        expectedSourceNode: stageNode,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DurableResourceRenameError) {
      if (error.reason === "aborted") fail("aborted", error.path);
      fail("transaction-conflict", error.path);
    }
    throw error;
  }
  return true;
}

async function ensureStateTarget(
  root: RootedDirectory,
  transaction: Readonly<TodoTransaction>,
  snapshot: Readonly<TodoCollectionAuthoritySnapshot>,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  const item = snapshot.items.find((entry) => entry.todoId === transaction.todoId);
  if (item === undefined) fail("transaction-conflict", "$item");
  if (item.intakeDigest !== transaction.targetIntakeDigest) {
    fail("transaction-conflict", "$item/intake");
  }
  if (item.stateDigest === transaction.targetStateDigest) return false;
  if (item.stateDigest !== transaction.expectedStateDigest) {
    fail("transaction-conflict", "$item/state");
  }
  const bytes = encodeBoundedContent(
    renderTodoState(transaction.targetState),
    TODO_STATE_MAXIMUM_BYTES,
    "$state",
  );
  try {
    await replaceFileAtomically(
      root,
      todoStateRef(transaction.todoId),
      bytes,
      {
        mode: TODO_AUTHORITY_FILE_MODE,
        expected: item.stateSource,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) mapAtomicWriteError(error);
    throw error;
  }
  return true;
}

/** 从完整 authority snapshot 幂等发布当前 Markdown projection。 */
export async function publishTodoBoardProjection(
  root: RootedDirectory,
  snapshot: Readonly<TodoCollectionAuthoritySnapshot>,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  const observation = snapshot.projection;
  if (observation.status === "current") return false;
  if (observation.status === "unsafe") fail("projection-unsafe", "$projection");
  const bytes = encodeBoundedContent(
    observation.expected.content,
    TODO_PROJECTION_MAXIMUM_BYTES,
    "$projection",
  );
  try {
    if (observation.status === "missing") {
      await createFileAtomically(root, TODO_BOARD_PROJECTION_REF, bytes, {
        mode: TODO_AUTHORITY_FILE_MODE,
        ...(signal === undefined ? {} : { signal }),
      });
      return true;
    }
    const source = observation.source;
    if (source === null) fail("projection-unsafe", "$projection");
    await replaceFileAtomically(root, TODO_BOARD_PROJECTION_REF, bytes, {
      mode: TODO_AUTHORITY_FILE_MODE,
      expected: source,
      ...(signal === undefined ? {} : { signal }),
    });
    return true;
  } catch (error: unknown) {
    if (error instanceof TodoCollectionServiceError) throw error;
    if (error instanceof DurableAtomicFileWriteError) mapAtomicWriteError(error);
    throw error;
  }
}

async function retireJournal(
  root: RootedDirectory,
  source: Readonly<JournalSource>,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await unlinkRegularFileExactly(root, source.resourcePath, {
      expectedNode: source.node,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof ExactRegularFileUnlinkError) {
      if (error.reason === "aborted") fail("aborted", error.path);
      fail("transaction-conflict", "$transaction");
    }
    throw error;
  }
}

async function applyTransaction(
  root: RootedDirectory,
  transaction: Readonly<TodoTransaction>,
  journal: Readonly<JournalSource>,
  signal: AbortSignal | undefined,
): Promise<Readonly<AppliedTransaction>> {
  await assertTransactionInventory(root, transaction, signal);
  let snapshot = await inspectRecovery(root, signal);
  if (
    snapshot.collection.collectionDigest !== transaction.expectedCollectionDigest
    && snapshot.collection.collectionDigest !== transaction.targetCollectionDigest
  ) {
    fail("transaction-conflict", "$collection");
  }
  if (
    transaction.operation === "append"
    && snapshot.collection.collectionDigest === transaction.targetCollectionDigest
    && await inspectExistingNode(root, todoAppendStageRef(transaction.todoId)) !== null
  ) {
    fail("transaction-conflict", "$stage");
  }
  let wroteAuthority = false;
  if (snapshot.collection.collectionDigest !== transaction.targetCollectionDigest) {
    wroteAuthority = transaction.operation === "append"
      ? await ensureAppendTarget(root, transaction, snapshot, signal)
      : await ensureStateTarget(root, transaction, snapshot, signal);
    snapshot = await inspectRecovery(root, signal);
  }
  if (snapshot.collection.collectionDigest !== transaction.targetCollectionDigest) {
    fail("transaction-conflict", "$collection");
  }
  const wroteProjection = await publishTodoBoardProjection(root, snapshot, signal);
  await retireJournal(root, journal, signal);
  const settled = await inspectSettled(root, signal);
  if (settled.collection.collectionDigest !== transaction.targetCollectionDigest) {
    fail("transaction-conflict", "$collection");
  }
  return Object.freeze({ snapshot: settled, wroteAuthority, wroteProjection });
}

/** 在已持有 collection lock 时创建 journal 并前向应用一次领域 transaction。 */
export async function commitTodoCollectionTransaction(
  root: RootedDirectory,
  operation: TodoTransactionOperation,
  current: Readonly<TodoCollectionAuthoritySnapshot>,
  intake: Readonly<TodoIntake>,
  expectedState: Readonly<TodoState> | null,
  targetState: Readonly<TodoState>,
  signal: AbortSignal | undefined,
): Promise<Readonly<TodoCollectionTransactionApplication>> {
  const transaction = buildTransaction(
    operation,
    current,
    intake,
    expectedState,
    targetState,
  );
  assertTransactionStorageCapacity(transaction);
  const journal = await createJournal(root, transaction, signal);
  const applied = await applyTransaction(root, transaction, journal, signal);
  return Object.freeze({ transaction, ...applied });
}

/**
 * immutable journal 可稳定解析后，才允许显式退休同一 collection 的 inactive-owner
 * lock。普通 mutation 不调用本 seam，也不会根据 age/PID 自动删除 lock。
 */
export async function prepareTodoCollectionTransactionRecovery(
  root: RootedDirectory,
  todoId: TodoItemId,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    const receipt = await recoverDurableAtomicFileStagesInDirectory(
      root,
      TODO_TRANSACTIONS_ROOT_REF,
      signal === undefined ? undefined : { signal },
    );
    if (
      receipt.activeStageCount !== 0
      || receipt.unknownStageCount !== 0
    ) {
      fail("recovery-required", "$transaction/stage");
    }
  } catch (error: unknown) {
    if (error instanceof TodoCollectionServiceError) throw error;
    if (error instanceof DurableAtomicFileStageRecoveryError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("recovery-required", "$transaction/stage");
    }
    throw error;
  }
  await readJournal(root, todoId, signal);
  let observation;
  try {
    observation = await inspectRootedExclusiveFileLock(
      root,
      TODO_COLLECTION_LOCK_REF,
    );
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      fail("recovery-required", "$lock");
    }
    throw error;
  }
  if (observation.status !== "held" || observation.ownerState !== "inactive") {
    return;
  }
  try {
    await retireRootedExclusiveFileLockResidue(
      root,
      TODO_COLLECTION_LOCK_REF,
      observation,
    );
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      fail("recovery-required", "$lock");
    }
    throw error;
  }
}

/** 在已重新取得 collection lock 后，幂等完成一个已存在的 journal。 */
export async function recoverTodoCollectionTransactionUnderLock(
  root: RootedDirectory,
  todoId: TodoItemId,
  signal: AbortSignal | undefined,
): Promise<Readonly<TodoCollectionTransactionApplication>> {
  const journal = await readJournal(root, todoId, signal);
  const applied = await applyTransaction(
    root,
    journal.transaction,
    journal.source,
    signal,
  );
  return Object.freeze({ transaction: journal.transaction, ...applied });
}
