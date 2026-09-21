import { constants as fileSystemConstants } from "node:fs";
import { lstat, open as openFileHandle, } from "node:fs/promises";
import nodePath from "node:path";
import { types } from "node:util";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import { createFileNodeSnapshot, FileNodeSnapshotError, sameFileNodeIdentity, } from "./file-node-snapshot.js";
import { parsePortableResourcePath, PortableResourcePathError, splitPortableResourcePath, } from "./portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError, } from "./rooted-directory.js";
const ERROR_MESSAGES = {
    "input": "Rooted resource parent handle input is invalid.",
    "root-scope": "Rooted resource parent could not establish its root scope.",
    "parent-not-found": "Rooted resource parent directory does not exist.",
    "parent-symlink": "Rooted resource parent chain cannot contain a symbolic link.",
    "parent-not-directory": "Rooted resource parent must be a directory.",
    "parent-open-failure": "Rooted resource parent could not be opened safely.",
    "parent-changed": "Rooted resource parent no longer names the opened directory.",
    "target-inspection-failure": "Rooted resource target could not be inspected safely.",
    "sync-failure": "Rooted resource parent could not be synchronized safely.",
    "closed": "Rooted resource parent handle is already closed.",
    "close-failure": "Rooted resource parent handle could not be closed safely.",
};
/**
 * RootedResourceParentHandle 的稳定错误。
 *
 * 错误不回显根目录、资源、父目录、目标绝对路径、节点元数据、系统调用或原因链。
 */
export class RootedResourceParentHandleError extends Error {
    name = "RootedResourceParentHandleError";
    code = "wakeflow-rooted-resource-parent-handle";
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
    throw new RootedResourceParentHandleError(reason, path);
}
function assertRoot(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        fail("input", "$root");
    }
}
function parseAddress(resourcePath, errorPath) {
    let segments;
    try {
        segments = splitPortableResourcePath(resourcePath, errorPath);
    }
    catch (error) {
        if (error instanceof PortableResourcePathError)
            fail("input", errorPath);
        throw error;
    }
    const resourceName = segments.at(-1);
    if (resourceName === undefined)
        fail("input", errorPath);
    let parentResourcePath = null;
    if (segments.length > 1) {
        try {
            parentResourcePath = parsePortableResourcePath(segments.slice(0, -1).join("/"), errorPath);
        }
        catch (error) {
            if (error instanceof PortableResourcePathError)
                fail("input", errorPath);
            throw error;
        }
    }
    return Object.freeze({ parentResourcePath, resourceName });
}
function requiredOpenFlags() {
    const directory = fileSystemConstants.O_DIRECTORY;
    const noFollow = fileSystemConstants.O_NOFOLLOW;
    if (typeof directory !== "number" || typeof noFollow !== "number") {
        fail("root-scope", "$root");
    }
    return fileSystemConstants.O_RDONLY | directory | noFollow;
}
function snapshotNode(value, reason, errorPath) {
    try {
        return createFileNodeSnapshot(value, errorPath);
    }
    catch (error) {
        if (error instanceof FileNodeSnapshotError)
            fail(reason, errorPath);
        throw error;
    }
}
async function inspectInitialParent(root, address, errorPath) {
    if (address.parentResourcePath === null) {
        try {
            return Object.freeze({
                absolutePath: root.absolutePath,
                node: await root.assertCurrent("$root"),
            });
        }
        catch (error) {
            if (error instanceof RootedDirectoryError)
                fail("root-scope", "$root");
            throw error;
        }
    }
    let parent;
    try {
        parent = await root.inspectExistingResource(address.parentResourcePath, errorPath);
    }
    catch (error) {
        if (error instanceof RootedDirectoryError) {
            if (error.reason === "resource-not-found") {
                fail("parent-not-found", errorPath);
            }
            if (error.reason === "ancestor-symlink") {
                fail("parent-symlink", errorPath);
            }
            if (error.reason === "ancestor-type") {
                fail("parent-not-directory", errorPath);
            }
            if (error.reason === "resource-changed"
                || error.reason === "resource-alias") {
                fail("parent-changed", errorPath);
            }
            if (error.reason === "resource-path")
                fail("input", errorPath);
            fail("root-scope", errorPath);
        }
        throw error;
    }
    if (parent.node.kind === "symbolic-link") {
        fail("parent-symlink", errorPath);
    }
    if (parent.node.kind !== "directory") {
        fail("parent-not-directory", errorPath);
    }
    return Object.freeze({ absolutePath: parent.physicalPath, node: parent.node });
}
/**
 * 已打开父目录的资源地址能力。
 *
 * static open 是唯一构造入口。实例拥有 FileHandle，调用方必须 close 或使用
 * `await using`；关闭后所有 I/O 方法稳定失败。
 */
export class RootedResourceParentHandle {
    #root;
    #parentResourcePath;
    #parentAbsolutePath;
    #resourceAbsolutePath;
    #initialParentSnapshot;
    #handle;
    #errorPath;
    #closed = false;
    constructor(root, address, parent, opened, handle, errorPath) {
        this.#root = root;
        this.#parentResourcePath = address.parentResourcePath;
        this.#parentAbsolutePath = parent.absolutePath;
        this.#resourceAbsolutePath = nodePath.join(parent.absolutePath, address.resourceName);
        this.#initialParentSnapshot = opened;
        this.#handle = handle;
        this.#errorPath = errorPath;
    }
    /** 打开资源在根级或嵌套层级中的真实父目录。 */
    static async open(root, resourcePath, errorPath) {
        assertRoot(root);
        const path = normalizeErrorPath(errorPath);
        const address = parseAddress(resourcePath, path);
        const parent = await inspectInitialParent(root, address, path);
        const flags = requiredOpenFlags();
        let handle;
        try {
            handle = await openFileHandle(parent.absolutePath, flags);
        }
        catch (error) {
            const code = readNodeSystemErrorCode(error);
            if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
                fail("parent-changed", path);
            }
            fail("parent-open-failure", path);
        }
        try {
            const opened = snapshotNode(await handle.stat({ bigint: true }), "parent-changed", path);
            if (opened.kind !== "directory"
                || !sameFileNodeIdentity(parent.node, opened)) {
                fail("parent-changed", path);
            }
            const result = new RootedResourceParentHandle(root, address, parent, opened, handle, path);
            await result.assertCurrent();
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
    /** `null` 明确表示 `RootedDirectory` 自身就是父目录。 */
    get parentResourcePath() {
        return this.#parentResourcePath;
    }
    /** 仅供进程内 foundation I/O；禁止持久化或诊断输出。 */
    get parentAbsolutePath() {
        return this.#parentAbsolutePath;
    }
    /** 仅供进程内 Foundation I/O 使用；目标可以尚不存在。 */
    get resourceAbsolutePath() {
        return this.#resourceAbsolutePath;
    }
    /** 打开时观察到的父目录设备号，只用于同文件系统操作预检。 */
    get parentDeviceId() {
        return this.#initialParentSnapshot.deviceId;
    }
    #assertOpen() {
        if (this.#closed)
            fail("closed", this.#errorPath);
    }
    async #inspectParentPath() {
        try {
            if (this.#parentResourcePath === null) {
                return await this.#root.assertCurrent("$root");
            }
            return (await this.#root.inspectExistingResource(this.#parentResourcePath, this.#errorPath)).node;
        }
        catch (error) {
            if (error instanceof RootedDirectoryError) {
                fail("parent-changed", this.#errorPath);
            }
            throw error;
        }
    }
    /** 证明父目录路径名、已打开句柄和初始父目录仍指向同一目录 inode。 */
    async assertCurrent() {
        this.#assertOpen();
        const pathNode = await this.#inspectParentPath();
        let opened;
        try {
            opened = snapshotNode(await this.#handle.stat({ bigint: true }), "parent-changed", this.#errorPath);
        }
        catch (error) {
            if (error instanceof RootedResourceParentHandleError)
                throw error;
            fail("parent-changed", this.#errorPath);
        }
        if (pathNode.kind !== "directory"
            || opened.kind !== "directory"
            || !sameFileNodeIdentity(this.#initialParentSnapshot, opened)
            || !sameFileNodeIdentity(opened, pathNode)) {
            fail("parent-changed", this.#errorPath);
        }
        return pathNode;
    }
    /**
     * 不跟随符号链接地观察当前目标；目标不存在时返回 `null`。
     *
     * 在 `lstat` 前后都会复验父目录；目标允许的节点类型继续由调用方判断。
     */
    async inspectTarget() {
        this.#assertOpen();
        await this.assertCurrent();
        let target;
        try {
            target = snapshotNode(await lstat(this.#resourceAbsolutePath, { bigint: true }), "target-inspection-failure", this.#errorPath);
        }
        catch (error) {
            if (readNodeSystemErrorCode(error) === "ENOENT")
                target = null;
            else if (error instanceof RootedResourceParentHandleError)
                throw error;
            else
                fail("target-inspection-failure", this.#errorPath);
        }
        await this.assertCurrent();
        return target;
    }
    /**
     * 同步父目录项元数据，并在同步前后复验父目录身份。
     *
     * 持久化级别由父目录所属的根决定。根为 `none` 时只跳过 `fsync` 系统调用本身，
     * 同步前后的身份复验、返回的节点事实与失败分类都与 `fsync` 完全一致。
     */
    async sync() {
        this.#assertOpen();
        await this.assertCurrent();
        if (this.#root.durability === "fsync") {
            try {
                await this.#handle.sync();
            }
            catch {
                fail("sync-failure", this.#errorPath);
            }
        }
        return this.assertCurrent();
    }
    /** 幂等关闭父目录句柄；关闭后 I/O 方法都会稳定拒绝调用。 */
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
