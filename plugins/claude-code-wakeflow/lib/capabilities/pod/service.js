import path from "node:path";
import { parseWakeflowConfig, WakeflowConfigError, } from "../../configuration/wakeflow-config.js";
import { replaceWakeflowConfigAuthority, WakeflowConfigAuthorityReplacementError, } from "../../configuration/wakeflow-config-authority-replacement.js";
import { readWakeflowConfigAuthoritySnapshot, WakeflowConfigAuthoritySnapshotError, } from "../../configuration/wakeflow-config-authority-snapshot.js";
import { createWakeflowConfigDocumentValue } from "../../configuration/wakeflow-config-document.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, Sha256Error } from "../../foundation/crypto/sha256.js";
import { parseJsonValue, } from "../../foundation/data/json-value.js";
import { readUtcWallClock } from "../../foundation/time/wall-clock.js";
import { assertNoActiveDemand } from "../../governance/demand/publication/demand-active-guard.js";
import { afterMutationRefresh } from "../../governance/observation/active-projection-refresh.js";
import { worktreeDisposalGuidance } from "../../governance/pod/worktree-disposal.js";
import { commandShellExecutionOptions } from "../../kernel/command-shell.js";
import { fail, WakeflowError } from "../../kernel/error.js";
import { listPodWorktreeReceipts, retirePodReceipts, retirePodWorktreeReceipt, worktreeCheckoutPresent, } from "../../kernel/pod-worktree-receipts.js";
import { runPublicationTransaction, } from "../../kernel/publication-transaction.js";
import { inspectWakeflowWindowHostBindingInventory, WakeflowWindowHostBindingStoreError, } from "../../workspace/window-runtime/wakeflow-window-host-binding-store.js";
import { compileWakeflowWindowHostBindingStoreAuthority } from "../../workspace/window-runtime/wakeflow-window-host-binding-store-authority.js";
import { WakeflowWindowRuntimeProjectionError } from "../../workspace/window-runtime/wakeflow-window-runtime-projection-inspection.js";
import { refreshWakeflowWindowRuntimeProjections, retireWakeflowWindowRuntimeProjections, } from "../../workspace/window-runtime/wakeflow-window-runtime-projection-maintenance.js";
import { admitPodResult, parsePodRequest, WAKEFLOW_POD_PUBLIC_SCHEMA_VERSION, WAKEFLOW_POD_PUBLIC_TOOL_NAME, } from "./contract.js";
import { deriveCloseCompleteBlockers, deriveCloseRequestBlockers, deriveCreateBlockers, derivePodId, derivePodState, derivePodWindows, derivePodWorktrees, podMutationNext, podPreviewNext, } from "./decide.js";
function signalOptions(signal) {
    return signal === undefined ? {} : { signal };
}
// ---- 请求与上下文 ------------------------------------------------------------------
function envelopeOf(request) {
    if (request.mode === "recover") {
        return Object.freeze({
            root: request.root,
            mode: "recover",
            planDigest: null,
            operationId: request.podId,
        });
    }
    let planDigest = null;
    if (request.planDigest !== undefined) {
        try {
            planDigest = parseSha256Digest(request.planDigest, "$request.planDigest");
        }
        catch (error) {
            if (error instanceof Sha256Error) {
                fail("invalid-request", "plan-digest", "$request.planDigest", { cause: error });
            }
            throw error;
        }
    }
    return Object.freeze({ root: request.root, mode: request.mode, planDigest, operationId: null });
}
async function openContext(root, facade, options) {
    try {
        const snapshot = await readWakeflowConfigAuthoritySnapshot(root, signalOptions(options.signal));
        return Object.freeze({ root, facade, snapshot, options });
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
function podOf(context, podId) {
    return Object.hasOwn(context.snapshot.indexes.podById, podId)
        ? (context.snapshot.indexes.podById[podId] ?? null)
        : null;
}
function podWindowIds(context, podId) {
    const scope = Object.hasOwn(context.snapshot.indexes.podScopes, podId)
        ? context.snapshot.indexes.podScopes[podId]
        : undefined;
    return scope === undefined ? [] : scope.windows.map((window) => window.windowId);
}
// ---- 事实加载 ----------------------------------------------------------------------
async function loadBindings(context) {
    try {
        const authority = compileWakeflowWindowHostBindingStoreAuthority(context.snapshot.model, context.facade.resourceProfile, context.facade.identityProfile);
        return (await inspectWakeflowWindowHostBindingInventory(context.root, authority, signalOptions(context.options.signal))).bindings;
    }
    catch (error) {
        if (error instanceof WakeflowWindowHostBindingStoreError) {
            if (error.reason === "aborted")
                fail("io-failure", "aborted", "$signal", { cause: error });
            fail("precondition-failed", "binding-store", "$request.root", { cause: error });
        }
        throw error;
    }
}
async function loadPodFacts(context, pod) {
    const windowIds = podWindowIds(context, pod.podId);
    const bindings = await loadBindings(context);
    const bindingIdByWindowId = new Map();
    for (const binding of bindings) {
        if (windowIds.includes(binding.windowId)) {
            bindingIdByWindowId.set(binding.windowId, binding.bindingId);
        }
    }
    const stored = await listPodWorktreeReceipts(context.root, context.facade.hostId, pod.podId, signalOptions(context.options.signal));
    const receipts = [];
    for (const receipt of stored) {
        receipts.push(Object.freeze({ receipt, checkoutPresent: await worktreeCheckoutPresent(receipt) }));
    }
    const state = derivePodState({
        pod,
        windowIds,
        bindingIdByWindowId,
        receipts: receipts.map((entry) => Object.freeze({
            repositoryId: entry.receipt.repositoryId,
            windowId: entry.receipt.windowId,
            bindingId: entry.receipt.bindingId,
            checkoutPresent: entry.checkoutPresent,
        })),
    });
    return Object.freeze({
        pod,
        windowIds,
        bindingIdByWindowId,
        receipts: Object.freeze(receipts),
        state,
    });
}
/** pod 上的活动 Demand：治理层守卫按 podId 收窄（ADR-0010 D3）。 */
async function activeDemandOnPod(context, podId) {
    try {
        await assertNoActiveDemand(context.root, context.options.signal, null, podId);
        return null;
    }
    catch (error) {
        if (error instanceof WakeflowError && error.reason === "pod-busy") {
            return error.details?.demandId ?? "unknown";
        }
        throw error;
    }
}
// ---- 计划 --------------------------------------------------------------------------
function blocked(blockers) {
    return Object.freeze({ status: "blocked", blockers, plan: null, digest: null });
}
function ready(plan) {
    return Object.freeze({
        status: "ready",
        blockers: Object.freeze([]),
        plan,
        digest: computeCanonicalJsonSha256Digest(parseJsonValue(plan, "$plan")),
    });
}
function planCreate(context, intent) {
    const model = context.snapshot.model;
    const podId = derivePodId(model.program.programId, intent.idempotencyKey);
    const existing = podOf(context, podId);
    const replay = existing !== null;
    const blockers = [
        ...deriveCreateBlockers({
            name: intent.name,
            liveNames: model.pods.map((pod) => pod.name),
            repositoryCount: model.topology.repositories.length,
            replay,
        }),
        // 同键重放但改了名字：不是同一个创建请求。
        ...(replay && existing.name !== intent.name ? ["name-mismatch"] : []),
    ];
    if (blockers.length > 0)
        return blocked(Object.freeze(blockers));
    const windows = derivePodWindows(context.snapshot.indexes.primaryPod, model.topology.repositories.map((repository) => repository.repositoryId), podId, intent.name, model.program.programId);
    return ready(Object.freeze({
        kind: "create",
        podId,
        name: intent.name,
        replay,
        windows,
        worktrees: derivePodWorktrees(windows, intent.name),
        configDigest: context.snapshot.configDigest,
    }));
}
async function planClose(context, intent) {
    const pod = podOf(context, intent.podId);
    if (pod === null)
        return blocked([`pod-unknown:${intent.podId}`]);
    const facts = await loadPodFacts(context, pod);
    if (pod.lifecycle === "closing") {
        const blockers = deriveCloseCompleteBlockers({
            boundWindowIds: facts.windowIds.filter((id) => facts.bindingIdByWindowId.has(id)),
            presentCheckoutRepositoryIds: facts.receipts
                .filter((entry) => entry.checkoutPresent)
                .map((entry) => entry.receipt.repositoryId),
        });
        if (blockers.length > 0)
            return blocked(blockers);
        return ready(Object.freeze({
            kind: "close-complete",
            podId: pod.podId,
            configDigest: context.snapshot.configDigest,
        }));
    }
    const blockers = deriveCloseRequestBlockers({
        placement: pod.placement,
        activeDemandId: pod.placement === "primary" ? null : await activeDemandOnPod(context, pod.podId),
        registeredRepositoryIds: facts.receipts.map((entry) => entry.receipt.repositoryId),
        dispositions: intent.branches,
        knownRepositoryIds: pod.worktrees.map((worktree) => worktree.repositoryId),
    });
    if (blockers.length > 0)
        return blocked(blockers);
    return ready(Object.freeze({
        kind: "close-request",
        podId: pod.podId,
        branches: intent.branches.map((entry) => Object.freeze({
            repositoryId: entry.repositoryId,
            branch: facts.receipts.find((receipt) => receipt.receipt.repositoryId === entry.repositoryId)
                ?.receipt.branch ?? null,
            disposition: entry.disposition,
        })),
        configDigest: context.snapshot.configDigest,
    }));
}
async function planPod(context, input) {
    if (input.mode === "recover")
        fail("unexpected", "plan-mode", "$request.mode");
    return input.intent.kind === "create"
        ? planCreate(context, input.intent)
        : planClose(context, input.intent);
}
// ---- 配置事务 ----------------------------------------------------------------------
function mapReplacementError(error) {
    if (error instanceof WakeflowConfigAuthorityReplacementError) {
        if (error.reason === "aborted")
            fail("io-failure", "aborted", "$signal", { cause: error });
        if (error.reason === "conflict" || error.reason === "lock-timeout") {
            fail("concurrency-conflict", `config-${error.reason}`, "$request.root", {
                cause: error,
                retryable: true,
            });
        }
        if (error.reason === "recovery-required" || error.reason === "commit-uncertain") {
            fail("recovery-required", `config-${error.reason}`, "$request.root", { cause: error });
        }
        fail("precondition-failed", `config-${error.reason}`, "$request.root", { cause: error });
    }
    if (error instanceof WakeflowConfigError) {
        fail("precondition-failed", `config-${error.reason}`, "$request.root", { cause: error });
    }
    throw error;
}
function documentOf(model) {
    const value = createWakeflowConfigDocumentValue(model);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        fail("unexpected", "config-document", "$config");
    }
    return value;
}
async function replaceConfig(context, desired) {
    let model;
    try {
        model = parseWakeflowConfig(desired);
        await replaceWakeflowConfigAuthority(context.root, model, context.snapshot, signalOptions(context.options.signal));
    }
    catch (error) {
        mapReplacementError(error);
    }
    await refreshWindowProjectionsQuietly(context, model);
}
/**
 * 窗口离开配置（pod 关闭完成）后退役本宿主的投影文件（§13.114 D3）：只按已知 windowId 精确
 * 删除，不枚举投影目录；与刷新同一裁决——失败不让配置事务失败，中止仍上抛。
 */
async function retireProjectionsQuietly(context, windowIds) {
    if (windowIds.length === 0)
        return;
    try {
        await retireWakeflowWindowRuntimeProjections(context.root, {
            resourceProfile: context.facade.resourceProfile,
            windowIds,
            ...signalOptions(context.options.signal),
        });
    }
    catch (error) {
        if (error instanceof WakeflowWindowRuntimeProjectionError) {
            if (error.reason === "aborted")
                fail("io-failure", "aborted", "$signal", { cause: error });
            return;
        }
        throw error;
    }
}
/**
 * 窗口集或 pod 集变了：把本宿主的窗口运行投影收敛到新 Config（G6，§13.111 D5）。投影是派生物：
 * 收敛失败不让已经落盘的配置事务失败，留给 verify 的 window-runtime-projection 门报出；中止仍上抛。
 */
async function refreshWindowProjectionsQuietly(context, model) {
    try {
        await refreshWakeflowWindowRuntimeProjections(context.root, {
            config: model,
            resourceProfile: context.facade.resourceProfile,
            identityProfile: context.facade.identityProfile,
            ...signalOptions(context.options.signal),
        });
    }
    catch (error) {
        if (error instanceof WakeflowWindowRuntimeProjectionError) {
            if (error.reason === "aborted")
                fail("io-failure", "aborted", "$signal", { cause: error });
            return;
        }
        throw error;
    }
}
function windowDocument(window) {
    return {
        windowId: window.windowId,
        podId: window.podId,
        role: window.role,
        displayName: window.displayName,
        root: parseJsonValue(window.root, "$window.root"),
    };
}
async function applyCreate(context, plan) {
    if (plan.replay) {
        return Object.freeze({ disposition: "already-created", podId: plan.podId, retiredReceipts: 0 });
    }
    const document = documentOf(context.snapshot.model);
    const topology = document.topology;
    const desired = {
        ...document,
        topology: {
            ...topology,
            windows: [...topology.windows, ...plan.windows.map(windowDocument)],
        },
        pods: [
            ...document.pods,
            {
                podId: plan.podId,
                name: plan.name,
                placement: "worktree",
                lifecycle: "open",
                worktrees: plan.worktrees.map((worktree) => ({
                    repositoryId: worktree.repositoryId,
                    windowId: worktree.windowId,
                    suggestedName: worktree.suggestedName,
                })),
                closing: null,
            },
        ],
    };
    await replaceConfig(context, desired);
    return Object.freeze({ disposition: "created", podId: plan.podId, retiredReceipts: 0 });
}
async function applyCloseRequest(context, plan) {
    const document = documentOf(context.snapshot.model);
    const requestedAt = readUtcWallClock(context.options.clock);
    const desired = {
        ...document,
        pods: document.pods.map((pod) => pod.podId === plan.podId
            ? {
                ...pod,
                lifecycle: "closing",
                closing: {
                    requestedAt,
                    branches: plan.branches.map((branch) => ({
                        repositoryId: branch.repositoryId,
                        branch: branch.branch,
                        disposition: branch.disposition,
                    })),
                },
            }
            : pod),
    };
    await replaceConfig(context, desired);
    return Object.freeze({ disposition: "closing", podId: plan.podId, retiredReceipts: 0 });
}
async function applyCloseComplete(context, plan) {
    const document = documentOf(context.snapshot.model);
    const topology = document.topology;
    const removedWindowIds = context.snapshot.model.topology.windows
        .filter((window) => window.podId === plan.podId)
        .map((window) => window.windowId);
    const desired = {
        ...document,
        topology: {
            ...topology,
            windows: topology.windows.filter((window) => window.podId !== plan.podId),
        },
        pods: document.pods.filter((pod) => pod.podId !== plan.podId),
    };
    await replaceConfig(context, desired);
    await retireProjectionsQuietly(context, removedWindowIds);
    const receiptCount = (await listPodWorktreeReceipts(context.root, context.facade.hostId, plan.podId)).length;
    await retirePodReceipts(context.root, context.facade.hostId, plan.podId);
    return Object.freeze({ disposition: "closed", podId: plan.podId, retiredReceipts: receiptCount });
}
async function applyPod(context, _input, plan) {
    switch (plan.kind) {
        case "create":
            return applyCreate(context, plan);
        case "close-request":
            return applyCloseRequest(context, plan);
        case "close-complete":
            return applyCloseComplete(context, plan);
        default: {
            const exhaustive = plan;
            return exhaustive;
        }
    }
}
/** recover 只做回执对账：退休与绑定不同代或检出已不存在的回执；配置里没有的 pod 只清孤儿目录。 */
async function recoverPod(context, operationId) {
    const podId = operationId;
    const pod = podOf(context, podId);
    if (pod === null) {
        const removed = await retirePodReceipts(context.root, context.facade.hostId, podId);
        return Object.freeze({
            disposition: removed ? "retired" : "healthy",
            podId,
            retiredReceipts: removed ? 1 : 0,
        });
    }
    const facts = await loadPodFacts(context, pod);
    let retired = 0;
    for (const entry of facts.receipts) {
        const bound = facts.bindingIdByWindowId.get(entry.receipt.windowId);
        const stale = !entry.checkoutPresent || bound !== entry.receipt.bindingId;
        if (!stale)
            continue;
        if (await retirePodWorktreeReceipt(context.root, context.facade.hostId, podId, entry.receipt.repositoryId, signalOptions(context.options.signal))) {
            retired += 1;
        }
    }
    return Object.freeze({
        disposition: retired > 0 ? "retired" : "healthy",
        podId,
        retiredReceipts: retired,
    });
}
async function currentViews(context, podId) {
    const snapshot = await readWakeflowConfigAuthoritySnapshot(context.root, signalOptions(context.options.signal));
    const fresh = Object.freeze({ ...context, snapshot });
    const pod = podOf(fresh, podId);
    if (pod === null) {
        return Object.freeze({
            pod: null,
            windows: Object.freeze([]),
            worktrees: Object.freeze([]),
            next: podMutationNext({
                state: null,
                unboundWindowIds: [],
                boundWindowIds: [],
                missingReceiptRepositoryIds: [],
                presentCheckoutRepositoryIds: [],
            }),
        });
    }
    const facts = await loadPodFacts(fresh, pod);
    const scope = fresh.snapshot.indexes.podScopes[pod.podId];
    const windows = (scope?.windows ?? []).map((window) => ({
        windowId: window.windowId,
        role: window.role,
        displayTitle: window.displayName,
        bound: facts.bindingIdByWindowId.has(window.windowId),
    }));
    const worktrees = pod.worktrees.map((worktree) => {
        const entry = facts.receipts.find((candidate) => candidate.receipt.repositoryId === worktree.repositoryId);
        return {
            repositoryId: worktree.repositoryId,
            windowId: worktree.windowId,
            suggestedName: worktree.suggestedName,
            receipt: entry === undefined ? "absent" : entry.checkoutPresent ? "present" : "checkout-missing",
            // 关闭中仍在的检出：给 Agent 建议命令与宿主备选（§13.94 D10）；Wakeflow 自己不删。
            disposal: pod.lifecycle === "closing" && entry?.checkoutPresent === true
                ? worktreeDisposalGuidance(fresh.facade.hostId, path.relative(fresh.root.absolutePath, entry.receipt.path) || ".")
                : null,
        };
    });
    return Object.freeze({
        pod: { podId: pod.podId, name: pod.name, placement: pod.placement, state: facts.state },
        windows: Object.freeze(windows),
        worktrees: Object.freeze(worktrees),
        next: podMutationNext({
            state: facts.state,
            unboundWindowIds: facts.windowIds.filter((id) => !facts.bindingIdByWindowId.has(id)),
            boundWindowIds: facts.windowIds.filter((id) => facts.bindingIdByWindowId.has(id)),
            missingReceiptRepositoryIds: pod.worktrees
                .filter((worktree) => !facts.receipts.some((entry) => entry.receipt.repositoryId === worktree.repositoryId))
                .map((worktree) => worktree.repositoryId),
            presentCheckoutRepositoryIds: facts.receipts
                .filter((entry) => entry.checkoutPresent)
                .map((entry) => entry.receipt.repositoryId),
        }),
    });
}
async function previewViews(context, planned) {
    const plan = planned.plan;
    if (plan === null)
        return null;
    if (plan.kind === "create") {
        return {
            kind: "create",
            pod: {
                podId: plan.podId,
                name: plan.name,
                placement: "worktree",
                state: plan.replay
                    ? ((await currentViews(context, plan.podId)).pod?.state ?? "creating")
                    : "creating",
            },
            windows: plan.windows.map((window) => ({
                windowId: window.windowId,
                role: window.role,
                displayTitle: window.displayName,
                bound: false,
            })),
            worktrees: plan.worktrees.map((worktree) => ({
                repositoryId: worktree.repositoryId,
                windowId: worktree.windowId,
                suggestedName: worktree.suggestedName,
                receipt: "absent",
                disposal: null,
            })),
        };
    }
    const views = await currentViews(context, plan.podId);
    if (views.pod === null)
        fail("unexpected", "pod-vanished", "$request.intent.podId");
    return { kind: plan.kind, pod: views.pod, windows: views.windows, worktrees: views.worktrees };
}
async function assembleResult(context, phase, next) {
    const base = {
        schemaVersion: WAKEFLOW_POD_PUBLIC_SCHEMA_VERSION,
        tool: WAKEFLOW_POD_PUBLIC_TOOL_NAME,
    };
    if (phase.mode === "preview") {
        return admitPodResult({
            kind: "WakeflowPodPreview",
            ...base,
            mode: "preview",
            status: phase.planned.status,
            blockers: phase.planned.blockers,
            planDigest: phase.planned.digest,
            plan: await previewViews(context, phase.planned),
            next,
        });
    }
    const views = await currentViews(context, phase.outcome.podId);
    return admitPodResult({
        kind: "WakeflowPodMutation",
        ...base,
        mode: phase.mode,
        disposition: phase.outcome.disposition,
        pod: views.pod,
        windows: views.windows,
        worktrees: views.worktrees,
        retiredReceipts: phase.outcome.retiredReceipts,
        next: views.next,
    });
}
function privateValues(context) {
    const values = new Set([context.snapshot.ledgerRoot]);
    for (const entry of context.snapshot.placements.roots) {
        values.add(entry.absolutePath);
        if (entry.realPath !== null)
            values.add(entry.realPath);
    }
    return values;
}
/** 执行一次 `wakeflow_pod`。 */
export async function executePodRequest(facade, value, options = {}) {
    // 结果组装要读当前事实（绑定、回执、检出），是异步的；内核的 result 钩子同步，所以在
    // next 钩子里算好并缓存，result 只取出来。
    let assembled = null;
    return runPublicationTransaction({
        tool: WAKEFLOW_POD_PUBLIC_TOOL_NAME,
        parseRequest: (raw) => {
            const request = parsePodRequest(raw);
            return { envelope: envelopeOf(request), input: request };
        },
        open: (root) => openContext(root, facade, options),
        close: async () => { },
        plan: planPod,
        apply: (context, input, plan) => afterMutationRefresh(context.root, context.options.signal, () => applyPod(context, input, plan)),
        recover: recoverPod,
        next: async (context, phase) => {
            const kind = phase.mode === "preview" ? (phase.planned.plan?.kind ?? "create") : "create";
            const next = phase.mode === "preview"
                ? podPreviewNext(kind, phase.planned)
                : (await currentViews(context, phase.outcome.podId)).next;
            assembled = await assembleResult(context, phase, next);
            return next;
        },
        result: () => {
            if (assembled === null)
                fail("unexpected", "result-not-assembled", "$result");
            return assembled;
        },
        privateValues,
    }, value, commandShellExecutionOptions(options.durability));
}
