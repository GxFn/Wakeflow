import { sameFileNodeIdentity } from "./file-node-snapshot.js";
import { parsePortableResourcePath } from "./portable-resource-path.js";
import { isRootedDirectory } from "./rooted-directory.js";
import { RootedResourceParentHandle, RootedResourceParentHandleError, } from "./rooted-resource-parent-handle.js";
const ERROR_MESSAGES = {
    input: "Durable resource entry settlement input is invalid.",
    "parent-open-failure": "Durable resource entry settlement could not open the parent directory.",
    "inspection-failure": "Durable resource entry settlement could not inspect its target.",
    "observation-changed": "The resource entry is no longer what the caller observed.",
    "durability-failure": "Durable resource entry settlement could not sync the parent directory.",
    "close-failure": "Durable resource entry settlement could not close the parent directory.",
    aborted: "Durable resource entry settlement was aborted.",
};
export class DurableResourceEntrySettlementError extends Error {
    name = "DurableResourceEntrySettlementError";
    reason;
    path;
    constructor(reason, path, cause) {
        super(ERROR_MESSAGES[reason], cause === undefined ? undefined : { cause });
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path, cause) {
    throw new DurableResourceEntrySettlementError(reason, path, cause);
}
function parseOptions(root, observed, value) {
    if (!isRootedDirectory(root))
        fail("input", "$root");
    if (observed !== "present" && observed !== "absent")
        fail("input", "$observed");
    if (value !== undefined && (typeof value !== "object" || value === null)) {
        fail("input", "$options");
    }
    const errorPath = value?.errorPath ?? "$resourcePath";
    if (typeof errorPath !== "string" || errorPath.length === 0)
        fail("input", "$options.errorPath");
    const signal = value?.signal;
    if (signal !== undefined && !(signal instanceof AbortSignal))
        fail("input", "$options.signal");
    const expectedNode = value?.expectedNode;
    if (expectedNode !== undefined && observed !== "present")
        fail("input", "$options.expectedNode");
    return Object.freeze({ expectedNode, signal, errorPath });
}
/** 目标此刻是否仍是调用方看到的样子；不是就报 `observation-changed`。 */
async function assertObserved(parent, observed, options) {
    let target;
    try {
        target = await parent.inspectTarget();
    }
    catch (error) {
        const changed = error instanceof RootedResourceParentHandleError && error.reason === "parent-changed";
        fail(changed ? "observation-changed" : "inspection-failure", options.errorPath, error);
    }
    if (observed === "absent") {
        if (target !== null)
            fail("observation-changed", options.errorPath);
        return;
    }
    if (target === null)
        fail("observation-changed", options.errorPath);
    if (options.expectedNode !== undefined && !sameFileNodeIdentity(target, options.expectedNode)) {
        fail("observation-changed", options.errorPath);
    }
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$signal");
}
async function openParent(root, resourcePath, errorPath) {
    try {
        return await RootedResourceParentHandle.open(root, resourcePath, errorPath);
    }
    catch (error) {
        const input = error instanceof RootedResourceParentHandleError && error.reason === "input";
        fail(input ? "input" : "parent-open-failure", errorPath, error);
    }
}
async function syncParent(parent, errorPath) {
    try {
        await parent.sync();
    }
    catch (error) {
        const changed = error instanceof RootedResourceParentHandleError && error.reason === "parent-changed";
        fail(changed ? "observation-changed" : "durability-failure", errorPath, error);
    }
}
/** 父目录因为不存在而打不开时，返回父目录自己的路径（它就是那个"不在"的名字）；别的打不开返回 null。 */
function missingParentOf(resourcePath, error) {
    if (!(error instanceof DurableResourceEntrySettlementError))
        return null;
    const cause = error.cause;
    if (!(cause instanceof RootedResourceParentHandleError) || cause.reason !== "parent-not-found") {
        return null;
    }
    const cut = resourcePath.lastIndexOf("/");
    return cut <= 0 ? null : parsePortableResourcePath(resourcePath.slice(0, cut));
}
/**
 * 核对 `resourcePath` 在它的父目录里仍然"在"或"不在"，同步父目录，再核对一次。句柄恰好关闭一次；
 * 先发生的错误优先于关闭时的错误。"不在"的目标连父目录都不在时，对父目录的路径做同一件事（见文件头）。
 */
export async function settleObservedResourceEntry(root, resourcePath, observed, options) {
    const parsed = parseOptions(root, observed, options);
    assertNotAborted(parsed.signal);
    let parent;
    try {
        parent = await openParent(root, resourcePath, parsed.errorPath);
    }
    catch (error) {
        const missing = observed === "absent" ? missingParentOf(resourcePath, error) : null;
        if (missing === null)
            throw error;
        await settleObservedResourceEntry(root, missing, "absent", {
            errorPath: parsed.errorPath,
            ...(parsed.signal === undefined ? {} : { signal: parsed.signal }),
        });
        return;
    }
    let failure;
    try {
        await assertObserved(parent, observed, parsed);
        assertNotAborted(parsed.signal);
        await syncParent(parent, parsed.errorPath);
        await assertObserved(parent, observed, parsed);
    }
    catch (error) {
        failure = error;
    }
    try {
        await parent.close();
    }
    catch (error) {
        failure ??= new DurableResourceEntrySettlementError("close-failure", parsed.errorPath, error);
    }
    if (failure !== undefined)
        throw failure;
}
