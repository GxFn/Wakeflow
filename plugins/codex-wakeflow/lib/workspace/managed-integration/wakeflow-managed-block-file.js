import { types } from "node:util";
import { createFileAtomically, replaceFileAtomically, DurableAtomicFileWriteError, } from "../../foundation/filesystem/durable-atomic-file-write.js";
import { sameFileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import { parsePortableResourcePath, PortableResourcePathError, } from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { readStableFile, StableFileReadError, } from "../../foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { planWakeflowManagedTextAuthorityTransition, WakeflowManagedTextAuthorityTransitionError, } from "./wakeflow-managed-text-authority-transition.js";
const ERROR_MESSAGES = {
    input: "Wakeflow managed block file input is invalid.",
    "unsupported-platform": "Wakeflow managed block file requires POSIX ownership facts.",
    "root-scope": "Wakeflow managed block file lost its root scope.",
    "root-policy": "Wakeflow managed block file requires a current-user root.",
    source: "Wakeflow managed block file source cannot be read stably.",
    "source-capacity": "Wakeflow managed block file source exceeds its byte budget.",
    "source-policy": "Wakeflow managed block file source violates its node policy.",
    envelope: "Wakeflow managed block file envelope is invalid.",
    "unknown-managed-body": "Wakeflow managed block file body is not an admitted render.",
    "target-capacity": "Wakeflow managed block file candidate exceeds its byte budget.",
    conflict: "Wakeflow managed block file source changed before atomic publication.",
    "recovery-required": "Wakeflow managed block file target has stage residue that requires explicit recovery.",
    aborted: "Wakeflow managed block file operation was aborted.",
    "effect-failure": "Wakeflow managed block file effect failed.",
    "commit-uncertain": "Wakeflow managed block file commit outcome is uncertain.",
};
/** 托管块文件检查或重组失败的稳定、脱敏错误。 */
export class WakeflowManagedBlockFileError extends Error {
    name = "WakeflowManagedBlockFileError";
    code = "wakeflow-managed-block-file";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const DEFAULT_MAXIMUM_BYTES = parseByteCount(1024 * 1024, "$managedBlockFile.maximumBytes");
function fail(reason, path) {
    throw new WakeflowManagedBlockFileError(reason, path);
}
function assertRoot(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        fail("input", "$root");
    }
}
function isAbortSignal(value) {
    return typeof value === "object"
        && value !== null
        && !types.isProxy(value)
        && value instanceof AbortSignal;
}
function parseRequest(value) {
    if (typeof value !== "object" || value === null || types.isProxy(value)) {
        fail("input", "$request");
    }
    let resourcePath;
    try {
        resourcePath = parsePortableResourcePath(value.resourcePath, "$request.resourcePath");
    }
    catch (error) {
        if (error instanceof PortableResourcePathError)
            fail("input", "$request.resourcePath");
        throw error;
    }
    if (value.signal !== undefined && !isAbortSignal(value.signal)) {
        fail("input", "$request.signal");
    }
    if (!Array.isArray(value.currentTargets))
        fail("input", "$request.currentTargets");
    // envelope target 的形状由 transition planner 严格准入；这里只做零 I/O 的预演。
    try {
        planWakeflowManagedTextAuthorityTransition(new Uint8Array(), {
            currentTargets: value.currentTargets,
            desiredTarget: value.desiredTarget,
        });
    }
    catch (error) {
        if (error instanceof WakeflowManagedTextAuthorityTransitionError) {
            fail("input", error.path);
        }
        throw error;
    }
    return Object.freeze({
        resourcePath,
        currentTargets: Object.freeze([...value.currentTargets]),
        desiredTarget: value.desiredTarget,
        maximumBytes: value.maximumBytes ?? DEFAULT_MAXIMUM_BYTES,
        signal: value.signal,
    });
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$signal");
}
function currentUserId() {
    if (process.platform === "win32" || typeof process.geteuid !== "function") {
        fail("unsupported-platform", "$root");
    }
    return BigInt(process.geteuid());
}
async function assertCurrentUserRoot(root, expectedUserId) {
    let userId;
    try {
        userId = (await root.assertCurrent("$root")).userId;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError)
            fail("root-scope", "$root");
        throw error;
    }
    if (userId !== expectedUserId)
        fail("root-policy", "$root");
}
async function readSource(root, request, expectedUserId) {
    try {
        const read = await readStableFile(root, request.resourcePath, {
            maximumBytes: request.maximumBytes,
            ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
        if (read.node.kind !== "file"
            || read.node.linkCount !== 1n
            || read.node.userId !== expectedUserId) {
            fail("source-policy", "$source");
        }
        return Object.freeze({
            facts: Object.freeze({
                resourcePath: read.resourcePath,
                node: read.node,
                byteCount: read.byteCount,
                digest: read.digest,
            }),
            bytes: read.bytes,
        });
    }
    catch (error) {
        if (error instanceof WakeflowManagedBlockFileError)
            throw error;
        if (error instanceof StableFileReadError) {
            if (error.reason === "not-found")
                return null;
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "symlink" || error.reason === "not-file") {
                fail("source-policy", "$source");
            }
            if (error.reason === "too-large")
                fail("source-capacity", "$source");
            fail("source", "$source");
        }
        throw error;
    }
}
async function revalidateSource(root, request, initial) {
    try {
        const current = await readStableFile(root, request.resourcePath, {
            maximumBytes: request.maximumBytes,
            ...(initial === null ? {} : { expectedNode: initial.facts.node }),
            ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
        if (initial === null
            || current.digest !== initial.facts.digest
            || current.byteCount !== initial.facts.byteCount) {
            fail("source", "$source");
        }
    }
    catch (error) {
        if (error instanceof WakeflowManagedBlockFileError)
            throw error;
        if (error instanceof StableFileReadError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (initial === null && error.reason === "not-found")
                return;
            fail("source", "$source");
        }
        throw error;
    }
}
async function inspectParsed(root, request, expectedUserId) {
    assertNotAborted(request.signal);
    const read = await readSource(root, request, expectedUserId);
    let transition;
    try {
        transition = planWakeflowManagedTextAuthorityTransition(read?.bytes ?? new Uint8Array(), {
            currentTargets: request.currentTargets,
            desiredTarget: request.desiredTarget,
        });
    }
    catch (error) {
        if (error instanceof WakeflowManagedTextAuthorityTransitionError) {
            if (error.reason === "unadmitted-source")
                fail("unknown-managed-body", "$source");
            if (error.reason === "relation" || error.reason === "envelope") {
                fail("envelope", "$source");
            }
            fail("input", error.path);
        }
        throw error;
    }
    if (transition.target !== null && transition.target.byteCount > request.maximumBytes) {
        fail("target-capacity", "$target");
    }
    await revalidateSource(root, request, read);
    return Object.freeze({
        status: transition.disposition === "current"
            ? "managed-current"
            : "recompose-required",
        resourcePath: request.resourcePath,
        source: read?.facts ?? null,
        transition,
    });
}
/** 稳定检查根目录里一个文件的托管块，生成零写入的 current 或重组候选。 */
export async function inspectWakeflowManagedBlockFile(rootValue, requestValue) {
    assertRoot(rootValue);
    const request = parseRequest(requestValue);
    return inspectParsed(rootValue, request, currentUserId());
}
function mapAtomicError(error) {
    if (error.reason === "input")
        fail("input", error.path);
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "capacity")
        fail("target-capacity", "$target");
    if (error.reason === "target-exists"
        || error.reason === "expectation-changed"
        || error.reason === "expectation-read-failure") {
        fail("conflict", "$source");
    }
    if (error.reason === "root-scope" || error.reason === "parent-changed") {
        fail("root-scope", "$root");
    }
    if (error.reason === "stage-recovery-required") {
        fail("recovery-required", "$resourcePath");
    }
    if (error.reason === "commit-uncertain"
        || error.reason === "durability-failure"
        || error.reason === "stage-cleanup-failure"
        || error.reason === "close-failure") {
        fail("commit-uncertain", "$resourcePath");
    }
    fail("effect-failure", "$resourcePath");
}
async function publishTarget(root, request, inspection, createMode) {
    const target = inspection.transition.target;
    if (inspection.status !== "recompose-required" || target === null) {
        fail("source", "$target");
    }
    try {
        if (inspection.source === null) {
            return await createFileAtomically(root, request.resourcePath, target.bytes, {
                mode: createMode,
                ...(request.signal === undefined ? {} : { signal: request.signal }),
            });
        }
        return await replaceFileAtomically(root, request.resourcePath, target.bytes, {
            mode: inspection.source.node.permissionBits,
            expected: inspection.source,
            ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
    }
    catch (error) {
        if (error instanceof DurableAtomicFileWriteError)
            mapAtomicError(error);
        fail("effect-failure", "$resourcePath");
    }
}
function sameSource(left, right) {
    return left.resourcePath === right.resourcePath
        && left.byteCount === right.byteCount
        && left.digest === right.digest
        && sameFileNodeSnapshot(left.node, right.node);
}
function assertReadback(request, before, effect, after, expectedUserId, createMode) {
    const target = before.transition.target;
    const source = after.source;
    const expectedMode = before.source === null
        ? createMode
        : before.source.node.permissionBits;
    if (target === null
        || source === null
        || after.status !== "managed-current"
        || after.transition.sourceAuthority !== "desired"
        || after.transition.target !== null
        || effect.resourcePath !== request.resourcePath
        || effect.digest !== target.digest
        || effect.byteCount !== target.byteCount
        || effect.node.kind !== "file"
        || effect.node.permissionBits !== expectedMode
        || effect.node.linkCount !== 1n
        || effect.node.userId !== expectedUserId
        || source.resourcePath !== effect.resourcePath
        || source.digest !== effect.digest
        || source.byteCount !== effect.byteCount
        || !sameFileNodeSnapshot(source.node, effect.node)) {
        fail("commit-uncertain", "$resourcePath");
    }
    if (effect.publication === "created") {
        if (before.source !== null)
            fail("commit-uncertain", "$resourcePath");
    }
    else if (before.source === null || !sameSource(effect.previous, before.source)) {
        fail("commit-uncertain", "$resourcePath");
    }
}
function parseOptions(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || Object.keys(value).some((key) => key !== "createMode")) {
        fail("input", "$options");
    }
    const createMode = value.createMode;
    if (typeof createMode !== "number"
        || !Number.isInteger(createMode)
        || createMode < 0
        || createMode > 0o777) {
        fail("input", "$options.createMode");
    }
    return createMode;
}
/** 在调用方持有的事务内幂等创建或 CAS 替换一个文件里的 Wakeflow 托管块。 */
export async function recomposeWakeflowManagedBlockFile(rootValue, requestValue, optionsValue) {
    assertRoot(rootValue);
    const createMode = parseOptions(optionsValue);
    const request = parseRequest(requestValue);
    assertNotAborted(request.signal);
    const expectedUserId = currentUserId();
    await assertCurrentUserRoot(rootValue, expectedUserId);
    const before = await inspectParsed(rootValue, request, expectedUserId);
    if (before.status !== "recompose-required") {
        return Object.freeze({ disposition: "current", effect: null, inspection: before });
    }
    await assertCurrentUserRoot(rootValue, expectedUserId);
    assertNotAborted(request.signal);
    const effect = await publishTarget(rootValue, request, before, createMode);
    let after;
    try {
        after = await inspectParsed(rootValue, Object.freeze({ ...request, signal: undefined }), expectedUserId);
    }
    catch {
        fail("commit-uncertain", "$resourcePath");
    }
    assertReadback(request, before, effect, after, expectedUserId, createMode);
    return Object.freeze({
        disposition: effect.publication,
        effect,
        inspection: after,
    });
}
