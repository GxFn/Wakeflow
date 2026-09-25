import nodePath from "node:path";
import { types } from "node:util";
import { parsePlainRecord, PassiveOwnDataError, } from "../data/passive-own-data.js";
import { inspectAbsoluteDirectoryPlacement, AbsoluteDirectoryPlacementError, } from "./absolute-directory-placement.js";
import { materializeDirectoryPath, DurableDirectoryMaterializationError, } from "./durable-directory-materialization.js";
import { sameFileNodeIdentity, } from "./file-node-snapshot.js";
import { parsePortableResourcePath, PortableResourcePathError, } from "./portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError, } from "./rooted-directory.js";
const ERROR_MESSAGES = {
    input: "Absolute directory materialization input is invalid.",
    scope: "Absolute directory materialization requires a non-root safe ancestor.",
    symlink: "Absolute directory materialization path contains a symbolic link.",
    "not-directory": "Absolute directory materialization path contains a non-directory node.",
    alias: "Absolute directory materialization path is not canonically spelled.",
    "root-open": "Absolute directory materialization root could not be opened.",
    materialization: "Absolute directory path could not be materialized safely.",
    "path-changed": "Absolute directory path changed during materialization.",
    aborted: "Absolute directory materialization was aborted.",
    "close-failure": "Absolute directory materialization root could not be closed safely.",
};
/** 绝对目录位置物化失败的稳定、脱敏错误。 */
export class AbsoluteDirectoryMaterializationError extends Error {
    name = "AbsoluteDirectoryMaterializationError";
    code = "wakeflow-absolute-directory-materialization";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new AbsoluteDirectoryMaterializationError(reason, path);
}
function isAbortSignal(value) {
    return typeof value === "object"
        && value !== null
        && !types.isProxy(value)
        && value instanceof AbortSignal;
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
    if (!Object.hasOwn(record, "mode")
        || Object.keys(record).some((key) => key !== "mode" && key !== "signal")
        || typeof record.mode !== "number"
        || !Number.isInteger(record.mode)
        || record.mode < 0
        || record.mode > 0o777
        || (record.signal !== undefined && !isAbortSignal(record.signal))) {
        fail("input", "$options");
    }
    return Object.freeze({
        mode: record.mode,
        signal: record.signal,
    });
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$signal");
}
async function inspect(value, path) {
    try {
        return await inspectAbsoluteDirectoryPlacement(value, path);
    }
    catch (error) {
        if (error instanceof AbsoluteDirectoryPlacementError) {
            if (error.reason === "input")
                fail("input", path);
            if (error.reason === "symlink")
                fail("symlink", path);
            if (error.reason === "not-directory")
                fail("not-directory", path);
            fail("path-changed", path);
        }
        throw error;
    }
}
function relativeResourcePath(ancestor, target) {
    const relative = nodePath.relative(ancestor, target);
    if (relative.length === 0
        || relative === ".."
        || relative.startsWith(`..${nodePath.sep}`)
        || nodePath.isAbsolute(relative)) {
        fail("scope", "$absolutePath");
    }
    try {
        return parsePortableResourcePath(relative.split(nodePath.sep).join("/"), "$absolutePath");
    }
    catch (error) {
        if (error instanceof PortableResourcePathError) {
            fail("input", "$absolutePath");
        }
        throw error;
    }
}
function mapMaterializationError(error) {
    if (error.reason === "input")
        fail("input", error.path);
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "target-symlink" || error.reason === "parent-symlink") {
        fail("symlink", "$absolutePath");
    }
    if (error.reason === "target-not-directory"
        || error.reason === "parent-not-directory") {
        fail("not-directory", "$absolutePath");
    }
    if (error.reason === "close-failure")
        fail("close-failure", "$root");
    if (error.reason === "root-scope"
        || error.reason === "parent-changed"
        || error.reason === "path-changed") {
        fail("path-changed", "$absolutePath");
    }
    fail("materialization", "$absolutePath");
}
/** 从最近安全祖先开始，持久且幂等地物化一个规范绝对目录位置。 */
export async function materializeAbsoluteDirectoryPlacement(value, optionsValue) {
    const options = parseOptions(optionsValue);
    assertNotAborted(options.signal);
    const initial = await inspect(value, "$absolutePath");
    const absolutePath = initial.absolutePath;
    if (initial.state === "present") {
        if (initial.spellingIsCanonical !== true
            || initial.node === null) {
            fail("alias", "$absolutePath");
        }
        return Object.freeze({
            absolutePath,
            node: initial.node,
            segments: Object.freeze([Object.freeze({
                    absolutePath,
                    disposition: "existing",
                    node: initial.node,
                })]),
        });
    }
    const nearestAncestor = initial.nearestExistingAncestor;
    if (nearestAncestor === null)
        fail("scope", "$absolutePath");
    if (nearestAncestor.spellingIsCanonical !== true) {
        fail("alias", "$ancestor");
    }
    const ancestor = nearestAncestor.absolutePath;
    // 先证明相对路径可移植，再打开句柄，避免 input 失败泄漏 root。
    const resourcePath = relativeResourcePath(ancestor, absolutePath);
    assertNotAborted(options.signal);
    let root;
    try {
        root = await RootedDirectory.open(ancestor, "$ancestor");
    }
    catch (error) {
        if (error instanceof RootedDirectoryError)
            fail("root-open", "$ancestor");
        throw error;
    }
    let materialized;
    let primaryError;
    try {
        materialized = await materializeDirectoryPath(root, resourcePath, {
            mode: options.mode,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
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
        if (primaryError instanceof DurableDirectoryMaterializationError) {
            mapMaterializationError(primaryError);
        }
        throw primaryError;
    }
    if (closeError !== undefined)
        fail("close-failure", "$root");
    if (materialized === undefined)
        fail("materialization", "$absolutePath");
    const final = await inspect(absolutePath, "$absolutePath");
    if (final.state !== "present"
        || final.spellingIsCanonical !== true
        || final.node === null
        || !sameFileNodeIdentity(materialized.node, final.node)) {
        fail("path-changed", "$absolutePath");
    }
    const segments = Object.freeze(materialized.segments.map((entry) => (Object.freeze({
        absolutePath: nodePath.join(ancestor, ...entry.resourcePath.split("/")),
        disposition: entry.disposition,
        node: entry.node,
    }))));
    return Object.freeze({ absolutePath, node: final.node, segments });
}
