import { types } from "node:util";
import { PassiveOwnDataError, parsePlainRecord, } from "../../../foundation/data/passive-own-data.js";
import { DurableAtomicFileStageAddressError, hasDurableAtomicFileStagePrefix, parseDurableAtomicFileStageFileName, readDurableAtomicFileStageOwnerState, } from "../../../foundation/filesystem/durable-atomic-file-stage-address.js";
import { sameFileNodeSnapshot, } from "../../../foundation/filesystem/file-node-snapshot.js";
import { RootedDirectory } from "../../../foundation/filesystem/rooted-directory.js";
import { readStableResourceDirectory, readStableRootDirectory, StableDirectoryReadError, } from "../../../foundation/filesystem/stable-directory-read.js";
import { inspectManagedEvidenceRecordSetInventory, ManagedEvidenceRecordSetInventoryError, } from "../../evidence/managed-evidence-record-set-inventory.js";
import { MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_FILE_NAME } from "../../evidence/managed-evidence-resource-paths.js";
import { parseTaskPackageProjectionFileName, TASK_PACKAGE_PROJECTIONS_ROOT_REF, TaskPackageProjectionPathError, } from "../../tasking/task-package-projection-paths.js";
import { DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF, DEMAND_EVENT_SOURCING_ARTIFACTS_ROOT_REF, DEMAND_EVENT_SOURCING_ROOT_REF, DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF, DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF, DEMAND_EVENT_STREAM_COMMITS_ROOT_REF, DEMAND_EVENT_STREAM_INDEX_ROOT_REF, DEMAND_PERMIT_PROMPT_KINDS, DEMAND_PERMIT_PROMPTS_ROOT_REF, DemandEventSourcingPathError, demandPermitPromptKindRootRef, parseDemandEventStreamCommitFileName, parseDemandPermitPromptFileName, parseDemandPermitPromptKind, } from "./demand-event-sourcing-paths.js";
import { DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE, DEMAND_FILE_EVENT_STORE_FILE_MODE, DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS, } from "./demand-file-event-store.js";
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
const ARTIFACT_NAMES = new Set(["managed-evidence", "permits", "task-packages"]);
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
        (typeof process.geteuid === "function" && node.userId !== BigInt(process.geteuid()))) {
        fail("node-policy", path);
    }
}
function assertFile(node, path) {
    if (node.kind !== "file" ||
        node.permissionBits !== DEMAND_FILE_EVENT_STORE_FILE_MODE ||
        node.linkCount !== 1n ||
        (typeof process.geteuid === "function" && node.userId !== BigInt(process.geteuid()))) {
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
        phase: record.phase === "demand-publication" || record.phase === "managed-evidence-publication"
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
function permitPromptKind(name, path) {
    try {
        return parseDemandPermitPromptKind(name);
    }
    catch (error) {
        if (error instanceof DemandEventSourcingPathError)
            fail("tree-shape", path);
        throw error;
    }
}
/** 可选的许可 prompt 工件（K6）：两类子目录各装以 target-delivery 身份命名的 `.txt`；别的形状都是 tree-shape。 */
async function inspectPermitPrompts(root, artifacts, signal) {
    const permitsNode = optionalEntryNode(artifacts, "permits");
    if (permitsNode === undefined)
        return 0;
    const permits = await readResource(root, DEMAND_PERMIT_PROMPTS_ROOT_REF, DEMAND_PERMIT_PROMPT_KINDS.length, signal, permitsNode);
    assertDirectory(permits.directoryNode, "$permits");
    let count = 0;
    for (const [kindIndex, entry] of permits.entries.entries()) {
        const kind = permitPromptKind(entry.name, `$permits/${kindIndex}`);
        assertDirectory(entry.node, `$permits/${kind}`);
        const prompts = await readResource(root, demandPermitPromptKindRootRef(kind), DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS, signal, entry.node);
        assertDirectory(prompts.directoryNode, `$permits/${kind}`);
        prompts.entries.forEach((prompt, index) => {
            assertFile(prompt.node, `$permits/${kind}/${index}`);
            try {
                parseDemandPermitPromptFileName(prompt.name);
            }
            catch (error) {
                if (error instanceof DemandEventSourcingPathError) {
                    fail("tree-shape", `$permits/${kind}/${index}`);
                }
                throw error;
            }
        });
        count += prompts.entries.length;
    }
    return count;
}
/**
 * 快照目录里 foundation 自己的原子暂存文件不是快照，也不是未知资源（§13.161 B3-2 的同一分类）：
 * 写者还活着 → 一次检查点正在落盘，按 source-changed 让调用方稍后重来；写者已死 → 残留由下一次
 * 同目标写入回收，这里容忍、不计入快照数也不删除；所有者未知或名字畸形 → 仍按 tree-shape 拒绝。
 */
function isToleratedSnapshotStageResidue(name, path) {
    if (!hasDurableAtomicFileStagePrefix(name))
        return false;
    let stage;
    try {
        stage = parseDurableAtomicFileStageFileName(name);
    }
    catch (error) {
        if (error instanceof DurableAtomicFileStageAddressError)
            fail("tree-shape", path);
        throw error;
    }
    const owner = readDurableAtomicFileStageOwnerState(stage);
    if (owner === "active")
        fail("source-changed", path);
    if (owner === "unknown")
        fail("tree-shape", path);
    return true;
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
    const permitCount = await inspectPermitPrompts(root, artifacts, signal);
    assertDirectory(transactions.directoryNode, "$transactions");
    let managedEvidenceTransactionNode;
    if (phase === "healthy") {
        if (transactions.entries.length !== 0)
            fail("tree-shape", "$transactions");
    }
    else if (phase === "demand-publication") {
        if (transactions.entries.length !== 1 || transactions.entries[0]?.name !== "publication.json") {
            fail("tree-shape", "$transactions");
        }
        assertFile(transactions.entries[0].node, "$transactions/publication.json");
        if (managedEvidenceNode !== undefined) {
            fail("tree-shape", "$managed-evidence");
        }
    }
    else {
        if (transactions.entries.length !== 1 ||
            transactions.entries[0]?.name !== MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_FILE_NAME) {
            fail("tree-shape", "$transactions");
        }
        managedEvidenceTransactionNode = transactions.entries[0].node;
        assertFile(managedEvidenceTransactionNode, "$transactions/managed-evidence-publication.json");
    }
    let managedEvidence;
    try {
        managedEvidence = await inspectManagedEvidenceRecordSetInventory(root, {
            ...(managedEvidenceNode === undefined ? {} : { expectedRootNode: managedEvidenceNode }),
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
    let snapshotCount = 0;
    snapshots.entries.forEach((entry, index) => {
        assertFile(entry.node, `$snapshots/${index}`);
        if (isToleratedSnapshotStageResidue(entry.name, `$snapshots/${index}`))
            return;
        try {
            parseDemandEventStreamCommitFileName(entry.name);
        }
        catch (error) {
            if (error instanceof DemandEventSourcingPathError) {
                fail("tree-shape", `$snapshots/${index}`);
            }
            throw error;
        }
        snapshotCount += 1;
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
        snapshotCount,
        artifactCount: taskPackages.entries.length + managedEvidence.recordCount + permitCount,
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
