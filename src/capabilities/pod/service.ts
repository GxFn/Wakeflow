import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
  type WakeflowConfigAuthoritySnapshot,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import {
  replaceWakeflowConfigAuthority,
  WakeflowConfigAuthorityReplacementError,
} from "../../configuration/wakeflow-config-authority-replacement.js";
import { createWakeflowConfigV3DocumentValue } from "../../configuration/wakeflow-config-v3-document.js";
import {
  parseWakeflowConfigV3,
  WakeflowConfigV3Error,
  type WakeflowConfigPod,
  type WakeflowConfigV3Model,
} from "../../configuration/wakeflow-config-v3.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { WakeflowHostId } from "../../contracts/vocabulary/wakeflow-host-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, Sha256Error } from "../../foundation/crypto/sha256.js";
import {
  parseJsonValue,
  type JsonObject,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { readUtcWallClock, type UtcWallClock } from "../../foundation/time/wall-clock.js";
import { assertNoActiveDemand } from "../../governance/demand/publication/demand-active-guard.js";
import { fail, WakeflowError } from "../../kernel/error.js";
import type { NextProjection } from "../../kernel/next-projection.js";
import {
  listPodWorktreeReceipts,
  retirePodReceipts,
  retirePodWorktreeReceipt,
  worktreeCheckoutPresent,
  type PodWorktreeReceipt,
} from "../../kernel/pod-worktree-receipts.js";
import {
  runPublicationTransaction,
  type PublicationTransactionEnvelope,
  type PublicationTransactionPhase,
  type PublicationTransactionPlan,
} from "../../kernel/publication-transaction.js";
import type { WakeflowWindowHostBinding } from "../../workspace/window-runtime/wakeflow-window-host-binding.js";
import {
  inspectWakeflowWindowHostBindingInventory,
  WakeflowWindowHostBindingStoreError,
} from "../../workspace/window-runtime/wakeflow-window-host-binding-store.js";
import { compileWakeflowWindowHostBindingStoreAuthority } from "../../workspace/window-runtime/wakeflow-window-host-binding-store-authority.js";
import type { WakeflowWindowHostIdentityProfile } from "../../workspace/window-runtime/wakeflow-window-host-identity-profile.js";
import type { WakeflowWorkspaceHostResourceProfile } from "../../workspace/workspace-host-resource-profile.js";
import {
  admitPodResult,
  parsePodRequest,
  WAKEFLOW_POD_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_POD_PUBLIC_TOOL_NAME,
  type PodRequest,
  type PodResult,
} from "./contract.js";
import {
  deriveCloseCompleteBlockers,
  deriveCloseRequestBlockers,
  deriveCreateBlockers,
  derivePodId,
  derivePodState,
  derivePodWindows,
  derivePodWorktrees,
  podMutationNext,
  podPreviewNext,
  type DerivedPodWindow,
  type DerivedPodWorktree,
  type PodPlanKind,
  type PodState,
} from "./decide.js";

/**
 * Wakeflow Capabilities / Pod：`wakeflow_pod` 的效果型外壳（ADR-0010 D6，gate-log §13.91 D3）。
 *
 * create 与两段 close 都是一次配置事务：在 preview 读到的配置快照上 CAS 替换 `wakeflow.config.json`，
 * 不写别的东西；worktree pod 的 creating / ready / closing / closed 由配置记录加绑定登记表与
 * worktree 回执派生。recover 只做回执对账。调用方身份不在线上："只有 main 的 Controller 调用"
 * 是 skills 文本规则。
 */

export interface PodHostFacade {
  readonly hostId: WakeflowHostId;
  readonly resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly identityProfile: Readonly<WakeflowWindowHostIdentityProfile>;
}

export interface ExecutePodOptions {
  readonly clock?: UtcWallClock;
  readonly signal?: AbortSignal;
}

interface PodSliceContext {
  readonly root: RootedDirectory;
  readonly facade: Readonly<PodHostFacade>;
  readonly snapshot: Readonly<WakeflowConfigAuthoritySnapshot>;
  readonly options: ExecutePodOptions;
}

type EffectRequest = Extract<PodRequest, { readonly mode: "preview" | "apply" }>;

interface PodFacts {
  readonly pod: Readonly<WakeflowConfigPod>;
  readonly windowIds: readonly string[];
  readonly bindingIdByWindowId: ReadonlyMap<string, string>;
  readonly receipts: readonly Readonly<{
    readonly receipt: Readonly<PodWorktreeReceipt>;
    readonly checkoutPresent: boolean;
  }>[];
  readonly state: PodState;
}

interface CreatePlan {
  readonly kind: "create";
  readonly podId: WakeflowDurableId<"pod">;
  readonly name: string;
  readonly replay: boolean;
  readonly windows: readonly DerivedPodWindow[];
  readonly worktrees: readonly DerivedPodWorktree[];
  readonly configDigest: string;
}

interface CloseRequestPlan {
  readonly kind: "close-request";
  readonly podId: WakeflowDurableId<"pod">;
  readonly branches: readonly Readonly<{
    readonly repositoryId: string;
    readonly branch: string | null;
    readonly disposition: "merged" | "abandoned";
  }>[];
  readonly configDigest: string;
}

interface CloseCompletePlan {
  readonly kind: "close-complete";
  readonly podId: WakeflowDurableId<"pod">;
  readonly configDigest: string;
}

type PodPlan = CreatePlan | CloseRequestPlan | CloseCompletePlan;

interface PodOutcome {
  readonly disposition:
    | "created"
    | "already-created"
    | "closing"
    | "closed"
    | "healthy"
    | "retired";
  readonly podId: WakeflowDurableId<"pod">;
  readonly retiredReceipts: number;
}

function signalOptions(signal: AbortSignal | undefined): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

// ---- 请求与上下文 ------------------------------------------------------------------

function envelopeOf(request: PodRequest): PublicationTransactionEnvelope {
  if (request.mode === "recover") {
    return Object.freeze({
      root: request.root,
      mode: "recover" as const,
      planDigest: null,
      operationId: request.podId,
    });
  }
  let planDigest = null;
  if (request.planDigest !== undefined) {
    try {
      planDigest = parseSha256Digest(request.planDigest, "$request.planDigest");
    } catch (error: unknown) {
      if (error instanceof Sha256Error) {
        fail("invalid-request", "plan-digest", "$request.planDigest", { cause: error });
      }
      throw error;
    }
  }
  return Object.freeze({ root: request.root, mode: request.mode, planDigest, operationId: null });
}

async function openContext(
  root: RootedDirectory,
  facade: Readonly<PodHostFacade>,
  options: ExecutePodOptions,
): Promise<PodSliceContext> {
  try {
    const snapshot = await readWakeflowConfigAuthoritySnapshot(root, signalOptions(options.signal));
    return Object.freeze({ root, facade, snapshot, options });
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      fail("precondition-failed", "config-authority", "$request.root", { cause: error });
    }
    throw error;
  }
}

function podOf(context: PodSliceContext, podId: string): Readonly<WakeflowConfigPod> | null {
  return Object.hasOwn(context.snapshot.indexes.podById, podId)
    ? (context.snapshot.indexes.podById[podId as WakeflowDurableId<"pod">] ?? null)
    : null;
}

function podWindowIds(context: PodSliceContext, podId: string): readonly string[] {
  const scope = Object.hasOwn(context.snapshot.indexes.podScopes, podId)
    ? context.snapshot.indexes.podScopes[podId as WakeflowDurableId<"pod">]
    : undefined;
  return scope === undefined ? [] : scope.windows.map((window) => window.windowId);
}

// ---- 事实加载 ----------------------------------------------------------------------

async function loadBindings(
  context: PodSliceContext,
): Promise<readonly Readonly<WakeflowWindowHostBinding>[]> {
  try {
    const authority = compileWakeflowWindowHostBindingStoreAuthority(
      context.snapshot.model,
      context.facade.resourceProfile,
      context.facade.identityProfile,
    );
    return (
      await inspectWakeflowWindowHostBindingInventory(
        context.root,
        authority,
        signalOptions(context.options.signal),
      )
    ).bindings;
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingStoreError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      fail("precondition-failed", "binding-store", "$request.root", { cause: error });
    }
    throw error;
  }
}

async function loadPodFacts(
  context: PodSliceContext,
  pod: Readonly<WakeflowConfigPod>,
): Promise<PodFacts> {
  const windowIds = podWindowIds(context, pod.podId);
  const bindings = await loadBindings(context);
  const bindingIdByWindowId = new Map<string, string>();
  for (const binding of bindings) {
    if (windowIds.includes(binding.windowId)) {
      bindingIdByWindowId.set(binding.windowId, binding.bindingId);
    }
  }
  const stored = await listPodWorktreeReceipts(
    context.root,
    context.facade.hostId,
    pod.podId,
    signalOptions(context.options.signal),
  );
  const receipts = [];
  for (const receipt of stored) {
    receipts.push(
      Object.freeze({ receipt, checkoutPresent: await worktreeCheckoutPresent(receipt) }),
    );
  }
  const state = derivePodState({
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
async function activeDemandOnPod(context: PodSliceContext, podId: string): Promise<string | null> {
  try {
    await assertNoActiveDemand(context.root, context.options.signal, null, podId);
    return null;
  } catch (error: unknown) {
    if (error instanceof WakeflowError && error.reason === "pod-busy") {
      return error.details?.demandId ?? "unknown";
    }
    throw error;
  }
}

// ---- 计划 --------------------------------------------------------------------------

function blocked(blockers: readonly string[]): PublicationTransactionPlan<PodPlan> {
  return Object.freeze({ status: "blocked", blockers, plan: null, digest: null });
}

function ready(plan: PodPlan): PublicationTransactionPlan<PodPlan> {
  return Object.freeze({
    status: "ready",
    blockers: Object.freeze([]),
    plan,
    digest: computeCanonicalJsonSha256Digest(parseJsonValue(plan, "$plan")),
  });
}

function planCreate(
  context: PodSliceContext,
  intent: Extract<EffectRequest["intent"], { readonly kind: "create" }>,
): PublicationTransactionPlan<PodPlan> {
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
  if (blockers.length > 0) return blocked(Object.freeze(blockers));
  const windows = derivePodWindows(
    context.snapshot.indexes.primaryPod,
    model.topology.repositories.map((repository) => repository.repositoryId),
    podId,
    intent.name,
    model.program.programId,
  );
  return ready(
    Object.freeze({
      kind: "create" as const,
      podId,
      name: intent.name,
      replay,
      windows,
      worktrees: derivePodWorktrees(windows, intent.name),
      configDigest: context.snapshot.configDigest,
    }),
  );
}

async function planClose(
  context: PodSliceContext,
  intent: Extract<EffectRequest["intent"], { readonly kind: "close" }>,
): Promise<PublicationTransactionPlan<PodPlan>> {
  const pod = podOf(context, intent.podId);
  if (pod === null) return blocked([`pod-unknown:${intent.podId}`]);
  const facts = await loadPodFacts(context, pod);
  if (pod.lifecycle === "closing") {
    const blockers = deriveCloseCompleteBlockers({
      boundWindowIds: facts.windowIds.filter((id) => facts.bindingIdByWindowId.has(id)),
      presentCheckoutRepositoryIds: facts.receipts
        .filter((entry) => entry.checkoutPresent)
        .map((entry) => entry.receipt.repositoryId),
    });
    if (blockers.length > 0) return blocked(blockers);
    return ready(
      Object.freeze({
        kind: "close-complete" as const,
        podId: pod.podId,
        configDigest: context.snapshot.configDigest,
      }),
    );
  }
  const blockers = deriveCloseRequestBlockers({
    placement: pod.placement,
    activeDemandId:
      pod.placement === "primary" ? null : await activeDemandOnPod(context, pod.podId),
    registeredRepositoryIds: facts.receipts.map((entry) => entry.receipt.repositoryId),
    dispositions: intent.branches,
    knownRepositoryIds: pod.worktrees.map((worktree) => worktree.repositoryId),
  });
  if (blockers.length > 0) return blocked(blockers);
  return ready(
    Object.freeze({
      kind: "close-request" as const,
      podId: pod.podId,
      branches: intent.branches.map((entry) =>
        Object.freeze({
          repositoryId: entry.repositoryId,
          branch:
            facts.receipts.find((receipt) => receipt.receipt.repositoryId === entry.repositoryId)
              ?.receipt.branch ?? null,
          disposition: entry.disposition,
        }),
      ),
      configDigest: context.snapshot.configDigest,
    }),
  );
}

async function planPod(
  context: PodSliceContext,
  input: PodRequest,
): Promise<PublicationTransactionPlan<PodPlan>> {
  if (input.mode === "recover") fail("unexpected", "plan-mode", "$request.mode");
  return input.intent.kind === "create"
    ? planCreate(context, input.intent)
    : planClose(context, input.intent);
}

// ---- 配置事务 ----------------------------------------------------------------------

function mapReplacementError(error: unknown): never {
  if (error instanceof WakeflowConfigAuthorityReplacementError) {
    if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
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
  if (error instanceof WakeflowConfigV3Error) {
    fail("precondition-failed", `config-${error.reason}`, "$request.root", { cause: error });
  }
  throw error;
}

function documentOf(model: WakeflowConfigV3Model): JsonObject {
  const value = createWakeflowConfigV3DocumentValue(model);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("unexpected", "config-document", "$config");
  }
  return value as JsonObject;
}

async function replaceConfig(context: PodSliceContext, desired: JsonValue): Promise<void> {
  try {
    const model = parseWakeflowConfigV3(desired);
    await replaceWakeflowConfigAuthority(
      context.root,
      model,
      context.snapshot,
      signalOptions(context.options.signal),
    );
  } catch (error: unknown) {
    mapReplacementError(error);
  }
}

function windowDocument(window: DerivedPodWindow): JsonObject {
  return {
    windowId: window.windowId,
    podId: window.podId,
    role: window.role,
    displayName: window.displayName,
    root: parseJsonValue(window.root, "$window.root"),
  };
}

async function applyCreate(context: PodSliceContext, plan: CreatePlan): Promise<PodOutcome> {
  if (plan.replay) {
    return Object.freeze({ disposition: "already-created", podId: plan.podId, retiredReceipts: 0 });
  }
  const document = documentOf(context.snapshot.model);
  const topology = document.topology as JsonObject;
  const desired: JsonObject = {
    ...document,
    topology: {
      ...topology,
      windows: [...(topology.windows as JsonValue[]), ...plan.windows.map(windowDocument)],
    },
    pods: [
      ...(document.pods as JsonValue[]),
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

async function applyCloseRequest(
  context: PodSliceContext,
  plan: CloseRequestPlan,
): Promise<PodOutcome> {
  const document = documentOf(context.snapshot.model);
  const requestedAt = readUtcWallClock(context.options.clock);
  const desired: JsonObject = {
    ...document,
    pods: (document.pods as JsonObject[]).map((pod) =>
      pod.podId === plan.podId
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
        : pod,
    ),
  };
  await replaceConfig(context, desired);
  return Object.freeze({ disposition: "closing", podId: plan.podId, retiredReceipts: 0 });
}

async function applyCloseComplete(
  context: PodSliceContext,
  plan: CloseCompletePlan,
): Promise<PodOutcome> {
  const document = documentOf(context.snapshot.model);
  const topology = document.topology as JsonObject;
  const desired: JsonObject = {
    ...document,
    topology: {
      ...topology,
      windows: (topology.windows as JsonObject[]).filter((window) => window.podId !== plan.podId),
    },
    pods: (document.pods as JsonObject[]).filter((pod) => pod.podId !== plan.podId),
  };
  await replaceConfig(context, desired);
  const receiptCount = (
    await listPodWorktreeReceipts(context.root, context.facade.hostId, plan.podId)
  ).length;
  await retirePodReceipts(context.root, context.facade.hostId, plan.podId);
  return Object.freeze({ disposition: "closed", podId: plan.podId, retiredReceipts: receiptCount });
}

async function applyPod(
  context: PodSliceContext,
  _input: PodRequest,
  plan: PodPlan,
): Promise<PodOutcome> {
  switch (plan.kind) {
    case "create":
      return applyCreate(context, plan);
    case "close-request":
      return applyCloseRequest(context, plan);
    case "close-complete":
      return applyCloseComplete(context, plan);
    default: {
      const exhaustive: never = plan;
      return exhaustive;
    }
  }
}

/** recover 只做回执对账：退休与绑定不同代或检出已不存在的回执；配置里没有的 pod 只清孤儿目录。 */
async function recoverPod(context: PodSliceContext, operationId: string): Promise<PodOutcome> {
  const podId = operationId as WakeflowDurableId<"pod">;
  const pod = podOf(context, podId);
  if (pod === null) {
    const removed = await retirePodReceipts(context.root, context.facade.hostId, podId);
    return Object.freeze({
      disposition: removed ? ("retired" as const) : ("healthy" as const),
      podId,
      retiredReceipts: removed ? 1 : 0,
    });
  }
  const facts = await loadPodFacts(context, pod);
  let retired = 0;
  for (const entry of facts.receipts) {
    const bound = facts.bindingIdByWindowId.get(entry.receipt.windowId);
    const stale = !entry.checkoutPresent || bound !== entry.receipt.bindingId;
    if (!stale) continue;
    if (
      await retirePodWorktreeReceipt(
        context.root,
        context.facade.hostId,
        podId,
        entry.receipt.repositoryId,
        signalOptions(context.options.signal),
      )
    ) {
      retired += 1;
    }
  }
  return Object.freeze({
    disposition: retired > 0 ? ("retired" as const) : ("healthy" as const),
    podId,
    retiredReceipts: retired,
  });
}

// ---- 结果 --------------------------------------------------------------------------

interface PodViews {
  readonly pod: JsonObject | null;
  readonly windows: readonly JsonObject[];
  readonly worktrees: readonly JsonObject[];
  readonly next: Readonly<NextProjection>;
}

async function currentViews(context: PodSliceContext, podId: string): Promise<PodViews> {
  const snapshot = await readWakeflowConfigAuthoritySnapshot(
    context.root,
    signalOptions(context.options.signal),
  );
  const fresh: PodSliceContext = Object.freeze({ ...context, snapshot });
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
    const entry = facts.receipts.find(
      (candidate) => candidate.receipt.repositoryId === worktree.repositoryId,
    );
    return {
      repositoryId: worktree.repositoryId,
      windowId: worktree.windowId,
      suggestedName: worktree.suggestedName,
      receipt:
        entry === undefined ? "absent" : entry.checkoutPresent ? "present" : "checkout-missing",
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
        .filter(
          (worktree) =>
            !facts.receipts.some((entry) => entry.receipt.repositoryId === worktree.repositoryId),
        )
        .map((worktree) => worktree.repositoryId),
      presentCheckoutRepositoryIds: facts.receipts
        .filter((entry) => entry.checkoutPresent)
        .map((entry) => entry.receipt.repositoryId),
    }),
  });
}

async function previewViews(
  context: PodSliceContext,
  planned: PublicationTransactionPlan<PodPlan>,
): Promise<JsonObject | null> {
  const plan = planned.plan;
  if (plan === null) return null;
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
      })),
    };
  }
  const views = await currentViews(context, plan.podId);
  if (views.pod === null) fail("unexpected", "pod-vanished", "$request.intent.podId");
  return { kind: plan.kind, pod: views.pod, windows: views.windows, worktrees: views.worktrees };
}

async function assembleResult(
  context: PodSliceContext,
  phase: PublicationTransactionPhase<PodPlan, PodOutcome>,
  next: Readonly<NextProjection>,
): Promise<PodResult> {
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

function privateValues(context: PodSliceContext): Iterable<string> {
  const values = new Set<string>([context.snapshot.ledgerRoot]);
  for (const entry of context.snapshot.placements.roots) {
    values.add(entry.absolutePath);
    if (entry.realPath !== null) values.add(entry.realPath);
  }
  return values;
}

/** 执行一次 `wakeflow_pod`。 */
export async function executePodRequest(
  facade: Readonly<PodHostFacade>,
  value: unknown,
  options: ExecutePodOptions = {},
): Promise<PodResult> {
  // 结果组装要读当前事实（绑定、回执、检出），是异步的；内核的 result 钩子同步，所以在
  // next 钩子里算好并缓存，result 只取出来。
  let assembled: PodResult | null = null;
  return runPublicationTransaction<PodRequest, PodSliceContext, PodPlan, PodOutcome, PodResult>(
    {
      tool: WAKEFLOW_POD_PUBLIC_TOOL_NAME,
      parseRequest: (raw) => {
        const request = parsePodRequest(raw);
        return { envelope: envelopeOf(request), input: request };
      },
      open: (root) => openContext(root, facade, options),
      close: async () => {},
      plan: planPod,
      apply: applyPod,
      recover: recoverPod,
      next: async (context, phase) => {
        const kind: PodPlanKind =
          phase.mode === "preview" ? (phase.planned.plan?.kind ?? "create") : "create";
        const next =
          phase.mode === "preview"
            ? podPreviewNext(kind, phase.planned)
            : (await currentViews(context, phase.outcome.podId)).next;
        assembled = await assembleResult(context, phase, next);
        return next;
      },
      result: () => {
        if (assembled === null) fail("unexpected", "result-not-assembled", "$result");
        return assembled;
      },
      privateValues,
    },
    value,
  );
}
