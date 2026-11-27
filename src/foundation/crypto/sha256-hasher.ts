import { createHash, type Hash } from "node:crypto";

import { type Fail, failWith, ModuleError } from "../error/module-error.js";
import {
  addByteCounts,
  type ByteCount,
  ByteCountError,
  parseByteCount,
} from "../numeric/byte-count.js";
import {
  parseSha256Digest,
  SHA256_DIGEST_PREFIX,
  type Sha256Digest,
  Sha256Error,
} from "./sha256.js";

/**
 * Wakeflow Foundation / Crypto：增量 SHA-256 字节摘要。
 *
 * 本模块为稳定文件读取、目录树扫描和流式重写提供有状态 SHA-256 累加器。每个
 * `Uint8Array` 分块只处理其可见字节，并以 `ByteCount` 累加总量，最终一次性返回
 * `sha256:<hex>` 和精确字节数。
 *
 * 它不读取流或文件、不隐式编码字符串、不设置 I/O 分块大小，也不把摘要
 * 解释为签名、授权或文件身份。并发调用同一个实例不受支持；上层应为每次顺序
 * 读取创建独立实例。
 */

/** 一次增量 SHA-256 完成后的冻结结果。 */
export interface Sha256HashResult {
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
}

/** 增量 SHA-256 失败的稳定分类。 */
export type Sha256HasherErrorReason =
  | "initialization-failure"
  | "byte-count-overflow"
  | "update-failure"
  | "digest-failure"
  | "already-finalized"
  | "failed-state";

/**
 * 增量 SHA-256 生命周期失败的稳定错误。
 *
 * 错误不回显数据分块、累计数量、摘要、Node.js/OpenSSL 消息、调用栈或原因链。
 */
export class Sha256HasherError extends ModuleError<Sha256HasherErrorReason> {
  static override readonly code = "wakeflow-sha256-hasher";
}

type Sha256HasherState = "active" | "finalized" | "failed";

function normalizeErrorPath(path: unknown): string {
  return typeof path === "string" && path.length > 0 ? path : "$bytes";
}

const fail: Fail<Sha256HasherErrorReason> = failWith(Sha256HasherError);

/**
 * 按顺序消费字节分块的单次 SHA-256 累加器。
 *
 * 本类封装 Node.js `Hash` 及其不可逆生命周期。调用方只能从最终冻结结果取得累计
 * 字节数与摘要，不能取得或改写底层哈希器。`digest()` 成功或失败后都不能再次更新
 * 或完成该实例。
 */
export class Sha256Hasher {
  readonly #hash: Hash;
  #state: Sha256HasherState = "active";
  #byteCount: ByteCount = parseByteCount(0);

  constructor() {
    try {
      this.#hash = createHash("sha256");
    } catch {
      fail("initialization-failure", "$hasher");
    }
  }

  /**
   * 消费一个 `Uint8Array` 的精确可见区间，并返回当前实例以支持顺序链式调用。
   *
   * Node.js 更新失败或累计溢出会把实例永久标记为失败，避免调用方继续使用结果不确定的
   * 部分摘要。
   */
  update(bytes: Uint8Array, errorPath?: string): this {
    const path = normalizeErrorPath(errorPath);
    if (this.#state === "finalized") fail("already-finalized", "$hasher");
    if (this.#state === "failed") fail("failed-state", "$hasher");

    let nextByteCount: ByteCount;
    try {
      nextByteCount = addByteCounts(
        this.#byteCount,
        parseByteCount(bytes.byteLength),
        "$byteCount",
      );
    } catch (error: unknown) {
      if (error instanceof ByteCountError) {
        this.#state = "failed";
        fail("byte-count-overflow", "$byteCount");
      }
      throw error;
    }

    try {
      this.#hash.update(bytes);
    } catch {
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
  digest(): Readonly<Sha256HashResult> {
    if (this.#state === "finalized") fail("already-finalized", "$hasher");
    if (this.#state === "failed") fail("failed-state", "$hasher");

    let value: string;
    try {
      value = this.#hash.digest("hex");
    } catch {
      this.#state = "failed";
      fail("digest-failure", "$hasher");
    }

    let digest: Sha256Digest;
    try {
      digest = parseSha256Digest(`${SHA256_DIGEST_PREFIX}${value}`, "$hasher.digest");
    } catch (error: unknown) {
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
