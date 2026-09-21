import { types } from "node:util";
import { sameFileNodeSnapshot, } from "../../../foundation/filesystem/file-node-snapshot.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../../../foundation/data/passive-own-data.js";
import { RootedDirectory } from "../../../foundation/filesystem/rooted-directory.js";
import { readStableResourceDirectory, readStableRootDirectory, StableDirectoryReadError, } from "../../../foundation/filesystem/stable-directory-read.js";
import { DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF, DEMAND_EVENT_SOURCING_ARTIFACTS_ROOT_REF, DEMAND_EVENT_SOURCING_ROOT_REF, DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF, DEMAND_EVENT_STREAM_INDEX_ROOT_REF, DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF, DEMAND_EVENT_STREAM_COMMITS_ROOT_REF, parseDemandEventStreamCommitFileName, DemandEventSourcingPathError, } from "./demand-event-sourcing-paths.js";
import { DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE, DEMAND_FILE_EVENT_STORE_FILE_MODE, DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS, } from "./demand-file-event-store.js";
import { parseTaskPackageProjectionFileName, TaskPackageProjectionPathError, TASK_PACKAGE_PROJECTIONS_ROOT_REF, } from "../../tasking/task-package-projection-paths.js";
import { inspectManagedEvidenceRecordSetInventory, ManagedEvidenceRecordSetInventoryError, } from "../../evidence/managed-evidence-record-set-inventory.js";
import { MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_FILE_NAME, } from "../../evidence/managed-evidence-resource-paths.js";
const ERROR_MESSAGES = {
    input: "Demand Event Sourcing root inventory input is invalid.",
    "root-scope": "Demand Event Sourcing root changed during inventory.",
    "tree-shape": "Demand Event Sourcing root contains a missing or unknown resource.",
    "node-policy": "Demand Event Sourcing root resource violates private node policy.",
    capacity: "Demand Event Sourcing root inventory exceeds its capacity.",
    "source-changed": "Demand Event Sourcing root inventory changed during observation.",
    aborted: "Demand Event Sourcing root inventory was aborted.",
    "operation-failure": "Demand Event Sourcing root inventory failed.",
};
export class DemandEventSourcingRootInventoryError extends Error {
    name = "DemandEventSourcingRootInventoryError";
    code = "wakeflow-demand-event-sourcing-root-inventory";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const ROOT_NAMES = Object.freeze([
    "artifacts",
    "authority.json",
    "event-sourcing",
    "identity.json",
    "transactions",
]);
const EVENT_SOURCING_NAMES = Object.freeze([
    "append-candidates",
    "commits",
    "index",
    "snapshots",
]);
const ARTIFACT_NAMES = new Set([
    "managed-evidence",
    "task-packages",
]);
function fail(reason, path) {
    throw new DemandEventSourcingRootInventoryError(reason, path);
}
function exactNames(read, names, path) {
    if (read.entries.length !== names.length ||
        read.entries.some((entry, index) => entry.name !== names[index])) {
        fail("tree-shape", path);
    }
}
function assertArtifactNames(read) {
    if (!read.entries.some((entry) => entry.name === "task-packages") ||
        read.entries.some((entry) => !ARTIFACT_NAMES.has(entry.name))) {
        fail("tree-shape", "$artifacts");
    }
}
function assertDirectory(node, path) {
    if (node.kind !== "directory" ||
        node.permissionBits !== DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE ||
        (typeof process.geteuid === "function" &&
            node.userId !== BigInt(process.geteuid()))) {
        fail("node-policy", path);
    }
}
function assertFile(node, path) {
    if (node.kind !== "file" ||
        node.permissionBits !== DEMAND_FILE_EVENT_STORE_FILE_MODE ||
        node.linkCount !== 1n ||
        (typeof process.geteuid === "function" &&
            node.userId !== BigInt(process.geteuid()))) {
        fail("node-policy", path);
    }
}
function mapReadError(error, path) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "too-many-entries")
        fail("capacity", path);
    if (error.reason === "source-changed")
        fail("source-changed", path);
    if (error.reason === "root-scope")
        fail("root-scope", "$root");
    if (error.reason === "not-found" ||
        error.reason === "symlink" ||
        error.reason === "not-directory") {
        fail("tree-shape", path);
    }
    fail("operation-failure", path);
}
function mapManagedEvidenceError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "root-scope")
        fail("root-scope", "$root");
    if (error.reason === "capacity")
        fail("capacity", "$managed-evidence");
    if (error.reason === "source-changed") {
        fail("source-changed", "$managed-evidence");
    }
    if (error.reason === "node-policy") {
        fail("node-policy", "$managed-evidence");
    }
    if (error.reason === "tree-shape" ||
        error.reason === "transaction" ||
        error.reason === "record") {
        fail("tree-shape", "$managed-evidence");
    }
    fail("operation-failure", "$managed-evidence");
}
async function readResource(root, ref, maximumEntries, signal, expectedNode) {
    try {
        return await readStableResourceDirectory(root, ref, {
            maximumEntries,
            ...(expectedNode === undefined ? {} : { expectedNode }),
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof StableDirectoryReadError)
            mapReadError(error, `$${ref}`);
        throw error;
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
    if (Object.keys(record).some((key) => key !== "phase" && key !== "signal") ||
        (record.signal !== undefined &&
            (typeof record.signal !== "object" ||
                record.signal === null ||
                types.isProxy(record.signal) ||
                !(record.signal instanceof AbortSignal))) ||
        (record.phase !== undefined &&
            record.phase !== "healthy" &&
            record.phase !== "demand-publication" &&
            record.phase !== "managed-evidence-publication")) {
        fail("input", "$options");
    }
    return Object.freeze({
        phase: record.phase === "demand-publication" ||
            record.phase === "managed-evidence-publication"
            ? record.phase
            : "healthy",
        signal: record.signal,
    });
}
function assertEmpty(read, path) {
    assertDirectory(read.directoryNode, path);
    if (read.entries.length !== 0)
        fail("tree-shape", path);
}
function requiredEntryNode(read, name, path) {
    const entry = read.entries.find((candidate) => candidate.name === name);
    if (entry === undefined)
        fail("tree-shape", path);
    return entry.node;
}
function optionalEntryNode(read, name) {
    return read.entries.find((candidate) => candidate.name === name)?.node;
}
/** 稳定证明一个 normal-load Demand root 的完整允许集合。 */
export async function inspectDemandEventSourcingRootInventory(root, options) {
    if (typeof root !== "object" ||
        root === null ||
        types.isProxy(root) ||
        !(root instanceof RootedDirectory)) {
        fail("input", "$root");
    }
    const { phase, signal } = parseOptions(options);
    let before;
    try {
        before = await readStableRootDirectory(root, {
            maximumEntries: 64,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof StableDirectoryReadError)
            mapReadError(error, "$root");
        throw error;
    }
    assertDirectory(before.directoryNode, "$root");
    exactNames(before, ROOT_NAMES, "$root");
    for (const [index, entry] of before.entries.entries()) {
        if (entry.name === "identity.json" || entry.name === "authority.json") {
            assertFile(entry.node, `$root/${index}`);
        }
        else {
            assertDirectory(entry.node, `$root/${index}`);
        }
    }
    const eventSourcing = await readResource(root, DEMAND_EVENT_SOURCING_ROOT_REF, 64, signal, requiredEntryNode(before, "event-sourcing", "$event-sourcing"));
    assertDirectory(eventSourcing.directoryNode, "$event-sourcing");
    exactNames(eventSourcing, EVENT_SOURCING_NAMES, "$event-sourcing");
    eventSourcing.entries.forEach((entry, index) => {
        assertDirectory(entry.node, `$event-sourcing/${index}`);
    });
    const candidates = await readResource(root, DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF, 1, signal, requiredEntryNode(eventSourcing, "append-candidates", "$append-candidates"));
    const commits = await readResource(root, DEMAND_EVENT_STREAM_COMMITS_ROOT_REF, DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS, signal, requiredEntryNode(eventSourcing, "commits", "$commits"));
    const snapshots = await readResource(root, DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF, DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS, signal, requiredEntryNode(eventSourcing, "snapshots", "$snapshots"));
    const indexes = await readResource(root, DEMAND_EVENT_STREAM_INDEX_ROOT_REF, DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS, signal, requiredEntryNode(eventSourcing, "index", "$index"));
    const artifacts = await readResource(root, DEMAND_EVENT_SOURCING_ARTIFACTS_ROOT_REF, ARTIFACT_NAMES.size + 1, signal, requiredEntryNode(before, "artifacts", "$artifacts"));
    assertDirectory(artifacts.directoryNode, "$artifacts");
    assertArtifactNames(artifacts);
    const taskPackagesNode = requiredEntryNode(artifacts, "task-packages", "$task-packages");
    assertDirectory(taskPackagesNode, "$task-packages");
    const taskPackages = await readResource(root, TASK_PACKAGE_PROJECTIONS_ROOT_REF, DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS, signal, taskPackagesNode);
    const managedEvidenceNode = optionalEntryNode(artifacts, "managed-evidence");
    const transactions = await readResource(root, DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF, 1, signal, requiredEntryNode(before, "transactions", "$transactions"));
    assertEmpty(candidates, "$append-candidates");
    assertDirectory(taskPackages.directoryNode, "$task-packages");
    taskPackages.entries.forEach((entry, index) => {
        assertFile(entry.node, `$task-packages/${index}`);
        try {
            parseTaskPackageProjectionFileName(entry.name);
        }
        catch (error) {
            if (error instanceof TaskPackageProjectionPathError) {
                fail("tree-shape", `$task-packages/${index}`);
            }
            throw error;
        }
    });
    assertDirectory(transactions.directoryNode, "$transactions");
    let managedEvidenceTransactionNode;
    if (phase === "healthy") {
        if (transactions.entries.length !== 0)
            fail("tree-shape", "$transactions");
    }
    else if (phase === "demand-publication") {
        if (transactions.entries.length !== 1 ||
            transactions.entries[0]?.name !== "publication.json") {
            fail("tree-shape", "$transactions");
        }
        assertFile(transactions.entries[0].node, "$transactions/publication.json");
        if (managedEvidenceNode !== undefined) {
            fail("tree-shape", "$managed-evidence");
        }
    }
    else {
        if (transactions.entries.length !== 1 ||
            transactions.entries[0]?.name !==
                MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_FILE_NAME) {
            fail("tree-shape", "$transactions");
        }
        managedEvidenceTransactionNode = transactions.entries[0].node;
        assertFile(managedEvidenceTransactionNode, "$transactions/managed-evidence-publication.json");
    }
    let managedEvidence;
    try {
        managedEvidence = await inspectManagedEvidenceRecordSetInventory(root, {
            ...(managedEvidenceNode === undefined
                ? {}
                : { expectedRootNode: managedEvidenceNode }),
            ...(managedEvidenceTransactionNode === undefined
                ? {}
                : { expectedTransactionNode: managedEvidenceTransactionNode }),
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof ManagedEvidenceRecordSetInventoryError) {
            mapManagedEvidenceError(error);
        }
        throw error;
    }
    assertDirectory(commits.directoryNode, "$commits");
    assertDirectory(snapshots.directoryNode, "$snapshots");
    commits.entries.forEach((entry, index) => {
        assertFile(entry.node, `$commits/${index}`);
        let parsed;
        try {
            parsed = parseDemandEventStreamCommitFileName(entry.name);
        }
        catch (error) {
            if (error instanceof DemandEventSourcingPathError) {
                fail("tree-shape", `$commits/${index}`);
            }
            throw error;
        }
        if (parsed.commitSequence !== index + 1) {
            fail("tree-shape", `$commits/${index}`);
        }
    });
    snapshots.entries.forEach((entry, index) => {
        assertFile(entry.node, `$snapshots/${index}`);
        try {
            parseDemandEventStreamCommitFileName(entry.name);
        }
        catch (error) {
            if (error instanceof DemandEventSourcingPathError) {
                fail("tree-shape", `$snapshots/${index}`);
            }
            throw error;
        }
    });
    assertDirectory(indexes.directoryNode, "$index");
    indexes.entries.forEach((entry, index) => {
        assertFile(entry.node, `$index/${index}`);
        try {
            parseDemandEventStreamCommitFileName(entry.name);
        }
        catch (error) {
            if (error instanceof DemandEventSourcingPathError) {
                fail("tree-shape", `$index/${index}`);
            }
            throw error;
        }
    });
    let after;
    try {
        after = await readStableRootDirectory(root, {
            maximumEntries: 64,
            expectedNode: before.directoryNode,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof StableDirectoryReadError)
            mapReadError(error, "$root");
        throw error;
    }
    exactNames(after, ROOT_NAMES, "$root");
    if (!sameFileNodeSnapshot(eventSourcing.directoryNode, requiredEntryNode(after, "event-sourcing", "$event-sourcing")) ||
        !sameFileNodeSnapshot(artifacts.directoryNode, requiredEntryNode(after, "artifacts", "$artifacts")) ||
        !sameFileNodeSnapshot(transactions.directoryNode, requiredEntryNode(after, "transactions", "$transactions"))) {
        fail("source-changed", "$root");
    }
    return Object.freeze({
        commitCount: commits.entries.length,
        snapshotCount: snapshots.entries.length,
        artifactCount: taskPackages.entries.length +
            managedEvidence.recordCount,
        transactionCount: transactions.entries.length,
        appendCandidateCount: 0,
        managedEvidence,
        nodes: Object.freeze({
            root: after.directoryNode,
            identity: requiredEntryNode(after, "identity.json", "$identity"),
            authority: requiredEntryNode(after, "authority.json", "$authority"),
            eventSourcing: requiredEntryNode(after, "event-sourcing", "$event-sourcing"),
            commits: commits.directoryNode,
            snapshots: snapshots.directoryNode,
            index: indexes.directoryNode,
            appendCandidates: candidates.directoryNode,
            artifacts: artifacts.directoryNode,
            taskPackages: taskPackages.directoryNode,
            transactions: transactions.directoryNode,
        }),
    });
}
