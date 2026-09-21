import { constants as fileSystemConstants } from "node:fs";
import { lstat, open as openFileHandle, opendir, } from "node:fs/promises";
import nodePath from "node:path";
import { types } from "node:util";
import pLimit from "p-limit";
import { parsePlainRecord, PassiveOwnDataError, } from "../data/passive-own-data.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import { decodeUtf8, Utf8Error, } from "../text/utf8.js";
import { createFileNodeSnapshot, FileNodeSnapshotError, sameFileNodeSnapshot, } from "./file-node-snapshot.js";
import { parsePortableResourcePath, PortableResourcePathError, } from "./portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError, } from "./rooted-directory.js";
const ERROR_MESSAGES = {
    "input": "Stable directory read input is invalid.",
    "unsupported-platform": "Stable directory read requires Node no-follow directory handles.",
    "root-scope": "Stable directory read could not establish its rooted scope.",
    "not-found": "Stable directory read target does not exist.",
    "symlink": "Stable directory read target cannot be a symbolic link.",
    "not-directory": "Stable directory read target must be a directory.",
    "expectation-changed": "Stable directory read target no longer matches its expected node.",
    "too-many-entries": "Directory contains more entries than the caller limit.",
    "entry-path": "Directory entry cannot form a portable rooted resource path.",
    "io-failure": "Directory target and entry facts could not be observed safely.",
    "source-changed": "Directory or one of its entries changed during the read.",
    "aborted": "Stable directory read was aborted.",
    "close-failure": "A directory read handle could not be closed safely.",
};
/**
 * 稳定目录读取的公共错误。
 *
 * 错误不回显物理路径、资源引用、目录项名称、节点元数据、限制值、系统调用、
 * 取消原因或 Node.js 底层原因。
 */
export class StableDirectoryReadError extends Error {
    name = "StableDirectoryReadError";
    code = "wakeflow-stable-directory-read";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
/**
 * Node 24 支持以 `buffer` 编码返回原始目录项名称；当前 Node 类型声明仍把
 * `opendir` 收窄为字符编码。类型桥只保留实际使用的 read/close 表面，读取时还会
 * 复验名称确实是 Buffer，避免把有损字符串当成物理名称字节。
 */
const openRawNameDirectory = opendir;
/** 单次目录项 `lstat` 使用的内部固定并发上限，不属于公开 API。 */
const STABLE_DIRECTORY_LSTAT_CONCURRENCY = 8;
function fail(reason, path) {
    throw new StableDirectoryReadError(reason, path);
}
function isAbortSignal(value) {
    return (typeof value === "object"
        && value !== null
        && !types.isProxy(value)
        && value instanceof AbortSignal);
}
function parseExpectedNode(value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !Object.isFrozen(value)) {
        fail("input", "$options.expectedNode");
    }
    try {
        if (!sameFileNodeSnapshot(value, value)) {
            fail("input", "$options.expectedNode");
        }
    }
    catch (error) {
        if (error instanceof FileNodeSnapshotError) {
            fail("input", "$options.expectedNode");
        }
        throw error;
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
    const allowed = new Set(["expectedNode", "maximumEntries", "signal"]);
    if (!Object.hasOwn(record, "maximumEntries")
        || Object.keys(record).some((key) => !allowed.has(key))) {
        fail("input", "$options");
    }
    if (typeof record.maximumEntries !== "number"
        || !Number.isSafeInteger(record.maximumEntries)
        || record.maximumEntries < 0) {
        fail("input", "$options.maximumEntries");
    }
    if (record.signal !== undefined && !isAbortSignal(record.signal)) {
        fail("input", "$options.signal");
    }
    return Object.freeze({
        maximumEntries: record.maximumEntries,
        expectedNode: parseExpectedNode(record.expectedNode),
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
function sameNames(left, right) {
    return (left.length === right.length
        && left.every((name, index) => name === right[index]));
}
function assertExpectedNode(actual, expected) {
    if (expected !== undefined && !sameFileNodeSnapshot(actual, expected)) {
        fail("expectation-changed", "$options.expectedNode");
    }
}
function requiredOpenFlags() {
    const directory = fileSystemConstants.O_DIRECTORY;
    const noFollow = fileSystemConstants.O_NOFOLLOW;
    if (typeof directory !== "number" || typeof noFollow !== "number") {
        fail("unsupported-platform", "$root");
    }
    return fileSystemConstants.O_RDONLY | directory | noFollow;
}
async function inspectInitialRoot(root) {
    let node;
    try {
        node = await root.assertCurrent("$root");
    }
    catch (error) {
        if (error instanceof RootedDirectoryError) {
            if (error.reason === "unsupported-platform") {
                fail("unsupported-platform", "$root");
            }
            fail("root-scope", "$root");
        }
        throw error;
    }
    if (node.kind !== "directory")
        fail("root-scope", "$root");
    return Object.freeze({
        directoryResourcePath: null,
        physicalPath: root.absolutePath,
        node,
        errorPath: "$root",
    });
}
async function inspectInitialResource(root, resourcePath) {
    let resource;
    try {
        resource = await root.inspectExistingResource(resourcePath, "$resourcePath");
    }
    catch (error) {
        if (error instanceof RootedDirectoryError) {
            if (error.reason === "resource-not-found") {
                fail("not-found", "$resourcePath");
            }
            if (error.reason === "resource-path")
                fail("input", "$resourcePath");
            if (error.reason === "resource-changed"
                || error.reason === "resource-alias") {
                fail("source-changed", "$resourcePath");
            }
            if (error.reason === "unsupported-platform") {
                fail("unsupported-platform", "$resourcePath");
            }
            fail("root-scope", "$resourcePath");
        }
        throw error;
    }
    if (resource.node.kind === "symbolic-link") {
        fail("symlink", "$resourcePath");
    }
    if (resource.node.kind !== "directory") {
        fail("not-directory", "$resourcePath");
    }
    return Object.freeze({
        directoryResourcePath: resourcePath,
        physicalPath: resource.physicalPath,
        node: resource.node,
        errorPath: "$resourcePath",
    });
}
async function inspectFinalTarget(root, target) {
    try {
        if (target.directoryResourcePath === null) {
            return await root.assertCurrent("$root");
        }
        const resource = await root.inspectExistingResource(target.directoryResourcePath, "$resourcePath");
        return resource.node;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError) {
            fail("source-changed", target.errorPath);
        }
        throw error;
    }
}
async function openStableDirectory(target) {
    const flags = requiredOpenFlags();
    try {
        return await openFileHandle(target.physicalPath, flags);
    }
    catch (error) {
        const code = readNodeSystemErrorCode(error);
        if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
            fail("source-changed", target.errorPath);
        }
        fail("io-failure", target.errorPath);
    }
}
async function snapshotOpenedDirectory(handle, errorPath) {
    try {
        return createFileNodeSnapshot(await handle.stat({ bigint: true }), errorPath);
    }
    catch {
        fail("source-changed", errorPath);
    }
}
function decodeDirectoryEntryName(value) {
    try {
        return decodeUtf8(value, "$entries");
    }
    catch (error) {
        if (error instanceof Utf8Error)
            fail("entry-path", "$entries");
        throw error;
    }
}
async function enumerateNames(physicalPath, maximumEntries, signal) {
    let directory;
    try {
        directory = await openRawNameDirectory(physicalPath, {
            encoding: "buffer",
            recursive: false,
        });
    }
    catch (error) {
        const code = readNodeSystemErrorCode(error);
        if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
            fail("source-changed", "$entries");
        }
        fail("io-failure", "$entries");
    }
    const names = [];
    let primaryError;
    try {
        while (true) {
            assertNotAborted(signal);
            let entry;
            try {
                entry = await directory.read();
            }
            catch (error) {
                assertNotAborted(signal);
                const code = readNodeSystemErrorCode(error);
                if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
                    fail("source-changed", "$entries");
                }
                fail("io-failure", "$entries");
            }
            if (entry === null)
                break;
            const rawName = entry.name;
            if (!Buffer.isBuffer(rawName))
                fail("io-failure", "$entries");
            if (names.length >= maximumEntries) {
                fail("too-many-entries", "$entries");
            }
            names.push(decodeDirectoryEntryName(rawName));
        }
    }
    catch (error) {
        primaryError = error;
    }
    try {
        await directory.close();
    }
    catch {
        if (primaryError === undefined)
            fail("close-failure", "$entries");
    }
    if (primaryError !== undefined)
        throw primaryError;
    assertNotAborted(signal);
    names.sort(compareText);
    for (let index = 1; index < names.length; index += 1) {
        if (names[index - 1] === names[index])
            fail("entry-path", "$entries");
    }
    return Object.freeze(names);
}
function entryResourcePath(directoryResourcePath, name, index) {
    const candidate = directoryResourcePath === null
        ? name
        : `${directoryResourcePath}/${name}`;
    try {
        return parsePortableResourcePath(candidate, `$entries/${index}`);
    }
    catch (error) {
        if (error instanceof PortableResourcePathError) {
            fail("entry-path", `$entries/${index}`);
        }
        throw error;
    }
}
async function inspectEntry(target, name, index, signal, verification) {
    assertNotAborted(signal);
    const resourcePath = entryResourcePath(target.directoryResourcePath, name, index);
    let node;
    try {
        const stats = await lstat(nodePath.join(target.physicalPath, name), { bigint: true });
        node = createFileNodeSnapshot(stats, `$entries/${index}.node`);
    }
    catch (error) {
        if (verification)
            fail("source-changed", `$entries/${index}`);
        if (readNodeSystemErrorCode(error) === "ENOENT") {
            fail("source-changed", `$entries/${index}`);
        }
        fail("io-failure", `$entries/${index}`);
    }
    return Object.freeze({ name, resourcePath, node });
}
async function inspectEntries(target, names, signal, verification) {
    const limit = pLimit(STABLE_DIRECTORY_LSTAT_CONCURRENCY);
    const tasks = names.map((name, index) => limit(inspectEntry, target, name, index, signal, verification));
    const settled = await Promise.allSettled(tasks);
    const entries = [];
    for (const result of settled) {
        if (result.status === "rejected")
            throw result.reason;
        entries.push(result.value);
    }
    return Object.freeze(entries);
}
function sameEntries(left, right) {
    return (left.length === right.length
        && left.every((entry, index) => {
            const other = right[index];
            return (other !== undefined
                && entry.name === other.name
                && entry.resourcePath === other.resourcePath
                && sameFileNodeSnapshot(entry.node, other.node));
        }));
}
async function readStableDirectory(root, target, options) {
    const handle = await openStableDirectory(target);
    let primaryError;
    let result;
    try {
        const opened = await snapshotOpenedDirectory(handle, target.errorPath);
        if (opened.kind !== "directory"
            || !sameFileNodeSnapshot(target.node, opened)) {
            fail("source-changed", target.errorPath);
        }
        const firstNames = await enumerateNames(target.physicalPath, options.maximumEntries, options.signal);
        const firstEntries = await inspectEntries(target, firstNames, options.signal, false);
        const secondNames = await enumerateNames(target.physicalPath, options.maximumEntries, options.signal);
        if (!sameNames(firstNames, secondNames)) {
            fail("source-changed", "$entries");
        }
        const secondEntries = await inspectEntries(target, secondNames, options.signal, true);
        if (!sameEntries(firstEntries, secondEntries)) {
            fail("source-changed", "$entries");
        }
        const afterHandle = await snapshotOpenedDirectory(handle, target.errorPath);
        const afterPath = await inspectFinalTarget(root, target);
        if (afterPath.kind !== "directory"
            || !sameFileNodeSnapshot(opened, afterHandle)
            || !sameFileNodeSnapshot(afterHandle, afterPath)) {
            fail("source-changed", target.errorPath);
        }
        assertNotAborted(options.signal);
        result = Object.freeze({
            directoryResourcePath: target.directoryResourcePath,
            directoryNode: afterPath,
            entries: firstEntries,
        });
    }
    catch (error) {
        primaryError = error;
    }
    try {
        await handle.close();
    }
    catch {
        if (primaryError === undefined)
            fail("close-failure", target.errorPath);
    }
    if (primaryError !== undefined)
        throw primaryError;
    if (result === undefined)
        fail("io-failure", target.errorPath);
    return result;
}
/** 稳定读取 RootedDirectory 自身的一层直属目录项。 */
export async function readStableRootDirectory(root, options) {
    assertRoot(root);
    const parsed = parseOptions(options);
    assertNotAborted(parsed.signal);
    const target = await inspectInitialRoot(root);
    assertExpectedNode(target.node, parsed.expectedNode);
    assertNotAborted(parsed.signal);
    return readStableDirectory(root, target, parsed);
}
/** 稳定读取 `RootedDirectory` 内一个已有资源目录的直属目录项。 */
export async function readStableResourceDirectory(root, resourcePath, options) {
    assertRoot(root);
    const parsed = parseOptions(options);
    assertNotAborted(parsed.signal);
    const target = await inspectInitialResource(root, resourcePath);
    assertExpectedNode(target.node, parsed.expectedNode);
    assertNotAborted(parsed.signal);
    return readStableDirectory(root, target, parsed);
}
