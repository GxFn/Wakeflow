import { WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF, WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF, } from "../../kernel/layout.js";
const NEXT_ACTIONS_MAXIMUM = 64;
const WORKSPACE_MAINTENANCE_FRONTIER = "workspace-maintenance";
const MAINTENANCE_TOOL = "wakeflow_maintain_workspace";
const REGISTRATION_TOOL = "wakeflow_register_window_binding";
const CREATE_DEMAND_TOOL = "wakeflow_create_demand";
/**
 * 顺序：维护 > 活动 pod 的未登记窗口 > 活动 Demand 前沿（primary 先，再按 demandId）>
 * 待认领需求包；去重，上限 64。
 */
export function deriveNextActions(input) {
    const actions = [];
    if (input.artifactServerOutdated) {
        actions.push({ owner: "user", tool: null, reason: "runtime-artifact-outdated", subject: null });
    }
    for (const windowId of [...input.staleArtifactWindows].sort()) {
        actions.push({
            owner: "controller",
            tool: null,
            reason: "window-artifact-stale",
            subject: windowId,
        });
    }
    if (input.maintenance) {
        actions.push({
            owner: "controller",
            tool: MAINTENANCE_TOOL,
            reason: WORKSPACE_MAINTENANCE_FRONTIER,
            subject: null,
        });
    }
    for (const window of [...input.unregisteredWindows]
        .filter((entry) => entry.podActive)
        .sort((left, right) => left.windowId.localeCompare(right.windowId))) {
        actions.push({
            owner: "controller",
            tool: REGISTRATION_TOOL,
            reason: "pod-window-registration",
            subject: window.windowId,
        });
    }
    const demands = [...input.demands].sort((left, right) => {
        if (left.placement !== right.placement)
            return left.placement === "primary" ? -1 : 1;
        return left.demandId.localeCompare(right.demandId);
    });
    for (const demand of demands) {
        if (demand.disposition === "terminal" || demand.frontier === null)
            continue;
        actions.push({
            owner: demand.owner,
            tool: demand.suggestedTool,
            reason: demand.frontier,
            subject: demand.demandId,
        });
    }
    for (const entry of [...input.pendingPackages].sort((left, right) => left.requirementId.localeCompare(right.requirementId))) {
        actions.push({
            owner: "controller",
            tool: CREATE_DEMAND_TOOL,
            reason: "requirement-claim",
            subject: entry.requirementId,
        });
    }
    const seen = new Set();
    const unique = actions.filter((action) => {
        const key = [action.owner, action.tool, action.reason, action.subject].join("|");
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
    return Object.freeze(unique.slice(0, NEXT_ACTIONS_MAXIMUM).map((action) => Object.freeze(action)));
}
/**
 * status 列表的 wire 上限（见 wakeflow-status-result Schema）：目录列举与活动 Demand 数都可以
 * 超过它们，越界只截断并报出略去的条数，不让整份结果被输出边界挡下。
 */
export const STATUS_LIST_MAXIMUMS = Object.freeze({
    demands: 256,
    windows: 512,
    claims: 512,
    pods: 64,
    repositories: 64,
    worktrees: 64,
    unmergedAccepted: 256,
});
/** 截到上限并报出被略去的条数；调用方先做确定性排序，截断才是确定的。 */
export function capStatusList(entries, maximum) {
    return Object.freeze({
        entries: Object.freeze(entries.slice(0, maximum)),
        omitted: Math.max(0, entries.length - maximum),
    });
}
/** 不带 demandId 的 `next`：头项动作；没有动作即无前沿。 */
export function nextFromActions(actions) {
    const first = actions[0];
    if (first === undefined) {
        return Object.freeze({
            frontier: null,
            owner: "none",
            suggestedTool: null,
            blockers: Object.freeze([]),
        });
    }
    return Object.freeze({
        frontier: first.reason,
        owner: first.owner,
        suggestedTool: first.tool,
        blockers: Object.freeze([]),
    });
}
const CODE_MAXIMUM_LENGTH = 256;
/**
 * 截断收尾用 `more-<剩余数>`：wire 的 `code` 只收 `[A-Za-z0-9._:,/-]` 且首字符必须是字母数字，
 * 所以收尾串既不能带 `+`，独占整个 code 时也要能自己起头。预留 `,more-` 六字符加六位数字。
 */
const CODE_TRUNCATION_PREFIX = "more-";
const CODE_SUFFIX_RESERVE = 12;
/** 把多个码连成一个 code（`,` 分隔）；超过 wire 上限时只保留放得下的前缀并以 `more-<剩余数>` 收尾。 */
function joinCodes(codes) {
    if (codes.length === 0)
        return null;
    const kept = [];
    for (const entry of codes) {
        const candidate = [...kept, entry].join(",");
        if (candidate.length > CODE_MAXIMUM_LENGTH - CODE_SUFFIX_RESERVE)
            break;
        kept.push(entry);
    }
    if (kept.length === codes.length)
        return kept.join(",");
    const rest = `${CODE_TRUNCATION_PREFIX}${codes.length - kept.length}`;
    return kept.length === 0 ? rest : `${kept.join(",")},${rest}`;
}
/** 域读不出时相关门的原因码：观察记录的 issue 已经是 `<域>:<原因>`，缺失时退回 `<域>:unavailable`。 */
function domainCode(name, domain) {
    return domain.issue ?? `${name}:unavailable`;
}
function gate(name, owner, status, code = null, evidence = Object.freeze([])) {
    return Object.freeze({ name, owner, status, code, evidence });
}
function verdict(pass, unavailable) {
    return unavailable ? "unavailable" : pass ? "pass" : "fail";
}
function aggregate(statuses) {
    if (statuses.some((status) => status === "fail"))
        return "fail";
    if (statuses.some((status) => status === "unavailable"))
        return "unavailable";
    return "pass";
}
function configGate(facts) {
    return gate("config-authority", "config-authority", verdict(facts.configRecheck === "current", facts.configRecheck === "unavailable"), facts.configRecheck === "current" ? null : facts.configRecheck, Object.freeze([Object.freeze({ ref: facts.configRef, digest: facts.configDigest })]));
}
/**
 * local-layout：静态资源矩阵的对账预览 ready 且无步骤，加活动布局 current（§13.94 D3）。
 * 预览走的核心布局检查已把维护协议的非 idle 状态（残留事务、活锁、冲突）报成
 * `maintenance-protocol-<状态>` 阻塞码，所以被打断的维护 apply 在这里失败（§13.129）。
 */
function localLayoutGate(facts) {
    const local = facts.local;
    const pass = local.status === "ready" && facts.layout === "current";
    const codes = [
        ...(local.status === "ready" ? [] : [`local:${local.status}`, ...local.codes]),
        ...(facts.layout === "current" ? [] : [`active:${facts.layout}`]),
    ];
    return gate("local-layout", "workspace-layout", verdict(pass, local.status === "unavailable" || facts.layout === "unavailable"), joinCodes(codes));
}
function layoutGates(facts) {
    return [
        localLayoutGate(facts),
        gate("ledger-layout", "ledger", verdict(facts.ledger === "current", facts.ledger === "unavailable"), facts.ledger === "current" ? null : facts.ledger),
    ];
}
function boardGate(facts) {
    const board = facts.board;
    if (board.status !== "observed") {
        return gate("board-consistency", "requirement-board", "unavailable", "unavailable");
    }
    const own = [
        ...(board.skipped > 0 ? [`skipped:${board.skipped}`] : []),
        ...(board.indexCurrent === false ? ["index-stale"] : []),
    ];
    // claimed 指向活动 Demand 的对账需要活动 Demand 集合；demands 域读不出就不做，也不假装通过。
    const demands = facts.domains.demands;
    if (demands.status !== "observed") {
        return gate("board-consistency", "requirement-board", "unavailable", joinCodes([...own, domainCode("demands", demands)]));
    }
    const codes = [
        ...own,
        ...board.claimedWithoutRoot.map((demandId) => `claimed-without-root:${demandId}`),
    ];
    return gate("board-consistency", "requirement-board", codes.length === 0 ? "pass" : "fail", joinCodes(codes));
}
function demandGates(facts) {
    const domain = facts.domains.demands;
    if (domain.status !== "observed") {
        const code = domainCode("demands", domain);
        return [
            gate("demand-root-audit", "demand-stream", "unavailable", code),
            gate("append-candidates-clear", "demand-stream", "unavailable", code),
            gate("evidence-integrity", "managed-evidence", "unavailable", code),
        ];
    }
    const unavailable = facts.demands.filter((demand) => demand.status !== "observed");
    const audit = aggregate([
        ...facts.demands.map((demand) => demand.audit),
        ...unavailable.map(() => "unavailable"),
    ]);
    const evidence = aggregate(facts.demands.map((demand) => demand.evidence));
    const candidates = facts.demands.reduce((sum, demand) => sum + demand.appendCandidates, 0);
    const strayCode = [
        ...(candidates > 0 ? [`candidates:${candidates}`] : []),
        ...(facts.strayJournals ?? []).map((demandId) => `journal:${demandId}`),
        ...(facts.strayJournals === null ? ["journals:unreadable"] : []),
    ];
    const strayStatus = facts.strayJournals === null ? "unavailable" : verdict(strayCode.length === 0, false);
    return [
        gate("demand-root-audit", "demand-stream", audit, audit === "pass"
            ? null
            : joinCodes([
                ...new Set([...facts.demands.filter((d) => d.audit !== "pass"), ...unavailable].map((d) => d.demandId)),
            ])),
        gate("append-candidates-clear", "demand-stream", strayStatus, joinCodes(strayCode)),
        gate("evidence-integrity", "managed-evidence", evidence, evidence === "pass"
            ? null
            : joinCodes(facts.demands.filter((d) => d.evidence !== "pass").map((d) => d.demandId))),
    ];
}
function claimsGate(facts) {
    const claims = facts.domains.claims;
    if (claims.status !== "observed") {
        return gate("work-claims", "work-claims", "unavailable", domainCode("claims", claims));
    }
    const unreadable = facts.claimsUnreadable > 0 ? [`unreadable:${facts.claimsUnreadable}`] : [];
    // 孤儿判定要活动 Demand 集合；demands 域读不出就不把每份声明都算成孤儿。
    const demands = facts.domains.demands;
    if (demands.status !== "observed") {
        return gate("work-claims", "work-claims", "unavailable", joinCodes([...unreadable, domainCode("demands", demands)]));
    }
    const orphans = facts.claims
        .filter((claim) => claim.orphan)
        .map((claim) => `orphan:${claim.windowId}`);
    const code = [...orphans, ...unreadable];
    return gate("work-claims", "work-claims", code.length === 0 ? "pass" : "fail", joinCodes(code));
}
/**
 * 一个宿主的 hook 通道码：不可用、模式不对、有读不出的记录是损坏；当前宿主的目录缺席或零记录
 * 不是损坏但值得看见——"hook 从未触发"（未信任、`node` 不在 PATH、cwd 匹配失败）在 verify 里
 * 以 `absent` / `records-0` 报出（§13.97 D10），同伴宿主的缺席保持沉默。
 */
function hookHostCode(host) {
    if (host.status !== "observed")
        return "unavailable";
    if (host.directory === "mode")
        return "mode";
    if (host.skipped > 0)
        return `skipped-${host.skipped}`;
    if (!host.current)
        return null;
    if (host.directory === "absent")
        return "absent";
    return host.records === 0 ? "records-0" : null;
}
function hooksGate(facts) {
    const statuses = facts.hooks.map((host) => verdict(host.directory !== "mode" && host.skipped === 0, host.status !== "observed"));
    const status = aggregate(statuses);
    const code = facts.hooks.flatMap((host) => {
        const hostCode = hookHostCode(host);
        return hostCode === null ? [] : [`${host.hostId}:${hostCode}`];
    });
    return gate("host-hook-channel", "host-hooks", status, joinCodes(code));
}
function windowsGate(facts) {
    const unobserved = facts.windows.filter((window) => window.identity === "unobserved").length;
    const unregistered = facts.windows.filter((window) => window.identity === "unregistered").length;
    return gate("window-identity", "window-identity", unobserved > 0 ? "unavailable" : "pass", unobserved > 0
        ? `unobserved:${unobserved}`
        : unregistered > 0
            ? `unregistered:${unregistered}`
            : null);
}
/**
 * window-runtime-projection：每个宿主对每个配置窗口的运行投影都等于当前 Config 与 Binding 的
 * 重算才 pass；stale / missing / unsafe 逐窗口报出（reconcile 修前两种，unsafe 只报告）；
 * 宿主运行时根未发布或 inventory 读不出即 unavailable（G6，§13.111）。
 */
function windowRuntimeGate(facts) {
    const status = aggregate(facts.windowRuntime.map((host) => verdict(host.windows.every((window) => window.status === "current"), host.status !== "observed")));
    const codes = facts.windowRuntime.flatMap((host) => host.status !== "observed"
        ? [`${host.hostId}:${host.issue ?? "unavailable"}`]
        : host.windows
            .filter((window) => window.status !== "current")
            .map((window) => `${host.hostId}:${window.windowId}:${window.status}`));
    return gate("window-runtime-projection", "window-runtime", status, joinCodes(codes));
}
/** code 里不算失败的两种过渡态：待登记（creating）与待处置（closing）。 */
const PENDING_POD_CODE_SUFFIXES = Object.freeze([":pending-registration", ":disposal-pending"]);
/**
 * worktree pod：回执要求只落在 ready（与 closing 的检出处置）上（§13.94 D3）。creating 的 pod
 * 还没登记窗口，回执缺席是过渡态——报 `pending-registration` 但不失败，否则 verify 会把只能靠
 * 窗口登记解决的状态指向工作区维护。closing 时仍在的检出只是待处置，也不算失败。
 */
function worktreePodCodes(pod) {
    return pod.worktrees.flatMap((worktree) => {
        if (pod.lifecycle === "closing") {
            return worktree.receipt === "present"
                ? [`${pod.podId}:${worktree.repositoryId}:disposal-pending`]
                : [];
        }
        if (worktree.receipt === "present")
            return [];
        if (pod.state === "creating") {
            return [`${pod.podId}:${worktree.repositoryId}:pending-registration`];
        }
        return [`${pod.podId}:${worktree.repositoryId}:${worktree.receipt}`];
    });
}
/** primary pod：仓库根必须是主检出（`.git` 是目录）；仓库未观察即 unavailable。 */
function primaryPodCodes(pod, primaryCheckouts) {
    if (primaryCheckouts === null)
        return { codes: [], unavailable: true };
    return { codes: primaryCheckouts ? [] : [`${pod.podId}:main-checkout`], unavailable: false };
}
function podsGate(facts) {
    const domain = facts.domains.pods;
    if (domain.status !== "observed") {
        return gate("pod-execution-location", "pod", "unavailable", domainCode("pods", domain));
    }
    const codes = [];
    let unavailable = facts.pods.some((pod) => pod.state === "unobserved");
    for (const pod of facts.pods) {
        if (pod.placement === "primary") {
            const primary = primaryPodCodes(pod, facts.primaryCheckouts);
            codes.push(...primary.codes);
            unavailable = unavailable || primary.unavailable;
        }
        else {
            codes.push(...worktreePodCodes(pod));
        }
    }
    const failing = codes.some((code) => !PENDING_POD_CODE_SUFFIXES.some((suffix) => code.endsWith(suffix)));
    return gate("pod-execution-location", "pod", failing ? "fail" : unavailable ? "unavailable" : "pass", joinCodes(codes));
}
/**
 * runtime-artifact（§13.127）：本进程启动时的制品 manifest 与磁盘上的一致（否则 server-outdated，
 * 本窗口的服务进程要重连），且每个已登记窗口的会话都在同一份制品下启动（否则列出 stale 窗口，
 * 由 Controller 用助手 resume）。没有 manifest 可比的运行记 not-applicable 而不是冒充一致。
 */
function runtimeArtifactGate(facts) {
    const { manifestDigest, onDiskDigest, staleWindows } = facts.runtime;
    if (manifestDigest === null)
        return gate("runtime-artifact", "runtime", "pass", "not-applicable");
    const codes = [
        ...(onDiskDigest !== null && onDiskDigest !== manifestDigest ? ["server-outdated"] : []),
        ...(staleWindows.length > 0 ? [`windows-stale:${staleWindows.length}`] : []),
    ];
    return gate("runtime-artifact", "runtime", codes.length === 0 ? "pass" : "fail", joinCodes(codes));
}
/** 资产字节与本地设置条目各一票：资产读不出、设置文件不是 JSON 对象算 unavailable。 */
function assetsGate(facts) {
    const applicable = facts.assets.filter((asset) => asset.status !== "not-applicable");
    const status = aggregate(applicable.flatMap((asset) => [
        verdict(asset.status === "current", asset.status === "unavailable"),
        verdict(asset.settings === "current", asset.settings === "unreadable"),
    ]));
    const code = applicable.length === 0
        ? "not-applicable"
        : status === "pass"
            ? null
            : joinCodes(applicable.flatMap((asset) => [
                ...(asset.status === "current"
                    ? []
                    : [
                        `${asset.hostId}:${asset.companion ? `${asset.companion}:` : ""}${asset.status}`,
                    ]),
                ...(asset.settings === "current"
                    ? []
                    : [`${asset.hostId}:settings-${asset.settings}`]),
            ]));
    return gate("host-settings-assets", "host-assets", status, code);
}
/**
 * 门证据只收两份工作区页：每个活动 Demand 另有两份投影页，32 个 Demand 就会越过 wire 的
 * `evidence` 上限 64 而让整次 verify 变成 output-boundary。每 Demand 的页已经由
 * `status.projection.targets` 逐项带摘要，门不必重复它们。
 */
const PROJECTION_EVIDENCE_REFS = Object.freeze([
    WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
    WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF,
]);
function projectionGate(facts) {
    const targets = facts.projection.targets;
    const evidence = Object.freeze(targets.flatMap((target) => target.digest === null || !PROJECTION_EVIDENCE_REFS.includes(target.resourcePath)
        ? []
        : [Object.freeze({ ref: target.resourcePath, digest: target.digest })]));
    if (facts.projection.status !== "observed") {
        return gate("active-projection", "active-projection", "unavailable", "unavailable", evidence);
    }
    const handwritten = targets.filter((target) => target.status === "unsafe" && target.reason === "handwritten");
    const broken = targets.filter((target) => target.status !== "current" &&
        !(target.status === "unsafe" && target.reason === "handwritten"));
    // 手写文件让整轮零写：那是用户的选择，不是系统故障；同轮被挡下的兄弟文件只在 code 里报出。
    if (handwritten.length > 0) {
        return gate("active-projection", "active-projection", "pass", broken.length === 0 ? "handwritten" : `handwritten,blocked:${broken.length}`, evidence);
    }
    if (broken.length > 0) {
        return gate("active-projection", "active-projection", "fail", joinCodes(broken.map((target) => `${target.status}${target.reason === null ? "" : `-${target.reason}`}`)), evidence);
    }
    return gate("active-projection", "active-projection", "pass", null, evidence);
}
/** 十五道工作区门，按名字排序；每门只看纯事实。 */
export function deriveWorkspaceGates(facts) {
    const gates = [
        configGate(facts),
        ...layoutGates(facts),
        boardGate(facts),
        ...demandGates(facts),
        claimsGate(facts),
        hooksGate(facts),
        windowsGate(facts),
        windowRuntimeGate(facts),
        podsGate(facts),
        assetsGate(facts),
        projectionGate(facts),
        runtimeArtifactGate(facts),
    ];
    return Object.freeze([...gates].sort((left, right) => left.name.localeCompare(right.name)));
}
/** `ok` 要求至少一门且全部 pass；`unavailable` 算不通过但分开计数（能力卡 9 Q3）。 */
export function summarizeGates(gates) {
    const pass = gates.filter((entry) => entry.status === "pass").length;
    const fail = gates.filter((entry) => entry.status === "fail").length;
    const unavailable = gates.filter((entry) => entry.status === "unavailable").length;
    return Object.freeze({
        ok: gates.length > 0 && pass === gates.length,
        summary: Object.freeze({ pass, fail, unavailable }),
    });
}
/** verify 的 next：不通过时指向维护，列出未通过的门。 */
export function verifyNext(gates) {
    const failing = gates.filter((entry) => entry.status !== "pass");
    if (failing.length === 0) {
        return Object.freeze({
            frontier: null,
            owner: "none",
            suggestedTool: null,
            blockers: Object.freeze([]),
        });
    }
    return Object.freeze({
        frontier: WORKSPACE_MAINTENANCE_FRONTIER,
        owner: "controller",
        suggestedTool: MAINTENANCE_TOOL,
        blockers: Object.freeze(failing.map((entry) => `${entry.name}:${entry.status}`)),
    });
}
export function projectionFreshness(targets) {
    if (targets === null)
        return "unavailable";
    if (targets.some((target) => target.status === "unsafe"))
        return "unsafe";
    if (targets.some((target) => target.status === "missing"))
        return "missing";
    if (targets.some((target) => target.status === "stale"))
        return "stale";
    return "current";
}
export { worktreeDisposalGuidance as disposalGuidance } from "../../governance/pod/worktree-disposal.js";
