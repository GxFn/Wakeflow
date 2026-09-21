import { types } from "node:util";
import { parsePlainRecord, PassiveOwnDataError, } from "../data/passive-own-data.js";
import { RootedDirectory } from "./rooted-directory.js";
import { readStableResourceDirectory, readStableRootDirectory, StableDirectoryReadError, } from "./stable-directory-read.js";
const ERROR_MESSAGES = {
    "input": "Bounded directory tree scan input is invalid.",
    "root-scope": "Directory tree scan could not establish its rooted scope.",
    "not-found": "Directory tree scan target does not exist.",
    "symlink": "Directory tree scan target cannot be a symbolic link.",
    "not-directory": "Directory tree scan target must be a directory.",
    "entry-limit": "Directory tree exceeds the caller total-entry limit.",
    "depth-limit": "Directory tree exceeds the caller relative-depth limit.",
    "entry-path": "Directory tree contains a non-portable resource path.",
    "inspection-failure": "Directory tree node facts could not be inspected safely.",
    "source-changed": "Directory tree changed while it was being traversed.",
    "aborted": "Bounded directory tree scan was aborted.",
    "close-failure": "A directory tree scan handle could not be closed safely.",
};
/**
 * 通用目录树扫描的稳定错误。
 *
 * 错误不回显物理根目录、资源引用、目录项名称、节点元数据、限制值、取消原因
 * 或 Node.js/底层原因。
 */
export class BoundedDirectoryTreeScanError extends Error {
    name = "BoundedDirectoryTreeScanError";
    code = "wakeflow-bounded-directory-tree-scan";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const LOWER_REASON_MAP = {
    "input": "input",
    "unsupported-platform": "root-scope",
    "root-scope": "root-scope",
    "not-found": "not-found",
    "symlink": "symlink",
    "not-directory": "not-directory",
    "expectation-changed": "source-changed",
    "entry-path": "entry-path",
    "io-failure": "inspection-failure",
    "source-changed": "source-changed",
    "aborted": "aborted",
    "close-failure": "close-failure",
};
function fail(reason, path) {
    throw new BoundedDirectoryTreeScanError(reason, path);
}
function isAbortSignal(value) {
    return (typeof value === "object"
        && value !== null
        && !types.isProxy(value)
        && value instanceof AbortSignal);
}
function parseLimit(value, path) {
    if (typeof value !== "number"
        || !Number.isSafeInteger(value)
        || value < 0) {
        fail("input", path);
    }
    return value;
}
function parseOptions(value) {
    let record;
    try {
        record = parsePlainRecord(value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    const required = ["maximumDepth", "maximumEntries"];
    const allowed = new Set([...required, "expectedNode", "signal"]);
    if (required.some((field) => !Object.hasOwn(record, field))
        || Object.keys(record).some((key) => !allowed.has(key))) {
        fail("input", "$options");
    }
    const maximumEntries = parseLimit(record.maximumEntries, "$options.maximumEntries");
    const maximumDepth = parseLimit(record.maximumDepth, "$options.maximumDepth");
    if (record.signal !== undefined && !isAbortSignal(record.signal)) {
        fail("input", "$options.signal");
    }
    return Object.freeze({
        maximumEntries,
        maximumDepth,
        expectedNode: record.expectedNode,
        signal: record.signal,
    });
}
function assertRoot(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        fail("input", "$root");
    }
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$signal");
}
function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function mapDirectoryReadError(error, limitReason) {
    if (error.reason === "too-many-entries") {
        fail(limitReason, limitReason === "entry-limit"
            ? "$tree.entries"
            : "$tree.depth");
    }
    fail(LOWER_REASON_MAP[error.reason], error.path);
}
function directoryReadOptions(maximumEntries, expectedNode, signal) {
    return {
        maximumEntries,
        ...(expectedNode === undefined ? {} : { expectedNode }),
        ...(signal === undefined ? {} : { signal }),
    };
}
async function readOneDirectory(root, resourcePath, maximumEntries, expectedNode, signal, limitReason) {
    try {
        const options = directoryReadOptions(maximumEntries, expectedNode, signal);
        return resourcePath === null
            ? await readStableRootDirectory(root, options)
            : await readStableResourceDirectory(root, resourcePath, options);
    }
    catch (error) {
        if (error instanceof StableDirectoryReadError) {
            if (expectedNode !== undefined
                && (error.reason === "not-found"
                    || error.reason === "symlink"
                    || error.reason === "not-directory")) {
                fail("source-changed", "$options.expectedNode");
            }
            mapDirectoryReadError(error, limitReason);
        }
        throw error;
    }
}
function createTreeEntry(parent, entry) {
    return Object.freeze({
        name: entry.name,
        resourcePath: entry.resourcePath,
        parentResourcePath: parent.resourcePath,
        depth: parent.depth + 1,
        node: entry.node,
    });
}
async function scanTree(root, treeRootResourcePath, options) {
    const pendingDirectories = [{
            resourcePath: treeRootResourcePath,
            depth: 0,
            expectedNode: options.expectedNode,
        }];
    const entries = [];
    let treeRootNode;
    while (pendingDirectories.length > 0) {
        assertNotAborted(options.signal);
        const pending = pendingDirectories.pop();
        if (pending === undefined)
            fail("inspection-failure", "$tree");
        const atDepthLimit = pending.depth === options.maximumDepth;
        const remainingEntries = options.maximumEntries - entries.length;
        const directory = await readOneDirectory(root, pending.resourcePath, atDepthLimit ? 0 : remainingEntries, pending.expectedNode, options.signal, atDepthLimit ? "depth-limit" : "entry-limit");
        if (pending.depth === 0)
            treeRootNode = directory.directoryNode;
        if (atDepthLimit)
            continue;
        const childDirectories = [];
        for (const child of directory.entries) {
            const treeEntry = createTreeEntry(pending, child);
            entries.push(treeEntry);
            if (treeEntry.node.kind === "directory") {
                childDirectories.push(Object.freeze({
                    resourcePath: treeEntry.resourcePath,
                    depth: treeEntry.depth,
                    expectedNode: treeEntry.node,
                }));
            }
        }
        for (let index = childDirectories.length - 1; index >= 0; index -= 1) {
            const child = childDirectories[index];
            if (child !== undefined)
                pendingDirectories.push(child);
        }
    }
    if (treeRootNode === undefined)
        fail("inspection-failure", "$tree");
    entries.sort((left, right) => compareText(left.resourcePath, right.resourcePath));
    assertNotAborted(options.signal);
    return Object.freeze({
        treeRootResourcePath,
        treeRootNode,
        entries: Object.freeze(entries),
    });
}
/** 有界扫描 RootedDirectory 自身的完整后代树。 */
export async function scanBoundedRootDirectoryTree(root, options) {
    assertRoot(root);
    const parsed = parseOptions(options);
    assertNotAborted(parsed.signal);
    return scanTree(root, null, parsed);
}
/** 有界扫描 `RootedDirectory` 内一个资源目录的完整后代树。 */
export async function scanBoundedResourceDirectoryTree(root, resourcePath, options) {
    assertRoot(root);
    const parsed = parseOptions(options);
    assertNotAborted(parsed.signal);
    return scanTree(root, resourcePath, parsed);
}
