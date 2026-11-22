import { DurableDirectoryTreeCandidateError, inspectDirectoryTreeCandidate, } from "../../foundation/filesystem/durable-directory-tree-candidate.js";
import { DurableDirectoryTreePublicationError, publishDirectoryTreeCandidateDurably, } from "../../foundation/filesystem/durable-directory-tree-publication.js";
import { RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { RootedDirectoryTreeRemovalError, removeRootedDirectoryTree, } from "../../foundation/filesystem/rooted-directory-tree-removal.js";
import { inspectRootedExclusiveFileLock, RootedExclusiveFileLockError, retireRootedExclusiveFileLockResidue, withRootedExclusiveFileLock, } from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import { currentUserIdOrNull } from "../../foundation/node/current-user.js";
import { admitWakeflowResourceOperation, WakeflowResourceProcessingContractError, } from "../../foundation/resource/resource-processing-contract.js";
import { loadLedgerAuthorityRecord } from "./ledger-authority-reader.js";
import { computeLedgerAuthorityRecordDigest, } from "./ledger-authority-record.js";
import { LEDGER_DURABLE_DIRECTORY_MODE, LEDGER_RECORD_PUBLICATION_LOCK_TIMEOUT_MILLISECONDS, } from "./ledger-authority-storage-policy.js";
import { throwLedgerAuthorityStoreError as fail, LedgerAuthorityStoreError, } from "./ledger-authority-store-contract.js";
import { createLedgerAuthorityResourceCatalog } from "./ledger-resource-catalog.js";
function admitLedgerResourceOperation(plan, resourcePath, recipe) {
    const declaration = createLedgerAuthorityResourceCatalog(plan.record).find((entry) => entry.placement.relativePath === resourcePath);
    if (declaration === undefined)
        fail("operation-failure", "$catalog");
    try {
        admitWakeflowResourceOperation(declaration.processing, recipe);
    }
    catch (error) {
        if (error instanceof WakeflowResourceProcessingContractError) {
            fail("operation-failure", "$catalog", error);
        }
        throw error;
    }
}
export async function ledgerPublicationResourceNodeOrNull(root, resourcePath) {
    try {
        return (await root.inspectExistingResource(resourcePath)).node;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError && error.reason === "resource-not-found") {
            return null;
        }
        if (error instanceof RootedDirectoryError)
            fail("root-scope", "$root", error);
        throw error;
    }
}
/**
 * 这条记录的暂存目录处在哪种状态。它只可能是同一份内容被打断的发布留下的。
 *
 * - `absent`：不在。
 * - `resumable`：当前用户的目录、权限位是持久目录的，交给补齐路径续做。
 * - `residue`：当前用户的目录，但权限位不对。进程 umask 把请求的权限位收窄时，mkdir 以收窄后的
 *   权限位出生、再经句柄 chmod：chmod 之前进程被杀，或者掉电时 chmod 没有落盘（第 1 段起建造期间
 *   不同步目录），都会留下它；发布器把它删掉重建。不被收窄时（常见的 umask 022）目录以请求的
 *   权限位出生，新的建造不会留下这种状态；1.4.0 的建造被打断留下的暂存（那时一律以 0700 出生）仍是它。
 *
 * 不是目录、或属于别的用户的节点不是本发布器造的，照旧报冲突。
 */
export async function ledgerRecordPublicationStageState(root, plan) {
    const stageNode = await ledgerPublicationResourceNodeOrNull(root, plan.stageRef);
    if (stageNode === null)
        return "absent";
    const userId = currentUserIdOrNull();
    if (stageNode.kind !== "directory" || (userId !== null && stageNode.userId !== userId)) {
        fail("conflict", "$stage");
    }
    return stageNode.permissionBits === LEDGER_DURABLE_DIRECTORY_MODE ? "resumable" : "residue";
}
/**
 * 删掉这条记录的暂存目录整棵树，删除之后同步 `transactions/` 一次再返回。只由发布器在记录锁内、
 * final 不在时调用（安全论证在发布器里）。删不掉报 `recovery-required`：树可能删了一半，同一个
 * 请求再发一次会重新判断，续做或者再删。
 */
export async function retireLedgerRecordPublicationStage(root, plan, signal) {
    try {
        await removeRootedDirectoryTree(root, plan.stageRef, signal === undefined ? undefined : { signal }, "$stage");
    }
    catch (error) {
        if (error instanceof RootedDirectoryTreeRemovalError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal", error);
            fail("recovery-required", "$stage", error);
        }
        throw error;
    }
}
export async function prepareLedgerRecordPublicationLockRecovery(root, lockRef) {
    let observation;
    try {
        observation = await inspectRootedExclusiveFileLock(root, lockRef);
    }
    catch (error) {
        if (error instanceof RootedExclusiveFileLockError) {
            fail("lock-unsafe", "$lock", error);
        }
        throw error;
    }
    if (observation.status !== "held" || observation.ownerState !== "inactive") {
        return;
    }
    try {
        await retireRootedExclusiveFileLockResidue(root, lockRef, observation);
    }
    catch (error) {
        if (error instanceof RootedExclusiveFileLockError) {
            fail("recovery-required", "$lock", error);
        }
        throw error;
    }
}
function mapLockError(error) {
    if (error.reason === "timeout")
        fail("lock-timeout", "$lock");
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "unsafe-lock" ||
        error.reason === "parent" ||
        error.reason === "root-scope") {
        fail("lock-unsafe", "$lock");
    }
    fail("recovery-required", "$lock");
}
export async function withLedgerRecordPublicationLock(root, lockRef, signal, action) {
    try {
        return await withRootedExclusiveFileLock(root, lockRef, action, {
            acquireTimeoutMilliseconds: LEDGER_RECORD_PUBLICATION_LOCK_TIMEOUT_MILLISECONDS,
            // 账本记录锁是轻档：留下的失效锁由下一次获取退休（1.4.1 第 1 段清单 2.1 节 L7）。
            durability: "content-only",
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof LedgerAuthorityStoreError)
            throw error;
        if (error instanceof RootedExclusiveFileLockError)
            mapLockError(error);
        throw error;
    }
}
export async function loadExactPublishedLedgerRecord(root, plan, signal) {
    const finalNode = await ledgerPublicationResourceNodeOrNull(root, plan.finalRootRef);
    if (finalNode === null)
        fail("not-found", "$record");
    if (finalNode.kind !== "directory")
        fail("conflict", "$record");
    try {
        await inspectDirectoryTreeCandidate(root, plan.finalRootRef, plan.treePlan, {
            expectedRootNode: finalNode,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof DurableDirectoryTreeCandidateError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal", error);
            fail("conflict", "$record", error);
        }
        throw error;
    }
    const loaded = await loadLedgerAuthorityRecord(root, plan.record.requirementId, signal);
    if (loaded.recordDigest !== computeLedgerAuthorityRecordDigest(plan.record) ||
        loaded.documents.length !== plan.record.documents.length ||
        loaded.documents.some((document, index) => document.digest !== plan.record.documents[index]?.digest)) {
        fail("conflict", "$record");
    }
    return loaded;
}
export async function publishLedgerRecordStage(root, plan, candidate, signal) {
    admitLedgerResourceOperation(plan, plan.finalRootRef, "exact-directory-publish");
    try {
        await publishDirectoryTreeCandidateDurably(root, candidate, plan.finalRootRef, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (error instanceof DurableDirectoryTreePublicationError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal", error);
            if (error.reason === "cross-device")
                fail("root-scope", "$stage", error);
            if (error.reason === "commit-uncertain" || error.reason === "durability-failure") {
                fail("recovery-required", "$stage", error);
            }
            fail("conflict", "$stage", error);
        }
        throw error;
    }
}
