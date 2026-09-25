import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest } from "../../foundation/crypto/sha256.js";
import { JsonValueError, parseJsonValue } from "../../foundation/data/json-value.js";
import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { readStableResourceDirectory, StableDirectoryReadError, } from "../../foundation/filesystem/stable-directory-read.js";
import { readStableFile, readStableFileDigest, StableFileReadError, } from "../../foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { decodeUtf8, encodeUtf8 } from "../../foundation/text/utf8.js";
import { readUtcWallClock } from "../../foundation/time/wall-clock.js";
import { inspectActiveLayout, } from "../../kernel/active-projection.js";
import { fail, WakeflowError } from "../../kernel/error.js";
import { HOST_HOOK_DIRECTORY_MAXIMUM_ENTRIES, readHostHookObservations, } from "../../kernel/hook-observations.js";
import { hostHookObservationsRootRef, hostRuntimeRootRef, REQUIREMENT_BOARD_INDEX_REF, WAKEFLOW_ACTIVE_CURRENT_ROOT_REF, WORK_CLAIMS_ROOT_REF, } from "../../kernel/layout.js";
import { listPodWorktreeReceiptsAnyHost, worktreeCheckoutPresent, } from "../../kernel/pod-worktree-receipts.js";
import { listRequirementClaimStates, renderRequirementBoardIndex, } from "../../kernel/requirement-board.js";
import { inspectWorkClaim } from "../../kernel/work-claims.js";
import { inspectWakeflowWindowHostBindingInventory, WakeflowWindowHostBindingStoreError, } from "../../workspace/window-runtime/wakeflow-window-host-binding-store.js";
import { compileWakeflowWindowHostBindingStoreAuthority } from "../../workspace/window-runtime/wakeflow-window-host-binding-store-authority.js";
import { inspectWakeflowWindowRuntimeProjectionSet, WakeflowWindowRuntimeProjectionError, } from "../../workspace/window-runtime/wakeflow-window-runtime-projection-inspection.js";
import { buildDemandControllerRoute } from "../controller/demand-controller-route.js";
import { closeDemandOperationRoot, openDemandOperationRoot, } from "../demand/demand-operation-authority-context.js";
import { loadDemandEventSourcingRootAuthority, } from "../demand/event-sourcing/demand-event-sourcing-root-authority.js";
import { LedgerAuthorityStore } from "../ledger/ledger-authority-store.js";
import { derivePodState } from "../pod/pod-state.js";
import { readDemandResultReviewSnapshot, } from "../review/demand-result-review-snapshot.js";
import { observeArchivedDemands, } from "./archived-demand-observation.js";
import { WAKEFLOW_OBSERVATION_POLICY } from "./observation-policy.js";
import { observeRepositoryPointers, } from "./repository-pointer-observation.js";
const DIRECTORY_MAXIMUM_ENTRIES = 4096;
/** 等于内核 hook 目录的列举上限：可见集合由保留策略而不是读取上限决定（§13.97 D7）。 */
const HOOK_RECORDS_MAXIMUM = HOST_HOOK_DIRECTORY_MAXIMUM_ENTRIES;
const ASSET_MAXIMUM_BYTES = parseByteCount(256 * 1024, "$asset.maximumBytes");
const SETTINGS_MAXIMUM_BYTES = parseByteCount(1024 * 1024, "$settings.maximumBytes");
const INDEX_MAXIMUM_BYTES = parseByteCount(4 * 1024 * 1024, "$boardIndex.maximumBytes");
const DEMAND_DIRECTORY_PATTERN = /^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CLAIM_FILE_PATTERN = /^(window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/u;
function signalOptions(signal) {
    return signal === undefined ? {} : { signal };
}
function reasonOf(error) {
    if (typeof error !== "object" || error === null)
        return null;
    const reason = error.reason;
    return typeof reason === "string" ? reason : null;
}
/** 隔离一个域的失败：带原因的领域或基础错误只让该域不可用，中止一律上抛。 */
async function observeDomain(name, read) {
    try {
        return Object.freeze({ status: "observed", issue: null, value: await read() });
    }
    catch (error) {
        const reason = reasonOf(error);
        if (reason === null)
            throw error;
        if (reason === "aborted") {
            if (error instanceof WakeflowError)
                throw error;
            fail("io-failure", "aborted", "$signal", { cause: error });
        }
        return Object.freeze({ status: "unavailable", issue: `${name}:${reason}`, value: null });
    }
}
// ---- 各域 ----------------------------------------------------------------------
async function observeBoard(root, signal) {
    const listing = await listRequirementClaimStates(root, signal);
    const counts = { pending: 0, parked: 0, claimed: 0, withdrawn: 0, archived: 0 };
    for (const state of listing.states)
        counts[state.status] += 1;
    let indexDigest = null;
    try {
        indexDigest = (await readStableFileDigest(root, REQUIREMENT_BOARD_INDEX_REF, {
            maximumBytes: INDEX_MAXIMUM_BYTES,
            ...signalOptions(signal),
        })).digest;
    }
    catch (error) {
        if (!(error instanceof StableFileReadError) || error.reason === "aborted")
            throw error;
    }
    return Object.freeze({
        states: listing.states,
        skipped: listing.skipped,
        counts: Object.freeze(counts),
        indexDigest,
        expectedIndexDigest: computeSha256Digest(encodeUtf8(renderRequirementBoardIndex(listing.states), "$boardIndex"), "$boardIndex"),
    });
}
async function listActiveDemandIds(root, signal) {
    try {
        const listing = await readStableResourceDirectory(root, WAKEFLOW_ACTIVE_CURRENT_ROOT_REF, {
            maximumEntries: DIRECTORY_MAXIMUM_ENTRIES,
            ...signalOptions(signal),
        });
        return listing.entries
            .filter((entry) => entry.node.kind === "directory" && DEMAND_DIRECTORY_PATTERN.test(entry.name))
            .map((entry) => entry.name)
            .sort();
    }
    catch (error) {
        if (error instanceof StableDirectoryReadError && error.reason === "not-found")
            return [];
        throw error;
    }
}
async function observeDemand(root, store, demandId, signal) {
    let demandRoot = null;
    try {
        demandRoot = await openDemandOperationRoot(root, demandId);
        const loaded = await loadDemandEventSourcingRootAuthority(demandRoot, store, signalOptions(signal));
        const reviewSnapshot = await readDemandResultReviewSnapshot(demandRoot, signalOptions(signal));
        const route = buildDemandControllerRoute(loaded, reviewSnapshot);
        return Object.freeze({ demandId, status: "observed", issue: null, loaded, reviewSnapshot, route });
    }
    catch (error) {
        const reason = reasonOf(error);
        if (reason === null)
            throw error;
        if (reason === "aborted")
            fail("io-failure", "aborted", "$signal", { cause: error });
        return Object.freeze({
            demandId,
            status: "unavailable",
            issue: reason,
            loaded: null,
            reviewSnapshot: null,
            route: null,
        });
    }
    finally {
        if (demandRoot !== null)
            await closeDemandOperationRoot(demandRoot);
    }
}
async function observeDemands(root, ledgerRoot, signal) {
    const store = new LedgerAuthorityStore(ledgerRoot);
    const demands = [];
    for (const demandId of await listActiveDemandIds(root, signal)) {
        demands.push(await observeDemand(root, store, demandId, signal));
    }
    return Object.freeze(demands);
}
async function observeClaims(root, signal) {
    let names;
    try {
        const listing = await readStableResourceDirectory(root, WORK_CLAIMS_ROOT_REF, {
            maximumEntries: DIRECTORY_MAXIMUM_ENTRIES,
            ...signalOptions(signal),
        });
        names = listing.entries.filter((entry) => entry.node.kind === "file").map((entry) => entry.name);
    }
    catch (error) {
        if (error instanceof StableDirectoryReadError && error.reason === "not-found") {
            return Object.freeze({ claims: Object.freeze([]), unreadable: 0 });
        }
        throw error;
    }
    const claims = [];
    let unreadable = 0;
    for (const name of [...names].sort()) {
        const match = CLAIM_FILE_PATTERN.exec(name);
        if (match?.[1] === undefined) {
            unreadable += 1;
            continue;
        }
        try {
            const inspected = await inspectWorkClaim(root, match[1], signalOptions(signal));
            if (inspected.claim !== null)
                claims.push(inspected.claim);
        }
        catch (error) {
            // 没有原因的错误是缺陷，不能记成一份读不出的声明。
            const reason = reasonOf(error);
            if (reason === null || reason === "aborted")
                throw error;
            unreadable += 1;
        }
    }
    return Object.freeze({ claims: Object.freeze(claims), unreadable });
}
/** 宿主运行时尚未物化（该宿主的制品还没初始化过本工作区）：该宿主没有绑定，不是读失败。 */
async function bindingRootAbsent(root, bindingRootRef) {
    try {
        await root.inspectExistingResource(bindingRootRef, "$bindings");
        return false;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError && error.reason === "resource-not-found")
            return true;
        throw error;
    }
}
async function observeHostBindings(root, snapshot, host, signal) {
    try {
        const authority = compileWakeflowWindowHostBindingStoreAuthority(snapshot.model, host.resourceProfile, host.identityProfile);
        if (await bindingRootAbsent(root, authority.bindingRootRef)) {
            return Object.freeze({
                hostId: host.hostId,
                status: "observed",
                issue: null,
                bindings: Object.freeze([]),
            });
        }
        const inventory = await inspectWakeflowWindowHostBindingInventory(root, authority, signalOptions(signal));
        return Object.freeze({
            hostId: host.hostId,
            status: "observed",
            issue: null,
            bindings: inventory.bindings,
        });
    }
    catch (error) {
        if (error instanceof WakeflowWindowHostBindingStoreError && error.reason === "aborted") {
            fail("io-failure", "aborted", "$signal", { cause: error });
        }
        const reason = reasonOf(error);
        if (reason === null)
            throw error;
        return Object.freeze({
            hostId: host.hostId,
            status: "unavailable",
            issue: reason,
            bindings: Object.freeze([]),
        });
    }
}
async function hookDirectoryState(root, hostId) {
    try {
        const node = (await root.inspectExistingResource(hostHookObservationsRootRef(hostId), "$hooks"))
            .node;
        return node.kind === "directory" && node.permissionBits === 0o700 ? "private" : "mode";
    }
    catch (error) {
        if (reasonOf(error) === "resource-not-found")
            return "absent";
        throw error;
    }
}
async function observeHostHooks(root, hostId, current, signal) {
    try {
        const directory = await hookDirectoryState(root, hostId);
        const inventory = await readHostHookObservations(root, hostId, { limit: HOOK_RECORDS_MAXIMUM }, signalOptions(signal));
        const latestBySession = new Map();
        const artifactBySession = new Map();
        const startedAt = new Map();
        for (const record of inventory.records) {
            const previous = latestBySession.get(record.sessionId);
            if (previous === undefined || previous.recordedAt <= record.recordedAt) {
                latestBySession.set(record.sessionId, { event: record.event, recordedAt: record.recordedAt });
            }
            if (record.event === "session-start") {
                const previousStart = startedAt.get(record.sessionId);
                if (previousStart === undefined || previousStart <= record.recordedAt) {
                    startedAt.set(record.sessionId, record.recordedAt);
                    artifactBySession.set(record.sessionId, record.artifactManifestDigest);
                }
            }
        }
        return Object.freeze({
            hostId,
            current,
            status: "observed",
            issue: null,
            directory,
            records: inventory.records.length,
            skipped: inventory.skipped,
            latestBySession,
            artifactBySession,
        });
    }
    catch (error) {
        const reason = reasonOf(error);
        if (reason === null)
            throw error;
        if (reason === "aborted") {
            if (error instanceof WakeflowError)
                throw error;
            fail("io-failure", "aborted", "$signal", { cause: error });
        }
        return Object.freeze({
            hostId,
            current,
            status: "unavailable",
            issue: reason,
            directory: "absent",
            records: 0,
            skipped: 0,
            latestBySession: new Map(),
            artifactBySession: new Map(),
        });
    }
}
async function observePods(root, snapshot, bindings, demands, scope, signal) {
    const bindingIdByWindowId = new Map();
    for (const host of bindings) {
        for (const binding of host.bindings) {
            if (!bindingIdByWindowId.has(binding.windowId)) {
                bindingIdByWindowId.set(binding.windowId, binding.bindingId);
            }
        }
    }
    const bindingsObserved = scope === "full" && bindings.every((host) => host.status === "observed");
    const pods = [];
    for (const pod of snapshot.model.pods) {
        const windowIds = (snapshot.indexes.podScopes[pod.podId]?.windows ?? []).map((window) => window.windowId);
        const stored = await listPodWorktreeReceiptsAnyHost(root, pod.podId, signalOptions(signal));
        const receipts = [];
        for (const receipt of stored) {
            receipts.push(Object.freeze({ receipt, checkoutPresent: await worktreeCheckoutPresent(receipt) }));
        }
        const state = bindingsObserved
            ? derivePodState({
                pod,
                windowIds,
                bindingIdByWindowId,
                receipts: receipts.map((entry) => Object.freeze({
                    repositoryId: entry.receipt.repositoryId,
                    bindingId: entry.receipt.bindingId,
                    checkoutPresent: entry.checkoutPresent,
                })),
            })
            : null;
        const active = demands.find((demand) => demand.loaded?.identity.podId === pod.podId &&
            demand.loaded.aggregate.state.lifecycle === "active");
        pods.push(Object.freeze({
            pod,
            windowIds: Object.freeze(windowIds),
            boundWindowIds: Object.freeze(windowIds.filter((id) => bindingIdByWindowId.has(id))),
            receipts: Object.freeze(receipts),
            state,
            activeDemandId: active?.demandId ?? null,
        }));
    }
    return Object.freeze(pods);
}
async function observeRepositories(snapshot, signal) {
    const observations = [];
    for (const repository of snapshot.model.topology.repositories) {
        const placement = snapshot.placements.roots.find((entry) => entry.key === `repository.${repository.repositoryId}.root`);
        if (placement === undefined || placement.state !== "present" || placement.realPath === null) {
            observations.push(Object.freeze({
                repositoryId: repository.repositoryId,
                status: "unavailable",
                issue: "root-missing",
                head: null,
                branch: null,
                detached: false,
                branches: Object.freeze([]),
                worktrees: Object.freeze([]),
            }));
            continue;
        }
        observations.push(await observeRepositoryPointers({
            repositoryId: repository.repositoryId,
            absolutePath: placement.realPath,
            ...signalOptions(signal),
        }));
    }
    return Object.freeze(observations);
}
async function observeAssetFile(root, host, asset, signal) {
    const ref = parsePortableResourcePath(`${hostRuntimeRootRef(host.hostId)}/operations/assets/${asset.fileName}`, "$asset");
    try {
        const read = await readStableFile(root, ref, {
            maximumBytes: ASSET_MAXIMUM_BYTES,
            ...signalOptions(signal),
        });
        if (read.node.permissionBits !== 0o600)
            return Object.freeze({ status: "mode", issue: null });
        return Object.freeze({
            status: read.digest === asset.digest ? "current" : "drift",
            issue: null,
        });
    }
    catch (error) {
        if (error instanceof StableFileReadError && error.reason === "not-found") {
            return Object.freeze({ status: "missing", issue: null });
        }
        const reason = reasonOf(error);
        if (reason === null)
            throw error;
        if (reason === "aborted")
            fail("io-failure", "aborted", "$signal", { cause: error });
        return Object.freeze({ status: "unavailable", issue: reason });
    }
}
/** 设置文件解析不出或不是 JSON 对象；与“对象里没有该键”（undefined）分开。 */
const SETTINGS_NOT_OBJECT = Symbol("settings-not-object");
function settingsEntryOf(bytes, key) {
    try {
        const document = JSON.parse(decodeUtf8(bytes, "$settings"));
        if (typeof document !== "object" || document === null || Array.isArray(document)) {
            return SETTINGS_NOT_OBJECT;
        }
        return Object.hasOwn(document, key) ? document[key] : undefined;
    }
    catch {
        return SETTINGS_NOT_OBJECT;
    }
}
/**
 * 本地设置里的状态栏条目：只比较该键的规范 JSON，其他键不看；文件不是 JSON 对象即 unreadable，
 * 是对象但缺该键即 drift。
 */
async function observeSettingsEntry(root, settings, signal) {
    try {
        const read = await readStableFile(root, settings.path, {
            maximumBytes: SETTINGS_MAXIMUM_BYTES,
            ...signalOptions(signal),
        });
        const entry = settingsEntryOf(read.bytes, settings.key);
        if (entry === SETTINGS_NOT_OBJECT)
            return "unreadable";
        if (read.node.permissionBits !== 0o600)
            return "mode";
        if (entry === undefined)
            return "drift";
        const expected = settings.expectedEntry(root.absolutePath);
        return computeCanonicalJsonSha256Digest(parseJsonValue(entry, "$settings"))
            === computeCanonicalJsonSha256Digest(expected)
            ? "current"
            : "drift";
    }
    catch (error) {
        if (error instanceof JsonValueError)
            return "unreadable";
        if (error instanceof StableFileReadError && error.reason === "not-found")
            return "missing";
        const reason = reasonOf(error);
        if (reason === null)
            throw error;
        if (reason === "aborted")
            fail("io-failure", "aborted", "$signal", { cause: error });
        return "unreadable";
    }
}
async function observeHostAsset(root, host, currentHostId, signal) {
    if (host.statuslineAsset === null || host.hostId !== currentHostId) {
        return Object.freeze({
            hostId: host.hostId,
            status: "not-applicable",
            settings: "not-applicable",
            companion: null,
            issue: null,
        });
    }
    const asset = await observeAssetFile(root, host, host.statuslineAsset, signal);
    const settings = await observeSettingsEntry(root, host.statuslineAsset.settings, signal);
    let status = asset.status;
    let issue = asset.issue;
    let companion = null;
    // 状态栏资产先判；它 current 时再按声明顺序看伴随资产，第一份不 current 的决定整票（§13.117 D4）。
    if (status === "current") {
        for (const entry of host.statuslineAsset.companions) {
            const observed = await observeAssetFile(root, host, entry, signal);
            if (observed.status === "current")
                continue;
            status = observed.status;
            issue = observed.issue;
            companion = entry.fileName;
            break;
        }
    }
    return Object.freeze({ hostId: host.hostId, status, settings, companion, issue });
}
/**
 * 一个宿主的窗口运行投影：与对账用同一份重算与判定，读不出只让本宿主这一组不可用。
 * 同伴宿主的运行时根缺席与 hook 通道同一裁决（§13.97 D10）：不是本制品维护的东西，保持沉默。
 */
async function observeHostProjections(root, snapshot, host, current, signal) {
    try {
        const inspection = await inspectWakeflowWindowRuntimeProjectionSet(root, {
            config: snapshot.model,
            resourceProfile: host.resourceProfile,
            identityProfile: host.identityProfile,
            ...signalOptions(signal),
        });
        if (inspection.status === "runtime-missing" && !current) {
            return Object.freeze({
                hostId: host.hostId,
                status: "observed",
                issue: null,
                runtime: "absent",
                windows: Object.freeze([]),
            });
        }
        if (inspection.status !== "observed") {
            return Object.freeze({
                hostId: host.hostId,
                status: "unavailable",
                issue: inspection.status,
                runtime: inspection.status === "runtime-missing" ? "absent" : "present",
                windows: Object.freeze([]),
            });
        }
        return Object.freeze({
            hostId: host.hostId,
            status: "observed",
            issue: null,
            runtime: "present",
            windows: Object.freeze(inspection.windows.map((window) => Object.freeze({
                windowId: window.windowId,
                registered: window.registered,
                status: window.status,
            }))),
        });
    }
    catch (error) {
        if (error instanceof WakeflowWindowRuntimeProjectionError &&
            error.reason === "aborted") {
            fail("io-failure", "aborted", "$signal", { cause: error });
        }
        const reason = reasonOf(error);
        if (reason === null)
            throw error;
        return Object.freeze({
            hostId: host.hostId,
            status: "unavailable",
            issue: reason,
            runtime: "present",
            windows: Object.freeze([]),
        });
    }
}
/**
 * 已归档 Demand 的候选：看板上 archived 的需求包指向的 Demand，以及因取消而 withdrawn
 * （原因 `demand-cancelled:<demandId>`，取消同样封归档包）的需求包指向的 Demand（gate-log
 * §13.130）；去掉此刻又活动的（续做后重开）。看板读不出就不知道有哪些候选，这一域因此读不出，
 * 而不是"没有"。
 */
function archivedDemandCandidates(board, demands) {
    if (board.value === null)
        fail("precondition-failed", "board-unavailable", "$archives");
    const active = new Set((demands.value ?? []).map((demand) => demand.demandId));
    return Object.freeze(board.value.states.flatMap((state) => {
        const candidate = terminalCandidateOf(state);
        return candidate === null || active.has(candidate.demandId) ? [] : [candidate];
    }));
}
function terminalCandidateOf(state) {
    if (state.status === "archived" && state.archive !== null) {
        return Object.freeze({ demandId: state.archive.demandId, archivedAt: state.archive.archivedAt });
    }
    if (state.status === "withdrawn" &&
        state.withdrawal !== null &&
        state.claim !== null &&
        state.withdrawal.reason === `demand-cancelled:${state.claim.demandId}`) {
        return Object.freeze({
            demandId: state.claim.demandId,
            archivedAt: state.withdrawal.withdrawnAt,
        });
    }
    return null;
}
function worktreePodIdsOf(snapshot) {
    return new Set(snapshot.model.pods.filter((pod) => pod.placement === "worktree").map((pod) => pod.podId));
}
function observedAtOf(clock) {
    try {
        return readUtcWallClock(clock);
    }
    catch (error) {
        fail("unexpected", "clock", "$clock", { cause: error });
    }
}
// ---- 组合 ----------------------------------------------------------------------
/** 一次观察：各域独立读取；`projection` 作用域不读宿主域。 */
export async function observeWorkspace(root, snapshot, ledgerRoot, options) {
    const { signal, scope } = options;
    const observedAt = observedAtOf(options.clock);
    const layout = await observeDomain("layout", () => inspectActiveLayout(root, signalOptions(signal)));
    const board = await observeDomain("board", () => observeBoard(root, signal));
    const demands = await observeDomain("demands", () => observeDemands(root, ledgerRoot, signal));
    const claims = await observeDomain("claims", () => observeClaims(root, signal));
    const bindings = [];
    const hooks = [];
    const projections = [];
    const assets = [];
    if (scope === "full") {
        for (const host of options.hosts) {
            bindings.push(await observeHostBindings(root, snapshot, host, signal));
            hooks.push(await observeHostHooks(root, host.hostId, host.hostId === options.currentHostId, signal));
            projections.push(await observeHostProjections(root, snapshot, host, host.hostId === options.currentHostId, signal));
            assets.push(await observeHostAsset(root, host, options.currentHostId, signal));
        }
    }
    const pods = await observeDomain("pods", () => observePods(root, snapshot, bindings, demands.value ?? [], scope, signal));
    const repositories = scope === "full"
        ? await observeDomain("repositories", () => observeRepositories(snapshot, signal))
        : Object.freeze({ status: "unavailable", issue: "scope:projection", value: null });
    const archives = scope === "full"
        ? await observeDomain("archives", () => observeArchivedDemands(ledgerRoot, archivedDemandCandidates(board, demands), worktreePodIdsOf(snapshot), signal))
        : Object.freeze({ status: "unavailable", issue: "scope:projection", value: null });
    return Object.freeze({
        observedAt,
        scope,
        snapshot,
        configDigest: snapshot.configDigest,
        policy: WAKEFLOW_OBSERVATION_POLICY,
        layout,
        board,
        demands,
        claims,
        bindings: Object.freeze(bindings),
        hooks: Object.freeze(hooks),
        projections: Object.freeze(projections),
        pods,
        repositories,
        archives,
        assets: Object.freeze(assets),
    });
}
/** 声明是否孤儿：持有者不是活动 Demand，或窗口当前绑定不是声明记下的那一代。 */
export function orphanWorkClaims(observation) {
    const activeDemandIds = new Set((observation.demands.value ?? [])
        .filter((demand) => demand.loaded?.aggregate.state.lifecycle === "active")
        .map((demand) => demand.demandId));
    const bindingIds = new Set(observation.bindings.flatMap((host) => host.bindings.map((binding) => binding.bindingId)));
    const bindingsObserved = observation.scope === "full" && observation.bindings.every((host) => host.status === "observed");
    return Object.freeze((observation.claims.value?.claims ?? []).filter((claim) => !activeDemandIds.has(claim.holder.demandId) ||
        (bindingsObserved && !bindingIds.has(claim.bindingId))));
}
/**
 * 总体：配置或布局读不到即 maintenance；任一活动 Demand blocked 或 awaiting-decision、
 * 或 closing 中的 pod 仍有绑定或检出即 blocked；任一域不可用、hook 通道有读不出的记录、
 * 存在孤儿声明即 degraded；有活动 Demand 即 active；否则 idle（§13.94 D1）。
 */
export function deriveOverallStatus(observation) {
    if (observation.layout.status !== "observed" || observation.layout.value?.status !== "current") {
        return "maintenance";
    }
    const demands = observation.demands.value ?? [];
    const blockedDemand = demands.some((demand) => demand.route?.disposition === "blocked" || demand.route?.disposition === "awaiting-decision");
    const blockedPod = (observation.pods.value ?? []).some((pod) => pod.state === "closing");
    if (blockedDemand || blockedPod)
        return "blocked";
    const domainsUnavailable = [observation.board, observation.demands, observation.claims, observation.pods].some((domain) => domain.status !== "observed") ||
        (observation.scope === "full" && observation.repositories.status !== "observed") ||
        observation.bindings.some((host) => host.status !== "observed") ||
        observation.hooks.some((host) => host.status !== "observed") ||
        observation.projections.some((host) => host.status !== "observed");
    const degraded = domainsUnavailable ||
        demands.some((demand) => demand.status !== "observed") ||
        observation.hooks.some((host) => host.skipped > 0) ||
        (observation.board.value?.skipped ?? 0) > 0 ||
        orphanWorkClaims(observation).length > 0;
    if (degraded)
        return "degraded";
    return demands.some((demand) => demand.loaded?.aggregate.state.lifecycle === "active")
        ? "active"
        : "idle";
}
