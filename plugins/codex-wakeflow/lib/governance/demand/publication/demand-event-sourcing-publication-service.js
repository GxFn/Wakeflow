import { types } from "node:util";
import { parsePlainRecord, PassiveOwnDataError, } from "../../../foundation/data/passive-own-data.js";
import { RootedDirectory } from "../../../foundation/filesystem/rooted-directory.js";
import { inspectRootedExclusiveFileLock, retireRootedExclusiveFileLockResidue, withRootedExclusiveFileLock, RootedExclusiveFileLockError, } from "../../../foundation/filesystem/rooted-exclusive-file-lock.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../../contracts/identity/wakeflow-durable-id.js";
import { admitDemandAuthority, DemandAuthorityError, } from "../model/demand-authority.js";
import { LedgerAuthorityStore, LedgerAuthorityStoreError, } from "../../ledger/ledger-authority-store.js";
import { createDemandEventSourcingPublicationTransaction, DemandEventSourcingPublicationTransactionError, } from "./demand-event-sourcing-publication-transaction.js";
import { DEMAND_EVENT_SOURCING_PUBLICATION_LOCK_TIMEOUT_MILLISECONDS, DemandEventSourcingPublicationServiceError, failDemandEventSourcingPublication as fail, } from "./demand-event-sourcing-publication-contract.js";
import { assertPrivatePublicationNode, ensurePublicationTransaction, initializePublicationStorage, publicationNodeOrNull, readPublicationTransactionAt, recoverPublicationTransactionStages, retirePublicationFile, samePublicationTransaction, } from "./demand-event-sourcing-publication-storage.js";
import { assertPendingPackage, claimPackageForDemandPublication, exactClaimedPackage, inspectPackageForDemandPublication, } from "./demand-event-sourcing-publication-package.js";
import { assertNoActiveDemand } from "./demand-active-guard.js";
import { loadFinalDemandPublication, materializeDemandPublicationStage, publishDemandStage, } from "./demand-event-sourcing-publication-stage.js";
import { demandFinalPublicationMarkerRef, demandPublicationLockRef, demandPublicationTransactionRef, DEMAND_PUBLICATION_TRANSACTIONS_ROOT_REF, } from "./demand-publication-paths.js";
/**
 * Wakeflow Governance / Demand Event Sourcing Publication：跨资源发布流程编排。
 *
 * 本模块只负责同级发布意图文件、Demand 根目录和看板认领的提交顺序，以及流程锁和
 * 公开入口。根作用域存储、认领关系验证和暂存根目录构建分别由相邻模块负责；纯事件
 * 追加不使用该流程锁或发布事务。
 */
function assertRoot(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        fail("input", "$root", "unchanged");
    }
}
function assertLedgerStore(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof LedgerAuthorityStore)) {
        fail("input", "$ledgerStore", "unchanged");
    }
}
function parseSignal(value) {
    if (value === undefined)
        return undefined;
    let record;
    try {
        record = parsePlainRecord(value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    if (Object.keys(record).some((key) => key !== "signal")
        || (record.signal !== undefined
            && (types.isProxy(record.signal) || !(record.signal instanceof AbortSignal)))) {
        fail("input", "$options");
    }
    return record.signal;
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$signal");
}
/** 幂等创建 Workspace 级发布流程目录。 */
export async function initializeDemandEventSourcingPublication(root, options) {
    assertRoot(root);
    await initializePublicationStorage(root, parseSignal(options));
}
async function applyPublication(root, ledgerStore, storedSidecar, signal) {
    const transaction = storedSidecar.transaction;
    const before = await inspectPackageForDemandPublication(root, transaction, signal);
    const alreadyClaimed = exactClaimedPackage(before, transaction);
    if (alreadyClaimed === null)
        assertPendingPackage(before, transaction);
    let finalNode = await publicationNodeOrNull(root, transaction.finalRootRef);
    let stageNode = await publicationNodeOrNull(root, transaction.stageRef);
    let wroteDemandRoot = false;
    if (finalNode !== null && stageNode !== null)
        fail("conflict", "$publication");
    if (finalNode === null) {
        await materializeDemandPublicationStage(root, transaction, signal);
        await publishDemandStage(root, transaction, signal);
        wroteDemandRoot = true;
        finalNode = await publicationNodeOrNull(root, transaction.finalRootRef);
        stageNode = await publicationNodeOrNull(root, transaction.stageRef);
        if (finalNode === null || stageNode !== null)
            fail("conflict", "$publication");
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
    const claim = exactClaimedPackage(await inspectPackageForDemandPublication(root, transaction, signal), transaction);
    if (claim === null)
        fail("conflict", "$board");
    const sidecarRef = demandPublicationTransactionRef(transaction.demandId);
    const sidecarNode = await publicationNodeOrNull(root, sidecarRef);
    if (sidecarNode === null)
        fail("recovery-required", "$transaction");
    const freshSidecar = await readPublicationTransactionAt(root, sidecarRef, sidecarNode, signal);
    if (!samePublicationTransaction(freshSidecar.transaction, transaction)) {
        fail("conflict", "$transaction");
    }
    await retirePublicationFile(root, transaction, sidecarRef, freshSidecar.source.node, signal);
    return Object.freeze({
        publicationAuthority: "current",
        wroteDemandRoot,
        demandId: transaction.demandId,
        rootRef: transaction.finalRootRef,
        claim,
        loaded,
    });
}
function mapLockError(error) {
    if (error.reason === "timeout")
        fail("lock-timeout", "$lock");
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "unsafe-lock"
        || error.reason === "parent"
        || error.reason === "root-scope") {
        fail("lock-unsafe", "$lock");
    }
    fail("recovery-required", "$lock");
}
async function runLocked(root, transaction, signal, operation) {
    try {
        return await withRootedExclusiveFileLock(root, demandPublicationLockRef(transaction.demandId), operation, {
            acquireTimeoutMilliseconds: DEMAND_EVENT_SOURCING_PUBLICATION_LOCK_TIMEOUT_MILLISECONDS,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof DemandEventSourcingPublicationServiceError)
            throw error;
        if (error instanceof RootedExclusiveFileLockError)
            mapLockError(error);
        throw error;
    }
}
async function loadIdempotentResult(root, ledgerStore, transaction, signal) {
    if (await publicationNodeOrNull(root, transaction.finalRootRef) === null) {
        return null;
    }
    if (await publicationNodeOrNull(root, demandFinalPublicationMarkerRef(transaction.demandId)) !== null) {
        return null;
    }
    const claim = exactClaimedPackage(await inspectPackageForDemandPublication(root, transaction, signal), transaction);
    if (claim === null)
        return null;
    return Object.freeze({
        publicationAuthority: "current",
        wroteDemandRoot: false,
        demandId: transaction.demandId,
        rootRef: transaction.finalRootRef,
        claim,
        loaded: await loadFinalDemandPublication(root, ledgerStore, transaction, signal),
    });
}
function rethrowWithPublicationAuthority(error, publicationAuthority) {
    if (error instanceof DemandEventSourcingPublicationServiceError) {
        throw new DemandEventSourcingPublicationServiceError(error.reason, error.path, error.publicationAuthority === "unknown"
            ? publicationAuthority
            : error.publicationAuthority);
    }
    throw error;
}
/** 失败后只读观察exact transaction，不把残留、冲突或观察失败猜成成功。 */
async function classifyPublicationAuthority(root, ledgerStore, transaction, signal) {
    try {
        const sidecarRef = demandPublicationTransactionRef(transaction.demandId);
        const sidecarNode = await publicationNodeOrNull(root, sidecarRef);
        if (sidecarNode !== null) {
            const stored = await readPublicationTransactionAt(root, sidecarRef, sidecarNode, signal);
            return samePublicationTransaction(stored.transaction, transaction)
                ? "recoverable"
                : "unknown";
        }
        if ((await loadIdempotentResult(root, ledgerStore, transaction, signal)) !==
            null) {
            return "current";
        }
        if ((await publicationNodeOrNull(root, transaction.finalRootRef)) !== null ||
            (await publicationNodeOrNull(root, transaction.stageRef)) !== null) {
            return "unknown";
        }
        assertPendingPackage(await inspectPackageForDemandPublication(root, transaction, signal), transaction);
        return "unchanged";
    }
    catch {
        return "unknown";
    }
}
/** 根据已确认的身份/权威关系记录和看板上待认领的需求包，发布修订号 1 的 Demand。 */
export async function publishDemandFromPackage(root, ledgerStore, inputValue, options) {
    assertRoot(root);
    assertLedgerStore(ledgerStore);
    let signal;
    let transaction;
    try {
        signal = parseSignal(options);
        try {
            transaction = createDemandEventSourcingPublicationTransaction(inputValue);
        }
        catch (error) {
            if (error instanceof DemandEventSourcingPublicationTransactionError) {
                fail("input", "$input");
            }
            throw error;
        }
        try {
            await admitDemandAuthority(transaction.identity, transaction.authority, ledgerStore, signal === undefined ? undefined : { signal });
        }
        catch (error) {
            if (error instanceof DemandAuthorityError ||
                error instanceof LedgerAuthorityStoreError) {
                if ((error instanceof DemandAuthorityError &&
                    error.reason === "aborted") ||
                    (error instanceof LedgerAuthorityStoreError &&
                        error.reason === "aborted")) {
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
            // ADR-0011 D7 按 ADR-0010 D3 收窄到 pod，apply 再查一次：这是尽力而为的复查，只缩小
            // preview 到 apply 之间的窗口，不是互斥保证——锁按 demandId 取、守卫只看已 claimed
            // 的包，真正的保证需要一把同时覆盖 claim 的 pod 级锁。pod-busy 原样上抛，带占用者。
            await assertNoActiveDemand(root, signal, null, transaction.identity.podId);
        }
    }
    catch (error) {
        rethrowWithPublicationAuthority(error, "unchanged");
    }
    let publicationIntentWriteAttempted = false;
    try {
        await initializePublicationStorage(root, signal);
        return await runLocked(root, transaction, signal, async () => {
            const sidecarRef = demandPublicationTransactionRef(transaction.demandId);
            if (await publicationNodeOrNull(root, sidecarRef) === null) {
                const idempotent = await loadIdempotentResult(root, ledgerStore, transaction, signal);
                if (idempotent !== null)
                    return idempotent;
                assertPendingPackage(await inspectPackageForDemandPublication(root, transaction, signal), transaction);
            }
            publicationIntentWriteAttempted = true;
            const stored = await ensurePublicationTransaction(root, sidecarRef, transaction, signal);
            return applyPublication(root, ledgerStore, stored, signal);
        });
    }
    catch (error) {
        let publicationAuthority = await classifyPublicationAuthority(root, ledgerStore, transaction, signal);
        if (publicationIntentWriteAttempted &&
            publicationAuthority === "unchanged") {
            publicationAuthority = "unknown";
        }
        rethrowWithPublicationAuthority(error, publicationAuthority);
    }
}
async function prepareLockRecovery(root, stored, signal) {
    assertNotAborted(signal);
    // 只有指定的同级意图源文件，以及由事务派生的 Demand 和路径，才能授权退休崩溃锁。
    const current = await readPublicationTransactionAt(root, stored.source.resourcePath, stored.source.node, signal);
    if (!samePublicationTransaction(current.transaction, stored.transaction)) {
        fail("conflict", "$transaction");
    }
    const lockRef = demandPublicationLockRef(stored.transaction.demandId);
    let observation;
    try {
        observation = await inspectRootedExclusiveFileLock(root, lockRef);
    }
    catch (error) {
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
    }
    catch (error) {
        if (error instanceof RootedExclusiveFileLockError) {
            fail("recovery-required", "$lock");
        }
        throw error;
    }
}
/** 根据自包含的同级发布意图文件，前向完成已经开始的发布流程。 */
export async function recoverDemandPublication(root, ledgerStore, demandIdValue, options) {
    assertRoot(root);
    assertLedgerStore(ledgerStore);
    let signal;
    let demandId;
    try {
        signal = parseSignal(options);
        demandId = parseWakeflowDurableIdOfKind(demandIdValue, "demand", "$demandId");
        assertNotAborted(signal);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError) {
            fail("input", "$demandId", "unchanged");
        }
        rethrowWithPublicationAuthority(error, "unchanged");
    }
    let transaction = null;
    try {
        const ref = demandPublicationTransactionRef(demandId);
        const transactionsRootNode = await publicationNodeOrNull(root, DEMAND_PUBLICATION_TRANSACTIONS_ROOT_REF);
        if (transactionsRootNode === null)
            fail("not-found", "$transaction");
        assertPrivatePublicationNode(transactionsRootNode, "directory", "$transactions");
        await recoverPublicationTransactionStages(root, ref, signal);
        const node = await publicationNodeOrNull(root, ref);
        if (node === null)
            fail("not-found", "$transaction");
        const stored = await readPublicationTransactionAt(root, ref, node, signal);
        if (stored.transaction.demandId !== demandId) {
            fail("conflict", "$transaction/demandId");
        }
        transaction = stored.transaction;
        await initializePublicationStorage(root, signal);
        await prepareLockRecovery(root, stored, signal);
        return await runLocked(root, stored.transaction, signal, async () => {
            const freshNode = await publicationNodeOrNull(root, ref);
            if (freshNode === null)
                fail("not-found", "$transaction");
            const fresh = await readPublicationTransactionAt(root, ref, freshNode, signal);
            if (!samePublicationTransaction(fresh.transaction, stored.transaction)) {
                fail("conflict", "$transaction");
            }
            return applyPublication(root, ledgerStore, fresh, signal);
        });
    }
    catch (error) {
        const publicationAuthority = transaction === null
            ? "unknown"
            : await classifyPublicationAuthority(root, ledgerStore, transaction, signal);
        rethrowWithPublicationAuthority(error, publicationAuthority);
    }
}
export { DemandEventSourcingPublicationServiceError, } from "./demand-event-sourcing-publication-contract.js";
