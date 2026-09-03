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
  recoverDurableAtomicFileStagesForTargets,
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
import {
  admitWakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
  type WakeflowDirectoryContainerRecipe,
  type WakeflowResourceMutationRecipe,
} from "../../foundation/resource/resource-processing-contract.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
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
  TodoIntakeError,
  type TodoIntake,
} from "./todo-intake.js";
import type { TodoItemId } from "./todo-item-id.js";
import {
  createTodoItemResourceCatalog,
  WAKEFLOW_TODO_STATIC_RESOURCE_CATALOG,
} from "./todo-resource-catalog.js";
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
  TodoStateError,
  type TodoState,
} from "./todo-state.js";
import {
  parseTodoTransaction,
  renderTodoTransaction,
  TodoTransactionError,
  type TodoTransaction,
  type TodoTransactionOperation,
} from "./todo-transaction.js";

/**
 * Wakeflow Governance / TODO：集合事务的领域专属物理执行层。
 *
 * 本模块只使用已经验证的 TODO 接收记录、状态、事务记录和固定 TODO 引用，执行
 * 恢复意图持久化、暂存、基于精确源预期的替换、投影发布和恢复。公共输入、状态选择、
 * 集合锁临界区和结果语义仍只由 `todo-collection-service` 负责；本模块不是通用
 * 仓储、存储后端或第二个权威职责所有者。
 */

const TODO_TRANSACTION_MAXIMUM_BYTES = parseByteCount(1024 * 1024);

type TodoStateMutationOperation = Exclude<
  TodoTransactionOperation,
  "append"
>;

const SOURCE_STATUSES_BY_MUTATION = Object.freeze({
  activate: Object.freeze(["parked"]),
  withdraw: Object.freeze(["pending-claim", "parked"]),
  claim: Object.freeze(["pending-claim"]),
  archive: Object.freeze(["claimed"]),
} as const satisfies Readonly<Record<
  TodoStateMutationOperation,
  readonly TodoState["status"][]
>>);

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

function admitDeclaredOperation(
  todoId: TodoItemId,
  resourcePath: PortableResourcePath,
  recipe: WakeflowResourceMutationRecipe | WakeflowDirectoryContainerRecipe,
): void {
  const declaration = createTodoItemResourceCatalog(todoId).find((entry) => (
    entry.placement.relativePath === resourcePath
  ));
  if (declaration === undefined) fail("operation-failure", "$catalog");
  try {
    admitWakeflowResourceOperation(declaration.processing, recipe);
  } catch (error: unknown) {
    if (error instanceof WakeflowResourceProcessingContractError) {
      fail("operation-failure", "$catalog");
    }
    throw error;
  }
}

function admitProjectionRewrite(): void {
  const declaration = WAKEFLOW_TODO_STATIC_RESOURCE_CATALOG.find((entry) => (
    entry.placement.relativePath === TODO_BOARD_PROJECTION_REF
  ));
  if (declaration === undefined) fail("operation-failure", "$catalog");
  try {
    admitWakeflowResourceOperation(
      declaration.processing,
      "deterministic-rewrite",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowResourceProcessingContractError) {
      fail("operation-failure", "$catalog");
    }
    throw error;
  }
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
  if (error.reason === "capacity") fail("capacity", error.path);
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

function assertStateMutationTransition(
  operation: TodoStateMutationOperation,
  intake: Readonly<TodoIntake>,
  expectedState: Readonly<TodoState>,
  targetState: Readonly<TodoState>,
): void {
  if (
    intake.todoId !== expectedState.todoId
    || intake.todoId !== targetState.todoId
    || !SOURCE_STATUSES_BY_MUTATION[operation].some(
      (status) => status === expectedState.status,
    )
    || targetState.revision !== expectedState.revision + 1
    || targetState.previousStateDigest !== computeTodoStateDigest(expectedState)
  ) {
    fail("transition", "$transaction/transition");
  }
}

function buildTransaction(
  operation: TodoTransactionOperation,
  current: Readonly<TodoCollectionAuthoritySnapshot>,
  intake: Readonly<TodoIntake>,
  expectedState: Readonly<TodoState> | null,
  targetState: Readonly<TodoState>,
): Readonly<TodoTransaction> {
  if (operation === "append") {
    if (expectedState !== null) fail("transition", "$transaction/transition");
  } else {
    if (expectedState === null) fail("transition", "$transaction/transition");
    assertStateMutationTransition(
      operation,
      intake,
      expectedState,
      targetState,
    );
  }
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

function mapAtomicWriteError(
  error: DurableAtomicFileWriteError,
  targetExistsReason: "recovery-required" | "transaction-conflict" =
    "transaction-conflict",
): never {
  if (error.reason === "aborted") fail("aborted", error.path);
  if (error.reason === "target-exists") {
    fail(targetExistsReason, error.path);
  }
  if (
    error.reason === "expectation-changed"
    || error.reason === "expectation-read-failure"
  ) {
    fail("transaction-conflict", error.path);
  }
  if (error.reason === "capacity") fail("capacity", error.path);
  if (
    error.reason === "commit-uncertain"
    || error.reason === "durability-failure"
    || error.reason === "stage-cleanup-failure"
    || error.reason === "stage-recovery-required"
    || error.reason === "close-failure"
  ) {
    fail("recovery-required", error.path);
  }
  fail("write-failure", error.path);
}

async function recoverTargetStages(
  root: RootedDirectory,
  targets: readonly PortableResourcePath[],
  signal: AbortSignal | undefined,
  path: string,
): Promise<void> {
  try {
    const receipt = await recoverDurableAtomicFileStagesForTargets(
      root,
      targets,
      signal === undefined ? undefined : { signal },
    );
    if (receipt.activeStageCount !== 0 || receipt.unknownStageCount !== 0) {
      fail("recovery-required", path);
    }
  } catch (error: unknown) {
    if (error instanceof TodoCollectionServiceError) throw error;
    if (error instanceof DurableAtomicFileStageRecoveryError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("recovery-required", path);
    }
    throw error;
  }
}

async function recoverTransactionTargetStages(
  root: RootedDirectory,
  transaction: Readonly<TodoTransaction>,
  signal: AbortSignal | undefined,
): Promise<void> {
  await recoverTargetStages(
    root,
    Object.freeze([TODO_BOARD_PROJECTION_REF]),
    signal,
    "$projection",
  );
  if (transaction.operation === "append") {
    const stageRef = todoAppendStageRef(transaction.todoId);
    const stageNode = await inspectExistingNode(root, stageRef);
    if (stageNode === null) return;
    assertPrivateNode(stageNode, "directory");
    await recoverTargetStages(
      root,
      Object.freeze([
        parsePortableResourcePath(`${stageRef}/intake.json`),
        parsePortableResourcePath(`${stageRef}/state.json`),
      ]),
      signal,
      "$stage",
    );
    return;
  }
  await recoverTargetStages(
    root,
    Object.freeze([todoStateRef(transaction.todoId)]),
    signal,
    "$state",
  );
}

async function createJournal(
  root: RootedDirectory,
  transaction: Readonly<TodoTransaction>,
  signal: AbortSignal | undefined,
): Promise<Readonly<JournalSource>> {
  const resourcePath = todoTransactionRef(transaction.todoId);
  admitDeclaredOperation(transaction.todoId, resourcePath, "exclusive-create");
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
    if (error instanceof DurableAtomicFileWriteError) {
      mapAtomicWriteError(error, "recovery-required");
    }
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
  } catch (error: unknown) {
    if (error instanceof TodoCollectionServiceError) throw error;
    if (error instanceof TodoTransactionError) {
      fail("transaction-conflict", "$transaction");
    }
    throw error;
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
    const journalName = basename(todoTransactionRef(transaction.todoId));
    const journal = directory.entries.find((entry) => (
      entry.name === journalName
    ));
    if (journal === undefined) fail("transaction-conflict", "$transactions");
    assertPrivateNode(journal.node, "file");
    const allowed = new Set([journalName]);
    if (transaction.operation === "append") {
      allowed.add(basename(todoAppendStageRef(transaction.todoId)));
    }
    if (
      directory.entries.some((entry) => !allowed.has(entry.name))
    ) {
      fail("transaction-conflict", "$transactions");
    }
    const stageName = basename(todoAppendStageRef(transaction.todoId));
    const stage = directory.entries.find((entry) => entry.name === stageName);
    if (stage !== undefined) {
      if (transaction.operation !== "append") {
        fail("transaction-conflict", "$transactions");
      }
      assertPrivateNode(stage.node, "directory");
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
    if (error instanceof RootedDirectoryError) {
      fail("transaction-conflict", "$resourcePath");
    }
    throw error;
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
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("transaction-conflict", "$stage");
    }
    if (
      error instanceof StrictTextFileError
      || error instanceof DeterministicJsonDocumentError
    ) {
      fail("transaction-conflict", "$stage");
    }
    throw error;
  }
  assertPrivateNode(read.node, "file");
  try {
    parser(read.value);
  } catch (error: unknown) {
    if (error instanceof TodoIntakeError || error instanceof TodoStateError) {
      fail("transaction-conflict", "$stage");
    }
    throw error;
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
  admitDeclaredOperation(
    transaction.todoId,
    todoItemRootRef(transaction.todoId),
    "exact-directory-publish",
  );
  const stageRef = todoAppendStageRef(transaction.todoId);
  await materializeTodoPrivateDirectory(root, stageRef, signal);
  const intakeStageRef = parsePortableResourcePath(`${stageRef}/intake.json`);
  const stateStageRef = parsePortableResourcePath(`${stageRef}/state.json`);
  await recoverTargetStages(
    root,
    Object.freeze([intakeStageRef, stateStageRef]),
    signal,
    "$stage",
  );
  await ensureStageFile(
    root,
    intakeStageRef,
    renderTodoIntake(transaction.targetIntake),
    TODO_INTAKE_MAXIMUM_BYTES,
    parseTodoIntake,
    signal,
  );
  await ensureStageFile(
    root,
    stateStageRef,
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
      if (
        error.reason === "destination-exists"
        || error.reason === "commit-uncertain"
        || error.reason === "durability-failure"
        || error.reason === "close-failure"
      ) {
        fail("recovery-required", error.path);
      }
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
  admitDeclaredOperation(
    transaction.todoId,
    todoStateRef(transaction.todoId),
    "exact-source-replace",
  );
  await recoverTargetStages(
    root,
    Object.freeze([todoStateRef(transaction.todoId)]),
    signal,
    "$state",
  );
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

/** 从完整权威快照幂等发布当前 Markdown 投影。 */
export async function publishTodoBoardProjection(
  root: RootedDirectory,
  snapshot: Readonly<TodoCollectionAuthoritySnapshot>,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  const observation = snapshot.projection;
  if (observation.status === "current") return false;
  if (observation.status === "unsafe") fail("projection-unsafe", "$projection");
  admitProjectionRewrite();
  await recoverTargetStages(
    root,
    Object.freeze([TODO_BOARD_PROJECTION_REF]),
    signal,
    "$projection",
  );
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
  todoId: TodoItemId,
  source: Readonly<JournalSource>,
  signal: AbortSignal | undefined,
): Promise<void> {
  admitDeclaredOperation(
    todoId,
    source.resourcePath,
    "exact-retire",
  );
  try {
    await unlinkRegularFileExactly(root, source.resourcePath, {
      expectedNode: source.node,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof ExactRegularFileUnlinkError) {
      if (error.reason === "aborted") fail("aborted", error.path);
      if (
        error.reason === "commit-uncertain"
        || error.reason === "durability-failure"
        || error.reason === "close-failure"
      ) {
        fail("recovery-required", "$transaction");
      }
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
  await recoverTransactionTargetStages(root, transaction, signal);
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
  const verified = await inspectRecovery(root, signal);
  if (
    verified.collection.collectionDigest !== transaction.targetCollectionDigest
    || verified.projection.status !== "current"
  ) {
    fail("transaction-conflict", "$collection");
  }
  await retireJournal(root, transaction.todoId, journal, signal);
  return Object.freeze({ snapshot: verified, wroteAuthority, wroteProjection });
}

/** 在已经持有集合锁时创建恢复意图记录，并前向应用一次领域事务。 */
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
 * 只有不可变恢复意图记录可以稳定解析后，才允许显式退休同一集合中持有者已经失活的
 * 锁文件。普通变更操作不调用本入口，也不会根据存在时长或进程号自动删除锁文件。
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

/** 重新取得集合锁后，幂等完成已有恢复意图记录描述的事务。 */
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
