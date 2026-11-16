/**
 * Wakeflow Governance / Demand Model / Aggregate Model：聚合状态的形状：每个阶段的目标状态、投递与结果的摘要、聚合错误。只有类型、错误与两个不读状态以外任何东西的小函数。
 *
 * 从 `demand-aggregate-state.ts` 按关注点分出来的一段（open-items L5，gate-log §13.255）；对外的入口仍是那个
 * 文件，它只转出别处在用的公开名字。
 */
export const DEMAND_AGGREGATE_STATE_ARTIFACT_KIND = "wakeflow-demand-aggregate-state";
export const DEMAND_AGGREGATE_STATE_SCHEMA_VERSION = 1;
/** 谱系是非空元组，最后一项必然存在；`Array.prototype.at` 不做元组推断，所以在这里收窄一次。 */
export function lastTestAttempt(lineage) {
    return lineage[lineage.length - 1] ?? lineage[0];
}
/** 当前测试代际的 test 目标：排除续接前留下的历史 test 目标。 */
export function currentTestTargetsOf(state) {
    const historical = state.continuation?.historicalTestTargetIds ?? [];
    return state.targetTasks.filter((target) => target.workType === "test" && !historical.includes(target.targetTaskId));
}
const ERROR_MESSAGES = {
    json: "Demand aggregate state is not passive JSON data.",
    schema: "Demand aggregate state does not satisfy its portable Schema.",
    identifier: "Demand aggregate state contains an invalid Demand identity.",
    digest: "Demand aggregate state contains an invalid digest.",
    "task-package": "Demand aggregate state transition contains an invalid TaskPackage.",
    "delivery-envelope": "Demand aggregate state transition contains an invalid Delivery Envelope.",
    "delivery-outcome": "Demand aggregate state transition contains an invalid Delivery Outcome.",
    "delivery-rearm": "Demand aggregate state transition contains an invalid Delivery Rearm.",
    "target-result": "Demand aggregate state transition contains an invalid TargetResult.",
    "controller-review-decision": "Demand aggregate state transition contains an invalid Controller Review Decision.",
    "controller-product-defect-remediation-authorization": "Demand aggregate state transition contains an invalid Controller Product Defect Remediation Authorization.",
    "target-result-callback": "Demand aggregate state transition contains an invalid Target Result callback record.",
    "managed-evidence-manifest": "Demand aggregate state transition contains an invalid Managed Evidence Manifest.",
    relation: "Demand aggregate target task summaries are inconsistent.",
    transition: "Demand aggregate lifecycle transition is not admitted.",
};
export class DemandAggregateStateError extends Error {
    name = "DemandAggregateStateError";
    code = "wakeflow-demand-aggregate-state";
    reason;
    path;
    constructor(reason, path, options) {
        super(ERROR_MESSAGES[reason], options);
        this.reason = reason;
        this.path = path;
    }
}
export function fail(reason, path, cause) {
    throw new DemandAggregateStateError(reason, path, cause === undefined ? undefined : { cause });
}
