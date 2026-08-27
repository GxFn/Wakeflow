/**
 * Wakeflow Governance / Demand Event Sourcing：reducer state model 与历史摘要版本。
 *
 * Persisted event 的 resultingStateDigest 必须同时声明生成它的 state-model version。
 * 当前只有 v1；未来新增状态模型时必须登记历史 verifier/migrator，不能让 Event
 * Upcaster 用当前 reducer 冒充旧摘要验证。
 */

export const DEMAND_EVENT_SOURCING_CURRENT_STATE_MODEL_VERSION = 1 as const;
export const DEMAND_EVENT_SOURCING_SUPPORTED_STATE_MODEL_VERSIONS =
  Object.freeze([DEMAND_EVENT_SOURCING_CURRENT_STATE_MODEL_VERSION] as const);

declare const DEMAND_EVENT_SOURCING_STATE_MODEL_VERSION_BRAND: unique symbol;
export type DemandEventSourcingStateModelVersion = number & {
  readonly [DEMAND_EVENT_SOURCING_STATE_MODEL_VERSION_BRAND]:
    "DemandEventSourcingStateModelVersion";
};

export type DemandEventSourcingStateVersionErrorReason =
  | "input"
  | "unsupported-version";

const ERROR_MESSAGES = {
  "input": "Demand Event Sourcing state-model version is invalid.",
  "unsupported-version": "Demand Event Sourcing state-model version is unsupported.",
} as const satisfies Readonly<Record<
  DemandEventSourcingStateVersionErrorReason,
  string
>>;

export class DemandEventSourcingStateVersionError extends Error {
  override readonly name = "DemandEventSourcingStateVersionError";
  readonly code = "wakeflow-demand-event-sourcing-state-version" as const;
  readonly reason: DemandEventSourcingStateVersionErrorReason;
  readonly path: string;

  constructor(
    reason: DemandEventSourcingStateVersionErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: DemandEventSourcingStateVersionErrorReason,
  path: string,
): never {
  throw new DemandEventSourcingStateVersionError(reason, path);
}

export function parseDemandEventSourcingStateModelVersion(
  value: unknown,
  path = "$stateModelVersion",
): DemandEventSourcingStateModelVersion {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    fail("input", path);
  }
  return value as DemandEventSourcingStateModelVersion;
}

export function assertSupportedDemandEventSourcingStateModelVersion(
  value: unknown,
  path = "$stateModelVersion",
): asserts value is typeof DEMAND_EVENT_SOURCING_CURRENT_STATE_MODEL_VERSION {
  const version = parseDemandEventSourcingStateModelVersion(value, path);
  if (version !== DEMAND_EVENT_SOURCING_CURRENT_STATE_MODEL_VERSION) {
    fail("unsupported-version", path);
  }
}
