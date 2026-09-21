import { createHash } from "node:crypto";
import { addByteCounts, ByteCountError, parseByteCount, } from "../numeric/byte-count.js";
import { parseSha256Digest, SHA256_DIGEST_PREFIX, Sha256Error, } from "./sha256.js";
const ERROR_MESSAGES = {
    "initialization-failure": "The incremental SHA-256 operation could not be initialized.",
    "input-type": "Incremental SHA-256 input must be a Uint8Array byte sequence.",
    "byte-count-overflow": "Incremental SHA-256 byte count exceeds the safe integer range.",
    "update-failure": "The incremental SHA-256 operation failed while consuming bytes.",
    "digest-failure": "The incremental SHA-256 operation failed while producing its digest.",
    "already-finalized": "The incremental SHA-256 operation has already been finalized.",
    "failed-state": "The incremental SHA-256 operation is unusable after an earlier failure.",
};
/**
 * 增量 SHA-256 生命周期失败的稳定错误。
 *
 * 错误不回显数据分块、累计数量、摘要、Node.js/OpenSSL 消息、调用栈或原因链。
 */
export class Sha256HasherError extends Error {
    name = "Sha256HasherError";
    code = "wakeflow-sha256-hasher";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function normalizeErrorPath(path) {
    return typeof path === "string" && path.length > 0 ? path : "$bytes";
}
function fail(reason, path) {
    throw new Sha256HasherError(reason, path);
}
function isUint8Array(value) {
    return ArrayBuffer.isView(value) && value instanceof Uint8Array;
}
/**
 * 按顺序消费字节分块的单次 SHA-256 累加器。
 *
 * 本类封装 Node.js `Hash` 及其不可逆生命周期。调用方只能从最终冻结结果取得累计
 * 字节数与摘要，不能取得或改写底层哈希器。`digest()` 成功或失败后都不能再次更新
 * 或完成该实例。
 */
export class Sha256Hasher {
    #hash;
    #state = "active";
    #byteCount = parseByteCount(0);
    constructor() {
        try {
            this.#hash = createHash("sha256");
        }
        catch {
            fail("initialization-failure", "$hasher");
        }
    }
    /**
     * 消费一个 `Uint8Array` 的精确可见区间，并返回当前实例以支持顺序链式调用。
     *
     * 输入类型错误发生在任何状态改变之前。Node.js 更新失败或累计溢出会把实例永久
     * 标记为失败，避免调用方继续使用结果不确定的部分摘要。
     */
    update(bytes, errorPath) {
        const path = normalizeErrorPath(errorPath);
        if (this.#state === "finalized")
            fail("already-finalized", "$hasher");
        if (this.#state === "failed")
            fail("failed-state", "$hasher");
        if (!isUint8Array(bytes))
            fail("input-type", path);
        let nextByteCount;
        try {
            nextByteCount = addByteCounts(this.#byteCount, parseByteCount(bytes.byteLength), "$byteCount");
        }
        catch (error) {
            if (error instanceof ByteCountError) {
                this.#state = "failed";
                fail("byte-count-overflow", "$byteCount");
            }
            throw error;
        }
        try {
            this.#hash.update(bytes);
        }
        catch {
            this.#state = "failed";
            fail("update-failure", path);
        }
        this.#byteCount = nextByteCount;
        return this;
    }
    /**
     * 完成增量 SHA-256，并返回完整 prefixed digest 与累计字节数。
     *
     * 空输入合法。完成操作只能调用一次；Node.js 摘要计算或词法复验失败都会让实例
     * 永久进入不可用状态。
     */
    digest() {
        if (this.#state === "finalized")
            fail("already-finalized", "$hasher");
        if (this.#state === "failed")
            fail("failed-state", "$hasher");
        let value;
        try {
            value = this.#hash.digest("hex");
        }
        catch {
            this.#state = "failed";
            fail("digest-failure", "$hasher");
        }
        let digest;
        try {
            digest = parseSha256Digest(`${SHA256_DIGEST_PREFIX}${value}`, "$hasher.digest");
        }
        catch (error) {
            if (error instanceof Sha256Error) {
                this.#state = "failed";
                fail("digest-failure", "$hasher");
            }
            throw error;
        }
        this.#state = "finalized";
        return Object.freeze({
            byteCount: this.#byteCount,
            digest,
        });
    }
}
