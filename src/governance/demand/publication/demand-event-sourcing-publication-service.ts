import { types } from "node:util";

import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../../foundation/data/passive-own-data.js";
import { RootedDirectory } from "../../../foundation/filesystem/rooted-directory.js";
import {
  inspectRootedExclusiveFileLock,
  retireRootedExclusiveFileLockResidue,
  withRootedExclusiveFileLock,
  RootedExclusiveFileLockError,
} from "../../../foundation/filesystem/rooted-exclusive-file-lock.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
} from "../../../foundation/identity/wakeflow-durable-id.js";
import {
  admitDemandAuthority,
  DemandAuthorityError,
} from "../model/demand-authority.js";
import {
  LedgerAuthorityStore,
  LedgerAuthorityStoreError,
} from "../../ledger/ledger-authority-store.js";
import {
  createDemandEventSourcingPublicationTransaction,
  DemandEventSourcingPublicationTransactionError,
  type DemandEventSourcingPublicationTransaction,
} from "./demand-event-sourcing-publication-transaction.js";
import {
  DEMAND_EVENT_SOURCING_PUBLICATION_LOCK_TIMEOUT_MILLISECONDS,
  DemandEventSourcingPublicationServiceError,
  failDemandEventSourcingPublication as fail,
  type DemandEventSourcingPublicationResult,
  type StoredDemandEventSourcingPublicationTransaction,
} from "./demand-event-sourcing-publication-contract.js";
import {
  assertPrivatePublicationNode,
  ensurePublicationTransaction,
  initializePublicationStorage,
  publicationNodeOrNull,
  readPublicationTransactionAt,
  recoverPublicationTransactionStages,
  retirePublicationFile,
  samePublicationTransaction,
} from "./demand-event-sourcing-publication-storage.js";
import {
  assertPendingTodoItem,
  claimTodoForDemandPublication,
  demandPublicationTodoResult,
  exactClaimedTodoItem,
  inspectTodoForDemandPublication,
} from "./demand-event-sourcing-publication-todo.js";
import {
  loadFinalDemandPublication,
  materializeDemandPublicationStage,
  publishDemandStage,
} from "./demand-event-sourcing-publication-stage.js";
import {
  demandFinalPublicationMarkerRef,
  demandPublicationLockRef,
  demandPublicationTransactionRef,
  WAKEFLOW_ACTIVE_CURRENT_ROOT_REF,
} from "./demand-publication-paths.js";

/**
 * Wakeflow Governance / Demand Event Sourcing Publication：跨资源发布流程编排。
 *
 * 本模块只负责同级发布意图文件、Demand 根目录和 TODO 的提交顺序，以及流程锁和公开
 * 入口。根作用域存储、TODO 关系验证和暂存根目录构建分别由相邻模块负责；纯事件追加
 * 不使用该流程锁或发布事务。
 */

const PUBLISH_FIELDS = Object.freeze([
  "authority",
  "commitId",
  "eventId",
  "expectedTodoCollectionDigest",
  "expectedTodoStateDigest",
  "identity",
  "recordedAt",
] as const);

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
}

function assertLedgerStore(
  value: unknown,
): asserts value is LedgerAuthorityStore {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof LedgerAuthorityStore)
  ) {
    fail("input", "$ledgerStore");
  }
}

function parseSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (
    Object.keys(record).some((key) => key !== "signal")
    || (record.signal !== undefined && !(record.signal instanceof AbortSignal))
  ) {
    fail("input", "$options");
  }
  return record.signal as AbortSignal | undefined;
}

function exactInput(value: unknown): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$input");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$input");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== PUBLISH_FIELDS.length
    || keys.some((key, index) => key !== PUBLISH_FIELDS[index])
  ) {
    fail("input", "$input");
  }
  return record;
}

/** 幂等创建 Workspace 级发布流程目录。 */
export async function initializeDemandEventSourcingPublication(
  root: RootedDirectory,
  options?: { readonly signal?: AbortSignal },
): Promise<void> {
  assertRoot(root);
  await initializePublicationStorage(root, parseSignal(options));
}

async function applyPublication(
  root: RootedDirectory,
  ledgerStore: LedgerAuthorityStore,
  storedSidecar: Readonly<StoredDemandEventSourcingPublicationTransaction>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandEventSourcingPublicationResult>> {
  const transaction = storedSidecar.transaction;
  let todoSnapshot = await inspectTodoForDemandPublication(
    root,
    transaction.todoId,
    signal,
  );
  const alreadyClaimed = exactClaimedTodoItem(todoSnapshot, transaction);
  if (alreadyClaimed === null) assertPendingTodoItem(todoSnapshot, transaction);

  let finalNode = await publicationNodeOrNull(root, transaction.finalRootRef);
  let stageNode = await publicationNodeOrNull(root, transaction.stageRef);
  if (finalNode !== null && stageNode !== null) fail("conflict", "$publication");
  if (finalNode === null) {
    await materializeDemandPublicationStage(root, transaction, signal);
    await publishDemandStage(root, transaction, signal);
    finalNode = await publicationNodeOrNull(root, transaction.finalRootRef);
    stageNode = await publicationNodeOrNull(root, transaction.stageRef);
    if (finalNode === null || stageNode !== null) fail("conflict", "$publication");
  }
  assertPrivatePublicationNode(finalNode, "directory", "$demandRoot");
  const markerRef = demandFinalPublicationMarkerRef(transaction.demandId);
  const markerNode = await publicationNodeOrNull(root, markerRef);
  if (alreadyClaimed === null && markerNode === null) {
    fail("conflict", "$demandRoot/transactions/publication.json");
  }
  if (markerNode !== null) {
    const marker = await readPublicationTransactionAt(
      root,
      markerRef,
      markerNode,
      signal,
    );
    if (!samePublicationTransaction(marker.transaction, transaction)) {
      fail("conflict", "$demandRoot/transactions/publication.json");
    }
  }

  const todo = await claimTodoForDemandPublication(root, transaction, signal);
  const currentMarkerNode = await publicationNodeOrNull(root, markerRef);
  if (currentMarkerNode !== null) {
    const marker = await readPublicationTransactionAt(
      root,
      markerRef,
      currentMarkerNode,
      signal,
    );
    if (!samePublicationTransaction(marker.transaction, transaction)) {
      fail("conflict", "$demandRoot/transactions/publication.json");
    }
    await retirePublicationFile(root, markerRef, marker.source.node, signal);
  }
  const loaded = await loadFinalDemandPublication(
    root,
    ledgerStore,
    transaction,
    signal,
  );
  todoSnapshot = await inspectTodoForDemandPublication(
    root,
    transaction.todoId,
    signal,
  );
  const finalItem = exactClaimedTodoItem(todoSnapshot, transaction);
  if (finalItem === null) fail("conflict", "$todo");

  const sidecarRef = demandPublicationTransactionRef(transaction.demandId);
  const sidecarNode = await publicationNodeOrNull(root, sidecarRef);
  if (sidecarNode === null) fail("recovery-required", "$transaction");
  const freshSidecar = await readPublicationTransactionAt(
    root,
    sidecarRef,
    sidecarNode,
    signal,
  );
  if (!samePublicationTransaction(freshSidecar.transaction, transaction)) {
    fail("conflict", "$transaction");
  }
  await retirePublicationFile(root, sidecarRef, freshSidecar.source.node, signal);
  return Object.freeze({
    created: true,
    demandId: transaction.demandId,
    rootRef: transaction.finalRootRef,
    todo: Object.freeze({
      item: finalItem,
      lineageRef: todo.lineageRef,
      snapshot: todoSnapshot,
    }),
    loaded,
  });
}

function mapLockError(error: RootedExclusiveFileLockError): never {
  if (error.reason === "timeout") fail("lock-timeout", "$lock");
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (
    error.reason === "unsafe-lock"
    || error.reason === "parent"
    || error.reason === "root-scope"
  ) {
    fail("lock-unsafe", "$lock");
  }
  fail("recovery-required", "$lock");
}

async function runLocked<Result>(
  root: RootedDirectory,
  transaction: Readonly<DemandEventSourcingPublicationTransaction>,
  signal: AbortSignal | undefined,
  operation: () => Promise<Result>,
): Promise<Result> {
  try {
    return await withRootedExclusiveFileLock(
      root,
      demandPublicationLockRef(transaction.demandId),
      operation,
      {
        acquireTimeoutMilliseconds:
          DEMAND_EVENT_SOURCING_PUBLICATION_LOCK_TIMEOUT_MILLISECONDS,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingPublicationServiceError) throw error;
    if (error instanceof RootedExclusiveFileLockError) mapLockError(error);
    throw error;
  }
}

async function loadIdempotentResult(
  root: RootedDirectory,
  ledgerStore: LedgerAuthorityStore,
  transaction: Readonly<DemandEventSourcingPublicationTransaction>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandEventSourcingPublicationResult> | null> {
  if (await publicationNodeOrNull(root, transaction.finalRootRef) === null) {
    return null;
  }
  if (
    await publicationNodeOrNull(
      root,
      demandFinalPublicationMarkerRef(transaction.demandId),
    ) !== null
  ) {
    return null;
  }
  const snapshot = await inspectTodoForDemandPublication(
    root,
    transaction.todoId,
    signal,
  );
  const item = exactClaimedTodoItem(snapshot, transaction);
  if (item === null) return null;
  return Object.freeze({
    created: false,
    demandId: transaction.demandId,
    rootRef: transaction.finalRootRef,
    todo: demandPublicationTodoResult(snapshot, item),
    loaded: await loadFinalDemandPublication(
      root,
      ledgerStore,
      transaction,
      signal,
    ),
  });
}

/** 根据已确认的身份/权威关系记录和指定待处理 TODO，发布修订号 1 的 Demand。 */
export async function publishDemandFromTodo(
  root: RootedDirectory,
  ledgerStore: LedgerAuthorityStore,
  inputValue: unknown,
  options?: { readonly signal?: AbortSignal },
): Promise<Readonly<DemandEventSourcingPublicationResult>> {
  assertRoot(root);
  assertLedgerStore(ledgerStore);
  const signal = parseSignal(options);
  let transaction: Readonly<DemandEventSourcingPublicationTransaction>;
  try {
    transaction = createDemandEventSourcingPublicationTransaction(
      exactInput(inputValue),
    );
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingPublicationTransactionError) {
      fail("input", "$input");
    }
    throw error;
  }
  try {
    await admitDemandAuthority(
      transaction.identity,
      transaction.authority,
      ledgerStore,
    );
  } catch (error: unknown) {
    if (
      error instanceof DemandAuthorityError
      || error instanceof LedgerAuthorityStoreError
    ) {
      fail("authority", "$authority");
    }
    throw error;
  }
  // Authority 和 TODO 准入完成前，不创建任何发布基础目录或文件。
  const initialTodo = await inspectTodoForDemandPublication(
    root,
    transaction.todoId,
    signal,
  );
  if (exactClaimedTodoItem(initialTodo, transaction) === null) {
    if (
      initialTodo.collection.collectionDigest
      !== transaction.expectedTodoCollectionDigest
    ) {
      fail("cas-mismatch", "$/expectedTodoCollectionDigest");
    }
    assertPendingTodoItem(initialTodo, transaction);
  }
  await initializePublicationStorage(root, signal);
  return runLocked(root, transaction, signal, async () => {
    const sidecarRef = demandPublicationTransactionRef(transaction.demandId);
    if (await publicationNodeOrNull(root, sidecarRef) === null) {
      const idempotent = await loadIdempotentResult(
        root,
        ledgerStore,
        transaction,
        signal,
      );
      if (idempotent !== null) return idempotent;
      const currentTodo = await inspectTodoForDemandPublication(
        root,
        transaction.todoId,
        signal,
      );
      if (
        currentTodo.collection.collectionDigest
        !== transaction.expectedTodoCollectionDigest
      ) {
        fail("cas-mismatch", "$/expectedTodoCollectionDigest");
      }
      assertPendingTodoItem(currentTodo, transaction);
    }
    return applyPublication(
      root,
      ledgerStore,
      await ensurePublicationTransaction(
        root,
        sidecarRef,
        transaction,
        signal,
      ),
      signal,
    );
  });
}

async function prepareLockRecovery(
  root: RootedDirectory,
  stored: Readonly<StoredDemandEventSourcingPublicationTransaction>,
): Promise<void> {
  // 只有指定的同级意图源文件，以及由事务派生的 Demand 和路径，才能授权退休崩溃锁。
  const current = await readPublicationTransactionAt(
    root,
    stored.source.resourcePath,
    stored.source.node,
    undefined,
  );
  if (!samePublicationTransaction(current.transaction, stored.transaction)) {
    fail("conflict", "$transaction");
  }
  const lockRef = demandPublicationLockRef(stored.transaction.demandId);
  let observation;
  try {
    observation = await inspectRootedExclusiveFileLock(root, lockRef);
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
    await retireRootedExclusiveFileLockResidue(root, lockRef, observation);
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      fail("recovery-required", "$lock");
    }
    throw error;
  }
}

/** 根据自包含的同级发布意图文件，前向完成已经开始的发布流程。 */
export async function recoverDemandPublication(
  root: RootedDirectory,
  ledgerStore: LedgerAuthorityStore,
  demandIdValue: unknown,
  options?: { readonly signal?: AbortSignal },
): Promise<Readonly<DemandEventSourcingPublicationResult>> {
  assertRoot(root);
  assertLedgerStore(ledgerStore);
  const signal = parseSignal(options);
  let demandId;
  try {
    demandId = parseWakeflowDurableIdOfKind(
      demandIdValue,
      "demand",
      "$demandId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("input", "$demandId");
    throw error;
  }
  await initializePublicationStorage(root, signal);
  await recoverPublicationTransactionStages(root, signal);
  const ref = demandPublicationTransactionRef(demandId);
  const node = await publicationNodeOrNull(root, ref);
  if (node === null) fail("not-found", "$transaction");
  const stored = await readPublicationTransactionAt(root, ref, node, signal);
  if (stored.transaction.demandId !== demandId) {
    fail("conflict", "$transaction/demandId");
  }
  await prepareLockRecovery(root, stored);
  return runLocked(root, stored.transaction, signal, async () => {
    const freshNode = await publicationNodeOrNull(root, ref);
    if (freshNode === null) fail("not-found", "$transaction");
    const fresh = await readPublicationTransactionAt(root, ref, freshNode, signal);
    if (!samePublicationTransaction(fresh.transaction, stored.transaction)) {
      fail("conflict", "$transaction");
    }
    return applyPublication(root, ledgerStore, fresh, signal);
  });
}

export {
  DemandEventSourcingPublicationServiceError,
  type DemandEventSourcingPublicationResult,
  type DemandEventSourcingPublicationTodoResult,
} from "./demand-event-sourcing-publication-contract.js";

/** 当前标准仍要求最终 Demand 位于 `active/current`。 */
export { WAKEFLOW_ACTIVE_CURRENT_ROOT_REF };
