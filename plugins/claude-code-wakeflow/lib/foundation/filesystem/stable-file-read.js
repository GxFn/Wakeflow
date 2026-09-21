import { constants as bufferConstants } from "node:buffer";
import { constants as fileSystemConstants } from "node:fs";
import { open as openFileHandle, } from "node:fs/promises";
import { types } from "node:util";
import { Sha256Hasher, Sha256HasherError, } from "../crypto/sha256-hasher.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../data/passive-own-data.js";
import { ByteCountError, parseByteCount, } from "../numeric/byte-count.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import { createFileNodeSnapshot, FileNodeSnapshotError, sameFileNodeSnapshot, } from "./file-node-snapshot.js";
import { RootedDirectory, RootedDirectoryError, } from "./rooted-directory.js";
/**
 * Wakeflow Foundation / Filesystem：根作用域内稳定、有界的普通文件读取。
 *
 * 本模块在 `RootedDirectory` 下依次完成观察、预期节点检查、不跟随符号链接地打开、
 * 按位置分块读取并计算 SHA-256、文件末尾探测，以及句柄、路径和根目录复验。调用方
 * 必须显式提供最大字节数；需要完整内容时调用 `readStableFile`，只需要内容身份时
 * 调用 `readStableFileDigest`。两者共享同一读取内核，并且都只读取一个已打开的
 * `FileHandle`。
 *
 * 本层不解码文本、不解析 JSON、不判断所有者、权限位或硬链接策略，也不把成功读取
 * 解释为文件此后不可变或领域权威事实已经成立。
 */
/** regular-file positioned read 的内部性能参数，不属于公共容量合同。 */
const STABLE_FILE_READ_CHUNK_BYTES = 512 * 1024;
const ERROR_MESSAGES = {
    "input": "Stable file read input is invalid.",
    "unsupported-platform": "Stable file read requires Node no-follow file handles.",
    "root-scope": "Stable file read could not establish its rooted resource scope.",
    "not-found": "Stable file read target does not exist.",
    "symlink": "Stable file read target cannot be a symbolic link.",
    "not-file": "Stable file read target must be a regular file.",
    "expectation-changed": "Stable file read target no longer matches its expected node.",
    "too-large": "Stable file read target exceeds the caller or runtime byte limit.",
    "io-failure": "Stable file bytes could not be read and hashed safely.",
    "source-changed": "Stable file target changed while it was being read.",
    "aborted": "Stable file read was aborted.",
    "close-failure": "Stable file handle could not be closed safely.",
};
/**
 * 稳定文件读取的公共、脱敏错误。
 *
 * 错误不回显物理路径、资源引用、文件字节、容量、摘要、取消原因或底层原因链。
 */
export class StableFileReadError extends Error {
    name = "StableFileReadError";
    code = "wakeflow-stable-file-read";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new StableFileReadError(reason, path);
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
    const allowed = new Set(["expectedNode", "maximumBytes", "signal"]);
    if (!Object.hasOwn(record, "maximumBytes")
        || Object.keys(record).some((key) => !allowed.has(key))) {
        fail("input", "$options");
    }
    let maximumBytes;
    try {
        maximumBytes = parseByteCount(record.maximumBytes, "$options.maximumBytes");
    }
    catch (error) {
        if (error instanceof ByteCountError) {
            fail("input", "$options.maximumBytes");
        }
        throw error;
    }
    if (record.signal !== undefined && !isAbortSignal(record.signal)) {
        fail("input", "$options.signal");
    }
    return Object.freeze({
        maximumBytes,
        expectedNode: parseExpectedNode(record.expectedNode),
        signal: record.signal,
    });
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$signal");
}
function assertRoot(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        fail("input", "$root");
    }
}
async function inspectInitialResource(root, resourcePath) {
    try {
        return await root.inspectExistingResource(resourcePath, "$resourcePath");
    }
    catch (error) {
        if (error instanceof RootedDirectoryError) {
            if (error.reason === "resource-not-found") {
                fail("not-found", "$resourcePath");
            }
            if (error.reason === "resource-path") {
                fail("input", "$resourcePath");
            }
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
}
async function inspectFinalResource(root, resourcePath) {
    try {
        return await root.inspectExistingResource(resourcePath, "$resourcePath");
    }
    catch (error) {
        if (error instanceof RootedDirectoryError) {
            fail("source-changed", "$resourcePath");
        }
        throw error;
    }
}
function assertRegularFile(resource) {
    if (resource.node.kind === "symbolic-link")
        fail("symlink", "$resourcePath");
    if (resource.node.kind !== "file")
        fail("not-file", "$resourcePath");
}
function assertExpectedNode(actual, expected) {
    if (expected !== undefined && !sameFileNodeSnapshot(actual, expected)) {
        fail("expectation-changed", "$options.expectedNode");
    }
}
function assertWithinMaximum(byteCount, maximumBytes) {
    if (byteCount > maximumBytes)
        fail("too-large", "$resourcePath");
}
async function snapshotOpenedFile(handle) {
    let stats;
    try {
        stats = await handle.stat({ bigint: true });
    }
    catch {
        fail("source-changed", "$resourcePath");
    }
    try {
        return createFileNodeSnapshot(stats, "$resourcePath");
    }
    catch (error) {
        if (error instanceof FileNodeSnapshotError) {
            fail("source-changed", "$resourcePath");
        }
        throw error;
    }
}
function requiredOpenFlags() {
    const noFollow = fileSystemConstants.O_NOFOLLOW;
    if (typeof noFollow !== "number") {
        fail("unsupported-platform", "$resourcePath");
    }
    const nonBlocking = typeof fileSystemConstants.O_NONBLOCK === "number"
        ? fileSystemConstants.O_NONBLOCK
        : 0;
    return fileSystemConstants.O_RDONLY | noFollow | nonBlocking;
}
async function openStableFile(initial) {
    try {
        return await openFileHandle(initial.physicalPath, requiredOpenFlags());
    }
    catch (error) {
        const code = readNodeSystemErrorCode(error);
        if (code === "ELOOP" || code === "ENOENT" || code === "ENOTDIR") {
            fail("source-changed", "$resourcePath");
        }
        fail("io-failure", "$resourcePath");
    }
}
/** 所有读取缓冲区分配失败都映射为稳定的运行时容量错误。 */
function allocateReadBuffer(byteLength) {
    try {
        return Buffer.allocUnsafe(byteLength);
    }
    catch {
        fail("too-large", "$resourcePath");
    }
}
function createCapture(mode, byteCount) {
    if (mode === "digest")
        return null;
    if (byteCount > bufferConstants.MAX_LENGTH) {
        fail("too-large", "$resourcePath");
    }
    return allocateReadBuffer(byteCount);
}
async function readExactFile(handle, byteCount, capture, signal) {
    const hasher = new Sha256Hasher();
    const scratch = capture === null
        ? allocateReadBuffer(Math.min(STABLE_FILE_READ_CHUNK_BYTES, byteCount || 1))
        : null;
    let position = 0;
    while (position < byteCount) {
        assertNotAborted(signal);
        const remaining = byteCount - position;
        const length = Math.min(STABLE_FILE_READ_CHUNK_BYTES, remaining);
        const target = capture ?? scratch;
        if (target === null)
            fail("io-failure", "$resourcePath");
        const offset = capture === null ? 0 : position;
        let bytesRead;
        try {
            ({ bytesRead } = await handle.read(target, offset, length, position));
        }
        catch {
            assertNotAborted(signal);
            fail("io-failure", "$resourcePath");
        }
        if (bytesRead <= 0 || bytesRead > length) {
            fail("source-changed", "$resourcePath");
        }
        try {
            hasher.update(target.subarray(offset, offset + bytesRead));
        }
        catch (error) {
            if (error instanceof Sha256HasherError) {
                fail("io-failure", "$resourcePath");
            }
            throw error;
        }
        position += bytesRead;
    }
    assertNotAborted(signal);
    const growthProbe = allocateReadBuffer(1);
    try {
        const probe = await handle.read(growthProbe, 0, 1, byteCount);
        if (probe.bytesRead !== 0)
            fail("source-changed", "$resourcePath");
    }
    catch (error) {
        if (error instanceof StableFileReadError)
            throw error;
        assertNotAborted(signal);
        fail("io-failure", "$resourcePath");
    }
    try {
        const result = hasher.digest();
        if (result.byteCount !== byteCount)
            fail("source-changed", "$resourcePath");
        return Object.freeze({ digest: result.digest, bytes: capture });
    }
    catch (error) {
        if (error instanceof StableFileReadError)
            throw error;
        if (error instanceof Sha256HasherError)
            fail("io-failure", "$resourcePath");
        throw error;
    }
}
async function readStableFileVersion(root, resourcePath, options, mode) {
    assertRoot(root);
    const parsed = parseOptions(options);
    assertNotAborted(parsed.signal);
    const initial = await inspectInitialResource(root, resourcePath);
    assertRegularFile(initial);
    assertExpectedNode(initial.node, parsed.expectedNode);
    assertWithinMaximum(initial.node.byteCount, parsed.maximumBytes);
    if (mode === "bytes" && initial.node.byteCount > bufferConstants.MAX_LENGTH) {
        fail("too-large", "$resourcePath");
    }
    const handle = await openStableFile(initial);
    let primaryError;
    let result;
    try {
        const opened = await snapshotOpenedFile(handle);
        if (opened.kind !== "file"
            || !sameFileNodeSnapshot(initial.node, opened)) {
            fail("source-changed", "$resourcePath");
        }
        assertWithinMaximum(opened.byteCount, parsed.maximumBytes);
        const capture = createCapture(mode, opened.byteCount);
        const read = await readExactFile(handle, opened.byteCount, capture, parsed.signal);
        const afterHandle = await snapshotOpenedFile(handle);
        const afterPath = await inspectFinalResource(root, resourcePath);
        if (afterPath.node.kind !== "file"
            || !sameFileNodeSnapshot(opened, afterHandle)
            || !sameFileNodeSnapshot(afterHandle, afterPath.node)) {
            fail("source-changed", "$resourcePath");
        }
        assertNotAborted(parsed.signal);
        result = Object.freeze({
            resourcePath,
            node: afterPath.node,
            byteCount: afterPath.node.byteCount,
            digest: read.digest,
            bytes: read.bytes,
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
            fail("close-failure", "$resourcePath");
    }
    if (primaryError !== undefined)
        throw primaryError;
    if (result === undefined)
        fail("io-failure", "$resourcePath");
    return result;
}
/** 稳定读取普通文件的完整字节，并同时返回源摘要和最终节点事实。 */
export async function readStableFile(root, resourcePath, options) {
    const result = await readStableFileVersion(root, resourcePath, options, "bytes");
    if (result.bytes === null)
        fail("io-failure", "$resourcePath");
    return Object.freeze({
        resourcePath: result.resourcePath,
        node: result.node,
        byteCount: result.byteCount,
        digest: result.digest,
        bytes: result.bytes,
    });
}
/** 流式读取并散列普通文件，不分配与完整文件等大的连续 Buffer。 */
export async function readStableFileDigest(root, resourcePath, options) {
    const result = await readStableFileVersion(root, resourcePath, options, "digest");
    return Object.freeze({
        resourcePath: result.resourcePath,
        node: result.node,
        byteCount: result.byteCount,
        digest: result.digest,
    });
}
