import { lstat, readFile, realpath, stat } from "node:fs/promises";
import nodePath from "node:path";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import { createFileNodeSnapshot, FileNodeSnapshotError } from "./file-node-snapshot.js";
const ERROR_MESSAGES = {
    "input": "Absolute node observation input is invalid.",
    "inspection-failure": "Absolute node could not be inspected safely.",
    "read-failure": "Absolute regular file could not be read safely.",
};
/** 绝对路径节点观察失败时返回的稳定、脱敏错误；原始异常只留在 `cause` 上。 */
export class AbsoluteNodeObservationError extends Error {
    name = "AbsoluteNodeObservationError";
    code = "wakeflow-absolute-node-observation";
    reason;
    path;
    constructor(reason, path, cause) {
        super(ERROR_MESSAGES[reason], cause === undefined ? undefined : { cause });
        this.reason = reason;
        this.path = path;
    }
}
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
function fail(reason, path, cause) {
    throw new AbsoluteNodeObservationError(reason, path, cause);
}
function normalizeErrorPath(value, fallback) {
    return typeof value === "string" && value.length > 0 ? value : fallback;
}
function parseAbsolutePath(value, path) {
    if (typeof value !== "string"
        || value.length === 0
        || value !== value.trim()
        || !value.isWellFormed()
        || CONTROL_PATTERN.test(value)
        || !nodePath.isAbsolute(value)
        || nodePath.resolve(value) !== value) {
        fail("input", path);
    }
    return value;
}
function isAbsence(error) {
    const code = readNodeSystemErrorCode(error);
    return code === "ENOENT" || code === "ENOTDIR";
}
function snapshot(stats, path) {
    try {
        return createFileNodeSnapshot(stats, path);
    }
    catch (error) {
        if (error instanceof FileNodeSnapshotError)
            fail("inspection-failure", path, error);
        throw error;
    }
}
function parseOptions(value, fallbackPath) {
    if (value === undefined)
        return Object.freeze({ follow: false, path: fallbackPath });
    if (typeof value !== "object" || value === null)
        fail("input", fallbackPath);
    const path = normalizeErrorPath(value.errorPath, fallbackPath);
    if (value.follow !== undefined && typeof value.follow !== "boolean")
        fail("input", path);
    return Object.freeze({ follow: value.follow === true, path });
}
/**
 * 观察一个绝对路径：节点快照加 `realpath`。路径不存在（含中途不是目录）为 `missing`；其余
 * 观察失败为 `inspection-failure`。缺省按链接本身观察（`lstat`，`kind` 为 `symbolic-link`），
 * `follow: true` 跟随链接观察目标（`stat`）；`realPath` 两种情况下都是规范路径。
 */
export async function observeAbsoluteNode(value, optionsValue) {
    const options = parseOptions(optionsValue, "$node");
    const path = options.path;
    const absolutePath = parseAbsolutePath(value, path);
    let stats;
    try {
        stats = options.follow
            ? await stat(absolutePath, { bigint: true })
            : await lstat(absolutePath, { bigint: true });
    }
    catch (error) {
        if (isAbsence(error))
            return Object.freeze({ state: "missing" });
        fail("inspection-failure", path, error);
    }
    const node = snapshot(stats, path);
    let realPath;
    try {
        realPath = await realpath(absolutePath);
    }
    catch (error) {
        if (isAbsence(error))
            return Object.freeze({ state: "missing" });
        fail("inspection-failure", path, error);
    }
    return Object.freeze({ state: "present", node, realPath });
}
/**
 * 读一个绝对路径上的小普通文件（UTF-8，跟随符号链接）。不存在、不是普通文件或超过
 * `maximumBytes` 返回 null；其余失败为 `read-failure`。
 */
export async function readAbsoluteRegularFileText(value, maximumBytes, errorPath) {
    const path = normalizeErrorPath(errorPath, "$file");
    const absolutePath = parseAbsolutePath(value, path);
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0)
        fail("input", path);
    const observed = await observeAbsoluteNode(absolutePath, { follow: true, errorPath: path });
    if (observed.state === "missing" || observed.node.kind !== "file")
        return null;
    if (observed.node.byteCount > maximumBytes)
        return null;
    try {
        return await readFile(absolutePath, "utf8");
    }
    catch (error) {
        if (isAbsence(error))
            return null;
        fail("read-failure", path, error);
    }
}
