import { types } from "node:util";
import { parsePlainRecord, PassiveOwnDataError, } from "../data/passive-own-data.js";
import { DurableDirectoryTreeCandidateError, inspectDirectoryTreeCandidate, parseDirectoryTreeCandidatePlan, } from "./durable-directory-tree-candidate.js";
import { renameResourceDurably, DurableResourceRenameError, } from "./durable-resource-rename.js";
import { sameFileNodeSnapshot, FileNodeSnapshotError, } from "./file-node-snapshot.js";
import { parsePortableResourcePath, PortableResourcePathError, } from "./portable-resource-path.js";
import { RootedDirectory } from "./rooted-directory.js";
const ERROR_MESSAGES = {
    input: "Directory tree publication input is invalid.",
    "source-changed": "Directory tree publication source changed before commit.",
    "source-conflict": "Directory tree publication source is not the declared closed candidate.",
    "destination-exists": "Directory tree publication destination already exists.",
    "cross-device": "Directory tree publication requires one filesystem device.",
    "commit-uncertain": "Directory tree publication commit result could not be proven exact.",
    "durability-failure": "Directory tree publication directory entries could not be synchronized.",
    "operation-failure": "Directory tree publication could not cross its commit point safely.",
    aborted: "Directory tree publication was aborted before commit.",
};
/** 目录树整体发布失败时返回的稳定、脱敏错误。 */
export class DurableDirectoryTreePublicationError extends Error {
    name = "DurableDirectoryTreePublicationError";
    code = "wakeflow-durable-directory-tree-publication";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new DurableDirectoryTreePublicationError(reason, path);
}
function plainRecord(value, path) {
    try {
        return parsePlainRecord(value, path);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", path);
        throw error;
    }
}
function parsePath(value, path) {
    try {
        return parsePortableResourcePath(value, path);
    }
    catch (error) {
        if (error instanceof PortableResourcePathError)
            fail("input", path);
        throw error;
    }
}
function isAbortSignal(value) {
    return typeof value === "object"
        && value !== null
        && !types.isProxy(value)
        && value instanceof AbortSignal;
}
function parseOptions(value) {
    const record = plainRecord(value, "$options");
    const unexpected = Object.keys(record).find((key) => key !== "signal");
    if (unexpected !== undefined)
        fail("input", `$options/${unexpected}`);
    const signal = record.signal;
    if (signal !== undefined && !isAbortSignal(signal)) {
        fail("input", "$options/signal");
    }
    return Object.freeze({ signal });
}
function parseExpectedNode(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !Object.isFrozen(value)) {
        fail("input", "$candidate/rootNode");
    }
    try {
        if (!sameFileNodeSnapshot(value, value)) {
            fail("input", "$candidate/rootNode");
        }
    }
    catch (error) {
        if (error instanceof FileNodeSnapshotError) {
            fail("input", "$candidate/rootNode");
        }
        throw error;
    }
    const node = value;
    if (node.kind !== "directory")
        fail("input", "$candidate/rootNode");
    return node;
}
function parseCandidate(value) {
    const record = plainRecord(value, "$candidate");
    const keys = Object.keys(record).sort();
    if (keys.length !== 3
        || keys[0] !== "candidateRootPath"
        || keys[1] !== "plan"
        || keys[2] !== "rootNode") {
        fail("input", "$candidate");
    }
    return Object.freeze({
        candidateRootPath: parsePath(record.candidateRootPath, "$candidate/candidateRootPath"),
        plan: parseDirectoryTreeCandidatePlan(record.plan),
        rootNode: parseExpectedNode(record.rootNode),
    });
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$signal");
}
function mapCandidateError(error, afterCommit) {
    if (afterCommit)
        fail("commit-uncertain", "$destinationResourcePath");
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "source-changed") {
        fail("source-changed", "$sourceResourcePath");
    }
    fail("source-conflict", "$sourceResourcePath");
}
function mapRenameError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "destination-exists") {
        fail("destination-exists", "$destinationResourcePath");
    }
    if (error.reason === "cross-device") {
        fail("cross-device", "$destinationResourcePath");
    }
    if (error.reason === "source-not-found"
        || error.reason === "source-changed") {
        fail("source-changed", "$sourceResourcePath");
    }
    if (error.reason === "source-symlink"
        || error.reason === "source-not-supported") {
        fail("source-conflict", "$sourceResourcePath");
    }
    if (error.reason === "durability-failure") {
        fail("durability-failure", "$destinationResourcePath");
    }
    if (error.reason === "commit-uncertain"
        || error.reason === "rename-failure"
        || error.reason === "close-failure") {
        fail("commit-uncertain", "$destinationResourcePath");
    }
    fail("operation-failure", "$destinationResourcePath");
}
/**
 * 在同一 `RootedDirectory` 内，将清单已闭合的候选目录树发布到尚不存在的最终路径。
 * 调用方必须持有同时覆盖源路径和目标路径的领域锁。
 */
export async function publishDirectoryTreeCandidateDurably(root, candidateValue, destinationResourcePathValue, optionsValue = {}) {
    if (!(root instanceof RootedDirectory) || types.isProxy(root)) {
        fail("input", "$root");
    }
    const options = parseOptions(optionsValue);
    assertNotAborted(options.signal);
    const candidate = parseCandidate(candidateValue);
    const destinationResourcePath = parsePath(destinationResourcePathValue, "$destinationResourcePath");
    let inspected;
    try {
        inspected = await inspectDirectoryTreeCandidate(root, candidate.candidateRootPath, candidate.plan, {
            expectedRootNode: candidate.rootNode,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
    }
    catch (error) {
        if (error instanceof DurableDirectoryTreeCandidateError) {
            mapCandidateError(error, false);
        }
        throw error;
    }
    let moved;
    try {
        moved = await renameResourceDurably(root, candidate.candidateRootPath, destinationResourcePath, {
            expectedSourceNode: inspected.rootNode,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
    }
    catch (error) {
        if (error instanceof DurableResourceRenameError)
            mapRenameError(error);
        throw error;
    }
    if (moved.kind !== "directory") {
        fail("commit-uncertain", "$destinationResourcePath");
    }
    let finalInspection;
    try {
        finalInspection = await inspectDirectoryTreeCandidate(root, destinationResourcePath, candidate.plan, {
            expectedRootNode: moved.node,
        });
    }
    catch (error) {
        if (error instanceof DurableDirectoryTreeCandidateError) {
            mapCandidateError(error, true);
        }
        throw error;
    }
    if (!sameFileNodeSnapshot(moved.node, finalInspection.rootNode)) {
        fail("commit-uncertain", "$destinationResourcePath");
    }
    return Object.freeze({
        sourceResourcePath: candidate.candidateRootPath,
        destinationResourcePath,
        plan: candidate.plan,
        rootNode: finalInspection.rootNode,
    });
}
