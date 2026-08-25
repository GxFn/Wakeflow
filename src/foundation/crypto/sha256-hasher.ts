import { createHash, type Hash } from "node:crypto";

import {
  addByteCounts,
  ByteCountError,
  parseByteCount,
  type ByteCount,
} from "../numeric/byte-count.js";
import {
  parseSha256Digest,
  parseSha256Hex,
  SHA256_DIGEST_PREFIX,
  Sha256Error,
  type Sha256Digest,
  type Sha256Hex,
} from "./sha256.js";

/**
 * Wakeflow Foundation / Crypto：增量 SHA-256 字节摘要。
 *
 * 本文件为稳定文件读取、树扫描和流式重写提供有状态 SHA-256 accumulator：每个
 * Uint8Array chunk 只处理其可见字节，同时以 ByteCount 累加总量，最终一次性返回
 * lowercase hex、`sha256:<hex>` 和准确字节数。
 *
 * 它不读取 Stream 或文件、不隐式编码字符串、不设置 I/O chunk 大小，也不把摘要
 * 解释为签名、授权或文件身份。并发调用同一个实例不受支持；上层应为每次顺序
 * 读取创建独立实例。
 */

/** 一次增量 SHA-256 完成后的冻结结果。 */
export interface Sha256HashResult {
  readonly byteCount: ByteCount;
  readonly hex: Sha256Hex;
  readonly digest: Sha256Digest;
}

/** 增量 SHA-256 失败的稳定分类。 */
export type Sha256HasherErrorReason =
  | "initialization-failure"
  | "input-type"
  | "byte-count-overflow"
  | "update-failure"
  | "digest-failure"
  | "already-finalized"
  | "failed-state";

const ERROR_MESSAGES = {
  "initialization-failure": "The incremental SHA-256 operation could not be initialized.",
  "input-type": "Incremental SHA-256 input must be a Uint8Array byte sequence.",
  "byte-count-overflow": "Incremental SHA-256 byte count exceeds the safe integer range.",
  "update-failure": "The incremental SHA-256 operation failed while consuming bytes.",
  "digest-failure": "The incremental SHA-256 operation failed while producing its digest.",
  "already-finalized": "The incremental SHA-256 operation has already been finalized.",
  "failed-state": "The incremental SHA-256 operation is unusable after an earlier failure.",
} as const satisfies Readonly<Record<Sha256HasherErrorReason, string>>;

/**
 * 增量 SHA-256 生命周期失败的稳定错误。
 *
 * 错误不回显 chunk、累计数量、摘要、Node/OpenSSL message、stack 或 cause。
 */
export class Sha256HasherError extends Error {
  override readonly name = "Sha256HasherError";
  readonly code = "wakeflow-sha256-hasher" as const;
  readonly reason: Sha256HasherErrorReason;
  readonly path: string;

  constructor(reason: Sha256HasherErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

type Sha256HasherState = "active" | "finalized" | "failed";

function normalizeErrorPath(path: unknown): string {
  return typeof path === "string" && path.length > 0 ? path : "$bytes";
}

function fail(
  reason: Sha256HasherErrorReason,
  path: string,
): never {
  throw new Sha256HasherError(reason, path);
}

function isUint8Array(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && value instanceof Uint8Array;
}

/**
 * 顺序消费字节 chunk 的单次 SHA-256 accumulator。
 *
 * class 用于封装 Node Hash 与不可逆生命周期；调用方只能读取累计 byteCount，不能
 * 取得或改写底层 Hash。digest() 成功或失败后均不可再次 update/finalize。
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

  /** 当前已经成功提交给 Hash 的准确字节数。 */
  get byteCount(): ByteCount {
    return this.#byteCount;
  }

  /**
   * 消费一个准确的 Uint8Array 可见区间并返回当前实例，支持顺序链式调用。
   *
   * 输入类型失败发生在任何状态改变之前；Node update 或累计溢出则把实例永久
   * 标记为 failed，避免调用方把不确定的部分摘要继续当作有效状态。
   */
  update(
    bytes: Uint8Array,
    errorPath?: string,
  ): this {
    const path = normalizeErrorPath(errorPath);
    if (this.#state === "finalized") fail("already-finalized", "$hasher");
    if (this.#state === "failed") fail("failed-state", "$hasher");
    if (!isUint8Array(bytes)) fail("input-type", path);

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
   * 完成增量 SHA-256，并返回同一摘要的两种完整词法与累计字节数。
   *
   * 空输入合法。调用恰好一次；Node digest 或词法复验失败都会永久关闭实例。
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

    let hex: Sha256Hex;
    let digest: Sha256Digest;
    try {
      hex = parseSha256Hex(value, "$hasher.hex");
      digest = parseSha256Digest(
        `${SHA256_DIGEST_PREFIX}${hex}`,
        "$hasher.digest",
      );
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
      hex,
      digest,
    });
  }
}
