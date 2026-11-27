import { computeSha256Digest, type Sha256Digest, Sha256Error } from "../crypto/sha256.js";
import { type Fail, failWith, ModuleError } from "../error/module-error.js";
import { type ByteCount, parseByteCount } from "../numeric/byte-count.js";
import type { FileNodeSnapshot } from "./file-node-snapshot.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import type { StableFileSource } from "./stable-file-read.js";

/** 耐久原子文件写入的公共合同、输入快照和稳定错误。 */

export const DURABLE_ATOMIC_FILE_MAXIMUM_BYTES = parseByteCount(
  64 * 1024 * 1024,
  "$durableAtomicFile.maximumBytes",
);

/**
 * `fsync`：文件与父目录都同步到持久介质，权威事实必须用它；
 * `none`：只保证 rename/link 的原子可见性，不做任何同步，只用于可重建的派生检查点。
 */
export type DurableAtomicFileDurability = "fsync" | "none";

/**
 * 逐次写入的 `durability` 只是“这一条记录放弃同步”的窄豁免，
 * 不是持久化级别的权威：级别由根决定（见 `rooted-directory.ts`）。
 * 两者取更弱的一档——根为 `none` 时整棵树都不同步，根为 `fsync` 时仍允许
 * 单次创建按记录种类降到 `none`。替换没有这个选项。
 */
export interface DurableAtomicFileCreateOptions {
  readonly mode: number;
  readonly durability?: DurableAtomicFileDurability;
  readonly signal?: AbortSignal;
}

/** 替换操作所需、与目标资源路径绑定的完整前序稳定读取事实。 */
export type DurableAtomicFileExpectation = Readonly<StableFileSource>;

/** 替换没有逐次 `durability`：档表没有要降档的替换（锁不替换），级别只跟随根。 */
export interface DurableAtomicFileReplaceOptions {
  readonly mode: number;
  readonly expected: DurableAtomicFileExpectation;
  readonly signal?: AbortSignal;
}

export type DurableAtomicFilePublication = "created" | "replaced";

/** 成功结果只描述已经复验并完成父目录同步的最终目标。 */
export interface DurableAtomicFileWriteResult<
  Publication extends DurableAtomicFilePublication = DurableAtomicFilePublication,
> {
  readonly resourcePath: PortableResourcePath;
  readonly publication: Publication;
  readonly node: Readonly<FileNodeSnapshot>;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
}

/** 替换成功后，同时签发已经核验的完整前序源资源。 */
export interface DurableAtomicFileReplaceResult extends DurableAtomicFileWriteResult<"replaced"> {
  readonly previous: Readonly<DurableAtomicFileExpectation>;
}

export type DurableAtomicFileWriteErrorReason =
  | "input"
  | "root-scope"
  | "parent-not-found"
  | "parent-symlink"
  | "parent-not-directory"
  | "parent-open-failure"
  | "parent-changed"
  | "target-exists"
  | "target-inspection-failure"
  | "expectation-changed"
  | "expectation-read-failure"
  | "hash-failure"
  | "capacity"
  | "stage-create-failure"
  | "stage-write-failure"
  | "stage-sync-failure"
  | "stage-changed"
  | "publish-failure"
  | "commit-uncertain"
  | "durability-failure"
  | "stage-cleanup-failure"
  | "stage-recovery-required"
  | "close-failure";

/** 耐久单文件写入的稳定、脱敏错误。 */
export class DurableAtomicFileWriteError extends ModuleError<DurableAtomicFileWriteErrorReason> {
  static override readonly code = "wakeflow-durable-atomic-file-write";
  /**
   * 结果不确定的失败：目标可能已经发布，也可能没有，调用方不能读作“没写”。
   * `stage-recovery-required` 报在写入开始之前，不在其列。
   */
  readonly commitUncertain: boolean;

  constructor(reason: DurableAtomicFileWriteErrorReason, path: string, options?: ErrorOptions) {
    super(reason, path, options);
    this.commitUncertain =
      reason === "commit-uncertain" ||
      reason === "durability-failure" ||
      reason === "stage-cleanup-failure" ||
      reason === "close-failure";
  }
}

export interface DurableAtomicFileInputBytes {
  readonly bytes: Buffer;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
}

export const failDurableAtomicFileWrite: Fail<DurableAtomicFileWriteErrorReason> = failWith(
  DurableAtomicFileWriteError,
);

/**
 * 字节的私有副本、容量与摘要：先复制再算摘要，调用方之后改它自己的数组不影响写下的内容。
 * 字节类型由签名保证，不再复验。
 */
export function snapshotDurableAtomicFileInputBytes(
  value: Uint8Array,
): Readonly<DurableAtomicFileInputBytes> {
  const byteCount = parseByteCount(value.byteLength, "$bytes");
  if (byteCount > DURABLE_ATOMIC_FILE_MAXIMUM_BYTES) {
    failDurableAtomicFileWrite("capacity", "$bytes");
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(value);
  } catch (cause: unknown) {
    failDurableAtomicFileWrite("capacity", "$bytes", cause);
  }
  let digest: Sha256Digest;
  try {
    digest = computeSha256Digest(bytes, "$bytes");
  } catch (error: unknown) {
    if (error instanceof Sha256Error) {
      failDurableAtomicFileWrite("hash-failure", "$bytes", error);
    }
    throw error;
  }
  return Object.freeze({ bytes, byteCount, digest });
}
