import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import type {
  DurableAtomicFileReplaceResult,
  DurableAtomicFileWriteResult,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import type { KernelFileLockError } from "../../foundation/filesystem/kernel-file-lock.js";
import {
  type RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import { requireCurrentUserId } from "../../foundation/node/current-user.js";
import type { WorkspaceLockOptions } from "../../kernel/workspace-locks.js";
import type { WakeflowWorkspaceStaticResourceMatrix } from "../wakeflow-workspace-static-resource-matrix.js";
import type { WakeflowWorkspaceHostResourceProfile } from "../workspace-host-resource-profile.js";
import type { WakeflowGitignoreInspection } from "./wakeflow-gitignore-inspection.js";

/**
 * Gitignore 重组与显式恢复共享的输入、错误和机械操作准入合同。
 *
 * 本模块只执行被动数据快照、规范矩阵绑定、完整 Host Profile 集合准入、POSIX 根策略
 * 和锁 recipe 准入；不读取 `.gitignore`、不取得锁、不发布字节或退休恢复残留。
 */

export const WAKEFLOW_GITIGNORE_FILE_MODE = 0o644;
const WAKEFLOW_GITIGNORE_RECOMPOSITION_LOCK_TIMEOUT_MILLISECONDS = 10_000;

export interface WakeflowGitignoreRecompositionRequest {
  readonly matrix: Readonly<WakeflowWorkspaceStaticResourceMatrix>;
  readonly expectedMatrixDigest: Sha256Digest;
  readonly hostProfiles: readonly Readonly<WakeflowWorkspaceHostResourceProfile>[];
}

export interface WakeflowGitignoreRecompositionOptions {
  readonly acquireTimeoutMilliseconds?: number;
  readonly retryDelayMilliseconds?: number;
  readonly signal?: AbortSignal;
}

export type WakeflowGitignoreRecompositionEffect =
  | Readonly<DurableAtomicFileWriteResult<"created">>
  | Readonly<DurableAtomicFileReplaceResult>;

export interface WakeflowGitignoreRecompositionReceipt {
  readonly disposition: "current" | "created" | "replaced";
  readonly effect: Readonly<WakeflowGitignoreRecompositionEffect> | null;
  readonly inspection: Readonly<WakeflowGitignoreInspection>;
}

export type WakeflowGitignoreRecompositionErrorReason =
  | "input"
  | "unsupported-platform"
  | "root-scope"
  | "root-policy"
  | "source-invalid"
  | "observation-failure"
  | "capacity"
  | "conflict"
  | "lock-timeout"
  | "lock-unsafe"
  | "recovery-required"
  | "effect-failure"
  | "commit-uncertain";

/** Gitignore 重组与恢复失败的稳定、脱敏错误。 */
export class WakeflowGitignoreRecompositionError extends ModuleError<WakeflowGitignoreRecompositionErrorReason> {
  static override readonly code = "wakeflow-gitignore-recomposition";
}

export const failWakeflowGitignoreRecomposition: Fail<WakeflowGitignoreRecompositionErrorReason> =
  failWith(WakeflowGitignoreRecompositionError);

export function currentWakeflowGitignoreRecompositionUserId(): bigint {
  return requireCurrentUserId(() =>
    failWakeflowGitignoreRecomposition("unsupported-platform", "$root"),
  );
}

export async function assertCurrentUserWakeflowGitignoreRecompositionRoot(
  root: RootedDirectory,
  expectedUserId: bigint,
): Promise<void> {
  try {
    const node = await root.assertCurrent("$root");
    if (node.userId !== expectedUserId) {
      failWakeflowGitignoreRecomposition("root-policy", "$root");
    }
  } catch (error: unknown) {
    if (error instanceof WakeflowGitignoreRecompositionError) throw error;
    if (error instanceof RootedDirectoryError) {
      failWakeflowGitignoreRecomposition("root-scope", "$root", error);
    }
    throw error;
  }
}

export function wakeflowGitignoreInspectionRequest(
  request: Readonly<WakeflowGitignoreRecompositionRequest>,
  signal: AbortSignal | undefined,
) {
  return Object.freeze({
    matrix: request.matrix,
    expectedMatrixDigest: request.expectedMatrixDigest,
    hostProfiles: request.hostProfiles,
    ...(signal === undefined ? {} : { signal }),
  });
}

export function wakeflowGitignoreRecompositionLockOptions({
  acquireTimeoutMilliseconds = WAKEFLOW_GITIGNORE_RECOMPOSITION_LOCK_TIMEOUT_MILLISECONDS,
  retryDelayMilliseconds,
  signal,
}: WakeflowGitignoreRecompositionOptions): WorkspaceLockOptions {
  return {
    acquireTimeoutMilliseconds,
    ...(retryDelayMilliseconds === undefined ? {} : { retryDelayMilliseconds }),
    ...(signal === undefined ? {} : { signal }),
  };
}

/** `.gitignore` 重组锁（ADR-0033）的失败：已经提交之后的任何失败都是提交结果不确定。 */
export function mapWakeflowGitignoreRecompositionLockError(
  error: KernelFileLockError,
  committed: boolean,
): never {
  if (committed) {
    failWakeflowGitignoreRecomposition("commit-uncertain", "$resourcePath");
  }
  if (error.reason === "input") {
    failWakeflowGitignoreRecomposition("input", error.path);
  }
  if (error.reason === "timeout") {
    failWakeflowGitignoreRecomposition("lock-timeout", "$lock");
  }
  failWakeflowGitignoreRecomposition("lock-unsafe", "$lock");
}
