import { link } from "node:fs/promises";
import { types } from "node:util";
import { parsePlainRecord, PassiveOwnDataError, } from "../data/passive-own-data.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import { FileNodeSnapshotError, sameFileNodeIdentity, sameFileNodeSnapshot, } from "./file-node-snapshot.js";
import { parsePortableResourcePath, PortableResourcePathError, } from "./portable-resource-path.js";
import { RootedDirectory } from "./rooted-directory.js";
import { RootedExactResourceHandle, RootedExactResourceHandleError, } from "./rooted-exact-resource-handle.js";
import { RootedResourceParentHandle, RootedResourceParentHandleError, } from "./rooted-resource-parent-handle.js";
const ERROR_MESSAGES = {
    "input": "Durable regular file link input is invalid.",
    "root-scope": "Regular file link could not establish its rooted scope.",
    "parent-not-found": "Regular file link parent directory does not exist.",
    "parent-symlink": "Regular file link parent chain cannot contain a symbolic link.",
    "parent-not-directory": "Regular file link parent must be a directory.",
    "parent-open-failure": "Regular file link parent could not be opened safely.",
    "parent-changed": "Regular file link parent changed during the operation.",
    "source-not-found": "Regular file link source does not exist.",
    "source-symlink": "Regular file link source cannot be a symbolic link.",
    "source-not-file": "Regular file link source must be a regular file.",
    "source-open-failure": "Regular file link source could not be opened safely.",
    "source-changed": "Regular file link source no longer matches its expectation.",
    "destination-exists": "Regular file link destination already exists.",
    "destination-inspection-failure": "Regular file link destination could not be inspected safely.",
    "cross-device": "Regular file hard link cannot cross a filesystem boundary.",
    "link-failure": "Regular file hard-link commit could not be executed safely.",
    "commit-uncertain": "Regular file linked-pair commit could not be proven exact.",
    "durability-failure": "Regular file linked pair could not be synchronized safely.",
    "aborted": "Regular file link was aborted before commit.",
    "close-failure": "A regular file link handle could not be closed safely.",
};
/**
 * 普通文件持久化链接失败时返回的稳定错误。
 *
 * 错误不回显物理路径、资源引用、节点元数据、链接数、取消原因、系统调用或底层原因。
 * `link` 调用后的错误不得被解释为目标路径一定不存在。
 */
export class DurableRegularFileLinkError extends Error {
    name = "DurableRegularFileLinkError";
    code = "wakeflow-durable-regular-file-link";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new DurableRegularFileLinkError(reason, path);
}
function parseResourcePath(value, path) {
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
        fail("input", "$options.expectedSourceNode");
    }
    try {
        if (!sameFileNodeSnapshot(value, value)) {
            fail("input", "$options.expectedSourceNode");
        }
    }
    catch (error) {
        if (error instanceof FileNodeSnapshotError) {
            fail("input", "$options.expectedSourceNode");
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
    const allowed = new Set(["expectedSourceNode", "signal"]);
    if (!Object.hasOwn(record, "expectedSourceNode")
        || Object.keys(record).some((key) => !allowed.has(key))) {
        fail("input", "$options");
    }
    const signal = record.signal;
    if (signal !== undefined && !isAbortSignal(signal)) {
        fail("input", "$options.signal");
    }
    return Object.freeze({
        expectedSourceNode: parseExpectedNode(record.expectedSourceNode),
        signal,
    });
}
function mapParentHandleError(error, operation, errorPath, inspectionReason) {
    if (operation === "sync" && error.reason === "sync-failure") {
        fail("durability-failure", errorPath);
    }
    if (operation === "inspect"
        && error.reason === "target-inspection-failure") {
        fail(inspectionReason ?? "destination-inspection-failure", errorPath);
    }
    if (operation === "open") {
        if (error.reason === "input")
            fail("input", errorPath);
        if (error.reason === "root-scope")
            fail("root-scope", errorPath);
        if (error.reason === "parent-not-found") {
            fail("parent-not-found", errorPath);
        }
        if (error.reason === "parent-symlink") {
            fail("parent-symlink", errorPath);
        }
        if (error.reason === "parent-not-directory") {
            fail("parent-not-directory", errorPath);
        }
        if (error.reason === "parent-open-failure") {
            fail("parent-open-failure", errorPath);
        }
    }
    fail("parent-changed", errorPath);
}
async function openResourceParent(root, resourcePath, errorPath) {
    try {
        return await RootedResourceParentHandle.open(root, resourcePath, errorPath);
    }
    catch (error) {
        if (error instanceof RootedResourceParentHandleError) {
            mapParentHandleError(error, "open", errorPath);
        }
        throw error;
    }
}
async function assertParentCurrent(parent, errorPath, afterCommit = false) {
    try {
        await parent.assertCurrent();
    }
    catch (error) {
        if (error instanceof RootedResourceParentHandleError) {
            if (afterCommit)
                fail("commit-uncertain", errorPath);
            mapParentHandleError(error, "current", errorPath);
        }
        throw error;
    }
}
async function inspectParentTarget(parent, errorPath, reason) {
    try {
        return await parent.inspectTarget();
    }
    catch (error) {
        if (error instanceof RootedResourceParentHandleError) {
            mapParentHandleError(error, "inspect", errorPath, reason);
        }
        throw error;
    }
}
async function syncParent(parent, errorPath) {
    try {
        await parent.sync();
    }
    catch (error) {
        if (error instanceof RootedResourceParentHandleError) {
            mapParentHandleError(error, "sync", errorPath);
        }
        throw error;
    }
}
async function closeParent(parent, errorPath) {
    try {
        await parent.close();
        return undefined;
    }
    catch (error) {
        if (error instanceof RootedResourceParentHandleError) {
            return new DurableRegularFileLinkError(error.reason === "close-failure" ? "close-failure" : "parent-changed", errorPath);
        }
        throw error;
    }
}
function mapExactSourceError(error, operation) {
    if (operation === "sync-after-commit" && error.reason === "sync-failure") {
        fail("durability-failure", "$destinationResourcePath");
    }
    if (operation === "inspect-after-commit"
        || operation === "sync-after-commit") {
        fail("commit-uncertain", "$destinationResourcePath");
    }
    if (operation === "current")
        fail("source-changed", "$sourceResourcePath");
    if (error.reason === "input")
        fail("input", "$sourceResourcePath");
    if (error.reason === "root-scope")
        fail("root-scope", "$sourceResourcePath");
    if (error.reason === "resource-not-found") {
        fail("source-not-found", "$sourceResourcePath");
    }
    if (error.reason === "resource-symlink") {
        fail("source-symlink", "$sourceResourcePath");
    }
    if (error.reason === "resource-kind") {
        fail("source-not-file", "$sourceResourcePath");
    }
    if (error.reason === "resource-open-failure") {
        fail("source-open-failure", "$sourceResourcePath");
    }
    fail("source-changed", "$sourceResourcePath");
}
async function openExactSource(root, resourcePath, expected) {
    try {
        return await RootedExactResourceHandle.openRegularFile(root, resourcePath, expected, "$sourceResourcePath");
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
            return new DurableRegularFileLinkError("close-failure", "$sourceResourcePath");
        }
        throw error;
    }
}
function sameLinkedNode(before, after, expectedLinkCount) {
    return (sameFileNodeIdentity(before, after)
        && before.kind === "file"
        && after.kind === "file"
        && before.rawMode === after.rawMode
        && before.permissionBits === after.permissionBits
        && after.linkCount === expectedLinkCount
        && before.userId === after.userId
        && before.groupId === after.groupId
        && before.specialDeviceId === after.specialDeviceId
        && before.byteCount === after.byteCount
        && before.modifiedAtNanoseconds === after.modifiedAtNanoseconds);
}
async function inspectLinkedPair(source, sourceParent, destinationParent, linkedPairLinkCount) {
    const sourceNode = await inspectParentTarget(sourceParent, "$sourceResourcePath", "commit-uncertain");
    if (sourceNode === null) {
        fail("commit-uncertain", "$destinationResourcePath");
    }
    const destinationNode = await inspectParentTarget(destinationParent, "$destinationResourcePath", "commit-uncertain");
    if (destinationNode === null) {
        fail("commit-uncertain", "$destinationResourcePath");
    }
    const opened = await inspectCommittedSource(source);
    if (!sameLinkedNode(source.initialNodeSnapshot, opened, linkedPairLinkCount)
        || !sameFileNodeSnapshot(opened, sourceNode)
        || !sameFileNodeSnapshot(opened, destinationNode)) {
        fail("commit-uncertain", "$destinationResourcePath");
    }
    return Object.freeze({
        sourceNode,
        destinationNode,
    });
}
/**
 * 为指定的源普通文件持久发布一个不替换目标的硬链接。
 *
 * 成功结果是可由恢复意图观察的链接对；调用方不得把它当成源资源已经移动。
 */
export async function linkRegularFileWithoutReplacement(root, sourceResourcePath, destinationResourcePath, options) {
    assertRoot(root);
    const parsed = parseOptions(options);
    const sourcePath = parseResourcePath(sourceResourcePath, "$sourceResourcePath");
    const destinationPath = parseResourcePath(destinationResourcePath, "$destinationResourcePath");
    if (sourcePath === destinationPath) {
        fail("input", "$destinationResourcePath");
    }
    assertNotAborted(parsed.signal);
    const sourceParent = await openResourceParent(root, sourcePath, "$sourceResourcePath");
    let destinationParent;
    let source;
    let primaryError;
    let result;
    try {
        destinationParent = await openResourceParent(root, destinationPath, "$destinationResourcePath");
        source = await openExactSource(root, sourcePath, parsed.expectedSourceNode);
        if (source.resourceAbsolutePath !== sourceParent.resourceAbsolutePath) {
            fail("root-scope", "$sourceResourcePath");
        }
        if (source.initialNodeSnapshot.deviceId
            !== destinationParent.parentDeviceId) {
            fail("cross-device", "$destinationResourcePath");
        }
        if (await inspectParentTarget(destinationParent, "$destinationResourcePath", "destination-inspection-failure") !== null) {
            fail("destination-exists", "$destinationResourcePath");
        }
        await assertParentCurrent(sourceParent, "$sourceResourcePath");
        await assertParentCurrent(destinationParent, "$destinationResourcePath");
        await assertSourceCurrent(source);
        if (await inspectParentTarget(destinationParent, "$destinationResourcePath", "destination-inspection-failure") !== null) {
            fail("destination-exists", "$destinationResourcePath");
        }
        assertNotAborted(parsed.signal);
        try {
            await link(sourceParent.resourceAbsolutePath, destinationParent.resourceAbsolutePath);
        }
        catch (error) {
            const code = readNodeSystemErrorCode(error);
            if (code === "EEXIST")
                fail("destination-exists", "$destinationResourcePath");
            if (code === "EXDEV")
                fail("cross-device", "$destinationResourcePath");
            fail("link-failure", "$destinationResourcePath");
        }
        const nodeBefore = source.initialNodeSnapshot;
        const linkedPairLinkCount = nodeBefore.linkCount + 1n;
        const linked = await inspectLinkedPair(source, sourceParent, destinationParent, linkedPairLinkCount);
        await syncCommittedSource(source);
        await syncParent(destinationParent, "$destinationResourcePath");
        await assertParentCurrent(sourceParent, "$sourceResourcePath", true);
        await assertParentCurrent(destinationParent, "$destinationResourcePath", true);
        const final = await inspectLinkedPair(source, sourceParent, destinationParent, linkedPairLinkCount);
        if (!sameFileNodeSnapshot(linked.sourceNode, final.sourceNode)
            || !sameFileNodeSnapshot(linked.destinationNode, final.destinationNode)) {
            fail("commit-uncertain", "$destinationResourcePath");
        }
        result = Object.freeze({
            sourceResourcePath: sourcePath,
            destinationResourcePath: destinationPath,
            sourceNode: final.sourceNode,
            destinationNode: final.destinationNode,
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
    if (destinationParent !== undefined) {
        const closeError = await closeParent(destinationParent, "$destinationResourcePath");
        if (primaryError === undefined && closeError !== undefined) {
            primaryError = closeError;
        }
    }
    const sourceParentCloseError = await closeParent(sourceParent, "$sourceResourcePath");
    if (primaryError === undefined && sourceParentCloseError !== undefined) {
        primaryError = sourceParentCloseError;
    }
    if (primaryError !== undefined)
        throw primaryError;
    if (result === undefined) {
        fail("commit-uncertain", "$destinationResourcePath");
    }
    return result;
}
