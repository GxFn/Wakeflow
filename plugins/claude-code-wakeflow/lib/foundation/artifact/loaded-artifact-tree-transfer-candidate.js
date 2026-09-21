import { types } from "node:util";
import { parsePlainRecord, PassiveOwnDataError, } from "../data/passive-own-data.js";
import { copyFileToCandidateDurably, DurableFileCopyCandidateError, } from "../filesystem/durable-file-copy-candidate.js";
import { createDirectoryAtomically, DurableDirectoryMaterializationError, } from "../filesystem/durable-directory-materialization.js";
import { inspectDirectoryTreeCandidate, inspectDirectoryTreeCandidateProgress, DurableDirectoryTreeCandidateError, } from "../filesystem/durable-directory-tree-candidate.js";
import { joinDirectoryTreeCandidatePath, } from "../filesystem/directory-tree-candidate-plan.js";
import { RootedDirectory } from "../filesystem/rooted-directory.js";
import { inspectLoadedArtifactTree, LoadedArtifactTreeIdentityError, } from "./loaded-artifact-tree-identity.js";
import { parseLoadedArtifactTreeTransferPlan, LoadedArtifactTreeTransferPlanError, } from "./loaded-artifact-tree-transfer-plan.js";
const ERROR_MESSAGES = {
    input: "Loaded artifact tree transfer candidate input is invalid.",
    capacity: "Loaded artifact tree transfer exceeds its admitted capacity.",
    "source-root-scope": "Loaded artifact tree transfer lost its source root scope.",
    "source-changed": "Loaded artifact tree source differs from its transfer plan.",
    "destination-root-scope": "Loaded artifact tree transfer lost its destination root scope.",
    "candidate-conflict": "Loaded artifact tree candidate conflicts with its closed plan.",
    "copy-failure": "Loaded artifact tree file could not be copied safely.",
    "operation-failure": "Loaded artifact tree candidate could not be materialized safely.",
    aborted: "Loaded artifact tree transfer candidate was aborted.",
};
/** Loaded Artifact Tree candidate 物化失败的稳定、脱敏错误。 */
export class LoadedArtifactTreeTransferCandidateError extends Error {
    name = "LoadedArtifactTreeTransferCandidateError";
    code = "wakeflow-loaded-artifact-tree-transfer-candidate";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new LoadedArtifactTreeTransferCandidateError(reason, path);
}
function assertRoot(value, path) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        fail("input", path);
    }
}
function isAbortSignal(value) {
    return typeof value === "object"
        && value !== null
        && !types.isProxy(value)
        && value instanceof AbortSignal;
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
    if (Object.keys(record).some((key) => key !== "signal")
        || (record.signal !== undefined && !isAbortSignal(record.signal))) {
        fail("input", "$options");
    }
    return Object.freeze({ signal: record.signal });
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$signal");
}
function parsePlan(value) {
    try {
        return parseLoadedArtifactTreeTransferPlan(value);
    }
    catch (error) {
        if (error instanceof LoadedArtifactTreeTransferPlanError) {
            if (error.reason === "capacity")
                fail("capacity", "$plan");
            fail("input", "$plan");
        }
        throw error;
    }
}
function mapSourceError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "root-scope")
        fail("source-root-scope", "$sourceRoot");
    if (error.reason === "entry-limit"
        || error.reason === "depth-limit"
        || error.reason === "file-count"
        || error.reason === "file-bytes"
        || error.reason === "total-bytes"
        || error.reason === "ref-bytes") {
        fail("capacity", "$source");
    }
    if (error.reason === "input")
        fail("input", error.path);
    fail("source-changed", "$source");
}
async function inspectSource(root, plan, signal) {
    let identity;
    try {
        identity = await inspectLoadedArtifactTree(root, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (error instanceof LoadedArtifactTreeIdentityError)
            mapSourceError(error);
        throw error;
    }
    if (identity.artifactDigest !== plan.artifactDigest) {
        fail("source-changed", "$source");
    }
    return identity;
}
function mapDirectoryError(error, allowExistingRoot) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (allowExistingRoot && error.reason === "target-exists")
        return "existing";
    if (error.reason === "root-scope" || error.reason === "parent-changed") {
        fail("destination-root-scope", "$destinationRoot");
    }
    if (error.reason === "target-symlink"
        || error.reason === "target-not-directory"
        || error.reason === "parent-symlink"
        || error.reason === "parent-not-directory"
        || error.reason === "target-exists") {
        fail("candidate-conflict", "$candidate");
    }
    fail("operation-failure", "$candidate");
}
async function ensureCandidateRoot(root, plan, signal) {
    try {
        await createDirectoryAtomically(root, plan.candidateRootPath, {
            mode: plan.directoryPlan.directoryMode,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof DurableDirectoryMaterializationError) {
            if (mapDirectoryError(error, true) === "existing")
                return;
        }
        throw error;
    }
}
function mapCandidateInspectionError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "input")
        fail("input", error.path);
    if (error.reason === "capacity")
        fail("capacity", "$candidate");
    if (error.reason === "tree-conflict"
        || error.reason === "source-changed") {
        fail("candidate-conflict", "$candidate");
    }
    fail("operation-failure", "$candidate");
}
async function inspectProgress(root, plan, signal) {
    try {
        return await inspectDirectoryTreeCandidateProgress(root, plan.candidateRootPath, plan.directoryPlan, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (error instanceof DurableDirectoryTreeCandidateError) {
            mapCandidateInspectionError(error);
        }
        throw error;
    }
}
async function materializeMissingDirectories(root, plan, missingDirectories, signal) {
    for (const directory of missingDirectories) {
        assertNotAborted(signal);
        try {
            await createDirectoryAtomically(root, joinDirectoryTreeCandidatePath(plan.candidateRootPath, directory), {
                mode: plan.directoryPlan.directoryMode,
                ...(signal === undefined ? {} : { signal }),
            });
        }
        catch (error) {
            if (error instanceof DurableDirectoryMaterializationError) {
                mapDirectoryError(error, false);
            }
            throw error;
        }
    }
}
function mapCopyError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "input")
        fail("input", error.path);
    if (error.reason === "capacity")
        fail("capacity", "$source");
    if (error.reason === "source-root-scope") {
        fail("source-root-scope", "$sourceRoot");
    }
    if (error.reason === "source-not-found"
        || error.reason === "source-symlink"
        || error.reason === "source-not-file"
        || error.reason === "source-changed"
        || error.reason === "source-mismatch") {
        fail("source-changed", "$source");
    }
    if (error.reason === "destination-root-scope") {
        fail("destination-root-scope", "$destinationRoot");
    }
    if (error.reason === "destination-parent"
        || error.reason === "target-exists"
        || error.reason === "candidate-changed"
        || error.reason === "cleanup-failure") {
        fail("candidate-conflict", "$candidate");
    }
    fail("copy-failure", "$candidate");
}
async function copyMissingFiles(sourceRoot, destinationRoot, plan, missingFiles, signal) {
    const missing = new Set(missingFiles);
    const copied = [];
    for (const [index, plannedFile] of plan.directoryPlan.files.entries()) {
        if (!missing.has(plannedFile.path))
            continue;
        const copy = plan.copies[index];
        if (copy === undefined
            || copy.sourceResourcePath !== plannedFile.path) {
            fail("input", "$plan");
        }
        try {
            await copyFileToCandidateDurably(sourceRoot, destinationRoot, copy.sourceResourcePath, copy.candidateResourcePath, {
                byteCount: plannedFile.byteCount,
                digest: plannedFile.digest,
            }, {
                maximumBytes: plannedFile.byteCount,
                mode: plannedFile.mode,
                ...(signal === undefined ? {} : { signal }),
            });
        }
        catch (error) {
            if (error instanceof DurableFileCopyCandidateError)
                mapCopyError(error);
            throw error;
        }
        copied.push(plannedFile.path);
    }
    return Object.freeze(copied);
}
async function inspectCompleteCandidate(root, plan, signal) {
    try {
        return await inspectDirectoryTreeCandidate(root, plan.candidateRootPath, plan.directoryPlan, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (error instanceof DurableDirectoryTreeCandidateError) {
            mapCandidateInspectionError(error);
        }
        throw error;
    }
}
/** 创建或精确补齐一棵 Loaded Artifact Tree candidate，并证明来源和候选均闭合。 */
export async function materializeLoadedArtifactTreeTransferCandidate(sourceRootValue, destinationRootValue, planValue, optionsValue) {
    assertRoot(sourceRootValue, "$sourceRoot");
    assertRoot(destinationRootValue, "$destinationRoot");
    const options = parseOptions(optionsValue);
    assertNotAborted(options.signal);
    const plan = parsePlan(planValue);
    await inspectSource(sourceRootValue, plan, options.signal);
    await ensureCandidateRoot(destinationRootValue, plan, options.signal);
    let progress = await inspectProgress(destinationRootValue, plan, options.signal);
    await materializeMissingDirectories(destinationRootValue, plan, progress.missingDirectories, options.signal);
    progress = await inspectProgress(destinationRootValue, plan, options.signal);
    const copiedFiles = await copyMissingFiles(sourceRootValue, destinationRootValue, plan, progress.missingFiles, options.signal);
    const candidate = await inspectCompleteCandidate(destinationRootValue, plan, options.signal);
    const sourceIdentity = await inspectSource(sourceRootValue, plan, options.signal);
    assertNotAborted(options.signal);
    return Object.freeze({
        plan,
        sourceIdentity,
        candidate,
        copiedFiles,
    });
}
