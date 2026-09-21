import { types } from "node:util";
import { parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { createFileAtomically, replaceFileAtomically, DurableAtomicFileWriteError, } from "../../foundation/filesystem/durable-atomic-file-write.js";
import { sameFileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { inspectWakeflowExternalInstruction, parseWakeflowExternalInstructionInspectionRequest, WakeflowExternalInstructionInspectionError, WAKEFLOW_EXTERNAL_INSTRUCTION_FILE_MODE, } from "./wakeflow-external-instruction-inspection.js";
const ERROR_MESSAGES = {
    input: "Wakeflow external instruction recomposition input is invalid.",
    "unsupported-platform": "Wakeflow external instruction recomposition requires POSIX ownership facts.",
    "root-scope": "Wakeflow external instruction recomposition lost its root scope.",
    "root-policy": "Wakeflow external instruction recomposition requires a current-user root.",
    "source-invalid": "Wakeflow external instruction source cannot be recomposed safely.",
    capacity: "Wakeflow external instruction recomposition exceeds its byte budget.",
    conflict: "Wakeflow external instruction source changed before atomic publication.",
    "recovery-required": "Wakeflow external instruction target has stage residue that requires explicit recovery.",
    aborted: "Wakeflow external instruction recomposition was aborted.",
    "effect-failure": "Wakeflow external instruction recomposition effect failed.",
    "commit-uncertain": "Wakeflow external instruction recomposition commit outcome is uncertain.",
};
/** 外部指令重组失败的稳定、脱敏错误。 */
export class WakeflowExternalInstructionRecompositionError extends Error {
    name = "WakeflowExternalInstructionRecompositionError";
    code = "wakeflow-external-instruction-recomposition";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new WakeflowExternalInstructionRecompositionError(reason, path);
}
function assertRoot(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        fail("input", "$root");
    }
}
function parseOptions(value) {
    if (value === undefined)
        return undefined;
    let record;
    try {
        record = parsePlainRecord(value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    if (Object.keys(record).some((key) => key !== "signal")) {
        fail("input", "$options");
    }
    if (record.signal === undefined)
        return undefined;
    if (typeof record.signal !== "object"
        || record.signal === null
        || types.isProxy(record.signal)
        || !(record.signal instanceof AbortSignal)) {
        fail("input", "$options.signal");
    }
    return record.signal;
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$signal");
}
function parseRequest(value, signal) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || Object.hasOwn(value, "signal")) {
        fail("input", "$request");
    }
    try {
        return parseWakeflowExternalInstructionInspectionRequest({
            ...value,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof WakeflowExternalInstructionInspectionError) {
            fail("input", error.path);
        }
        throw error;
    }
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
function inspectionRequest(request, signal) {
    return {
        profile: request.profile,
        target: request.target,
        currentConfig: request.currentConfig,
        expectedCurrentConfigDigest: request.currentConfigDigest,
        desiredConfig: request.desiredConfig,
        expectedDesiredConfigDigest: request.desiredConfigDigest,
        ...(signal === undefined ? {} : { signal }),
    };
}
async function inspectCurrent(root, request, signal, afterCommit) {
    try {
        return await inspectWakeflowExternalInstruction(root, inspectionRequest(request, afterCommit ? undefined : signal));
    }
    catch (error) {
        if (afterCommit)
            fail("commit-uncertain", "$resourcePath");
        if (error instanceof WakeflowExternalInstructionInspectionError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "unsupported-platform") {
                fail("unsupported-platform", "$root");
            }
            if (error.reason === "target-capacity")
                fail("capacity", "$target");
            if (error.reason === "source-capacity")
                fail("capacity", "$source");
            if (error.reason === "input" || error.reason === "authority") {
                fail("input", error.path);
            }
            fail("source-invalid", "$source");
        }
        fail("source-invalid", "$source");
    }
}
function mapAtomicError(error) {
    if (error.reason === "input")
        fail("input", error.path);
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "capacity")
        fail("capacity", "$target");
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
async function publishTarget(root, request, inspection, signal) {
    const target = inspection.transition.target;
    if (inspection.status !== "recompose-required" || target === null) {
        fail("source-invalid", "$target");
    }
    const resourcePath = request.profile.instructionFileName;
    try {
        if (inspection.source === null) {
            return await createFileAtomically(root, resourcePath, target.bytes, {
                mode: WAKEFLOW_EXTERNAL_INSTRUCTION_FILE_MODE,
                ...(signal === undefined ? {} : { signal }),
            });
        }
        return await replaceFileAtomically(root, resourcePath, target.bytes, {
            mode: inspection.source.node.permissionBits,
            expected: inspection.source,
            ...(signal === undefined ? {} : { signal }),
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
function assertReadback(request, before, effect, after, expectedUserId) {
    const target = before.transition.target;
    const source = after.source;
    const expectedMode = before.source === null
        ? WAKEFLOW_EXTERNAL_INSTRUCTION_FILE_MODE
        : before.source.node.permissionBits;
    if (before.status !== "recompose-required"
        || target === null
        || source === null
        || after.status !== "managed-current"
        || after.transition.sourceAuthority !== "desired"
        || after.transition.target !== null
        || after.currentConfigDigest !== before.currentConfigDigest
        || after.desiredConfigDigest !== before.desiredConfigDigest
        || after.desiredAuthority.authorityDigest
            !== before.desiredAuthority.authorityDigest
        || after.desiredAuthority.bodyDigest !== before.desiredAuthority.bodyDigest
        || effect.resourcePath !== request.profile.instructionFileName
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
    else if (before.source === null
        || !sameSource(effect.previous, before.source)) {
        fail("commit-uncertain", "$resourcePath");
    }
}
/**
 * 在调用方持有的维护事务内重推导并幂等创建或 CAS 替换外部根里的 Wakeflow 托管块。
 */
export async function recomposeWakeflowExternalInstruction(rootValue, requestValue, optionsValue) {
    assertRoot(rootValue);
    const signal = parseOptions(optionsValue);
    assertNotAborted(signal);
    const request = parseRequest(requestValue, signal);
    const expectedUserId = currentUserId();
    await assertCurrentUserRoot(rootValue, expectedUserId);
    const before = await inspectCurrent(rootValue, request, signal, false);
    if (before.status !== "recompose-required") {
        return Object.freeze({
            disposition: "current",
            effect: null,
            inspection: before,
        });
    }
    await assertCurrentUserRoot(rootValue, expectedUserId);
    assertNotAborted(signal);
    const effect = await publishTarget(rootValue, request, before, signal);
    const after = await inspectCurrent(rootValue, request, signal, true);
    assertReadback(request, before, effect, after, expectedUserId);
    return Object.freeze({
        disposition: effect.publication,
        effect,
        inspection: after,
    });
}
