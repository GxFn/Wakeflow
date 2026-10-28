import path from "node:path";
import { readWakeflowConfigAuthoritySnapshot, readWakeflowDetachedConfigSnapshot, WAKEFLOW_CONFIG_FILE_REF, WAKEFLOW_DETACHED_CONFIG_FILE_REF, WakeflowConfigAuthoritySnapshotError, } from "../../configuration/wakeflow-config-authority-snapshot.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { readStableResourceDirectory, StableDirectoryReadError, } from "../../foundation/filesystem/stable-directory-read.js";
import { truncateToCodePoints } from "../../foundation/text/bounded-text.js";
import { closeDemandOperationRoot, openDemandOperationRoot, } from "../../governance/demand/demand-operation-authority-context.js";
import { demandWindowIds, evaluateVerifyGates, } from "../../governance/demand/demand-verify-gates.js";
import { DemandEventSourcingRepository } from "../../governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { loadDemandEventSourcingRootAuthority } from "../../governance/demand/event-sourcing/demand-event-sourcing-root-authority.js";
import { inspectLedgerAuthorityLayout } from "../../governance/ledger/ledger-authority-layout.js";
import { LedgerAuthorityStore } from "../../governance/ledger/ledger-authority-store.js";
import { observeProjectionTargets, unmergedAcceptedFacts, } from "../../governance/observation/active-projection-facts.js";
import { describeDemandArchive, locateLatestDemandArchive, } from "../../governance/observation/demand-archive-locator.js";
import { deriveOverallStatus, observeWorkspace, orphanWorkClaims, } from "../../governance/observation/workspace-observation.js";
import { commandShellExecutionOptions, runCommandShell } from "../../kernel/command-shell.js";
import { fail } from "../../kernel/error.js";
import { DEMAND_LIFECYCLE_JOURNALS_ROOT_REF } from "../../kernel/layout.js";
import { deriveNextProjection } from "../../kernel/next-projection.js";
import { readRequirementClaimState } from "../../kernel/requirement-board.js";
import { newestWakeflowArtifactVersion } from "../../kernel/wakeflow-artifact-identity.js";
import { readWakeflowMaintenanceJournalOrNull, WakeflowMaintenanceJournalStoreError, } from "../../workspace/maintenance/wakeflow-maintenance-journal-store.js";
import { inspectWakeflowPrivateModes, wakeflowPrivateModeAreas, } from "../../workspace/maintenance/wakeflow-private-mode-census.js";
import { previewWakeflowStaticMaterialization } from "../../workspace/maintenance/wakeflow-static-materialization-preview.js";
import { inspectWakeflowWorkspaceCoreLayout, WakeflowWorkspaceCoreLayoutInspectionError, } from "../../workspace/maintenance/wakeflow-workspace-core-layout-inspection.js";
import { compileWakeflowWindowLaunchIntents } from "../../workspace/window-runtime/wakeflow-window-launch-intent.js";
import { admitStatusResult, admitVerifyResult, parseStatusRequest, parseVerifyRequest, WAKEFLOW_OBSERVATION_PUBLIC_SCHEMA_VERSION, WAKEFLOW_STATUS_PUBLIC_TOOL_NAME, WAKEFLOW_VERIFY_PUBLIC_TOOL_NAME, } from "./contract.js";
import { capStatusList, DETACHED_WORKSPACE_NEXT, deriveNextActions, deriveServerRuntime, deriveWindowRuntime, deriveWorkspaceGates, detachedWorkspaceGates, disposalGuidance, nextFromActions, projectionFreshness, STATUS_LIST_MAXIMUMS, summarizeGates, verifyNext, } from "./decide.js";
/** status 的残留列表上限（wire 的 maxItems）；超出只报略去的条数。 */
const MAINTENANCE_RESIDUES_MAXIMUM = 64;
const RESIDUE_NAME_MAXIMUM = 128;
/**
 * 残留文件名进公共结果前单行化并有界（singleLineText 不收控制字符）：它是 Wakeflow 自有目录
 * 里的一个名字，不是路径，但名字本身可以是任何字节，所以只保留可打印字符。
 */
function residueDisplayName(name) {
    let cleaned = "";
    for (const character of name) {
        const codePoint = character.codePointAt(0) ?? 0;
        cleaned += codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f) ? "?" : character;
    }
    const bounded = truncateToCodePoints(cleaned, RESIDUE_NAME_MAXIMUM);
    return bounded.trim().length === 0 ? "?" : bounded;
}
function maintenanceView(maintenance) {
    const residues = capStatusList(maintenance.residues, MAINTENANCE_RESIDUES_MAXIMUM);
    return {
        status: maintenance.status,
        protocol: maintenance.protocol,
        residues: residues.entries.map((residue) => ({
            name: residueDisplayName(residue.name),
            kind: residue.kind,
            operationId: residue.operationId,
            // busy 时条目属于正在进行的维护，不是可恢复的残留（§13.130 审查 P1-7）。
            recoverable: residue.operationId !== null && maintenance.protocol !== "busy",
        })),
        residuesOmitted: residues.omitted,
    };
}
const PENDING_PACKAGES_MAXIMUM = 64;
const PRIORITY_ORDER = Object.freeze({
    P0: 0,
    P1: 1,
    P2: 2,
    P3: 3,
});
const DIRECTORY_MAXIMUM_ENTRIES = 4096;
const JOURNAL_FILE_PATTERN = /^(demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/u;
function signalOptions(signal) {
    return signal === undefined ? {} : { signal };
}
function reasonOf(error) {
    if (typeof error !== "object" || error === null)
        return null;
    const reason = error.reason;
    return typeof reason === "string" ? reason : null;
}
/**
 * verify 的加读把"域读不出"降级成 unavailable，但中止不是域故障：和 openContext 一样收敛成
 * `io-failure/aborted`，否则基础层的原始异常会在 MCP 信封里变成 `unexpected/unhandled`。
 */
function failIfAborted(error) {
    if (reasonOf(error) === "aborted")
        fail("io-failure", "aborted", "$signal", { cause: error });
}
// ---- 上下文 ----------------------------------------------------------------------
async function configFileAbsent(root) {
    try {
        await root.inspectExistingResource(WAKEFLOW_CONFIG_FILE_REF, "$config");
        return false;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError && error.reason === "resource-not-found") {
            return true;
        }
        throw error;
    }
}
/**
 * 配置快照；配置文件不在而 `wakeflow.detached.json` 在时以退役文件为只读来源（ADR-0024 终态），
 * 这样 status / verify 说得出"这里曾是 Wakeflow 工作区"，而不是报配置缺失。
 */
/** 退役快照：配置文件不在而退役文件可读才有；不在或读不出为 null，中止照常收敛。 */
async function detachedSnapshotOrNull(root, signal) {
    if (!(await configFileAbsent(root)))
        return null;
    try {
        return await readWakeflowDetachedConfigSnapshot(root, signalOptions(signal));
    }
    catch (error) {
        if (!(error instanceof WakeflowConfigAuthoritySnapshotError))
            throw error;
        if (error.reason === "aborted")
            fail("io-failure", "aborted", "$signal", { cause: error });
        return null;
    }
}
async function readSnapshot(root, signal) {
    try {
        return {
            snapshot: await readWakeflowConfigAuthoritySnapshot(root, signalOptions(signal)),
            detached: false,
        };
    }
    catch (error) {
        if (!(error instanceof WakeflowConfigAuthoritySnapshotError))
            throw error;
        if (error.reason === "aborted")
            fail("io-failure", "aborted", "$signal", { cause: error });
        const detached = error.reason === "source" ? await detachedSnapshotOrNull(root, signal) : null;
        if (detached !== null)
            return { snapshot: detached, detached: true };
        fail("precondition-failed", "config-authority", "$request.root", { cause: error });
    }
}
async function openLedgerRoot(root, snapshot) {
    const placement = snapshot.placements.roots.find((entry) => entry.key === "ledger.root");
    if (placement === undefined || placement.state !== "present" || placement.realPath === null) {
        fail("precondition-failed", "ledger-root-missing", "$request.root");
    }
    try {
        return await RootedDirectory.open(placement.absolutePath, "$ledgerRoot", {
            durability: root.durability,
        });
    }
    catch (error) {
        if (error instanceof RootedDirectoryError) {
            fail("precondition-failed", "ledger-root", "$request.root", { cause: error });
        }
        throw error;
    }
}
/** 检查读不出即 unavailable（不猜 idle），中止照常上抛；检查本身零写。 */
async function observeMaintenance(root, signal) {
    try {
        const core = await inspectWakeflowWorkspaceCoreLayout(root, signalOptions(signal));
        return Object.freeze({
            status: "observed",
            protocol: core.local.status,
            residues: core.local.residues,
        });
    }
    catch (error) {
        if (!(error instanceof WakeflowWorkspaceCoreLayoutInspectionError))
            throw error;
        failIfAborted(error);
        return Object.freeze({
            status: "unavailable",
            protocol: "unknown",
            residues: Object.freeze([]),
        });
    }
}
async function openContext(root, facade, options) {
    const { snapshot, detached } = await readSnapshot(root, options.signal);
    const ledgerRoot = await openLedgerRoot(root, snapshot);
    try {
        const observation = await observeWorkspace(root, snapshot, ledgerRoot, {
            hosts: facade.hosts,
            currentHostId: facade.hostId,
            scope: "full",
            ...signalOptions(options.signal),
            ...(options.clock === undefined ? {} : { clock: options.clock }),
        });
        const projection = await observeProjectionTargets(root, observation, options.signal);
        const maintenance = await observeMaintenance(root, options.signal);
        return Object.freeze({
            root,
            snapshot,
            detached,
            ledgerRoot,
            facade,
            options,
            observation,
            projection,
            maintenance,
        });
    }
    catch (error) {
        await ledgerRoot.close();
        throw error;
    }
}
/** 非 idle 的维护协议压过其他一切（旧实现的 maintenance 状态）：先维护，再谈别的；读不出不算。 */
function maintenancePending(maintenance) {
    return maintenance.status === "observed" && maintenance.protocol !== "idle";
}
function overallOf(context) {
    if (context.detached)
        return "detached";
    return maintenancePending(context.maintenance)
        ? "maintenance"
        : deriveOverallStatus(context.observation);
}
async function closeContext(context) {
    await context.ledgerRoot.close();
}
/** 观察里出现过的每个私有值都进脱敏边界：句柄、hook 会话、worktree 路径、放置根。 */
function privateValues(context) {
    const values = new Set([context.snapshot.ledgerRoot]);
    for (const entry of context.snapshot.placements.roots) {
        values.add(entry.absolutePath);
        if (entry.realPath !== null)
            values.add(entry.realPath);
    }
    for (const host of context.observation.bindings) {
        for (const binding of host.bindings)
            values.add(binding.handle.value);
    }
    for (const host of context.observation.hooks) {
        for (const sessionId of host.latestBySession.keys())
            values.add(sessionId);
    }
    for (const pod of context.observation.pods.value ?? []) {
        for (const entry of pod.receipts)
            values.add(entry.receipt.path);
    }
    return values;
}
// ---- status ----------------------------------------------------------------------
function boardView(observation) {
    const board = observation.board.value;
    const pending = (board?.states ?? [])
        .filter((state) => state.status === "pending")
        .sort((left, right) => {
        const priority = (PRIORITY_ORDER[left.priority] ?? 9) - (PRIORITY_ORDER[right.priority] ?? 9);
        return priority !== 0 ? priority : left.publishedAt.localeCompare(right.publishedAt);
    })
        .slice(0, PENDING_PACKAGES_MAXIMUM)
        .map((state) => ({
        requirementId: state.requirementId,
        title: state.title,
        priority: state.priority,
    }));
    return {
        status: observation.board.status,
        issue: observation.board.issue,
        counts: board?.counts ?? { pending: 0, parked: 0, claimed: 0, withdrawn: 0, archived: 0 },
        pending,
        skipped: board?.skipped ?? 0,
    };
}
function demandView(demand) {
    const next = demand.route === null ? null : deriveNextProjection(demand.route);
    return {
        demandId: demand.demandId,
        status: demand.status,
        issue: demand.issue,
        title: demand.loaded?.identity.title ?? null,
        demandType: demand.loaded?.identity.demandType ?? null,
        podId: demand.loaded?.identity.podId ?? null,
        lifecycle: demand.loaded?.aggregate.state.lifecycle ?? null,
        disposition: demand.route?.disposition ?? null,
        frontier: next?.frontier ?? null,
        owner: next?.owner ?? null,
        suggestedTool: next?.suggestedTool ?? null,
        blockerCount: demand.route?.blockers.length ?? 0,
        streamRevision: demand.loaded?.aggregate.streamRevision ?? null,
    };
}
/** 窗口当前的绑定（任一宿主）；未登记为 null。 */
function windowBindingOf(observation, windowId) {
    for (const host of observation.bindings) {
        const binding = host.bindings.find((entry) => entry.windowId === windowId);
        if (binding !== undefined) {
            return {
                hostId: host.hostId,
                bindingId: binding.bindingId,
                handleValue: binding.handle.value,
                launchIntentDigest: binding.source.launchIntentDigest,
            };
        }
    }
    return null;
}
/**
 * 绑定窗口的运行身份：判定方式来自绑定所在宿主的画像（`surfaces.runtimeStaleness`）；版本对照本进程
 * 的制品版本（可跨宿主），摘要只对照绑定宿主条目自己读出的磁盘制品——对端宿主没有条目身份，摘要不比
 * （R-ROOT-04）。规则本身在 decide.ts 的 `deriveWindowRuntime`。
 */
function windowRuntimeOf(context, binding, bindingsObserved, runtime) {
    const host = binding === null
        ? undefined
        : context.facade.hosts.find((entry) => entry.hostId === binding.hostId);
    const latest = binding === null
        ? undefined
        : context.observation.hooks
            .find((entry) => entry.hostId === binding.hostId)
            ?.latestBySession.get(binding.handleValue);
    return deriveWindowRuntime({
        bound: binding !== null,
        bindingsObserved,
        staleness: host?.resourceProfile.surfaces.runtimeStaleness ?? "unverified",
        serverVersion: runtime.version,
        installedManifestDigest: binding === null ? null : (runtime.installedByHost.get(binding.hostId) ?? null),
        sessionStartObserverManifestDigest: latest?.sessionStartObserverManifestDigest ?? null,
        sessionStartArtifactVersion: latest?.sessionStartArtifactVersion ?? null,
    });
}
/** 处于某一运行身份的绑定窗口（按拓扑顺序）；磁盘上的制品摘要每次调用只读一次。 */
function runtimeWindowIds(context, status) {
    const bindingsObserved = context.observation.bindings.every((host) => host.status === "observed");
    const runtime = readRuntime(context);
    return context.snapshot.model.topology.windows
        .filter((window) => {
        const binding = windowBindingOf(context.observation, window.windowId);
        return (binding !== null &&
            windowRuntimeOf(context, binding, bindingsObserved, runtime).status === status);
    })
        .map((window) => window.windowId);
}
/**
 * 本进程的制品状态（§13.127；版本轴 §3.6 C6）：启动时与现在磁盘上的 manifest 摘要不同即 `changed`；
 * 任一宿主的会话曾在更高版本下启动即 `superseded`（规则在 decide.ts 的 `deriveServerRuntime`）。一次
 * 调用只读一次磁盘：`view` 是 wire 上的 runtime 字段，其余供门与窗口比较使用——`installedByHost` 是
 * 每个带身份的宿主条目读出的磁盘摘要，只有本进程所属的宿主带身份（R-ROOT-04）。
 */
function readRuntime(context) {
    const artifact = context.facade.artifact;
    const manifestDigest = artifact?.manifestDigest ?? null;
    const version = artifact?.version ?? null;
    const onDiskDigest = artifact?.readCurrentManifestDigest() ?? null;
    const installedByHost = new Map(context.facade.hosts.map((host) => [host.hostId, host.artifact?.readCurrentManifestDigest() ?? null]));
    const newestSessionStartVersion = newestWakeflowArtifactVersion(context.observation.hooks.flatMap((host) => [...host.latestBySession.values()].map((latest) => latest.sessionStartArtifactVersion)));
    const server = deriveServerRuntime({
        version,
        manifestDigest,
        onDiskDigest,
        newestSessionStartVersion,
    });
    return {
        version,
        onDiskDigest,
        newestSessionStartVersion,
        supersededBy: server.supersededBy,
        installedByHost,
        view: {
            artifactManifestDigest: manifestDigest,
            artifactVersion: version,
            artifactOnDisk: server.artifactOnDisk,
        },
    };
}
/** 绑定会话最近一条 hook 记录；没有绑定或没有记录为 null。 */
function lastObservationOf(observation, binding) {
    if (binding === null)
        return null;
    const latest = observation.hooks
        .find((entry) => entry.hostId === binding.hostId)
        ?.latestBySession.get(binding.handleValue);
    return latest === undefined
        ? null
        : {
            event: latest.event,
            recordedAt: latest.recordedAt,
            observerManifestDigest: latest.observerManifestDigest,
        };
}
/**
 * 窗口是否在等用户（open-items A7，§13.167；I14）：绑定会话最近一条 hook 记录是 Claude Code 的 Notification
 * （等待权限、登录或用量提示）时为 needed 并带类型；`idle_prompt` 只是空闲一分钟的通知、没有在等任何人，
 * 算 none（与 ADR-0023 把它映射成 idle 标记一致）；之后任何一条记录都把它清成 none。
 * 没有绑定或没有记录为 null。它只说宿主在等人，不说窗口的 MCP 或指令状态。
 */
/** Claude Code 空闲提示的通知类型：窗口没有在等人（I14）。 */
const IDLE_PROMPT_NOTIFICATION = "idle_prompt";
function attentionOf(observation, binding) {
    if (binding === null)
        return null;
    const latest = observation.hooks
        .find((entry) => entry.hostId === binding.hostId)
        ?.latestBySession.get(binding.handleValue);
    if (latest === undefined)
        return null;
    return latest.event === "notification" && latest.notificationType !== IDLE_PROMPT_NOTIFICATION
        ? {
            status: "needed",
            notificationType: latest.notificationType,
            recordedAt: latest.recordedAt,
        }
        : { status: "none", notificationType: null, recordedAt: null };
}
function claimViewOf(observation, windowId) {
    const claim = (observation.claims.value?.claims ?? []).find((entry) => entry.windowId === windowId);
    return claim === undefined
        ? { status: "free", demandId: null, deliveryId: null, generation: null }
        : {
            status: "held",
            demandId: claim.holder.demandId,
            deliveryId: claim.holder.deliveryId,
            generation: claim.holder.generation,
        };
}
/**
 * 一个窗口的运行投影新鲜度（G6，§13.111）：每个宿主各有一份，取最差的一份；任一宿主的投影组
 * 读不出即 unavailable（空列表不是"都新鲜"）。
 */
function windowProjectionOf(observation, windowId) {
    if (observation.projections.some((host) => host.status !== "observed"))
        return "unavailable";
    const statuses = observation.projections.flatMap((host) => host.windows.filter((window) => window.windowId === windowId));
    return statuses.length === 0 ? "unavailable" : projectionFreshness(statuses);
}
/** reconcile 能修的投影缺陷：缺失或过期；unsafe 只由 verify 报出。 */
function projectionsNeedRepair(observation) {
    return observation.projections.some((host) => host.windows.some((window) => window.status === "stale" || window.status === "missing"));
}
function windowRuntimeDomainView(observation) {
    const unavailable = observation.projections.find((host) => host.status !== "observed");
    return unavailable === undefined
        ? { status: "observed", issue: null }
        : {
            status: "unavailable",
            issue: `${unavailable.hostId}:${unavailable.issue ?? "unavailable"}`,
        };
}
function windowViews(context) {
    const { observation, snapshot } = context;
    const bindingsObserved = observation.bindings.every((host) => host.status === "observed");
    const runtime = readRuntime(context);
    const intents = new Map();
    return snapshot.model.topology.windows.map((window) => {
        const binding = windowBindingOf(observation, window.windowId);
        return {
            windowId: window.windowId,
            podId: window.podId,
            role: window.role,
            identity: binding !== null ? "registered" : bindingsObserved ? "unregistered" : "unobserved",
            hostId: binding?.hostId ?? null,
            bindingId: binding?.bindingId ?? null,
            claim: claimViewOf(observation, window.windowId),
            lastObservation: lastObservationOf(observation, binding),
            attention: attentionOf(observation, binding),
            projection: windowProjectionOf(observation, window.windowId),
            runtime: windowRuntimeOf(context, binding, bindingsObserved, runtime),
            launchIntent: launchIntentOf(context, binding, window.windowId, intents),
        };
    });
}
/**
 * 绑定登记时的启动意图摘要对照当前 Config 与宿主画像编译出的意图（C18）：不同即 `drifted`——窗口是在旧意图
 * 下启动或续接的，relocate 不改登记摘要，只有替换握手会刷新。每个宿主的意图集只编译一次；画像编不出
 * 意图（不该发生，Config 已经过权威校验）时给 null，不让 status 失败。
 */
function launchIntentOf(context, binding, windowId, intents) {
    if (binding === null)
        return null;
    if (!intents.has(binding.hostId)) {
        const profile = context.facade.hosts.find((host) => host.hostId === binding.hostId)?.resourceProfile;
        let compiled = null;
        if (profile !== undefined) {
            try {
                compiled = new Map(compileWakeflowWindowLaunchIntents(context.snapshot.model, profile).intents.map((intent) => [intent.windowId, intent.intentDigest]));
            }
            catch {
                compiled = null;
            }
        }
        intents.set(binding.hostId, compiled);
    }
    const current = intents.get(binding.hostId)?.get(windowId) ?? null;
    if (current === null)
        return null;
    return Object.freeze({
        status: current === binding.launchIntentDigest ? "current" : "drifted",
        registeredDigest: binding.launchIntentDigest,
        currentDigest: current,
    });
}
function claimViews(observation) {
    const orphans = new Set(orphanWorkClaims(observation).map((claim) => claim.claimId));
    const all = [...(observation.claims.value?.claims ?? [])]
        .sort((left, right) => left.claimId.localeCompare(right.claimId))
        .map((claim) => ({
        windowId: claim.windowId,
        claimId: claim.claimId,
        demandId: claim.holder.demandId,
        targetTaskId: claim.holder.targetTaskId,
        deliveryId: claim.holder.deliveryId,
        generation: claim.holder.generation,
        claimedAt: claim.claimedAt,
        orphan: orphans.has(claim.claimId),
    }));
    return capStatusList(all, STATUS_LIST_MAXIMUMS.claims);
}
function unmergedAcceptedViews(observation) {
    const all = [...unmergedAcceptedFacts(observation)].sort((left, right) => {
        const demand = left.demandId.localeCompare(right.demandId);
        if (demand !== 0)
            return demand;
        const target = left.targetTaskId.localeCompare(right.targetTaskId);
        return target !== 0 ? target : left.repositoryId.localeCompare(right.repositoryId);
    });
    return capStatusList(all, STATUS_LIST_MAXIMUMS.unmergedAccepted);
}
/** 当前宿主 Profile 的 worktree 启动方式；组合根缺当前宿主时为 null（不给处置引导）。 */
function currentWorktreeLaunch(facade) {
    const current = facade.hosts.find((host) => host.hostId === facade.hostId);
    return current?.resourceProfile.surfaces.worktree.launch ?? null;
}
function podViews(context) {
    const { observation, root, facade } = context;
    const worktreeLaunch = currentWorktreeLaunch(facade);
    return (observation.pods.value ?? []).map((pod) => ({
        podId: pod.pod.podId,
        name: pod.pod.name,
        placement: pod.pod.placement,
        lifecycle: pod.pod.lifecycle,
        state: pod.state ?? "unobserved",
        activeDemandId: pod.activeDemandId,
        windows: { total: pod.windowIds.length, bound: pod.boundWindowIds.length },
        worktrees: pod.pod.worktrees.map((worktree) => {
            const receipt = pod.receipts.find((entry) => entry.receipt.repositoryId === worktree.repositoryId);
            const present = receipt?.checkout === "present";
            return {
                repositoryId: worktree.repositoryId,
                receipt: receiptStateView(receipt?.checkout),
                disposal: pod.pod.lifecycle === "closing" &&
                    present &&
                    receipt !== undefined &&
                    worktreeLaunch !== null
                    ? disposalGuidance(worktreeLaunch, path.relative(root.absolutePath, receipt.receipt.path) || ".", receipt.receipt.locked)
                    : null,
            };
        }),
    }));
}
function repositoryViews(observation) {
    let omitted = 0;
    const all = (observation.repositories.value ?? []).map((repository) => {
        const worktrees = capStatusList(
        // 码元比较：截断到上限时哪些条目留下不随 ICU 区域变化。
        [...repository.worktrees].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0), STATUS_LIST_MAXIMUMS.worktrees);
        omitted += worktrees.omitted;
        return {
            repositoryId: repository.repositoryId,
            status: repository.status,
            issue: repository.issue,
            head: repository.head,
            branch: repository.branch,
            detached: repository.detached,
            branches: repository.branches.length,
            worktrees: worktrees.entries.map((worktree) => ({
                name: worktree.name,
                branch: worktree.branch,
                prunable: worktree.prunable,
            })),
        };
    });
    // 仓库本身也有 wire 上限；两个略去计数分开报，读者才知道少的是仓库还是某个仓库的 worktree。
    const capped = capStatusList([...all].sort((left, right) => left.repositoryId.localeCompare(right.repositoryId)), STATUS_LIST_MAXIMUMS.repositories);
    return Object.freeze({
        entries: capped.entries,
        omitted: Object.freeze({ repositories: capped.omitted, worktrees: omitted }),
    });
}
/** 回执的公开视图（G7）：unknown 以 checkout-unknown 报出，不冒充缺席。 */
function receiptStateView(checkout) {
    if (checkout === undefined)
        return "absent";
    if (checkout === "present")
        return "present";
    return checkout === "absent" ? "checkout-missing" : "checkout-unknown";
}
function hookViews(observation) {
    return observation.hooks.map((host) => ({
        hostId: host.hostId,
        status: host.status,
        issue: host.issue,
        directory: host.directory,
        records: host.records,
        skipped: host.skipped,
    }));
}
function projectionView(projection) {
    const targets = projection.value;
    return {
        status: projectionFreshness(targets),
        targets: (targets ?? []).map((target) => ({
            resourcePath: target.resourcePath,
            status: target.status,
            reason: target.reason,
        })),
    };
}
function nextActionInput(context, runtime) {
    const { observation, snapshot } = context;
    const overall = overallOf(context);
    const bound = new Set(observation.bindings.flatMap((host) => host.bindings.map((binding) => binding.windowId)));
    const bindingsObserved = observation.bindings.every((host) => host.status === "observed");
    const pods = observation.pods.value ?? [];
    const demands = (observation.demands.value ?? []).flatMap((demand) => {
        if (demand.route === null || demand.loaded === null)
            return [];
        const next = deriveNextProjection(demand.route);
        const placement = snapshot.indexes.podById[demand.loaded.identity.podId]?.placement ?? "worktree";
        return [
            {
                demandId: demand.demandId,
                placement,
                disposition: demand.route.disposition,
                frontier: next.frontier,
                owner: next.owner,
                suggestedTool: next.suggestedTool,
            },
        ];
    });
    // pod 域读不出时 pods 是空列表，不是"没有 pod"：登记动作只在真的观察到 pod 时才排得出来。
    const podsObserved = observation.pods.status === "observed";
    return Object.freeze({
        artifactServerOutdated: runtime.view.artifactOnDisk === "changed" || runtime.view.artifactOnDisk === "superseded",
        artifactServerSupersededBy: runtime.supersededBy,
        artifactServerRefreshOwner: artifactServerRefreshOwnerOf(context),
        staleWindows: runtimeWindowIds(context, "stale").length,
        artifactServerUnavailable: context.facade.artifact !== undefined &&
            (runtime.view.artifactManifestDigest === null || runtime.view.artifactOnDisk === "unknown"),
        // 缺失或过期的窗口运行投影由 reconcile 重建（G5），所以也把下一步指向维护（G6）。
        maintenance: overall === "maintenance" || projectionsNeedRepair(observation),
        unregisteredWindows: bindingsObserved && podsObserved
            ? snapshot.model.topology.windows
                .filter((window) => !bound.has(window.windowId))
                .map((window) => {
                const pod = pods.find((entry) => entry.pod.podId === window.podId);
                return {
                    windowId: window.windowId,
                    podId: window.podId,
                    placement: pod?.pod.placement ?? "worktree",
                    podActive: pod !== undefined &&
                        (pod.pod.placement === "primary" || pod.activeDemandId !== null),
                };
            })
            : [],
        demands,
        pendingPackages: (observation.board.value?.states ?? [])
            .filter((state) => state.status === "pending")
            .map((state) => ({ requirementId: state.requirementId })),
    });
}
async function routeSection(context, demandId) {
    if (demandId === undefined)
        return Object.freeze({ route: null, archive: null, next: null });
    // demands 域读不出时"不在活动集合里"不是事实：别让一个还活着的 Demand 显示成 not-found。
    const domain = context.observation.demands;
    if (domain.status !== "observed") {
        fail("precondition-failed", "demands-unavailable", "$request.demandId");
    }
    const active = (domain.value ?? []).find((demand) => demand.demandId === demandId);
    if (active !== undefined) {
        if (active.route === null) {
            fail("precondition-failed", `demand-${active.issue ?? "unavailable"}`, "$request.demandId");
        }
        return Object.freeze({
            route: active.route,
            archive: null,
            next: deriveNextProjection(active.route),
        });
    }
    const archive = await locateLatestDemandArchive(context.ledgerRoot, demandId, context.options.signal);
    if (archive === null)
        fail("not-found", "demand-unknown", "$request.demandId");
    // 裁决 R8（复审 G7/G1）：归档回执带业务读回——标题、目标、测试模式、证据数、verify 计数、已接受目标的落点。
    const readback = await describeDemandArchive(context.ledgerRoot, archive, context.options.signal);
    // W34：归档的 next 读需求包的认领类型。完成、需求包仍以本 Demand 归档且不是 research 才指向 continue，
    // 与 demand 切片 `deriveContinueBlockers` 的包级规则一致（切片不互引，这里从同一轮观察的看板取认领状态；
    // 看板读不出即认领未知，和 continue 预览的 package-unknown 一样不给前沿）。pod 占用与关闭留给 continue 预览。
    const claim = (context.observation.board.value?.states ?? []).find((state) => state.archive?.demandId === demandId) ?? null;
    const continuable = archive.outcome === "completed" && claim !== null && claim.demandType !== "research";
    return Object.freeze({
        route: null,
        archive: {
            demandId: archive.demandId,
            outcome: archive.outcome,
            archiveRef: archive.archiveRef,
            archivedAt: archive.archivedAt,
            terminalEvent: archive.terminalEvent,
            manifestDigest: archive.manifestDigest,
            title: readback.title,
            goal: readback.goal,
            testingMode: readback.testingMode,
            evidenceCount: readback.evidenceCount,
            verify: archive.verify,
            acceptedTargets: readback.acceptedTargets,
        },
        next: continuable
            ? Object.freeze({
                frontier: "demand-continuation",
                owner: "controller",
                suggestedTool: "wakeflow_continue_demand",
                blockers: Object.freeze([]),
            })
            : Object.freeze({
                frontier: null,
                owner: "none",
                suggestedTool: null,
                blockers: Object.freeze([]),
            }),
    });
}
/** 每个域的观察状态都要看得见（§13.94 D1）：空列表与"读不出"必须能分辨，而不是只有 overall 暗示。 */
function domainViews(context) {
    const { observation, projection } = context;
    return {
        demands: { status: observation.demands.status, issue: observation.demands.issue },
        claims: { status: observation.claims.status, issue: observation.claims.issue },
        pods: { status: observation.pods.status, issue: observation.pods.issue },
        projection: { status: projection.status, issue: projection.issue },
        windowRuntime: windowRuntimeDomainView(observation),
        archives: archivesDomainView(observation),
    };
}
/**
 * 归档域（§13.130）：读不出沿用观察的 issue；读得出但有归档读不出时仍是 observed，issue 报出
 * 读不出的条数——那几个归档里的已接受分支这一轮看不见，不等于没有。
 */
function archivesDomainView(observation) {
    const archives = observation.archives;
    const unreadable = archives.value?.unreadable ?? 0;
    return {
        status: archives.status,
        issue: archives.issue ?? (unreadable > 0 ? `archives:unreadable-${unreadable}` : null),
    };
}
const LEGACY_RESIDUE_MAXIMUM_ITEMS = 64;
/**
 * 遗留残留（ADR-0020，F4，§13.168）：旧插件留下的内容，用户所有的发现，只报告——给出根、文件与行号，
 * Controller 转告用户自己删；status 不替任何根写东西。读不出的计数单独报出，不是"没有"。
 */
function legacyResidueView(observation) {
    const scan = observation.legacyResidue;
    const items = capStatusList(scan.value?.items ?? [], LEGACY_RESIDUE_MAXIMUM_ITEMS);
    return {
        status: scan.status,
        issue: scan.issue,
        items: items.entries.map((item) => ({
            root: item.root,
            kind: item.kind,
            path: item.path,
            line: item.line,
            detail: item.detail,
        })),
        itemsOmitted: items.omitted + (scan.value?.omitted ?? 0),
        unreadable: scan.value?.unreadable ?? 0,
    };
}
async function assembleStatus(context, request) {
    const { observation, snapshot } = context;
    const runtime = readRuntime(context);
    // 终态没有下一步动作：工作区已停用，next 无 owner（ADR-0024）。
    const actions = context.detached ? [] : deriveNextActions(nextActionInput(context, runtime));
    const section = await routeSection(context, request.demandId);
    const claims = claimViews(observation);
    const repositories = repositoryViews(observation);
    const unmergedAccepted = unmergedAcceptedViews(observation);
    // 每个数组都有 wire 上限：越界的结果会被整份拒绝，所以先确定性排序再截断并报出略去的条数。
    const demands = capStatusList([...(observation.demands.value ?? [])]
        .sort((left, right) => left.demandId.localeCompare(right.demandId))
        .map(demandView), STATUS_LIST_MAXIMUMS.demands);
    const windows = capStatusList(windowViews(context), STATUS_LIST_MAXIMUMS.windows);
    const pods = capStatusList(podViews(context), STATUS_LIST_MAXIMUMS.pods);
    return admitStatusResult({
        kind: "WakeflowStatus",
        schemaVersion: WAKEFLOW_OBSERVATION_PUBLIC_SCHEMA_VERSION,
        tool: WAKEFLOW_STATUS_PUBLIC_TOOL_NAME,
        observedAt: observation.observedAt,
        overall: overallOf(context),
        config: {
            schemaVersion: snapshot.model.schemaVersion,
            programId: snapshot.model.program.programId,
            displayName: snapshot.model.program.displayName,
            language: snapshot.model.presentation.language,
            configDigest: snapshot.configDigest,
            pods: snapshot.model.pods.length,
            windows: snapshot.model.topology.windows.length,
            repositories: snapshot.model.topology.repositories.length,
        },
        board: boardView(observation),
        demands: demands.entries,
        windows: windows.entries,
        claims: claims.entries,
        pods: pods.entries,
        repositories: repositories.entries,
        hooks: hookViews(observation),
        unmergedAccepted: unmergedAccepted.entries,
        domains: domainViews(context),
        runtime: runtime.view,
        maintenance: maintenanceView(context.maintenance),
        hostAssets: observation.assets.map((asset) => ({
            hostId: asset.hostId,
            status: asset.status,
            settings: asset.settings,
            companion: asset.companion,
        })),
        legacyResidue: legacyResidueView(observation),
        truncated: {
            demands: demands.omitted,
            windows: windows.omitted,
            claims: claims.omitted,
            pods: pods.omitted,
            repositories: repositories.omitted.repositories,
            worktrees: repositories.omitted.worktrees,
            unmergedAccepted: unmergedAccepted.omitted,
            archives: observation.archives.value?.skipped ?? 0,
        },
        projection: projectionView(context.projection),
        policy: observation.policy,
        route: section.route,
        archive: section.archive,
        next: section.next ?? (context.detached ? DETACHED_WORKSPACE_NEXT : nextFromActions(actions)),
        nextActions: actions,
    });
}
/** 执行一次 `wakeflow_status`。 */
export async function executeStatusRequest(facade, value, options = {}) {
    return runCommandShell({
        scope: () => "read",
        tool: WAKEFLOW_STATUS_PUBLIC_TOOL_NAME,
        parseRequest: (raw) => {
            const request = parseStatusRequest(raw);
            return { envelope: request, input: request };
        },
        open: (root) => openContext(root, facade, options),
        close: closeContext,
        privateValues,
    }, value, () => undefined, (context, binding) => assembleStatus(context, binding.input), commandShellExecutionOptions(options.durability, options.signal));
}
// ---- verify ----------------------------------------------------------------------
async function configRecheck(context) {
    try {
        const current = await readWakeflowConfigAuthoritySnapshot(context.root, signalOptions(context.options.signal));
        return current.configDigest === context.snapshot.configDigest ? "current" : "changed";
    }
    catch (error) {
        failIfAborted(error);
        return "unavailable";
    }
}
/**
 * 私有树的模式普查（§13.124 D8，§13.130）：安全漂移或不安全节点让 local-layout 门带数量与区域
 * （前三段路径，至多三个）点名，例如 `private-mode-drift-12:.wakeflow-local/runtime`；安全漂移由
 * reconcile 收回，不安全节点只报告。普查读不出不遮蔽布局预览。
 */
async function privateModeCodes(context) {
    try {
        const census = await inspectWakeflowPrivateModes(context.root, signalOptions(context.options.signal));
        const named = (prefix, paths) => `${prefix}-${paths.length}:${wakeflowPrivateModeAreas(paths)
            .map((area) => area.replace(/[^A-Za-z0-9./-]/gu, "-"))
            .join(",")}`;
        if (census.status === "unsafe")
            return Object.freeze([named("private-mode-unsafe", census.unsafe)]);
        if (census.status === "safe-drift") {
            return Object.freeze([
                named("private-mode-drift", census.drifted.map((entry) => entry.resourcePath)),
            ]);
        }
        return Object.freeze([]);
    }
    catch (error) {
        failIfAborted(error);
        return Object.freeze([]);
    }
}
/**
 * local-layout 门的事实（§13.94 D3）：静态资源矩阵经宿主中立的零写对账预览核对——当前配置、
 * 当前宿主 profile 与全部宿主 profile；ready 且没有计划步骤才是 ready，否则 blocked 并带阻塞码
 * 与步骤种类；预览本身抛错即 unavailable。
 */
async function localLayout(context) {
    const modes = await privateModeCodes(context);
    if (modes.length > 0)
        return Object.freeze({ status: "blocked", codes: modes });
    const current = context.facade.hosts.find((host) => host.hostId === context.facade.hostId);
    if (current === undefined) {
        return Object.freeze({
            status: "unavailable",
            codes: Object.freeze(["current-host-profile"]),
        });
    }
    try {
        const preview = await previewWakeflowStaticMaterialization(context.root, {
            action: "reconcile",
            desiredConfig: null,
            currentHostProfile: current.resourceProfile,
            hostProfiles: Object.freeze(context.facade.hosts.map((host) => host.resourceProfile)),
            ...signalOptions(context.options.signal),
        });
        const ready = preview.status === "ready" && preview.steps.length === 0;
        return Object.freeze({
            status: ready ? "ready" : "blocked",
            codes: Object.freeze([
                ...preview.blockerCodes,
                ...preview.steps.map((step) => `step:${step.kind}`),
            ]),
        });
    }
    catch (error) {
        failIfAborted(error);
        return Object.freeze({ status: "unavailable", codes: Object.freeze([]) });
    }
}
async function ledgerLayout(context) {
    try {
        return (await inspectLedgerAuthorityLayout(context.ledgerRoot, context.options.signal)).status;
    }
    catch (error) {
        failIfAborted(error);
        return "unavailable";
    }
}
/** primary pod 的主检出：`.git` 缺失或是 worktree 指针即 false；其他读不出为 null（未观察）。 */
function primaryCheckoutsOf(repositories) {
    if (repositories === null)
        return null;
    let unobserved = false;
    for (const repository of repositories) {
        if (repository.status === "observed")
            continue;
        if (repository.issue === "git-directory-missing" || repository.issue === "root-is-worktree") {
            return false;
        }
        unobserved = true;
    }
    return unobserved ? null : true;
}
/** 非活动 Demand 的生命周期日志；目录缺失为空，读不出为 null（门报 unavailable）。 */
async function strayJournals(context, activeDemandIds) {
    try {
        const listing = await readStableResourceDirectory(context.root, DEMAND_LIFECYCLE_JOURNALS_ROOT_REF, {
            maximumEntries: DIRECTORY_MAXIMUM_ENTRIES,
            ...signalOptions(context.options.signal),
        });
        return listing.entries
            .map((entry) => JOURNAL_FILE_PATTERN.exec(entry.name)?.[1])
            .filter((demandId) => demandId !== undefined && !activeDemandIds.has(demandId))
            .sort();
    }
    catch (error) {
        if (error instanceof StableDirectoryReadError && error.reason === "not-found")
            return [];
        failIfAborted(error);
        return null;
    }
}
const UNREADABLE_WRITER = Object.freeze({
    status: "unavailable",
    newestVersion: null,
});
const UNREADABLE_DEMAND_READING = Object.freeze({
    report: null,
    writer: UNREADABLE_WRITER,
});
async function readDemandForVerify(context, demand) {
    if (demand.loaded === null)
        return UNREADABLE_DEMAND_READING;
    let demandRoot = null;
    let writer = UNREADABLE_WRITER;
    try {
        demandRoot = await openDemandOperationRoot(context.root, demand.demandId);
        // 写者戳先于门报告：只读提交、不回放，根一打开就能读；之后门报告失败也不改变它。
        const writers = await new DemandEventSourcingRepository(demandRoot).readWriters(signalOptions(context.options.signal));
        writer = Object.freeze({
            status: "observed",
            newestVersion: newestWakeflowArtifactVersion(writers.map((entry) => entry?.version ?? null)),
        });
        const loaded = await loadDemandEventSourcingRootAuthority(demandRoot, new LedgerAuthorityStore(context.ledgerRoot), signalOptions(context.options.signal));
        const claim = await readRequirementClaimState(context.root, loaded.identity.source.requirementId, context.options.signal);
        const report = await evaluateVerifyGates({
            workspaceRoot: context.root,
            ledgerRoot: context.ledgerRoot,
            snapshot: context.snapshot,
            demandRoot,
            loaded,
            claim,
            windowIds: demandWindowIds(loaded.aggregate.state),
            payloadBlockers: null,
            signal: context.options.signal,
        });
        return Object.freeze({ report, writer });
    }
    catch (error) {
        failIfAborted(error);
        return Object.freeze({ report: null, writer });
    }
    finally {
        if (demandRoot !== null)
            await closeDemandOperationRoot(demandRoot);
    }
}
/**
 * 维护日志（事务残留）里写者戳版本的最高值（C11）：维护协议读不出、或某份日志读不出即 unavailable；
 * 没有日志或日志没有戳为 null。只读 `journal` 类残留，按 operationId 走日志仓库的读法，零写。
 */
async function maintenanceWriterFacts(context) {
    if (context.maintenance.status !== "observed")
        return UNREADABLE_WRITER;
    const versions = [];
    for (const residue of context.maintenance.residues) {
        if (residue.kind !== "journal" || residue.operationId === null)
            continue;
        try {
            const source = await readWakeflowMaintenanceJournalOrNull(context.root, residue.operationId);
            versions.push(source?.journal.writer?.version ?? null);
        }
        catch (error) {
            if (!(error instanceof WakeflowMaintenanceJournalStoreError))
                throw error;
            return UNREADABLE_WRITER;
        }
    }
    return Object.freeze({
        status: "observed",
        newestVersion: newestWakeflowArtifactVersion(versions),
    });
}
function gateStatus(report, name) {
    const found = report?.gates.find((entry) => entry.gate === name);
    return found?.status ?? "unavailable";
}
async function gateFacts(context, readings) {
    const { observation, snapshot } = context;
    const demands = observation.demands.value ?? [];
    const activeIds = new Set(demands.map((demand) => demand.demandId));
    const board = observation.board.value;
    const orphans = new Set(orphanWorkClaims(observation).map((claim) => claim.claimId));
    const bindingsObserved = observation.bindings.every((host) => host.status === "observed");
    const bound = new Set(observation.bindings.flatMap((host) => host.bindings.map((b) => b.windowId)));
    const repositories = observation.repositories.value;
    const demandsObserved = observation.demands.status === "observed";
    const runtime = readRuntime(context);
    return Object.freeze({
        runtime: {
            server: context.facade.artifact === undefined
                ? null
                : {
                    version: runtime.version,
                    manifestDigest: runtime.view.artifactManifestDigest,
                    onDiskDigest: runtime.onDiskDigest,
                    newestSessionStartVersion: runtime.newestSessionStartVersion,
                },
            staleWindows: runtimeWindowIds(context, "stale"),
            unverifiedWindows: runtimeWindowIds(context, "unverified"),
        },
        domains: {
            demands: { status: observation.demands.status, issue: observation.demands.issue },
            claims: { status: observation.claims.status, issue: observation.claims.issue },
            pods: { status: observation.pods.status, issue: observation.pods.issue },
        },
        configRecheck: await configRecheck(context),
        configRef: WAKEFLOW_CONFIG_FILE_REF,
        configDigest: snapshot.configDigest,
        layout: observation.layout.value?.status ?? "unavailable",
        local: await localLayout(context),
        ledger: await ledgerLayout(context),
        board: {
            status: observation.board.status,
            skipped: board?.skipped ?? 0,
            indexCurrent: board === null ? null : board.indexDigest === board.expectedIndexDigest,
            // 活动 Demand 集合读不出时这道对账无从做起；门自己会因 demands 域不可用而 unavailable。
            claimedWithoutRoot: demandsObserved
                ? (board?.states ?? [])
                    .filter((state) => state.status === "claimed" &&
                    state.claim !== null &&
                    !activeIds.has(state.claim.demandId))
                    .map((state) => state.claim.demandId)
                : [],
        },
        demands: demands.map((demand) => {
            const reading = readings.get(demand.demandId) ?? UNREADABLE_DEMAND_READING;
            return {
                demandId: demand.demandId,
                status: demand.status,
                audit: gateStatus(reading.report, "demand-root-audit"),
                evidence: gateStatus(reading.report, "evidence-integrity"),
                appendCandidates: demand.loaded?.inventory.appendCandidateCount ?? 0,
                writer: reading.writer,
            };
        }),
        strayJournals: await strayJournals(context, activeIds),
        maintenanceWriter: await maintenanceWriterFacts(context),
        claims: (observation.claims.value?.claims ?? []).map((claim) => ({
            windowId: claim.windowId,
            orphan: orphans.has(claim.claimId),
        })),
        claimsUnreadable: observation.claims.value?.unreadable ?? 0,
        hooks: observation.hooks.map((host) => ({
            hostId: host.hostId,
            current: host.current,
            status: host.status,
            directory: host.directory,
            records: host.records,
            skipped: host.skipped,
            writeFailures: host.writeFailures,
        })),
        windows: snapshot.model.topology.windows.map((window) => ({
            windowId: window.windowId,
            identity: bound.has(window.windowId)
                ? "registered"
                : bindingsObserved
                    ? "unregistered"
                    : "unobserved",
        })),
        windowRuntime: observation.projections.map((host) => ({
            hostId: host.hostId,
            status: host.status,
            issue: host.issue,
            windows: host.windows.map((window) => ({
                windowId: window.windowId,
                status: window.status,
            })),
        })),
        pods: (observation.pods.value ?? []).map((pod) => ({
            podId: pod.pod.podId,
            placement: pod.pod.placement,
            lifecycle: pod.pod.lifecycle,
            state: pod.state ?? "unobserved",
            worktrees: pod.pod.worktrees.map((worktree) => {
                const receipt = pod.receipts.find((entry) => entry.receipt.repositoryId === worktree.repositoryId);
                return {
                    repositoryId: worktree.repositoryId,
                    receipt: receiptStateView(receipt?.checkout),
                };
            }),
        })),
        primaryCheckouts: primaryCheckoutsOf(repositories),
        assets: observation.assets.map((asset) => ({
            hostId: asset.hostId,
            status: asset.status,
            settings: asset.settings,
            companion: asset.companion,
        })),
        legacyResidue: {
            status: observation.legacyResidue.status,
            items: observation.legacyResidue.value?.items.length ?? 0,
        },
        projection: {
            status: context.projection.status,
            targets: (context.projection.value ?? []).map((target) => ({
                resourcePath: target.resourcePath,
                status: target.status,
                reason: target.reason,
                digest: target.currentDigest,
            })),
        },
    });
}
/** 带 demandId 的 verify 附该 Demand 的门：活动即 current，归档即 archived，都不是即 unknown。 */
async function verifyDemandSection(context, demandId, readings) {
    // 活动集合本身读不出时不能替这个 Demand 下结论：它可能活着，只是这轮看不见（与 status 同一裁决）。
    if (!readings.has(demandId) && context.observation.demands.status !== "observed") {
        fail("precondition-failed", "demands-unavailable", "$request.demandId");
    }
    // 在活动集合里但读不出（报告为 null）仍然是 current：它不是归档，也不是未知，只是这轮没有门。
    if (readings.has(demandId)) {
        const report = readings.get(demandId)?.report ?? null;
        return {
            demandId,
            status: "current",
            gates: report?.gates ?? [],
            observationDigest: report?.observationDigest ?? null,
        };
    }
    const archive = await locateLatestDemandArchive(context.ledgerRoot, demandId, context.options.signal);
    return {
        demandId,
        status: archive === null ? "unknown" : "archived",
        gates: [],
        observationDigest: null,
    };
}
async function assembleVerify(context, request) {
    const demands = context.observation.demands.value ?? [];
    const readings = new Map();
    for (const demand of demands)
        readings.set(demand.demandId, await readDemandForVerify(context, demand));
    // 终态只报一门且通过（ADR-0024）：已停用的工作区不再评布局、投影与宿主资产。
    const gates = context.detached
        ? detachedWorkspaceGates(WAKEFLOW_DETACHED_CONFIG_FILE_REF, context.snapshot.configDigest)
        : deriveWorkspaceGates(await gateFacts(context, readings));
    const { ok, summary } = summarizeGates(gates);
    const demandSection = request.demandId === undefined
        ? null
        : await verifyDemandSection(context, request.demandId, readings);
    return admitVerifyResult({
        kind: "WakeflowVerification",
        schemaVersion: WAKEFLOW_OBSERVATION_PUBLIC_SCHEMA_VERSION,
        tool: WAKEFLOW_VERIFY_PUBLIC_TOOL_NAME,
        observedAt: context.observation.observedAt,
        configDigest: context.snapshot.configDigest,
        ok,
        summary,
        gates,
        demand: demandSection,
        repairsApplied: false,
        observationDigest: computeGatesDigest(gates),
        next: context.detached
            ? DETACHED_WORKSPACE_NEXT
            : verifyNext(gates, artifactServerRefreshOwnerOf(context)),
    });
}
/** 过期服务进程由谁换代：本进程所属宿主画像的 `surfaces.runtimeRefresh`（C17）；画像缺席时保守地交给用户。 */
function artifactServerRefreshOwnerOf(context) {
    const refresh = context.facade.hosts.find((host) => host.hostId === context.facade.hostId)
        ?.resourceProfile.surfaces.runtimeRefresh;
    return refresh === "controller-in-place" ? "controller" : "user";
}
function computeGatesDigest(gates) {
    return computeCanonicalJsonSha256Digest({
        kind: "WakeflowVerificationObservation",
        gates: gates.map((entry) => ({ name: entry.name, status: entry.status, code: entry.code })),
    });
}
/** 执行一次 `wakeflow_verify`。 */
export async function executeVerifyRequest(facade, value, options = {}) {
    return runCommandShell({
        scope: () => "read",
        tool: WAKEFLOW_VERIFY_PUBLIC_TOOL_NAME,
        parseRequest: (raw) => {
            const request = parseVerifyRequest(raw);
            return { envelope: request, input: request };
        },
        open: (root) => openContext(root, facade, options),
        close: closeContext,
        privateValues,
    }, value, () => undefined, (context, binding) => assembleVerify(context, binding.input), commandShellExecutionOptions(options.durability, options.signal));
}
