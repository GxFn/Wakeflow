import { computeSha256Digest, type Sha256Digest } from "../foundation/crypto/sha256.js";
import { type Fail, failWith, ModuleError } from "../foundation/error/module-error.js";
import type { DurableAtomicFileReplaceResult } from "../foundation/filesystem/durable-atomic-file-write.js";
import { sameFileNodeSnapshot } from "../foundation/filesystem/file-node-snapshot.js";
import type { KernelFileLockError } from "../foundation/filesystem/kernel-file-lock.js";
import {
  type RootedDirectory,
  RootedDirectoryError,
} from "../foundation/filesystem/rooted-directory.js";
import type { StableFileSource } from "../foundation/filesystem/stable-file-read.js";
import { OperationAbortedError } from "../foundation/node/abort-signal.js";
import { requireCurrentUserId } from "../foundation/node/current-user.js";
import { encodeUtf8, Utf8Error } from "../foundation/text/utf8.js";
import type { WorkspaceLockOptions } from "../kernel/workspace-locks.js";
import {
  computeWakeflowConfigDigest,
  WakeflowConfigError,
  type WakeflowConfigModel,
} from "./wakeflow-config.js";
import {
  readWakeflowConfigAuthoritySnapshot,
  WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE,
  WAKEFLOW_CONFIG_MAXIMUM_BYTES,
  type WakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
} from "./wakeflow-config-authority-snapshot.js";
import { renderWakeflowConfig } from "./wakeflow-config-document.js";
import {
  validateWakeflowConfigRootPlacements,
  WakeflowConfigRootPlacementError,
} from "./wakeflow-config-root-placement.js";

/**
 * Config 替换流程的领域合同、无副作用输入准入，以及共享的源资源和目标事实。
 *
 * 本模块由正常替换和显式恢复共同使用，不执行文件替换、暂存文件清理或锁残留退休。
 * 错误、P1 所有者与权限策略、调用方预期和目标字节在此保持唯一解释，避免两条路径
 * 形成不同的 Config 权威记录准入规则。
 */

const WAKEFLOW_CONFIG_AUTHORITY_LOCK_TIMEOUT_MILLISECONDS = 10_000;

export interface WakeflowConfigAuthorityReplacementOptions {
  readonly acquireTimeoutMilliseconds?: number;
  readonly retryDelayMilliseconds?: number;
  readonly signal?: AbortSignal;
}

export interface WakeflowConfigAuthorityReplacementReceipt {
  readonly disposition: "current" | "replaced";
  readonly source: Readonly<WakeflowConfigAuthoritySnapshot>;
  readonly effect: Readonly<DurableAtomicFileReplaceResult> | null;
  readonly authority: Readonly<WakeflowConfigAuthoritySnapshot>;
}

export type WakeflowConfigAuthorityReplacementErrorReason =
  | "input"
  | "unsupported-platform"
  | "root-scope"
  | "root-policy"
  | "config"
  | "capacity"
  | "placement"
  | "source-invalid"
  | "source-policy"
  | "program-identity"
  | "conflict"
  | "lock-timeout"
  | "lock-unsafe"
  | "recovery-required"
  | "replacement-failure"
  | "commit-uncertain";

/** Config replacement 与显式恢复的稳定、脱敏错误。 */
export class WakeflowConfigAuthorityReplacementError extends ModuleError<WakeflowConfigAuthorityReplacementErrorReason> {
  static override readonly code = "wakeflow-config-authority-replacement";
}

export const failWakeflowConfigAuthorityReplacement: Fail<WakeflowConfigAuthorityReplacementErrorReason> =
  failWith(WakeflowConfigAuthorityReplacementError);

export interface PreparedWakeflowConfigAuthorityDesired {
  readonly model: WakeflowConfigModel;
  readonly bytes: Uint8Array;
  readonly sourceDigest: Sha256Digest;
  readonly configDigest: Sha256Digest;
}

export function currentWakeflowConfigAuthorityUserId(): bigint {
  return requireCurrentUserId(() =>
    failWakeflowConfigAuthorityReplacement("unsupported-platform", "$root"),
  );
}

export async function assertCurrentUserWakeflowConfigAuthorityRoot(
  root: RootedDirectory,
  expectedUserId: bigint,
): Promise<void> {
  try {
    const node = await root.assertCurrent("$root");
    if (node.userId !== expectedUserId) {
      failWakeflowConfigAuthorityReplacement("root-policy", "$root");
    }
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthorityReplacementError) throw error;
    if (error instanceof RootedDirectoryError) {
      failWakeflowConfigAuthorityReplacement("root-scope", "$root", error);
    }
    failWakeflowConfigAuthorityReplacement("root-scope", "$root", error);
  }
}

export function prepareWakeflowConfigAuthorityDesired(
  model: WakeflowConfigModel,
): Readonly<PreparedWakeflowConfigAuthorityDesired> {
  let bytes: Uint8Array;
  try {
    bytes = encodeUtf8(renderWakeflowConfig(model), "$config");
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigError || error instanceof Utf8Error) {
      failWakeflowConfigAuthorityReplacement("config", "$config", error);
    }
    failWakeflowConfigAuthorityReplacement("config", "$config", error);
  }
  if (bytes.byteLength > WAKEFLOW_CONFIG_MAXIMUM_BYTES) {
    failWakeflowConfigAuthorityReplacement("capacity", "$config");
  }
  try {
    return Object.freeze({
      model,
      bytes,
      sourceDigest: computeSha256Digest(bytes, "$config"),
      configDigest: computeWakeflowConfigDigest(model),
    });
  } catch (cause: unknown) {
    failWakeflowConfigAuthorityReplacement("config", "$config", cause);
  }
}

export async function assertWakeflowConfigAuthorityDesiredPlacements(
  root: RootedDirectory,
  model: WakeflowConfigModel,
): Promise<void> {
  try {
    await validateWakeflowConfigRootPlacements(root, model);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigRootPlacementError) {
      if (error.reason === "root-scope") {
        failWakeflowConfigAuthorityReplacement("root-scope", "$root", error);
      }
      if (error.reason === "input") {
        failWakeflowConfigAuthorityReplacement("input", error.path, error);
      }
      failWakeflowConfigAuthorityReplacement("placement", error.path, error);
    }
    failWakeflowConfigAuthorityReplacement("placement", "$placements", error);
  }
}

/** 提交之前读当前权威快照失败：按快照错误的原因归类，认不出的一律是来源无效。 */
function failSnapshotRead(error: unknown): never {
  if (error instanceof OperationAbortedError) throw error;
  if (error instanceof WakeflowConfigAuthoritySnapshotError) {
    if (error.reason === "root-scope") {
      failWakeflowConfigAuthorityReplacement("root-scope", "$root", error);
    }
    if (error.reason === "source-policy") {
      failWakeflowConfigAuthorityReplacement("source-policy", "$source", error);
    }
  }
  failWakeflowConfigAuthorityReplacement("source-invalid", "$source", error);
}

export async function readCurrentWakeflowConfigAuthority(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
  afterCommit: boolean,
): Promise<Readonly<WakeflowConfigAuthoritySnapshot>> {
  try {
    return await readWakeflowConfigAuthoritySnapshot(
      root,
      afterCommit || signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (afterCommit) {
      failWakeflowConfigAuthorityReplacement("commit-uncertain", "$resourcePath", error);
    }
    failSnapshotRead(error);
  }
}

export function assertWakeflowConfigAuthoritySourcePolicy(
  snapshot: Readonly<WakeflowConfigAuthoritySnapshot>,
  expectedUserId: bigint,
): void {
  const node = snapshot.source.node;
  if (
    node.kind !== "file" ||
    node.linkCount !== 1n ||
    node.permissionBits !== WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE ||
    node.userId !== expectedUserId
  ) {
    failWakeflowConfigAuthorityReplacement("source-policy", "$source");
  }
}

export function sameWakeflowConfigAuthoritySource(
  left: Readonly<StableFileSource>,
  right: Readonly<StableFileSource>,
): boolean {
  return (
    left.resourcePath === right.resourcePath &&
    left.byteCount === right.byteCount &&
    left.digest === right.digest &&
    sameFileNodeSnapshot(left.node, right.node)
  );
}

/**
 * 调用方的预期是它先前读到的权威快照（读取方已经核对过来源政策），按值与当前快照比较。
 */
export function matchesWakeflowConfigAuthorityExpectation(
  root: RootedDirectory,
  current: Readonly<WakeflowConfigAuthoritySnapshot>,
  expected: Readonly<WakeflowConfigAuthoritySnapshot>,
): boolean {
  return (
    expected.workspaceRoot === root.absolutePath &&
    current.workspaceRoot === root.absolutePath &&
    current.configDigest === expected.configDigest &&
    current.model.program.programId === expected.model.program.programId &&
    sameWakeflowConfigAuthoritySource(current.source, expected.source)
  );
}

/** 配置权威锁的选项：获取超时缺省 10 秒；数值范围由锁原语自己核对。 */
export function wakeflowConfigAuthorityLockOptions({
  acquireTimeoutMilliseconds = WAKEFLOW_CONFIG_AUTHORITY_LOCK_TIMEOUT_MILLISECONDS,
  retryDelayMilliseconds,
  signal,
}: WakeflowConfigAuthorityReplacementOptions): WorkspaceLockOptions {
  return {
    acquireTimeoutMilliseconds,
    ...(retryDelayMilliseconds === undefined ? {} : { retryDelayMilliseconds }),
    ...(signal === undefined ? {} : { signal }),
  };
}

/** 配置权威锁（ADR-0033）的失败：已经提交之后的任何失败都是提交结果不确定。 */
export function mapWakeflowConfigAuthorityLockError(
  error: KernelFileLockError,
  committed: boolean,
): never {
  if (committed) {
    failWakeflowConfigAuthorityReplacement("commit-uncertain", "$resourcePath");
  }
  if (error.reason === "input") {
    failWakeflowConfigAuthorityReplacement("input", error.path);
  }
  if (error.reason === "timeout") {
    failWakeflowConfigAuthorityReplacement("lock-timeout", "$lock");
  }
  failWakeflowConfigAuthorityReplacement("lock-unsafe", "$lock");
}
