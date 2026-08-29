import { types } from "node:util";

import {
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
  parseWakeflowSupportMemoryInspectionRequest,
  WakeflowSupportMemoryInspectionError,
  type ParsedWakeflowSupportMemoryInspectionRequest,
  type WakeflowSupportMemoryInspection,
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

export interface WakeflowSupportMemoryRecoveryReceipt {
  readonly disposition: "recovered";
  readonly stageRecovery: Readonly<DurableAtomicFileStageRecoveryReceipt>;
  readonly publication: Readonly<WakeflowSupportMemoryPublicationReceipt>;
}

export type WakeflowSupportMemoryPublicationErrorReason =
  | "input"
  | "source-invalid"
  | "capacity"
  | "conflict"
  | "recovery-required"
  | "aborted"
  | "effect-failure"
  | "commit-uncertain";

const ERROR_MESSAGES = {
  input: "Wakeflow support memory publication input is invalid.",
  "source-invalid": "Wakeflow support memory source cannot be published safely.",
  capacity: "Wakeflow support memory publication exceeds its byte budget.",
  conflict: "Wakeflow support memory source changed before atomic publication.",
  "recovery-required":
    "Wakeflow support memory publication requires explicit recovery.",
  aborted: "Wakeflow support memory publication was aborted before commit.",
  "effect-failure": "Wakeflow support memory could not be published safely.",
  "commit-uncertain":
    "Published Wakeflow support memory could not be proven exact.",
} as const satisfies Readonly<Record<
  WakeflowSupportMemoryPublicationErrorReason,
  string
>>;

/** Support memory 发布与恢复失败的稳定、脱敏错误。 */
export class WakeflowSupportMemoryPublicationError extends Error {
  override readonly name = "WakeflowSupportMemoryPublicationError";
  readonly code = "wakeflow-support-memory-publication" as const;
  readonly reason: WakeflowSupportMemoryPublicationErrorReason;
  readonly path: string;

  constructor(reason: WakeflowSupportMemoryPublicationErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

export function failWakeflowSupportMemoryPublication(
  reason: WakeflowSupportMemoryPublicationErrorReason,
  path: string,
): never {
  throw new WakeflowSupportMemoryPublicationError(reason, path);
}

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
      failWakeflowSupportMemoryPublication("input", error.path);
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
      failWakeflowSupportMemoryPublication("input", "$options");
    }
    throw error;
  }
  if (
    Object.keys(record).some((key) => key !== "signal")
    || (
      record.signal !== undefined
      && (
        typeof record.signal !== "object"
        || record.signal === null
        || types.isProxy(record.signal)
        || !(record.signal instanceof AbortSignal)
      )
    )
  ) {
    failWakeflowSupportMemoryPublication("input", "$options");
  }
  return Object.freeze({ signal: record.signal as AbortSignal | undefined });
}

export function assertWakeflowSupportMemoryPublicationNotAborted(
  signal: AbortSignal | undefined,
): void {
  if (signal?.aborted === true) {
    failWakeflowSupportMemoryPublication("aborted", "$signal");
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
