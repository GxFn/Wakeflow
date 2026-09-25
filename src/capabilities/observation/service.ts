import path from "node:path";

import {
  readWakeflowConfigAuthoritySnapshot,
  WAKEFLOW_CONFIG_FILE_REF,
  type WakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { WakeflowHostId } from "../../contracts/vocabulary/wakeflow-host-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  RootedDirectory,
  type RootedDirectoryDurability,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../../foundation/filesystem/stable-directory-read.js";
import type { UtcWallClock } from "../../foundation/time/wall-clock.js";
import {
  closeDemandOperationRoot,
  openDemandOperationRoot,
} from "../../governance/demand/demand-operation-authority-context.js";
import {
  demandWindowIds,
  evaluateVerifyGates,
  type VerifyReport,
} from "../../governance/demand/demand-verify-gates.js";
import { loadDemandEventSourcingRootAuthority } from "../../governance/demand/event-sourcing/demand-event-sourcing-root-authority.js";
import { inspectLedgerAuthorityLayout } from "../../governance/ledger/ledger-authority-layout.js";
import { LedgerAuthorityStore } from "../../governance/ledger/ledger-authority-store.js";
import {
  observeProjectionTargets,
  unmergedAcceptedFacts,
} from "../../governance/observation/active-projection-facts.js";
import { locateLatestDemandArchive } from "../../governance/observation/demand-archive-locator.js";
import {
  deriveOverallStatus,
  type ObservationHost,
  type ObservedDemand,
  type ObservedDomain,
  observeWorkspace,
  orphanWorkClaims,
  type WorkspaceObservation,
  type WorkspaceOverallStatus,
} from "../../governance/observation/workspace-observation.js";
import type { ActiveProjectionTargetInspection } from "../../kernel/active-projection.js";
import { commandShellExecutionOptions, runCommandShell } from "../../kernel/command-shell.js";
import { fail } from "../../kernel/error.js";
import { DEMAND_LIFECYCLE_JOURNALS_ROOT_REF } from "../../kernel/layout.js";
import { deriveNextProjection, type NextProjection } from "../../kernel/next-projection.js";
import { readRequirementClaimState } from "../../kernel/requirement-board.js";
import {
  inspectWakeflowPrivateModes,
  wakeflowPrivateModeAreas,
} from "../../workspace/maintenance/wakeflow-private-mode-census.js";
import { previewWakeflowStaticMaterialization } from "../../workspace/maintenance/wakeflow-static-materialization-preview.js";
import {
  inspectWakeflowWorkspaceCoreLayout,
  type WakeflowWorkspaceCoreLayoutInspection,
  WakeflowWorkspaceCoreLayoutInspectionError,
} from "../../workspace/maintenance/wakeflow-workspace-core-layout-inspection.js";
import {
  admitStatusResult,
  admitVerifyResult,
  parseStatusRequest,
  parseVerifyRequest,
  type StatusRequest,
  type StatusResult,
  type VerifyRequest,
  type VerifyResult,
  WAKEFLOW_OBSERVATION_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_STATUS_PUBLIC_TOOL_NAME,
  WAKEFLOW_VERIFY_PUBLIC_TOOL_NAME,
} from "./contract.js";
import {
  capStatusList,
  deriveNextActions,
  deriveWorkspaceGates,
  disposalGuidance,
  type NextActionInput,
  nextFromActions,
  projectionFreshness,
  STATUS_LIST_MAXIMUMS,
  summarizeGates,
  type VerifyGateStatus,
  verifyNext,
  type WorkspaceGateFacts,
} from "./decide.js";

/**
 * Wakeflow Capabilities / Observation：两个读工具的执行器（gate-log §13.94 D1、D3、D4）。
 *
 * 打开上下文时就完成一次观察（绑定句柄、hook 会话、worktree 路径由此进入脱敏边界）；主体只把
 * 观察记录压成公共投影。status 与 verify 各自观察一次，不设跨调用令牌。verify 另做工作区级
 * 加读（配置复读、本地布局、ledger 布局、每个活动 Demand 的门），仍然零写。
 */

export interface ObservationHostFacade {
  readonly hostId: WakeflowHostId;
  /** 组合根固定提供的全部宿主：status 与 verify 读每个宿主的绑定、hook 通道与资产。 */
  readonly hosts: readonly Readonly<ObservationHost>[];
  /**
   * 本进程的制品身份（§13.127）：启动时的 manifest 摘要与"现在磁盘上是多少"的读法。
   * 缺省（测试、没有 manifest 的构建）时窗口的制品状态一律 unknown，门记 not-applicable。
   */
  readonly artifact?: Readonly<{
    readonly manifestDigest: Sha256Digest | null;
    readonly readCurrentManifestDigest: () => Sha256Digest | null;
  }>;
}

export interface ExecuteObservationOptions {
  /** 本次调用打开工作区根用的持久化级别；与 `clock` 同类的注入值，生产不传。 */
  readonly durability?: RootedDirectoryDurability;
  readonly clock?: UtcWallClock;
  readonly signal?: AbortSignal;
}

/**
 * 维护协议的状态（§13.129，旧实现的 maintenance 域与 maintenance-gate 门）：与维护工具的预览
 * 同一份核心布局检查——`idle` 才没有事情要做，`busy` 是另一次维护正在进行，`recovery-required`
 * 是一次被打断的 apply 留下了事务残留（intent、journal 或失活的锁），`conflict` 是锁不安全，
 * `absent` / `bootstrap-prefix` 是协议根尚未建好。verify 的 local-layout 门经预览已经报它
 * （`maintenance-protocol-<状态>`）；status 在这里把它变成 `overall: maintenance` 与下一步，
 * 让 Controller 不必等到下一次维护才发现。
 */
interface MaintenanceObservation {
  readonly status: "observed" | "unavailable";
  readonly protocol: WakeflowWorkspaceCoreLayoutInspection["local"]["status"] | "unknown";
  /** transactions 目录里的条目（§13.130）；检查读不出时为空。 */
  readonly residues: WakeflowWorkspaceCoreLayoutInspection["local"]["residues"];
}

/** status 的残留列表上限（wire 的 maxItems）；超出只报略去的条数。 */
const MAINTENANCE_RESIDUES_MAXIMUM = 64;
const RESIDUE_NAME_MAXIMUM = 128;

/**
 * 残留文件名进公共结果前单行化并有界（singleLineText 不收控制字符）：它是 Wakeflow 自有目录
 * 里的一个名字，不是路径，但名字本身可以是任何字节，所以只保留可打印字符。
 */
function residueDisplayName(name: string): string {
  let cleaned = "";
  for (const character of name) {
    const codePoint = character.codePointAt(0) ?? 0;
    cleaned += codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f) ? "?" : character;
  }
  const characters = [...cleaned];
  const bounded =
    characters.length > RESIDUE_NAME_MAXIMUM
      ? `${characters.slice(0, RESIDUE_NAME_MAXIMUM - 1).join("")}…`
      : cleaned;
  return bounded.trim().length === 0 ? "?" : bounded;
}

function maintenanceView(maintenance: Readonly<MaintenanceObservation>) {
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

interface SliceContext {
  readonly root: RootedDirectory;
  readonly snapshot: Readonly<WakeflowConfigAuthoritySnapshot>;
  readonly ledgerRoot: RootedDirectory;
  readonly facade: Readonly<ObservationHostFacade>;
  readonly options: ExecuteObservationOptions;
  readonly observation: Readonly<WorkspaceObservation>;
  /** 投影目标的分类，从同一份观察派生（观察之后单独一步，见 active-projection-facts）。 */
  readonly projection: ObservedDomain<readonly Readonly<ActiveProjectionTargetInspection>[]>;
  readonly maintenance: Readonly<MaintenanceObservation>;
}

type Envelope = Readonly<{ readonly root: string; readonly demandId?: string }>;

const PENDING_PACKAGES_MAXIMUM = 64;
const PRIORITY_ORDER: Readonly<Record<string, number>> = Object.freeze({
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
});
const DIRECTORY_MAXIMUM_ENTRIES = 4096;
const JOURNAL_FILE_PATTERN =
  /^(demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/u;

function signalOptions(signal: AbortSignal | undefined): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

function reasonOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const reason = (error as { readonly reason?: unknown }).reason;
  return typeof reason === "string" ? reason : null;
}

/**
 * verify 的加读把"域读不出"降级成 unavailable，但中止不是域故障：和 openContext 一样收敛成
 * `io-failure/aborted`，否则基础层的原始异常会在 MCP 信封里变成 `unexpected/unhandled`。
 */
function failIfAborted(error: unknown): void {
  if (reasonOf(error) === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
}

// ---- 上下文 ----------------------------------------------------------------------

async function readSnapshot(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowConfigAuthoritySnapshot>> {
  try {
    return await readWakeflowConfigAuthoritySnapshot(root, signalOptions(signal));
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      fail("precondition-failed", "config-authority", "$request.root", { cause: error });
    }
    throw error;
  }
}

async function openLedgerRoot(
  root: RootedDirectory,
  snapshot: Readonly<WakeflowConfigAuthoritySnapshot>,
): Promise<RootedDirectory> {
  const placement = snapshot.placements.roots.find((entry) => entry.key === "ledger.root");
  if (placement === undefined || placement.state !== "present" || placement.realPath === null) {
    fail("precondition-failed", "ledger-root-missing", "$request.root");
  }
  try {
    return await RootedDirectory.open(placement.absolutePath, "$ledgerRoot", {
      durability: root.durability,
    });
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      fail("precondition-failed", "ledger-root", "$request.root", { cause: error });
    }
    throw error;
  }
}

/** 检查读不出即 unavailable（不猜 idle），中止照常上抛；检查本身零写。 */
async function observeMaintenance(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<MaintenanceObservation>> {
  try {
    const core = await inspectWakeflowWorkspaceCoreLayout(root, signalOptions(signal));
    return Object.freeze({
      status: "observed" as const,
      protocol: core.local.status,
      residues: core.local.residues,
    });
  } catch (error: unknown) {
    if (!(error instanceof WakeflowWorkspaceCoreLayoutInspectionError)) throw error;
    failIfAborted(error);
    return Object.freeze({
      status: "unavailable" as const,
      protocol: "unknown" as const,
      residues: Object.freeze([]),
    });
  }
}

async function openContext(
  root: RootedDirectory,
  facade: Readonly<ObservationHostFacade>,
  options: ExecuteObservationOptions,
): Promise<SliceContext> {
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
  } catch (error: unknown) {
    await ledgerRoot.close();
    throw error;
  }
}

/** 非 idle 的维护协议压过其他一切（旧实现的 maintenance 状态）：先维护，再谈别的；读不出不算。 */
function maintenancePending(maintenance: Readonly<MaintenanceObservation>): boolean {
  return maintenance.status === "observed" && maintenance.protocol !== "idle";
}

function overallOf(context: SliceContext): WorkspaceOverallStatus {
  return maintenancePending(context.maintenance)
    ? "maintenance"
    : deriveOverallStatus(context.observation);
}

async function closeContext(context: SliceContext): Promise<void> {
  await context.ledgerRoot.close();
}

/** 观察里出现过的每个私有值都进脱敏边界：句柄、hook 会话、worktree 路径、放置根。 */
function privateValues(context: SliceContext): Iterable<string> {
  const values = new Set<string>([context.snapshot.ledgerRoot]);
  for (const entry of context.snapshot.placements.roots) {
    values.add(entry.absolutePath);
    if (entry.realPath !== null) values.add(entry.realPath);
  }
  for (const host of context.observation.bindings) {
    for (const binding of host.bindings) values.add(binding.handle.value);
  }
  for (const host of context.observation.hooks) {
    for (const sessionId of host.latestBySession.keys()) values.add(sessionId);
  }
  for (const pod of context.observation.pods.value ?? []) {
    for (const entry of pod.receipts) values.add(entry.receipt.path);
  }
  return values;
}

// ---- status ----------------------------------------------------------------------

function boardView(observation: Readonly<WorkspaceObservation>) {
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

function demandView(demand: Readonly<ObservedDemand>) {
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

interface WindowBindingView {
  readonly hostId: WakeflowHostId;
  readonly bindingId: string;
  readonly handleValue: string;
}

/** 窗口当前的绑定（任一宿主）；未登记为 null。 */
function windowBindingOf(
  observation: Readonly<WorkspaceObservation>,
  windowId: string,
): WindowBindingView | null {
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
function artifactStateOf(
  context: SliceContext,
  binding: WindowBindingView | null,
): "current" | "stale" | "unknown" {
  const own = context.facade.artifact?.manifestDigest ?? null;
  if (binding === null || own === null) return "unknown";
  const started = context.observation.hooks
    .find((entry) => entry.hostId === binding.hostId)
    ?.artifactBySession.get(binding.handleValue);
  if (started === undefined || started === null) return "unknown";
  return started === own ? "current" : "stale";
}

function staleArtifactWindowIds(context: SliceContext): readonly string[] {
  return context.snapshot.model.topology.windows
    .map((window) => window.windowId)
    .filter(
      (windowId) =>
        artifactStateOf(context, windowBindingOf(context.observation, windowId)) === "stale",
    );
}

/** 本进程脚下的制品是否已更新：启动时与现在磁盘上的 manifest 摘要不同。 */
function runtimeView(context: SliceContext) {
  const artifact = context.facade.artifact;
  const manifestDigest = artifact?.manifestDigest ?? null;
  const onDisk = artifact?.readCurrentManifestDigest() ?? null;
  return {
    artifactManifestDigest: manifestDigest,
    artifactOnDisk:
      manifestDigest === null || onDisk === null
        ? ("unknown" as const)
        : onDisk === manifestDigest
          ? ("same" as const)
          : ("changed" as const),
  };
}

function lastObservationOf(
  observation: Readonly<WorkspaceObservation>,
  binding: WindowBindingView | null,
) {
  if (binding === null) return null;
  const latest = observation.hooks
    .find((entry) => entry.hostId === binding.hostId)
    ?.latestBySession.get(binding.handleValue);
  return latest === undefined ? null : { event: latest.event, recordedAt: latest.recordedAt };
}

function claimViewOf(observation: Readonly<WorkspaceObservation>, windowId: string) {
  const claim = (observation.claims.value?.claims ?? []).find(
    (entry) => entry.windowId === windowId,
  );
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
function windowProjectionOf(
  observation: Readonly<WorkspaceObservation>,
  windowId: string,
): "current" | "stale" | "missing" | "unsafe" | "unavailable" {
  if (observation.projections.some((host) => host.status !== "observed")) return "unavailable";
  const statuses = observation.projections.flatMap((host) =>
    host.windows.filter((window) => window.windowId === windowId),
  );
  return statuses.length === 0 ? "unavailable" : projectionFreshness(statuses);
}

/** reconcile 能修的投影缺陷：缺失或过期；unsafe 只由 verify 报出。 */
function projectionsNeedRepair(observation: Readonly<WorkspaceObservation>): boolean {
  return observation.projections.some((host) =>
    host.windows.some((window) => window.status === "stale" || window.status === "missing"),
  );
}

function windowRuntimeDomainView(observation: Readonly<WorkspaceObservation>) {
  const unavailable = observation.projections.find((host) => host.status !== "observed");
  return unavailable === undefined
    ? { status: "observed" as const, issue: null }
    : {
        status: "unavailable" as const,
        issue: `${unavailable.hostId}:${unavailable.issue ?? "unavailable"}`,
      };
}

function windowViews(context: SliceContext) {
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

function claimViews(observation: Readonly<WorkspaceObservation>) {
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

function unmergedAcceptedViews(observation: Readonly<WorkspaceObservation>) {
  const all = [...unmergedAcceptedFacts(observation)].sort((left, right) => {
    const demand = left.demandId.localeCompare(right.demandId);
    if (demand !== 0) return demand;
    const target = left.targetTaskId.localeCompare(right.targetTaskId);
    return target !== 0 ? target : left.repositoryId.localeCompare(right.repositoryId);
  });
  return capStatusList(all, STATUS_LIST_MAXIMUMS.unmergedAccepted);
}

function podViews(context: SliceContext) {
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
      const receipt = pod.receipts.find(
        (entry) => entry.receipt.repositoryId === worktree.repositoryId,
      );
      const present = receipt?.checkoutPresent === true;
      return {
        repositoryId: worktree.repositoryId,
        receipt: receipt === undefined ? "absent" : present ? "present" : "checkout-missing",
        disposal:
          pod.pod.lifecycle === "closing" && present && receipt !== undefined
            ? disposalGuidance(
                facade.hostId,
                path.relative(root.absolutePath, receipt.receipt.path) || ".",
                receipt.receipt.locked,
              )
            : null,
      };
    }),
  }));
}

function repositoryViews(observation: Readonly<WorkspaceObservation>) {
  let omitted = 0;
  const all = (observation.repositories.value ?? []).map((repository) => {
    const worktrees = capStatusList(
      [...repository.worktrees].sort((left, right) => left.name.localeCompare(right.name)),
      STATUS_LIST_MAXIMUMS.worktrees,
    );
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
  const capped = capStatusList(
    [...all].sort((left, right) => left.repositoryId.localeCompare(right.repositoryId)),
    STATUS_LIST_MAXIMUMS.repositories,
  );
  return Object.freeze({
    entries: capped.entries,
    omitted: Object.freeze({ repositories: capped.omitted, worktrees: omitted }),
  });
}

function hookViews(observation: Readonly<WorkspaceObservation>) {
  return observation.hooks.map((host) => ({
    hostId: host.hostId,
    status: host.status,
    issue: host.issue,
    directory: host.directory,
    records: host.records,
    skipped: host.skipped,
  }));
}

function projectionView(projection: SliceContext["projection"]) {
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

function nextActionInput(context: SliceContext): Readonly<NextActionInput> {
  const { observation, snapshot } = context;
  const overall = overallOf(context);
  const bound = new Set(
    observation.bindings.flatMap((host) => host.bindings.map((binding) => binding.windowId)),
  );
  const bindingsObserved = observation.bindings.every((host) => host.status === "observed");
  const pods = observation.pods.value ?? [];
  const demands = (observation.demands.value ?? []).flatMap((demand) => {
    if (demand.route === null || demand.loaded === null) return [];
    const next = deriveNextProjection(demand.route);
    const placement =
      snapshot.indexes.podById[demand.loaded.identity.podId]?.placement ?? "worktree";
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
    unregisteredWindows:
      bindingsObserved && podsObserved
        ? snapshot.model.topology.windows
            .filter((window) => !bound.has(window.windowId))
            .map((window) => {
              const pod = pods.find((entry) => entry.pod.podId === window.podId);
              return {
                windowId: window.windowId,
                podId: window.podId,
                placement: pod?.pod.placement ?? "worktree",
                podActive:
                  pod !== undefined &&
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

async function routeSection(
  context: SliceContext,
  demandId: string | undefined,
): Promise<Readonly<{ route: unknown; archive: unknown; next: Readonly<NextProjection> | null }>> {
  if (demandId === undefined) return Object.freeze({ route: null, archive: null, next: null });
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
  const archive = await locateLatestDemandArchive(
    context.ledgerRoot,
    demandId,
    context.options.signal,
  );
  if (archive === null) fail("not-found", "demand-unknown", "$request.demandId");
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
    next:
      archive.outcome === "completed"
        ? Object.freeze({
            frontier: "demand-continuation",
            owner: "controller" as const,
            suggestedTool: "wakeflow_continue_demand",
            blockers: Object.freeze([]),
          })
        : Object.freeze({
            frontier: null,
            owner: "none" as const,
            suggestedTool: null,
            blockers: Object.freeze([]),
          }),
  });
}

/** 每个域的观察状态都要看得见（§13.94 D1）：空列表与"读不出"必须能分辨，而不是只有 overall 暗示。 */
function domainViews(context: SliceContext) {
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
function archivesDomainView(observation: Readonly<WorkspaceObservation>) {
  const archives = observation.archives;
  const unreadable = archives.value?.unreadable ?? 0;
  return {
    status: archives.status,
    issue: archives.issue ?? (unreadable > 0 ? `archives:unreadable-${unreadable}` : null),
  };
}

async function assembleStatus(
  context: SliceContext,
  request: StatusRequest,
): Promise<StatusResult> {
  const { observation, snapshot } = context;
  const actions = deriveNextActions(nextActionInput(context));
  const section = await routeSection(context, request.demandId);
  const claims = claimViews(observation);
  const repositories = repositoryViews(observation);
  const unmergedAccepted = unmergedAcceptedViews(observation);
  // 每个数组都有 wire 上限：越界的结果会被整份拒绝，所以先确定性排序再截断并报出略去的条数。
  const demands = capStatusList(
    [...(observation.demands.value ?? [])]
      .sort((left, right) => left.demandId.localeCompare(right.demandId))
      .map(demandView),
    STATUS_LIST_MAXIMUMS.demands,
  );
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
export async function executeStatusRequest(
  facade: Readonly<ObservationHostFacade>,
  value: unknown,
  options: ExecuteObservationOptions = {},
): Promise<StatusResult> {
  return runCommandShell<Envelope, StatusRequest, SliceContext, StatusResult>(
    {
      tool: WAKEFLOW_STATUS_PUBLIC_TOOL_NAME,
      parseRequest: (raw) => {
        const request = parseStatusRequest(raw);
        return { envelope: request, input: request };
      },
      open: (root) => openContext(root, facade, options),
      close: closeContext,
      privateValues,
    },
    value,
    () => undefined,
    (context, binding) => assembleStatus(context, binding.input),
    commandShellExecutionOptions(options.durability),
  );
}

// ---- verify ----------------------------------------------------------------------

async function configRecheck(context: SliceContext): Promise<WorkspaceGateFacts["configRecheck"]> {
  try {
    const current = await readWakeflowConfigAuthoritySnapshot(
      context.root,
      signalOptions(context.options.signal),
    );
    return current.configDigest === context.snapshot.configDigest ? "current" : "changed";
  } catch (error: unknown) {
    failIfAborted(error);
    return "unavailable";
  }
}

/**
 * 私有树的模式普查（§13.124 D8，§13.130）：安全漂移或不安全节点让 local-layout 门带数量与区域
 * （前三段路径，至多三个）点名，例如 `private-mode-drift-12:.wakeflow-local/runtime`；安全漂移由
 * reconcile 收回，不安全节点只报告。普查读不出不遮蔽布局预览。
 */
async function privateModeCodes(context: SliceContext): Promise<readonly string[]> {
  try {
    const census = await inspectWakeflowPrivateModes(
      context.root,
      signalOptions(context.options.signal),
    );
    const named = (prefix: string, paths: Parameters<typeof wakeflowPrivateModeAreas>[0]) =>
      `${prefix}-${paths.length}:${wakeflowPrivateModeAreas(paths)
        .map((area) => area.replace(/[^A-Za-z0-9./-]/gu, "-"))
        .join(",")}`;
    if (census.status === "unsafe")
      return Object.freeze([named("private-mode-unsafe", census.unsafe)]);
    if (census.status === "safe-drift") {
      return Object.freeze([
        named(
          "private-mode-drift",
          census.drifted.map((entry) => entry.resourcePath),
        ),
      ]);
    }
    return Object.freeze([]);
  } catch (error: unknown) {
    failIfAborted(error);
    return Object.freeze([]);
  }
}

/**
 * local-layout 门的事实（§13.94 D3）：静态资源矩阵经宿主中立的零写对账预览核对——当前配置、
 * 当前宿主 profile 与全部宿主 profile；ready 且没有计划步骤才是 ready，否则 blocked 并带阻塞码
 * 与步骤种类；预览本身抛错即 unavailable。
 */
async function localLayout(context: SliceContext): Promise<WorkspaceGateFacts["local"]> {
  const modes = await privateModeCodes(context);
  if (modes.length > 0) return Object.freeze({ status: "blocked" as const, codes: modes });
  const current = context.facade.hosts.find((host) => host.hostId === context.facade.hostId);
  if (current === undefined) {
    return Object.freeze({
      status: "unavailable" as const,
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
      status: ready ? ("ready" as const) : ("blocked" as const),
      codes: Object.freeze([
        ...preview.blockerCodes,
        ...preview.steps.map((step) => `step:${step.kind}`),
      ]),
    });
  } catch (error: unknown) {
    failIfAborted(error);
    return Object.freeze({ status: "unavailable" as const, codes: Object.freeze([]) });
  }
}

async function ledgerLayout(context: SliceContext): Promise<string> {
  try {
    return (await inspectLedgerAuthorityLayout(context.ledgerRoot, context.options.signal)).status;
  } catch (error: unknown) {
    failIfAborted(error);
    return "unavailable";
  }
}

/** primary pod 的主检出：`.git` 缺失或是 worktree 指针即 false；其他读不出为 null（未观察）。 */
function primaryCheckoutsOf(
  repositories:
    | readonly Readonly<{ readonly status: string; readonly issue: string | null }>[]
    | null,
): boolean | null {
  if (repositories === null) return null;
  let unobserved = false;
  for (const repository of repositories) {
    if (repository.status === "observed") continue;
    if (repository.issue === "git-directory-missing" || repository.issue === "root-is-worktree") {
      return false;
    }
    unobserved = true;
  }
  return unobserved ? null : true;
}

/** 非活动 Demand 的生命周期日志；目录缺失为空，读不出为 null（门报 unavailable）。 */
async function strayJournals(
  context: SliceContext,
  activeDemandIds: ReadonlySet<string>,
): Promise<readonly string[] | null> {
  try {
    const listing = await readStableResourceDirectory(
      context.root,
      DEMAND_LIFECYCLE_JOURNALS_ROOT_REF,
      {
        maximumEntries: DIRECTORY_MAXIMUM_ENTRIES,
        ...signalOptions(context.options.signal),
      },
    );
    return listing.entries
      .map((entry) => JOURNAL_FILE_PATTERN.exec(entry.name)?.[1])
      .filter(
        (demandId): demandId is string => demandId !== undefined && !activeDemandIds.has(demandId),
      )
      .sort();
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError && error.reason === "not-found") return [];
    failIfAborted(error);
    return null;
  }
}

/** 复用 demand 切片的门（治理层）：不扫描负载正文，所以没有 payload-privacy 门。 */
async function demandGateReport(
  context: SliceContext,
  demand: Readonly<ObservedDemand>,
): Promise<Readonly<VerifyReport> | null> {
  if (demand.loaded === null) return null;
  let demandRoot: RootedDirectory | null = null;
  try {
    demandRoot = await openDemandOperationRoot(
      context.root,
      demand.demandId as WakeflowDurableId<"demand">,
    );
    const loaded = await loadDemandEventSourcingRootAuthority(
      demandRoot,
      new LedgerAuthorityStore(context.ledgerRoot),
      signalOptions(context.options.signal),
    );
    const claim = await readRequirementClaimState(
      context.root,
      loaded.identity.source.requirementId,
      context.options.signal,
    );
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
  } catch (error: unknown) {
    failIfAborted(error);
    return null;
  } finally {
    if (demandRoot !== null) await closeDemandOperationRoot(demandRoot);
  }
}

function gateStatus(report: Readonly<VerifyReport> | null, name: string): VerifyGateStatus {
  const found = report?.gates.find((entry) => entry.gate === name);
  return found?.status ?? "unavailable";
}

async function gateFacts(
  context: SliceContext,
  reports: ReadonlyMap<string, Readonly<VerifyReport> | null>,
): Promise<Readonly<WorkspaceGateFacts>> {
  const { observation, snapshot } = context;
  const demands = observation.demands.value ?? [];
  const activeIds = new Set(demands.map((demand) => demand.demandId));
  const board = observation.board.value;
  const orphans = new Set(orphanWorkClaims(observation).map((claim) => claim.claimId));
  const bindingsObserved = observation.bindings.every((host) => host.status === "observed");
  const bound = new Set(
    observation.bindings.flatMap((host) => host.bindings.map((b) => b.windowId)),
  );
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
            .filter(
              (state) =>
                state.status === "claimed" &&
                state.claim !== null &&
                !activeIds.has(state.claim.demandId),
            )
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
        ? ("registered" as const)
        : bindingsObserved
          ? ("unregistered" as const)
          : ("unobserved" as const),
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
      state: pod.state ?? ("unobserved" as const),
      worktrees: pod.pod.worktrees.map((worktree) => {
        const receipt = pod.receipts.find(
          (entry) => entry.receipt.repositoryId === worktree.repositoryId,
        );
        return {
          repositoryId: worktree.repositoryId,
          receipt:
            receipt === undefined
              ? ("absent" as const)
              : receipt.checkoutPresent
                ? ("present" as const)
                : ("checkout-missing" as const),
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

async function assembleVerify(
  context: SliceContext,
  request: VerifyRequest,
): Promise<VerifyResult> {
  const demands = context.observation.demands.value ?? [];
  const reports = new Map<string, Readonly<VerifyReport> | null>();
  for (const demand of demands)
    reports.set(demand.demandId, await demandGateReport(context, demand));
  const gates = deriveWorkspaceGates(await gateFacts(context, reports));
  const { ok, summary } = summarizeGates(gates);
  let demandSection: unknown = null;
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
    } else {
      const archive = await locateLatestDemandArchive(
        context.ledgerRoot,
        request.demandId,
        context.options.signal,
      );
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

function computeGatesDigest(
  gates: readonly Readonly<{
    readonly name: string;
    readonly status: string;
    readonly code: string | null;
  }>[],
): string {
  return computeCanonicalJsonSha256Digest({
    kind: "WakeflowVerificationObservation",
    gates: gates.map((entry) => ({ name: entry.name, status: entry.status, code: entry.code })),
  });
}

/** 执行一次 `wakeflow_verify`。 */
export async function executeVerifyRequest(
  facade: Readonly<ObservationHostFacade>,
  value: unknown,
  options: ExecuteObservationOptions = {},
): Promise<VerifyResult> {
  return runCommandShell<Envelope, VerifyRequest, SliceContext, VerifyResult>(
    {
      tool: WAKEFLOW_VERIFY_PUBLIC_TOOL_NAME,
      parseRequest: (raw) => {
        const request = parseVerifyRequest(raw);
        return { envelope: request, input: request };
      },
      open: (root) => openContext(root, facade, options),
      close: closeContext,
      privateValues,
    },
    value,
    () => undefined,
    (context, binding) => assembleVerify(context, binding.input),
    commandShellExecutionOptions(options.durability),
  );
}
