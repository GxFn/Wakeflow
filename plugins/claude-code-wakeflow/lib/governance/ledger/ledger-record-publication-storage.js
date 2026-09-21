import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { DeterministicJsonDocumentError, } from "../../foundation/data/deterministic-json-document.js";
import { createFileAtomically, DurableAtomicFileWriteError, } from "../../foundation/filesystem/durable-atomic-file-write.js";
import { recoverDurableAtomicFileStagesMatchingTargets, DurableAtomicFileStageRecoveryError, } from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import { inspectDirectoryTreeCandidate, DurableDirectoryTreeCandidateError, } from "../../foundation/filesystem/durable-directory-tree-candidate.js";
import { publishDirectoryTreeCandidateDurably, DurableDirectoryTreePublicationError, } from "../../foundation/filesystem/durable-directory-tree-publication.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import { unlinkRegularFileExactly, ExactRegularFileUnlinkError, } from "../../foundation/filesystem/exact-regular-file-unlink.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { inspectRootedExclusiveFileLock, retireRootedExclusiveFileLockResidue, withRootedExclusiveFileLock, RootedExclusiveFileLockError, } from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../foundation/filesystem/strict-text-file.js";
import { admitWakeflowResourceOperation, WakeflowResourceProcessingContractError, } from "../../foundation/resource/resource-processing-contract.js";
import { loadLedgerAuthorityRecord } from "./ledger-authority-reader.js";
import { computeLedgerAuthorityRecordDigest } from "./ledger-authority-record.js";
import { LedgerAuthorityStoreError, throwLedgerAuthorityStoreError as fail, } from "./ledger-authority-store-contract.js";
import { createLedgerAuthorityResourceCatalog } from "./ledger-resource-catalog.js";
import { parseLedgerRecordPublicationIntentDocument, renderLedgerRecordPublicationIntent, sameLedgerRecordPublicationIntent, LedgerRecordPublicationIntentError, } from "./ledger-record-publication-intent.js";
import { LEDGER_PUBLICATION_INTENT_MAXIMUM_BYTES, LEDGER_RECORD_PUBLICATION_LOCK_TIMEOUT_MILLISECONDS, LEDGER_DURABLE_DIRECTORY_MODE, LEDGER_TRANSACTION_FILE_MODE, } from "./ledger-authority-storage-policy.js";
function currentUserId() {
    return typeof process.geteuid === "function"
        ? BigInt(process.geteuid())
        : null;
}
function admitLedgerResourceOperation(intent, resourcePath, recipe) {
    const declaration = createLedgerAuthorityResourceCatalog(intent.record).find((entry) => entry.placement.relativePath === resourcePath);
    if (declaration === undefined)
        fail("operation-failure", "$catalog");
    try {
        admitWakeflowResourceOperation(declaration.processing, recipe);
    }
    catch (error) {
        if (error instanceof WakeflowResourceProcessingContractError) {
            fail("operation-failure", "$catalog");
        }
        throw error;
    }
}
export async function ledgerPublicationResourceNodeOrNull(root, resourcePath) {
    try {
        return (await root.inspectExistingResource(resourcePath)).node;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError
            && error.reason === "resource-not-found") {
            return null;
        }
        if (error instanceof RootedDirectoryError)
            fail("root-scope", "$root");
        throw error;
    }
}
function assertTransactionFileNode(node) {
    if (node.kind !== "file"
        || node.permissionBits !== LEDGER_TRANSACTION_FILE_MODE
        || node.linkCount !== 1n
        || (currentUserId() !== null && node.userId !== currentUserId())) {
        fail("conflict", "$intent");
    }
}
function assertTransactionStageNode(node) {
    if (node.kind !== "directory"
        || node.permissionBits !== LEDGER_DURABLE_DIRECTORY_MODE
        || (currentUserId() !== null && node.userId !== currentUserId())) {
        fail("conflict", "$stage");
    }
}
async function readStoredIntent(root, intentRef, expectedNode, signal) {
    assertTransactionFileNode(expectedNode);
    let read;
    try {
        read = await readDeterministicJsonFile(root, intentRef, {
            maximumBytes: LEDGER_PUBLICATION_INTENT_MAXIMUM_BYTES,
            expectedNode,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof StableFileReadError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "too-large")
                fail("capacity", "$intent");
            fail("conflict", "$intent");
        }
        if (error instanceof StrictTextFileError
            || error instanceof DeterministicJsonDocumentError) {
            fail("conflict", "$intent");
        }
        throw error;
    }
    let intent;
    try {
        intent = parseLedgerRecordPublicationIntentDocument(read.text);
    }
    catch (error) {
        if (error instanceof LedgerRecordPublicationIntentError) {
            fail("conflict", "$intent");
        }
        throw error;
    }
    return Object.freeze({ intent, node: read.node });
}
export async function existingLedgerRecordPublicationIntentOrNull(root, intentRef, signal) {
    const node = await ledgerPublicationResourceNodeOrNull(root, intentRef);
    return node === null ? null : readStoredIntent(root, intentRef, node, signal);
}
export async function ensureLedgerRecordPublicationIntent(root, expected, signal) {
    admitLedgerResourceOperation(expected, expected.intentRef, "exclusive-create");
    const existing = await existingLedgerRecordPublicationIntentOrNull(root, expected.intentRef, signal);
    if (existing !== null) {
        if (!sameLedgerRecordPublicationIntent(existing.intent, expected)) {
            fail("conflict", "$intent");
        }
        return existing;
    }
    const bytes = encodeUtf8(renderLedgerRecordPublicationIntent(expected));
    if (bytes.byteLength > LEDGER_PUBLICATION_INTENT_MAXIMUM_BYTES) {
        fail("capacity", "$intent");
    }
    try {
        await createFileAtomically(root, expected.intentRef, bytes, {
            mode: LEDGER_TRANSACTION_FILE_MODE,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof DurableAtomicFileWriteError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "capacity")
                fail("capacity", "$intent");
            if (error.reason === "root-scope")
                fail("root-scope", "$root");
            if (error.reason === "commit-uncertain"
                || error.reason === "durability-failure"
                || error.reason === "stage-cleanup-failure"
                || error.reason === "stage-recovery-required"
                || error.reason === "close-failure") {
                fail("recovery-required", "$intent");
            }
            if (error.reason !== "target-exists") {
                fail("operation-failure", "$intent");
            }
        }
        else {
            throw error;
        }
    }
    const stored = await existingLedgerRecordPublicationIntentOrNull(root, expected.intentRef, signal);
    if (stored === null
        || !sameLedgerRecordPublicationIntent(stored.intent, expected)) {
        fail("conflict", "$intent");
    }
    return stored;
}
export async function retireLedgerRecordPublicationIntent(root, stored, signal) {
    admitLedgerResourceOperation(stored.intent, stored.intent.intentRef, "exact-retire");
    try {
        await unlinkRegularFileExactly(root, stored.intent.intentRef, {
            expectedNode: stored.node,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof ExactRegularFileUnlinkError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("recovery-required", "$intent");
        }
        throw error;
    }
}
export async function inspectLedgerRecordPublicationResidues(root, intent, _signal) {
    const stageNode = await ledgerPublicationResourceNodeOrNull(root, intent.stageRef);
    if (stageNode !== null)
        assertTransactionStageNode(stageNode);
    return Object.freeze({
        stageNode,
    });
}
export async function recoverLedgerIntentAtomicStages(root, intentRef, signal) {
    try {
        const receipt = await recoverDurableAtomicFileStagesMatchingTargets(root, Object.freeze([intentRef]), signal === undefined ? undefined : { signal });
        if (receipt.activeStageCount !== 0 || receipt.unknownStageCount !== 0) {
            fail("recovery-required", "$intent/stage");
        }
    }
    catch (error) {
        if (error instanceof LedgerAuthorityStoreError)
            throw error;
        if (error instanceof DurableAtomicFileStageRecoveryError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("recovery-required", "$intent/stage");
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
            fail("lock-unsafe", "$lock");
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
            fail("recovery-required", "$lock");
        }
        throw error;
    }
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
export async function loadExactPublishedLedgerRecord(root, intent, signal) {
    const finalNode = await ledgerPublicationResourceNodeOrNull(root, intent.finalRootRef);
    if (finalNode === null)
        fail("not-found", "$record");
    if (finalNode.kind !== "directory")
        fail("conflict", "$record");
    try {
        await inspectDirectoryTreeCandidate(root, intent.finalRootRef, intent.treePlan, {
            expectedRootNode: finalNode,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof DurableDirectoryTreeCandidateError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("conflict", "$record");
        }
        throw error;
    }
    const loaded = await loadLedgerAuthorityRecord(root, intent.record.requirementId, signal);
    if (loaded.recordDigest !== computeLedgerAuthorityRecordDigest(intent.record)
        || loaded.documents.length !== intent.record.documents.length
        || loaded.documents.some((document, index) => (document.digest !== intent.record.documents[index]?.digest))) {
        fail("conflict", "$record");
    }
    return loaded;
}
export async function publishLedgerRecordStage(root, intent, candidate, signal) {
    admitLedgerResourceOperation(intent, intent.finalRootRef, "exact-directory-publish");
    try {
        await publishDirectoryTreeCandidateDurably(root, candidate, intent.finalRootRef, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (error instanceof DurableDirectoryTreePublicationError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "cross-device")
                fail("root-scope", "$stage");
            if (error.reason === "commit-uncertain"
                || error.reason === "durability-failure") {
                fail("recovery-required", "$stage");
            }
            fail("conflict", "$stage");
        }
        throw error;
    }
}
export async function settleCommittedLedgerIntent(root, stored, residues, signal) {
    if (residues.stageNode !== null) {
        fail("recovery-required", "$stage");
    }
    const loaded = await loadExactPublishedLedgerRecord(root, stored.intent, signal);
    await retireLedgerRecordPublicationIntent(root, stored, signal);
    return loaded;
}
