import { constants as fileSystemConstants } from "node:fs";
import { open as openFileHandle } from "node:fs/promises";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import { createFileNodeSnapshot, FileNodeSnapshotError, sameFileNodeIdentity, } from "./file-node-snapshot.js";
import { RootedDirectory, RootedDirectoryError } from "./rooted-directory.js";
/**
 * Wakeflow Foundation / Filesystem：私有节点的模式漂移分类与安全收敛（gate-log §13.124 D8，§13.130）。
 *
 * 私有目录是 0700、私有文件是 0600。"安全漂移"指：当前用户拥有、属主位完整（目录 rwx、文件
 * rw）、group 与 other 都没有写位、没有 setuid / setgid / sticky 位——例如整棵树被
 * `chmod -R go+rX` 之后的 0755 / 0644。把这种节点收回私有模式只会收窄权限，不会放大任何人的
 * 能力。其余一切（符号链接、特殊节点、别人拥有的节点、group 或 other 可写、属主位缺失、特殊位）
 * 都是 unsafe：它可能已被别人改过，本模块只报告，从不修。
 *
 * 收敛一次只处理一个节点：路径观察与调用方的预期是同一 inode、同一模式 → `O_NOFOLLOW` 打开 →
 * 句柄仍是那个节点 → `fchmod` → 复验。已经是私有模式为 `current`（幂等，中断后重跑即可）。
 * 本模块不决定哪些目录是私有的，那是调用方的布局知识。
 */
export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;
const GROUP_OTHER_WRITE = 0o022;
const SPECIAL_BITS = 3584n;
const ERROR_MESSAGES = {
    input: "Private mode convergence input is invalid.",
    "root-scope": "Private mode convergence could not establish its rooted scope.",
    "resource-changed": "Private node no longer matches the observation it was planned from.",
    "resource-unsafe": "Private node is not a safe mode drift and is never converged.",
    "chmod-failure": "Private node mode could not be changed safely.",
    aborted: "Private mode convergence was aborted.",
};
export class PrivateModeConvergenceError extends Error {
    name = "PrivateModeConvergenceError";
    code = "wakeflow-private-mode-convergence";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new PrivateModeConvergenceError(reason, path);
}
function currentUserId() {
    return typeof process.geteuid === "function" ? BigInt(process.geteuid()) : null;
}
/** 目录 0700、文件 0600；其余类型没有私有模式。 */
export function privateModeOf(node) {
    if (node.kind === "directory")
        return PRIVATE_DIRECTORY_MODE;
    if (node.kind === "file")
        return PRIVATE_FILE_MODE;
    return null;
}
/** 按当前进程的用户分类一个节点（没有 geteuid 的平台不核对属主）。 */
export function classifyPrivateNode(node) {
    const target = privateModeOf(node);
    if (target === null)
        return "unsafe";
    const user = currentUserId();
    if (user !== null && node.userId !== user)
        return "unsafe";
    if ((node.rawMode & SPECIAL_BITS) !== 0n)
        return "unsafe";
    const bits = node.permissionBits;
    if (bits === target)
        return "current";
    if ((bits & target) !== target)
        return "unsafe";
    if ((bits & GROUP_OTHER_WRITE) !== 0)
        return "unsafe";
    return "safe-drift";
}
function snapshotOf(value, errorPath) {
    try {
        return createFileNodeSnapshot(value, errorPath);
    }
    catch (error) {
        if (error instanceof FileNodeSnapshotError)
            fail("resource-changed", errorPath);
        throw error;
    }
}
async function statHandle(handle, errorPath) {
    let value;
    try {
        value = await handle.stat({ bigint: true });
    }
    catch {
        fail("resource-changed", errorPath);
    }
    return snapshotOf(value, errorPath);
}
function openFlags(kind, errorPath) {
    const noFollow = fileSystemConstants.O_NOFOLLOW;
    if (typeof noFollow !== "number")
        fail("root-scope", errorPath);
    const nonBlocking = typeof fileSystemConstants.O_NONBLOCK === "number" ? fileSystemConstants.O_NONBLOCK : 0;
    let directory = 0;
    if (kind === "directory") {
        const value = fileSystemConstants.O_DIRECTORY;
        if (typeof value !== "number")
            fail("root-scope", errorPath);
        directory = value;
    }
    return fileSystemConstants.O_RDONLY | noFollow | nonBlocking | directory;
}
async function inspectPath(root, resourcePath, errorPath) {
    try {
        return await root.inspectExistingResource(resourcePath, errorPath);
    }
    catch (error) {
        if (error instanceof RootedDirectoryError) {
            if (error.reason === "resource-path")
                fail("input", errorPath);
            if (error.reason === "resource-not-found" ||
                error.reason === "resource-changed" ||
                error.reason === "resource-alias") {
                fail("resource-changed", errorPath);
            }
            fail("root-scope", errorPath);
        }
        throw error;
    }
}
/**
 * 把一个观察时是安全漂移的节点收回私有模式。`expected` 是规划时的节点快照：路径上的节点必须仍是
 * 同一 inode、同一模式，否则 `resource-changed`（重新规划）。已经是私有模式返回 `current`。
 */
export async function convergePrivateNodeMode(root, resourcePath, expected, options = {}) {
    if (!(root instanceof RootedDirectory))
        fail("input", "$root");
    const errorPath = `$${resourcePath}`;
    if (options.signal?.aborted === true)
        fail("aborted", "$signal");
    const observed = await inspectPath(root, resourcePath, errorPath);
    const observedClass = classifyPrivateNode(observed.node);
    if (observedClass === "current")
        return "current";
    if (!sameFileNodeIdentity(observed.node, expected) ||
        observed.node.permissionBits !== expected.permissionBits ||
        observed.node.kind !== expected.kind) {
        fail("resource-changed", errorPath);
    }
    if (observedClass !== "safe-drift")
        fail("resource-unsafe", errorPath);
    const kind = observed.node.kind === "directory" ? "directory" : "file";
    const target = kind === "directory" ? PRIVATE_DIRECTORY_MODE : PRIVATE_FILE_MODE;
    let handle;
    try {
        handle = await openFileHandle(observed.physicalPath, openFlags(kind, errorPath));
    }
    catch (error) {
        if (error instanceof PrivateModeConvergenceError)
            throw error;
        const code = readNodeSystemErrorCode(error);
        if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
            fail("resource-changed", errorPath);
        }
        fail("chmod-failure", errorPath);
    }
    try {
        const opened = await statHandle(handle, errorPath);
        if (opened.kind !== observed.node.kind ||
            !sameFileNodeIdentity(opened, observed.node) ||
            opened.permissionBits !== observed.node.permissionBits) {
            fail("resource-changed", errorPath);
        }
        try {
            await handle.chmod(target);
        }
        catch {
            fail("chmod-failure", errorPath);
        }
        const hardened = await statHandle(handle, errorPath);
        if (!sameFileNodeIdentity(hardened, observed.node) || hardened.permissionBits !== target) {
            fail("chmod-failure", errorPath);
        }
        if (root.durability === "fsync") {
            try {
                await handle.sync();
            }
            catch {
                fail("chmod-failure", errorPath);
            }
        }
    }
    finally {
        await handle.close().catch(() => undefined);
    }
    return "converged";
}
