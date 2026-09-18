import path from "node:path";

import {
  readWakeflowConfigAuthoritySnapshot,
  WAKEFLOW_CONFIG_FILE_REF,
  WakeflowConfigAuthoritySnapshotError,
  type WakeflowConfigAuthoritySnapshot,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { WakeflowHostId } from "../../contracts/vocabulary/wakeflow-host-id.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../../foundation/filesystem/stable-directory-read.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
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
  observeWorkspace,
  orphanWorkClaims,
  type ObservationHost,
  type ObservedDemand,
  type ObservedDomain,
  type WorkspaceObservation,
} from "../../governance/observation/workspace-observation.js";
import type { ActiveProjectionTargetInspection } from "../../kernel/active-projection.js";
import { runCommandShell } from "../../kernel/command-shell.js";
import { fail } from "../../kernel/error.js";
import { DEMAND_LIFECYCLE_JOURNALS_ROOT_REF } from "../../kernel/layout.js";
import { deriveNextProjection, type NextProjection } from "../../kernel/next-projection.js";
import { readRequirementClaimState } from "../../kernel/requirement-board.js";
import { previewWakeflowStaticMaterialization } from "../../workspace/maintenance/wakeflow-static-materialization-preview.js";
import {
  admitStatusResult,
  admitVerifyResult,
  parseStatusRequest,
  parseVerifyRequest,
  WAKEFLOW_OBSERVATION_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_STATUS_PUBLIC_TOOL_NAME,
  WAKEFLOW_VERIFY_PUBLIC_TOOL_NAME,
  type StatusRequest,
  type StatusResult,
  type VerifyRequest,
  type VerifyResult,
} from "./contract.js";
import {
  deriveNextActions,
  deriveWorkspaceGates,
  disposalGuidance,
  nextFromActions,
  projectionFreshness,
  summarizeGates,
  verifyNext,
  type NextActionInput,
  type VerifyGateStatus,
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
}

export interface ExecuteObservationOptions {
  readonly clock?: UtcWallClock;
  readonly signal?: AbortSignal;
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
  snapshot: Readonly<WakeflowConfigAuthoritySnapshot>,
): Promise<RootedDirectory> {
  const placement = snapshot.placements.roots.find((entry) => entry.key === "ledger.root");
  if (placement === undefined || placement.state !== "present" || placement.realPath === null) {
    fail("precondition-failed", "ledger-root-missing", "$request.root");
  }
  try {
    return await RootedDirectory.open(placement.absolutePath, "$ledgerRoot");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      fail("precondition-failed", "ledger-root", "$request.root", { cause: error });
    }
    throw error;
  }
}

async function openContext(
  root: RootedDirectory,
  facade: Readonly<ObservationHostFacade>,
  options: ExecuteObservationOptions,
): Promise<SliceContext> {
  const snapshot = await readSnapshot(root, options.signal);
  const ledgerRoot = await openLedgerRoot(snapshot);
  try {
    const observation = await observeWorkspace(root, snapshot, ledgerRoot, {
      hosts: facade.hosts,
      currentHostId: facade.hostId,
      scope: "full",
      ...signalOptions(options.signal),
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    });
    const projection = await observeProjectionTargets(root, observation, options.signal);
    return Object.freeze({ root, snapshot, ledgerRoot, facade, options, observation, projection });
  } catch (error: unknown) {
    await ledgerRoot.close();
    throw error;
  }
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
    };
  });
}

function claimViews(observation: Readonly<WorkspaceObservation>) {
  const orphans = new Set(orphanWorkClaims(observation).map((claim) => claim.claimId));
  return (observation.claims.value?.claims ?? []).map((claim) => ({
    windowId: claim.windowId,
    claimId: claim.claimId,
    demandId: claim.holder.demandId,
    targetTaskId: claim.holder.targetTaskId,
    deliveryId: claim.holder.deliveryId,
    generation: claim.holder.generation,
    claimedAt: claim.claimedAt,
    orphan: orphans.has(claim.claimId),
  }));
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
              )
            : null,
      };
    }),
  }));
}

function repositoryViews(observation: Readonly<WorkspaceObservation>) {
  return (observation.repositories.value ?? []).map((repository) => ({
    repositoryId: repository.repositoryId,
    status: repository.status,
    issue: repository.issue,
    head: repository.head,
    branch: repository.branch,
    detached: repository.detached,
    branches: repository.branches.length,
    worktrees: repository.worktrees.map((worktree) => ({
      name: worktree.name,
      branch: worktree.branch,
      prunable: worktree.prunable,
    })),
  }));
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
  const overall = deriveOverallStatus(observation);
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
  return Object.freeze({
    maintenance: overall === "maintenance",
    unregisteredWindows: bindingsObserved
      ? snapshot.model.topology.windows
          .filter((window) => !bound.has(window.windowId))
          .map((window) => {
            const pod = pods.find((entry) => entry.pod.podId === window.podId);
            return {
              windowId: window.windowId,
              podId: window.podId,
              placement: pod?.pod.placement ?? "worktree",
              podActive: pod?.pod.placement === "primary" || pod?.activeDemandId !== null,
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
  const active = (context.observation.demands.value ?? []).find(
    (demand) => demand.demandId === demandId,
  );
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

async function assembleStatus(
  context: SliceContext,
  request: StatusRequest,
): Promise<StatusResult> {
  const { observation, snapshot } = context;
  const actions = deriveNextActions(nextActionInput(context));
  const section = await routeSection(context, request.demandId);
  return admitStatusResult({
    kind: "WakeflowStatus",
    schemaVersion: WAKEFLOW_OBSERVATION_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_STATUS_PUBLIC_TOOL_NAME,
    observedAt: observation.observedAt,
    overall: deriveOverallStatus(observation),
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
    demands: (observation.demands.value ?? []).map(demandView),
    windows: windowViews(context),
    claims: claimViews(observation),
    pods: podViews(context),
    repositories: repositoryViews(observation),
    hooks: hookViews(observation),
    unmergedAccepted: unmergedAcceptedFacts(observation),
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
    if (reasonOf(error) === "aborted") throw error;
    return "unavailable";
  }
}

/**
 * local-layout 门的事实（§13.94 D3）：静态资源矩阵经宿主中立的零写对账预览核对——当前配置、
 * 当前宿主 profile 与全部宿主 profile；ready 且没有计划步骤才是 ready，否则 blocked 并带阻塞码
 * 与步骤种类；预览本身抛错即 unavailable。
 */
async function localLayout(context: SliceContext): Promise<WorkspaceGateFacts["local"]> {
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
    if (reasonOf(error) === "aborted") throw error;
    return Object.freeze({ status: "unavailable" as const, codes: Object.freeze([]) });
  }
}

async function ledgerLayout(context: SliceContext): Promise<string> {
  try {
    return (await inspectLedgerAuthorityLayout(context.ledgerRoot, context.options.signal)).status;
  } catch (error: unknown) {
    if (reasonOf(error) === "aborted") throw error;
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
    if (reasonOf(error) === "aborted") throw error;
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
    if (reasonOf(error) === "aborted") throw error;
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
  return Object.freeze({
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
      claimedWithoutRoot: (board?.states ?? [])
        .filter(
          (state) =>
            state.status === "claimed" &&
            state.claim !== null &&
            !activeIds.has(state.claim.demandId),
        )
        .map((state) => state.claim?.demandId ?? state.requirementId),
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
      status: host.status,
      directory: host.directory,
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
    const report = reports.get(request.demandId);
    if (report !== undefined && report !== null) {
      demandSection = {
        demandId: request.demandId,
        status: "current",
        gates: report.gates,
        observationDigest: report.observationDigest,
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
  );
}
