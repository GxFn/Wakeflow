import { filesystemMutation } from "./filesystem-mutation.js";
import { RootedDirectory, RootedDirectoryError } from "./rooted-directory.js";
import { RootedResourceParentHandle } from "./rooted-resource-parent-handle.js";
const ERROR_MESSAGES = {
    input: "Rooted directory tree removal input is invalid.",
    "not-found": "Rooted directory tree does not exist.",
    "not-directory": "Rooted directory tree target is not a directory.",
    "inspection-failure": "Rooted directory tree target could not be inspected.",
    "parent-open-failure": "Rooted directory tree parent could not be opened.",
    "removal-failure": "Rooted directory tree could not be removed.",
    "durability-failure": "Rooted directory tree was removed, but its parent could not be synchronized or closed.",
    aborted: "Rooted directory tree removal was aborted.",
};
export class RootedDirectoryTreeRemovalError extends Error {
    name = "RootedDirectoryTreeRemovalError";
    code = "wakeflow-rooted-directory-tree-removal";
    reason;
    path;
    constructor(reason, path, cause) {
        super(ERROR_MESSAGES[reason], cause === undefined ? undefined : { cause });
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path, cause) {
    throw new RootedDirectoryTreeRemovalError(reason, path, cause);
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$signal");
}
function parseOptions(value, path) {
    if (value === undefined) {
        return Object.freeze({ missing: "fail", signal: undefined });
    }
    if (typeof value !== "object" || value === null)
        fail("input", path);
    const missing = value.missing ?? "fail";
    if (missing !== "fail" && missing !== "ignore")
        fail("input", path);
    const signal = value.signal;
    if (signal !== undefined && !(signal instanceof AbortSignal))
        fail("input", path);
    return Object.freeze({ missing, signal });
}
async function openRemovalParent(root, resourcePath, errorPath) {
    try {
        return await RootedResourceParentHandle.open(root, resourcePath, errorPath);
    }
    catch (error) {
        fail("parent-open-failure", errorPath, error);
    }
}
/** 删除之后经父目录句柄同步一次并关闭句柄；删除已失败时只关闭。返回首个错误。 */
async function settleRemovalParent(parent, removed, errorPath) {
    let primaryError;
    if (removed) {
        try {
            await parent.sync();
        }
        catch (error) {
            primaryError = new RootedDirectoryTreeRemovalError("durability-failure", errorPath, error);
        }
    }
    try {
        await parent.close();
    }
    catch (error) {
        primaryError ??= new RootedDirectoryTreeRemovalError("durability-failure", errorPath, error);
    }
    return primaryError;
}
/**
 * 删除 `root` 下 `resourcePath` 这棵目录树并同步其父目录；返回 `removed` 或（`missing: "ignore"`
 * 时）`absent`。
 */
export async function removeRootedDirectoryTree(root, resourcePath, optionsValue, errorPath = "$directory") {
    if (!(root instanceof RootedDirectory))
        fail("input", "$root");
    const options = parseOptions(optionsValue, errorPath);
    assertNotAborted(options.signal);
    let snapshot;
    try {
        snapshot = await root.inspectExistingResource(resourcePath, errorPath);
    }
    catch (error) {
        if (error instanceof RootedDirectoryError && error.reason === "resource-not-found") {
            if (options.missing === "ignore")
                return "absent";
            fail("not-found", errorPath, error);
        }
        fail("inspection-failure", errorPath, error);
    }
    if (snapshot.node.kind !== "directory")
        fail("not-directory", errorPath);
    assertNotAborted(options.signal);
    // 删除之前绑定父目录句柄，删除之后经它同步一次，同步落在删除发生的那个目录上。
    const parent = await openRemovalParent(root, resourcePath, errorPath);
    let primaryError;
    try {
        await filesystemMutation.removeTree(snapshot.physicalPath);
    }
    catch (error) {
        primaryError = new RootedDirectoryTreeRemovalError("removal-failure", errorPath, error);
    }
    const parentError = await settleRemovalParent(parent, primaryError === undefined, errorPath);
    primaryError ??= parentError;
    if (primaryError !== undefined)
        throw primaryError;
    return "removed";
}
