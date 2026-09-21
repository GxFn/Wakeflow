import { types } from "node:util";

import {
  PassiveOwnDataError,
  parsePlainRecord,
} from "../../foundation/data/passive-own-data.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  deriveWakeflowExternalInstructionAuthorities,
  type ParsedWakeflowExternalInstructionInspectionRequest,
  parseWakeflowExternalInstructionInspectionRequest,
  WAKEFLOW_EXTERNAL_INSTRUCTION_FILE_MODE,
  type WakeflowExternalInstructionAuthorities,
  type WakeflowExternalInstructionInspection,
  WakeflowExternalInstructionInspectionError,
  type WakeflowExternalInstructionInspectionRequest,
  wakeflowExternalInstructionInspectionOf,
  wakeflowExternalInstructionManagedBlockFileRequest,
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

export type WakeflowExternalInstructionRecompositionEffect =
  WakeflowManagedBlockFileEffect;

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
  | "aborted"
  | "effect-failure"
  | "commit-uncertain";

const ERROR_MESSAGES = {
  input: "Wakeflow external instruction recomposition input is invalid.",
  "unsupported-platform":
    "Wakeflow external instruction recomposition requires POSIX ownership facts.",
  "root-scope":
    "Wakeflow external instruction recomposition lost its root scope.",
  "root-policy":
    "Wakeflow external instruction recomposition requires a current-user root.",
  "source-invalid":
    "Wakeflow external instruction source cannot be recomposed safely.",
  capacity: "Wakeflow external instruction recomposition exceeds its byte budget.",
  conflict:
    "Wakeflow external instruction source changed before atomic publication.",
  "recovery-required":
    "Wakeflow external instruction target has stage residue that requires explicit recovery.",
  aborted: "Wakeflow external instruction recomposition was aborted.",
  "effect-failure": "Wakeflow external instruction recomposition effect failed.",
  "commit-uncertain":
    "Wakeflow external instruction recomposition commit outcome is uncertain.",
} as const satisfies Readonly<Record<
  WakeflowExternalInstructionRecompositionErrorReason,
  string
>>;

/** 外部指令重组失败的稳定、脱敏错误。 */
export class WakeflowExternalInstructionRecompositionError extends Error {
  override readonly name = "WakeflowExternalInstructionRecompositionError";
  readonly code = "wakeflow-external-instruction-recomposition" as const;
  readonly reason: WakeflowExternalInstructionRecompositionErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowExternalInstructionRecompositionErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: WakeflowExternalInstructionRecompositionErrorReason,
  path: string,
): never {
  throw new WakeflowExternalInstructionRecompositionError(reason, path);
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
}

function parseOptions(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (Object.keys(record).some((key) => key !== "signal")) {
    fail("input", "$options");
  }
  if (record.signal === undefined) return undefined;
  if (
    typeof record.signal !== "object"
    || record.signal === null
    || types.isProxy(record.signal)
    || !(record.signal instanceof AbortSignal)
  ) {
    fail("input", "$options.signal");
  }
  return record.signal;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$signal");
}

function parseRequest(
  value: WakeflowExternalInstructionRecompositionRequest,
  signal: AbortSignal | undefined,
): Readonly<ParsedWakeflowExternalInstructionInspectionRequest> {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || Object.hasOwn(value, "signal")
  ) {
    fail("input", "$request");
  }
  try {
    return parseWakeflowExternalInstructionInspectionRequest({
      ...value,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowExternalInstructionInspectionError) {
      fail("input", error.path);
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
      fail("input", error.path);
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
    case "aborted":
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
  rootValue: RootedDirectory,
  requestValue: WakeflowExternalInstructionRecompositionRequest,
  optionsValue?: WakeflowExternalInstructionRecompositionOptions,
): Promise<Readonly<WakeflowExternalInstructionRecompositionReceipt>> {
  assertRoot(rootValue);
  const signal = parseOptions(optionsValue);
  assertNotAborted(signal);
  const request = parseRequest(requestValue, signal);
  const authorities = deriveAuthorities(request);
  let receipt: Readonly<WakeflowManagedBlockFileReceipt>;
  try {
    receipt = await recomposeWakeflowManagedBlockFile(
      rootValue,
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
    inspection: wakeflowExternalInstructionInspectionOf(
      request,
      authorities,
      receipt.inspection,
    ),
  });
}
