import { types } from "node:util";
import pLimit from "p-limit";
import { parsePlainRecord, PassiveOwnDataError, } from "../data/passive-own-data.js";
import { addByteCounts, ByteCountError, parseByteCount, } from "../numeric/byte-count.js";
import { BoundedDirectoryTreeScanError, scanBoundedResourceDirectoryTree, scanBoundedRootDirectoryTree, } from "./bounded-directory-tree-scan.js";
import { sameFileNodeSnapshot, } from "./file-node-snapshot.js";
import { RootedDirectory } from "./rooted-directory.js";
import { readStableFileDigest, StableFileReadError, } from "./stable-file-read.js";
/**
 * Wakeflow Foundation / Filesystem：根作用域内的稳定、有界资源树内容观察。
 *
 * 本模块组合两次 `BoundedDirectoryTreeScan` 和中间的普通文件稳定摘要读取：先冻结
 * 结构与节点预期，再以固定并发读取每个文件，最后复验完整结构。
 * 返回结果因此把同一次观察窗口内的路径、节点、文件字节数和 SHA-256 绑定起来。
 *
 * 本层不保留文件字节、不解析文本或 JSON、不跟随符号链接，也不决定特殊节点、
 * 空目录树、权限、所有者、硬链接、可移植路径冲突或领域目录布局是否合法。
 * Node 没有提供整树原子快照；本合同证明的是前后快照一致且每个文件在窗口内稳定。
 */
/** 文件摘要读取的内部固定并发上限，不属于调用方容量或领域策略。 */
const STABLE_RESOURCE_TREE_FILE_CONCURRENCY = 8;
const ERROR_MESSAGES = {
    "input": "Stable resource tree read input is invalid.",
    "root-scope": "Stable resource tree read could not establish its rooted scope.",
    "not-found": "Stable resource tree read target does not exist.",
    "symlink": "Stable resource tree read target cannot be a symbolic link.",
    "not-directory": "Stable resource tree read target must be a directory.",
    "entry-limit": "Stable resource tree exceeds the caller entry limit.",
    "depth-limit": "Stable resource tree exceeds the caller depth limit.",
    "file-count": "Stable resource tree exceeds the caller regular-file limit.",
    "file-bytes": "A stable resource tree file exceeds the caller byte limit.",
    "total-bytes": "Stable resource tree exceeds the caller total-byte limit.",
    "entry-path": "Stable resource tree contains a non-portable resource path.",
    "io-failure": "Stable resource tree facts could not be observed safely.",
    "source-changed": "Stable resource tree changed while it was being read.",
    "aborted": "Stable resource tree read was aborted.",
};
/**
 * 稳定资源树读取的公共、脱敏错误。
 *
 * 错误不回显物理路径、资源引用、节点元数据、容量、摘要、取消原因或底层原因。
 */
export class StableResourceTreeReadError extends Error {
    name = "StableResourceTreeReadError";
    code = "wakeflow-stable-resource-tree-read";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new StableResourceTreeReadError(reason, path);
}
function isAbortSignal(value) {
    return (typeof value === "object"
        && value !== null
        && !types.isProxy(value)
        && value instanceof AbortSignal);
}
function parseCount(value, path) {
    if (typeof value !== "number"
        || !Number.isSafeInteger(value)
        || value < 0) {
        fail("input", path);
    }
    return value;
}
function parseBytes(value, path) {
    try {
        return parseByteCount(value, path);
    }
    catch (error) {
        if (error instanceof ByteCountError)
            fail("input", path);
        throw error;
    }
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
    const required = Object.freeze([
        "maximumDepth",
        "maximumEntries",
        "maximumFileBytes",
        "maximumFiles",
        "maximumTotalBytes",
    ]);
    const allowed = new Set([...required, "expectedNode", "signal"]);
    if (required.some((field) => !Object.hasOwn(record, field))
        || Object.keys(record).some((key) => !allowed.has(key))) {
        fail("input", "$options");
    }
    if (record.signal !== undefined && !isAbortSignal(record.signal)) {
        fail("input", "$options.signal");
    }
    return Object.freeze({
        maximumEntries: parseCount(record.maximumEntries, "$options.maximumEntries"),
        maximumDepth: parseCount(record.maximumDepth, "$options.maximumDepth"),
        maximumFiles: parseCount(record.maximumFiles, "$options.maximumFiles"),
        maximumFileBytes: parseBytes(record.maximumFileBytes, "$options.maximumFileBytes"),
        maximumTotalBytes: parseBytes(record.maximumTotalBytes, "$options.maximumTotalBytes"),
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
function mapTreeScanError(error, phase) {
    if (error.reason === "input")
        fail("input", error.path);
    if (error.reason === "root-scope")
        fail("root-scope", "$root");
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "source-changed")
        fail("source-changed", "$tree");
    if (phase === "after") {
        if (error.reason === "not-found"
            || error.reason === "symlink"
            || error.reason === "not-directory"
            || error.reason === "entry-limit"
            || error.reason === "depth-limit"
            || error.reason === "entry-path") {
            fail("source-changed", "$tree");
        }
        fail("io-failure", "$tree");
    }
    if (error.reason === "not-found")
        fail("not-found", "$tree");
    if (error.reason === "symlink")
        fail("symlink", "$tree");
    if (error.reason === "not-directory")
        fail("not-directory", "$tree");
    if (error.reason === "entry-limit")
        fail("entry-limit", "$tree.entries");
    if (error.reason === "depth-limit")
        fail("depth-limit", "$tree.depth");
    if (error.reason === "entry-path")
        fail("entry-path", "$tree.entries");
    fail("io-failure", "$tree");
}
function mapStableFileReadError(error) {
    if (error.reason === "input")
        fail("input", error.path);
    if (error.reason === "root-scope"
        || error.reason === "unsupported-platform") {
        fail("root-scope", "$root");
    }
    if (error.reason === "too-large")
        fail("io-failure", "$tree.files");
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "not-found"
        || error.reason === "symlink"
        || error.reason === "not-file"
        || error.reason === "expectation-changed"
        || error.reason === "source-changed") {
        fail("source-changed", "$tree.files");
    }
    fail("io-failure", "$tree.files");
}
function scanOptions(options, expectedNode) {
    return {
        maximumEntries: options.maximumEntries,
        maximumDepth: options.maximumDepth,
        ...(expectedNode === undefined ? {} : { expectedNode }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
}
async function scanTree(root, treeRootResourcePath, options, expectedNode, phase) {
    try {
        const parsed = scanOptions(options, expectedNode);
        return treeRootResourcePath === null
            ? await scanBoundedRootDirectoryTree(root, parsed)
            : await scanBoundedResourceDirectoryTree(root, treeRootResourcePath, parsed);
    }
    catch (error) {
        if (error instanceof BoundedDirectoryTreeScanError) {
            mapTreeScanError(error, phase);
        }
        throw error;
    }
}
function addTreeBytes(current, next) {
    try {
        return addByteCounts(current, next, "$tree.totalFileBytes");
    }
    catch (error) {
        if (error instanceof ByteCountError) {
            fail("total-bytes", "$tree.totalFileBytes");
        }
        throw error;
    }
}
function collectFileEntries(tree, options) {
    const entries = [];
    let totalBytes = parseByteCount(0, "$tree.totalFileBytes");
    for (const entry of tree.entries) {
        if (entry.node.kind !== "file")
            continue;
        if (entries.length >= options.maximumFiles) {
            fail("file-count", "$tree.files");
        }
        if (entry.node.byteCount > options.maximumFileBytes) {
            fail("file-bytes", "$tree.files");
        }
        totalBytes = addTreeBytes(totalBytes, entry.node.byteCount);
        if (totalBytes > options.maximumTotalBytes) {
            fail("total-bytes", "$tree.totalFileBytes");
        }
        entries.push(entry);
    }
    return Object.freeze({ entries: Object.freeze(entries), totalBytes });
}
async function readOneFile(root, entry, options) {
    try {
        const source = await readStableFileDigest(root, entry.resourcePath, {
            maximumBytes: options.maximumFileBytes,
            expectedNode: entry.node,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        return Object.freeze({
            ...source,
            name: entry.name,
            parentResourcePath: entry.parentResourcePath,
            depth: entry.depth,
        });
    }
    catch (error) {
        if (error instanceof StableFileReadError)
            mapStableFileReadError(error);
        throw error;
    }
}
async function readFiles(root, entries, options) {
    const limit = pLimit(STABLE_RESOURCE_TREE_FILE_CONCURRENCY);
    const settled = await Promise.allSettled(entries.map((entry) => limit(readOneFile, root, entry, options)));
    const files = [];
    for (const result of settled) {
        if (result.status === "rejected")
            throw result.reason;
        files.push(result.value);
    }
    return Object.freeze(files);
}
function sameTree(left, right) {
    return left.treeRootResourcePath === right.treeRootResourcePath
        && sameFileNodeSnapshot(left.treeRootNode, right.treeRootNode)
        && left.entries.length === right.entries.length
        && left.entries.every((entry, index) => {
            const other = right.entries[index];
            return other !== undefined
                && entry.name === other.name
                && entry.resourcePath === other.resourcePath
                && entry.parentResourcePath === other.parentResourcePath
                && entry.depth === other.depth
                && sameFileNodeSnapshot(entry.node, other.node);
        });
}
async function readTree(root, treeRootResourcePath, options) {
    const before = await scanTree(root, treeRootResourcePath, options, options.expectedNode, "before");
    const planned = collectFileEntries(before, options);
    const files = await readFiles(root, planned.entries, options);
    const after = await scanTree(root, treeRootResourcePath, options, before.treeRootNode, "after");
    if (!sameTree(before, after))
        fail("source-changed", "$tree");
    assertNotAborted(options.signal);
    return Object.freeze({
        treeRootResourcePath,
        treeRootNode: before.treeRootNode,
        entries: before.entries,
        files,
        totalFileBytes: planned.totalBytes,
    });
}
/** 稳定读取 RootedDirectory 自身的完整资源树内容事实。 */
export async function readStableRootResourceTree(root, options) {
    assertRoot(root);
    const parsed = parseOptions(options);
    assertNotAborted(parsed.signal);
    return readTree(root, null, parsed);
}
/** 稳定读取 `RootedDirectory` 内一个资源目录的完整目录树内容事实。 */
export async function readStableResourceTree(root, resourcePath, options) {
    assertRoot(root);
    const parsed = parseOptions(options);
    assertNotAborted(parsed.signal);
    return readTree(root, resourcePath, parsed);
}
