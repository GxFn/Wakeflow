import { ModuleError } from "../../../foundation/error/module-error.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：逻辑事件流修订号词汇。
 *
 * 逻辑事件修订号与物理提交槽位都从 1 开始且必须连续。修订号 0 只表示追加操作预期
 * 事件流为空，不会出现在持久化事件中；`commitSequence`独立计数一次命令提交。
 */

declare const DEMAND_EVENT_STREAM_REVISION_BRAND: unique symbol;
export type DemandEventStreamRevision = number & {
  readonly [DEMAND_EVENT_STREAM_REVISION_BRAND]: "DemandEventStreamRevision";
};

declare const DEMAND_EVENT_COMMIT_SEQUENCE_BRAND: unique symbol;
export type DemandEventCommitSequence = number & {
  readonly [DEMAND_EVENT_COMMIT_SEQUENCE_BRAND]: "DemandEventCommitSequence";
};

export type DemandEventStreamPositionErrorReason = "stream-revision" | "commit-sequence";

export class DemandEventStreamPositionError extends ModuleError<DemandEventStreamPositionErrorReason> {
  static override readonly code = "wakeflow-demand-event-stream-position";
}

function parsePositivePosition(
  value: unknown,
  reason: DemandEventStreamPositionErrorReason,
  path: string,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new DemandEventStreamPositionError(reason, path);
  }
  return value as number;
}

export function parseDemandEventStreamRevision(
  value: unknown,
  path = "$streamRevision",
): DemandEventStreamRevision {
  return parsePositivePosition(value, "stream-revision", path) as DemandEventStreamRevision;
}

export function parseDemandEventCommitSequence(
  value: unknown,
  path = "$commitSequence",
): DemandEventCommitSequence {
  return parsePositivePosition(value, "commit-sequence", path) as DemandEventCommitSequence;
}
