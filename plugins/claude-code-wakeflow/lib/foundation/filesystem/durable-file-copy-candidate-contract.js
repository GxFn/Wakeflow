import { types } from "node:util";
import { parseSha256Digest, Sha256Error, } from "../crypto/sha256.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../data/passive-own-data.js";
import { ByteCountError, parseByteCount, } from "../numeric/byte-count.js";
import { createFileNodeSnapshot, FileNodeSnapshotError, sameFileNodeSnapshot, } from "./file-node-snapshot.js";
import { parsePortableResourcePath, PortableResourcePathError, } from "./portable-resource-path.js";
import { RootedDirectory } from "./rooted-directory.js";
const ERROR_MESSAGES = {
    input: "Durable file copy candidate input is invalid.",
    capacity: "Durable file copy source exceeds its byte budget.",
    "source-root-scope": "Durable file copy lost its source root scope.",
    "source-not-found": "Durable file copy source does not exist.",
    "source-symlink": "Durable file copy source cannot be a symbolic link.",
    "source-not-file": "Durable file copy source must be a regular file.",
    "source-changed": "Durable file copy source changed during the operation.",
    "source-mismatch": "Durable file copy source differs from its content expectation.",
    "source-read-failure": "Durable file copy source could not be read safely.",
    "destination-root-scope": "Durable file copy lost its destination root scope.",
    "destination-parent": "Durable file copy candidate parent is unavailable or unsafe.",
    "target-exists": "Durable file copy candidate target already exists.",
    "candidate-create-failure": "Durable file copy candidate could not be created exclusively.",
    "candidate-write-failure": "Durable file copy candidate could not be written exactly.",
    "candidate-sync-failure": "Durable file copy candidate could not synchronize its bytes.",
    "candidate-changed": "Durable file copy candidate changed during verification.",
    "durability-failure": "Durable file copy candidate directory entry could not be synchronized.",
    "cleanup-failure": "Failed durable file copy candidate could not be retired exactly.",
    aborted: "Durable file copy candidate was aborted before completion.",
    "close-failure": "Durable file copy candidate handle could not be closed safely.",
};
/** 跨根流式文件候选失败的稳定、脱敏错误。 */
export class DurableFileCopyCandidateError extends Error {
    name = "DurableFileCopyCandidateError";
    code = "wakeflow-durable-file-copy-candidate";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
export function failDurableFileCopyCandidate(reason, path) {
    throw new DurableFileCopyCandidateError(reason, path);
}
export function assertDurableFileCopyRoot(value, path) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        failDurableFileCopyCandidate("input", path);
    }
}
export function parseDurableFileCopyPath(value, path) {
    try {
        return parsePortableResourcePath(value, path);
    }
    catch (error) {
        if (error instanceof PortableResourcePathError) {
            failDurableFileCopyCandidate("input", path);
        }
        throw error;
    }
}
function plainRecord(value, path) {
    try {
        return parsePlainRecord(value, path);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError) {
            failDurableFileCopyCandidate("input", path);
        }
        throw error;
    }
}
function parseExpectedNode(value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !Object.isFrozen(value)) {
        failDurableFileCopyCandidate("input", "$expectation.expectedNode");
    }
    try {
        if (!sameFileNodeSnapshot(value, value)) {
            failDurableFileCopyCandidate("input", "$expectation.expectedNode");
        }
    }
    catch (error) {
        if (error instanceof FileNodeSnapshotError) {
            failDurableFileCopyCandidate("input", "$expectation.expectedNode");
        }
        throw error;
    }
    const node = value;
    if (node.kind !== "file") {
        failDurableFileCopyCandidate("input", "$expectation.expectedNode");
    }
    return node;
}
export function parseDurableFileCopyExpectation(value) {
    const record = plainRecord(value, "$expectation");
    const keys = Object.keys(record).sort();
    if ((keys.length !== 2 && keys.length !== 3)
        || keys[0] !== "byteCount"
        || keys[1] !== "digest"
        || (keys.length === 3 && keys[2] !== "expectedNode")) {
        failDurableFileCopyCandidate("input", "$expectation");
    }
    let byteCount;
    let digest;
    try {
        byteCount = parseByteCount(record.byteCount, "$expectation.byteCount");
    }
    catch (error) {
        if (error instanceof ByteCountError) {
            failDurableFileCopyCandidate("input", "$expectation.byteCount");
        }
        throw error;
    }
    try {
        digest = parseSha256Digest(record.digest, "$expectation.digest");
    }
    catch (error) {
        if (error instanceof Sha256Error) {
            failDurableFileCopyCandidate("input", "$expectation.digest");
        }
        throw error;
    }
    const expectedNode = parseExpectedNode(record.expectedNode);
    if (expectedNode !== undefined && expectedNode.byteCount !== byteCount) {
        failDurableFileCopyCandidate("input", "$expectation.expectedNode");
    }
    return Object.freeze({ byteCount, digest, expectedNode });
}
function isAbortSignal(value) {
    return typeof value === "object"
        && value !== null
        && !types.isProxy(value)
        && value instanceof AbortSignal;
}
function parseMode(value) {
    if (typeof value !== "number"
        || !Number.isInteger(value)
        || value < 0
        || value > 0o777) {
        failDurableFileCopyCandidate("input", "$options.mode");
    }
    return value;
}
export function parseDurableFileCopyOptions(value) {
    const record = plainRecord(value, "$options");
    const keys = Object.keys(record).sort();
    if ((keys.length !== 2 && keys.length !== 3)
        || keys[0] !== "maximumBytes"
        || keys[1] !== "mode"
        || (keys.length === 3 && keys[2] !== "signal")) {
        failDurableFileCopyCandidate("input", "$options");
    }
    let maximumBytes;
    try {
        maximumBytes = parseByteCount(record.maximumBytes, "$options.maximumBytes");
    }
    catch (error) {
        if (error instanceof ByteCountError) {
            failDurableFileCopyCandidate("input", "$options.maximumBytes");
        }
        throw error;
    }
    if (record.signal !== undefined && !isAbortSignal(record.signal)) {
        failDurableFileCopyCandidate("input", "$options.signal");
    }
    return Object.freeze({
        maximumBytes,
        mode: parseMode(record.mode),
        signal: record.signal,
    });
}
export function assertDurableFileCopyNotAborted(signal) {
    if (signal?.aborted === true) {
        failDurableFileCopyCandidate("aborted", "$signal");
    }
}
export function snapshotDurableFileCopyNode(value, reason, path) {
    try {
        return createFileNodeSnapshot(value, path);
    }
    catch {
        failDurableFileCopyCandidate(reason, path);
    }
}
