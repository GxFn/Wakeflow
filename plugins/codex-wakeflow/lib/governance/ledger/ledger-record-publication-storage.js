import { DurableDirectoryTreeCandidateError, inspectDirectoryTreeCandidate, } from "../../foundation/filesystem/durable-directory-tree-candidate.js";
import { DurableDirectoryTreePublicationError, publishDirectoryTreeCandidateDurably, } from "../../foundation/filesystem/durable-directory-tree-publication.js";
import { RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
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
function assertTransactionStageNode(node) {
    const userId = currentUserIdOrNull();
    if (node.kind !== "directory" ||
        node.permissionBits !== LEDGER_DURABLE_DIRECTORY_MODE ||
        (userId !== null && node.userId !== userId)) {
        fail("conflict", "$stage");
    }
}
/** 这条记录的暂存目录；不在即 null。它只可能是同一份内容被打断的发布留下的。 */
export async function ledgerRecordPublicationStageNodeOrNull(root, plan) {
    const stageNode = await ledgerPublicationResourceNodeOrNull(root, plan.stageRef);
    if (stageNode !== null)
        assertTransactionStageNode(stageNode);
    return stageNode;
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
