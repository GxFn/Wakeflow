import { types } from "node:util";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import {
  PassiveOwnDataError,
  parsePlainRecord,
} from "../../../foundation/data/passive-own-data.js";
import {
  DurableResourceEntrySettlementError,
  settleObservedResourceEntry,
} from "../../../foundation/filesystem/durable-resource-entry-settlement.js";
import type { FileNodeSnapshot } from "../../../foundation/filesystem/file-node-snapshot.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../foundation/filesystem/rooted-directory.js";
import {
  inspectRootedExclusiveFileLock,
  RootedExclusiveFileLockError,
  retireRootedExclusiveFileLockResidue,
  withRootedExclusiveFileLock,
} from "../../../foundation/filesystem/rooted-exclusive-file-lock.js";
import {
  LedgerAuthorityStore,
  LedgerAuthorityStoreError,
} from "../../ledger/ledger-authority-store.js";
import { admitDemandAuthority, DemandAuthorityError } from "../model/demand-authority.js";
import { assertNoActiveDemand } from "./demand-active-guard.js";
import {
  DEMAND_EVENT_SOURCING_PUBLICATION_LOCK_TIMEOUT_MILLISECONDS,
  type DemandEventSourcingPublicationEffectAuthority,
  type DemandEventSourcingPublicationResult,
  DemandEventSourcingPublicationServiceError,
  failDemandEventSourcingPublication as fail,
  type StoredDemandEventSourcingPublicationTransaction,
} from "./demand-event-sourcing-publication-contract.js";
import {
  assertPendingPackage,
  claimPackageForDemandPublication,
  exactClaimedPackage,
  inspectPackageForDemandPublication,
} from "./demand-event-sourcing-publication-package.js";
import {
  loadFinalDemandPublication,
  materializeDemandPublicationStage,
  publishDemandStage,
} from "./demand-event-sourcing-publication-stage.js";
import {
  assertPrivatePublicationNode,
  initializePublicationStorage,
  publicationNodeOrNull,
  readPublicationTransactionAt,
  recoverPublicationTransactionStages,
  retirePublicationFile,
  samePublicationTransaction,
} from "./demand-event-sourcing-publication-storage.js";
import {
  createDemandEventSourcingPublicationTransaction,
  type DemandEventSourcingPublicationTransaction,
  DemandEventSourcingPublicationTransactionError,
} from "./demand-event-sourcing-publication-transaction.js";
import {
  demandFinalPublicationMarkerRef,
  demandPublicationLockRef,
  demandStagePublicationMarkerRef,
} from "./demand-publication-paths.js";

/**
 * Wakeflow Governance / Demand Event Sourcing Publication：跨资源发布流程编排。
 *
 * 本模块只负责暂存根、Demand 根目录和看板认领的提交顺序，以及流程锁和公开入口。根作用域存储、
 * 认领关系验证和暂存根目录构建分别由相邻模块负责；纯事件追加不使用该流程锁或发布事务。
 *
 * 这次创建落盘的记录只有一份：暂存根（改名之后是 Demand 根）里的发布标记，它带着完整的事务
 *（1.4 第 5 段 5a 的 B 行，ADR-0031）。被打断的创建由 `recover` 凭它续做；同一个创建请求再发一次时，
 * 调用方先读它、沿用它记下的时间，得到同一份事务，于是每一步都按"已经做过"重入。
 */

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    !(value instanceof RootedDirectory)
  ) {
    fail("input", "$root", "unchanged");
  }
}

function assertLedgerStore(value: unknown): asserts value is LedgerAuthorityStore {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    !(value instanceof LedgerAuthorityStore)
  ) {
    fail("input", "$ledgerStore", "unchanged");
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
    Object.keys(record).some((key) => key !== "signal") ||
    (record.signal !== undefined &&
      (types.isProxy(record.signal) || !(record.signal instanceof AbortSignal)))
  ) {
    fail("input", "$options");
  }
  return record.signal as AbortSignal | undefined;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$signal");
}

/** 幂等创建 Workspace 级发布流程目录。 */
export async function initializeDemandEventSourcingPublication(
  root: RootedDirectory,
  options?: { readonly signal?: AbortSignal },
): Promise<void> {
  assertRoot(root);
  await initializePublicationStorage(root, parseSignal(options));
}

/**
 * Demand 根已经在它的最终位置、这一次没有做改名时，先把那次改名落盘再往下做（1.4.1 段 1b，“沿用之前先
 * 落盘”）：上一次可能死在 `stages/<id> → current/<id>` 的改名之后、同步两个父目录之前，不留别的痕迹；
 * 接下来要认领需求包、删掉发布标记，不补这两次同步，掉电之后根可以退回暂存目录，而标记已经没有了。
 * 先确认旧名字不在（同步 `stages/`），再确认新名字在（同步 `current/`），与改名自己的同步同一个先后。
 */
async function settleReusedDemandRoot(
  root: RootedDirectory,
  transaction: Readonly<DemandEventSourcingPublicationTransaction>,
  finalNode: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
): Promise<void> {
  const options = signal === undefined ? {} : { signal };
  try {
    await settleObservedResourceEntry(root, transaction.stageRef, "absent", options);
    await settleObservedResourceEntry(root, transaction.finalRootRef, "present", {
      expectedNode: finalNode,
      ...options,
    });
  } catch (error: unknown) {
    if (!(error instanceof DurableResourceEntrySettlementError)) throw error;
    if (error.reason === "aborted") fail("aborted", "$signal");
    if (error.reason === "observation-changed") fail("cas-mismatch", "$demandRoot");
    fail("recovery-required", "$demandRoot");
  }
}

async function applyPublication(
  root: RootedDirectory,
  ledgerStore: LedgerAuthorityStore,
  transaction: Readonly<DemandEventSourcingPublicationTransaction>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandEventSourcingPublicationResult>> {
  const before = await inspectPackageForDemandPublication(root, transaction, signal);
  const alreadyClaimed = exactClaimedPackage(before, transaction);
  if (alreadyClaimed === null) assertPendingPackage(before, transaction);

  let finalNode = await publicationNodeOrNull(root, transaction.finalRootRef);
  let stageNode = await publicationNodeOrNull(root, transaction.stageRef);
  let wroteDemandRoot = false;
  if (finalNode !== null && stageNode !== null) fail("conflict", "$publication");
  if (finalNode === null) {
    await materializeDemandPublicationStage(root, transaction, signal);
    await publishDemandStage(root, transaction, signal);
    wroteDemandRoot = true;
    finalNode = await publicationNodeOrNull(root, transaction.finalRootRef);
    stageNode = await publicationNodeOrNull(root, transaction.stageRef);
    if (finalNode === null || stageNode !== null) fail("conflict", "$publication");
  } else {
    await settleReusedDemandRoot(root, transaction, finalNode, signal);
  }
  assertPrivatePublicationNode(finalNode, "directory", "$demandRoot");
  const markerRef = demandFinalPublicationMarkerRef(transaction.demandId);
  const markerNode = await publicationNodeOrNull(root, markerRef);
  if (alreadyClaimed === null && markerNode === null) {
    fail("conflict", "$demandRoot/transactions/publication.json");
  }
  if (markerNode !== null) {
    const marker = await readPublicationTransactionAt(root, markerRef, markerNode, signal);
    if (!samePublicationTransaction(marker.transaction, transaction)) {
      fail("conflict", "$demandRoot/transactions/publication.json");
    }
  }

  await claimPackageForDemandPublication(root, transaction, signal);
  const currentMarkerNode = await publicationNodeOrNull(root, markerRef);
  if (currentMarkerNode !== null) {
    const marker = await readPublicationTransactionAt(root, markerRef, currentMarkerNode, signal);
    if (!samePublicationTransaction(marker.transaction, transaction)) {
      fail("conflict", "$demandRoot/transactions/publication.json");
    }
    await retirePublicationFile(root, transaction, markerRef, marker.source.node, signal);
  }
  const loaded = await loadFinalDemandPublication(root, ledgerStore, transaction, signal);
  const claim = exactClaimedPackage(
    await inspectPackageForDemandPublication(root, transaction, signal),
    transaction,
  );
  if (claim === null) fail("conflict", "$board");
  return Object.freeze({
    publicationAuthority: "current" as const,
    wroteDemandRoot,
    demandId: transaction.demandId,
    rootRef: transaction.finalRootRef,
    claim,
    loaded,
  });
}

function mapLockError(error: RootedExclusiveFileLockError): never {
  if (error.reason === "timeout") fail("lock-timeout", "$lock");
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (
    error.reason === "unsafe-lock" ||
    error.reason === "parent" ||
    error.reason === "root-scope"
  ) {
    fail("lock-unsafe", "$lock");
  }
  fail("recovery-required", "$lock");
}

async function runLocked<Result>(
  root: RootedDirectory,
  demandId: DemandEventSourcingPublicationTransaction["demandId"],
  signal: AbortSignal | undefined,
  operation: () => Promise<Result>,
): Promise<Result> {
  try {
    return await withRootedExclusiveFileLock(root, demandPublicationLockRef(demandId), operation, {
      acquireTimeoutMilliseconds: DEMAND_EVENT_SOURCING_PUBLICATION_LOCK_TIMEOUT_MILLISECONDS,
      // Demand 发布锁是轻档：留下的失效锁由下一次发布退休（1.4.1 第 1 段清单 2.1 节 L6）。
      durability: "content-only",
      ...(signal === undefined ? {} : { signal }),
    });
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
  if ((await publicationNodeOrNull(root, transaction.finalRootRef)) === null) {
    return null;
  }
  if (
    (await publicationNodeOrNull(root, demandFinalPublicationMarkerRef(transaction.demandId))) !==
    null
  ) {
    return null;
  }
  const claim = exactClaimedPackage(
    await inspectPackageForDemandPublication(root, transaction, signal),
    transaction,
  );
  if (claim === null) return null;
  return Object.freeze({
    publicationAuthority: "current" as const,
    wroteDemandRoot: false,
    demandId: transaction.demandId,
    rootRef: transaction.finalRootRef,
    claim,
    loaded: await loadFinalDemandPublication(root, ledgerStore, transaction, signal),
  });
}

function rethrowWithPublicationAuthority(
  error: unknown,
  publicationAuthority: DemandEventSourcingPublicationEffectAuthority,
): never {
  if (error instanceof DemandEventSourcingPublicationServiceError) {
    throw new DemandEventSourcingPublicationServiceError(
      error.reason,
      error.path,
      error.publicationAuthority === "unknown" ? publicationAuthority : error.publicationAuthority,
    );
  }
  throw error;
}

/** 失败后只读观察exact transaction，不把残留、冲突或观察失败猜成成功。 */
async function classifyPublicationAuthority(
  root: RootedDirectory,
  ledgerStore: LedgerAuthorityStore,
  transaction: Readonly<DemandEventSourcingPublicationTransaction>,
  signal: AbortSignal | undefined,
): Promise<DemandEventSourcingPublicationEffectAuthority> {
  try {
    const pending = await readPendingPublication(root, transaction.demandId, signal, false);
    if (pending !== null) {
      return samePublicationTransaction(pending.transaction, transaction)
        ? "recoverable"
        : "unknown";
    }

    if ((await loadIdempotentResult(root, ledgerStore, transaction, signal)) !== null) {
      return "current";
    }

    if (
      (await publicationNodeOrNull(root, transaction.finalRootRef)) !== null ||
      (await publicationNodeOrNull(root, transaction.stageRef)) !== null
    ) {
      return "unknown";
    }
    assertPendingPackage(
      await inspectPackageForDemandPublication(root, transaction, signal),
      transaction,
    );
    return "unchanged";
  } catch {
    return "unknown";
  }
}

/** 根据已确认的身份/权威关系记录和看板上待认领的需求包，发布修订号 1 的 Demand。 */
export async function publishDemandFromPackage(
  root: RootedDirectory,
  ledgerStore: LedgerAuthorityStore,
  inputValue: unknown,
  options?: { readonly signal?: AbortSignal },
): Promise<Readonly<DemandEventSourcingPublicationResult>> {
  assertRoot(root);
  assertLedgerStore(ledgerStore);
  let signal: AbortSignal | undefined;
  let transaction: Readonly<DemandEventSourcingPublicationTransaction>;
  try {
    signal = parseSignal(options);
    try {
      transaction = createDemandEventSourcingPublicationTransaction(inputValue);
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
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      if (error instanceof DemandAuthorityError || error instanceof LedgerAuthorityStoreError) {
        if (
          (error instanceof DemandAuthorityError && error.reason === "aborted") ||
          (error instanceof LedgerAuthorityStoreError && error.reason === "aborted")
        ) {
          fail("aborted", "$signal");
        }
        fail("authority", "$authority");
      }
      throw error;
    }
    // Authority 和看板准入完成前，不创建任何发布基础目录或文件。
    const initialPackage = await inspectPackageForDemandPublication(root, transaction, signal);
    if (exactClaimedPackage(initialPackage, transaction) === null) {
      assertPendingPackage(initialPackage, transaction);
      // 公共 create 的 apply 已持有 pod 临界区；排除自己的未完成发布，保留其他意图的占用。
      await assertNoActiveDemand(root, signal, transaction.demandId, transaction.identity.podId);
    }
  } catch (error: unknown) {
    rethrowWithPublicationAuthority(error, "unchanged");
  }

  let publicationIntentWriteAttempted = false;
  try {
    await initializePublicationStorage(root, signal);
    await retireInactivePublicationLock(root, transaction.demandId, signal);
    return await runLocked(root, transaction.demandId, signal, async () => {
      const idempotent = await loadIdempotentResult(root, ledgerStore, transaction, signal);
      if (idempotent !== null) return idempotent;
      // 上一次被打断留下的标记必须就是这一份事务：调用方沿用了它的时间才会相同；不同就是另一次创建。
      const pending = await readPendingPublication(root, transaction.demandId, signal, true);
      if (pending !== null && !samePublicationTransaction(pending.transaction, transaction)) {
        fail("conflict", "$transaction");
      }
      if (pending === null) {
        assertPendingPackage(
          await inspectPackageForDemandPublication(root, transaction, signal),
          transaction,
        );
      }
      publicationIntentWriteAttempted = true;
      return applyPublication(root, ledgerStore, transaction, signal);
    });
  } catch (error: unknown) {
    let publicationAuthority = await classifyPublicationAuthority(
      root,
      ledgerStore,
      transaction,
      signal,
    );
    if (publicationIntentWriteAttempted && publicationAuthority === "unchanged") {
      publicationAuthority = "unknown";
    }
    rethrowWithPublicationAuthority(error, publicationAuthority);
  }
}

/** 流程锁的持有者确实不在了就收掉它（与看板、投影的正常入口同一做法，ADR-0014 决定 2）。 */
async function retireInactivePublicationLock(
  root: RootedDirectory,
  demandId: DemandEventSourcingPublicationTransaction["demandId"],
  signal: AbortSignal | undefined,
): Promise<void> {
  assertNotAborted(signal);
  const lockRef = demandPublicationLockRef(demandId);
  let observation: Awaited<ReturnType<typeof inspectRootedExclusiveFileLock>>;
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
  assertNotAborted(signal);
  try {
    await retireRootedExclusiveFileLockResidue(root, lockRef, observation);
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      fail("recovery-required", "$lock");
    }
    throw error;
  }
}

function parentOf(ref: PortableResourcePath): PortableResourcePath {
  return parsePortableResourcePath(ref.slice(0, ref.lastIndexOf("/")));
}

/**
 * 读一次还没有收尾的创建留下的标记：Demand 根已经生效就读根里的，否则读暂存根里的；都没有即 null。
 * `settleStages` 只给写路径（发布与恢复）：先回收标记自己的、写者已经不在的原子写暂存。只读路径
 *（预览、守卫、失败之后的观察）不回收任何东西——预览零写。
 */
async function readPendingPublication(
  root: RootedDirectory,
  demandId: DemandEventSourcingPublicationTransaction["demandId"],
  signal: AbortSignal | undefined,
  settleStages: boolean,
): Promise<Readonly<StoredDemandEventSourcingPublicationTransaction> | null> {
  for (const ref of [
    demandFinalPublicationMarkerRef(demandId),
    demandStagePublicationMarkerRef(demandId),
  ]) {
    // 标记所在的目录都不在，就没有什么可读、也没有什么可回收的；只读路径不为此建任何目录。
    if ((await publicationNodeOrNull(root, parentOf(ref))) === null) continue;
    if (settleStages) await recoverPublicationTransactionStages(root, ref, signal);
    const node = await publicationNodeOrNull(root, ref);
    if (node === null) continue;
    const stored = await readPublicationTransactionAt(root, ref, node, signal);
    if (stored.transaction.demandId !== demandId) fail("conflict", "$transaction/demandId");
    return stored;
  }
  return null;
}

/** 标记可能在的两个目录（最终根与暂存根里的 `transactions/`）有没有哪一个在：在才有暂存可回收。 */
async function publicationResidueMayExist(
  root: RootedDirectory,
  demandId: DemandEventSourcingPublicationTransaction["demandId"],
): Promise<boolean> {
  for (const ref of [
    demandFinalPublicationMarkerRef(demandId),
    demandStagePublicationMarkerRef(demandId),
  ]) {
    if ((await publicationNodeOrNull(root, parentOf(ref))) !== null) return true;
  }
  return false;
}

/** 只读：这个 Demand 有没有一次还没收尾的创建；有就交回它的事务（调用方据此沿用原来的时间）。 */
export async function readPendingDemandPublication(
  root: RootedDirectory,
  demandIdValue: unknown,
  options?: { readonly signal?: AbortSignal },
): Promise<Readonly<DemandEventSourcingPublicationTransaction> | null> {
  assertRoot(root);
  let signal: AbortSignal | undefined;
  try {
    signal = parseSignal(options);
    const demandId = parseWakeflowDurableIdOfKind(demandIdValue, "demand", "$demandId");
    assertNotAborted(signal);
    return (await readPendingPublication(root, demandId, signal, false))?.transaction ?? null;
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("input", "$demandId", "unchanged");
    }
    rethrowWithPublicationAuthority(error, "unknown");
  }
}

/** 根据暂存根或 Demand 根里自带的发布标记，前向完成已经开始的发布流程。 */
export async function recoverDemandPublication(
  root: RootedDirectory,
  ledgerStore: LedgerAuthorityStore,
  demandIdValue: unknown,
  options?: { readonly signal?: AbortSignal },
): Promise<Readonly<DemandEventSourcingPublicationResult>> {
  assertRoot(root);
  assertLedgerStore(ledgerStore);
  let signal: AbortSignal | undefined;
  let demandId: ReturnType<typeof parseWakeflowDurableIdOfKind>;
  try {
    signal = parseSignal(options);
    demandId = parseWakeflowDurableIdOfKind(demandIdValue, "demand", "$demandId");
    assertNotAborted(signal);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("input", "$demandId", "unchanged");
    }
    rethrowWithPublicationAuthority(error, "unchanged");
  }

  let transaction: Readonly<DemandEventSourcingPublicationTransaction> | null = null;
  try {
    // 锁外只读：回收标记自己的暂存要在发布锁里做（那把锁的持有者才可以动这个事务的文件）。没有标记、
    // 也没有可能留着标记暂存的 `transactions/` 目录时，没有可恢复的创建，什么都不建、不拿锁。
    const observed = await readPendingPublication(root, demandId, signal, false);
    if (observed === null && !(await publicationResidueMayExist(root, demandId))) {
      fail("not-found", "$transaction");
    }
    transaction = observed?.transaction ?? null;
    await initializePublicationStorage(root, signal);
    await retireInactivePublicationLock(root, demandId, signal);
    return await runLocked(root, demandId, signal, async () => {
      const fresh = await readPendingPublication(root, demandId, signal, true);
      if (fresh === null) fail("not-found", "$transaction");
      if (
        observed !== null &&
        !samePublicationTransaction(fresh.transaction, observed.transaction)
      ) {
        fail("conflict", "$transaction");
      }
      transaction = fresh.transaction;
      return applyPublication(root, ledgerStore, fresh.transaction, signal);
    });
  } catch (error: unknown) {
    const publicationAuthority =
      transaction === null
        ? "unknown"
        : await classifyPublicationAuthority(root, ledgerStore, transaction, signal);
    rethrowWithPublicationAuthority(error, publicationAuthority);
  }
}

export {
  type DemandEventSourcingPublicationResult,
  DemandEventSourcingPublicationServiceError,
} from "./demand-event-sourcing-publication-contract.js";
