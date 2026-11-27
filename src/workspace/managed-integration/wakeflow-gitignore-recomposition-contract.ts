import { types } from "node:util";

import {
  parseSha256Digest,
  type Sha256Digest,
  Sha256Error,
} from "../../foundation/crypto/sha256.js";
import {
  PassiveOwnDataError,
  parseDenseArray,
  parsePlainRecord,
} from "../../foundation/data/passive-own-data.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import type {
  DurableAtomicFileReplaceResult,
  DurableAtomicFileWriteResult,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import type { KernelFileLockError } from "../../foundation/filesystem/kernel-file-lock.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import { isAbortSignal } from "../../foundation/node/abort-signal.js";
import { requireCurrentUserId } from "../../foundation/node/current-user.js";
import type { WorkspaceLockOptions } from "../../kernel/workspace-locks.js";
import {
  createWakeflowWorkspaceStaticResourceMatrix,
  parseWakeflowWorkspaceStaticResourceMatrix,
  type WakeflowWorkspaceStaticResourceMatrix,
  WakeflowWorkspaceStaticResourceMatrixError,
} from "../wakeflow-workspace-static-resource-matrix.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WAKEFLOW_WORKSPACE_HOST_IDS,
  type WakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
} from "../workspace-host-resource-profile.js";
import {
  createWakeflowGitignoreBodyAuthority,
  WakeflowGitignoreBodyAuthorityError,
} from "./wakeflow-gitignore-body-authority.js";
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
  readonly hostProfiles: readonly unknown[];
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

export interface ParsedWakeflowGitignoreRecompositionRequest {
  readonly matrix: Readonly<WakeflowWorkspaceStaticResourceMatrix>;
  readonly expectedMatrixDigest: Sha256Digest;
  readonly hostProfiles: readonly Readonly<WakeflowWorkspaceHostResourceProfile>[];
}

export interface ParsedWakeflowGitignoreRecompositionOptions {
  readonly acquireTimeoutMilliseconds: number;
  readonly retryDelayMilliseconds: number | undefined;
  readonly signal: AbortSignal | undefined;
}

export const failWakeflowGitignoreRecomposition: Fail<WakeflowGitignoreRecompositionErrorReason> =
  failWith(WakeflowGitignoreRecompositionError);

export function assertWakeflowGitignoreRecompositionRoot(
  value: unknown,
): asserts value is RootedDirectory {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    !(value instanceof RootedDirectory)
  ) {
    failWakeflowGitignoreRecomposition("input", "$root");
  }
}

function plainRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      failWakeflowGitignoreRecomposition("input", path, error);
    }
    throw error;
  }
}

function parseProfiles(value: unknown): readonly Readonly<WakeflowWorkspaceHostResourceProfile>[] {
  let values: readonly unknown[];
  try {
    values = parseDenseArray(value, WAKEFLOW_WORKSPACE_HOST_IDS.length, "$request.hostProfiles");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      failWakeflowGitignoreRecomposition("input", "$request.hostProfiles", error);
    }
    throw error;
  }
  const parsed = values.map((profile, index) => {
    try {
      return parseWakeflowWorkspaceHostResourceProfile(profile);
    } catch (error: unknown) {
      if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
        failWakeflowGitignoreRecomposition("input", `$request.hostProfiles/${index}`, error);
      }
      throw error;
    }
  });
  try {
    createWakeflowGitignoreBodyAuthority(parsed);
  } catch (error: unknown) {
    if (error instanceof WakeflowGitignoreBodyAuthorityError) {
      failWakeflowGitignoreRecomposition("input", "$request.hostProfiles", error);
    }
    throw error;
  }
  const byHostId = new Map(parsed.map((profile) => [profile.hostId, profile]));
  return Object.freeze(
    WAKEFLOW_WORKSPACE_HOST_IDS.map((hostId) => {
      const profile = byHostId.get(hostId);
      if (profile === undefined) {
        failWakeflowGitignoreRecomposition("input", "$request.hostProfiles");
      }
      return profile;
    }),
  );
}

export function parseWakeflowGitignoreRecompositionRequest(
  value: unknown,
): Readonly<ParsedWakeflowGitignoreRecompositionRequest> {
  const record = plainRecord(value, "$request");
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "expectedMatrixDigest" ||
    keys[1] !== "hostProfiles" ||
    keys[2] !== "matrix"
  ) {
    failWakeflowGitignoreRecomposition("input", "$request");
  }
  let matrix: Readonly<WakeflowWorkspaceStaticResourceMatrix>;
  try {
    matrix = parseWakeflowWorkspaceStaticResourceMatrix(record.matrix);
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceStaticResourceMatrixError) {
      failWakeflowGitignoreRecomposition("input", "$request.matrix", error);
    }
    throw error;
  }
  let expectedMatrixDigest: Sha256Digest;
  try {
    expectedMatrixDigest = parseSha256Digest(
      record.expectedMatrixDigest,
      "$request.expectedMatrixDigest",
    );
  } catch (error: unknown) {
    if (error instanceof Sha256Error) {
      failWakeflowGitignoreRecomposition("input", "$request.expectedMatrixDigest", error);
    }
    throw error;
  }
  if (expectedMatrixDigest !== matrix.matrixDigest) {
    failWakeflowGitignoreRecomposition("input", "$request.expectedMatrixDigest");
  }
  const hostProfiles = parseProfiles(record.hostProfiles);
  const currentProfile = hostProfiles.find((profile) => profile.hostId === matrix.hostId);
  if (
    currentProfile === undefined ||
    createWakeflowWorkspaceStaticResourceMatrix(currentProfile).matrixDigest !== matrix.matrixDigest
  ) {
    failWakeflowGitignoreRecomposition("input", "$request.matrix");
  }
  return Object.freeze({ matrix, expectedMatrixDigest, hostProfiles });
}

function positiveMilliseconds(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > 300_000) {
    failWakeflowGitignoreRecomposition("input", path);
  }
  return value;
}

export function parseWakeflowGitignoreRecompositionOptions(
  value: unknown,
): Readonly<ParsedWakeflowGitignoreRecompositionOptions> {
  const record = plainRecord(value === undefined ? {} : value, "$options");
  const allowed = new Set(["acquireTimeoutMilliseconds", "retryDelayMilliseconds", "signal"]);
  if (
    Object.keys(record).some((key) => !allowed.has(key)) ||
    (record.signal !== undefined && !isAbortSignal(record.signal))
  ) {
    failWakeflowGitignoreRecomposition("input", "$options");
  }
  return Object.freeze({
    acquireTimeoutMilliseconds:
      record.acquireTimeoutMilliseconds === undefined
        ? WAKEFLOW_GITIGNORE_RECOMPOSITION_LOCK_TIMEOUT_MILLISECONDS
        : positiveMilliseconds(
            record.acquireTimeoutMilliseconds,
            "$options.acquireTimeoutMilliseconds",
          ),
    retryDelayMilliseconds:
      record.retryDelayMilliseconds === undefined
        ? undefined
        : positiveMilliseconds(record.retryDelayMilliseconds, "$options.retryDelayMilliseconds"),
    signal: record.signal as AbortSignal | undefined,
  });
}

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
  request: Readonly<ParsedWakeflowGitignoreRecompositionRequest>,
  signal: AbortSignal | undefined,
) {
  return Object.freeze({
    matrix: request.matrix,
    expectedMatrixDigest: request.expectedMatrixDigest,
    hostProfiles: request.hostProfiles,
    ...(signal === undefined ? {} : { signal }),
  });
}

export function wakeflowGitignoreRecompositionLockOptions(
  options: Readonly<ParsedWakeflowGitignoreRecompositionOptions>,
): WorkspaceLockOptions {
  return {
    acquireTimeoutMilliseconds: options.acquireTimeoutMilliseconds,
    ...(options.retryDelayMilliseconds === undefined
      ? {}
      : { retryDelayMilliseconds: options.retryDelayMilliseconds }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
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
