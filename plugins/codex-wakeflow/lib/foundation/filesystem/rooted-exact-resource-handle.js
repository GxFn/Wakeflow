import { constants as fileSystemConstants } from "node:fs";
import { open as openFileHandle, } from "node:fs/promises";
import { types } from "node:util";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import { createFileNodeSnapshot, FileNodeSnapshotError, sameFileNodeIdentity, sameFileNodeSnapshot, } from "./file-node-snapshot.js";
import { RootedDirectory, RootedDirectoryError, } from "./rooted-directory.js";
const ERROR_MESSAGES = {
    "input": "Rooted exact resource handle input is invalid.",
    "root-scope": "Rooted exact resource could not establish its root scope.",
    "resource-not-found": "Rooted exact resource does not exist.",
    "resource-symlink": "Rooted exact resource cannot be a symbolic link.",
    "resource-kind": "Rooted exact resource has a disallowed node kind.",
    "resource-open-failure": "Rooted exact resource could not be opened safely.",
    "resource-changed": "Rooted exact resource no longer matches its admission.",
    "sync-failure": "Rooted exact resource could not be synchronized safely.",
    "closed": "Rooted exact resource handle is already closed.",
    "close-failure": "Rooted exact resource handle could not be closed safely.",
};
/**
 * RootedExactResourceHandle 的稳定错误。
 *
 * 错误不回显根目录、资源、绝对路径、预期节点、当前节点、系统调用或原因链。
 */
export class RootedExactResourceHandleError extends Error {
    name = "RootedExactResourceHandleError";
    code = "wakeflow-rooted-exact-resource-handle";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function normalizeErrorPath(value) {
    return typeof value === "string" && value.length > 0
        ? value
        : "$resourcePath";
}
function fail(reason, path) {
    throw new RootedExactResourceHandleError(reason, path);
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
        fail("input", "$expectedNode");
    }
    try {
        if (!sameFileNodeSnapshot(value, value)) {
            fail("input", "$expectedNode");
        }
    }
    catch (error) {
        if (error instanceof FileNodeSnapshotError) {
            fail("input", "$expectedNode");
        }
        throw error;
    }
    return value;
}
function admitResourceKind(node, admission, errorPath) {
    if (node.kind === "symbolic-link") {
        fail("resource-symlink", errorPath);
    }
    if (admission === "regular-file") {
        if (node.kind !== "file")
            fail("resource-kind", errorPath);
        return "file";
    }
    if (node.kind !== "file" && node.kind !== "directory") {
        fail("resource-kind", errorPath);
    }
    return node.kind;
}
function requiredOpenFlags(kind, errorPath) {
    const noFollow = fileSystemConstants.O_NOFOLLOW;
    if (typeof noFollow !== "number")
        fail("root-scope", errorPath);
    const nonBlocking = typeof fileSystemConstants.O_NONBLOCK === "number"
        ? fileSystemConstants.O_NONBLOCK
        : 0;
    let directory = 0;
    if (kind === "directory") {
        const value = fileSystemConstants.O_DIRECTORY;
        if (typeof value !== "number")
            fail("root-scope", errorPath);
        directory = value;
    }
    return fileSystemConstants.O_RDONLY | noFollow | nonBlocking | directory;
}
function snapshotOpenedHandle(value, errorPath) {
    try {
        return createFileNodeSnapshot(value, errorPath);
    }
    catch (error) {
        if (error instanceof FileNodeSnapshotError) {
            fail("resource-changed", errorPath);
        }
        throw error;
    }
}
async function inspectInitialResource(root, resourcePath, expectedNode, admission, errorPath) {
    let resource;
    try {
        resource = await root.inspectExistingResource(resourcePath, errorPath);
    }
    catch (error) {
        if (error instanceof RootedDirectoryError) {
            if (error.reason === "resource-path")
                fail("input", errorPath);
            if (error.reason === "resource-not-found") {
                fail("resource-not-found", errorPath);
            }
            if (error.reason === "resource-changed") {
                fail("resource-changed", errorPath);
            }
            if (error.reason === "resource-alias") {
                fail("resource-changed", errorPath);
            }
            fail("root-scope", errorPath);
        }
        throw error;
    }
    const kind = admitResourceKind(resource.node, admission, errorPath);
    if (!sameFileNodeSnapshot(resource.node, expectedNode)) {
        fail("resource-changed", errorPath);
    }
    return Object.freeze({ resource, kind });
}
/**
 * 已打开指定资源的进程内能力。
 *
 * static factory 是唯一构造入口。实例拥有 FileHandle，调用方必须显式 close；
 * `await using` 只适用于不需要自定义首错权威的简单作用域。
 */
export class RootedExactResourceHandle {
    #root;
    #resourcePath;
    #resourceAbsolutePath;
    #initialNodeSnapshot;
    #kind;
    #handle;
    #errorPath;
    #closed = false;
    constructor(root, resource, kind, handle, errorPath) {
        this.#root = root;
        this.#resourcePath = resource.resourcePath;
        this.#resourceAbsolutePath = resource.physicalPath;
        this.#initialNodeSnapshot = resource.node;
        this.#kind = kind;
        this.#handle = handle;
        this.#errorPath = errorPath;
    }
    /** 打开仍与指定预期一致的真实普通文件。 */
    static async openRegularFile(root, resourcePath, expectedNode, errorPath) {
        return RootedExactResourceHandle.#open(root, resourcePath, expectedNode, "regular-file", errorPath);
    }
    /** 打开仍与指定预期一致的真实普通文件或目录。 */
    static async openFileOrDirectory(root, resourcePath, expectedNode, errorPath) {
        return RootedExactResourceHandle.#open(root, resourcePath, expectedNode, "file-or-directory", errorPath);
    }
    static async #open(root, resourcePath, expectedNode, admission, requestedErrorPath) {
        assertRoot(root);
        const errorPath = normalizeErrorPath(requestedErrorPath);
        const expected = parseExpectedNode(expectedNode);
        const initial = await inspectInitialResource(root, resourcePath, expected, admission, errorPath);
        const flags = requiredOpenFlags(initial.kind, errorPath);
        let handle;
        try {
            handle = await openFileHandle(initial.resource.physicalPath, flags);
        }
        catch (error) {
            const code = readNodeSystemErrorCode(error);
            if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
                fail("resource-changed", errorPath);
            }
            fail("resource-open-failure", errorPath);
        }
        try {
            const opened = snapshotOpenedHandle(await handle.stat({ bigint: true }), errorPath);
            if (opened.kind !== initial.kind
                || !sameFileNodeSnapshot(initial.resource.node, opened)) {
                fail("resource-changed", errorPath);
            }
            const result = new RootedExactResourceHandle(root, initial.resource, initial.kind, handle, errorPath);
            await result.assertPathCurrent();
            return result;
        }
        catch (error) {
            try {
                await handle.close();
            }
            catch {
                // 未签发句柄时保留首个准入错误，不再生成第二个公共错误。
            }
            throw error;
        }
    }
    /** 仅供进程内 foundation I/O；禁止持久化或诊断输出。 */
    get resourceAbsolutePath() {
        return this.#resourceAbsolutePath;
    }
    /** 精确准入时的完整节点基准，不是当前元数据缓存。 */
    get initialNodeSnapshot() {
        return this.#initialNodeSnapshot;
    }
    get kind() {
        return this.#kind;
    }
    #assertOpen() {
        if (this.#closed)
            fail("closed", this.#errorPath);
    }
    /**
     * 观察当前打开的 inode；pathname 已 rename/unlink 后仍可使用。
     *
     * 本方法只固定节点类型、设备号和 inode，不定义链接数、权限位、大小或时间变化策略。
     */
    async inspectOpenedNode() {
        this.#assertOpen();
        let opened;
        try {
            opened = snapshotOpenedHandle(await this.#handle.stat({ bigint: true }), this.#errorPath);
        }
        catch (error) {
            if (error instanceof RootedExactResourceHandleError)
                throw error;
            fail("resource-changed", this.#errorPath);
        }
        if (opened.kind !== this.#kind
            || !sameFileNodeIdentity(this.#initialNodeSnapshot, opened)) {
            fail("resource-changed", this.#errorPath);
        }
        return opened;
    }
    /** 证明提交前路径名、句柄和指定初始快照仍完全一致。 */
    async assertPathCurrent() {
        this.#assertOpen();
        const opened = await this.inspectOpenedNode();
        let pathResource;
        try {
            pathResource = await this.#root.inspectExistingResource(this.#resourcePath, this.#errorPath);
        }
        catch (error) {
            if (error instanceof RootedDirectoryError) {
                fail("resource-changed", this.#errorPath);
            }
            throw error;
        }
        if (pathResource.node.kind !== this.#kind
            || !sameFileNodeSnapshot(this.#initialNodeSnapshot, opened)
            || !sameFileNodeSnapshot(opened, pathResource.node)) {
            fail("resource-changed", this.#errorPath);
        }
        return pathResource.node;
    }
    /**
     * 同步已打开的 inode，并返回同步后的句柄快照；不要求原路径名仍然存在。
     *
     * 持久化级别由资源所属的根决定。根为 `none` 时只跳过 `fsync` 系统调用本身，
     * 同步前后的观察、返回的节点事实与失败分类都与 `fsync` 完全一致。
     */
    async syncOpenedNode() {
        this.#assertOpen();
        await this.inspectOpenedNode();
        if (this.#root.durability === "fsync") {
            try {
                await this.#handle.sync();
            }
            catch {
                fail("sync-failure", this.#errorPath);
            }
        }
        return this.inspectOpenedNode();
    }
    /** 幂等关闭指定资源句柄；关闭后所有 I/O 方法都会稳定拒绝调用。 */
    async close() {
        if (this.#closed)
            return;
        this.#closed = true;
        try {
            await this.#handle.close();
        }
        catch {
            fail("close-failure", this.#errorPath);
        }
    }
    async [Symbol.asyncDispose]() {
        await this.close();
    }
}
