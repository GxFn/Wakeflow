import { types } from "node:util";

import { PassiveOwnDataError, parsePlainRecord } from "../../foundation/data/passive-own-data.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import type {
  DurableAtomicFileReplaceResult,
  DurableAtomicFileWriteResult,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  type ParsedWakeflowSupportMemoryInspectionRequest,
  parseWakeflowSupportMemoryInspectionRequest,
  type WakeflowSupportMemoryInspection,
  WakeflowSupportMemoryInspectionError,
  type WakeflowSupportMemoryInspectionRequest,
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

export function parseWakeflowSupportMemoryPublicationRequest(
  value: unknown,
): Readonly<ParsedWakeflowSupportMemoryInspectionRequest> {
  try {
    const parsed = parseWakeflowSupportMemoryInspectionRequest(value);
    if (parsed.signal !== undefined) {
      failWakeflowSupportMemoryPublication("input", "$request.signal");
    }
    return parsed;
  } catch (error: unknown) {
    if (error instanceof WakeflowSupportMemoryInspectionError) {
      failWakeflowSupportMemoryPublication("input", error.path, error);
    }
    throw error;
  }
}

export function parseWakeflowSupportMemoryPublicationOptions(
  value: unknown,
): Readonly<{ readonly signal: AbortSignal | undefined }> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      failWakeflowSupportMemoryPublication("input", "$options", error);
    }
    throw error;
  }
  if (
    Object.keys(record).some((key) => key !== "signal") ||
    (record.signal !== undefined &&
      (typeof record.signal !== "object" ||
        record.signal === null ||
        types.isProxy(record.signal) ||
        !(record.signal instanceof AbortSignal)))
  ) {
    failWakeflowSupportMemoryPublication("input", "$options");
  }
  return Object.freeze({ signal: record.signal as AbortSignal | undefined });
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
