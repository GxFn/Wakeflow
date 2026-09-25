import { unlink } from "node:fs/promises";
import { types } from "node:util";
import { parsePlainRecord, PassiveOwnDataError, } from "../data/passive-own-data.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import { FileNodeSnapshotError, sameFileNodeIdentity, sameFileNodeSnapshot, } from "./file-node-snapshot.js";
import { RootedDirectory } from "./rooted-directory.js";
import { RootedExactResourceHandle, RootedExactResourceHandleError, } from "./rooted-exact-resource-handle.js";
import { RootedResourceParentHandle, RootedResourceParentHandleError, } from "./rooted-resource-parent-handle.js";
const ERROR_MESSAGES = {
    "input": "Exact regular file unlink input is invalid.",
    "root-scope": "Exact unlink could not establish its rooted scope.",
    "parent-not-found": "Exact unlink parent directory does not exist.",
    "parent-symlink": "Exact unlink parent chain cannot contain a symbolic link.",
    "parent-not-directory": "Exact unlink parent must be a directory.",
    "parent-open-failure": "Exact unlink parent could not be opened safely.",
    "parent-changed": "Exact unlink parent changed during the operation.",
    "source-not-found": "Exact unlink source does not exist.",
    "source-symlink": "Exact unlink source cannot be a symbolic link.",
    "source-not-file": "Exact unlink source must be a regular file.",
    "source-open-failure": "Exact unlink source could not be opened safely.",
    "source-changed": "Exact unlink source no longer matches its expectation.",
    "unlink-failure": "Exact unlink commit could not be executed safely.",
    "commit-uncertain": "Exact unlink commit result could not be proven safely.",
    "durability-failure": "Exact unlink inode and parent could not be synchronized.",
    "aborted": "Exact unlink was aborted before commit.",
    "close-failure": "An exact unlink handle could not be closed safely.",
};
/**
 * 指定普通文件删除失败时返回的稳定错误。
 *
 * 错误不回显物理路径、资源引用、节点元数据、链接数、取消原因、系统调用或底层原因。
 * `unlink` 调用后的错误不得被解释为路径名一定仍然存在。
 */
export class ExactRegularFileUnlinkError extends Error {
    name = "ExactRegularFileUnlinkError";
    code = "wakeflow-exact-regular-file-unlink";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new ExactRegularFileUnlinkError(reason, path);
}
function isAbortSignal(value) {
    return (typeof value === "object"
        && value !== null
        && !types.isProxy(value)
        && value instanceof AbortSignal);
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
function parseExpectedNode(value) {
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
    const allowed = new Set(["expectedNode", "settlement", "durability", "signal"]);
    if (!Object.hasOwn(record, "expectedNode")
        || Object.keys(record).some((key) => !allowed.has(key))) {
        fail("input", "$options");
    }
    const expectedNode = parseExpectedNode(record.expectedNode);
    if (expectedNode.kind === "file" && expectedNode.linkCount < 1n) {
        fail("input", "$options.expectedNode");
    }
    const signal = record.signal;
    if (signal !== undefined && !isAbortSignal(signal)) {
        fail("input", "$options.signal");
    }
    const settlement = record.settlement === undefined
        ? "absent"
        : record.settlement;
    if (settlement !== "absent" && settlement !== "replacement-allowed") {
        fail("input", "$options.settlement");
    }
    const durability = record.durability === undefined ? "fsync" : record.durability;
    if (durability !== "fsync" && durability !== "none") {
        fail("input", "$options.durability");
    }
    return Object.freeze({ expectedNode, settlement, durability, signal });
}
function mapParentHandleError(error, operation) {
    if (operation === "sync" && error.reason === "sync-failure") {
        fail("durability-failure", "$resourcePath");
    }
    if (operation === "inspect"
        && error.reason === "target-inspection-failure") {
        fail("commit-uncertain", "$resourcePath");
    }
    // inspect 与 sync 只在 unlink 提交之后使用：此后的父目录漂移不能读作路径仍存在。
    if (operation === "inspect" || operation === "sync") {
        fail("commit-uncertain", "$resourcePath");
    }
    if (operation === "open") {
        if (error.reason === "input")
            fail("input", "$resourcePath");
        if (error.reason === "root-scope")
            fail("root-scope", "$resourcePath");
        if (error.reason === "parent-not-found") {
            fail("parent-not-found", "$resourcePath");
        }
        if (error.reason === "parent-symlink") {
            fail("parent-symlink", "$resourcePath");
        }
        if (error.reason === "parent-not-directory") {
            fail("parent-not-directory", "$resourcePath");
        }
        if (error.reason === "parent-open-failure") {
            fail("parent-open-failure", "$resourcePath");
        }
    }
    fail("parent-changed", "$resourcePath");
}
async function openResourceParent(root, resourcePath) {
    try {
        return await RootedResourceParentHandle.open(root, resourcePath, "$resourcePath");
    }
    catch (error) {
        if (error instanceof RootedResourceParentHandleError) {
            mapParentHandleError(error, "open");
        }
        throw error;
    }
}
async function assertParentCurrent(parent) {
    try {
        await parent.assertCurrent();
    }
    catch (error) {
        if (error instanceof RootedResourceParentHandleError) {
            mapParentHandleError(error, "current");
        }
        throw error;
    }
}
async function inspectParentTarget(parent) {
    try {
        return await parent.inspectTarget();
    }
    catch (error) {
        if (error instanceof RootedResourceParentHandleError) {
            mapParentHandleError(error, "inspect");
        }
        throw error;
    }
}
async function syncParent(parent) {
    try {
        await parent.sync();
    }
    catch (error) {
        if (error instanceof RootedResourceParentHandleError) {
            mapParentHandleError(error, "sync");
        }
        throw error;
    }
}
async function closeParent(parent) {
    try {
        await parent.close();
        return undefined;
    }
    catch (error) {
        if (error instanceof RootedResourceParentHandleError) {
            return new ExactRegularFileUnlinkError(error.reason === "close-failure" ? "close-failure" : "parent-changed", "$resourcePath");
        }
        throw error;
    }
}
function mapExactSourceError(error, operation) {
    if (operation === "sync-after-commit" && error.reason === "sync-failure") {
        fail("durability-failure", "$resourcePath");
    }
    if (operation === "inspect-after-commit"
        || operation === "sync-after-commit") {
        fail("commit-uncertain", "$resourcePath");
    }
    if (operation === "current")
        fail("source-changed", "$resourcePath");
    if (error.reason === "input")
        fail("input", "$resourcePath");
    if (error.reason === "root-scope")
        fail("root-scope", "$resourcePath");
    if (error.reason === "resource-not-found") {
        fail("source-not-found", "$resourcePath");
    }
    if (error.reason === "resource-symlink") {
        fail("source-symlink", "$resourcePath");
    }
    if (error.reason === "resource-kind") {
        fail("source-not-file", "$resourcePath");
    }
    if (error.reason === "resource-open-failure") {
        fail("source-open-failure", "$resourcePath");
    }
    fail("source-changed", "$resourcePath");
}
async function openExactSource(root, resourcePath, expectedNode) {
    try {
        return await RootedExactResourceHandle.openRegularFile(root, resourcePath, expectedNode, "$resourcePath");
    }
    catch (error) {
        if (error instanceof RootedExactResourceHandleError) {
            mapExactSourceError(error, "open");
        }
        throw error;
    }
}
async function assertSourceCurrent(source) {
    try {
        await source.assertPathCurrent();
    }
    catch (error) {
        if (error instanceof RootedExactResourceHandleError) {
            mapExactSourceError(error, "current");
        }
        throw error;
    }
}
async function inspectCommittedSource(source) {
    try {
        return await source.inspectOpenedNode();
    }
    catch (error) {
        if (error instanceof RootedExactResourceHandleError) {
            mapExactSourceError(error, "inspect-after-commit");
        }
        throw error;
    }
}
async function syncCommittedSource(source) {
    try {
        await source.syncOpenedNode();
    }
    catch (error) {
        if (error instanceof RootedExactResourceHandleError) {
            mapExactSourceError(error, "sync-after-commit");
        }
        throw error;
    }
}
async function closeSource(source) {
    try {
        await source.close();
        return undefined;
    }
    catch (error) {
        if (error instanceof RootedExactResourceHandleError) {
            return new ExactRegularFileUnlinkError("close-failure", "$resourcePath");
        }
        throw error;
    }
}
async function observeSettlement(parent, retiredNode, settlement) {
    const current = await inspectParentTarget(parent);
    if (current === null)
        return false;
    if (settlement === "absent"
        || sameFileNodeIdentity(current, retiredNode)) {
        fail("commit-uncertain", "$resourcePath");
    }
    // replacement-allowed 只接纳不同 dev/ino 的 successor；它不证明 successor 内容。
    return true;
}
function sameUnlinkedNode(before, after, remainingLinkCount) {
    return (sameFileNodeIdentity(before, after)
        && before.kind === "file"
        && after.kind === "file"
        && before.rawMode === after.rawMode
        && before.permissionBits === after.permissionBits
        && after.linkCount === remainingLinkCount
        && before.userId === after.userId
        && before.groupId === after.groupId
        && before.specialDeviceId === after.specialDeviceId
        && before.byteCount === after.byteCount
        && before.modifiedAtNanoseconds === after.modifiedAtNanoseconds);
}
/**
 * 耐久删除仍与指定冻结节点一致的普通文件路径名。
 *
 * 成功 receipt 始终证明原 inode linkCount-1。默认 settlement 还证明 pathname
 * absent；replacement-allowed 则只证明若原名已有 successor，它与原 inode 身份不同。
 * 调用方仍须使用领域锁和恢复意图解释后继资源，不能把该策略当作普通资源的通用宽松删除。
 */
export async function unlinkRegularFileExactly(root, resourcePath, options) {
    assertRoot(root);
    const parsed = parseOptions(options);
    assertNotAborted(parsed.signal);
    const parent = await openResourceParent(root, resourcePath);
    let source;
    let primaryError;
    let result;
    try {
        source = await openExactSource(root, resourcePath, parsed.expectedNode);
        if (source.resourceAbsolutePath !== parent.resourceAbsolutePath) {
            fail("root-scope", "$resourcePath");
        }
        await assertParentCurrent(parent);
        await assertSourceCurrent(source);
        assertNotAborted(parsed.signal);
        try {
            await unlink(parent.resourceAbsolutePath);
        }
        catch (error) {
            if (readNodeSystemErrorCode(error) === "ENOENT") {
                fail("source-changed", "$resourcePath");
            }
            fail("unlink-failure", "$resourcePath");
        }
        const nodeBefore = source.initialNodeSnapshot;
        const remainingLinkCount = nodeBefore.linkCount - 1n;
        let replacementObserved = await observeSettlement(parent, nodeBefore, parsed.settlement);
        const afterUnlink = await inspectCommittedSource(source);
        if (!sameUnlinkedNode(nodeBefore, afterUnlink, remainingLinkCount)) {
            fail("commit-uncertain", "$resourcePath");
        }
        if (parsed.durability === "fsync") {
            await syncCommittedSource(source);
            await syncParent(parent);
        }
        replacementObserved = (await observeSettlement(parent, nodeBefore, parsed.settlement)) || replacementObserved;
        const settled = await inspectCommittedSource(source);
        if (!sameFileNodeSnapshot(afterUnlink, settled)) {
            fail("commit-uncertain", "$resourcePath");
        }
        result = Object.freeze({
            resourcePath,
            nodeBefore,
            nodeAfterUnlink: settled,
            replacementObserved,
        });
    }
    catch (error) {
        primaryError = error;
    }
    if (source !== undefined) {
        const closeError = await closeSource(source);
        if (primaryError === undefined && closeError !== undefined) {
            primaryError = closeError;
        }
    }
    const parentCloseError = await closeParent(parent);
    if (primaryError === undefined && parentCloseError !== undefined) {
        primaryError = parentCloseError;
    }
    if (primaryError !== undefined)
        throw primaryError;
    if (result === undefined) {
        fail("commit-uncertain", "$resourcePath");
    }
    return result;
}
