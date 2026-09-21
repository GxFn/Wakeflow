import { lstat } from "node:fs/promises";
import nodePath from "node:path";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import { createFileNodeSnapshot, FileNodeSnapshotError, } from "./file-node-snapshot.js";
import { RootedDirectory, RootedDirectoryError, } from "./rooted-directory.js";
const ERROR_MESSAGES = {
    "input": "Absolute directory placement input is invalid.",
    "symlink": "Absolute directory placement contains a symbolic link.",
    "not-directory": "Absolute directory placement contains a non-directory node.",
    "inspection-failure": "Absolute directory placement could not be inspected safely.",
};
/** 绝对目录位置观察失败时返回的稳定、脱敏错误。 */
export class AbsoluteDirectoryPlacementError extends Error {
    name = "AbsoluteDirectoryPlacementError";
    code = "wakeflow-absolute-directory-placement";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
function fail(reason, path) {
    throw new AbsoluteDirectoryPlacementError(reason, path);
}
function normalizeErrorPath(value) {
    return typeof value === "string" && value.length > 0 ? value : "$directory";
}
function parseAbsolutePath(value, path) {
    if (typeof value !== "string"
        || value.length === 0
        || value !== value.trim()
        || !value.isWellFormed()
        || CONTROL_PATTERN.test(value)
        || !nodePath.isAbsolute(value)
        || nodePath.resolve(value) !== value
        || nodePath.parse(value).root === value) {
        fail("input", path);
    }
    return value;
}
function snapshotDirectoryNode(stats, path) {
    let node;
    try {
        node = createFileNodeSnapshot(stats, path);
    }
    catch (error) {
        if (error instanceof FileNodeSnapshotError) {
            fail("inspection-failure", path);
        }
        throw error;
    }
    if (node.kind === "symbolic-link")
        fail("symlink", path);
    if (node.kind !== "directory")
        fail("not-directory", path);
    return node;
}
async function inspectOnePath(physicalPath, errorPath) {
    let stats;
    try {
        stats = await lstat(physicalPath, { bigint: true });
    }
    catch (error) {
        if (readNodeSystemErrorCode(error) === "ENOENT")
            return null;
        fail("inspection-failure", errorPath);
    }
    return snapshotDirectoryNode(stats, errorPath);
}
function mapRootError(error, path) {
    if (error.reason === "root-input")
        fail("input", path);
    if (error.reason === "root-symlink")
        fail("symlink", path);
    if (error.reason === "root-type")
        fail("not-directory", path);
    fail("inspection-failure", path);
}
/**
 * 通过已打开目录句柄固定最终节点，并在关闭前复验路径名仍指向同一节点。
 *
 * 前面的逐段 `lstat` 负责拒绝路径链中的符号链接；这里复用 `RootedDirectory`，避免
 * 把一次较早的路径快照与另一次较晚的 `realpath` 结果拼成并不一致的观察。
 */
async function inspectStablePresentDirectory(absolutePath, path) {
    let root;
    try {
        root = await RootedDirectory.open(absolutePath, path);
    }
    catch (error) {
        if (error instanceof RootedDirectoryError)
            mapRootError(error, path);
        throw error;
    }
    let node;
    let primaryError;
    try {
        node = await root.assertCurrent(path);
    }
    catch (error) {
        primaryError = error;
    }
    let closeError;
    try {
        await root.close();
    }
    catch (error) {
        closeError = error;
    }
    if (primaryError !== undefined) {
        if (primaryError instanceof RootedDirectoryError) {
            mapRootError(primaryError, path);
        }
        throw primaryError;
    }
    if (closeError !== undefined || node === undefined) {
        fail("inspection-failure", path);
    }
    return Object.freeze({ realPath: root.absolutePath, node });
}
/**
 * 观察一个规范绝对目录位置。
 *
 * `missing` 表示首个不存在路径段之后的整个目标尚未创建；它不是错误。结果为
 * `present` 时，`spellingIsCanonical` 明确告诉领域层，调用方给出的路径拼写是否等于
 * 文件系统真实路径；结果为`missing`时，最近已存在祖先提供同等的稳定拼写事实。
 */
export async function inspectAbsoluteDirectoryPlacement(value, errorPath) {
    const path = normalizeErrorPath(errorPath);
    const absolutePath = parseAbsolutePath(value, path);
    const parsed = nodePath.parse(absolutePath);
    const relative = nodePath.relative(parsed.root, absolutePath);
    const segments = relative.split(nodePath.sep).filter((segment) => segment.length > 0);
    let current = parsed.root;
    let nearestExistingPath = parsed.root;
    let finalNode = null;
    for (const segment of segments) {
        current = nodePath.join(current, segment);
        finalNode = await inspectOnePath(current, path);
        if (finalNode === null) {
            let nearestExistingAncestor = null;
            if (nearestExistingPath !== parsed.root) {
                const stableAncestor = await inspectStablePresentDirectory(nearestExistingPath, path);
                nearestExistingAncestor = Object.freeze({
                    absolutePath: nearestExistingPath,
                    realPath: stableAncestor.realPath,
                    spellingIsCanonical: stableAncestor.realPath === nearestExistingPath,
                    node: stableAncestor.node,
                });
            }
            return Object.freeze({
                absolutePath,
                state: "missing",
                realPath: null,
                spellingIsCanonical: null,
                node: null,
                nearestExistingAncestor,
            });
        }
        nearestExistingPath = current;
    }
    if (finalNode === null)
        fail("input", path);
    const stable = await inspectStablePresentDirectory(absolutePath, path);
    return Object.freeze({
        absolutePath,
        state: "present",
        realPath: stable.realPath,
        spellingIsCanonical: stable.realPath === absolutePath,
        node: stable.node,
        nearestExistingAncestor: null,
    });
}
