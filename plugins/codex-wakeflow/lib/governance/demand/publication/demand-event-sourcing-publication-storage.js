import nodePath from "node:path";
import { createFileAtomically, DurableAtomicFileWriteError, } from "../../../foundation/filesystem/durable-atomic-file-write.js";
import { recoverDurableAtomicFileStagesMatchingTargets, DurableAtomicFileStageRecoveryError, } from "../../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import { materializeDirectoryPath, DurableDirectoryMaterializationError, } from "../../../foundation/filesystem/durable-directory-materialization.js";
import { readDeterministicJsonFile, } from "../../../foundation/filesystem/deterministic-json-file.js";
import { DeterministicJsonDocumentError } from "../../../foundation/data/deterministic-json-document.js";
import { unlinkRegularFileExactly, ExactRegularFileUnlinkError, } from "../../../foundation/filesystem/exact-regular-file-unlink.js";
import { sameFileNodeIdentity, } from "../../../foundation/filesystem/file-node-snapshot.js";
import { splitPortableResourcePath, } from "../../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError, } from "../../../foundation/filesystem/rooted-directory.js";
import { StableFileReadError } from "../../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../../foundation/numeric/byte-count.js";
import { admitWakeflowResourceOperation, WakeflowResourceProcessingContractError, } from "../../../foundation/resource/resource-processing-contract.js";
import { encodeUtf8 } from "../../../foundation/text/utf8.js";
import { createDemandEventSourcingResourceCatalog, WAKEFLOW_DEMAND_STATIC_RESOURCE_CATALOG, } from "../demand-resource-catalog.js";
import { parseDemandEventSourcingPublicationTransactionDocument, renderDemandEventSourcingPublicationTransaction, DemandEventSourcingPublicationTransactionError, } from "./demand-event-sourcing-publication-transaction.js";
import { DEMAND_EVENT_SOURCING_PUBLICATION_DIRECTORY_MODE, DEMAND_EVENT_SOURCING_PUBLICATION_FILE_MODE, DemandEventSourcingPublicationServiceError, failDemandEventSourcingPublication as fail, } from "./demand-event-sourcing-publication-contract.js";
import { DEMAND_PUBLICATION_MARKER_REF, } from "./demand-publication-paths.js";
import { assertActiveLayoutCurrent } from "../../../kernel/active-projection.js";
import { WakeflowError } from "../../../kernel/error.js";
/** Demand 事件溯源发布流程的根作用域文件存储边界。 */
const TRANSACTION_MAXIMUM_BYTES = parseByteCount(24 * 1024 * 1024);
function admitProcessing(processing, recipe) {
    try {
        admitWakeflowResourceOperation(processing, recipe);
    }
    catch (error) {
        if (error instanceof WakeflowResourceProcessingContractError) {
            fail("operation-failure", "$catalog");
        }
        throw error;
    }
}
export function admitDemandPublicationResourceOperation(transaction, ref, recipe) {
    const declaration = createDemandEventSourcingResourceCatalog(transaction.demandId).find((entry) => entry.placement.relativePath === ref);
    if (declaration === undefined)
        fail("operation-failure", "$catalog");
    admitProcessing(declaration.processing, recipe);
}
function mapPublicationReadError(error, path) {
    if (error instanceof StableFileReadError) {
        if (error.reason === "aborted")
            fail("aborted", "$signal");
        if (error.reason === "root-scope"
            || error.reason === "unsupported-platform") {
            fail("root-scope", "$root");
        }
        fail("conflict", path);
    }
    if (error instanceof StrictTextFileError
        || error instanceof DeterministicJsonDocumentError) {
        fail("conflict", path);
    }
    throw error;
}
export async function publicationNodeOrNull(root, ref) {
    try {
        return (await root.inspectExistingResource(ref)).node;
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
export function assertPrivatePublicationNode(node, kind, path, admittedFileLinks = [1n]) {
    if (node.kind !== kind
        || node.permissionBits !== (kind === "file"
            ? DEMAND_EVENT_SOURCING_PUBLICATION_FILE_MODE
            : DEMAND_EVENT_SOURCING_PUBLICATION_DIRECTORY_MODE)
        || (kind === "file" && !admittedFileLinks.includes(node.linkCount))
        || (typeof process.geteuid === "function"
            && node.userId !== BigInt(process.geteuid()))) {
        fail("conflict", path);
    }
}
export async function readPublicationTransactionAt(root, ref, node, signal) {
    assertPrivatePublicationNode(node, "file", "$transaction");
    let read;
    try {
        read = await readDeterministicJsonFile(root, ref, {
            maximumBytes: TRANSACTION_MAXIMUM_BYTES,
            expectedNode: node,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        mapPublicationReadError(error, "$transaction");
    }
    let transaction;
    try {
        transaction = parseDemandEventSourcingPublicationTransactionDocument(read.text);
    }
    catch (error) {
        if (error instanceof DemandEventSourcingPublicationTransactionError) {
            fail("conflict", "$transaction");
        }
        throw error;
    }
    return Object.freeze({ transaction, source: read });
}
export async function ensureExactPublicationTextFile(root, ref, text, maximumBytes, signal) {
    const admittedMaximumBytes = parseByteCount(maximumBytes, "$maximumBytes");
    const bytes = encodeUtf8(text, "$text");
    if (bytes.byteLength > admittedMaximumBytes)
        fail("capacity", "$write");
    let node = await publicationNodeOrNull(root, ref);
    if (node === null) {
        try {
            const created = await createFileAtomically(root, ref, bytes, {
                mode: DEMAND_EVENT_SOURCING_PUBLICATION_FILE_MODE,
                ...(signal === undefined ? {} : { signal }),
            });
            node = created.node;
        }
        catch (error) {
            if (error instanceof DurableAtomicFileWriteError
                && error.reason === "target-exists") {
                node = await publicationNodeOrNull(root, ref);
            }
            else if (error instanceof DurableAtomicFileWriteError) {
                if (error.reason === "aborted")
                    fail("aborted", "$signal");
                if (error.reason === "capacity")
                    fail("capacity", "$write");
                if (error.reason === "root-scope")
                    fail("root-scope", "$root");
                if (error.reason === "commit-uncertain"
                    || error.reason === "durability-failure"
                    || error.reason === "stage-cleanup-failure"
                    || error.reason === "stage-recovery-required"
                    || error.reason === "close-failure") {
                    fail("recovery-required", "$write");
                }
                fail("operation-failure", "$write");
            }
            else {
                throw error;
            }
        }
    }
    if (node === null)
        fail("operation-failure", "$write");
    assertPrivatePublicationNode(node, "file", "$write");
    let read;
    try {
        read = await readDeterministicJsonFile(root, ref, {
            maximumBytes: admittedMaximumBytes,
            expectedNode: node,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        mapPublicationReadError(error, "$write");
    }
    if (read.text !== text)
        fail("conflict", "$write");
    return read;
}
export async function ensurePublicationTransaction(root, ref, transaction, signal) {
    if (ref !== DEMAND_PUBLICATION_MARKER_REF) {
        admitDemandPublicationResourceOperation(transaction, ref, "exclusive-create");
    }
    const text = renderDemandEventSourcingPublicationTransaction(transaction);
    const source = await ensureExactPublicationTextFile(root, ref, text, TRANSACTION_MAXIMUM_BYTES, signal);
    const stored = await readPublicationTransactionAt(root, ref, source.node, signal);
    if (!samePublicationTransaction(stored.transaction, transaction)) {
        fail("conflict", "$transaction");
    }
    return stored;
}
export async function retirePublicationFile(root, transaction, ref, node, signal) {
    admitDemandPublicationResourceOperation(transaction, ref, "exact-retire");
    try {
        await unlinkRegularFileExactly(root, ref, {
            expectedNode: node,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof ExactRegularFileUnlinkError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("recovery-required", "$transaction");
        }
        throw error;
    }
}
function publicationPhysicalPath(root, ref) {
    return nodePath.join(root.absolutePath, ...splitPortableResourcePath(ref));
}
export function samePublicationTransaction(left, right) {
    return renderDemandEventSourcingPublicationTransaction(left)
        === renderDemandEventSourcingPublicationTransaction(right);
}
export async function initializePublicationStorage(root, signal) {
    try {
        await assertActiveLayoutCurrent(root, signal === undefined ? {} : { signal });
        for (const declaration of WAKEFLOW_DEMAND_STATIC_RESOURCE_CATALOG) {
            const ref = declaration.placement.relativePath;
            if (ref === null)
                fail("operation-failure", "$catalog");
            admitProcessing(declaration.processing, "materialize-directory");
            const materialized = await materializeDirectoryPath(root, ref, {
                mode: DEMAND_EVENT_SOURCING_PUBLICATION_DIRECTORY_MODE,
                ...(signal === undefined ? {} : { signal }),
            });
            assertPrivatePublicationNode(materialized.node, "directory", `$${ref}`);
        }
    }
    catch (error) {
        if (error instanceof WakeflowError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "active-layout-root-scope")
                fail("root-scope", "$root");
            fail("conflict", "$activeLayout");
        }
        if (error instanceof DurableDirectoryMaterializationError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("operation-failure", "$initialize");
        }
        throw error;
    }
}
/** 显式恢复 Workspace 发布事务中不再活动的原子暂存文件。 */
export async function recoverPublicationTransactionStages(root, transactionRef, signal) {
    try {
        const receipt = await recoverDurableAtomicFileStagesMatchingTargets(root, Object.freeze([transactionRef]), signal === undefined ? undefined : { signal });
        if (receipt.activeStageCount !== 0
            || receipt.unknownStageCount !== 0) {
            fail("recovery-required", "$transaction/stage");
        }
    }
    catch (error) {
        if (error instanceof DurableAtomicFileStageRecoveryError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("recovery-required", "$transaction/stage");
        }
        throw error;
    }
}
export async function openDemandPublicationRoot(workspaceRoot, ref, expectedNode) {
    let opened;
    try {
        opened = await RootedDirectory.open(publicationPhysicalPath(workspaceRoot, ref), undefined, { durability: workspaceRoot.durability });
        const current = await opened.assertCurrent("$demandRoot");
        if (expectedNode !== undefined
            && !sameFileNodeIdentity(expectedNode, current)) {
            fail("conflict", "$demandRoot");
        }
        assertPrivatePublicationNode(current, "directory", "$demandRoot");
        return opened;
    }
    catch (error) {
        if (opened !== undefined) {
            try {
                await opened.close();
            }
            catch {
                // 打开失败的root没有交给调用方；保留首个准入错误。
            }
        }
        if (error instanceof DemandEventSourcingPublicationServiceError) {
            throw error;
        }
        if (error instanceof RootedDirectoryError) {
            fail("conflict", "$demandRoot");
        }
        throw error;
    }
}
