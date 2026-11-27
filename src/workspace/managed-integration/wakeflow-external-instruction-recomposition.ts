import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { throwIfAborted } from "../../foundation/node/abort-signal.js";
import {
  deriveWakeflowExternalInstructionAuthorities,
  type ParsedWakeflowExternalInstructionInspectionRequest,
  WAKEFLOW_EXTERNAL_INSTRUCTION_FILE_MODE,
  type WakeflowExternalInstructionAuthorities,
  type WakeflowExternalInstructionInspection,
  WakeflowExternalInstructionInspectionError,
  type WakeflowExternalInstructionInspectionRequest,
  wakeflowExternalInstructionInspectionOf,
  wakeflowExternalInstructionManagedBlockFileRequest,
  wakeflowExternalInstructionRequestModel,
} from "./wakeflow-external-instruction-inspection.js";
import {
  recomposeWakeflowManagedBlockFile,
  type WakeflowManagedBlockFileEffect,
  WakeflowManagedBlockFileError,
  type WakeflowManagedBlockFileReceipt,
} from "./wakeflow-managed-block-file.js";

/**
 * Wakeflow Workspace / Managed Integration：外部根托管块的 CAS owner。
 *
 * 本模块在调用方已经持有的维护事务内推导两份正文权威，然后把机械部分交给通用托管块
 * 文件 owner（§13.114 D1）：目标不存在时以 0644 原子创建只含托管块的文件，存在时以完整
 * StableFileSource 做 CAS 替换并保留所有者原有的权限位，提交后读回闭合。外部根不属于
 * Wakeflow 静态矩阵，所以这里没有宿主专属短锁与恢复 owner；并发写入由 CAS 拒绝
 * （`conflict`），未知暂存残留按 `recovery-required` 报告。
 */

export type WakeflowExternalInstructionRecompositionRequest = Omit<
  WakeflowExternalInstructionInspectionRequest,
  "signal"
>;

export interface WakeflowExternalInstructionRecompositionOptions {
  readonly signal?: AbortSignal;
}

export type WakeflowExternalInstructionRecompositionEffect = WakeflowManagedBlockFileEffect;

export interface WakeflowExternalInstructionRecompositionReceipt {
  readonly disposition: "current" | "created" | "replaced";
  readonly effect: Readonly<WakeflowExternalInstructionRecompositionEffect> | null;
  readonly inspection: Readonly<WakeflowExternalInstructionInspection>;
}

export type WakeflowExternalInstructionRecompositionErrorReason =
  | "input"
  | "unsupported-platform"
  | "root-scope"
  | "root-policy"
  | "source-invalid"
  | "capacity"
  | "conflict"
  | "recovery-required"
  | "effect-failure"
  | "commit-uncertain";

/** 外部指令重组失败的稳定、脱敏错误。 */
export class WakeflowExternalInstructionRecompositionError extends ModuleError<WakeflowExternalInstructionRecompositionErrorReason> {
  static override readonly code = "wakeflow-external-instruction-recomposition";
}

const fail: Fail<WakeflowExternalInstructionRecompositionErrorReason> = failWith(
  WakeflowExternalInstructionRecompositionError,
);

function requestModel(
  value: WakeflowExternalInstructionRecompositionRequest,
  signal: AbortSignal | undefined,
): Readonly<ParsedWakeflowExternalInstructionInspectionRequest> {
  try {
    return wakeflowExternalInstructionRequestModel(value, signal);
  } catch (error: unknown) {
    if (error instanceof WakeflowExternalInstructionInspectionError) {
      fail("input", error.path, error);
    }
    throw error;
  }
}

function deriveAuthorities(
  request: Readonly<ParsedWakeflowExternalInstructionInspectionRequest>,
): Readonly<WakeflowExternalInstructionAuthorities> {
  try {
    return deriveWakeflowExternalInstructionAuthorities(request);
  } catch (error: unknown) {
    if (error instanceof WakeflowExternalInstructionInspectionError) {
      fail("input", error.path, error);
    }
    throw error;
  }
}

/** 通用 owner 的失败映射回外部指令重组的词汇：读取类问题统一为 source-invalid，容量统一为 capacity。 */
function mapManagedBlockFileError(error: WakeflowManagedBlockFileError): never {
  switch (error.reason) {
    case "input":
      return fail("input", error.path);
    case "unsupported-platform":
    case "root-scope":
    case "root-policy":
    case "conflict":
    case "recovery-required":
    case "effect-failure":
    case "commit-uncertain":
      return fail(error.reason, error.path);
    case "source-capacity":
      return fail("capacity", "$source");
    case "target-capacity":
      return fail("capacity", "$target");
    default:
      return fail("source-invalid", "$source");
  }
}

/**
 * 在调用方持有的维护事务内重推导并幂等创建或 CAS 替换外部根里的 Wakeflow 托管块。
 */
export async function recomposeWakeflowExternalInstruction(
  root: RootedDirectory,
  requestValue: WakeflowExternalInstructionRecompositionRequest,
  { signal }: WakeflowExternalInstructionRecompositionOptions = {},
): Promise<Readonly<WakeflowExternalInstructionRecompositionReceipt>> {
  throwIfAborted(signal);
  const request = requestModel(requestValue, signal);
  const authorities = deriveAuthorities(request);
  let receipt: Readonly<WakeflowManagedBlockFileReceipt>;
  try {
    receipt = await recomposeWakeflowManagedBlockFile(
      root,
      wakeflowExternalInstructionManagedBlockFileRequest(request, authorities, signal),
      { createMode: WAKEFLOW_EXTERNAL_INSTRUCTION_FILE_MODE },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowManagedBlockFileError) mapManagedBlockFileError(error);
    throw error;
  }
  return Object.freeze({
    disposition: receipt.disposition,
    effect: receipt.effect,
    inspection: wakeflowExternalInstructionInspectionOf(request, authorities, receipt.inspection),
  });
}
