import { types } from "node:util";
import { computeSha256Digest, parseSha256Digest, Sha256Error, } from "../crypto/sha256.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../data/passive-own-data.js";
import { ByteCountError, parseByteCount, } from "../numeric/byte-count.js";
import { FileNodeSnapshotError, sameFileNodeSnapshot, } from "./file-node-snapshot.js";
import { parsePortableResourcePath, PortableResourcePathError, } from "./portable-resource-path.js";
import { RootedDirectory } from "./rooted-directory.js";
/** 耐久原子文件写入的公共合同、输入快照和稳定错误。 */
export const DURABLE_ATOMIC_FILE_MAXIMUM_BYTES = parseByteCount(64 * 1024 * 1024, "$durableAtomicFile.maximumBytes");
const ERROR_MESSAGES = {
    "input": "Durable atomic file write input is invalid.",
    "root-scope": "Atomic file target could not establish its rooted scope.",
    "parent-not-found": "Atomic file target parent directory does not exist.",
    "parent-symlink": "Atomic file target parent chain cannot contain a symbolic link.",
    "parent-not-directory": "Atomic file target parent must be a directory.",
    "parent-open-failure": "Atomic file target parent could not be opened safely.",
    "parent-changed": "Atomic file target parent changed during the operation.",
    "target-exists": "Atomic file create target already exists.",
    "target-inspection-failure": "Atomic file target could not be inspected safely.",
    "expectation-changed": "Atomic file replace expectation no longer matches the target.",
    "expectation-read-failure": "Atomic file replace target could not be re-read safely.",
    "hash-failure": "Atomic file input digest could not be computed safely.",
    "capacity": "Atomic file input exceeds the recoverable stage capacity.",
    "stage-create-failure": "Private atomic file stage could not be created safely.",
    "stage-write-failure": "Private atomic file stage could not be written exactly.",
    "stage-sync-failure": "Private atomic file stage could not be synchronized safely.",
    "stage-changed": "Private atomic file stage changed before publication.",
    "publish-failure": "Private atomic file stage could not be published safely.",
    "commit-uncertain": "Published atomic file target could not be proven exact.",
    "durability-failure": "Published atomic file directory entry could not be synchronized.",
    "stage-cleanup-failure": "Private atomic file stage could not be retired safely.",
    "stage-recovery-required": "Private atomic file stage recovery requires explicit intervention.",
    "aborted": "Durable atomic file write was aborted before publication.",
    "close-failure": "An atomic file write handle could not be closed safely.",
};
/** 耐久单文件写入的稳定、脱敏错误。 */
export class DurableAtomicFileWriteError extends Error {
    name = "DurableAtomicFileWriteError";
    code = "wakeflow-durable-atomic-file-write";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
export function failDurableAtomicFileWrite(reason, path) {
    throw new DurableAtomicFileWriteError(reason, path);
}
export function assertDurableAtomicFileNotAborted(signal) {
    if (signal?.aborted === true) {
        failDurableAtomicFileWrite("aborted", "$signal");
    }
}
export function assertDurableAtomicFileRoot(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        failDurableAtomicFileWrite("input", "$root");
    }
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
        failDurableAtomicFileWrite("input", "$options.mode");
    }
    return value;
}
function parseOptionRecord(value, required, optional = []) {
    let record;
    try {
        record = parsePlainRecord(value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError) {
            failDurableAtomicFileWrite("input", "$options");
        }
        throw error;
    }
    const allowed = new Set([...required, ...optional, "signal"]);
    if (required.some((field) => !Object.hasOwn(record, field))
        || Object.keys(record).some((key) => !allowed.has(key))) {
        failDurableAtomicFileWrite("input", "$options");
    }
    return record;
}
function parseSignal(value) {
    if (value === undefined)
        return undefined;
    if (!isAbortSignal(value)) {
        failDurableAtomicFileWrite("input", "$options.signal");
    }
    return value;
}
function parseDurability(value) {
    if (value === undefined)
        return "fsync";
    if (value !== "fsync" && value !== "none") {
        failDurableAtomicFileWrite("input", "$options.durability");
    }
    return value;
}
export function parseDurableAtomicFileCreateOptions(value) {
    const record = parseOptionRecord(value, ["mode"], ["durability"]);
    return Object.freeze({
        mode: parseMode(record.mode),
        durability: parseDurability(record.durability),
        signal: parseSignal(record.signal),
    });
}
function parseExpectedNode(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !Object.isFrozen(value)) {
        failDurableAtomicFileWrite("input", "$options.expected.node");
    }
    try {
        if (!sameFileNodeSnapshot(value, value)) {
            failDurableAtomicFileWrite("input", "$options.expected.node");
        }
    }
    catch (error) {
        if (error instanceof FileNodeSnapshotError) {
            failDurableAtomicFileWrite("input", "$options.expected.node");
        }
        throw error;
    }
    const node = value;
    if (node.kind !== "file") {
        failDurableAtomicFileWrite("input", "$options.expected.node");
    }
    return node;
}
function parseExpectation(value) {
    let record;
    try {
        record = parsePlainRecord(value, "$options.expected");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError) {
            failDurableAtomicFileWrite("input", "$options.expected");
        }
        throw error;
    }
    const keys = Object.keys(record).sort();
    if (keys.length !== 4
        || keys[0] !== "byteCount"
        || keys[1] !== "digest"
        || keys[2] !== "node"
        || keys[3] !== "resourcePath") {
        failDurableAtomicFileWrite("input", "$options.expected");
    }
    let resourcePath;
    try {
        resourcePath = parsePortableResourcePath(record.resourcePath, "$options.expected.resourcePath");
    }
    catch (error) {
        if (error instanceof PortableResourcePathError) {
            failDurableAtomicFileWrite("input", "$options.expected.resourcePath");
        }
        throw error;
    }
    let byteCount;
    try {
        byteCount = parseByteCount(record.byteCount, "$options.expected.byteCount");
    }
    catch (error) {
        if (error instanceof ByteCountError) {
            failDurableAtomicFileWrite("input", "$options.expected.byteCount");
        }
        throw error;
    }
    let digest;
    try {
        digest = parseSha256Digest(record.digest, "$options.expected.digest");
    }
    catch (error) {
        if (error instanceof Sha256Error) {
            failDurableAtomicFileWrite("input", "$options.expected.digest");
        }
        throw error;
    }
    const node = parseExpectedNode(record.node);
    if (node.byteCount !== byteCount) {
        failDurableAtomicFileWrite("input", "$options.expected.byteCount");
    }
    return Object.freeze({ resourcePath, node, byteCount, digest });
}
export function parseDurableAtomicFileReplaceOptions(value) {
    const record = parseOptionRecord(value, ["expected", "mode"]);
    return Object.freeze({
        mode: parseMode(record.mode),
        expected: parseExpectation(record.expected),
        signal: parseSignal(record.signal),
    });
}
export function snapshotDurableAtomicFileInputBytes(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !ArrayBuffer.isView(value)
        || !(value instanceof Uint8Array)
        || value.buffer instanceof SharedArrayBuffer) {
        failDurableAtomicFileWrite("input", "$bytes");
    }
    const byteCount = parseByteCount(value.byteLength, "$bytes");
    if (byteCount > DURABLE_ATOMIC_FILE_MAXIMUM_BYTES) {
        failDurableAtomicFileWrite("capacity", "$bytes");
    }
    let bytes;
    try {
        bytes = Buffer.from(value);
    }
    catch {
        failDurableAtomicFileWrite("capacity", "$bytes");
    }
    let digest;
    try {
        digest = computeSha256Digest(bytes, "$bytes");
    }
    catch (error) {
        if (error instanceof Sha256Error) {
            failDurableAtomicFileWrite("hash-failure", "$bytes");
        }
        throw error;
    }
    return Object.freeze({ bytes, byteCount, digest });
}
