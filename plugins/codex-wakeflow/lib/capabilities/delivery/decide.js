import { wakeflowRearmablePhase, wakeflowTargetPhaseAdmission, } from "../../contracts/vocabulary/wakeflow-target-phases.js";
import { DELIVERY_LANDING_SILENCE_MILLISECONDS } from "../../governance/delivery/delivery-outcome.js";
import { DELIVERY_REARM_LIMIT } from "../../governance/delivery/delivery-rearm.js";
import { findPromptLanding } from "../../kernel/prompt-digest.js";
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
 * 处置派生（能力卡 6 修订；ADR-0027）：摘要相符的 hook 记录 → accepted（`hook-record`）；摘要不符但
 * 带着许可标识的记录 → accepted（`hook-record-identity`，文本被宿主改动）；发送调用失败且未触碰会话 →
 * rejected-before-send；Codex 的发送返回摘要 → accepted；其余 indeterminate。显式解决优先。
 */
export function deriveDeliveryDisposition(input) {
    if (input.resolution !== null)
        return resolutionDecision(input);
    const landed = findPromptLanding(input.landingRecords, {
        promptDigest: input.expectedPromptDigest,
        permitId: input.permitId,
    });
    if (landed !== null) {
        return decided("accepted", landed.match === "digest" ? "hook-record" : "hook-record-identity", landed.record.recordId);
    }
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
    return profile.launch.kind === "project-thread";
}
/** 静默是否超过阈值：以当前代际第一次 indeterminate 结局的记录时刻为起点。 */
export function landingSilenceExceeded(silenceStartedAt, now, thresholdMilliseconds = DELIVERY_LANDING_SILENCE_MILLISECONDS) {
    return Date.parse(now) - Date.parse(silenceStartedAt) > thresholdMilliseconds;
}
/**
 * 窗口启动时要求的权限模式（open-items X4）：配置覆盖（`hosts.<宿主>.launch.permissionMode`）优先，否则取选出的
 * 宿主资源 Profile 的启动模板值；没有模式概念的启动模板（宿主线程型）为 null。共享代码不按宿主或传输分支。
 */
export function expectedLaunchPermissionMode(profile, configured) {
    if (!("permissionMode" in profile.launch))
        return null;
    return configured ?? profile.launch.permissionMode;
}
/**
 * 落地时的模式证据（open-items X4，设计提案第 3.4 节）：落地记录报告的模式与启动要求的模式不同，就在窗口上记
 * `permission-mode-mismatch:<windowId>`。它不改变处置——投递已落地、窗口仍可工作，只是会向用户要权限；
 * Controller 据此请用户为该目录选一次模式。记录没带模式（旧记录或事件不带该字段）或宿主没有模式要求时从不算不一致。
 */
export function derivePermissionModeBlocker(windowId, expected, observed) {
    if (expected === null || observed === null || expected === observed)
        return null;
    return `permission-mode-mismatch:${windowId}`;
}
/** 准备投递的目标 phase 阻塞项；rearm 未用尽的 rejected 目标必须先 rearm；等用户决定时一律阻塞。 */
export function derivePrepareBlockers(target) {
    if (target.awaitingDecision === true)
        return Object.freeze(["awaiting-decision"]);
    if (target.pendingDependencies !== undefined && target.pendingDependencies.length > 0) {
        return Object.freeze(target.pendingDependencies.map((targetTaskId) => `dependency-pending:${targetTaskId}`));
    }
    // 阶段许可只有一份：contracts 的 Target 阶段表（open-items L1）。
    const admission = wakeflowTargetPhaseAdmission(target.workType, target.phase);
    if (admission === null || admission.prepare === "no") {
        return Object.freeze([`target-phase:${target.phase}`]);
    }
    if (admission.prepare === "after-rearm-exhausted" &&
        target.generation !== null &&
        target.generation <= DELIVERY_REARM_LIMIT) {
        return Object.freeze([`rearm-available:${target.generation}`]);
    }
    return Object.freeze([]);
}
/** rearm 的阻塞项：只有 rejected-before-send 的当前代际可以 rearm，且不超过上限；等用户决定时一律阻塞。 */
export function deriveRearmBlockers(target) {
    if (target.awaitingDecision === true)
        return Object.freeze(["awaiting-decision"]);
    if (!wakeflowRearmablePhase(target.phase)) {
        return Object.freeze([`target-phase:${target.phase}`]);
    }
    if (target.generation > DELIVERY_REARM_LIMIT)
        return Object.freeze([`rearm-limit:${target.generation}`]);
    return Object.freeze([]);
}
/**
 * 窗口声明占用判定：另一 Demand 或另一目标持有即阻塞；同一目标的孤儿声明（聚合里没有
 * 对应投递）允许回收。孤儿判定基于调用方加载时的聚合快照，持有者可能是一次尚未追加的并发
 * prepare，所以回收由调用方在自己的追加以流修订 CAS 提交之后执行（open-items W13）。
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
