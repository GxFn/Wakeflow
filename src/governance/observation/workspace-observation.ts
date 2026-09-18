import type { WakeflowConfigAuthoritySnapshot } from "../../configuration/wakeflow-config-authority-snapshot.js";
import type { WakeflowConfigPod } from "../../configuration/wakeflow-config-v3.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { WakeflowHostId } from "../../contracts/vocabulary/wakeflow-host-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest, type Sha256Digest } from "../../foundation/crypto/sha256.js";
import { JsonValueError, parseJsonValue, type JsonValue } from "../../foundation/data/json-value.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectoryError,
  type RootedDirectory,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../../foundation/filesystem/stable-directory-read.js";
import {
  readStableFile,
  readStableFileDigest,
  StableFileReadError,
} from "../../foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { decodeUtf8, encodeUtf8 } from "../../foundation/text/utf8.js";
import type { UtcInstant } from "../../foundation/time/utc-instant.js";
import { readUtcWallClock, type UtcWallClock } from "../../foundation/time/wall-clock.js";
import {
  inspectActiveLayout,
  type ActiveLayoutInspection,
} from "../../kernel/active-projection.js";
import { fail, WakeflowError } from "../../kernel/error.js";
import {
  HOST_HOOK_DIRECTORY_MAXIMUM_ENTRIES,
  readHostHookObservations,
  type HostHookEvent,
} from "../../kernel/hook-observations.js";
import {
  hostHookObservationsRootRef,
  hostRuntimeRootRef,
  REQUIREMENT_BOARD_INDEX_REF,
  WAKEFLOW_ACTIVE_CURRENT_ROOT_REF,
  WORK_CLAIMS_ROOT_REF,
} from "../../kernel/layout.js";
import {
  listPodWorktreeReceiptsAnyHost,
  worktreeCheckoutPresent,
  type PodWorktreeReceipt,
} from "../../kernel/pod-worktree-receipts.js";
import {
  listRequirementClaimStates,
  renderRequirementBoardIndex,
  type RequirementClaimState,
} from "../../kernel/requirement-board.js";
import { inspectWorkClaim, type WorkClaim } from "../../kernel/work-claims.js";
import type { WakeflowWindowHostBinding } from "../../workspace/window-runtime/wakeflow-window-host-binding.js";
import {
  inspectWakeflowWindowHostBindingInventory,
  WakeflowWindowHostBindingStoreError,
} from "../../workspace/window-runtime/wakeflow-window-host-binding-store.js";
import { compileWakeflowWindowHostBindingStoreAuthority } from "../../workspace/window-runtime/wakeflow-window-host-binding-store-authority.js";
import type { WakeflowWindowHostIdentityProfile } from "../../workspace/window-runtime/wakeflow-window-host-identity-profile.js";
import type { WakeflowWorkspaceHostResourceProfile } from "../../workspace/workspace-host-resource-profile.js";
import { buildDemandControllerRoute, type DemandControllerRoute } from "../controller/demand-controller-route.js";
import {
  closeDemandOperationRoot,
  openDemandOperationRoot,
} from "../demand/demand-operation-authority-context.js";
import {
  loadDemandEventSourcingRootAuthority,
  type LoadedDemandEventSourcingRootAuthority,
} from "../demand/event-sourcing/demand-event-sourcing-root-authority.js";
import { LedgerAuthorityStore } from "../ledger/ledger-authority-store.js";
import { derivePodState, type PodState } from "../pod/pod-state.js";
import {
  readDemandResultReviewSnapshot,
  type DemandResultReviewSnapshot,
} from "../review/demand-result-review-snapshot.js";
import { WAKEFLOW_OBSERVATION_POLICY, type WakeflowObservationPolicy } from "./observation-policy.js";
import {
  observeRepositoryPointers,
  type RepositoryPointerObservation,
} from "./repository-pointer-observation.js";

/**
 * Wakeflow Governance / Observation：一次观察，多份投影（能力卡 9 §9.1，gate-log §13.94 D4）。
 *
 * 每个域独立读取并隔离失败：读不出只让该域 `unavailable` 并带 issue，其他域照常；中止一律上抛。
 * status、verify 与活动投影都从同一份观察记录派生。`projection` 作用域只读投影需要的域
 * （配置、看板、Demand、pod 回执），不需要宿主 profile；`full` 作用域另读绑定、hook 通道、
 * 仓库指针、状态栏资产与投影目标。观察不写任何东西。
 */

export interface ObservationHost {
  readonly hostId: WakeflowHostId;
  readonly resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly identityProfile: Readonly<WakeflowWindowHostIdentityProfile>;
  /** 状态栏资产的期望字节摘要与本地设置里的期望条目；没有该表面的宿主为 null。 */
  readonly statuslineAsset: Readonly<{
    readonly fileName: string;
    readonly digest: Sha256Digest;
    readonly settings: Readonly<{
      /** 本地设置文件（忽略的私有文件，0600）。 */
      readonly path: PortableResourcePath;
      readonly key: string;
      /** 期望条目由工作区绝对根派生：命令行带 base64url 的根（§13.94 D6）。 */
      readonly expectedEntry: (workspaceRoot: string) => JsonValue;
    }>;
  }> | null;
}

export interface ObservedDomain<Value> {
  readonly status: "observed" | "unavailable";
  readonly issue: string | null;
  readonly value: Value | null;
}

export interface ObservedBoard {
  readonly states: readonly RequirementClaimState[];
  readonly skipped: number;
  readonly counts: Readonly<Record<RequirementClaimState["status"], number>>;
  /** 磁盘索引的摘要；缺失为 null。 */
  readonly indexDigest: Sha256Digest | null;
  /** 按当前状态重渲染的索引摘要。 */
  readonly expectedIndexDigest: Sha256Digest;
}

export interface ObservedDemand {
  readonly demandId: string;
  readonly status: "observed" | "unavailable";
  readonly issue: string | null;
  readonly loaded: Readonly<LoadedDemandEventSourcingRootAuthority> | null;
  readonly reviewSnapshot: Readonly<DemandResultReviewSnapshot> | null;
  readonly route: Readonly<DemandControllerRoute> | null;
}

export interface ObservedClaims {
  readonly claims: readonly Readonly<WorkClaim>[];
  readonly unreadable: number;
}

export interface ObservedHostBindings {
  readonly hostId: WakeflowHostId;
  readonly status: "observed" | "unavailable";
  readonly issue: string | null;
  readonly bindings: readonly Readonly<WakeflowWindowHostBinding>[];
}

export interface ObservedHostHooks {
  readonly hostId: WakeflowHostId;
  /** 是否当前制品的宿主：只有它的"目录缺席 / 零记录"值得 verify 报出来（§13.97 D10）。 */
  readonly current: boolean;
  readonly status: "observed" | "unavailable";
  readonly issue: string | null;
  /** 观察目录：不存在、模式正确、或模式不对。 */
  readonly directory: "absent" | "private" | "mode";
  readonly records: number;
  readonly skipped: number;
  readonly latestBySession: ReadonlyMap<
    string,
    Readonly<{ readonly event: HostHookEvent; readonly recordedAt: UtcInstant }>
  >;
}

export interface ObservedPodReceipt {
  readonly receipt: Readonly<PodWorktreeReceipt>;
  readonly checkoutPresent: boolean;
}

export interface ObservedPod {
  readonly pod: WakeflowConfigPod;
  readonly windowIds: readonly string[];
  readonly boundWindowIds: readonly string[];
  readonly receipts: readonly Readonly<ObservedPodReceipt>[];
  /** 绑定未观察（projection 作用域）时为 null。 */
  readonly state: PodState | null;
  readonly activeDemandId: string | null;
}

export interface ObservedHostAsset {
  readonly hostId: WakeflowHostId;
  readonly status: "current" | "missing" | "drift" | "mode" | "not-applicable" | "unavailable";
  /** 本地设置里的状态栏条目：缺文件 missing，键不等 drift，文件不是 JSON 对象或读不出 unreadable。 */
  readonly settings: "current" | "missing" | "drift" | "mode" | "unreadable" | "not-applicable";
  readonly issue: string | null;
}

export interface WorkspaceObservation {
  readonly observedAt: UtcInstant;
  readonly scope: "projection" | "full";
  readonly snapshot: Readonly<WakeflowConfigAuthoritySnapshot>;
  readonly configDigest: Sha256Digest;
  readonly policy: Readonly<WakeflowObservationPolicy>;
  readonly layout: ObservedDomain<Readonly<ActiveLayoutInspection>>;
  readonly board: ObservedDomain<Readonly<ObservedBoard>>;
  readonly demands: ObservedDomain<readonly Readonly<ObservedDemand>[]>;
  readonly claims: ObservedDomain<Readonly<ObservedClaims>>;
  readonly bindings: readonly Readonly<ObservedHostBindings>[];
  readonly hooks: readonly Readonly<ObservedHostHooks>[];
  readonly pods: ObservedDomain<readonly Readonly<ObservedPod>[]>;
  readonly repositories: ObservedDomain<readonly Readonly<RepositoryPointerObservation>[]>;
  readonly assets: readonly Readonly<ObservedHostAsset>[];
}

export interface ObserveWorkspaceOptions {
  readonly hosts: readonly Readonly<ObservationHost>[];
  /** 当前制品的宿主：状态栏资产只对它核对，别的宿主的资产由别的制品维护。 */
  readonly currentHostId: WakeflowHostId | null;
  readonly scope: "projection" | "full";
  readonly signal?: AbortSignal;
  readonly clock?: UtcWallClock;
}

export type WorkspaceOverallStatus = "maintenance" | "blocked" | "degraded" | "active" | "idle";

const DIRECTORY_MAXIMUM_ENTRIES = 4096;
/** 等于内核 hook 目录的列举上限：可见集合由保留策略而不是读取上限决定（§13.97 D7）。 */
const HOOK_RECORDS_MAXIMUM = HOST_HOOK_DIRECTORY_MAXIMUM_ENTRIES;
const ASSET_MAXIMUM_BYTES = parseByteCount(256 * 1024, "$asset.maximumBytes");
const SETTINGS_MAXIMUM_BYTES = parseByteCount(1024 * 1024, "$settings.maximumBytes");
const INDEX_MAXIMUM_BYTES = parseByteCount(4 * 1024 * 1024, "$boardIndex.maximumBytes");
const DEMAND_DIRECTORY_PATTERN =
  /^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CLAIM_FILE_PATTERN =
  /^(window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/u;

type Signal = { readonly signal?: AbortSignal };

function signalOptions(signal: AbortSignal | undefined): Signal {
  return signal === undefined ? {} : { signal };
}

function reasonOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const reason = (error as { readonly reason?: unknown }).reason;
  return typeof reason === "string" ? reason : null;
}

/** 隔离一个域的失败：带原因的领域或基础错误只让该域不可用，中止一律上抛。 */
async function observeDomain<Value>(
  name: string,
  read: () => Promise<Value>,
): Promise<ObservedDomain<Value>> {
  try {
    return Object.freeze({ status: "observed" as const, issue: null, value: await read() });
  } catch (error: unknown) {
    const reason = reasonOf(error);
    if (reason === null) throw error;
    if (reason === "aborted") {
      if (error instanceof WakeflowError) throw error;
      fail("io-failure", "aborted", "$signal", { cause: error });
    }
    return Object.freeze({ status: "unavailable" as const, issue: `${name}:${reason}`, value: null });
  }
}

// ---- 各域 ----------------------------------------------------------------------

async function observeBoard(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<ObservedBoard>> {
  const listing = await listRequirementClaimStates(root, signal);
  const counts = { pending: 0, parked: 0, claimed: 0, withdrawn: 0, archived: 0 };
  for (const state of listing.states) counts[state.status] += 1;
  let indexDigest: Sha256Digest | null = null;
  try {
    indexDigest = (
      await readStableFileDigest(root, REQUIREMENT_BOARD_INDEX_REF, {
        maximumBytes: INDEX_MAXIMUM_BYTES,
        ...signalOptions(signal),
      })
    ).digest;
  } catch (error: unknown) {
    if (!(error instanceof StableFileReadError) || error.reason === "aborted") throw error;
  }
  return Object.freeze({
    states: listing.states,
    skipped: listing.skipped,
    counts: Object.freeze(counts),
    indexDigest,
    expectedIndexDigest: computeSha256Digest(
      encodeUtf8(renderRequirementBoardIndex(listing.states), "$boardIndex"),
      "$boardIndex",
    ),
  });
}

async function listActiveDemandIds(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<readonly string[]> {
  try {
    const listing = await readStableResourceDirectory(root, WAKEFLOW_ACTIVE_CURRENT_ROOT_REF, {
      maximumEntries: DIRECTORY_MAXIMUM_ENTRIES,
      ...signalOptions(signal),
    });
    return listing.entries
      .filter((entry) => entry.node.kind === "directory" && DEMAND_DIRECTORY_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError && error.reason === "not-found") return [];
    throw error;
  }
}

async function observeDemand(
  root: RootedDirectory,
  store: LedgerAuthorityStore,
  demandId: string,
  signal: AbortSignal | undefined,
): Promise<Readonly<ObservedDemand>> {
  let demandRoot: RootedDirectory | null = null;
  try {
    demandRoot = await openDemandOperationRoot(root, demandId as WakeflowDurableId<"demand">);
    const loaded = await loadDemandEventSourcingRootAuthority(demandRoot, store, signalOptions(signal));
    const reviewSnapshot = await readDemandResultReviewSnapshot(demandRoot, signalOptions(signal));
    const route = buildDemandControllerRoute(loaded, reviewSnapshot);
    return Object.freeze({ demandId, status: "observed" as const, issue: null, loaded, reviewSnapshot, route });
  } catch (error: unknown) {
    const reason = reasonOf(error);
    if (reason === null) throw error;
    if (reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    return Object.freeze({
      demandId,
      status: "unavailable" as const,
      issue: reason,
      loaded: null,
      reviewSnapshot: null,
      route: null,
    });
  } finally {
    if (demandRoot !== null) await closeDemandOperationRoot(demandRoot);
  }
}

async function observeDemands(
  root: RootedDirectory,
  ledgerRoot: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<readonly Readonly<ObservedDemand>[]> {
  const store = new LedgerAuthorityStore(ledgerRoot);
  const demands: Readonly<ObservedDemand>[] = [];
  for (const demandId of await listActiveDemandIds(root, signal)) {
    demands.push(await observeDemand(root, store, demandId, signal));
  }
  return Object.freeze(demands);
}

async function observeClaims(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<ObservedClaims>> {
  let names: readonly string[];
  try {
    const listing = await readStableResourceDirectory(root, WORK_CLAIMS_ROOT_REF, {
      maximumEntries: DIRECTORY_MAXIMUM_ENTRIES,
      ...signalOptions(signal),
    });
    names = listing.entries.filter((entry) => entry.node.kind === "file").map((entry) => entry.name);
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError && error.reason === "not-found") {
      return Object.freeze({ claims: Object.freeze([]), unreadable: 0 });
    }
    throw error;
  }
  const claims: Readonly<WorkClaim>[] = [];
  let unreadable = 0;
  for (const name of [...names].sort()) {
    const match = CLAIM_FILE_PATTERN.exec(name);
    if (match?.[1] === undefined) {
      unreadable += 1;
      continue;
    }
    try {
      const inspected = await inspectWorkClaim(root, match[1], signalOptions(signal));
      if (inspected.claim !== null) claims.push(inspected.claim);
    } catch (error: unknown) {
      if (reasonOf(error) === "aborted") throw error;
      unreadable += 1;
    }
  }
  return Object.freeze({ claims: Object.freeze(claims), unreadable });
}

/** 宿主运行时尚未物化（该宿主的制品还没初始化过本工作区）：该宿主没有绑定，不是读失败。 */
async function bindingRootAbsent(
  root: RootedDirectory,
  bindingRootRef: PortableResourcePath,
): Promise<boolean> {
  try {
    await root.inspectExistingResource(bindingRootRef, "$bindings");
    return false;
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError && error.reason === "resource-not-found") return true;
    throw error;
  }
}

async function observeHostBindings(
  root: RootedDirectory,
  snapshot: Readonly<WakeflowConfigAuthoritySnapshot>,
  host: Readonly<ObservationHost>,
  signal: AbortSignal | undefined,
): Promise<Readonly<ObservedHostBindings>> {
  try {
    const authority = compileWakeflowWindowHostBindingStoreAuthority(
      snapshot.model,
      host.resourceProfile,
      host.identityProfile,
    );
    if (await bindingRootAbsent(root, authority.bindingRootRef)) {
      return Object.freeze({
        hostId: host.hostId,
        status: "observed" as const,
        issue: null,
        bindings: Object.freeze([]),
      });
    }
    const inventory = await inspectWakeflowWindowHostBindingInventory(
      root,
      authority,
      signalOptions(signal),
    );
    return Object.freeze({
      hostId: host.hostId,
      status: "observed" as const,
      issue: null,
      bindings: inventory.bindings,
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingStoreError && error.reason === "aborted") {
      fail("io-failure", "aborted", "$signal", { cause: error });
    }
    const reason = reasonOf(error);
    if (reason === null) throw error;
    return Object.freeze({
      hostId: host.hostId,
      status: "unavailable" as const,
      issue: reason,
      bindings: Object.freeze([]),
    });
  }
}

async function hookDirectoryState(
  root: RootedDirectory,
  hostId: WakeflowHostId,
): Promise<ObservedHostHooks["directory"]> {
  try {
    const node = (await root.inspectExistingResource(hostHookObservationsRootRef(hostId), "$hooks"))
      .node;
    return node.kind === "directory" && node.permissionBits === 0o700 ? "private" : "mode";
  } catch (error: unknown) {
    if (reasonOf(error) === "resource-not-found") return "absent";
    throw error;
  }
}

async function observeHostHooks(
  root: RootedDirectory,
  hostId: WakeflowHostId,
  current: boolean,
  signal: AbortSignal | undefined,
): Promise<Readonly<ObservedHostHooks>> {
  try {
    const directory = await hookDirectoryState(root, hostId);
    const inventory = await readHostHookObservations(
      root,
      hostId,
      { limit: HOOK_RECORDS_MAXIMUM },
      signalOptions(signal),
    );
    const latestBySession = new Map<
      string,
      Readonly<{ readonly event: HostHookEvent; readonly recordedAt: UtcInstant }>
    >();
    for (const record of inventory.records) {
      const previous = latestBySession.get(record.sessionId);
      if (previous === undefined || previous.recordedAt <= record.recordedAt) {
        latestBySession.set(record.sessionId, { event: record.event, recordedAt: record.recordedAt });
      }
    }
    return Object.freeze({
      hostId,
      current,
      status: "observed" as const,
      issue: null,
      directory,
      records: inventory.records.length,
      skipped: inventory.skipped,
      latestBySession,
    });
  } catch (error: unknown) {
    const reason = reasonOf(error);
    if (reason === null) throw error;
    if (reason === "aborted") {
      if (error instanceof WakeflowError) throw error;
      fail("io-failure", "aborted", "$signal", { cause: error });
    }
    return Object.freeze({
      hostId,
      current,
      status: "unavailable" as const,
      issue: reason,
      directory: "absent" as const,
      records: 0,
      skipped: 0,
      latestBySession: new Map(),
    });
  }
}

async function observePods(
  root: RootedDirectory,
  snapshot: Readonly<WakeflowConfigAuthoritySnapshot>,
  bindings: readonly Readonly<ObservedHostBindings>[],
  demands: readonly Readonly<ObservedDemand>[],
  scope: ObserveWorkspaceOptions["scope"],
  signal: AbortSignal | undefined,
): Promise<readonly Readonly<ObservedPod>[]> {
  const bindingIdByWindowId = new Map<string, string>();
  for (const host of bindings) {
    for (const binding of host.bindings) {
      if (!bindingIdByWindowId.has(binding.windowId)) {
        bindingIdByWindowId.set(binding.windowId, binding.bindingId);
      }
    }
  }
  const bindingsObserved = scope === "full" && bindings.every((host) => host.status === "observed");
  const pods: Readonly<ObservedPod>[] = [];
  for (const pod of snapshot.model.pods) {
    const windowIds = (snapshot.indexes.podScopes[pod.podId]?.windows ?? []).map(
      (window) => window.windowId,
    );
    const stored = await listPodWorktreeReceiptsAnyHost(root, pod.podId, signalOptions(signal));
    const receipts: Readonly<ObservedPodReceipt>[] = [];
    for (const receipt of stored) {
      receipts.push(Object.freeze({ receipt, checkoutPresent: await worktreeCheckoutPresent(receipt) }));
    }
    const state = bindingsObserved
      ? derivePodState({
          pod,
          windowIds,
          bindingIdByWindowId,
          receipts: receipts.map((entry) =>
            Object.freeze({
              repositoryId: entry.receipt.repositoryId,
              windowId: entry.receipt.windowId,
              bindingId: entry.receipt.bindingId,
              checkoutPresent: entry.checkoutPresent,
            }),
          ),
        })
      : null;
    const active = demands.find(
      (demand) =>
        demand.loaded?.identity.podId === pod.podId &&
        demand.loaded.aggregate.state.lifecycle === "active",
    );
    pods.push(
      Object.freeze({
        pod,
        windowIds: Object.freeze(windowIds),
        boundWindowIds: Object.freeze(windowIds.filter((id) => bindingIdByWindowId.has(id))),
        receipts: Object.freeze(receipts),
        state,
        activeDemandId: active?.demandId ?? null,
      }),
    );
  }
  return Object.freeze(pods);
}

async function observeRepositories(
  snapshot: Readonly<WakeflowConfigAuthoritySnapshot>,
  signal: AbortSignal | undefined,
): Promise<readonly Readonly<RepositoryPointerObservation>[]> {
  const observations: Readonly<RepositoryPointerObservation>[] = [];
  for (const repository of snapshot.model.topology.repositories) {
    const placement = snapshot.placements.roots.find(
      (entry) => entry.key === `repository.${repository.repositoryId}.root`,
    );
    if (placement === undefined || placement.state !== "present" || placement.realPath === null) {
      observations.push(
        Object.freeze({
          repositoryId: repository.repositoryId,
          status: "unavailable" as const,
          issue: "root-missing",
          head: null,
          branch: null,
          detached: false,
          branches: Object.freeze([]),
          worktrees: Object.freeze([]),
        }),
      );
      continue;
    }
    observations.push(
      await observeRepositoryPointers({
        repositoryId: repository.repositoryId,
        absolutePath: placement.realPath,
        ...signalOptions(signal),
      }),
    );
  }
  return Object.freeze(observations);
}

type AssetFileStatus = Exclude<ObservedHostAsset["status"], "not-applicable">;
type SettingsEntryStatus = Exclude<ObservedHostAsset["settings"], "not-applicable">;

async function observeAssetFile(
  root: RootedDirectory,
  host: Readonly<ObservationHost>,
  asset: NonNullable<ObservationHost["statuslineAsset"]>,
  signal: AbortSignal | undefined,
): Promise<Readonly<{ readonly status: AssetFileStatus; readonly issue: string | null }>> {
  const ref = parsePortableResourcePath(
    `${hostRuntimeRootRef(host.hostId)}/operations/assets/${asset.fileName}`,
    "$asset",
  );
  try {
    const read = await readStableFile(root, ref, {
      maximumBytes: ASSET_MAXIMUM_BYTES,
      ...signalOptions(signal),
    });
    if (read.node.permissionBits !== 0o600) return Object.freeze({ status: "mode", issue: null });
    return Object.freeze({
      status: read.digest === asset.digest ? "current" : "drift",
      issue: null,
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError && error.reason === "not-found") {
      return Object.freeze({ status: "missing", issue: null });
    }
    const reason = reasonOf(error);
    if (reason === null) throw error;
    if (reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    return Object.freeze({ status: "unavailable", issue: reason });
  }
}

function settingsEntryOf(bytes: Uint8Array, key: string): unknown {
  try {
    const document: unknown = JSON.parse(decodeUtf8(bytes, "$settings"));
    if (typeof document !== "object" || document === null || Array.isArray(document)) return null;
    return (document as Record<string, unknown>)[key] ?? null;
  } catch {
    return null;
  }
}

/** 本地设置里的状态栏条目：只比较该键的规范 JSON，其他键不看；文件不是 JSON 对象即 unreadable。 */
async function observeSettingsEntry(
  root: RootedDirectory,
  settings: NonNullable<ObservationHost["statuslineAsset"]>["settings"],
  signal: AbortSignal | undefined,
): Promise<SettingsEntryStatus> {
  try {
    const read = await readStableFile(root, settings.path, {
      maximumBytes: SETTINGS_MAXIMUM_BYTES,
      ...signalOptions(signal),
    });
    const entry = settingsEntryOf(read.bytes, settings.key);
    if (entry === null) return "unreadable";
    if (read.node.permissionBits !== 0o600) return "mode";
    const expected = settings.expectedEntry(root.absolutePath);
    return computeCanonicalJsonSha256Digest(parseJsonValue(entry, "$settings"))
      === computeCanonicalJsonSha256Digest(expected)
      ? "current"
      : "drift";
  } catch (error: unknown) {
    if (error instanceof JsonValueError) return "unreadable";
    if (error instanceof StableFileReadError && error.reason === "not-found") return "missing";
    const reason = reasonOf(error);
    if (reason === null) throw error;
    if (reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    return "unreadable";
  }
}

async function observeHostAsset(
  root: RootedDirectory,
  host: Readonly<ObservationHost>,
  currentHostId: WakeflowHostId | null,
  signal: AbortSignal | undefined,
): Promise<Readonly<ObservedHostAsset>> {
  if (host.statuslineAsset === null || host.hostId !== currentHostId) {
    return Object.freeze({
      hostId: host.hostId,
      status: "not-applicable" as const,
      settings: "not-applicable" as const,
      issue: null,
    });
  }
  const asset = await observeAssetFile(root, host, host.statuslineAsset, signal);
  const settings = await observeSettingsEntry(root, host.statuslineAsset.settings, signal);
  return Object.freeze({ hostId: host.hostId, status: asset.status, settings, issue: asset.issue });
}

function observedAtOf(clock: UtcWallClock | undefined): UtcInstant {
  try {
    return readUtcWallClock(clock);
  } catch (error: unknown) {
    fail("unexpected", "clock", "$clock", { cause: error });
  }
}

// ---- 组合 ----------------------------------------------------------------------

/** 一次观察：各域独立读取；`projection` 作用域不读宿主域。 */
export async function observeWorkspace(
  root: RootedDirectory,
  snapshot: Readonly<WakeflowConfigAuthoritySnapshot>,
  ledgerRoot: RootedDirectory,
  options: Readonly<ObserveWorkspaceOptions>,
): Promise<Readonly<WorkspaceObservation>> {
  const { signal, scope } = options;
  const observedAt = observedAtOf(options.clock);
  const layout = await observeDomain("layout", () => inspectActiveLayout(root, signalOptions(signal)));
  const board = await observeDomain("board", () => observeBoard(root, signal));
  const demands = await observeDomain("demands", () => observeDemands(root, ledgerRoot, signal));
  const claims = await observeDomain("claims", () => observeClaims(root, signal));
  const bindings: Readonly<ObservedHostBindings>[] = [];
  const hooks: Readonly<ObservedHostHooks>[] = [];
  const assets: Readonly<ObservedHostAsset>[] = [];
  if (scope === "full") {
    for (const host of options.hosts) {
      bindings.push(await observeHostBindings(root, snapshot, host, signal));
      hooks.push(
        await observeHostHooks(root, host.hostId, host.hostId === options.currentHostId, signal),
      );
      assets.push(await observeHostAsset(root, host, options.currentHostId, signal));
    }
  }
  const pods = await observeDomain("pods", () =>
    observePods(root, snapshot, bindings, demands.value ?? [], scope, signal),
  );
  const repositories =
    scope === "full"
      ? await observeDomain("repositories", () => observeRepositories(snapshot, signal))
      : Object.freeze({ status: "unavailable" as const, issue: "scope:projection", value: null });
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
    pods,
    repositories,
    assets: Object.freeze(assets),
  });
}

/** 声明是否孤儿：持有者不是活动 Demand，或窗口当前绑定不是声明记下的那一代。 */
export function orphanWorkClaims(
  observation: Readonly<WorkspaceObservation>,
): readonly Readonly<WorkClaim>[] {
  const activeDemandIds = new Set(
    (observation.demands.value ?? [])
      .filter((demand) => demand.loaded?.aggregate.state.lifecycle === "active")
      .map((demand) => demand.demandId),
  );
  const bindingIds = new Set<string>(
    observation.bindings.flatMap((host) => host.bindings.map((binding) => binding.bindingId)),
  );
  const bindingsObserved =
    observation.scope === "full" && observation.bindings.every((host) => host.status === "observed");
  return Object.freeze(
    (observation.claims.value?.claims ?? []).filter(
      (claim) =>
        !activeDemandIds.has(claim.holder.demandId) ||
        (bindingsObserved && !bindingIds.has(claim.bindingId)),
    ),
  );
}

/**
 * 总体：配置或布局读不到即 maintenance；任一活动 Demand blocked 或 awaiting-decision、
 * 或 closing 中的 pod 仍有绑定或检出即 blocked；任一域不可用、hook 通道有读不出的记录、
 * 存在孤儿声明即 degraded；有活动 Demand 即 active；否则 idle（§13.94 D1）。
 */
export function deriveOverallStatus(
  observation: Readonly<WorkspaceObservation>,
): WorkspaceOverallStatus {
  if (observation.layout.status !== "observed" || observation.layout.value?.status !== "current") {
    return "maintenance";
  }
  const demands = observation.demands.value ?? [];
  const blockedDemand = demands.some(
    (demand) =>
      demand.route?.disposition === "blocked" || demand.route?.disposition === "awaiting-decision",
  );
  const blockedPod = (observation.pods.value ?? []).some((pod) => pod.state === "closing");
  if (blockedDemand || blockedPod) return "blocked";
  const domainsUnavailable =
    [observation.board, observation.demands, observation.claims, observation.pods].some(
      (domain) => domain.status !== "observed",
    ) ||
    (observation.scope === "full" && observation.repositories.status !== "observed") ||
    observation.bindings.some((host) => host.status !== "observed") ||
    observation.hooks.some((host) => host.status !== "observed");
  const degraded =
    domainsUnavailable ||
    demands.some((demand) => demand.status !== "observed") ||
    observation.hooks.some((host) => host.skipped > 0) ||
    (observation.board.value?.skipped ?? 0) > 0 ||
    orphanWorkClaims(observation).length > 0;
  if (degraded) return "degraded";
  return demands.some((demand) => demand.loaded?.aggregate.state.lifecycle === "active")
    ? "active"
    : "idle";
}
