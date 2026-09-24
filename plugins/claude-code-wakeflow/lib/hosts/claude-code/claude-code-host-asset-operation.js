import { types } from "node:util";
import { parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { PassiveOwnDataError, parsePlainRecord, } from "../../foundation/data/passive-own-data.js";
import { createFileAtomically, DurableAtomicFileWriteError, replaceFileAtomically, } from "../../foundation/filesystem/durable-atomic-file-write.js";
import { DurableDirectoryMaterializationError, materializeDirectoryPath, } from "../../foundation/filesystem/durable-directory-materialization.js";
import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { readStableFile, StableFileReadError, } from "../../foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { hostRuntimeRootRef } from "../../kernel/layout.js";
const ERROR_MESSAGES = {
    input: "Claude host asset operation input is invalid.",
    operation: "Claude host asset operation payload is invalid.",
    read: "Claude host asset could not be read safely.",
    "source-stale": "Claude host asset changed since the plan was made.",
    write: "Claude host asset could not be written safely.",
    aborted: "Claude host asset operation was aborted.",
};
/** 宿主资产操作失败的稳定、脱敏错误。 */
export class ClaudeCodeHostAssetOperationError extends Error {
    name = "ClaudeCodeHostAssetOperationError";
    code = "wakeflow-claude-code-host-asset-operation";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new ClaudeCodeHostAssetOperationError(reason, path);
}
const ASSET_MAXIMUM_BYTES = parseByteCount(256 * 1024, "$asset.maximumBytes");
const ASSET_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const ASSETS_DIRECTORY_REF = parsePortableResourcePath(`${hostRuntimeRootRef("claude-code")}/operations/assets`, "$asset");
function signalOptions(signal) {
    return signal === undefined ? {} : { signal };
}
function assertRoot(root) {
    if (typeof root !== "object"
        || root === null
        || types.isProxy(root)
        || !(root instanceof RootedDirectory)) {
        fail("input", "$root");
    }
}
/** 当前资产的稳定来源；缺失为 null。 */
async function currentAsset(root, asset, signal) {
    try {
        const read = await readStableFile(root, asset.ref, {
            maximumBytes: ASSET_MAXIMUM_BYTES,
            ...signalOptions(signal),
        });
        return Object.freeze({
            resourcePath: read.resourcePath,
            node: read.node,
            byteCount: read.byteCount,
            digest: read.digest,
        });
    }
    catch (error) {
        if (error instanceof StableFileReadError) {
            if (error.reason === "not-found")
                return null;
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("read", "$asset");
        }
        throw error;
    }
}
/** 零写计划：字节已是期望即 null，否则一条操作（sourceDigest 是当前字节摘要或 null）。 */
export async function planClaudeCodeHostAssetOperation(root, asset, options = {}) {
    assertRoot(root);
    const current = await currentAsset(root, asset, options.signal);
    if (current !== null
        && current.digest === asset.digest
        && current.node.permissionBits === ASSET_MODE) {
        return null;
    }
    return Object.freeze({
        operationId: asset.operationId,
        operationKind: asset.operationKind,
        ownerId: asset.ownerId,
        targetKey: asset.targetKey,
        sourceDigest: current?.digest ?? null,
        targetDigest: asset.digest,
        payload: {
            fileName: asset.fileName,
            digest: asset.digest,
        },
    });
}
function parsePayload(value, asset) {
    let record;
    try {
        record = parsePlainRecord(value, "$operation");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("operation", error.path);
        throw error;
    }
    let digest;
    try {
        digest = parseSha256Digest(record.digest, "$operation.digest");
    }
    catch (error) {
        if (error instanceof Sha256Error)
            fail("operation", "$operation.digest");
        throw error;
    }
    if (Object.keys(record).sort().join(" ") !== "digest fileName"
        || record.fileName !== asset.fileName
        || digest !== asset.digest) {
        fail("operation", "$operation");
    }
    return Object.freeze({ fileName: asset.fileName, digest });
}
async function ensureAssetsDirectory(root, signal) {
    try {
        await materializeDirectoryPath(root, ASSETS_DIRECTORY_REF, {
            mode: DIRECTORY_MODE,
            ...signalOptions(signal),
        });
    }
    catch (error) {
        if (error instanceof DurableDirectoryMaterializationError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("write", "$asset.directory");
        }
        throw error;
    }
}
/** 执行：缺失创建、不同 CAS 替换；已是期望字节即 current（恢复与普通执行同一判定）。 */
export async function executeClaudeCodeHostAssetOperation(root, asset, request) {
    assertRoot(root);
    const payload = parsePayload(request.operation, asset);
    const current = await currentAsset(root, asset, request.signal);
    if (current !== null
        && current.digest === payload.digest
        && current.node.permissionBits === ASSET_MODE) {
        return Object.freeze({
            operationId: asset.operationId,
            disposition: "current",
            targetDigest: payload.digest,
        });
    }
    const bytes = encodeUtf8(asset.content, "$asset");
    try {
        if (current === null) {
            await ensureAssetsDirectory(root, request.signal);
            await createFileAtomically(root, asset.ref, bytes, {
                mode: ASSET_MODE,
                ...signalOptions(request.signal),
            });
            return Object.freeze({
                operationId: asset.operationId,
                disposition: "created",
                targetDigest: payload.digest,
            });
        }
        await replaceFileAtomically(root, asset.ref, bytes, {
            mode: ASSET_MODE,
            expected: current,
            ...signalOptions(request.signal),
        });
    }
    catch (error) {
        if (error instanceof DurableAtomicFileWriteError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "expectation-changed" || error.reason === "target-exists") {
                fail("source-stale", "$asset");
            }
            fail("write", "$asset");
        }
        throw error;
    }
    return Object.freeze({
        operationId: asset.operationId,
        disposition: "updated",
        targetDigest: payload.digest,
    });
}
