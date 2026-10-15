/**
 * Wakeflow Contracts / Vocabulary：Target 阶段与各阶段允许的事（open-items L1，§13.174）。
 *
 * 实现目标与测试目标的阶段联合、每个阶段对"准备新信封 / rearm"的许可，以及 Controller Route 在该阶段给出
 * 的前沿，都只在这一张表里写一次：`capabilities/delivery/decide.ts` 的阻塞项与
 * `governance/controller/demand-controller-route.ts` 的实现前沿描述从它派生，
 * `tests/contracts/vocabulary/wakeflow-target-phases.test.ts` 核对聚合的阶段联合、Post-Acceptance 的 stage
 * 名与 decide 的许可都与它一致。rearm 的上限本身是 governance/delivery 的常量；这里只表达"rearm 用尽后
 * 才准备新信封"这一关系。聚合的转移守卫仍独立编码（它核对的是整条命令，不只阶段），由同一份测试与
 * 聚合测试覆盖。
 */
export const WAKEFLOW_IMPLEMENTATION_TARGET_PHASES = Object.freeze([
    "planned",
    "delivery-prepared",
    "host-effect-accepted",
    "host-effect-indeterminate",
    "host-effect-rejected",
    "result-reported",
    "accepted",
    "product-defect-rework-requested",
    "rework-requested",
    "escalated",
    "review-blocked",
    "superseded",
]);
export const WAKEFLOW_TEST_TARGET_PHASES = Object.freeze([
    "planned",
    "test-delivery-prepared",
    "test-host-effect-accepted",
    "test-host-effect-indeterminate",
    "test-host-effect-rejected",
    "test-result-reported",
    "test-accepted",
    "test-another-attempt-requested",
    "test-product-defect",
    "test-review-blocked",
    "test-escalated",
]);
const DELIVERY_PLANNING = Object.freeze({
    kind: "implementation-delivery-planning",
    owner: "target-delivery-preparation",
});
const RESULT_IMPORT = Object.freeze({
    kind: "implementation-target-result-import",
    owner: "target-result-import",
});
const RESULT_REVIEW = Object.freeze({
    kind: "implementation-result-review",
    owner: "controller-implementation-review",
});
export const WAKEFLOW_IMPLEMENTATION_TARGET_PHASE_RULES = Object.freeze({
    planned: Object.freeze({ prepare: "yes", rearm: false, frontier: DELIVERY_PLANNING }),
    "delivery-prepared": Object.freeze({
        prepare: "no",
        rearm: false,
        frontier: Object.freeze({
            kind: "implementation-host-effect-execution",
            owner: "agent-host",
        }),
    }),
    "host-effect-accepted": Object.freeze({ prepare: "no", rearm: false, frontier: RESULT_IMPORT }),
    "host-effect-indeterminate": Object.freeze({
        prepare: "no",
        rearm: false,
        frontier: RESULT_IMPORT,
    }),
    // 发送前被拒：先 rearm；三次用尽后前沿回到准备新信封（route 按代际切换，见 demand-controller-route）。
    "host-effect-rejected": Object.freeze({
        prepare: "after-rearm-exhausted",
        rearm: true,
        frontier: Object.freeze({
            kind: "implementation-host-effect-rearm",
            owner: "target-host-effect-rearm",
        }),
    }),
    "result-reported": Object.freeze({ prepare: "no", rearm: false, frontier: RESULT_REVIEW }),
    accepted: Object.freeze({ prepare: "no", rearm: false, frontier: null }),
    "product-defect-rework-requested": Object.freeze({
        prepare: "yes",
        rearm: false,
        frontier: DELIVERY_PLANNING,
    }),
    "rework-requested": Object.freeze({ prepare: "yes", rearm: false, frontier: DELIVERY_PLANNING }),
    // escalated 期间由 Demand 的 awaiting-decision 前沿覆盖；回答后回到评审。
    escalated: Object.freeze({ prepare: "no", rearm: false, frontier: RESULT_REVIEW }),
    "review-blocked": Object.freeze({
        prepare: "no",
        rearm: false,
        frontier: Object.freeze({
            kind: "implementation-review-blocked",
            owner: "controller-implementation-review",
        }),
    }),
    superseded: Object.freeze({ prepare: "no", rearm: false, frontier: null }),
});
export const WAKEFLOW_TEST_TARGET_PHASE_RULES = Object.freeze({
    planned: Object.freeze({ prepare: "yes", rearm: false, stage: "test-delivery-planning" }),
    "test-delivery-prepared": Object.freeze({
        prepare: "no",
        rearm: false,
        stage: "test-host-effect-execution",
    }),
    "test-host-effect-accepted": Object.freeze({
        prepare: "no",
        rearm: false,
        stage: "test-result-planning",
    }),
    "test-host-effect-indeterminate": Object.freeze({
        prepare: "no",
        rearm: false,
        stage: "test-result-planning",
    }),
    "test-host-effect-rejected": Object.freeze({
        prepare: "after-rearm-exhausted",
        rearm: true,
        stage: "test-delivery-rearm-planning",
    }),
    "test-result-reported": Object.freeze({
        prepare: "no",
        rearm: false,
        stage: "test-result-review-planning",
    }),
    "test-accepted": Object.freeze({ prepare: "no", rearm: false, stage: "completion-preflight" }),
    "test-another-attempt-requested": Object.freeze({
        prepare: "yes",
        rearm: false,
        stage: "test-another-attempt-planning",
    }),
    "test-product-defect": Object.freeze({ prepare: "no", rearm: false, stage: null }),
    "test-review-blocked": Object.freeze({
        prepare: "no",
        rearm: false,
        stage: "test-review-blocked",
    }),
    "test-escalated": Object.freeze({ prepare: "no", rearm: false, stage: "test-review-escalated" }),
});
/** 该工作类型下某个阶段字符串的许可；不是该工作类型的阶段（含原型键）为 null。 */
export function wakeflowTargetPhaseAdmission(workType, phase) {
    const table = workType === "test"
        ? WAKEFLOW_TEST_TARGET_PHASE_RULES
        : WAKEFLOW_IMPLEMENTATION_TARGET_PHASE_RULES;
    return Object.hasOwn(table, phase) ? (table[phase] ?? null) : null;
}
/** 两种工作类型里允许 rearm 的阶段名（rearm 请求不带工作类型，按信封自己的阶段判定）。 */
export function wakeflowRearmablePhase(phase) {
    return (wakeflowTargetPhaseAdmission("implementation", phase)?.rearm === true ||
        wakeflowTargetPhaseAdmission("test", phase)?.rearm === true);
}
