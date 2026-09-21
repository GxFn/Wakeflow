import { constants as fileSystemConstants, } from "node:fs";
import { lstat, open as openFileHandle, realpath, } from "node:fs/promises";
import nodePath from "node:path";
import { parsePlainRecord, PassiveOwnDataError, } from "../data/passive-own-data.js";
import { createFileNodeSnapshot, FileNodeSnapshotError, sameFileNodeIdentity, sameFileNodeSnapshot, } from "./file-node-snapshot.js";
import { PortableResourcePathError, splitPortableResourcePath, } from "./portable-resource-path.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
const ERROR_MESSAGES = {
    "root-input": "Rooted directory requires one normalized non-root absolute path.",
    "unsupported-platform": "Rooted directory requires Node no-follow directory handles.",
    "root-not-found": "Rooted directory does not exist.",
    "root-symlink": "Rooted directory cannot be a symbolic link.",
    "root-type": "Rooted directory root must be a directory.",
    "root-alias": "Opened rooted directory path now resolves through a physical alias.",
    "root-open-failure": "Rooted directory could not be opened safely.",
    "root-changed": "Rooted directory path no longer names the opened root node.",
    "resource-path": "Rooted resource path is not a valid portable resource path.",
    "resource-not-found": "Rooted resource does not exist.",
    "ancestor-symlink": "Rooted resource contains a symbolic-link ancestor.",
    "ancestor-type": "Rooted resource ancestor is not a directory.",
    "resource-alias": "Rooted resource resolves through a non-canonical path alias.",
    "resource-changed": "Rooted resource changed while it was being inspected.",
    "inspection-failure": "Rooted resource could not be inspected safely.",
    "closed": "Rooted directory is already closed.",
    "close-failure": "Rooted directory handle could not be closed safely.",
};
/**
 * 根作用域文件系统失败的稳定错误。
 *
 * 错误只暴露能力代码、分类和调用方结构路径，不回显物理根目录、资源路径、系统调用、
 * Node.js 错误消息或底层原因。
 */
export class RootedDirectoryError extends Error {
    name = "RootedDirectoryError";
    code = "wakeflow-rooted-directory";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
function normalizeErrorPath(value, fallback) {
    return typeof value === "string" && value.length > 0 ? value : fallback;
}
function fail(reason, path) {
    throw new RootedDirectoryError(reason, path);
}
function normalizeRootPath(value, errorPath) {
    if (typeof value !== "string"
        || value.length === 0
        || value !== value.trim()
        || !value.isWellFormed()
        || CONTROL_PATTERN.test(value)
        || !nodePath.isAbsolute(value)
        || nodePath.resolve(value) !== value
        || nodePath.parse(value).root === value) {
        fail("root-input", errorPath);
    }
    return value;
}
/**
 * 打开选项与本文件族其余解析器走同一条准入：`parsePlainRecord` 负责拒绝代理、
 * 非普通原型（数组正是靠这一条被拒）、符号键与访问器，这里只判定本能力的字段。
 */
function normalizeDurability(value, errorPath) {
    if (value === undefined)
        return "fsync";
    let record;
    try {
        record = parsePlainRecord(value, errorPath);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("root-input", errorPath);
        throw error;
    }
    if (Object.keys(record).some((key) => key !== "durability")) {
        fail("root-input", errorPath);
    }
    const durability = record.durability;
    if (durability === undefined)
        return "fsync";
    if (durability !== "fsync" && durability !== "none") {
        fail("root-input", errorPath);
    }
    return durability;
}
function requiredOpenFlags(errorPath) {
    const directory = fileSystemConstants.O_DIRECTORY;
    const noFollow = fileSystemConstants.O_NOFOLLOW;
    if (typeof directory !== "number" || typeof noFollow !== "number") {
        fail("unsupported-platform", errorPath);
    }
    return fileSystemConstants.O_RDONLY | directory | noFollow;
}
function snapshotNode(value, errorPath) {
    try {
        return createFileNodeSnapshot(value, errorPath);
    }
    catch (error) {
        if (error instanceof FileNodeSnapshotError) {
            fail("inspection-failure", errorPath);
        }
        throw error;
    }
}
async function inspectPathNode(physicalPath, errorPath, missingReason) {
    let stats;
    try {
        stats = await lstat(physicalPath, { bigint: true });
    }
    catch (error) {
        if (readNodeSystemErrorCode(error) === "ENOENT") {
            fail(missingReason, errorPath);
        }
        fail("inspection-failure", errorPath);
    }
    return snapshotNode(stats, errorPath);
}
async function inspectCanonicalPath(physicalPath, errorPath, aliasReason, changedReason) {
    let canonical;
    try {
        canonical = await realpath(physicalPath);
    }
    catch (error) {
        if (readNodeSystemErrorCode(error) === "ENOENT") {
            fail(changedReason, errorPath);
        }
        fail("inspection-failure", errorPath);
    }
    if (canonical !== physicalPath)
        fail(aliasReason, errorPath);
}
async function resolveCanonicalRootPath(physicalPath, errorPath) {
    try {
        return await realpath(physicalPath);
    }
    catch (error) {
        if (readNodeSystemErrorCode(error) === "ENOENT") {
            fail("root-changed", errorPath);
        }
        fail("inspection-failure", errorPath);
    }
}
function resourcePhysicalPath(rootPath, segments, errorPath) {
    const candidate = nodePath.join(rootPath, ...segments);
    const relative = nodePath.relative(rootPath, candidate);
    if (relative.length === 0
        || nodePath.isAbsolute(relative)
        || relative === ".."
        || relative.startsWith(`..${nodePath.sep}`)) {
        fail("resource-path", errorPath);
    }
    return candidate;
}
/**
 * 已打开且可显式关闭的根目录能力。
 *
 * static open() 是唯一构造入口；实例保存 FileHandle 以检测根 pathname 被 rename
 * 或替换。`absolutePath` 与物理资源结果只供进程内 I/O 组合，不属于持久化表示。
 */
export class RootedDirectory {
    #absolutePath;
    #initialSnapshot;
    #handle;
    #durability;
    #closed = false;
    constructor(absolutePath, initialSnapshot, handle, durability) {
        this.#absolutePath = absolutePath;
        this.#initialSnapshot = initialSnapshot;
        this.#handle = handle;
        this.#durability = durability;
    }
    /**
     * 打开由规范绝对路径拼写指向的真实目录根。
     *
     * 根节点本身不能是符号链接；受信任路径拼写中的祖先别名会先固定为规范真实路径。
     * 成功前同时核对原始路径拼写、规范路径名、`FileHandle` 与再次观察到的节点身份。
     *
     * 省略 `options` 与传入 `{ durability: "fsync" }` 完全等价；非法的选项形状与
     * 非法根路径一样按 `root-input` 拒绝，不引入第二套准入分类。
     */
    static async open(value, errorPath, options) {
        const path = normalizeErrorPath(errorPath, "$root");
        const durability = normalizeDurability(options, path);
        const absolutePath = normalizeRootPath(value, path);
        const before = await inspectPathNode(absolutePath, path, "root-not-found");
        if (before.kind === "symbolic-link")
            fail("root-symlink", path);
        if (before.kind !== "directory")
            fail("root-type", path);
        const canonicalRootPath = await resolveCanonicalRootPath(absolutePath, path);
        const canonicalBefore = await inspectPathNode(canonicalRootPath, path, "root-changed");
        if (canonicalBefore.kind !== "directory"
            || !sameFileNodeIdentity(before, canonicalBefore)) {
            fail("root-changed", path);
        }
        let handle;
        try {
            handle = await openFileHandle(canonicalRootPath, requiredOpenFlags(path));
        }
        catch (error) {
            const code = readNodeSystemErrorCode(error);
            if (code === "ELOOP")
                fail("root-symlink", path);
            if (code === "ENOENT")
                fail("root-changed", path);
            fail("root-open-failure", path);
        }
        try {
            const opened = snapshotNode(await handle.stat({ bigint: true }), path);
            const after = await inspectPathNode(canonicalRootPath, path, "root-changed");
            await inspectCanonicalPath(canonicalRootPath, path, "root-alias", "root-changed");
            if (opened.kind !== "directory"
                || after.kind !== "directory"
                || !sameFileNodeIdentity(canonicalBefore, opened)
                || !sameFileNodeIdentity(opened, after)) {
                fail("root-changed", path);
            }
            return new RootedDirectory(canonicalRootPath, after, handle, durability);
        }
        catch (error) {
            try {
                await handle.close();
            }
            catch {
                // 保留首个准入错误；未签发的句柄不再生成第二个公共错误。
            }
            throw error;
        }
    }
    /** 进程内规范绝对根目录；调用方不得把它写入可移植数据。 */
    get absolutePath() {
        return this.#absolutePath;
    }
    /**
     * 本次打开范围内的持久化级别；经由本根执行的耐久写入都读取它。
     *
     * 该值在打开时固定，之后不可变更，测试可据此断言自己拿到的是哪一档。
     */
    get durability() {
        return this.#durability;
    }
    #assertOpen(errorPath) {
        if (this.#closed)
            fail("closed", errorPath);
    }
    /**
     * 证明当前路径名、已打开目录句柄和初始根目录仍指向同一设备号和 inode。
     *
     * 返回最新节点快照；目录内容变化引起的 `mtime` 或链接数漂移不会被误判为根目录替换。
     */
    async assertCurrent(errorPath) {
        const path = normalizeErrorPath(errorPath, "$root");
        this.#assertOpen(path);
        let opened;
        try {
            opened = snapshotNode(await this.#handle.stat({ bigint: true }), path);
        }
        catch (error) {
            if (error instanceof RootedDirectoryError)
                throw error;
            fail("root-changed", path);
        }
        const current = await inspectPathNode(this.#absolutePath, path, "root-changed");
        if (current.kind === "symbolic-link")
            fail("root-changed", path);
        if (current.kind !== "directory" || opened.kind !== "directory") {
            fail("root-changed", path);
        }
        await inspectCanonicalPath(this.#absolutePath, path, "root-alias", "root-changed");
        if (!sameFileNodeIdentity(this.#initialSnapshot, opened)
            || !sameFileNodeIdentity(opened, current)) {
            fail("root-changed", path);
        }
        return current;
    }
    /**
     * 逐段检查一个已存在资源，不跟随最终符号链接。
     *
     * 所有中间段必须保持真实目录；最终段可为任意节点类型，供后续稳定读取方、
     * 目录树扫描器或迁移职责所有者再施加自己的节点策略。最终节点是目录时只复验
     * 节点类型、设备号和 inode：合法的同级变更会改变目录修改时间和状态变更时间，
     * 但不表示目录已经被替换。
     */
    async inspectExistingResource(resourcePath, errorPath) {
        const path = normalizeErrorPath(errorPath, "$resourcePath");
        this.#assertOpen(path);
        let segments;
        try {
            segments = splitPortableResourcePath(resourcePath, path);
        }
        catch (error) {
            if (error instanceof PortableResourcePathError)
                fail("resource-path", path);
            throw error;
        }
        await this.assertCurrent("$root");
        const finalPhysicalPath = resourcePhysicalPath(this.#absolutePath, segments, path);
        const entries = [];
        let current = this.#absolutePath;
        for (const [index, segment] of segments.entries()) {
            current = nodePath.join(current, segment);
            const isFinal = index === segments.length - 1;
            const node = await inspectPathNode(current, path, "resource-not-found");
            if (!isFinal && node.kind === "symbolic-link") {
                fail("ancestor-symlink", path);
            }
            if (!isFinal && node.kind !== "directory") {
                fail("ancestor-type", path);
            }
            if (node.kind !== "symbolic-link") {
                await inspectCanonicalPath(current, path, "resource-alias", "resource-changed");
            }
            entries.push(Object.freeze({
                physicalPath: current,
                node,
                isFinal,
            }));
        }
        await this.assertCurrent("$root");
        let finalNode;
        for (const entry of entries) {
            const currentNode = await inspectPathNode(entry.physicalPath, path, "resource-changed");
            if (currentNode.kind !== entry.node.kind
                || !sameFileNodeIdentity(entry.node, currentNode)) {
                fail("resource-changed", path);
            }
            if (!entry.isFinal && currentNode.kind !== "directory") {
                fail("resource-changed", path);
            }
            if (currentNode.kind !== "symbolic-link") {
                await inspectCanonicalPath(entry.physicalPath, path, "resource-alias", "resource-changed");
            }
            if (entry.isFinal) {
                const finalUnchanged = currentNode.kind === "directory"
                    ? sameFileNodeIdentity(entry.node, currentNode)
                    : sameFileNodeSnapshot(entry.node, currentNode);
                if (!finalUnchanged) {
                    fail("resource-changed", path);
                }
                finalNode = currentNode;
            }
        }
        if (finalNode === undefined)
            fail("inspection-failure", path);
        return Object.freeze({
            resourcePath,
            physicalPath: finalPhysicalPath,
            node: finalNode,
        });
    }
    /** 幂等关闭根目录句柄；关闭后所有文件系统操作都会稳定拒绝。 */
    async close() {
        if (this.#closed)
            return;
        this.#closed = true;
        try {
            await this.#handle.close();
        }
        catch {
            fail("close-failure", "$root");
        }
    }
    async [Symbol.asyncDispose]() {
        await this.close();
    }
}
