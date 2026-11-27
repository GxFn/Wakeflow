import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import type {
  DurableAtomicFileReplaceResult,
  DurableAtomicFileWriteResult,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  type ParsedWakeflowSupportMemoryInspectionRequest,
  type WakeflowSupportMemoryInspection,
  WakeflowSupportMemoryInspectionError,
  type WakeflowSupportMemoryInspectionRequest,
  wakeflowSupportMemoryRequestModel,
} from "./wakeflow-support-memory-inspection.js";

/** Support memory 发布与恢复共享的请求、选项、回执和错误合同。 */

export type WakeflowSupportMemoryPublicationRequest = Omit<
  WakeflowSupportMemoryInspectionRequest,
  "signal"
>;

export interface WakeflowSupportMemoryPublicationOptions {
  readonly signal?: AbortSignal;
}

export type WakeflowSupportMemoryPublicationEffect =
  | Readonly<DurableAtomicFileWriteResult<"created">>
  | Readonly<DurableAtomicFileReplaceResult>;

export interface WakeflowSupportMemoryPublicationReceipt {
  readonly disposition: "current" | "created" | "replaced";
  readonly effect: Readonly<WakeflowSupportMemoryPublicationEffect> | null;
  readonly inspection: Readonly<WakeflowSupportMemoryInspection>;
}

export type WakeflowSupportMemoryPublicationErrorReason =
  | "input"
  | "source-invalid"
  | "capacity"
  | "conflict"
  | "recovery-required"
  | "effect-failure"
  | "commit-uncertain";

/** Support memory 发布与恢复失败的稳定、脱敏错误。 */
export class WakeflowSupportMemoryPublicationError extends ModuleError<WakeflowSupportMemoryPublicationErrorReason> {
  static override readonly code = "wakeflow-support-memory-publication";
}

export const failWakeflowSupportMemoryPublication: Fail<WakeflowSupportMemoryPublicationErrorReason> =
  failWith(WakeflowSupportMemoryPublicationError);

/** 已类型化的发布请求换成执行用的形状；program 一致性与 surface 检查失败归为本模块的 `input`。 */
export function wakeflowSupportMemoryPublicationRequestModel(
  value: WakeflowSupportMemoryPublicationRequest,
): Readonly<ParsedWakeflowSupportMemoryInspectionRequest> {
  try {
    return wakeflowSupportMemoryRequestModel(value, undefined);
  } catch (error: unknown) {
    if (error instanceof WakeflowSupportMemoryInspectionError) {
      failWakeflowSupportMemoryPublication("input", error.path, error);
    }
    throw error;
  }
}

export function wakeflowSupportMemoryInspectionRequest(
  request: Readonly<ParsedWakeflowSupportMemoryInspectionRequest>,
  signal: AbortSignal | undefined,
): WakeflowSupportMemoryInspectionRequest {
  return Object.freeze({
    currentConfig: request.currentConfig,
    expectedCurrentConfigDigest: request.currentConfigDigest,
    desiredConfig: request.desiredConfig,
    expectedDesiredConfigDigest: request.desiredConfigDigest,
    profile: request.profile,
    expectedCatalogDigest: request.catalog.catalogDigest,
    surfaceId: request.surfaceId,
    ...(signal === undefined ? {} : { signal }),
  });
}
