import { types } from "node:util";
import { computeSha256Digest, } from "../crypto/sha256.js";
import { parseDenseArray, parsePlainRecord, PassiveOwnDataError, } from "../data/passive-own-data.js";
import { parseByteCount } from "../numeric/byte-count.js";
const ERROR_MESSAGES = {
    input: "Whole-file content transition input is invalid.",
    "duplicate-current": "Whole-file current content is duplicated.",
    "unadmitted-source": "Whole-file source is not an admitted content render.",
};
/** 整文件字节转换准入失败的稳定、脱敏错误。 */
export class WholeFileContentTransitionError extends Error {
    name = "WholeFileContentTransitionError";
    code = "wakeflow-whole-file-content-transition";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const MAXIMUM_ADMITTED_CURRENT_CONTENTS = 8;
function fail(reason, path) {
    throw new WholeFileContentTransitionError(reason, path);
}
function snapshotBytes(value, path) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !ArrayBuffer.isView(value)
        || !(value instanceof Uint8Array)
        || value.buffer instanceof SharedArrayBuffer) {
        fail("input", path);
    }
    const bytes = Buffer.from(value);
    return Object.freeze({
        bytes,
        byteCount: parseByteCount(bytes.byteLength, path),
        digest: computeSha256Digest(bytes, path),
    });
}
function sameContent(left, right) {
    return left.byteCount === right.byteCount
        && left.digest === right.digest
        && left.bytes.equals(right.bytes);
}
function parseRequest(value) {
    let record;
    try {
        record = parsePlainRecord(value, "$request");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", error.path);
        throw error;
    }
    const keys = Object.keys(record).sort();
    if (keys.length !== 2
        || keys[0] !== "currentContents"
        || keys[1] !== "desiredContent") {
        fail("input", "$request");
    }
    let currentValues;
    try {
        currentValues = parseDenseArray(record.currentContents, MAXIMUM_ADMITTED_CURRENT_CONTENTS, "$request.currentContents");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", error.path);
        throw error;
    }
    const desired = snapshotBytes(record.desiredContent, "$request.desiredContent");
    const current = Object.freeze(currentValues.map((content, index) => (snapshotBytes(content, `$request.currentContents/${index}`))));
    for (let index = 0; index < current.length; index += 1) {
        const entry = current[index];
        if (entry === undefined)
            continue;
        for (let priorIndex = 0; priorIndex < index; priorIndex += 1) {
            const prior = current[priorIndex];
            if (prior !== undefined && sameContent(prior, entry)) {
                fail("duplicate-current", `$request.currentContents/${index}`);
            }
        }
    }
    return Object.freeze({ current, desired });
}
/** 计划一份 absent/current/replace 的整文件字节转换，不执行任何 I/O。 */
export function planWholeFileContentTransition(sourceValue, requestValue) {
    const request = parseRequest(requestValue);
    const source = sourceValue === null
        ? null
        : snapshotBytes(sourceValue, "$source");
    if (source === null) {
        return Object.freeze({
            disposition: "create-required",
            sourceAuthority: "absent",
            desiredByteCount: request.desired.byteCount,
            desiredDigest: request.desired.digest,
            desiredBytes: Buffer.from(request.desired.bytes),
        });
    }
    if (sameContent(source, request.desired)) {
        return Object.freeze({
            disposition: "current",
            sourceAuthority: "desired",
            desiredByteCount: request.desired.byteCount,
            desiredDigest: request.desired.digest,
            desiredBytes: Buffer.from(request.desired.bytes),
        });
    }
    const isAdmittedCurrent = request.current.some((content) => (sameContent(source, content)));
    if (!isAdmittedCurrent)
        fail("unadmitted-source", "$source");
    return Object.freeze({
        disposition: "replace-required",
        sourceAuthority: "admitted-current",
        desiredByteCount: request.desired.byteCount,
        desiredDigest: request.desired.digest,
        desiredBytes: Buffer.from(request.desired.bytes),
    });
}
