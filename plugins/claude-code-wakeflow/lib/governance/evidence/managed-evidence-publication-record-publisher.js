import { types } from "node:util";
import { inspectDirectoryTreeCandidate, DurableDirectoryTreeCandidateError, } from "../../foundation/filesystem/durable-directory-tree-candidate.js";
import { publishDirectoryTreeCandidateDurably, DurableDirectoryTreePublicationError, } from "../../foundation/filesystem/durable-directory-tree-publication.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { admitWakeflowResourceOperation, WakeflowResourceProcessingContractError, } from "../../foundation/resource/resource-processing-contract.js";
import { createManagedEvidenceRecordResourceDeclaration, } from "./managed-evidence-resource-catalog.js";
import { requireCurrentManagedEvidencePublicationTransaction, ManagedEvidencePublicationTransactionStoreError, } from "./managed-evidence-publication-transaction-store.js";
import { deriveManagedEvidencePublicationRecordTreePlan, parseManagedEvidencePublicationTransaction, ManagedEvidencePublicationTransactionError, } from "./managed-evidence-publication-transaction.js";
import { MANAGED_EVIDENCE_RECORD_DIRECTORY_MODE, } from "./managed-evidence-record-tree-plan.js";
const ERROR_MESSAGES = {
    input: "Managed evidence publication record publisher input is invalid.",
    journal: "Managed evidence publication record journal is absent, changed, or different.",
    "root-scope": "Managed evidence publication record escaped its Demand root.",
    "stage-missing": "Managed evidence publication record has no stage or final tree.",
    "stage-conflict": "Managed evidence publication stage is incomplete or conflicting.",
    "final-conflict": "Managed evidence publication final record conflicts with its plan.",
    "destination-exists": "Managed evidence publication final destination appeared before commit.",
    "cross-device": "Managed evidence publication record requires one filesystem device.",
    aborted: "Managed evidence publication record publish was aborted before commit.",
    "durability-failure": "Managed evidence publication final directory entries are not durable.",
    "commit-uncertain": "Managed evidence publication final commit could not be proven exact.",
    "operation-failure": "Managed evidence publication record could not be published safely.",
};
export class ManagedEvidencePublicationRecordPublisherError extends Error {
    name = "ManagedEvidencePublicationRecordPublisherError";
    code = "wakeflow-managed-evidence-publication-record-publisher";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new ManagedEvidencePublicationRecordPublisherError(reason, path);
}
function assertRoot(value) {
    if (typeof value !== "object" ||
        value === null ||
        types.isProxy(value) ||
        !(value instanceof RootedDirectory)) {
        fail("input", "$demandRoot");
    }
}
function parseOptions(value) {
    let record;
    try {
        record = parsePlainRecord(value === undefined ? {} : value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    if (Object.keys(record).some((key) => key !== "signal") ||
        (record.signal !== undefined &&
            (typeof record.signal !== "object" ||
                record.signal === null ||
                types.isProxy(record.signal) ||
                !(record.signal instanceof AbortSignal)))) {
        fail("input", "$options");
    }
    return Object.freeze({ signal: record.signal });
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$signal");
}
function parseTransaction(value) {
    try {
        return parseManagedEvidencePublicationTransaction(value);
    }
    catch (error) {
        if (error instanceof ManagedEvidencePublicationTransactionError) {
            fail("input", "$transaction");
        }
        throw error;
    }
}
function mapStoreError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "root-scope")
        fail("root-scope", "$demandRoot");
    fail("journal", "$journal");
}
async function requireJournal(root, transaction, signal, expectedNode) {
    try {
        return await requireCurrentManagedEvidencePublicationTransaction(root, transaction, expectedNode, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (error instanceof ManagedEvidencePublicationTransactionStoreError) {
            mapStoreError(error);
        }
        throw error;
    }
}
async function nodeOrNull(root, resourcePath) {
    try {
        return (await root.inspectExistingResource(resourcePath, "$resource")).node;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError &&
            error.reason === "resource-not-found") {
            return null;
        }
        if (error instanceof RootedDirectoryError)
            fail("root-scope", "$demandRoot");
        throw error;
    }
}
async function inspectPhysicalState(root, plan) {
    return Object.freeze({
        stageNode: await nodeOrNull(root, plan.candidateRootPath),
        finalNode: await nodeOrNull(root, plan.destinationRootPath),
    });
}
function assertPrivateRootNode(node, owner) {
    if (node.kind !== "directory" ||
        node.permissionBits !== MANAGED_EVIDENCE_RECORD_DIRECTORY_MODE ||
        (typeof process.geteuid === "function" &&
            node.userId !== BigInt(process.geteuid()))) {
        fail(owner === "stage" ? "stage-conflict" : "final-conflict", `$${owner}`);
    }
}
function mapInspectionError(error, owner) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    fail(owner === "stage" ? "stage-conflict" : "final-conflict", `$${owner}`);
}
async function inspectTree(root, path, plan, expectedNode, owner, signal) {
    assertPrivateRootNode(expectedNode, owner);
    try {
        return await inspectDirectoryTreeCandidate(root, path, plan.directoryPlan, {
            expectedRootNode: expectedNode,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof DurableDirectoryTreeCandidateError) {
            mapInspectionError(error, owner);
        }
        throw error;
    }
}
function admitFinalPublish(transaction) {
    const declaration = createManagedEvidenceRecordResourceDeclaration(transaction.manifest.demandId, transaction.manifest.evidenceId);
    try {
        admitWakeflowResourceOperation(declaration.processing, "tree-publish-or-move");
    }
    catch (error) {
        if (error instanceof WakeflowResourceProcessingContractError) {
            fail("operation-failure", "$catalog");
        }
        throw error;
    }
}
function mapPublicationError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "input")
        fail("input", error.path);
    if (error.reason === "destination-exists") {
        fail("destination-exists", "$final");
    }
    if (error.reason === "cross-device")
        fail("cross-device", "$final");
    if (error.reason === "durability-failure") {
        fail("durability-failure", "$final");
    }
    if (error.reason === "commit-uncertain") {
        fail("commit-uncertain", "$final");
    }
    if (error.reason === "source-changed" ||
        error.reason === "source-conflict") {
        fail("stage-conflict", "$stage");
    }
    fail("operation-failure", "$final");
}
async function currentFinalOrNull(root, transaction, plan, journalNode, signal) {
    const physical = await inspectPhysicalState(root, plan);
    if (physical.stageNode !== null && physical.finalNode !== null) {
        fail("stage-conflict", "$stage");
    }
    if (physical.finalNode === null) {
        if (physical.stageNode === null)
            fail("commit-uncertain", "$final");
        return null;
    }
    const finalRecord = await inspectTree(root, plan.destinationRootPath, plan, physical.finalNode, "final", signal);
    await requireJournal(root, transaction, signal, journalNode);
    return finalRecord;
}
/** 发布或幂等读取journal绑定的immutable final record；不检查或追加Event。 */
export async function publishManagedEvidencePublicationRecord(demandRootValue, transactionValue, optionsValue = {}) {
    assertRoot(demandRootValue);
    const options = parseOptions(optionsValue);
    assertNotAborted(options.signal);
    const transaction = parseTransaction(transactionValue);
    const stored = await requireJournal(demandRootValue, transaction, options.signal);
    const plan = deriveManagedEvidencePublicationRecordTreePlan(transaction);
    const physical = await inspectPhysicalState(demandRootValue, plan);
    if (physical.finalNode !== null) {
        if (physical.stageNode !== null)
            fail("stage-conflict", "$stage");
        const finalRecord = await inspectTree(demandRootValue, plan.destinationRootPath, plan, physical.finalNode, "final", options.signal);
        await requireJournal(demandRootValue, transaction, options.signal, stored.source.node);
        return Object.freeze({
            disposition: "current",
            transactionDigest: stored.transactionDigest,
            finalRecord,
            publication: null,
        });
    }
    if (physical.stageNode === null)
        fail("stage-missing", "$stage");
    const stage = await inspectTree(demandRootValue, plan.candidateRootPath, plan, physical.stageNode, "stage", options.signal);
    admitFinalPublish(transaction);
    await requireJournal(demandRootValue, transaction, options.signal, stored.source.node);
    let publication;
    try {
        publication = await publishDirectoryTreeCandidateDurably(demandRootValue, stage, plan.destinationRootPath, options.signal === undefined ? undefined : { signal: options.signal });
    }
    catch (error) {
        if (error instanceof DurableDirectoryTreePublicationError) {
            if (error.reason === "destination-exists" ||
                error.reason === "source-changed" ||
                error.reason === "commit-uncertain" ||
                error.reason === "durability-failure") {
                const concurrent = await currentFinalOrNull(demandRootValue, transaction, plan, stored.source.node, undefined);
                if (concurrent !== null) {
                    return Object.freeze({
                        disposition: "current",
                        transactionDigest: stored.transactionDigest,
                        finalRecord: concurrent,
                        publication: null,
                    });
                }
            }
            mapPublicationError(error);
        }
        throw error;
    }
    let finalRecord;
    try {
        const finalNode = await nodeOrNull(demandRootValue, plan.destinationRootPath);
        if (finalNode === null)
            fail("commit-uncertain", "$final");
        finalRecord = await inspectTree(demandRootValue, plan.destinationRootPath, plan, finalNode, "final", undefined);
        await requireJournal(demandRootValue, transaction, undefined, stored.source.node);
    }
    catch (error) {
        if (error instanceof ManagedEvidencePublicationRecordPublisherError) {
            fail("commit-uncertain", "$final");
        }
        throw error;
    }
    return Object.freeze({
        disposition: "published",
        transactionDigest: stored.transactionDigest,
        finalRecord,
        publication,
    });
}
