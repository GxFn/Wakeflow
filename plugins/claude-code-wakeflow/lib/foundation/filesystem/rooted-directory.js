import { types } from "node:util";
import { constants as fileSystemConstants } from "node:fs";
import { lstat, open as openFileHandle, realpath } from "node:fs/promises";
import nodePath from "node:path";
import { PassiveOwnDataError, parsePlainRecord } from "../data/passive-own-data.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import { createFileNodeSnapshot, FileNodeSnapshotError, sameFileNodeIdentity, } from "./file-node-snapshot.js";
import { PortableResourcePathError, splitPortableResourcePath, } from "./portable-resource-path.js";
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
    closed: "Rooted directory is already closed.",
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
    constructor(reason, path, options) {
        super(ERROR_MESSAGES[reason], options);
        this.reason = reason;
        this.path = path;
    }
}
// biome-ignore lint/suspicious/noControlCharactersInRegex: the pattern exists to reject control characters in paths
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
function normalizeErrorPath(value, fallback) {
    return typeof value === "string" && value.length > 0 ? value : fallback;
}
function fail(reason, path, cause) {
    throw new RootedDirectoryError(reason, path, cause === undefined ? undefined : { cause });
}
function normalizeRootPath(value, errorPath) {
    if (typeof value !== "string" ||
        value.length === 0 ||
        value !== value.trim() ||
        !value.isWellFormed() ||
        CONTROL_PATTERN.test(value) ||
        !nodePath.isAbsolute(value) ||
        nodePath.resolve(value) !== value ||
        nodePath.parse(value).root === value) {
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
            fail("root-input", errorPath, error);
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
            fail("inspection-failure", errorPath, error);
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
            fail(missingReason, errorPath, error);
        }
        fail("inspection-failure", errorPath, error);
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
            fail(changedReason, errorPath, error);
        }
        fail("inspection-failure", errorPath, error);
    }
    if (canonical !== physicalPath)
        fail(aliasReason, errorPath);
}
/** `physicalPath` 的父目录存在并且就是它的规范路径；不存在或看不了都算不是，由逐级检查下结论。 */
async function isCanonicalDirectory(physicalPath) {
    const parent = nodePath.dirname(physicalPath);
    try {
        return (await realpath(parent)) === parent;
    }
    catch {
        return false;
    }
}
async function resolveCanonicalRootPath(physicalPath, errorPath) {
    try {
        return await realpath(physicalPath);
    }
    catch (error) {
        if (readNodeSystemErrorCode(error) === "ENOENT") {
            fail("root-changed", errorPath, error);
        }
        fail("inspection-failure", errorPath, error);
    }
}
function resourcePhysicalPath(rootPath, segments, errorPath) {
    const candidate = nodePath.join(rootPath, ...segments);
    const relative = nodePath.relative(rootPath, candidate);
    if (relative.length === 0 ||
        nodePath.isAbsolute(relative) ||
        relative === ".." ||
        relative.startsWith(`..${nodePath.sep}`)) {
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
        if (canonicalBefore.kind !== "directory" || !sameFileNodeIdentity(before, canonicalBefore)) {
            fail("root-changed", path);
        }
        const flags = requiredOpenFlags(path);
        let handle;
        try {
            handle = await openFileHandle(canonicalRootPath, flags);
        }
        catch (error) {
            const code = readNodeSystemErrorCode(error);
            if (code === "ELOOP")
                fail("root-symlink", path, error);
            if (code === "ENOENT")
                fail("root-changed", path, error);
            fail("root-open-failure", path, error);
        }
        try {
            const opened = snapshotNode(await handle.stat({ bigint: true }), path);
            const after = await inspectPathNode(canonicalRootPath, path, "root-changed");
            await inspectCanonicalPath(canonicalRootPath, path, "root-alias", "root-changed");
            if (opened.kind !== "directory" ||
                after.kind !== "directory" ||
                !sameFileNodeIdentity(canonicalBefore, opened) ||
                !sameFileNodeIdentity(opened, after)) {
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
            fail("root-changed", path, error);
        }
        const current = await inspectPathNode(this.#absolutePath, path, "root-changed");
        if (current.kind === "symbolic-link")
            fail("root-changed", path);
        if (current.kind !== "directory" || opened.kind !== "directory") {
            fail("root-changed", path);
        }
        await inspectCanonicalPath(this.#absolutePath, path, "root-alias", "root-changed");
        if (!sameFileNodeIdentity(this.#initialSnapshot, opened) ||
            !sameFileNodeIdentity(opened, current)) {
            fail("root-changed", path);
        }
        return current;
    }
    /**
     * 检查一个已存在资源，不跟随最终符号链接：看一次节点，取一次规范路径（1.4.2）。
     *
     * 规范路径必须等于请求的路径：路径上任何一级是符号链接，或者名字只是大小写、Unicode 归一化不同的
     * 别名，都在这里被拒绝。最终段是符号链接时取的是它父目录的规范路径，链接本身不跟随，交给调用方按
     * 自己的节点策略处理。拒绝的原因与以前相同（`ancestor-symlink`、`ancestor-type`、`resource-alias`）：
     * 只在这两步有一步不过的时候才逐段看一遍，说出是哪一种。目标不在时另确认一次父目录的规范路径，
     * 父目录不是规范路径（或也不在）同样逐段看一遍：隔着符号链接祖先的"不在"不算数。
     *
     * 不再做的（1.4.1 及之前每次检查都做）：逐段各看一遍、整条路径再走第二遍核对每一级还是同一个节点；
     * 每次检查前后各确认一次根目录没有被换。所以一次检查的过程中某一级目录被换掉、或一次操作中途整个
     * 根被换掉，这里不再发现；根的身份只在打开根时与显式调用 `assertCurrent` 时核对。读的过程中文件
     * 被改写仍由读取方在句柄上读前读后比对发现，不靠这里。
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
                fail("resource-path", path, error);
            throw error;
        }
        const physicalPath = resourcePhysicalPath(this.#absolutePath, segments, path);
        try {
            const node = await inspectPathNode(physicalPath, path, "resource-not-found");
            await inspectCanonicalPath(node.kind === "symbolic-link" ? nodePath.dirname(physicalPath) : physicalPath, path, "resource-alias", "resource-changed");
            return Object.freeze({ resourcePath, physicalPath, node });
        }
        catch (error) {
            if (error instanceof RootedDirectoryError) {
                // 目标"不在"只在它的父目录是规范路径时才成立：隔着一个符号链接祖先看过去的"不在"照旧拒绝。
                const suspect = error.reason === "resource-alias" ||
                    error.reason === "inspection-failure" ||
                    (error.reason === "resource-not-found" && !(await isCanonicalDirectory(physicalPath)));
                if (suspect)
                    await this.#nameFailingAncestor(segments, path);
            }
            throw error;
        }
    }
    /**
     * 只在检查失败之后调用：从根往下逐级看中间目录，第一处不对的按它的种类报出来。都对就返回，由调用方
     * 抛出原来的错误。
     */
    async #nameFailingAncestor(segments, path) {
        let current = this.#absolutePath;
        for (const segment of segments.slice(0, -1)) {
            current = nodePath.join(current, segment);
            let node;
            try {
                node = await inspectPathNode(current, path, "resource-not-found");
            }
            catch {
                return;
            }
            if (node.kind === "symbolic-link")
                fail("ancestor-symlink", path);
            if (node.kind !== "directory")
                fail("ancestor-type", path);
            await inspectCanonicalPath(current, path, "resource-alias", "resource-changed");
        }
    }
    /** 幂等关闭根目录句柄；关闭后所有文件系统操作都会稳定拒绝。 */
    async close() {
        if (this.#closed)
            return;
        this.#closed = true;
        try {
            await this.#handle.close();
        }
        catch (cause) {
            fail("close-failure", "$root", cause);
        }
    }
    async [Symbol.asyncDispose]() {
        await this.close();
    }
}
/**
 * 一个真的 RootedDirectory：对象、不是 Proxy、是本类的实例（open-items L4）。三十一个模块的 `assertRoot`
 * 此前各自内联这四项判断；它们现在各留一行，判断在这里。
 */
export function isRootedDirectory(value) {
    return (typeof value === "object" &&
        value !== null &&
        !types.isProxy(value) &&
        value instanceof RootedDirectory);
}
