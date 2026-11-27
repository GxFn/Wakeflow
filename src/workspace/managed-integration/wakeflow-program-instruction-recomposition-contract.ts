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
import type { WakeflowWorkspaceHostResourceComponent } from "../workspace-host-resource-profile.js";
import {
  type ParsedWakeflowProgramInstructionInspectionRequest,
  type WakeflowProgramInstructionInspection,
  WakeflowProgramInstructionInspectionError,
  type WakeflowProgramInstructionInspectionRequest,
  wakeflowProgramInstructionRequestModel,
} from "./wakeflow-program-instruction-inspection.js";

/**
 * Program Instruction 锁内重组和显式恢复共享的机械合同。
 *
 * 本模块只准入 current/desired Config 请求、根目录、短锁 recipe 与有界选项；不读取
 * 指令文件、不生成正文、不取得锁，也不发布或恢复任何资源。
 */

const WAKEFLOW_PROGRAM_INSTRUCTION_RECOMPOSITION_LOCK_TIMEOUT_MILLISECONDS = 10_000;

export type WakeflowProgramInstructionRecompositionRequest = Omit<
  WakeflowProgramInstructionInspectionRequest,
  "signal"
>;

export interface WakeflowProgramInstructionRecompositionOptions {
  readonly acquireTimeoutMilliseconds?: number;
  readonly retryDelayMilliseconds?: number;
  readonly signal?: AbortSignal;
}

export type WakeflowProgramInstructionRecompositionEffect =
  | Readonly<DurableAtomicFileWriteResult<"created">>
  | Readonly<DurableAtomicFileReplaceResult>;

export interface WakeflowProgramInstructionRecompositionReceipt {
  readonly disposition: "current" | "created" | "replaced";
  readonly effect: Readonly<WakeflowProgramInstructionRecompositionEffect> | null;
  readonly inspection: Readonly<WakeflowProgramInstructionInspection>;
}

export type WakeflowProgramInstructionRecompositionErrorReason =
  | "input"
  | "unsupported-platform"
  | "root-scope"
  | "root-policy"
  | "source-invalid"
  | "capacity"
  | "conflict"
  | "lock-timeout"
  | "lock-unsafe"
  | "recovery-required"
  | "effect-failure"
  | "commit-uncertain";

/** Program Instruction 重组与恢复失败的稳定、脱敏错误。 */
export class WakeflowProgramInstructionRecompositionError extends ModuleError<WakeflowProgramInstructionRecompositionErrorReason> {
  static override readonly code = "wakeflow-program-instruction-recomposition";
}

export const failWakeflowProgramInstructionRecomposition: Fail<WakeflowProgramInstructionRecompositionErrorReason> =
  failWith(WakeflowProgramInstructionRecompositionError);

/** 已类型化的重组请求换成执行用的形状；program 一致性检查失败归为本模块的 `input`。 */
export function wakeflowProgramInstructionRecompositionRequestModel(
  value: WakeflowProgramInstructionRecompositionRequest,
): Readonly<ParsedWakeflowProgramInstructionInspectionRequest> {
  try {
    return wakeflowProgramInstructionRequestModel(value, undefined);
  } catch (error: unknown) {
    if (error instanceof WakeflowProgramInstructionInspectionError) {
      failWakeflowProgramInstructionRecomposition("input", error.path, error);
    }
    throw error;
  }
}

export function currentWakeflowProgramInstructionRecompositionUserId(): bigint {
  return requireCurrentUserId(() =>
    failWakeflowProgramInstructionRecomposition("unsupported-platform", "$root"),
  );
}

export async function assertCurrentUserWakeflowProgramInstructionRoot(
  root: RootedDirectory,
  expectedUserId: bigint,
): Promise<void> {
  try {
    const node = await root.assertCurrent("$root");
    if (node.userId !== expectedUserId) {
      failWakeflowProgramInstructionRecomposition("root-policy", "$root");
    }
  } catch (error: unknown) {
    if (error instanceof WakeflowProgramInstructionRecompositionError) {
      throw error;
    }
    if (error instanceof RootedDirectoryError) {
      failWakeflowProgramInstructionRecomposition("root-scope", "$root", error);
    }
    throw error;
  }
}

export function wakeflowProgramInstructionInspectionRequest(
  request: Readonly<ParsedWakeflowProgramInstructionInspectionRequest>,
  signal: AbortSignal | undefined,
): WakeflowProgramInstructionInspectionRequest {
  return Object.freeze({
    matrix: request.matrix,
    expectedMatrixDigest: request.expectedMatrixDigest,
    profile: request.profile,
    currentConfig: request.currentConfig,
    expectedCurrentConfigDigest: request.currentConfigDigest,
    desiredConfig: request.desiredConfig,
    expectedDesiredConfigDigest: request.desiredConfigDigest,
    ...(signal === undefined ? {} : { signal }),
  });
}

export function wakeflowProgramInstructionTargetRef(
  request: Readonly<ParsedWakeflowProgramInstructionInspectionRequest>,
): WakeflowWorkspaceHostResourceComponent {
  return request.profile.instructionFileName;
}

export function wakeflowProgramInstructionLockOptions({
  acquireTimeoutMilliseconds = WAKEFLOW_PROGRAM_INSTRUCTION_RECOMPOSITION_LOCK_TIMEOUT_MILLISECONDS,
  retryDelayMilliseconds,
  signal,
}: WakeflowProgramInstructionRecompositionOptions): WorkspaceLockOptions {
  return {
    acquireTimeoutMilliseconds,
    ...(retryDelayMilliseconds === undefined ? {} : { retryDelayMilliseconds }),
    ...(signal === undefined ? {} : { signal }),
  };
}

/** 程序指令重组锁（ADR-0033）的失败：已经提交之后的任何失败都是提交结果不确定。 */
export function mapWakeflowProgramInstructionLockError(
  error: KernelFileLockError,
  committed: boolean,
): never {
  if (committed) {
    failWakeflowProgramInstructionRecomposition("commit-uncertain", "$resourcePath");
  }
  if (error.reason === "input") {
    failWakeflowProgramInstructionRecomposition("input", error.path);
  }
  if (error.reason === "timeout") {
    failWakeflowProgramInstructionRecomposition("lock-timeout", "$lock");
  }
  failWakeflowProgramInstructionRecomposition("lock-unsafe", "$lock");
}
