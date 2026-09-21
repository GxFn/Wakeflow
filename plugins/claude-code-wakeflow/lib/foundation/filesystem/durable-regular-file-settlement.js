import { types } from "node:util";
import { parsePlainRecord, PassiveOwnDataError, } from "../data/passive-own-data.js";
import { FileNodeSnapshotError, sameFileNodeSnapshot, } from "./file-node-snapshot.js";
import { RootedDirectory } from "./rooted-directory.js";
import { RootedExactResourceHandle, RootedExactResourceHandleError, } from "./rooted-exact-resource-handle.js";
import { RootedResourceParentHandle, RootedResourceParentHandleError, } from "./rooted-resource-parent-handle.js";
const ERROR_MESSAGES = {
    "input": "Durable regular file settlement input is invalid.",
    "root-scope": "Regular file settlement could not establish its rooted scope.",
    "parent-not-found": "Regular file settlement parent directory does not exist.",
    "parent-symlink": "Regular file settlement parent chain cannot contain a symbolic link.",
    "parent-not-directory": "Regular file settlement parent must be a directory.",
    "parent-open-failure": "Regular file settlement parent could not be opened safely.",
    "parent-changed": "Regular file settlement parent changed during the operation.",
    "resource-not-found": "Regular file settlement target does not exist.",
    "resource-symlink": "Regular file settlement target cannot be a symbolic link.",
    "resource-not-file": "Regular file settlement target must be a regular file.",
    "resource-open-failure": "Regular file settlement target could not be opened safely.",
    "resource-changed": "Regular file settlement target no longer matches its expectation.",
    "durability-failure": "Regular file and parent could not be synchronized safely.",
    "commit-uncertain": "Regular file settlement result could not be proven exact.",
    "aborted": "Regular file settlement was aborted before synchronization.",
    "close-failure": "A regular file settlement handle could not be closed safely.",
};
/** 指定普通文件持久性结算失败时返回的稳定、脱敏错误。 */
export class DurableRegularFileSettlementError extends Error {
    name = "DurableRegularFileSettlementError";
    code = "wakeflow-durable-regular-file-settlement";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new DurableRegularFileSettlementError(reason, path);
}
function assertRoot(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        fail("input", "$root");
    }
}
function isAbortSignal(value) {
    return typeof value === "object"
        && value !== null
        && !types.isProxy(value)
        && value instanceof AbortSignal;
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$signal");
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
    const node = value;
    if (node.kind === "file" && node.linkCount < 1n) {
        fail("input", "$options.expectedNode");
    }
    return node;
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
    if (!Object.hasOwn(record, "expectedNode")
        || Object.keys(record).some((key) => key !== "expectedNode" && key !== "signal")) {
        fail("input", "$options");
    }
    if (record.signal !== undefined && !isAbortSignal(record.signal)) {
        fail("input", "$options.signal");
    }
    return Object.freeze({
        expectedNode: parseExpectedNode(record.expectedNode),
        signal: record.signal,
    });
}
function mapParentError(error, operation) {
    if (operation === "sync" && error.reason === "sync-failure") {
        fail("durability-failure", "$resourcePath");
    }
    if (operation === "open") {
        if (error.reason === "input")
            fail("input", "$resourcePath");
        if (error.reason === "root-scope")
            fail("root-scope", "$root");
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
async function openParent(root, resourcePath) {
    try {
        return await RootedResourceParentHandle.open(root, resourcePath, "$resourcePath");
    }
    catch (error) {
        if (error instanceof RootedResourceParentHandleError) {
            mapParentError(error, "open");
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
            mapParentError(error, "current");
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
            mapParentError(error, "sync");
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
            return new DurableRegularFileSettlementError("close-failure", "$resourcePath");
        }
        throw error;
    }
}
function mapResourceError(error, operation) {
    if (operation === "sync" && error.reason === "sync-failure") {
        fail("durability-failure", "$resourcePath");
    }
    if (operation === "settled" || operation === "sync") {
        fail("commit-uncertain", "$resourcePath");
    }
    if (operation === "current")
        fail("resource-changed", "$resourcePath");
    if (error.reason === "input")
        fail("input", "$resourcePath");
    if (error.reason === "root-scope")
        fail("root-scope", "$root");
    if (error.reason === "resource-not-found") {
        fail("resource-not-found", "$resourcePath");
    }
    if (error.reason === "resource-symlink") {
        fail("resource-symlink", "$resourcePath");
    }
    if (error.reason === "resource-kind") {
        fail("resource-not-file", "$resourcePath");
    }
    if (error.reason === "resource-open-failure") {
        fail("resource-open-failure", "$resourcePath");
    }
    fail("resource-changed", "$resourcePath");
}
async function openResource(root, resourcePath, expectedNode) {
    try {
        return await RootedExactResourceHandle.openRegularFile(root, resourcePath, expectedNode, "$resourcePath");
    }
    catch (error) {
        if (error instanceof RootedExactResourceHandleError) {
            mapResourceError(error, "open");
        }
        throw error;
    }
}
async function assertResourceCurrent(resource, operation) {
    try {
        return await resource.assertPathCurrent();
    }
    catch (error) {
        if (error instanceof RootedExactResourceHandleError) {
            mapResourceError(error, operation);
        }
        throw error;
    }
}
async function syncResource(resource) {
    try {
        return await resource.syncOpenedNode();
    }
    catch (error) {
        if (error instanceof RootedExactResourceHandleError) {
            mapResourceError(error, "sync");
        }
        throw error;
    }
}
async function closeResource(resource) {
    try {
        await resource.close();
        return undefined;
    }
    catch (error) {
        if (error instanceof RootedExactResourceHandleError) {
            return new DurableRegularFileSettlementError("close-failure", "$resourcePath");
        }
        throw error;
    }
}
/**
 * 为已经存在且仍与指定预期一致的普通文件补做持久性结算。
 *
 * 取消只在任何同步开始前生效；一旦开始同步文件，本函数会继续完成父目录同步与最终
 * 复验，避免向调用方返回“只同步了 inode、未同步目录项”的不完整成功结果。
 */
export async function settleRegularFileDurability(root, resourcePath, options) {
    assertRoot(root);
    const parsed = parseOptions(options);
    assertNotAborted(parsed.signal);
    const parent = await openParent(root, resourcePath);
    let resource;
    let settled = false;
    let primaryError;
    try {
        resource = await openResource(root, resourcePath, parsed.expectedNode);
        if (resource.resourceAbsolutePath !== parent.resourceAbsolutePath) {
            fail("root-scope", "$resourcePath");
        }
        await assertParentCurrent(parent);
        await assertResourceCurrent(resource, "current");
        assertNotAborted(parsed.signal);
        const syncedNode = await syncResource(resource);
        if (!sameFileNodeSnapshot(parsed.expectedNode, syncedNode)) {
            fail("commit-uncertain", "$resourcePath");
        }
        await syncParent(parent);
        await assertParentCurrent(parent);
        const finalNode = await assertResourceCurrent(resource, "settled");
        if (!sameFileNodeSnapshot(parsed.expectedNode, finalNode)
            || !sameFileNodeSnapshot(syncedNode, finalNode)) {
            fail("commit-uncertain", "$resourcePath");
        }
        settled = true;
    }
    catch (error) {
        primaryError = error;
    }
    if (resource !== undefined) {
        const closeError = await closeResource(resource);
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
    if (!settled)
        fail("commit-uncertain", "$resourcePath");
}
