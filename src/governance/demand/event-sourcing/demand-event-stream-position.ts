/**
 * Wakeflow Governance / Demand Event Sourcing：逻辑 stream revision 词汇。
 *
 * revision 一基且连续；revision 0 只作为 append 的 expected-empty-stream 值，不会
 * 出现在 stored event。物理 commitSequence 由 Aggregate 模块单独品牌化。
 */

declare const DEMAND_EVENT_STREAM_REVISION_BRAND: unique symbol;
export type DemandEventStreamRevision = number & {
  readonly [DEMAND_EVENT_STREAM_REVISION_BRAND]: "DemandEventStreamRevision";
};

export class DemandEventStreamPositionError extends Error {
  override readonly name = "DemandEventStreamPositionError";
  readonly code = "wakeflow-demand-event-stream-position" as const;
  readonly reason = "revision" as const;
  readonly path: string;

  constructor(path: string) {
    super("Demand event stream revision must be a positive safe integer.");
    this.path = path;
  }
}

export function parseDemandEventStreamRevision(
  value: unknown,
  path = "$streamRevision",
): DemandEventStreamRevision {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new DemandEventStreamPositionError(path);
  }
  return value as DemandEventStreamRevision;
}
