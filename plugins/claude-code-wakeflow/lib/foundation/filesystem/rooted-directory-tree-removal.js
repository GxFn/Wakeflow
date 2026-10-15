import { rm } from "node:fs/promises";
import { RootedDirectory, RootedDirectoryError } from "./rooted-directory.js";
const ERROR_MESSAGES = {
    input: "Rooted directory tree removal input is invalid.",
    "not-found": "Rooted directory tree does not exist.",
    "not-directory": "Rooted directory tree target is not a directory.",
    "inspection-failure": "Rooted directory tree target could not be inspected.",
    "removal-failure": "Rooted directory tree could not be removed.",
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
    if (value === undefined)
        return Object.freeze({ missing: "fail", signal: undefined });
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
/** 删除 `root` 下 `resourcePath` 这棵目录树；返回 `removed` 或（`missing: "ignore"` 时）`absent`。 */
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
    try {
        await rm(snapshot.physicalPath, { recursive: true, force: false });
    }
    catch (error) {
        fail("removal-failure", errorPath, error);
    }
    return "removed";
}
