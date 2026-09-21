/**
 * Wakeflow Governance / Demand Event Sourcing：归约器状态模型与历史摘要版本。
 *
 * 持久化事件的 `resultingStateDigest` 必须同时声明生成该摘要的状态模型版本。当前
 * 只有 v1；未来新增状态模型时必须登记历史校验器或迁移器，不能让事件升版转换器
 * 使用当前归约器冒充旧版本摘要校验逻辑。
 */
export const DEMAND_EVENT_SOURCING_CURRENT_STATE_MODEL_VERSION = 1;
export const DEMAND_EVENT_SOURCING_SUPPORTED_STATE_MODEL_VERSIONS = Object.freeze([DEMAND_EVENT_SOURCING_CURRENT_STATE_MODEL_VERSION]);
const ERROR_MESSAGES = {
    "input": "Demand Event Sourcing state-model version is invalid.",
    "unsupported-version": "Demand Event Sourcing state-model version is unsupported.",
};
export class DemandEventSourcingStateVersionError extends Error {
    name = "DemandEventSourcingStateVersionError";
    code = "wakeflow-demand-event-sourcing-state-version";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new DemandEventSourcingStateVersionError(reason, path);
}
export function parseDemandEventSourcingStateModelVersion(value, path = "$stateModelVersion") {
    if (!Number.isSafeInteger(value) || value < 1) {
        fail("input", path);
    }
    return value;
}
export function assertSupportedDemandEventSourcingStateModelVersion(value, path = "$stateModelVersion") {
    const version = parseDemandEventSourcingStateModelVersion(value, path);
    if (version !== DEMAND_EVENT_SOURCING_CURRENT_STATE_MODEL_VERSION) {
        fail("unsupported-version", path);
    }
}
