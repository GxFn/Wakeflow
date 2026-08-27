/**
 * Wakeflow Governance / Demand Event Sourcing：逻辑事件流修订号词汇。
 *
 * 修订号从 1 开始且必须连续；修订号 0 只表示追加操作预期事件流为空，不会出现在
 * 持久化事件中。物理 `commitSequence` 由聚合模块使用独立品牌类型表示。
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
