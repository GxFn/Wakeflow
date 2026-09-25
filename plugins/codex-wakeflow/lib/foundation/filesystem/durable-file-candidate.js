import { Buffer } from "node:buffer";
import { constants as fileSystemConstants } from "node:fs";
import { open as openFileHandle, unlink, } from "node:fs/promises";
import { types } from "node:util";
import { computeSha256Digest, Sha256Error, } from "../crypto/sha256.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../data/passive-own-data.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import { parseByteCount, } from "../numeric/byte-count.js";
import { DURABLE_ATOMIC_FILE_MAXIMUM_BYTES, } from "./durable-atomic-file-write-contract.js";
import { createFileNodeSnapshot, sameFileNodeIdentity, sameFileNodeSnapshot, } from "./file-node-snapshot.js";
import { RootedDirectory } from "./rooted-directory.js";
import { RootedResourceParentHandle, RootedResourceParentHandleError, } from "./rooted-resource-parent-handle.js";
const ERROR_MESSAGES = {
    "input": "Durable file candidate input is invalid.",
    "capacity": "Durable file candidate exceeds its byte capacity.",
    "hash-failure": "Durable file candidate bytes could not be hashed.",
    "root-scope": "Durable file candidate lost its rooted scope.",
    "parent": "Durable file candidate parent is unavailable or unsafe.",
    "target-exists": "Durable file candidate target already exists.",
    "create-failure": "Durable file candidate could not be created exclusively.",
    "write-failure": "Durable file candidate bytes could not be written exactly.",
    "sync-failure": "Durable file candidate could not synchronize its bytes.",
    "candidate-changed": "Durable file candidate changed during preparation.",
    "durability-failure": "Durable file candidate directory entry could not be synchronized.",
    "cleanup-failure": "Failed durable file candidate could not be retired exactly.",
    "aborted": "Durable file candidate preparation was aborted.",
    "close-failure": "Durable file candidate handle could not be closed.",
};
export class DurableFileCandidateError extends Error {
    name = "DurableFileCandidateError";
    code = "wakeflow-durable-file-candidate";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
/** 与耐久原子单文件写入一致的Foundation单文件硬上限。 */
const DURABLE_FILE_CANDIDATE_MAXIMUM_BYTES = DURABLE_ATOMIC_FILE_MAXIMUM_BYTES;
function fail(reason, path) {
    throw new DurableFileCandidateError(reason, path);
}
function assertRoot(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        fail("input", "$root");
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
    if (!Object.hasOwn(record, "mode")
        || Object.keys(record).some((key) => key !== "mode" && key !== "signal" && key !== "durability")
        || (record.durability !== undefined
            && record.durability !== "fsync"
            && record.durability !== "content-only")
        || typeof record.mode !== "number"
        || !Number.isInteger(record.mode)
        || record.mode < 0
        || record.mode > 0o777
        || (record.signal !== undefined
            && (types.isProxy(record.signal)
                || !(record.signal instanceof AbortSignal)))) {
        fail("input", "$options");
    }
    return Object.freeze({
        mode: record.mode,
        durability: (record.durability ?? "fsync"),
        signal: record.signal,
    });
}
function snapshotInput(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !ArrayBuffer.isView(value)
        || !(value instanceof Uint8Array)
        || value.buffer instanceof SharedArrayBuffer) {
        fail("input", "$bytes");
    }
    const byteCount = parseByteCount(value.byteLength, "$bytes");
    if (byteCount > DURABLE_FILE_CANDIDATE_MAXIMUM_BYTES) {
        fail("capacity", "$bytes");
    }
    let bytes;
    try {
        bytes = Buffer.from(value);
    }
    catch {
        fail("capacity", "$bytes");
    }
    let digest;
    try {
        digest = computeSha256Digest(bytes, "$bytes");
    }
    catch (error) {
        if (error instanceof Sha256Error)
            fail("hash-failure", "$bytes");
        throw error;
    }
    return Object.freeze({
        bytes,
        byteCount,
        digest,
    });
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$signal");
}
function openFlags() {
    const noFollow = fileSystemConstants.O_NOFOLLOW;
    if (typeof noFollow !== "number")
        fail("root-scope", "$root");
    return fileSystemConstants.O_RDWR
        | fileSystemConstants.O_CREAT
        | fileSystemConstants.O_EXCL
        | noFollow;
}
function snapshotNode(value, reason) {
    try {
        return createFileNodeSnapshot(value, "$candidate");
    }
    catch {
        fail(reason, "$candidate");
    }
}
async function snapshotHandle(handle, reason) {
    try {
        return snapshotNode(await handle.stat({ bigint: true }), reason);
    }
    catch (error) {
        if (error instanceof DurableFileCandidateError)
            throw error;
        fail(reason, "$candidate");
    }
}
async function assertParentCurrent(parent, reason, path) {
    try {
        await parent.assertCurrent();
    }
    catch (error) {
        if (error instanceof RootedResourceParentHandleError)
            fail(reason, path);
        throw error;
    }
}
async function inspectParentTarget(parent, reason, path) {
    try {
        return await parent.inspectTarget();
    }
    catch (error) {
        if (error instanceof RootedResourceParentHandleError)
            fail(reason, path);
        throw error;
    }
}
async function syncParent(parent) {
    try {
        await parent.sync();
    }
    catch (error) {
        if (error instanceof RootedResourceParentHandleError) {
            fail("durability-failure", "$candidate");
        }
        throw error;
    }
}
async function writeAll(handle, bytes, signal) {
    let offset = 0;
    while (offset < bytes.byteLength) {
        assertNotAborted(signal);
        let written;
        try {
            ({ bytesWritten: written } = await handle.write(bytes, offset, bytes.byteLength - offset, offset));
        }
        catch {
            assertNotAborted(signal);
            fail("write-failure", "$candidate");
        }
        if (written <= 0 || written > bytes.byteLength - offset) {
            fail("write-failure", "$candidate");
        }
        offset += written;
    }
}
async function verifyBytes(handle, input, signal) {
    const before = await snapshotHandle(handle, "candidate-changed");
    let scratch;
    try {
        scratch = Buffer.allocUnsafe(Math.min(input.byteCount || 1, 512 * 1024));
    }
    catch {
        fail("candidate-changed", "$candidate");
    }
    let offset = 0;
    while (offset < input.byteCount) {
        assertNotAborted(signal);
        const length = Math.min(scratch.byteLength, input.byteCount - offset);
        let filled = 0;
        while (filled < length) {
            let read;
            try {
                ({ bytesRead: read } = await handle.read(scratch, filled, length - filled, offset + filled));
            }
            catch {
                assertNotAborted(signal);
                fail("candidate-changed", "$candidate");
            }
            if (read <= 0 || read > length - filled) {
                fail("candidate-changed", "$candidate");
            }
            filled += read;
        }
        if (!scratch.subarray(0, length).equals(input.bytes.subarray(offset, offset + length))) {
            fail("candidate-changed", "$candidate");
        }
        offset += length;
    }
    assertNotAborted(signal);
    try {
        if ((await handle.read(scratch, 0, 1, input.byteCount)).bytesRead !== 0) {
            fail("candidate-changed", "$candidate");
        }
    }
    catch (error) {
        if (error instanceof DurableFileCandidateError)
            throw error;
        fail("candidate-changed", "$candidate");
    }
    const after = await snapshotHandle(handle, "candidate-changed");
    if (!sameFileNodeSnapshot(before, after)) {
        fail("candidate-changed", "$candidate");
    }
    return after;
}
async function closeParent(parent) {
    try {
        await parent.close();
        return undefined;
    }
    catch {
        return new DurableFileCandidateError("close-failure", "$candidate");
    }
}
function sameRetiredCandidateNode(before, after) {
    return (sameFileNodeIdentity(before, after)
        && before.kind === "file"
        && after.kind === "file"
        && before.rawMode === after.rawMode
        && before.permissionBits === after.permissionBits
        && before.linkCount === 1n
        && after.linkCount === 0n
        && before.userId === after.userId
        && before.groupId === after.groupId
        && before.specialDeviceId === after.specialDeviceId
        && before.byteCount === after.byteCount
        && before.modifiedAtNanoseconds === after.modifiedAtNanoseconds);
}
/** 直接创建并同步一个具名、非权威文件候选资源。 */
export async function createFileCandidateDurably(root, resourcePath, bytesValue, optionsValue) {
    assertRoot(root);
    const options = parseOptions(optionsValue);
    assertNotAborted(options.signal);
    const input = snapshotInput(bytesValue);
    let parent;
    try {
        parent = await RootedResourceParentHandle.open(root, resourcePath);
    }
    catch (error) {
        if (error instanceof RootedResourceParentHandleError) {
            if (error.reason === "root-scope")
                fail("root-scope", "$root");
            if (error.reason === "input")
                fail("input", "$resourcePath");
            fail("parent", "$resourcePath");
        }
        throw error;
    }
    let handle;
    let created = false;
    let primaryError;
    let result;
    try {
        await assertParentCurrent(parent, "parent", "$resourcePath");
        if (await inspectParentTarget(parent, "parent", "$resourcePath") !== null) {
            fail("target-exists", "$resourcePath");
        }
        try {
            handle = await openFileHandle(parent.resourceAbsolutePath, openFlags(), 0o600);
            created = true;
        }
        catch (error) {
            if (readNodeSystemErrorCode(error) === "EEXIST") {
                fail("target-exists", "$resourcePath");
            }
            fail("create-failure", "$candidate");
        }
        await writeAll(handle, input.bytes, options.signal);
        assertNotAborted(options.signal);
        try {
            await handle.chmod(options.mode);
        }
        catch {
            fail("write-failure", "$candidate");
        }
        let prepared = await verifyBytes(handle, input, options.signal);
        if (prepared.kind !== "file"
            || prepared.linkCount !== 1n
            || prepared.permissionBits !== options.mode
            || prepared.byteCount !== input.byteCount) {
            fail("candidate-changed", "$candidate");
        }
        // 内容同步同样由根的持久化级别决定；`content-only` 只放弃父目录条目的同步，
        // 而根为 `none` 时连内容同步一起跳过，其余复验完全不变。
        if (root.durability === "fsync") {
            try {
                await handle.sync();
            }
            catch {
                fail("sync-failure", "$candidate");
            }
        }
        prepared = await verifyBytes(handle, input, options.signal);
        await assertParentCurrent(parent, "candidate-changed", "$candidate");
        const pathNode = await inspectParentTarget(parent, "candidate-changed", "$candidate");
        if (pathNode === null
            || !sameFileNodeSnapshot(prepared, pathNode)) {
            fail("candidate-changed", "$candidate");
        }
        if (options.durability === "fsync")
            await syncParent(parent);
        const finalHandle = await verifyBytes(handle, input, options.signal);
        const finalPath = await inspectParentTarget(parent, "candidate-changed", "$candidate");
        if (finalPath === null
            || !sameFileNodeSnapshot(finalHandle, finalPath)) {
            fail("candidate-changed", "$candidate");
        }
        result = Object.freeze({
            resourcePath,
            node: finalPath,
            byteCount: input.byteCount,
            digest: input.digest,
        });
    }
    catch (error) {
        primaryError = error;
    }
    if (created && result === undefined && handle !== undefined) {
        try {
            const opened = await snapshotHandle(handle, "cleanup-failure");
            const current = await parent.inspectTarget();
            if (current === null
                || opened.kind !== "file"
                || current.kind !== "file"
                || opened.linkCount !== 1n
                || !sameFileNodeSnapshot(opened, current)) {
                fail("cleanup-failure", "$candidate");
            }
            await unlink(parent.resourceAbsolutePath);
            const retired = await snapshotHandle(handle, "cleanup-failure");
            if (!sameRetiredCandidateNode(opened, retired)) {
                fail("cleanup-failure", "$candidate");
            }
            await parent.sync();
        }
        catch (error) {
            primaryError = error instanceof DurableFileCandidateError
                ? error
                : new DurableFileCandidateError("cleanup-failure", "$candidate");
        }
    }
    if (handle !== undefined) {
        try {
            await handle.close();
        }
        catch {
            if (primaryError === undefined) {
                primaryError = new DurableFileCandidateError("close-failure", "$candidate");
            }
        }
    }
    const parentCloseError = await closeParent(parent);
    if (primaryError === undefined && parentCloseError !== undefined) {
        primaryError = parentCloseError;
    }
    if (primaryError !== undefined)
        throw primaryError;
    if (result === undefined)
        fail("candidate-changed", "$candidate");
    return result;
}
