import { DeterministicJsonDocumentError } from "../../foundation/data/deterministic-json-document.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import { createFileAtomically, DurableAtomicFileWriteError, replaceFileAtomically, } from "../../foundation/filesystem/durable-atomic-file-write.js";
import { StableFileReadError, } from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { fail } from "../../kernel/error.js";
/**
 * Wakeflow Workspace / Window Runtime：窗口运行投影文档的落盘与零写检查。
 *
 * 投影是派生数据：登记、替换、退役与对账都用当前权威重算一份确定性 JSON 文档并整体替换。
 * 本模块只认字节：磁盘文档与目标文档相同即 `current`，是合法确定性 JSON 但内容不同即
 * `stale`，不存在即 `missing`，读不出、不是普通文件或不是确定性 JSON 即 `unsafe`。
 * 谁来决定目标文档（未登记还是已登记）由调用方负责。
 */
export const WAKEFLOW_WINDOW_RUNTIME_PROJECTION_MAXIMUM_BYTES = parseByteCount(256 * 1024, "$projection.maximumBytes");
export const WAKEFLOW_WINDOW_RUNTIME_PROJECTION_FILE_MODE = 0o600;
function sourceOf(current) {
    return Object.freeze({
        resourcePath: current.resourcePath,
        node: current.node,
        byteCount: current.byteCount,
        digest: current.digest,
    });
}
/** 零写判定磁盘上的投影文档相对目标文档的状态；任何读不稳的文档都是 `unsafe`。 */
export async function inspectWakeflowWindowRuntimeProjectionDocument(root, target, signal) {
    let current;
    try {
        current = await readDeterministicJsonFile(root, target.resourceRef, {
            maximumBytes: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_MAXIMUM_BYTES,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof StableFileReadError) {
            if (error.reason === "aborted")
                fail("io-failure", "aborted", "$signal");
            if (error.reason === "not-found") {
                return Object.freeze({
                    resourceRef: target.resourceRef,
                    status: "missing",
                    currentDigest: null,
                    source: null,
                });
            }
            if (error.reason === "root-scope" || error.reason === "input") {
                fail("io-failure", `projection-read-${error.reason}`, "$projection", { cause: error });
            }
        }
        if (error instanceof StableFileReadError
            || error instanceof StrictTextFileError
            || error instanceof DeterministicJsonDocumentError) {
            return Object.freeze({
                resourceRef: target.resourceRef,
                status: "unsafe",
                currentDigest: null,
                source: null,
            });
        }
        throw error;
    }
    return Object.freeze({
        resourceRef: target.resourceRef,
        status: current.text === target.document ? "current" : "stale",
        currentDigest: current.digest,
        source: sourceOf(current),
    });
}
/** 让磁盘上的投影文档等于目标文档；已相等则不写。 */
export async function publishWakeflowWindowRuntimeProjectionDocument(root, target, signal) {
    const options = signal === undefined ? {} : { signal };
    let current = null;
    try {
        current = await readDeterministicJsonFile(root, target.resourceRef, {
            maximumBytes: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_MAXIMUM_BYTES,
            ...options,
        });
    }
    catch (error) {
        if (!(error instanceof StableFileReadError && error.reason === "not-found")) {
            if (error instanceof StableFileReadError) {
                if (error.reason === "aborted")
                    fail("io-failure", "aborted", "$signal");
                fail("io-failure", `projection-read-${error.reason}`, "$projection", { cause: error });
            }
            if (error instanceof StrictTextFileError || error instanceof DeterministicJsonDocumentError) {
                fail("io-failure", "projection-read-unsafe", "$projection", { cause: error });
            }
            throw error;
        }
    }
    const bytes = encodeUtf8(target.document, "$projection");
    let disposition = "current";
    try {
        if (current === null) {
            await createFileAtomically(root, target.resourceRef, bytes, {
                mode: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_FILE_MODE,
                ...options,
            });
            disposition = "created";
        }
        else if (current.text !== target.document) {
            await replaceFileAtomically(root, target.resourceRef, bytes, {
                mode: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_FILE_MODE,
                expected: sourceOf(current),
                ...options,
            });
            disposition = "replaced";
        }
    }
    catch (error) {
        if (error instanceof DurableAtomicFileWriteError) {
            if (error.reason === "aborted")
                fail("io-failure", "aborted", "$signal");
            fail("io-failure", `projection-write-${error.reason}`, "$projection", { cause: error });
        }
        throw error;
    }
    return Object.freeze({
        resourceRef: target.resourceRef,
        projectionDigest: target.projectionDigest,
        documentDigest: target.documentDigest,
        disposition,
    });
}
