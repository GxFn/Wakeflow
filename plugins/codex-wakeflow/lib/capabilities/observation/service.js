import path from "node:path";
import { readWakeflowConfigAuthoritySnapshot, WAKEFLOW_CONFIG_FILE_REF, WakeflowConfigAuthoritySnapshotError, } from "../../configuration/wakeflow-config-authority-snapshot.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { readStableResourceDirectory, StableDirectoryReadError, } from "../../foundation/filesystem/stable-directory-read.js";
import { closeDemandOperationRoot, openDemandOperationRoot, } from "../../governance/demand/demand-operation-authority-context.js";
import { demandWindowIds, evaluateVerifyGates, } from "../../governance/demand/demand-verify-gates.js";
import { loadDemandEventSourcingRootAuthority } from "../../governance/demand/event-sourcing/demand-event-sourcing-root-authority.js";
import { inspectLedgerAuthorityLayout } from "../../governance/ledger/ledger-authority-layout.js";
import { LedgerAuthorityStore } from "../../governance/ledger/ledger-authority-store.js";
import { observeProjectionTargets, unmergedAcceptedFacts, } from "../../governance/observation/active-projection-facts.js";
import { locateLatestDemandArchive } from "../../governance/observation/demand-archive-locator.js";
import { deriveOverallStatus, observeWorkspace, orphanWorkClaims, } from "../../governance/observation/workspace-observation.js";
import { commandShellExecutionOptions, runCommandShell } from "../../kernel/command-shell.js";
import { fail } from "../../kernel/error.js";
import { DEMAND_LIFECYCLE_JOURNALS_ROOT_REF } from "../../kernel/layout.js";
import { deriveNextProjection } from "../../kernel/next-projection.js";
import { readRequirementClaimState } from "../../kernel/requirement-board.js";
import { inspectWakeflowPrivateModes, wakeflowPrivateModeAreas, } from "../../workspace/maintenance/wakeflow-private-mode-census.js";
import { previewWakeflowStaticMaterialization } from "../../workspace/maintenance/wakeflow-static-materialization-preview.js";
import { inspectWakeflowWorkspaceCoreLayout, WakeflowWorkspaceCoreLayoutInspectionError, } from "../../workspace/maintenance/wakeflow-workspace-core-layout-inspection.js";
import { admitStatusResult, admitVerifyResult, parseStatusRequest, parseVerifyRequest, WAKEFLOW_OBSERVATION_PUBLIC_SCHEMA_VERSION, WAKEFLOW_STATUS_PUBLIC_TOOL_NAME, WAKEFLOW_VERIFY_PUBLIC_TOOL_NAME, } from "./contract.js";
import { capStatusList, deriveNextActions, deriveWorkspaceGates, disposalGuidance, nextFromActions, projectionFreshness, STATUS_LIST_MAXIMUMS, summarizeGates, verifyNext, } from "./decide.js";
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
    const characters = [...cleaned];
    const bounded = characters.length > RESIDUE_NAME_MAXIMUM
        ? `${characters.slice(0, RESIDUE_NAME_MAXIMUM - 1).join("")}…`
        : cleaned;
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
async function readSnapshot(root, signal) {
    try {
        return await readWakeflowConfigAuthoritySnapshot(root, signalOptions(signal));
    }
    catch (error) {
        if (error instanceof WakeflowConfigAuthoritySnapshotError) {
            if (error.reason === "aborted")
                fail("io-failure", "aborted", "$signal", { cause: error });
            fail("precondition-failed", "config-authority", "$request.root", { cause: error });
        }
        throw error;
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
    const snapshot = await readSnapshot(root, options.signal);
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
            };
        }
    }
    return null;
}
/** 绑定会话最近一条 hook 记录；没有绑定或没有记录为 null。 */
/**
 * 窗口的制品状态（§13.127）：绑定会话最近一次 session-start 记录里的 manifest 摘要等于本进程的
 * 即 current，不等即 stale；任一边不知道（没有记录、记录早于该字段、本进程没有 manifest）即 unknown。
 */
function artifactStateOf(context, binding) {
    const own = context.facade.artifact?.manifestDigest ?? null;
    if (binding === null || own === null)
        return "unknown";
    const started = context.observation.hooks
        .find((entry) => entry.hostId === binding.hostId)
        ?.artifactBySession.get(binding.handleValue);
    if (started === undefined || started === null)
        return "unknown";
    return started === own ? "current" : "stale";
}
function staleArtifactWindowIds(context) {
    return context.snapshot.model.topology.windows
        .map((window) => window.windowId)
        .filter((windowId) => artifactStateOf(context, windowBindingOf(context.observation, windowId)) === "stale");
}
/** 本进程脚下的制品是否已更新：启动时与现在磁盘上的 manifest 摘要不同。 */
function runtimeView(context) {
    const artifact = context.facade.artifact;
    const manifestDigest = artifact?.manifestDigest ?? null;
    const onDisk = artifact?.readCurrentManifestDigest() ?? null;
    return {
        artifactManifestDigest: manifestDigest,
        artifactOnDisk: manifestDigest === null || onDisk === null
            ? "unknown"
            : onDisk === manifestDigest
                ? "same"
                : "changed",
    };
}
function lastObservationOf(observation, binding) {
    if (binding === null)
        return null;
    const latest = observation.hooks
        .find((entry) => entry.hostId === binding.hostId)
        ?.latestBySession.get(binding.handleValue);
    return latest === undefined ? null : { event: latest.event, recordedAt: latest.recordedAt };
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
            projection: windowProjectionOf(observation, window.windowId),
            artifact: artifactStateOf(context, binding),
        };
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
function podViews(context) {
    const { observation, root, facade } = context;
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
            const present = receipt?.checkoutPresent === true;
            return {
                repositoryId: worktree.repositoryId,
                receipt: receipt === undefined ? "absent" : present ? "present" : "checkout-missing",
                disposal: pod.pod.lifecycle === "closing" && present && receipt !== undefined
                    ? disposalGuidance(facade.hostId, path.relative(root.absolutePath, receipt.receipt.path) || ".", receipt.receipt.locked)
                    : null,
            };
        }),
    }));
}
function repositoryViews(observation) {
    let omitted = 0;
    const all = (observation.repositories.value ?? []).map((repository) => {
        const worktrees = capStatusList([...repository.worktrees].sort((left, right) => left.name.localeCompare(right.name)), STATUS_LIST_MAXIMUMS.worktrees);
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
function nextActionInput(context) {
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
        staleArtifactWindows: staleArtifactWindowIds(context),
        artifactServerOutdated: runtimeView(context).artifactOnDisk === "changed",
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
    return Object.freeze({
        route: null,
        archive: {
            demandId: archive.demandId,
            outcome: archive.outcome,
            archiveRef: archive.archiveRef,
            archivedAt: archive.archivedAt,
            terminalEvent: archive.terminalEvent,
            manifestDigest: archive.manifestDigest,
        },
        next: archive.outcome === "completed"
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
async function assembleStatus(context, request) {
    const { observation, snapshot } = context;
    const actions = deriveNextActions(nextActionInput(context));
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
        runtime: runtimeView(context),
        maintenance: maintenanceView(context.maintenance),
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
        next: section.next ?? nextFromActions(actions),
        nextActions: actions,
    });
}
/** 执行一次 `wakeflow_status`。 */
export async function executeStatusRequest(facade, value, options = {}) {
    return runCommandShell({
        tool: WAKEFLOW_STATUS_PUBLIC_TOOL_NAME,
        parseRequest: (raw) => {
            const request = parseStatusRequest(raw);
            return { envelope: request, input: request };
        },
        open: (root) => openContext(root, facade, options),
        close: closeContext,
        privateValues,
    }, value, () => undefined, (context, binding) => assembleStatus(context, binding.input), commandShellExecutionOptions(options.durability));
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
/** 复用 demand 切片的门（治理层）：不扫描负载正文，所以没有 payload-privacy 门。 */
async function demandGateReport(context, demand) {
    if (demand.loaded === null)
        return null;
    let demandRoot = null;
    try {
        demandRoot = await openDemandOperationRoot(context.root, demand.demandId);
        const loaded = await loadDemandEventSourcingRootAuthority(demandRoot, new LedgerAuthorityStore(context.ledgerRoot), signalOptions(context.options.signal));
        const claim = await readRequirementClaimState(context.root, loaded.identity.source.requirementId, context.options.signal);
        return await evaluateVerifyGates({
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
    }
    catch (error) {
        failIfAborted(error);
        return null;
    }
    finally {
        if (demandRoot !== null)
            await closeDemandOperationRoot(demandRoot);
    }
}
function gateStatus(report, name) {
    const found = report?.gates.find((entry) => entry.gate === name);
    return found?.status ?? "unavailable";
}
async function gateFacts(context, reports) {
    const { observation, snapshot } = context;
    const demands = observation.demands.value ?? [];
    const activeIds = new Set(demands.map((demand) => demand.demandId));
    const board = observation.board.value;
    const orphans = new Set(orphanWorkClaims(observation).map((claim) => claim.claimId));
    const bindingsObserved = observation.bindings.every((host) => host.status === "observed");
    const bound = new Set(observation.bindings.flatMap((host) => host.bindings.map((b) => b.windowId)));
    const repositories = observation.repositories.value;
    const demandsObserved = observation.demands.status === "observed";
    const runtime = runtimeView(context);
    return Object.freeze({
        runtime: {
            manifestDigest: runtime.artifactManifestDigest,
            onDiskDigest: context.facade.artifact?.readCurrentManifestDigest() ?? null,
            staleWindows: staleArtifactWindowIds(context),
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
                    .map((state) => state.claim?.demandId ?? state.requirementId)
                : [],
        },
        demands: demands.map((demand) => {
            const report = reports.get(demand.demandId) ?? null;
            return {
                demandId: demand.demandId,
                status: demand.status,
                audit: gateStatus(report, "demand-root-audit"),
                evidence: gateStatus(report, "evidence-integrity"),
                appendCandidates: demand.loaded?.inventory.appendCandidateCount ?? 0,
            };
        }),
        strayJournals: await strayJournals(context, activeIds),
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
                    receipt: receipt === undefined
                        ? "absent"
                        : receipt.checkoutPresent
                            ? "present"
                            : "checkout-missing",
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
async function assembleVerify(context, request) {
    const demands = context.observation.demands.value ?? [];
    const reports = new Map();
    for (const demand of demands)
        reports.set(demand.demandId, await demandGateReport(context, demand));
    const gates = deriveWorkspaceGates(await gateFacts(context, reports));
    const { ok, summary } = summarizeGates(gates);
    let demandSection = null;
    if (request.demandId !== undefined) {
        // 活动集合本身读不出时不能替这个 Demand 下结论：它可能活着，只是这轮看不见（与 status 同一裁决）。
        if (!reports.has(request.demandId) && context.observation.demands.status !== "observed") {
            fail("precondition-failed", "demands-unavailable", "$request.demandId");
        }
        // 在活动集合里但读不出（报告为 null）仍然是 current：它不是归档，也不是未知，只是这轮没有门。
        if (reports.has(request.demandId)) {
            const report = reports.get(request.demandId) ?? null;
            demandSection = {
                demandId: request.demandId,
                status: "current",
                gates: report?.gates ?? [],
                observationDigest: report?.observationDigest ?? null,
            };
        }
        else {
            const archive = await locateLatestDemandArchive(context.ledgerRoot, request.demandId, context.options.signal);
            demandSection = {
                demandId: request.demandId,
                status: archive === null ? "unknown" : "archived",
                gates: [],
                observationDigest: null,
            };
        }
    }
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
        next: verifyNext(gates),
    });
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
        tool: WAKEFLOW_VERIFY_PUBLIC_TOOL_NAME,
        parseRequest: (raw) => {
            const request = parseVerifyRequest(raw);
            return { envelope: request, input: request };
        },
        open: (root) => openContext(root, facade, options),
        close: closeContext,
        privateValues,
    }, value, () => undefined, (context, binding) => assembleVerify(context, binding.input), commandShellExecutionOptions(options.durability));
}
