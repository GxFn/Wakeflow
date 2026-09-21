import { types } from "node:util";
import { materializeLoadedArtifactTreeTransferCandidate, LoadedArtifactTreeTransferCandidateError, } from "../../foundation/artifact/loaded-artifact-tree-transfer-candidate.js";
import { planLoadedArtifactTreeTransfer, LoadedArtifactTreeTransferPlanError, } from "../../foundation/artifact/loaded-artifact-tree-transfer-plan.js";
import { createDirectoryAtomically, DurableDirectoryMaterializationError, } from "../../foundation/filesystem/durable-directory-materialization.js";
import { copyFileToCandidateDurably, DurableFileCopyCandidateError, } from "../../foundation/filesystem/durable-file-copy-candidate.js";
import { sameFileNodeIdentity } from "../../foundation/filesystem/file-node-snapshot.js";
import { joinDirectoryTreeCandidatePath, } from "../../foundation/filesystem/directory-tree-candidate-plan.js";
import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { parseManagedEvidencePublicationTransaction, ManagedEvidencePublicationTransactionError, } from "./managed-evidence-publication-transaction.js";
import { createFileAtomically, DurableAtomicFileWriteError, } from "../../foundation/filesystem/durable-atomic-file-write.js";
import { MANAGED_EVIDENCE_PAYLOAD_DIRECTORY_NAME, } from "./managed-evidence-resource-paths.js";
import { encodeManagedEvidenceSourceProjection } from "./managed-evidence-source-projection.js";
import { MANAGED_EVIDENCE_RECORD_DIRECTORY_MODE, MANAGED_EVIDENCE_RECORD_EXECUTABLE_FILE_MODE, MANAGED_EVIDENCE_RECORD_FILE_MODE, parseManagedEvidenceRecordTreePlan, ManagedEvidenceRecordTreePlanError, } from "./managed-evidence-record-tree-plan.js";
const ERROR_MESSAGES = {
    input: "Managed evidence publication payload materialization input is invalid.",
    "source-root-scope": "Managed evidence publication payload escaped its admitted source root.",
    "source-changed": "Managed evidence publication payload source differs from its Manifest.",
    "destination-root-scope": "Managed evidence publication payload escaped its Demand root.",
    "stage-conflict": "Managed evidence publication payload conflicts with its stage plan.",
    capacity: "Managed evidence publication payload exceeds its admitted capacity.",
    aborted: "Managed evidence publication payload materialization was aborted.",
    "recovery-required": "Managed evidence publication payload materialization requires explicit recovery.",
    "operation-failure": "Managed evidence publication payload could not be materialized safely.",
};
export class ManagedEvidencePublicationPayloadMaterializationError extends Error {
    name = "ManagedEvidencePublicationPayloadMaterializationError";
    code = "wakeflow-managed-evidence-publication-payload-materialization";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const PAYLOAD_REF = parsePortableResourcePath(MANAGED_EVIDENCE_PAYLOAD_DIRECTORY_NAME);
const CONTENT_REF = parsePortableResourcePath("content");
const PAYLOAD_CONTENT_REF = parsePortableResourcePath(`${MANAGED_EVIDENCE_PAYLOAD_DIRECTORY_NAME}/content`);
function fail(reason, path) {
    throw new ManagedEvidencePublicationPayloadMaterializationError(reason, path);
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
    return Object.freeze({ signal: record.signal });
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
function parseRecordPlan(value) {
    try {
        return parseManagedEvidenceRecordTreePlan(value);
    }
    catch (error) {
        if (error instanceof ManagedEvidenceRecordTreePlanError) {
            fail(error.reason === "capacity" ? "capacity" : "input", "$plan");
        }
        throw error;
    }
}
function assertPlanRelation(transaction, plan) {
    if (transaction.manifest.evidenceId !== plan.evidenceId ||
        transaction.recordTreePlanDigest !== plan.planDigest ||
        transaction.manifest.manifestDigest !== plan.manifest.manifestDigest) {
        fail("input", "$plan");
    }
}
function assertProgressRelation(progress, plan) {
    if (typeof progress !== "object" ||
        progress === null ||
        types.isProxy(progress) ||
        !Object.isFrozen(progress) ||
        progress.candidateRootPath !== plan.candidateRootPath ||
        progress.plan.treeDigest !== plan.directoryPlan.treeDigest ||
        (progress.status !== "complete" && progress.status !== "incomplete")) {
        fail("input", "$progress");
    }
    const directories = new Set(plan.directoryPlan.directories);
    const files = new Set(plan.directoryPlan.files.map((file) => file.path));
    if (progress.missingDirectories.some((entry) => !directories.has(entry)) ||
        progress.missingFiles.some((entry) => !files.has(entry)) ||
        (progress.status === "complete" &&
            (progress.missingDirectories.length !== 0 ||
                progress.missingFiles.length !== 0)) ||
        (progress.status === "incomplete" &&
            progress.missingDirectories.length === 0 &&
            progress.missingFiles.length === 0)) {
        fail("input", "$progress");
    }
}
function mapDirectoryError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "target-exists")
        fail("stage-conflict", "$payload");
    if (error.reason === "root-scope" || error.reason === "parent-changed") {
        fail("destination-root-scope", "$demandRoot");
    }
    if (error.reason === "target-symlink" ||
        error.reason === "target-not-directory" ||
        error.reason === "parent-symlink" ||
        error.reason === "parent-not-directory") {
        fail("stage-conflict", "$payload");
    }
    if (error.reason === "commit-uncertain" ||
        error.reason === "durability-failure" ||
        error.reason === "close-failure") {
        fail("recovery-required", "$payload");
    }
    fail("operation-failure", "$payload");
}
async function ensurePayloadRoot(demandRoot, plan, progress, signal) {
    const payloadRoot = joinDirectoryTreeCandidatePath(plan.candidateRootPath, PAYLOAD_REF);
    if (!progress.missingDirectories.includes(PAYLOAD_REF))
        return payloadRoot;
    try {
        await createDirectoryAtomically(demandRoot, payloadRoot, {
            mode: MANAGED_EVIDENCE_RECORD_DIRECTORY_MODE,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof DurableDirectoryMaterializationError) {
            mapDirectoryError(error);
        }
        throw error;
    }
    return payloadRoot;
}
function mapCopyError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "capacity")
        fail("capacity", "$source");
    if (error.reason === "source-root-scope") {
        fail("source-root-scope", "$sourceRoot");
    }
    if (error.reason === "source-not-found" ||
        error.reason === "source-symlink" ||
        error.reason === "source-not-file" ||
        error.reason === "source-changed" ||
        error.reason === "source-mismatch") {
        fail("source-changed", "$source");
    }
    if (error.reason === "destination-root-scope") {
        fail("destination-root-scope", "$demandRoot");
    }
    if (error.reason === "destination-parent" ||
        error.reason === "target-exists" ||
        error.reason === "candidate-changed" ||
        error.reason === "cleanup-failure") {
        fail("stage-conflict", "$payload");
    }
    fail("operation-failure", "$payload");
}
async function materializeFilePayload(sourceRoot, demandRoot, transaction, plan, progress, signal) {
    const payloadRoot = await ensurePayloadRoot(demandRoot, plan, progress, signal);
    const manifestFile = transaction.manifest.payload.treeManifest.files[0];
    if (manifestFile === undefined ||
        manifestFile.ref !== CONTENT_REF ||
        transaction.manifest.payload.treeManifest.files.length !== 1) {
        fail("input", "$transaction/manifest/payload");
    }
    if (!progress.missingFiles.includes(PAYLOAD_CONTENT_REF)) {
        return Object.freeze([]);
    }
    const source = transaction.manifest.source;
    if (source.kind !== "managed-path")
        fail("input", "$transaction/manifest/source");
    try {
        await copyFileToCandidateDurably(sourceRoot, demandRoot, source.path, joinDirectoryTreeCandidatePath(payloadRoot, CONTENT_REF), {
            byteCount: manifestFile.bytes,
            digest: manifestFile.digest,
        }, {
            maximumBytes: manifestFile.bytes,
            mode: manifestFile.executable
                ? MANAGED_EVIDENCE_RECORD_EXECUTABLE_FILE_MODE
                : MANAGED_EVIDENCE_RECORD_FILE_MODE,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof DurableFileCopyCandidateError)
            mapCopyError(error);
        throw error;
    }
    return Object.freeze([manifestFile.ref]);
}
function mapProjectionWriteError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "capacity")
        fail("capacity", "$payload");
    if (error.reason === "root-scope")
        fail("destination-root-scope", "$demandRoot");
    if (error.reason === "target-exists")
        fail("stage-conflict", "$payload");
    if (error.reason === "commit-uncertain" ||
        error.reason === "durability-failure" ||
        error.reason === "stage-cleanup-failure" ||
        error.reason === "stage-recovery-required" ||
        error.reason === "close-failure") {
        fail("recovery-required", "$payload");
    }
    fail("operation-failure", "$payload");
}
/** 引用类来源：从 Manifest 来源重建投影字节，核对清单里的 content 身份后原子写入。 */
async function materializeProjectionPayload(demandRoot, transaction, plan, progress, signal) {
    const source = transaction.manifest.source;
    if (source.kind === "managed-path")
        fail("input", "$transaction/manifest/source");
    const payloadRoot = await ensurePayloadRoot(demandRoot, plan, progress, signal);
    const manifestFile = transaction.manifest.payload.treeManifest.files[0];
    if (manifestFile === undefined ||
        manifestFile.ref !== CONTENT_REF ||
        transaction.manifest.payload.treeManifest.files.length !== 1) {
        fail("input", "$transaction/manifest/payload");
    }
    if (!progress.missingFiles.includes(PAYLOAD_CONTENT_REF)) {
        return Object.freeze([]);
    }
    const projection = encodeManagedEvidenceSourceProjection(source);
    if (projection.byteCount !== manifestFile.bytes || projection.digest !== manifestFile.digest) {
        fail("source-changed", "$source");
    }
    try {
        await createFileAtomically(demandRoot, joinDirectoryTreeCandidatePath(payloadRoot, CONTENT_REF), projection.bytes, {
            mode: MANAGED_EVIDENCE_RECORD_FILE_MODE,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof DurableAtomicFileWriteError)
            mapProjectionWriteError(error);
        throw error;
    }
    return Object.freeze([manifestFile.ref]);
}
async function openTreeSource(sourceRoot, transaction) {
    let observation;
    try {
        const source = transaction.manifest.source;
        if (source.kind !== "managed-path")
            fail("input", "$transaction/manifest/source");
        observation = await sourceRoot.inspectExistingResource(source.path, "$source");
    }
    catch (error) {
        if (error instanceof RootedDirectoryError) {
            if (error.reason === "resource-not-found" ||
                error.reason === "ancestor-symlink" ||
                error.reason === "ancestor-type") {
                fail("source-changed", "$source");
            }
            fail("source-root-scope", "$sourceRoot");
        }
        throw error;
    }
    if (observation.node.kind !== "directory") {
        fail("source-changed", "$source");
    }
    let treeRoot;
    try {
        treeRoot = await RootedDirectory.open(observation.physicalPath, "$source");
        const current = await treeRoot.assertCurrent("$source");
        if (!sameFileNodeIdentity(current, observation.node)) {
            fail("source-changed", "$source");
        }
        return treeRoot;
    }
    catch (error) {
        if (treeRoot !== undefined) {
            try {
                await treeRoot.close();
            }
            catch {
                // 首个来源身份错误优先。
            }
        }
        if (error instanceof ManagedEvidencePublicationPayloadMaterializationError) {
            throw error;
        }
        if (error instanceof RootedDirectoryError) {
            fail("source-root-scope", "$sourceRoot");
        }
        throw error;
    }
}
function mapTransferError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "capacity")
        fail("capacity", "$source");
    if (error.reason === "source-root-scope") {
        fail("source-root-scope", "$sourceRoot");
    }
    if (error.reason === "source-changed")
        fail("source-changed", "$source");
    if (error.reason === "destination-root-scope") {
        fail("destination-root-scope", "$demandRoot");
    }
    if (error.reason === "candidate-conflict") {
        fail("stage-conflict", "$payload");
    }
    fail("operation-failure", "$payload");
}
async function materializeTreePayload(sourceRoot, demandRoot, transaction, plan, signal) {
    const treeRoot = await openTreeSource(sourceRoot, transaction);
    let copied;
    let failure;
    try {
        let transferPlan;
        try {
            transferPlan = planLoadedArtifactTreeTransfer(transaction.manifest.payload.treeManifest, joinDirectoryTreeCandidatePath(plan.candidateRootPath, PAYLOAD_REF), {
                directoryMode: MANAGED_EVIDENCE_RECORD_DIRECTORY_MODE,
                executableFileMode: MANAGED_EVIDENCE_RECORD_EXECUTABLE_FILE_MODE,
                regularFileMode: MANAGED_EVIDENCE_RECORD_FILE_MODE,
            });
        }
        catch (error) {
            if (error instanceof LoadedArtifactTreeTransferPlanError) {
                fail(error.reason === "capacity" ? "capacity" : "input", "$plan");
            }
            throw error;
        }
        try {
            copied = (await materializeLoadedArtifactTreeTransferCandidate(treeRoot, demandRoot, transferPlan, signal === undefined ? undefined : { signal })).copiedFiles;
        }
        catch (error) {
            if (error instanceof LoadedArtifactTreeTransferCandidateError) {
                mapTransferError(error);
            }
            throw error;
        }
    }
    catch (error) {
        failure = error;
    }
    try {
        await treeRoot.close();
    }
    catch (error) {
        if (failure === undefined)
            failure = error;
    }
    if (failure !== undefined) {
        if (failure instanceof RootedDirectoryError) {
            fail("source-root-scope", "$sourceRoot");
        }
        throw failure;
    }
    if (copied === undefined)
        fail("operation-failure", "$payload");
    return copied;
}
/** 按Manifest资源类型稳定物化stage payload，不创建或解释Manifest marker。 */
export async function materializeManagedEvidencePublicationPayload(sourceRootValue, demandRootValue, transactionValue, planValue, progress, optionsValue = {}) {
    assertRoot(demandRootValue, "$demandRoot");
    const options = parseOptions(optionsValue);
    if (options.signal?.aborted === true)
        fail("aborted", "$signal");
    const transaction = parseTransaction(transactionValue);
    const plan = parseRecordPlan(planValue);
    assertPlanRelation(transaction, plan);
    assertProgressRelation(progress, plan);
    const source = transaction.manifest.source;
    if (source.kind !== "managed-path") {
        if (sourceRootValue !== null)
            fail("input", "$sourceRoot");
        return materializeProjectionPayload(demandRootValue, transaction, plan, progress, options.signal);
    }
    assertRoot(sourceRootValue, "$sourceRoot");
    return source.resourceType === "file"
        ? materializeFilePayload(sourceRootValue, demandRootValue, transaction, plan, progress, options.signal)
        : materializeTreePayload(sourceRootValue, demandRootValue, transaction, plan, options.signal);
}
