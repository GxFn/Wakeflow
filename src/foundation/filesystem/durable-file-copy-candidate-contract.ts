import type { Sha256Digest } from "../crypto/sha256.js";
import { type Fail, failWith, ModuleError } from "../error/module-error.js";
import type { ByteCount } from "../numeric/byte-count.js";
import { createFileNodeSnapshot, type FileNodeSnapshot } from "./file-node-snapshot.js";
import {
  type PortableResourcePath,
  PortableResourcePathError,
  parsePortableResourcePath,
} from "./portable-resource-path.js";
import type { StableFileSource } from "./stable-file-read.js";

/**
 * 跨根流式文件候选的公共数据、容量、错误与路径复验合同。预期与选项是类型化的，不再被动准入
 * （1.4.5 层次计划 A）。
 *
 * 本模块不打开文件、不创建候选、不读取或散列字节，也不执行清理。具体 I/O 生命周期
 * 由 `durable-file-copy-candidate` 唯一拥有。
 */

export interface DurableFileCopyContentExpectation {
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
  readonly expectedNode?: Readonly<FileNodeSnapshot>;
}

export interface DurableFileCopyCandidateOptions {
  readonly maximumBytes: ByteCount;
  readonly mode: number;
  readonly signal?: AbortSignal;
}

export interface DurableFileCopyCandidateResult {
  readonly source: Readonly<StableFileSource>;
  readonly candidate: Readonly<StableFileSource>;
}

export type DurableFileCopyCandidateErrorReason =
  | "input"
  | "capacity"
  | "source-root-scope"
  | "source-not-found"
  | "source-symlink"
  | "source-not-file"
  | "source-changed"
  | "source-mismatch"
  | "source-read-failure"
  | "destination-root-scope"
  | "destination-parent"
  | "target-exists"
  | "candidate-create-failure"
  | "candidate-write-failure"
  | "candidate-sync-failure"
  | "candidate-changed"
  | "durability-failure"
  | "cleanup-failure"
  | "close-failure";

/** 跨根流式文件候选失败的稳定、脱敏错误。 */
export class DurableFileCopyCandidateError extends ModuleError<DurableFileCopyCandidateErrorReason> {
  static override readonly code = "wakeflow-durable-file-copy-candidate";
}

export const failDurableFileCopyCandidate: Fail<DurableFileCopyCandidateErrorReason> = failWith(
  DurableFileCopyCandidateError,
);

/** 本层自己的资源路径词法复验（1.4.5 层次计划 A，R6：foundation/filesystem 内保留）。 */
export function parseDurableFileCopyPath(value: unknown, path: string): PortableResourcePath {
  try {
    return parsePortableResourcePath(value, path);
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      failDurableFileCopyCandidate("input", path, error);
    }
    throw error;
  }
}

export function snapshotDurableFileCopyNode(
  value: unknown,
  reason: DurableFileCopyCandidateErrorReason,
  path: string,
): Readonly<FileNodeSnapshot> {
  try {
    return createFileNodeSnapshot(value, path);
  } catch (cause: unknown) {
    failDurableFileCopyCandidate(reason, path, cause);
  }
}
