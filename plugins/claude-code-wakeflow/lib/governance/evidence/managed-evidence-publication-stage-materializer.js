import { types } from "node:util";
import { createFileAtomically, DurableAtomicFileWriteError, } from "../../foundation/filesystem/durable-atomic-file-write.js";
import { recoverDurableAtomicFileStagesMatchingTargets, DurableAtomicFileStageRecoveryError, } from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import { inspectDirectoryTreeCandidate, inspectDirectoryTreeCandidateProgress, DurableDirectoryTreeCandidateError, } from "../../foundation/filesystem/durable-directory-tree-candidate.js";
import { createDirectoryAtomically, DurableDirectoryMaterializationError, } from "../../foundation/filesystem/durable-directory-materialization.js";
import {} from "../../foundation/filesystem/file-node-snapshot.js";
import { joinDirectoryTreeCandidatePath, } from "../../foundation/filesystem/directory-tree-candidate-plan.js";
import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { admitWakeflowResourceOperation, WakeflowResourceProcessingContractError, } from "../../foundation/resource/resource-processing-contract.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { createManagedEvidenceRootResourceDeclaration, } from "./managed-evidence-resource-catalog.js";
import { renderManagedEvidenceManifest, } from "./managed-evidence-manifest.js";
import { materializeManagedEvidencePublicationPayload, ManagedEvidencePublicationPayloadMaterializationError, } from "./managed-evidence-publication-payload-materializer.js";
import { requireCurrentManagedEvidencePublicationTransaction, ManagedEvidencePublicationTransactionStoreError, } from "./managed-evidence-publication-transaction-store.js";
import { deriveManagedEvidencePublicationRecordTreePlan, parseManagedEvidencePublicationTransaction, ManagedEvidencePublicationTransactionError, } from "./managed-evidence-publication-transaction.js";
import { MANAGED_EVIDENCE_MANIFEST_FILE_NAME, MANAGED_EVIDENCE_ROOT_REF, } from "./managed-evidence-resource-paths.js";
import { MANAGED_EVIDENCE_RECORD_DIRECTORY_MODE, MANAGED_EVIDENCE_RECORD_FILE_MODE, } from "./managed-evidence-record-tree-plan.js";
const ERROR_MESSAGES = {
    input: "Managed evidence publication stage materialization input is invalid.",
    journal: "Managed evidence publication journal is absent, changed, or different.",
    "source-root-scope": "Managed evidence publication source escaped its admitted root.",
    "source-changed": "Managed evidence publication source differs from its Manifest.",
    "destination-root-scope": "Managed evidence publication stage escaped its Demand root.",
    "stage-conflict": "Managed evidence publication stage conflicts with its record plan.",
    capacity: "Managed evidence publication stage exceeds its admitted capacity.",
    aborted: "Managed evidence publication stage materialization was aborted.",
    "recovery-required": "Managed evidence publication stage materialization requires explicit recovery.",
    "operation-failure": "Managed evidence publication stage could not be materialized safely.",
};
/** Stage物化无法证明同一journal/source/record plan时的稳定错误。 */
export class ManagedEvidencePublicationStageMaterializationError extends Error {
    name = "ManagedEvidencePublicationStageMaterializationError";
    code = "wakeflow-managed-evidence-publication-stage-materialization";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const MANIFEST_REF = parsePortableResourcePath(MANAGED_EVIDENCE_MANIFEST_FILE_NAME);
function fail(reason, path) {
    throw new ManagedEvidencePublicationStageMaterializationError(reason, path);
}
function assertRoot(value, path) {
    if (typeof value !== "object" ||
        value === null ||
        types.isProxy(value) ||
        !(value instanceof RootedDirectory)) {
        fail("input", path);
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
    return Object.freeze({
        signal: record.signal,
    });
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
    if (error.reason === "root-scope") {
        fail("destination-root-scope", "$demandRoot");
    }
    if (error.reason === "capacity")
        fail("capacity", "$journal");
    fail("journal", "$journal");
}
async function loadExactJournal(demandRoot, transaction, signal, expectedNode) {
    let stored;
    try {
        stored = await requireCurrentManagedEvidencePublicationTransaction(demandRoot, transaction, expectedNode, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (error instanceof ManagedEvidencePublicationTransactionStoreError) {
            mapStoreError(error);
        }
        throw error;
    }
    return stored;
}
function assertPrivateDirectory(node, path) {
    if (node.kind !== "directory" ||
        node.permissionBits !== MANAGED_EVIDENCE_RECORD_DIRECTORY_MODE ||
        (typeof process.geteuid === "function" &&
            node.userId !== BigInt(process.geteuid()))) {
        fail("stage-conflict", path);
    }
}
function admitEvidenceRootMaterialization(transaction) {
    const declaration = createManagedEvidenceRootResourceDeclaration(transaction.manifest.demandId);
    try {
        admitWakeflowResourceOperation(declaration.processing, "materialize-directory");
    }
    catch (error) {
        if (error instanceof WakeflowResourceProcessingContractError) {
            fail("operation-failure", "$catalog");
        }
        throw error;
    }
}
function mapDirectoryError(error, path) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "target-exists")
        return "existing";
    if (error.reason === "root-scope" || error.reason === "parent-changed") {
        fail("destination-root-scope", "$demandRoot");
    }
    if (error.reason === "target-symlink" ||
        error.reason === "target-not-directory" ||
        error.reason === "parent-symlink" ||
        error.reason === "parent-not-directory") {
        fail("stage-conflict", path);
    }
    if (error.reason === "commit-uncertain" ||
        error.reason === "durability-failure" ||
        error.reason === "close-failure") {
        fail("recovery-required", path);
    }
    fail("operation-failure", path);
}
async function ensureEvidenceRoot(demandRoot, transaction, signal) {
    admitEvidenceRootMaterialization(transaction);
    await ensureDirectory(demandRoot, MANAGED_EVIDENCE_ROOT_REF, "$managedEvidenceRoot", signal);
    let observation;
    try {
        observation = await demandRoot.inspectExistingResource(MANAGED_EVIDENCE_ROOT_REF, "$managedEvidenceRoot");
    }
    catch (error) {
        if (error instanceof RootedDirectoryError) {
            fail("destination-root-scope", "$demandRoot");
        }
        throw error;
    }
    assertPrivateDirectory(observation.node, "$managedEvidenceRoot");
}
async function ensureDirectory(demandRoot, ref, path, signal) {
    try {
        await createDirectoryAtomically(demandRoot, ref, {
            mode: MANAGED_EVIDENCE_RECORD_DIRECTORY_MODE,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof DurableDirectoryMaterializationError) {
            if (mapDirectoryError(error, path) === "existing")
                return;
        }
        throw error;
    }
}
function mapCandidateError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "capacity")
        fail("capacity", "$stage");
    if (error.reason === "tree-conflict" ||
        error.reason === "source-changed" ||
        error.reason === "path-conflict" ||
        error.reason === "target-exists" ||
        error.reason === "file-order") {
        fail("stage-conflict", "$stage");
    }
    if (error.reason === "input")
        fail("input", error.path);
    fail("operation-failure", "$stage");
}
async function inspectProgress(demandRoot, plan, signal) {
    try {
        return await inspectDirectoryTreeCandidateProgress(demandRoot, plan.candidateRootPath, plan.directoryPlan, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (error instanceof DurableDirectoryTreeCandidateError) {
            mapCandidateError(error);
        }
        throw error;
    }
}
async function inspectComplete(demandRoot, plan, signal) {
    try {
        return await inspectDirectoryTreeCandidate(demandRoot, plan.candidateRootPath, plan.directoryPlan, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (error instanceof DurableDirectoryTreeCandidateError) {
            mapCandidateError(error);
        }
        throw error;
    }
}
async function recoverManifestAtomicStages(demandRoot, plan, signal) {
    const manifestRef = joinDirectoryTreeCandidatePath(plan.candidateRootPath, MANIFEST_REF);
    try {
        const receipt = await recoverDurableAtomicFileStagesMatchingTargets(demandRoot, Object.freeze([manifestRef]), signal === undefined ? undefined : { signal });
        if (receipt.activeStageCount !== 0 || receipt.unknownStageCount !== 0) {
            fail("recovery-required", "$manifest/stage");
        }
    }
    catch (error) {
        if (error instanceof DurableAtomicFileStageRecoveryError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "root-scope") {
                fail("destination-root-scope", "$demandRoot");
            }
            fail("recovery-required", "$manifest/stage");
        }
        throw error;
    }
}
function assertManifestIsLast(progress) {
    const manifestMissing = progress.missingFiles.includes(MANIFEST_REF);
    if (progress.status === "incomplete" && !manifestMissing) {
        fail("stage-conflict", "$stage/manifest");
    }
}
function mapPayloadError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "capacity")
        fail("capacity", "$source");
    if (error.reason === "source-root-scope") {
        fail("source-root-scope", "$sourceRoot");
    }
    if (error.reason === "source-changed") {
        fail("source-changed", "$source");
    }
    if (error.reason === "destination-root-scope") {
        fail("destination-root-scope", "$demandRoot");
    }
    if (error.reason === "stage-conflict") {
        fail("stage-conflict", "$stage");
    }
    if (error.reason === "recovery-required") {
        fail("recovery-required", "$stage");
    }
    if (error.reason === "input")
        fail("input", "$payload");
    fail("operation-failure", "$payload");
}
function onlyManifestMissing(progress) {
    return progress.status === "incomplete" &&
        progress.missingDirectories.length === 0 &&
        progress.missingFiles.length === 1 &&
        progress.missingFiles[0] === MANIFEST_REF;
}
function assertOnlyManifestMissing(progress) {
    if (!onlyManifestMissing(progress))
        fail("stage-conflict", "$stage");
}
function mapManifestWriteError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "capacity")
        fail("capacity", "$manifest");
    if (error.reason === "root-scope") {
        fail("destination-root-scope", "$demandRoot");
    }
    if (error.reason === "commit-uncertain" ||
        error.reason === "durability-failure" ||
        error.reason === "stage-cleanup-failure" ||
        error.reason === "stage-recovery-required" ||
        error.reason === "close-failure") {
        fail("recovery-required", "$manifest");
    }
    fail("operation-failure", "$manifest");
}
async function publishManifest(demandRoot, transaction, plan, signal) {
    const manifestRef = joinDirectoryTreeCandidatePath(plan.candidateRootPath, MANIFEST_REF);
    const bytes = encodeUtf8(renderManagedEvidenceManifest(transaction.manifest), "$manifest");
    try {
        await createFileAtomically(demandRoot, manifestRef, bytes, {
            mode: MANAGED_EVIDENCE_RECORD_FILE_MODE,
            ...(signal === undefined ? {} : { signal }),
        });
        return "created";
    }
    catch (error) {
        if (error instanceof DurableAtomicFileWriteError &&
            error.reason === "target-exists") {
            // 同一journal并发winner可能已经发布Manifest；完整stage复验决定能否接纳。
            await inspectComplete(demandRoot, plan, undefined);
            return "existing";
        }
        if (error instanceof DurableAtomicFileWriteError) {
            mapManifestWriteError(error);
        }
        throw error;
    }
}
/** 从exact journal指定的source物化或重用一棵完整耐久stage。 */
export async function materializeManagedEvidencePublicationStage(sourceRootValue, demandRootValue, transactionValue, optionsValue = {}) {
    if (sourceRootValue !== null)
        assertRoot(sourceRootValue, "$sourceRoot");
    assertRoot(demandRootValue, "$demandRoot");
    const options = parseOptions(optionsValue);
    assertNotAborted(options.signal);
    const transaction = parseTransaction(transactionValue);
    const stored = await loadExactJournal(demandRootValue, transaction, options.signal);
    const plan = deriveManagedEvidencePublicationRecordTreePlan(transaction);
    await ensureEvidenceRoot(demandRootValue, transaction, options.signal);
    await ensureDirectory(demandRootValue, plan.candidateRootPath, "$stage", options.signal);
    await recoverManifestAtomicStages(demandRootValue, plan, options.signal);
    let progress = await inspectProgress(demandRootValue, plan, options.signal);
    if (progress.status === "complete") {
        await loadExactJournal(demandRootValue, transaction, options.signal, stored.source.node);
        return Object.freeze({
            transactionDigest: stored.transactionDigest,
            candidate: await inspectComplete(demandRootValue, plan, options.signal),
            copiedPayloadFiles: Object.freeze([]),
            manifestPublication: "existing",
        });
    }
    assertManifestIsLast(progress);
    let copiedPayloadFiles = Object.freeze([]);
    if (!onlyManifestMissing(progress)) {
        try {
            copiedPayloadFiles = await materializeManagedEvidencePublicationPayload(sourceRootValue, demandRootValue, transaction, plan, progress, options.signal === undefined ? undefined : { signal: options.signal });
        }
        catch (error) {
            if (error instanceof ManagedEvidencePublicationPayloadMaterializationError) {
                mapPayloadError(error);
            }
            throw error;
        }
        progress = await inspectProgress(demandRootValue, plan, options.signal);
    }
    assertOnlyManifestMissing(progress);
    await loadExactJournal(demandRootValue, transaction, options.signal, stored.source.node);
    const manifestPublication = await publishManifest(demandRootValue, transaction, plan, options.signal);
    // Manifest提交后忽略取消，必须完成stage与journal readback或报告恢复需求。
    let candidate;
    try {
        candidate = await inspectComplete(demandRootValue, plan, undefined);
        await loadExactJournal(demandRootValue, transaction, undefined, stored.source.node);
    }
    catch (error) {
        if (error instanceof ManagedEvidencePublicationStageMaterializationError) {
            fail("recovery-required", "$stage");
        }
        throw error;
    }
    return Object.freeze({
        transactionDigest: stored.transactionDigest,
        candidate,
        copiedPayloadFiles,
        manifestPublication,
    });
}
