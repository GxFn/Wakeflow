import { DELIVERY_LANDING_SILENCE_MILLISECONDS } from "../../governance/delivery/delivery-outcome.js";
import { DELIVERY_REARM_LIMIT } from "../../governance/delivery/delivery-rearm.js";
/**
 * Wakeflow Capabilities / Delivery：投递切片的纯决定（能力卡 6，ADR-0009，ADR-0012 D2）。
 *
 * 这里没有 I/O：处置由证据派生，准备与 rearm 的阻塞项由状态派生，静默阈值只做时间比较。
 * 阈值按 ADR-0012 未决数值先作常量，由治理层 `delivery-outcome` 导出并进 status 的 policy 段（§13.94 D7）。
 */
/** ambiguous 静默阈值：超过后 `next` 转给 Controller 并列出 landing-evidence-missing；值在治理层的策略表里。 */
export { DELIVERY_LANDING_SILENCE_MILLISECONDS };
/**
 * 目标窗口必须加载的技能：宿主差异只在指令文件名，技能路径两宿主一致。
 *
 * 技能集合按窗口角色切成四份后（gate-log §13.99 D1），实现目标只剩 target 一条——旧的
 * `wakeflow-target-craft` 已降级为 `skills/wakeflow-target/references/craft.md`，由 target
 * 技能按需加载，不再是投递 prompt 里的一条必需技能。测试目标仍是两条：测试窗口要先按 target
 * 懂交付形状，再读测试合同。路径以制品根为基准，与 `assets/agent-text/` 渲染出的路径逐字相同。
 */
export const DELIVERY_REQUIRED_SKILLS = Object.freeze({
    implementation: Object.freeze(["skills/wakeflow-target/SKILL.md"]),
    test: Object.freeze(["skills/wakeflow-target/SKILL.md", "skills/wakeflow-test/SKILL.md"]),
});
/** 可以准备投递的目标 phase；两种发送前拒绝都只在 rearm 用尽后允许换新信封。 */
const PREPARABLE_IMPLEMENTATION_PHASES = Object.freeze([
    "planned",
    "rework-requested",
    "product-defect-rework-requested",
    "host-effect-rejected",
]);
const PREPARABLE_TEST_PHASES = Object.freeze([
    "planned",
    "test-another-attempt-requested",
    "test-host-effect-rejected",
]);
function decided(disposition, evidenceKind, hookRecordId = null, rationale = null) {
    return Object.freeze({
        accepted: true,
        disposition,
        evidenceKind,
        hookRecordId,
        rationale,
    });
}
function resolutionDecision(input) {
    const resolution = input.resolution;
    if (resolution === null)
        return Object.freeze({ accepted: false, blocker: "resolution-missing" });
    if (!input.currentlyIndeterminate) {
        return Object.freeze({ accepted: false, blocker: "resolution-phase" });
    }
    if (resolution.disposition === "accepted") {
        if (resolution.hookRecordId === null || !input.resolutionRecordFound) {
            return Object.freeze({ accepted: false, blocker: "resolution-evidence-missing" });
        }
        return decided("accepted", "controller-resolution", resolution.hookRecordId, resolution.rationale);
    }
    return decided("rejected-before-send", "controller-resolution", null, resolution.rationale);
}
/**
 * 处置派生（能力卡 6 修订）：匹配的 hook 记录 → accepted；发送调用失败且未触碰会话 →
 * rejected-before-send；Codex 的发送返回摘要 → accepted；其余 indeterminate。显式解决优先。
 */
export function deriveDeliveryDisposition(input) {
    if (input.resolution !== null)
        return resolutionDecision(input);
    const landed = input.landingRecords.find((record) => record.promptDigest === input.expectedPromptDigest);
    if (landed !== undefined)
        return decided("accepted", "hook-record", landed.recordId);
    if (input.attempt.status === "failed-before-send") {
        if (input.currentlyIndeterminate) {
            return Object.freeze({ accepted: false, blocker: "attempt-status" });
        }
        return decided("rejected-before-send", "agent-declaration");
    }
    if (input.sendReturnProvesLanding &&
        input.attempt.status === "sent" &&
        input.attempt.evidenceDigest !== null) {
        return decided("accepted", "host-send-return");
    }
    if (input.currentlyIndeterminate) {
        return Object.freeze({ accepted: false, blocker: "landing-evidence-missing" });
    }
    return decided("indeterminate", "agent-declaration");
}
/**
 * 宿主线程型启动（宿主工具自己建线程并同步投递）的发送返回即落地证据；
 * tmux 会话型宿主只能以目标会话的 hook 记录证明落地。
 */
export function sendReturnProvesLanding(profile) {
    return profile.launch.kind === "host-thread";
}
/** 静默是否超过阈值：以当前代际第一次 indeterminate 结局的记录时刻为起点。 */
export function landingSilenceExceeded(silenceStartedAt, now, thresholdMilliseconds = DELIVERY_LANDING_SILENCE_MILLISECONDS) {
    return Date.parse(now) - Date.parse(silenceStartedAt) > thresholdMilliseconds;
}
/** 准备投递的目标 phase 阻塞项；rearm 未用尽的 rejected 目标必须先 rearm。 */
export function derivePrepareBlockers(target) {
    const admitted = target.workType === "test"
        ? PREPARABLE_TEST_PHASES.includes(target.phase)
        : PREPARABLE_IMPLEMENTATION_PHASES.includes(target.phase);
    if (!admitted)
        return Object.freeze([`target-phase:${target.phase}`]);
    if ((target.phase === "host-effect-rejected" || target.phase === "test-host-effect-rejected") &&
        target.generation !== null &&
        target.generation <= DELIVERY_REARM_LIMIT) {
        return Object.freeze([`rearm-available:${target.generation}`]);
    }
    return Object.freeze([]);
}
/** rearm 的阻塞项：只有 rejected-before-send 的当前代际可以 rearm，且不超过上限。 */
export function deriveRearmBlockers(target) {
    if (target.phase !== "host-effect-rejected" && target.phase !== "test-host-effect-rejected") {
        return Object.freeze([`target-phase:${target.phase}`]);
    }
    if (target.generation > DELIVERY_REARM_LIMIT)
        return Object.freeze([`rearm-limit:${target.generation}`]);
    return Object.freeze([]);
}
/**
 * 窗口声明占用判定：另一 Demand 或另一目标持有即阻塞；同一目标的孤儿声明（聚合里没有
 * 对应投递）允许回收。
 */
export function deriveClaimBlocker(holder, demandId, targetTaskId, knownDeliveryIds) {
    if (holder === null)
        return Object.freeze({ blocker: null, reclaim: false });
    if (holder.demandId !== demandId) {
        return Object.freeze({ blocker: `window-claimed:${holder.demandId}`, reclaim: false });
    }
    if (holder.targetTaskId !== targetTaskId) {
        return Object.freeze({ blocker: `window-claimed:${holder.targetTaskId}`, reclaim: false });
    }
    if (knownDeliveryIds.includes(holder.deliveryId)) {
        return Object.freeze({ blocker: `window-claimed:${holder.deliveryId}`, reclaim: false });
    }
    return Object.freeze({ blocker: null, reclaim: true });
}
