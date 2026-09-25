import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseJsonValue } from "../../foundation/data/json-value.js";
import { deriveDurableId } from "../../kernel/ids.js";
import { CREDENTIAL_PRIVACY_FINDING_KINDS, DEFAULT_ALLOWED_ID_PREFIXES, scanPrivacy, } from "../../kernel/privacy-scan.js";
/** 认领即创建：同一需求包与同一认领状态派生同一个 Demand 身份，重试不会造出第二个。 */
export function deriveDemandCreationIds(requirementId, claimStateDigest) {
    const demandId = deriveDurableId("demand", "requirement-claim", requirementId, claimStateDigest);
    return Object.freeze({
        demandId,
        eventId: deriveDurableId("demand-event", "demand-publication", demandId),
        commitId: deriveDurableId("demand-event-commit", "demand-publication", demandId),
    });
}
/** 生命周期事件的标识由 Demand、动作与期望修订号派生：同一前置状态上的重试命中同一提交。 */
export function deriveLifecycleIds(demandId, action, expectedStreamRevision) {
    const revision = String(expectedStreamRevision);
    return Object.freeze({
        eventId: deriveDurableId("demand-event", `lifecycle-${action}`, demandId, revision),
        commitId: deriveDurableId("demand-event-commit", `lifecycle-${action}`, demandId, revision),
    });
}
/** Demand 根内可重建的检查点与未成为事实的候选，不进归档负载。 */
export const ARCHIVE_EXCLUDED_PREFIXES = Object.freeze([
    "event-sourcing/snapshots",
    "event-sourcing/index",
    "event-sourcing/append-candidates",
]);
export function isArchivePayloadPath(path) {
    return !ARCHIVE_EXCLUDED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
/** 负载树摘要：路径与内容摘要的规范 JSON；与文件权限位、时间无关。 */
export function computePayloadTreeDigest(files) {
    return computeCanonicalJsonSha256Digest(parseJsonValue([...files]
        .sort((left, right) => left.resourcePath < right.resourcePath
        ? -1
        : left.resourcePath > right.resourcePath
            ? 1
            : 0)
        .map((file) => ({ path: file.resourcePath, bytes: file.byteCount, digest: file.digest })), "$payload"));
}
const PRIVACY_POLICY = Object.freeze({
    allowedPathRoots: Object.freeze([]),
    allowedIdPrefixes: DEFAULT_ALLOWED_ID_PREFIXES,
});
const PAYLOAD_PRIVACY_BLOCKER_MAXIMUM = 16;
/** 归档进 tracked 的 Ledger，只拒绝凭证类命中（能力卡 8）；路径与标识由归档负载自带。 */
export function payloadPrivacyBlockers(files) {
    const blockers = [];
    for (const file of files) {
        for (const finding of scanPrivacy(file.text, PRIVACY_POLICY)) {
            if (!CREDENTIAL_PRIVACY_FINDING_KINDS.includes(finding.kind))
                continue;
            blockers.push(`payload-privacy:${file.resourcePath}:${finding.line}:${finding.kind}`);
            if (blockers.length >= PAYLOAD_PRIVACY_BLOCKER_MAXIMUM)
                return Object.freeze(blockers);
        }
    }
    return Object.freeze(blockers);
}
/** 等待 Controller 评审的结果：取消必须先把它们评掉（F5.5）。 */
export function pendingReviewTargets(state) {
    return Object.freeze(state.targetTasks
        .filter((target) => target.phase === "result-reported" || target.phase === "test-result-reported")
        .map((target) => target.targetTaskId));
}
export { demandWindowIds, } from "../../governance/demand/demand-verify-gates.js";
const BLOCKERS_MAXIMUM = 64;
function lifecycleBlockers(input) {
    const blockers = [];
    if (input.lifecycle !== "active")
        blockers.push(`lifecycle:${input.lifecycle}`);
    if (input.action === "complete") {
        if (input.awaitingDecision)
            blockers.push("awaiting-decision");
        if (input.postAcceptanceStage !== "completion-preflight") {
            blockers.push(`route:${input.postAcceptanceStage}`);
        }
    }
    else {
        for (const targetTaskId of input.pendingReviews)
            blockers.push(`pending-review:${targetTaskId}`);
    }
    return blockers;
}
function packageBlockers(input) {
    if (input.claim === null)
        return ["package-unknown"];
    if (input.claim.status !== "claimed" || input.claim.claim?.demandId !== input.demandId) {
        return [`package-claim:${input.claim.status}`];
    }
    return [];
}
function gateBlockers(input) {
    const blockers = [];
    for (const gate of input.gates) {
        if (gate.status === "pass")
            continue;
        // 取消自己释放窗口工作声明；该门只在完成时阻塞。
        if (input.action === "cancel" && gate.gate === "work-claims-released")
            continue;
        blockers.push(`verify:${gate.gate}:${gate.status}`);
    }
    return blockers;
}
/** 完成与取消的阻塞项；空即 ready。verify 门失败逐条列出，`unavailable` 也阻塞。 */
export function deriveTerminalBlockers(input) {
    const blockers = [
        ...lifecycleBlockers(input),
        ...packageBlockers(input),
        ...gateBlockers(input),
        ...input.payloadBlockers,
        ...(input.archiveConflict ? ["archive-conflict"] : []),
    ];
    return Object.freeze([...new Set(blockers)].slice(0, BLOCKERS_MAXIMUM));
}
/**
 * continue 只对已归档的完成 Demand 开放，且需求包仍由它归档、所在 pod 仍存在、未在关闭且没有别的活动 Demand。
 * research Demand 不可继续：继续后的路线要求规划实现任务包，而 research 没有实现目标。
 */
export function deriveContinueBlockers(input) {
    const blockers = [];
    if (input.rootPresent)
        blockers.push("demand-root-present");
    if (input.archiveOutcome === null)
        blockers.push("archive-absent");
    else if (input.archiveOutcome !== "completed")
        blockers.push(`archive-outcome:${input.archiveOutcome}`);
    if (input.claim === null)
        blockers.push("package-unknown");
    else if (input.claim.status !== "archived" || input.claim.archive?.demandId !== input.demandId) {
        blockers.push(`package-claim:${input.claim.status}`);
    }
    if (input.claim?.demandType === "research")
        blockers.push("demand-type:research");
    if (typeof input.archivedPodId === "string" && input.pod === null)
        blockers.push(`pod-unknown:${input.archivedPodId}`);
    else if (input.pod != null && input.pod.lifecycle !== "open")
        blockers.push(`pod-closing:${input.pod.podId}`);
    if (input.otherActiveDemandId !== null)
        blockers.push(`pod-busy:${input.otherActiveDemandId}`);
    return Object.freeze(blockers);
}
export function deriveDecisionBlockers(input) {
    const blockers = [];
    if (!input.rootPresent)
        blockers.push("demand-root-absent");
    if (input.lifecycle !== null && input.lifecycle !== "active")
        blockers.push(`lifecycle:${input.lifecycle}`);
    if (input.rootPresent && !input.awaitingDecision)
        blockers.push("no-escalation-pending");
    return Object.freeze(blockers);
}
/**
 * 认领前置：包 pending、记录属于本程序且与看板绑定同一记录、目标 pod 存在且未在关闭、
 * 该 pod 没有别的活动 Demand（ADR-0010 D3：一 pod 一 Demand）。
 */
export function deriveCreationBlockers(input) {
    const blockers = [];
    if (input.claim === null)
        blockers.push("package-unknown");
    else if (input.claim.status !== "pending")
        blockers.push(`package-claim:${input.claim.status}`);
    if (input.claim !== null && !input.programMatches)
        blockers.push("package-program");
    if (input.claim !== null && !input.recordMatches)
        blockers.push("package-record-drift");
    if (input.pod === null)
        blockers.push(`pod-unknown:${input.requestedPodId}`);
    else {
        if (input.pod.lifecycle !== "open")
            blockers.push(`pod-closing:${input.pod.podId}`);
        if (input.pod.activeDemandId !== null)
            blockers.push(`pod-busy:${input.pod.activeDemandId}`);
    }
    return Object.freeze(blockers);
}
