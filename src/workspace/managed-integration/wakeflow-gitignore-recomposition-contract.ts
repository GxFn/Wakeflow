import { types } from "node:util";

import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import type {
  DurableAtomicFileReplaceResult,
  DurableAtomicFileWriteResult,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import type {
  DurableAtomicFileStageRecoveryReceipt,
} from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import type {
  RootedExclusiveFileLockError,
  RootedExclusiveFileLockOptions,
} from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import {
  createWakeflowWorkspaceStaticResourceOperationContext,
  WakeflowWorkspaceStaticResourceOperationContextError,
} from "../wakeflow-workspace-static-resource-operation-context.js";
import {
  createWakeflowWorkspaceStaticResourceMatrix,
  parseWakeflowWorkspaceStaticResourceMatrix,
  WakeflowWorkspaceStaticResourceMatrixError,
  type WakeflowWorkspaceStaticResourceMatrix,
} from "../wakeflow-workspace-static-resource-matrix.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  WAKEFLOW_WORKSPACE_HOST_IDS,
  type WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import {
  createWakeflowGitignoreBodyAuthority,
  WakeflowGitignoreBodyAuthorityError,
} from "./wakeflow-gitignore-body-authority.js";
import type {
  WakeflowGitignoreInspection,
} from "./wakeflow-gitignore-inspection.js";

/**
 * Gitignore 重组与显式恢复共享的输入、错误和机械操作准入合同。
 *
 * 本模块只执行被动数据快照、规范矩阵绑定、完整 Host Profile 集合准入、POSIX 根策略
 * 和锁 recipe 准入；不读取 `.gitignore`、不取得锁、不发布字节或退休恢复残留。
 */

export const WAKEFLOW_GITIGNORE_FILE_MODE = 0o644;
export const WAKEFLOW_GITIGNORE_RECOMPOSITION_LOCK_TIMEOUT_MILLISECONDS =
  10_000;

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

export interface WakeflowGitignoreRecompositionRecoveryOptions {
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

export interface WakeflowGitignoreRecompositionRecoveryReceipt {
  readonly disposition: "recovered";
  readonly retiredLockDigest: Sha256Digest;
  readonly stageRecovery: Readonly<DurableAtomicFileStageRecoveryReceipt>;
  readonly recomposition: Readonly<WakeflowGitignoreRecompositionReceipt>;
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
  | "recovery-not-required"
  | "recovery-required"
  | "aborted"
  | "effect-failure"
  | "commit-uncertain";

const ERROR_MESSAGES = {
  input: "Wakeflow Gitignore recomposition input is invalid.",
  "unsupported-platform":
    "Wakeflow Gitignore recomposition requires reliable local POSIX ownership semantics.",
  "root-scope": "Wakeflow Gitignore recomposition lost its workspace root scope.",
  "root-policy": "Wakeflow Gitignore recomposition requires a current-user workspace root.",
  "source-invalid": "Wakeflow Gitignore source cannot be recomposed safely.",
  "observation-failure": "Wakeflow Gitignore semantics could not be observed.",
  capacity: "Wakeflow Gitignore recomposition exceeds its byte budget.",
  conflict: "Wakeflow Gitignore source changed before atomic publication.",
  "lock-timeout": "Wakeflow Gitignore recomposition lock acquisition timed out.",
  "lock-unsafe": "Wakeflow Gitignore recomposition lock is unsafe.",
  "recovery-not-required": "Wakeflow Gitignore recomposition has no lock residue to recover.",
  "recovery-required": "Wakeflow Gitignore recomposition requires explicit recovery.",
  aborted: "Wakeflow Gitignore recomposition was aborted before commit.",
  "effect-failure": "Wakeflow Gitignore candidate could not be published safely.",
  "commit-uncertain": "Published Wakeflow Gitignore could not be proven exact.",
} as const satisfies Readonly<Record<
  WakeflowGitignoreRecompositionErrorReason,
  string
>>;

/** Gitignore 重组与恢复失败的稳定、脱敏错误。 */
export class WakeflowGitignoreRecompositionError extends Error {
  override readonly name = "WakeflowGitignoreRecompositionError";
  readonly code = "wakeflow-gitignore-recomposition" as const;
  readonly reason: WakeflowGitignoreRecompositionErrorReason;
  readonly path: string;

  constructor(reason: WakeflowGitignoreRecompositionErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

export interface ParsedWakeflowGitignoreRecompositionRequest {
  readonly matrix: Readonly<WakeflowWorkspaceStaticResourceMatrix>;
  readonly expectedMatrixDigest: Sha256Digest;
  readonly hostProfiles:
    readonly Readonly<WakeflowWorkspaceHostResourceProfile>[];
}

export interface ParsedWakeflowGitignoreRecompositionOptions {
  readonly acquireTimeoutMilliseconds: number;
  readonly retryDelayMilliseconds: number | undefined;
  readonly signal: AbortSignal | undefined;
}

export interface ParsedWakeflowGitignoreRecompositionRecoveryOptions {
  readonly signal: AbortSignal | undefined;
}

export function failWakeflowGitignoreRecomposition(
  reason: WakeflowGitignoreRecompositionErrorReason,
  path: string,
): never {
  throw new WakeflowGitignoreRecompositionError(reason, path);
}

export function assertWakeflowGitignoreRecompositionRoot(
  value: unknown,
): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    failWakeflowGitignoreRecomposition("input", "$root");
  }
}

function plainRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      failWakeflowGitignoreRecomposition("input", path);
    }
    throw error;
  }
}

function parseProfiles(
  value: unknown,
): readonly Readonly<WakeflowWorkspaceHostResourceProfile>[] {
  let values: readonly unknown[];
  try {
    values = parseDenseArray(
      value,
      WAKEFLOW_WORKSPACE_HOST_IDS.length,
      "$request.hostProfiles",
    );
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      failWakeflowGitignoreRecomposition("input", "$request.hostProfiles");
    }
    throw error;
  }
  const parsed = values.map((profile, index) => {
    try {
      return parseWakeflowWorkspaceHostResourceProfile(profile);
    } catch (error: unknown) {
      if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
        failWakeflowGitignoreRecomposition(
          "input",
          `$request.hostProfiles/${index}`,
        );
      }
      throw error;
    }
  });
  try {
    createWakeflowGitignoreBodyAuthority(parsed);
  } catch (error: unknown) {
    if (error instanceof WakeflowGitignoreBodyAuthorityError) {
      failWakeflowGitignoreRecomposition("input", "$request.hostProfiles");
    }
    throw error;
  }
  const byHostId = new Map(parsed.map((profile) => [profile.hostId, profile]));
  return Object.freeze(WAKEFLOW_WORKSPACE_HOST_IDS.map((hostId) => {
    const profile = byHostId.get(hostId);
    if (profile === undefined) {
      failWakeflowGitignoreRecomposition("input", "$request.hostProfiles");
    }
    return profile;
  }));
}

export function parseWakeflowGitignoreRecompositionRequest(
  value: unknown,
): Readonly<ParsedWakeflowGitignoreRecompositionRequest> {
  const record = plainRecord(value, "$request");
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 3
    || keys[0] !== "expectedMatrixDigest"
    || keys[1] !== "hostProfiles"
    || keys[2] !== "matrix"
  ) {
    failWakeflowGitignoreRecomposition("input", "$request");
  }
  let matrix: Readonly<WakeflowWorkspaceStaticResourceMatrix>;
  try {
    matrix = parseWakeflowWorkspaceStaticResourceMatrix(record.matrix);
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceStaticResourceMatrixError) {
      failWakeflowGitignoreRecomposition("input", "$request.matrix");
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
      failWakeflowGitignoreRecomposition(
        "input",
        "$request.expectedMatrixDigest",
      );
    }
    throw error;
  }
  if (expectedMatrixDigest !== matrix.matrixDigest) {
    failWakeflowGitignoreRecomposition(
      "input",
      "$request.expectedMatrixDigest",
    );
  }
  const hostProfiles = parseProfiles(record.hostProfiles);
  const currentProfile = hostProfiles.find((profile) => (
    profile.hostId === matrix.hostId
  ));
  if (
    currentProfile === undefined
    || createWakeflowWorkspaceStaticResourceMatrix(currentProfile).matrixDigest
      !== matrix.matrixDigest
  ) {
    failWakeflowGitignoreRecomposition("input", "$request.matrix");
  }
  return Object.freeze({ matrix, expectedMatrixDigest, hostProfiles });
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal;
}

function positiveMilliseconds(value: unknown, path: string): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value <= 0
    || value > 300_000
  ) {
    failWakeflowGitignoreRecomposition("input", path);
  }
  return value;
}

export function parseWakeflowGitignoreRecompositionOptions(
  value: unknown,
): Readonly<ParsedWakeflowGitignoreRecompositionOptions> {
  const record = plainRecord(value === undefined ? {} : value, "$options");
  const allowed = new Set([
    "acquireTimeoutMilliseconds",
    "retryDelayMilliseconds",
    "signal",
  ]);
  if (
    Object.keys(record).some((key) => !allowed.has(key))
    || (record.signal !== undefined && !isAbortSignal(record.signal))
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
    retryDelayMilliseconds: record.retryDelayMilliseconds === undefined
      ? undefined
      : positiveMilliseconds(
          record.retryDelayMilliseconds,
          "$options.retryDelayMilliseconds",
        ),
    signal: record.signal as AbortSignal | undefined,
  });
}

export function parseWakeflowGitignoreRecompositionRecoveryOptions(
  value: unknown,
): Readonly<ParsedWakeflowGitignoreRecompositionRecoveryOptions> {
  const record = plainRecord(value === undefined ? {} : value, "$options");
  if (
    Object.keys(record).some((key) => key !== "signal")
    || (record.signal !== undefined && !isAbortSignal(record.signal))
  ) {
    failWakeflowGitignoreRecomposition("input", "$options");
  }
  return Object.freeze({ signal: record.signal as AbortSignal | undefined });
}

export function assertWakeflowGitignoreRecompositionNotAborted(
  signal: AbortSignal | undefined,
): void {
  if (signal?.aborted === true) {
    failWakeflowGitignoreRecomposition("aborted", "$signal");
  }
}

export function currentWakeflowGitignoreRecompositionUserId(): bigint {
  if (process.platform === "win32" || typeof process.geteuid !== "function") {
    failWakeflowGitignoreRecomposition("unsupported-platform", "$root");
  }
  return BigInt(process.geteuid());
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
      failWakeflowGitignoreRecomposition("root-scope", "$root");
    }
    failWakeflowGitignoreRecomposition("root-scope", "$root");
  }
}

export function admitWakeflowGitignoreRecompositionLockOperations(
  request: Readonly<ParsedWakeflowGitignoreRecompositionRequest>,
): void {
  for (const recipe of ["exclusive-create", "exact-retire"] as const) {
    try {
      createWakeflowWorkspaceStaticResourceOperationContext(
        request.matrix,
        {
          expectedMatrixDigest: request.expectedMatrixDigest,
          declarationId: "workspace.ignore-integration-lock",
          recipe,
        },
      );
    } catch (error: unknown) {
      if (
        error instanceof WakeflowWorkspaceStaticResourceOperationContextError
      ) {
        failWakeflowGitignoreRecomposition("input", "$request.matrix");
      }
      throw error;
    }
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
): RootedExclusiveFileLockOptions {
  return {
    acquireTimeoutMilliseconds: options.acquireTimeoutMilliseconds,
    ...(options.retryDelayMilliseconds === undefined
      ? {}
      : { retryDelayMilliseconds: options.retryDelayMilliseconds }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
}

export function mapWakeflowGitignoreRecompositionLockError(
  error: RootedExclusiveFileLockError,
  committed: boolean,
): never {
  if (committed) {
    failWakeflowGitignoreRecomposition("commit-uncertain", "$resourcePath");
  }
  if (error.reason === "input") {
    failWakeflowGitignoreRecomposition("input", error.path);
  }
  if (error.reason === "aborted") {
    failWakeflowGitignoreRecomposition("aborted", "$signal");
  }
  if (error.reason === "timeout") {
    failWakeflowGitignoreRecomposition("lock-timeout", "$lock");
  }
  if (error.reason === "root-scope" || error.reason === "parent") {
    failWakeflowGitignoreRecomposition("root-scope", "$root");
  }
  if (
    error.reason === "owner-active"
    || error.reason === "residue-changed"
    || error.reason === "release-failure"
  ) {
    failWakeflowGitignoreRecomposition("recovery-required", "$lock");
  }
  failWakeflowGitignoreRecomposition("lock-unsafe", "$lock");
}
