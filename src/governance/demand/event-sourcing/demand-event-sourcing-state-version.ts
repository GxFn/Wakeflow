import { type Fail, failWith, ModuleError } from "../../../foundation/error/module-error.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：归约器状态模型与历史摘要版本。
 *
 * 持久化事件的 `resultingStateDigest` 必须同时声明生成该摘要的状态模型版本。当前
 * 只有 v1；未来新增状态模型时必须登记历史校验器或迁移器，不能让事件升版转换器
 * 使用当前归约器冒充旧版本摘要校验逻辑。
 */

export const DEMAND_EVENT_SOURCING_CURRENT_STATE_MODEL_VERSION = 1 as const;
export const DEMAND_EVENT_SOURCING_SUPPORTED_STATE_MODEL_VERSIONS = Object.freeze([
  DEMAND_EVENT_SOURCING_CURRENT_STATE_MODEL_VERSION,
] as const);

declare const DEMAND_EVENT_SOURCING_STATE_MODEL_VERSION_BRAND: unique symbol;
export type DemandEventSourcingStateModelVersion = number & {
  readonly [DEMAND_EVENT_SOURCING_STATE_MODEL_VERSION_BRAND]: "DemandEventSourcingStateModelVersion";
};

export type DemandEventSourcingStateVersionErrorReason = "input" | "unsupported-version";

export class DemandEventSourcingStateVersionError extends ModuleError<DemandEventSourcingStateVersionErrorReason> {
  static override readonly code = "wakeflow-demand-event-sourcing-state-version";
}

const fail: Fail<DemandEventSourcingStateVersionErrorReason> = failWith(
  DemandEventSourcingStateVersionError,
);

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
