import path from "node:path";

import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { WakeflowHostId } from "../../contracts/vocabulary/wakeflow-host-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest, type Sha256Digest } from "../../foundation/crypto/sha256.js";
import { parseJsonValue } from "../../foundation/data/json-value.js";
import type {
  RootedDirectory,
  RootedDirectoryDurability,
} from "../../foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../foundation/time/utc-instant.js";
import { readUtcWallClock, type UtcWallClock } from "../../foundation/time/wall-clock.js";
import type { WakeflowPresentationLanguage } from "../../configuration/wakeflow-config.js";
import { buildDemandControllerRoute } from "../../governance/controller/demand-controller-route.js";
import {
  computeDeliveryPromptDigest,
  createDeliveryEnvelope,
  DeliveryEnvelopeError,
  deliveryTaskPackageRef,
  type DeliveryEnvelope,
} from "../../governance/delivery/delivery-envelope.js";
import {
  createDeliveryOutcome,
  DeliveryOutcomeError,
  type DeliveryOutcome,
} from "../../governance/delivery/delivery-outcome.js";
import {
  createDeliveryRearm,
  DeliveryRearmError,
  type DeliveryRearm,
} from "../../governance/delivery/delivery-rearm.js";
import {
  createTargetDeliveryProductDefectRemediationContext,
  TargetDeliveryProductDefectRemediationContextError,
} from "../../governance/delivery/target-delivery-product-defect-remediation-context.js";
import {
  createTargetDeliveryReworkContext,
  TargetDeliveryReworkContextError,
} from "../../governance/delivery/target-delivery-rework-context.js";
import {
  closeDemandOperationAuthorityContext,
  DemandOperationAuthorityContextError,
  openDemandOperationAuthorityContext,
  type DemandOperationAuthorityContext,
} from "../../governance/demand/demand-operation-authority-context.js";
import { demandFinalRootRef } from "../../governance/demand/publication/demand-publication-paths.js";
import {
  listPodWorktreeReceipts,
  readPodWorktreeReceipt,
} from "../../kernel/pod-worktree-receipts.js";
import {
  DemandEventSourcingCommandHandlerError,
  executeDemandEventSourcingCommand,
  type DemandEventSourcingCommandResult,
} from "../../governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import {
  parseDemandEventSourcingCommand,
  type DemandEventSourcingCommand,
} from "../../governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import {
  type AuditedDemandTargetResultHistory,
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
} from "../../governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { computeDemandEventStreamCommitDigest } from "../../governance/demand/event-sourcing/demand-event-stream-commit.js";
import { upcastDemandEventSourcingStoredEvent } from "../../governance/demand/event-sourcing/demand-event-sourcing-upcaster.js";
import type {
  DemandCurrentDeliveryBase,
  DemandDeliveryOutcomeSummary,
  DemandTargetTaskState,
} from "../../governance/demand/model/demand-aggregate-state.js";
import {
  deriveTargetResultCallbackStatus,
  parseTargetResultCallbackReissue,
  TARGET_RESULT_CALLBACK_GENERATION_LIMIT,
  TARGET_RESULT_CALLBACK_SILENCE_MILLISECONDS,
  TargetResultCallbackError,
  type TargetResultCallbackReissue,
} from "../../governance/result/target-result-callback.js";
import type { TargetResult } from "../../governance/result/target-result.js";
import {
  ControllerImplementationReviewDecisionError,
  parseControllerImplementationReviewDecision,
} from "../../governance/review/controller-implementation-review-decision.js";
import { readDemandResultReviewSnapshot } from "../../governance/review/demand-result-review-snapshot.js";
import { afterMutationRefresh } from "../../governance/observation/active-projection-refresh.js";
import {
  computeTaskPackageDigest,
  type TaskPackage,
  type TestTaskPackage,
} from "../../governance/tasking/task-package.js";
import {
  createInitialTestExecutionAttempt,
  createRerunTestExecutionAttempt,
  TestExecutionAttemptError,
  type TestExecutionAttempt,
} from "../../governance/testing/test-execution-attempt.js";
import {
  runAppendCommand,
  type AppendCommandBinding,
  type AppendCommandEnvelope,
} from "../../kernel/append-command.js";
import { commandShellExecutionOptions } from "../../kernel/command-shell.js";
import type { WakeflowErrorCode } from "../../contracts/vocabulary/wakeflow-error-code.js";
import { fail } from "../../kernel/error.js";
import { readHostHookObservations } from "../../kernel/hook-observations.js";
import { deriveDurableId } from "../../kernel/ids.js";
import { deriveNextProjection, type NextProjection } from "../../kernel/next-projection.js";
import {
  createWorkClaim,
  deriveWorkClaimId,
  inspectWorkClaim,
  releaseWorkClaim,
  releaseWorkClaimIfHeld,
  takeWorkClaim,
  type WorkClaim,
} from "../../kernel/work-claims.js";
import {
  inspectWakeflowWindowHostBindingInventory,
  WakeflowWindowHostBindingStoreError,
} from "../../workspace/window-runtime/wakeflow-window-host-binding-store.js";
import { compileWakeflowWindowHostBindingStoreAuthority } from "../../workspace/window-runtime/wakeflow-window-host-binding-store-authority.js";
import type { WakeflowWindowHostBinding } from "../../workspace/window-runtime/wakeflow-window-host-binding.js";
import type { WakeflowWindowHostIdentityProfile } from "../../workspace/window-runtime/wakeflow-window-host-identity-profile.js";
import {
  compileWakeflowWindowLaunchIntents,
  type WakeflowWindowLaunchIntent,
} from "../../workspace/window-runtime/wakeflow-window-launch-intent.js";
import type { WakeflowWorkspaceHostResourceProfile } from "../../workspace/workspace-host-resource-profile.js";
import {
  admitPrepareDeliveryResult,
  admitRearmDeliveryResult,
  admitRecordDeliveryOutcomeResult,
  parsePrepareDeliveryRequest,
  parseRearmDeliveryRequest,
  parseRecordDeliveryOutcomeRequest,
  WAKEFLOW_DELIVERY_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME,
  WAKEFLOW_REARM_DELIVERY_PUBLIC_TOOL_NAME,
  WAKEFLOW_RECORD_DELIVERY_OUTCOME_PUBLIC_TOOL_NAME,
  type PrepareDeliveryRequest,
  type PrepareDeliveryResult,
  type RearmDeliveryResult,
  type RecordDeliveryOutcomeRequest,
  type RecordDeliveryOutcomeResult,
} from "./contract.js";
import {
  deriveClaimBlocker,
  deriveDeliveryDisposition,
  derivePrepareBlockers,
  deriveRearmBlockers,
  landingSilenceExceeded,
  type HookLandingRecord,
} from "./decide.js";
import { renderDeliveryPortablePrompt, type DeliveryTestContractSection } from "./prompt.js";

/**
 * Wakeflow Capabilities / Delivery：三个追加型执行器（能力卡 6，ADR-0009，ADR-0012 D1 D2）。
 *
 * prepare：目标 phase 与绑定核对 → 取得窗口工作声明 → 渲染 prompt 骨架 → 追加信封事件 →
 * 返回一次性许可。outcome：按目标会话的 hook 记录与 Agent 声明派生处置，rejected 释放声明。
 * rearm：同信封新声明新代际。宿主效果始终由 Agent 执行；原始句柄只以摘要出现。
 */

export interface DeliveryHostFacade {
  readonly hostId: WakeflowHostId;
  readonly resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly identityProfile: Readonly<WakeflowWindowHostIdentityProfile>;
}

export interface ExecuteDeliveryOptions {
  /** 本次调用打开工作区根用的持久化级别；与 `clock` 同类的注入值，生产不传。 */
  readonly durability?: RootedDirectoryDurability;
  readonly clock?: UtcWallClock;
  readonly signal?: AbortSignal;
}

interface SliceContext {
  readonly workspaceRoot: RootedDirectory;
  readonly authority: Readonly<DemandOperationAuthorityContext>;
  readonly facade: Readonly<DeliveryHostFacade>;
  readonly options: ExecuteDeliveryOptions;
}

type DeliveryBearingTarget = Exclude<
  DemandTargetTaskState,
  { readonly phase: "planned" | "superseded" }
>;

interface WindowRoute {
  readonly binding: Readonly<WakeflowWindowHostBinding>;
  readonly bindingDigest: Sha256Digest;
  readonly handleDigest: Sha256Digest;
  readonly displayTitle: string;
  readonly configuredPlacement: string;
  readonly podId: string;
  readonly podName: string;
  readonly podPlacement: "primary" | "worktree";
  /** worktree pod 产品窗口的检出 realpath（来自回执，只在内存里，从不进入 prompt 或结果）。 */
  readonly worktreePath: string | null;
}

interface CommandOutcome {
  readonly commandResult: Readonly<
    Pick<DemandEventSourcingCommandResult, "disposition" | "commit" | "aggregate">
  >;
}

interface PermitOutcome extends CommandOutcome {
  readonly envelope: Readonly<DeliveryEnvelope>;
  readonly route: Readonly<WindowRoute>;
  readonly generation: number;
  readonly fence: Readonly<{
    readonly claimId: WakeflowDurableId<"work-claim">;
    readonly claimDigest: Sha256Digest;
  }>;
  readonly issuedAt: UtcInstant;
  readonly eventId: WakeflowDurableId<"demand-event">;
}

/** 回调重发的许可：不取声明、没有围栏；prompt 与摘要沿用结果事件里的回调记录。 */
interface CallbackPermitOutcome extends CommandOutcome {
  readonly kind: "callback";
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly workType: "implementation" | "test";
  readonly phase: string;
  readonly callbackId: WakeflowDurableId<"target-delivery">;
  readonly resultDigest: Sha256Digest;
  readonly prompt: string;
  readonly promptDigest: Sha256Digest;
  readonly route: Readonly<WindowRoute>;
  readonly generation: number;
  readonly issuedAt: UtcInstant;
  readonly eventId: WakeflowDurableId<"demand-event">;
}

type RearmOutcome = PermitOutcome | CallbackPermitOutcome;

function isCallbackPermit(outcome: RearmOutcome): outcome is CallbackPermitOutcome {
  return "kind" in outcome && outcome.kind === "callback";
}

interface OutcomeOutcome extends CommandOutcome {
  readonly outcome: Readonly<DeliveryOutcome>;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly workType: "implementation" | "test";
  readonly eventId: WakeflowDurableId<"demand-event">;
}

const HANDLER_ERROR_TABLE: Readonly<Record<string, readonly [WakeflowErrorCode, string, string]>> =
  Object.freeze({
    "concurrency-conflict": [
      "concurrency-conflict",
      "stream-revision",
      "$request.expectedStreamRevision",
    ],
    "idempotency-conflict": ["idempotency-mismatch", "request-digest", "$request.idempotencyKey"],
    "decision-rejected": ["precondition-failed", "decision-rejected", "$request"],
    aborted: ["io-failure", "aborted", "$signal"],
    input: ["invalid-request", "command", "$request"],
  });

function signalOptions(signal: AbortSignal | undefined): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

/** 第一个阻塞项的前缀是错误原因；全部阻塞项按 `blocker`、`blocker2`… 进入公开 details。 */
function rejectWith(blockers: readonly string[], path: string): never {
  const first = blockers[0];
  if (first === undefined) fail("unexpected", "empty-blockers", path);
  fail("precondition-failed", first.split(":")[0] ?? first, path, {
    details: Object.fromEntries(
      blockers.map((blocker, index) => [index === 0 ? "blocker" : `blocker${index + 1}`, blocker]),
    ),
  });
}

function mapContextError(error: unknown): never {
  if (error instanceof DemandOperationAuthorityContextError) {
    if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    if (error.reason === "root") {
      fail("root-invalid", "demand-root", "$request.demandId", { cause: error });
    }
    fail("precondition-failed", `authority-${error.reason}`, "$request", { cause: error });
  }
  throw error;
}

function mapHandlerError(error: unknown): never {
  if (error instanceof DemandEventSourcingCommandHandlerError) {
    const [code, reason, path] = HANDLER_ERROR_TABLE[error.reason] ?? [
      "io-failure",
      "event-stream",
      "$request.demandId",
    ];
    fail(code, reason, path, { cause: error });
  }
  throw error;
}

function mapRepositoryError(error: unknown): never {
  if (error instanceof DemandEventSourcingRepositoryError) {
    if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    fail("io-failure", "event-stream", "$request.demandId", { cause: error });
  }
  throw error;
}

function mapRecordError(error: unknown, path: string): never {
  if (
    error instanceof DeliveryEnvelopeError ||
    error instanceof DeliveryOutcomeError ||
    error instanceof DeliveryRearmError ||
    error instanceof TargetResultCallbackError ||
    error instanceof TestExecutionAttemptError ||
    error instanceof TargetDeliveryReworkContextError ||
    error instanceof TargetDeliveryProductDefectRemediationContextError
  ) {
    fail("precondition-failed", `record-${error.reason}`, path, { cause: error });
  }
  throw error;
}

function nowFrom(options: ExecuteDeliveryOptions): UtcInstant {
  return readUtcWallClock(options.clock);
}

function parseInstant(value: string, path: string): UtcInstant {
  try {
    return parseUtcInstant(value, path);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("invalid-request", "time", path, { cause: error });
    throw error;
  }
}

// ---- 上下文与路由 ---------------------------------------------------------------

async function openContext(
  workspaceRoot: RootedDirectory,
  envelope: Readonly<AppendCommandEnvelope>,
  facade: Readonly<DeliveryHostFacade>,
  options: ExecuteDeliveryOptions,
): Promise<SliceContext> {
  try {
    const authority = await openDemandOperationAuthorityContext(
      workspaceRoot,
      envelope.demandId as WakeflowDurableId<"demand">,
      options.signal,
    );
    return Object.freeze({ workspaceRoot, authority, facade, options });
  } catch (error: unknown) {
    mapContextError(error);
  }
}

async function closeContext(context: SliceContext): Promise<void> {
  try {
    await closeDemandOperationAuthorityContext(context.authority);
  } catch (error: unknown) {
    mapContextError(error);
  }
}

/** 追加前先核对观察到的流修订：过期修订不该先取声明再在提交边界失败。 */
function assertFreshRevision(context: SliceContext, binding: Readonly<AppendCommandBinding>): void {
  if (context.authority.loaded.aggregate.streamRevision !== binding.expectedStreamRevision) {
    fail("concurrency-conflict", "stream-revision", "$request.expectedStreamRevision", {
      details: { observed: String(context.authority.loaded.aggregate.streamRevision) },
    });
  }
}

function targetOf(context: SliceContext, targetTaskId: string): Readonly<DemandTargetTaskState> {
  const target = context.authority.loaded.aggregate.state.targetTasks.find(
    (entry) => entry.targetTaskId === targetTaskId,
  );
  if (target === undefined) fail("not-found", "target-unknown", "$request.targetTaskId");
  return target;
}

function deliveryTargetOf(
  context: SliceContext,
  deliveryId: string,
): Readonly<DeliveryBearingTarget> {
  const candidates = context.authority.loaded.aggregate.state.targetTasks.filter(
    (entry): entry is DeliveryBearingTarget =>
      entry.phase !== "planned" &&
      entry.phase !== "superseded" &&
      entry.currentDelivery.deliveryId === deliveryId,
  );
  const target = candidates[0];
  if (target === undefined || candidates.length !== 1) {
    fail("not-found", "delivery-unknown", "$request.deliveryId");
  }
  return target;
}

function relativeWorkspaceRoot(placement: string): string {
  const depth = placement
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".").length;
  return depth === 0 ? "." : Array.from({ length: depth }, () => "..").join("/");
}

async function loadRoute(context: SliceContext, windowId: string): Promise<WindowRoute> {
  const { facade, authority } = context;
  let bindings: readonly Readonly<WakeflowWindowHostBinding>[];
  try {
    const storeAuthority = compileWakeflowWindowHostBindingStoreAuthority(
      authority.config.model,
      facade.resourceProfile,
      facade.identityProfile,
    );
    bindings = (
      await inspectWakeflowWindowHostBindingInventory(
        context.workspaceRoot,
        storeAuthority,
        signalOptions(context.options.signal),
      )
    ).bindings;
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingStoreError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      fail("precondition-failed", "binding-store", "$request.targetTaskId", { cause: error });
    }
    throw error;
  }
  const binding = bindings.find((entry) => entry.windowId === windowId);
  if (binding === undefined)
    fail("precondition-failed", "binding-missing", "$request.targetTaskId");
  if (binding.hostId !== facade.hostId) {
    fail("precondition-failed", "binding-host", "$request.targetTaskId");
  }
  const intent = compileWakeflowWindowLaunchIntents(
    authority.config.model,
    facade.resourceProfile,
  ).intents.find((entry) => entry.windowId === windowId);
  if (intent === undefined) fail("precondition-failed", "window-unknown", "$request.targetTaskId");
  return Object.freeze({
    binding,
    bindingDigest: computeCanonicalJsonSha256Digest(parseJsonValue(binding, "$binding")),
    handleDigest: computeSha256Digest(encodeUtf8(binding.handle.value, "$handle"), "$handle"),
    displayTitle: intent.displayTitle,
    configuredPlacement: intent.root.configuredPlacement,
    podId: intent.podId,
    podName: intent.podName,
    podPlacement: intent.podPlacement,
    worktreePath: await worktreePathFor(context, intent, binding),
  });
}

/** worktree pod 的产品窗口：投递准备要求 worktree 回执存在且与当前绑定同代（能力卡 6，ADR-0010）。 */
async function worktreePathFor(
  context: SliceContext,
  intent: Readonly<WakeflowWindowLaunchIntent>,
  binding: Readonly<WakeflowWindowHostBinding>,
): Promise<string | null> {
  if (intent.worktree === null) return null;
  const receipt = await readPodWorktreeReceipt(
    context.workspaceRoot,
    context.facade.hostId,
    intent.podId,
    intent.worktree.repositoryId,
    signalOptions(context.options.signal),
  );
  if (receipt === null) {
    fail("precondition-failed", "worktree-receipt-missing", "$request.targetTaskId");
  }
  if (receipt.bindingId !== binding.bindingId) {
    fail("precondition-failed", "worktree-receipt-stale", "$request.targetTaskId");
  }
  return receipt.path;
}

/** Test 窗口以附加目录方式读 pod 的 worktree：每仓库一条相对本窗口根的路径（ADR-0010 D4）。 */
async function attachedWorktreesFor(
  context: SliceContext,
  taskPackage: Readonly<TaskPackage>,
  route: Readonly<WindowRoute>,
): Promise<
  readonly Readonly<{ readonly repositoryId: string; readonly pathFromWindow: string }>[]
> {
  if (taskPackage.workType !== "test" || route.podPlacement !== "worktree")
    return Object.freeze([]);
  const receipts = await listPodWorktreeReceipts(
    context.workspaceRoot,
    context.facade.hostId,
    route.podId,
    signalOptions(context.options.signal),
  );
  const windowRoot = path.resolve(context.workspaceRoot.absolutePath, route.configuredPlacement);
  return Object.freeze(
    receipts.map((receipt) =>
      Object.freeze({
        repositoryId: receipt.repositoryId,
        pathFromWindow: path.relative(windowRoot, receipt.path),
      }),
    ),
  );
}

// ---- 事件流 -------------------------------------------------------------------

async function boundCommit(
  repository: DemandEventSourcingRepository,
  binding: Readonly<AppendCommandBinding>,
  signal: AbortSignal | undefined,
) {
  try {
    return await repository.findCommitByIdempotencyKey(
      binding.idempotencyKey,
      signalOptions(signal),
    );
  } catch (error: unknown) {
    mapRepositoryError(error);
  }
}

async function appendCommand(
  repository: DemandEventSourcingRepository,
  command: Readonly<DemandEventSourcingCommand>,
  binding: Readonly<AppendCommandBinding>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandEventSourcingCommandResult>> {
  try {
    return await executeDemandEventSourcingCommand(repository, command, {
      commitId: binding.commitId,
      expectedStreamRevision: binding.expectedStreamRevision,
      idempotency: { key: binding.idempotencyKey, requestDigest: binding.requestDigest },
      ...signalOptions(signal),
    });
  } catch (error: unknown) {
    mapHandlerError(error);
  }
}

function committedEvent(
  commandResult: Readonly<Pick<DemandEventSourcingCommandResult, "commit">>,
  eventType:
    | "delivery.delivery-prepared"
    | "delivery.delivery-outcome-recorded"
    | "delivery.delivery-rearmed",
) {
  const stored = commandResult.commit.events[0];
  if (stored === undefined) fail("precondition-failed", "commit-empty", "$request.idempotencyKey");
  const event = upcastDemandEventSourcingStoredEvent(stored);
  if (event.eventType !== eventType) {
    fail("precondition-failed", "commit-kind", "$request.idempotencyKey");
  }
  return Object.freeze({ stored, event });
}

async function loadEnvelope(
  repository: DemandEventSourcingRepository,
  deliveryId: string,
  signal: AbortSignal | undefined,
): Promise<Readonly<DeliveryEnvelope>> {
  try {
    const located = await repository.findDeliveryPreparedEvent(deliveryId, signalOptions(signal));
    if (located === null) fail("not-found", "envelope-unknown", "$request.deliveryId");
    return located.event.data.envelope;
  } catch (error: unknown) {
    mapRepositoryError(error);
  }
}

async function loadTaskPackage(
  repository: DemandEventSourcingRepository,
  target: Readonly<DemandTargetTaskState>,
  signal: AbortSignal | undefined,
): Promise<Readonly<TaskPackage>> {
  try {
    const located = await repository.findTargetTaskPlannedEvent(
      target.taskPackageId,
      signalOptions(signal),
    );
    if (located === null)
      fail("precondition-failed", "task-package-missing", "$request.targetTaskId");
    return located.event.data.taskPackage;
  } catch (error: unknown) {
    mapRepositoryError(error);
  }
}

async function next(context: SliceContext, outcome: CommandOutcome): Promise<NextProjection> {
  const snapshot = await readDemandResultReviewSnapshot(
    context.authority.demandRoot,
    signalOptions(context.options.signal),
  );
  const route = buildDemandControllerRoute(
    { ...context.authority.loaded, aggregate: outcome.commandResult.aggregate },
    snapshot,
  );
  return deriveNextProjection(route);
}

// ---- 声明 ---------------------------------------------------------------------

async function takeClaim(
  context: SliceContext,
  route: Readonly<WindowRoute>,
  holder: Readonly<{
    readonly demandId: WakeflowDurableId<"demand">;
    readonly targetTaskId: WakeflowDurableId<"target-task">;
    readonly deliveryId: WakeflowDurableId<"target-delivery">;
    readonly generation: number;
  }>,
  claimId: WakeflowDurableId<"work-claim">,
  now: UtcInstant,
): Promise<Readonly<{ readonly claim: Readonly<WorkClaim>; readonly created: boolean }>> {
  const signal = signalOptions(context.options.signal);
  const windowId = route.binding.windowId;
  const existing = (await inspectWorkClaim(context.workspaceRoot, windowId, signal)).claim;
  const knownDeliveryIds = context.authority.loaded.aggregate.state.targetTasks.flatMap((entry) =>
    entry.phase === "planned" || entry.phase === "superseded"
      ? []
      : [entry.currentDelivery.deliveryId],
  );
  if (existing !== null && existing.claimId !== claimId) {
    const decision = deriveClaimBlocker(
      existing.holder,
      holder.demandId,
      holder.targetTaskId,
      knownDeliveryIds,
    );
    if (decision.blocker !== null) rejectWith([decision.blocker], "$request.targetTaskId");
    if (decision.reclaim) await releaseWorkClaim(context.workspaceRoot, existing, signal);
  }
  const claim = createWorkClaim({
    claimId,
    hostId: context.facade.hostId,
    windowId,
    bindingId: route.binding.bindingId,
    holder,
    claimedAt: now,
  });
  const taken = await takeWorkClaim(context.workspaceRoot, claim, signal);
  return Object.freeze({ claim: taken.claim, created: taken.disposition === "created" });
}

async function releaseQuietly(context: SliceContext, claim: Readonly<WorkClaim>): Promise<void> {
  try {
    await releaseWorkClaim(context.workspaceRoot, claim, signalOptions(context.options.signal));
  } catch {
    // 追加失败后的回滚是尽力而为；残留声明由 endpoint 的 release-claim 恢复门处理。
  }
}

// ---- prepare ------------------------------------------------------------------

interface PrepareInput {
  readonly targetTaskId: string;
  readonly authored: PrepareDeliveryRequest["authored"];
  readonly language: WakeflowPresentationLanguage;
}

type ReworkSource = Readonly<{
  readonly decision: ReturnType<typeof parseControllerImplementationReviewDecision>;
  readonly previousResult: Readonly<TargetResult>;
}>;

async function loadHistory(
  repository: DemandEventSourcingRepository,
  signal: AbortSignal | undefined,
): Promise<Readonly<AuditedDemandTargetResultHistory>> {
  try {
    return await repository.auditTargetResultHistory(signalOptions(signal));
  } catch (error: unknown) {
    mapRepositoryError(error);
  }
}

async function loadReworkSource(
  repository: DemandEventSourcingRepository,
  target: Readonly<DemandTargetTaskState>,
  signal: AbortSignal | undefined,
): Promise<ReworkSource> {
  if (target.phase !== "rework-requested")
    fail("precondition-failed", "rework-phase", "$request.targetTaskId");
  const history = await loadHistory(repository, signal);
  const decisionSource = history.targetReviewDecisions.find(
    (entry) =>
      entry.decision.targetReviewDecisionId ===
      target.currentDelivery.reviewDecision.targetReviewDecisionId,
  );
  const resultSource = history.targetResults.find(
    (entry) => entry.result.targetResultId === target.currentDelivery.targetResult.targetResultId,
  );
  if (decisionSource === undefined || resultSource === undefined) {
    fail("precondition-failed", "rework-history", "$request.targetTaskId");
  }
  try {
    return Object.freeze({
      decision: parseControllerImplementationReviewDecision(decisionSource.decision),
      previousResult: resultSource.result,
    });
  } catch (error: unknown) {
    if (error instanceof ControllerImplementationReviewDecisionError) {
      fail("precondition-failed", "rework-decision", "$request.targetTaskId", { cause: error });
    }
    throw error;
  }
}

async function loadRemediationSource(
  repository: DemandEventSourcingRepository,
  target: Readonly<DemandTargetTaskState>,
  signal: AbortSignal | undefined,
) {
  if (target.phase !== "product-defect-rework-requested") {
    fail("precondition-failed", "remediation-phase", "$request.targetTaskId");
  }
  const history = await loadHistory(repository, signal);
  const authorizationSource = history.productDefectRemediationAuthorizations.find(
    (entry) =>
      entry.authorization.productDefectRemediationId ===
      target.productDefectRemediation.productDefectRemediationId,
  );
  const resultSource = history.targetResults.find(
    (entry) => entry.result.targetResultId === target.currentDelivery.targetResult.targetResultId,
  );
  if (authorizationSource === undefined || resultSource === undefined) {
    fail("precondition-failed", "remediation-history", "$request.targetTaskId");
  }
  return Object.freeze({
    authorization: authorizationSource.authorization,
    previousResult: resultSource.result,
  });
}

/** 重跑范围来自 `request-another-attempt{stepIds}` 决定记录（§13.87 D6）。 */
async function loadRerunStepIds(
  repository: DemandEventSourcingRepository,
  targetReviewDecisionId: string,
  signal: AbortSignal | undefined,
): Promise<readonly string[] | null> {
  const history = await loadHistory(repository, signal);
  const decision = history.targetReviewDecisions.find(
    (entry) => entry.decision.targetReviewDecisionId === targetReviewDecisionId,
  )?.decision;
  if (decision?.kind !== "WakeflowControllerTestReviewDecision") {
    fail("precondition-failed", "rerun-decision", "$request.targetTaskId");
  }
  return decision.stepIds;
}

async function testAttemptFor(
  repository: DemandEventSourcingRepository,
  target: Readonly<DemandTargetTaskState>,
  taskPackage: Readonly<TestTaskPackage>,
  testAttemptId: WakeflowDurableId<"test-attempt">,
  signal: AbortSignal | undefined,
): Promise<Readonly<TestExecutionAttempt>> {
  if (target.workType !== "test")
    fail("precondition-failed", "target-work-type", "$request.targetTaskId");
  if (target.phase === "planned") {
    try {
      return createInitialTestExecutionAttempt({ testAttemptId, taskPackage });
    } catch (error: unknown) {
      mapRecordError(error, "$request.targetTaskId");
    }
  }
  if (target.phase !== "test-another-attempt-requested") {
    fail("precondition-failed", "rerun-phase", "$request.targetTaskId");
  }
  const previousAttempt = target.testAttempts.at(-1);
  if (previousAttempt === undefined)
    fail("precondition-failed", "rerun-history", "$request.targetTaskId");
  const stepIds = await loadRerunStepIds(
    repository,
    target.currentDelivery.reviewDecision.targetReviewDecisionId,
    signal,
  );
  try {
    return createRerunTestExecutionAttempt({
      testAttemptId,
      taskPackage,
      previousAttempt: previousAttempt.attempt,
      previousResult: {
        targetResultId: target.currentDelivery.targetResult.targetResultId,
        resultDigest: target.currentDelivery.targetResult.resultDigest,
      },
      reviewDecision: {
        targetReviewDecisionId: target.currentDelivery.reviewDecision.targetReviewDecisionId,
        decisionDigest: target.currentDelivery.reviewDecision.decisionDigest,
      },
      stepIds,
    });
  } catch (error: unknown) {
    mapRecordError(error, "$request.targetTaskId");
  }
}

function testContractSection(
  taskPackage: Readonly<TestTaskPackage>,
  attempt: Readonly<TestExecutionAttempt>,
): DeliveryTestContractSection {
  const contract = taskPackage.testContract;
  return Object.freeze({
    question: contract.question,
    objectBoundary: contract.objectBoundary,
    steps: contract.steps.map((step) =>
      Object.freeze({
        stepId: step.stepId,
        given: step.given,
        when: step.when,
        // biome-ignore lint/suspicious/noThenProperty: Given/When/Then 合同步骤字段（§13.85 D1）
        then: step.then,
      }),
    ),
    environmentMemberRef: contract.environment.memberRef,
    allowedSkills: contract.allowedSkills,
    setupDirective: attempt.environmentSetup.directive,
    attemptOrdinal: attempt.ordinal,
    maxAttempts: contract.maxAttempts,
    stopConditions: contract.stopConditions,
  });
}

interface PromptSources {
  readonly taskPackage: Readonly<TaskPackage>;
  readonly route: Readonly<WindowRoute>;
  readonly attachedWorktrees: readonly Readonly<{
    readonly repositoryId: string;
    readonly pathFromWindow: string;
  }>[];
  readonly rework: ReturnType<typeof createTargetDeliveryReworkContext> | null;
  readonly remediation: ReturnType<
    typeof createTargetDeliveryProductDefectRemediationContext
  > | null;
  readonly testContract: DeliveryTestContractSection | null;
}

function renderPrompt(
  context: SliceContext,
  input: PrepareInput,
  sources: PromptSources,
  pointer: Readonly<{
    readonly deliveryId: string;
    readonly claimDigest: string;
    readonly streamRevision: number;
    readonly generation: number;
  }>,
): string {
  const { taskPackage, route } = sources;
  const instructionFile = context.facade.resourceProfile.instructionFileName;
  const repositoryId =
    taskPackage.workType === "implementation" ? taskPackage.assignment.repositoryId : null;
  return renderDeliveryPortablePrompt({
    language: input.language,
    displayTitle: route.displayTitle,
    taskPackage,
    authored: {
      goal: input.authored.goal,
      focus: input.authored.focus,
      boundary: input.authored.boundary,
    },
    identity: {
      demandId: taskPackage.demandId,
      podId: `${route.podName} (${route.podId})`,
      windowId: route.binding.windowId,
      repositoryId,
      bindingId: route.binding.bindingId,
    },
    readingOrder: {
      workspaceRootFromWindow:
        route.worktreePath === null
          ? relativeWorkspaceRoot(route.configuredPlacement)
          : path.relative(route.worktreePath, context.workspaceRoot.absolutePath),
      attachedWorktrees: sources.attachedWorktrees,
      taskPackageRef: deliveryTaskPackageRef(taskPackage.demandId, taskPackage.taskPackageId),
      requirementSections:
        taskPackage.workType === "implementation" ? taskPackage.sectionAnchors : [],
      workspaceInstructionFile: instructionFile,
      repositoryInstructionFile: repositoryId === null ? null : instructionFile,
      stateRootRef: demandFinalRootRef(taskPackage.demandId),
    },
    returnPointer: pointer,
    rework: sources.rework,
    productDefectRemediation: sources.remediation,
    testContract: sources.testContract,
  });
}

async function replayPermit(
  context: SliceContext,
  commandResult: Readonly<Pick<DemandEventSourcingCommandResult, "commit" | "aggregate">>,
  eventType: "delivery.delivery-prepared" | "delivery.delivery-rearmed",
): Promise<PermitOutcome> {
  const { stored, event } = committedEvent(commandResult, eventType);
  const repository = new DemandEventSourcingRepository(context.authority.demandRoot);
  const deliveryId =
    event.eventType === "delivery.delivery-prepared"
      ? event.data.envelope.deliveryId
      : event.eventType === "delivery.delivery-rearmed"
        ? event.data.rearm.deliveryId
        : fail("precondition-failed", "commit-kind", "$request.idempotencyKey");
  const envelope =
    event.eventType === "delivery.delivery-prepared"
      ? event.data.envelope
      : await loadEnvelope(repository, deliveryId, context.options.signal);
  const generation =
    event.eventType === "delivery.delivery-rearmed" ? event.data.rearm.generation : 1;
  const fence =
    event.eventType === "delivery.delivery-rearmed" ? event.data.rearm.fence : envelope.fence;
  const route = await loadRoute(context, envelope.route.windowId);
  return Object.freeze({
    commandResult: Object.freeze({ disposition: "idempotent" as const, ...commandResult }),
    envelope,
    route,
    generation,
    fence: Object.freeze({ claimId: fence.claimId, claimDigest: fence.claimDigest }),
    issuedAt: event.recordedAt,
    eventId: stored.eventId,
  });
}

async function executePrepare(
  context: SliceContext,
  input: PrepareInput,
  binding: Readonly<AppendCommandBinding>,
): Promise<PermitOutcome> {
  const { authority, options } = context;
  const repository = new DemandEventSourcingRepository(authority.demandRoot);
  const bound = await boundCommit(repository, binding, options.signal);
  if (bound !== null) {
    if (bound.idempotency?.requestDigest !== binding.requestDigest) {
      fail("idempotency-mismatch", "request-digest", "$request.idempotencyKey");
    }
    return replayPermit(
      context,
      { commit: bound, aggregate: authority.loaded.aggregate },
      "delivery.delivery-prepared",
    );
  }
  assertFreshRevision(context, binding);
  const target = targetOf(context, input.targetTaskId);
  const currentGeneration =
    target.phase === "planned" || target.phase === "superseded"
      ? null
      : target.currentDelivery.generation;
  const blockers = derivePrepareBlockers({
    workType: target.workType === "test" ? "test" : "implementation",
    phase: target.phase,
    generation: currentGeneration,
  });
  if (blockers.length > 0) rejectWith(blockers, "$request.targetTaskId");
  const taskPackage = await loadTaskPackage(repository, target, options.signal);
  const route = await loadRoute(context, taskPackage.assignment.windowId);
  const demandId = authority.loaded.identity.demandId;
  const deliveryId = deriveDurableId(
    "target-delivery",
    "prepare-delivery",
    demandId,
    binding.idempotencyKey,
  );
  const claimId = deriveWorkClaimId("prepare-delivery", demandId, binding.idempotencyKey);
  const now = nowFrom(options);
  const sources = await prepareSources(context, repository, target, taskPackage, route, binding);
  const taken = await takeClaim(
    context,
    route,
    { demandId, targetTaskId: target.targetTaskId, deliveryId, generation: 1 },
    claimId,
    now,
  );
  try {
    const portablePrompt = renderPrompt(context, input, sources.prompt, {
      deliveryId,
      claimDigest: taken.claim.claimDigest,
      streamRevision: binding.expectedStreamRevision + 1,
      generation: 1,
    });
    const envelope = createEnvelope(input, sources, taken.claim, {
      deliveryId,
      taskPackage,
      route,
      portablePrompt,
      expectedStreamRevision: binding.expectedStreamRevision,
      preparedAt: now,
    });
    const command = parseDemandEventSourcingCommand({
      commandType: "delivery.prepare-delivery",
      commandVersion: 1,
      eventId: deriveDurableId(
        "demand-event",
        "prepare-delivery",
        demandId,
        binding.idempotencyKey,
      ),
      envelope,
      taskPackage,
      ...(sources.reworkSource === null ? {} : { reworkSource: sources.reworkSource }),
      ...(sources.remediationSource === null
        ? {}
        : { productDefectRemediationSource: sources.remediationSource }),
    });
    const commandResult = await appendCommand(repository, command, binding, options.signal);
    if (commandResult.disposition === "idempotent") {
      return replayPermit(context, commandResult, "delivery.delivery-prepared");
    }
    return Object.freeze({
      commandResult,
      envelope,
      route,
      generation: 1,
      fence: Object.freeze({ claimId: taken.claim.claimId, claimDigest: taken.claim.claimDigest }),
      issuedAt: now,
      eventId: committedEvent(commandResult, "delivery.delivery-prepared").stored.eventId,
    });
  } catch (error: unknown) {
    if (taken.created) await releaseQuietly(context, taken.claim);
    throw error;
  }
}

interface PrepareSources {
  readonly prompt: PromptSources;
  readonly attempt: Readonly<TestExecutionAttempt> | null;
  readonly reworkSource: ReworkSource | null;
  readonly remediationSource: Awaited<ReturnType<typeof loadRemediationSource>> | null;
}

async function prepareSources(
  context: SliceContext,
  repository: DemandEventSourcingRepository,
  target: Readonly<DemandTargetTaskState>,
  taskPackage: Readonly<TaskPackage>,
  route: Readonly<WindowRoute>,
  binding: Readonly<AppendCommandBinding>,
): Promise<PrepareSources> {
  const signal = context.options.signal;
  const attachedWorktrees = await attachedWorktreesFor(context, taskPackage, route);
  if (taskPackage.workType === "test") {
    const testAttemptId = deriveDurableId(
      "test-attempt",
      "prepare-delivery",
      taskPackage.demandId,
      binding.idempotencyKey,
    );
    const attempt = await testAttemptFor(repository, target, taskPackage, testAttemptId, signal);
    return Object.freeze({
      prompt: {
        taskPackage,
        route,
        attachedWorktrees,
        rework: null,
        remediation: null,
        testContract: testContractSection(taskPackage, attempt),
      },
      attempt,
      reworkSource: null,
      remediationSource: null,
    });
  }
  try {
    if (target.phase === "rework-requested") {
      const reworkSource = await loadReworkSource(repository, target, signal);
      const rework = createTargetDeliveryReworkContext(reworkSource);
      return Object.freeze({
        prompt: {
          taskPackage,
          route,
          attachedWorktrees,
          rework,
          remediation: null,
          testContract: null,
        },
        attempt: null,
        reworkSource,
        remediationSource: null,
      });
    }
    if (target.phase === "product-defect-rework-requested") {
      const remediationSource = await loadRemediationSource(repository, target, signal);
      const remediation = createTargetDeliveryProductDefectRemediationContext(remediationSource);
      return Object.freeze({
        prompt: {
          taskPackage,
          route,
          attachedWorktrees,
          rework: null,
          remediation,
          testContract: null,
        },
        attempt: null,
        reworkSource: null,
        remediationSource,
      });
    }
  } catch (error: unknown) {
    mapRecordError(error, "$request.targetTaskId");
  }
  return Object.freeze({
    prompt: {
      taskPackage,
      route,
      attachedWorktrees,
      rework: null,
      remediation: null,
      testContract: null,
    },
    attempt: null,
    reworkSource: null,
    remediationSource: null,
  });
}

function createEnvelope(
  input: PrepareInput,
  sources: PrepareSources,
  claim: Readonly<WorkClaim>,
  facts: Readonly<{
    readonly deliveryId: WakeflowDurableId<"target-delivery">;
    readonly taskPackage: Readonly<TaskPackage>;
    readonly route: Readonly<WindowRoute>;
    readonly portablePrompt: string;
    readonly expectedStreamRevision: number;
    readonly preparedAt: UtcInstant;
  }>,
): Readonly<DeliveryEnvelope> {
  const { taskPackage, route } = facts;
  const shared = {
    deliveryId: facts.deliveryId,
    programId: taskPackage.programId,
    configDigest: taskPackage.configDigest,
    demandId: taskPackage.demandId,
    target: {
      targetTaskId: taskPackage.targetTaskId,
      taskPackageId: taskPackage.taskPackageId,
      taskPackageRef: deliveryTaskPackageRef(taskPackage.demandId, taskPackage.taskPackageId),
      taskPackageDigest: computeTaskPackageDigest(taskPackage),
    },
    route: {
      hostId: route.binding.hostId,
      windowId: route.binding.windowId,
      bindingId: route.binding.bindingId,
      bindingDigest: route.bindingDigest,
    },
    language: input.language,
    portablePrompt: facts.portablePrompt,
    promptDigest: computeDeliveryPromptDigest(facts.portablePrompt),
    fence: {
      claimId: claim.claimId,
      claimDigest: claim.claimDigest,
      expectedStreamRevision: facts.expectedStreamRevision,
    },
    preparedAt: facts.preparedAt,
  };
  try {
    if (taskPackage.workType === "test") {
      if (sources.attempt === null) fail("unexpected", "attempt-missing", "$request.targetTaskId");
      return createDeliveryEnvelope({
        ...shared,
        workType: "test",
        attempt: sources.attempt,
      });
    }
    return createDeliveryEnvelope({
      ...shared,
      workType: "implementation",
      ...(sources.prompt.rework === null ? {} : { rework: sources.prompt.rework }),
      ...(sources.prompt.remediation === null
        ? {}
        : { productDefectRemediation: sources.prompt.remediation }),
    });
  } catch (error: unknown) {
    mapRecordError(error, "$request.targetTaskId");
  }
}

function permitBody(
  envelope: Readonly<AppendCommandEnvelope>,
  outcome: PermitOutcome,
  nextProjection: Readonly<NextProjection>,
) {
  const { commandResult, route } = outcome;
  const stored = commandResult.commit.events[0];
  if (stored === undefined) fail("unexpected", "commit-empty", "$result");
  const targetTaskId = outcome.envelope.target.targetTaskId;
  const target = commandResult.aggregate.state.targetTasks.find(
    (entry) => entry.targetTaskId === targetTaskId,
  );
  if (target === undefined) fail("unexpected", "target-missing", "$result");
  return {
    schemaVersion: WAKEFLOW_DELIVERY_PUBLIC_SCHEMA_VERSION,
    demandId: envelope.demandId,
    delivery: {
      deliveryId: outcome.envelope.deliveryId,
      envelopeDigest: outcome.envelope.envelopeDigest,
      promptDigest: outcome.envelope.promptDigest,
      generation: outcome.generation,
      workType: outcome.envelope.workType,
      targetTaskId,
      windowId: outcome.envelope.route.windowId,
      phase: target.phase,
    },
    permit: {
      prompt: outcome.envelope.portablePrompt,
      hostAction: {
        effect: "send-prompt-to-window",
        hostId: route.binding.hostId,
        windowId: route.binding.windowId,
        displayTitle: route.displayTitle,
        bindingId: route.binding.bindingId,
        handleDigest: route.handleDigest,
      },
      fence: {
        claimId: outcome.fence.claimId,
        claimDigest: outcome.fence.claimDigest,
        streamRevision: stored.streamRevision,
      },
      issuedAt: outcome.issuedAt,
    },
    event: { eventId: outcome.eventId, streamRevision: stored.streamRevision },
    commit: {
      commitId: commandResult.commit.commitId,
      commitSequence: commandResult.commit.commitSequence,
      commitDigest: computeDemandEventStreamCommitDigest(commandResult.commit),
    },
    stateDigest: commandResult.aggregate.stateDigest,
    next: {
      frontier: nextProjection.frontier,
      owner: nextProjection.owner,
      suggestedTool: nextProjection.suggestedTool,
      blockers: [...nextProjection.blockers],
    },
  };
}

function prepareResult(
  envelope: Readonly<AppendCommandEnvelope>,
  outcome: PermitOutcome,
  nextProjection: Readonly<NextProjection>,
): PrepareDeliveryResult {
  return admitPrepareDeliveryResult({
    kind: "WakeflowPrepareDeliveryResult",
    tool: WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME,
    status: outcome.commandResult.disposition,
    ...permitBody(envelope, outcome, nextProjection),
  });
}

function callbackPermitBody(
  envelope: Readonly<AppendCommandEnvelope>,
  outcome: CallbackPermitOutcome,
  nextProjection: Readonly<NextProjection>,
) {
  const { commandResult, route } = outcome;
  const stored = commandResult.commit.events[0];
  if (stored === undefined) fail("unexpected", "commit-empty", "$result");
  return {
    schemaVersion: WAKEFLOW_DELIVERY_PUBLIC_SCHEMA_VERSION,
    demandId: envelope.demandId,
    delivery: {
      deliveryId: outcome.callbackId,
      // 回调没有信封：绑定的是结果本身，这里记结果摘要。
      envelopeDigest: outcome.resultDigest,
      promptDigest: outcome.promptDigest,
      generation: outcome.generation,
      workType: "callback",
      targetTaskId: outcome.targetTaskId,
      windowId: route.binding.windowId,
      phase: outcome.phase,
    },
    permit: {
      prompt: outcome.prompt,
      hostAction: {
        effect: "send-prompt-to-window",
        hostId: route.binding.hostId,
        windowId: route.binding.windowId,
        displayTitle: route.displayTitle,
        bindingId: route.binding.bindingId,
        handleDigest: route.handleDigest,
      },
      fence: null,
      issuedAt: outcome.issuedAt,
    },
    event: { eventId: outcome.eventId, streamRevision: stored.streamRevision },
    commit: {
      commitId: commandResult.commit.commitId,
      commitSequence: commandResult.commit.commitSequence,
      commitDigest: computeDemandEventStreamCommitDigest(commandResult.commit),
    },
    stateDigest: commandResult.aggregate.stateDigest,
    next: {
      frontier: nextProjection.frontier,
      owner: nextProjection.owner,
      suggestedTool: nextProjection.suggestedTool,
      blockers: [...nextProjection.blockers],
    },
  };
}

function rearmResult(
  envelope: Readonly<AppendCommandEnvelope>,
  outcome: RearmOutcome,
  nextProjection: Readonly<NextProjection>,
): RearmDeliveryResult {
  const status = outcome.commandResult.disposition === "committed" ? "rearmed" : "idempotent";
  if (isCallbackPermit(outcome)) {
    return admitRearmDeliveryResult({
      kind: "WakeflowRearmDeliveryResult",
      tool: WAKEFLOW_REARM_DELIVERY_PUBLIC_TOOL_NAME,
      status,
      rearm: {
        kind: "callback",
        previousGeneration: outcome.generation - 1,
        generation: outcome.generation,
      },
      ...callbackPermitBody(envelope, outcome, nextProjection),
    });
  }
  return admitRearmDeliveryResult({
    kind: "WakeflowRearmDeliveryResult",
    tool: WAKEFLOW_REARM_DELIVERY_PUBLIC_TOOL_NAME,
    status,
    rearm: {
      kind: "target",
      previousGeneration: outcome.generation - 1,
      generation: outcome.generation,
    },
    ...permitBody(envelope, outcome, nextProjection),
  });
}

/** 执行一次 `wakeflow_prepare_delivery`。 */
export async function executePrepareDeliveryRequest(
  facade: Readonly<DeliveryHostFacade>,
  value: unknown,
  options: ExecuteDeliveryOptions = {},
): Promise<PrepareDeliveryResult> {
  return runAppendCommand<PrepareInput, SliceContext, PermitOutcome, PrepareDeliveryResult>(
    {
      tool: WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME,
      parseRequest: (raw) => {
        const request = parsePrepareDeliveryRequest(raw);
        return Object.freeze({
          envelope: Object.freeze({
            root: request.root,
            demandId: request.demandId,
            idempotencyKey: request.idempotencyKey,
            expectedStreamRevision: request.expectedStreamRevision,
          }),
          input: Object.freeze({
            targetTaskId: request.targetTaskId,
            authored: request.authored,
            language: request.language ?? "en",
          }),
        });
      },
      open: (workspaceRoot, envelope) => openContext(workspaceRoot, envelope, facade, options),
      close: closeContext,
      privateValues: (context) => [context.authority.ledgerRoot.absolutePath],
      execute: (context, input, binding) =>
        afterMutationRefresh(context.workspaceRoot, context.options.signal, () =>
          executePrepare(context, input, binding),
        ),
      next,
      result: prepareResult,
    },
    value,
    commandShellExecutionOptions(options.durability),
  );
}

// ---- outcome ------------------------------------------------------------------

interface OutcomeInput {
  readonly deliveryId: string;
  readonly claimDigest: string;
  readonly attempt: RecordDeliveryOutcomeRequest["attempt"];
  readonly readback: RecordDeliveryOutcomeRequest["readback"] | undefined;
  readonly resolution: RecordDeliveryOutcomeRequest["resolution"] | undefined;
  readonly observedAt: UtcInstant;
}

async function sessionRecords(
  context: SliceContext,
  sessionId: string,
  since: UtcInstant,
): Promise<readonly Readonly<HookLandingRecord & { readonly event: string }>[]> {
  const inventory = await readHostHookObservations(
    context.workspaceRoot,
    context.facade.hostId,
    { sessionId, since },
    signalOptions(context.options.signal),
  );
  return inventory.records.map((record) =>
    Object.freeze({
      recordId: record.recordId,
      promptDigest: record.promptDigest,
      recordedAt: record.recordedAt,
      event: record.event,
    }),
  );
}

function outcomeDraft(
  input: OutcomeInput,
  target: Readonly<DeliveryBearingTarget>,
  decision: ReturnType<typeof deriveDeliveryDisposition>,
): Readonly<DeliveryOutcome> {
  if (!decision.accepted) rejectWith([decision.blocker], "$request.attempt");
  const attemptDigest = input.attempt.evidenceDigest ?? null;
  const readback = input.readback ?? { status: "unavailable" as const };
  try {
    return createDeliveryOutcome({
      deliveryId: target.currentDelivery.deliveryId,
      generation: target.currentDelivery.generation,
      fence: {
        claimId: target.currentDelivery.fence.claimId,
        claimDigest: target.currentDelivery.fence.claimDigest,
      },
      disposition: decision.disposition,
      attempt: {
        status: input.attempt.status,
        evidenceDigest: attemptDigest as Sha256Digest | null,
      },
      readback: {
        status: readback.status,
        evidenceDigest: (readback.evidenceDigest ?? null) as Sha256Digest | null,
      },
      evidence: {
        kind: decision.evidenceKind,
        hookRecordId: decision.hookRecordId,
        rationale: decision.rationale,
      },
      observedAt: input.observedAt,
    });
  } catch (error: unknown) {
    mapRecordError(error, "$request.attempt");
  }
}

function replayOutcome(
  context: SliceContext,
  target: Readonly<DeliveryBearingTarget>,
  bound: NonNullable<Awaited<ReturnType<typeof boundCommit>>>,
  binding: Readonly<AppendCommandBinding>,
): OutcomeOutcome {
  if (bound.idempotency?.requestDigest !== binding.requestDigest) {
    fail("idempotency-mismatch", "request-digest", "$request.idempotencyKey");
  }
  const { stored, event } = committedEvent({ commit: bound }, "delivery.delivery-outcome-recorded");
  if (event.eventType !== "delivery.delivery-outcome-recorded") {
    fail("unexpected", "commit-kind", "$result");
  }
  return Object.freeze({
    commandResult: Object.freeze({
      disposition: "idempotent" as const,
      commit: bound,
      aggregate: context.authority.loaded.aggregate,
    }),
    outcome: event.data.outcome,
    targetTaskId: target.targetTaskId,
    workType: target.workType === "test" ? ("test" as const) : ("implementation" as const),
    eventId: stored.eventId,
  });
}

function assertOutcomeRecordable(
  target: Readonly<DeliveryBearingTarget>,
  claimDigest: string,
): boolean {
  if (target.currentDelivery.fence.claimDigest !== claimDigest) {
    fail("precondition-failed", "fence-mismatch", "$request.claimDigest");
  }
  const currentlyIndeterminate =
    target.phase === "host-effect-indeterminate" ||
    target.phase === "test-host-effect-indeterminate";
  if (
    !currentlyIndeterminate &&
    target.phase !== "delivery-prepared" &&
    target.phase !== "test-delivery-prepared"
  ) {
    rejectWith([`target-phase:${target.phase}`], "$request.deliveryId");
  }
  return currentlyIndeterminate;
}

function decideOutcome(
  context: SliceContext,
  input: OutcomeInput,
  envelope: Readonly<DeliveryEnvelope>,
  records: readonly Readonly<HookLandingRecord & { readonly event: string }>[],
  currentlyIndeterminate: boolean,
): ReturnType<typeof deriveDeliveryDisposition> {
  const resolution = input.resolution;
  const landing = records.filter((record) => record.event === "user-prompt-submit");
  return deriveDeliveryDisposition({
    hostId: context.facade.hostId,
    attempt: {
      status: input.attempt.status,
      evidenceDigest: (input.attempt.evidenceDigest ?? null) as Sha256Digest | null,
    },
    readback: {
      status: input.readback?.status ?? "unavailable",
      evidenceDigest: (input.readback?.evidenceDigest ?? null) as Sha256Digest | null,
    },
    landingRecords: landing,
    expectedPromptDigest: envelope.promptDigest,
    resolution:
      resolution === undefined
        ? null
        : {
            disposition: resolution.disposition,
            hookRecordId: resolution.hookRecordId ?? null,
            rationale: resolution.rationale,
          },
    // 显式解决引用的证据必须是落地记录本身，与自动判定同一标准。
    resolutionRecordFound:
      resolution?.hookRecordId !== undefined &&
      landing.some((record) => record.recordId === resolution.hookRecordId),
    currentlyIndeterminate,
  });
}

async function executeOutcome(
  context: SliceContext,
  input: OutcomeInput,
  binding: Readonly<AppendCommandBinding>,
): Promise<OutcomeOutcome> {
  const { authority, options } = context;
  const repository = new DemandEventSourcingRepository(authority.demandRoot);
  const target = deliveryTargetOf(context, input.deliveryId);
  const bound = await boundCommit(repository, binding, options.signal);
  if (bound !== null) {
    const replayed = replayOutcome(context, target, bound, binding);
    // 追加已提交而释放未完成的裂缝由重放路径补做；助手对缺失或已易主的声明无事可做。
    if (replayed.outcome.claimHandling === "release-authorized") {
      await releaseClaimFor(context, target.windowId, replayed.outcome.fence);
    }
    return replayed;
  }
  assertFreshRevision(context, binding);
  const currentlyIndeterminate = assertOutcomeRecordable(target, input.claimDigest);
  const envelope = await loadEnvelope(repository, input.deliveryId, options.signal);
  const route = await loadRoute(context, envelope.route.windowId);
  const records = await sessionRecords(context, route.binding.handle.value, envelope.preparedAt);
  const decision = decideOutcome(context, input, envelope, records, currentlyIndeterminate);
  if (!decision.accepted) {
    const blockers = [decision.blocker];
    if (
      decision.blocker === "landing-evidence-missing" &&
      (await silenceExceededFor(repository, input.deliveryId, input.observedAt, options.signal))
    ) {
      blockers.push("landing-silence-exceeded");
    }
    rejectWith(blockers, "$request.attempt");
  }
  const outcome = outcomeDraft(input, target, decision);
  const command = parseDemandEventSourcingCommand({
    commandType: "delivery.record-delivery-outcome",
    commandVersion: 1,
    eventId: deriveDurableId(
      "demand-event",
      "record-delivery-outcome",
      authority.loaded.identity.demandId,
      binding.idempotencyKey,
    ),
    outcome,
  });
  const commandResult = await appendCommand(repository, command, binding, options.signal);
  const committed = committedEvent(commandResult, "delivery.delivery-outcome-recorded");
  if (outcome.claimHandling === "release-authorized") {
    await releaseClaimFor(context, route.binding.windowId, outcome.fence);
  }
  return Object.freeze({
    commandResult,
    outcome,
    targetTaskId: target.targetTaskId,
    workType: target.workType === "test" ? ("test" as const) : ("implementation" as const),
    eventId: committed.stored.eventId,
  });
}

/** 只释放仍属于本次投递的声明；缺失或已易主（例如已被 rearm 重取）都不是错误。 */
async function releaseClaimFor(
  context: SliceContext,
  windowId: string,
  fence: Readonly<{ readonly claimId: string; readonly claimDigest: string }>,
): Promise<void> {
  await releaseWorkClaimIfHeld(
    context.workspaceRoot,
    windowId,
    fence,
    signalOptions(context.options.signal),
  );
}

async function silenceExceededFor(
  repository: DemandEventSourcingRepository,
  deliveryId: string,
  now: UtcInstant,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  try {
    const outcomes = await repository.findDeliveryOutcomeRecordedEvents(
      deliveryId,
      signalOptions(signal),
    );
    const first = outcomes.find(
      (entry) => entry.event.data.outcome.disposition === "indeterminate",
    );
    return first !== undefined && landingSilenceExceeded(first.event.recordedAt, now);
  } catch (error: unknown) {
    mapRepositoryError(error);
  }
}

function outcomeResult(
  envelope: Readonly<AppendCommandEnvelope>,
  outcome: OutcomeOutcome,
  nextProjection: Readonly<NextProjection>,
): RecordDeliveryOutcomeResult {
  const { commandResult } = outcome;
  const stored = commandResult.commit.events[0];
  if (stored === undefined) fail("unexpected", "commit-empty", "$result");
  const target = commandResult.aggregate.state.targetTasks.find(
    (entry) => entry.targetTaskId === outcome.targetTaskId,
  );
  if (target === undefined) fail("unexpected", "target-missing", "$result");
  const blockers = [...nextProjection.blockers];
  if (outcome.outcome.disposition === "indeterminate") blockers.push("landing-evidence-missing");
  return admitRecordDeliveryOutcomeResult({
    kind: "WakeflowRecordDeliveryOutcomeResult",
    schemaVersion: WAKEFLOW_DELIVERY_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_RECORD_DELIVERY_OUTCOME_PUBLIC_TOOL_NAME,
    status: commandResult.disposition === "committed" ? "recorded" : "idempotent",
    demandId: envelope.demandId,
    outcome: {
      deliveryId: outcome.outcome.deliveryId,
      generation: outcome.outcome.generation,
      disposition: outcome.outcome.disposition,
      evidenceKind: outcome.outcome.evidence.kind,
      hookRecordId: outcome.outcome.evidence.hookRecordId,
      claimHandling: outcome.outcome.claimHandling,
      observedAt: outcome.outcome.observedAt,
      outcomeDigest: outcome.outcome.outcomeDigest,
    },
    target: { targetTaskId: outcome.targetTaskId, workType: outcome.workType, phase: target.phase },
    event: { eventId: outcome.eventId, streamRevision: stored.streamRevision },
    commit: {
      commitId: commandResult.commit.commitId,
      commitSequence: commandResult.commit.commitSequence,
      commitDigest: computeDemandEventStreamCommitDigest(commandResult.commit),
    },
    stateDigest: commandResult.aggregate.stateDigest,
    next: {
      frontier: nextProjection.frontier,
      owner: nextProjection.owner,
      suggestedTool: nextProjection.suggestedTool,
      blockers,
    },
  });
}

/** 执行一次 `wakeflow_record_delivery_outcome`。 */
export async function executeRecordDeliveryOutcomeRequest(
  facade: Readonly<DeliveryHostFacade>,
  value: unknown,
  options: ExecuteDeliveryOptions = {},
): Promise<RecordDeliveryOutcomeResult> {
  return runAppendCommand<OutcomeInput, SliceContext, OutcomeOutcome, RecordDeliveryOutcomeResult>(
    {
      tool: WAKEFLOW_RECORD_DELIVERY_OUTCOME_PUBLIC_TOOL_NAME,
      parseRequest: (raw) => {
        const request = parseRecordDeliveryOutcomeRequest(raw);
        return Object.freeze({
          envelope: Object.freeze({
            root: request.root,
            demandId: request.demandId,
            idempotencyKey: request.idempotencyKey,
            expectedStreamRevision: request.expectedStreamRevision,
          }),
          input: Object.freeze({
            deliveryId: request.deliveryId,
            claimDigest: request.claimDigest,
            attempt: request.attempt,
            readback: request.readback,
            resolution: request.resolution,
            observedAt: parseInstant(request.observedAt, "$request.observedAt"),
          }),
        });
      },
      open: (workspaceRoot, envelope) => openContext(workspaceRoot, envelope, facade, options),
      close: closeContext,
      privateValues: (context) => [context.authority.ledgerRoot.absolutePath],
      execute: (context, input, binding) =>
        afterMutationRefresh(context.workspaceRoot, context.options.signal, () =>
          executeOutcome(context, input, binding),
        ),
      next,
      result: outcomeResult,
    },
    value,
    commandShellExecutionOptions(options.durability),
  );
}

// ---- rearm --------------------------------------------------------------------

interface RearmInput {
  readonly deliveryId: string;
}

type ResultBearingTarget = Extract<
  DemandTargetTaskState,
  { readonly phase: "result-reported" | "test-result-reported" }
>;

/** 回调 id 命中某个已回报结果的当前回调即走回调分支；否则按投递 id 查找。 */
function callbackTargetOf(
  context: SliceContext,
  callbackId: string,
): Readonly<ResultBearingTarget> | null {
  const target = context.authority.loaded.aggregate.state.targetTasks.find(
    (entry): entry is ResultBearingTarget =>
      (entry.phase === "result-reported" || entry.phase === "test-result-reported") &&
      entry.currentDelivery.targetResult.callback.callbackId === callbackId,
  );
  return target ?? null;
}

async function replayCallbackReissue(
  context: SliceContext,
  commandResult: Readonly<Pick<DemandEventSourcingCommandResult, "commit" | "aggregate">>,
): Promise<CallbackPermitOutcome> {
  const stored = commandResult.commit.events[0];
  if (stored === undefined) fail("precondition-failed", "commit-empty", "$request.idempotencyKey");
  const event = upcastDemandEventSourcingStoredEvent(stored);
  if (event.eventType !== "result.callback-reissued") {
    fail("precondition-failed", "commit-kind", "$request.idempotencyKey");
  }
  const reissue = event.data.reissue;
  const target = callbackTargetOf(context, reissue.callbackId);
  if (target === null) fail("precondition-failed", "callback-phase", "$request.deliveryId");
  const located = await loadResultEvent(context, target.currentDelivery.fence.claimId);
  const route = await loadRoute(context, reissue.controllerWindowId);
  return Object.freeze({
    kind: "callback" as const,
    commandResult: Object.freeze({ disposition: "idempotent" as const, ...commandResult }),
    targetTaskId: target.targetTaskId,
    workType: target.workType === "test" ? ("test" as const) : ("implementation" as const),
    phase: target.phase,
    callbackId: reissue.callbackId,
    resultDigest: target.currentDelivery.targetResult.resultDigest,
    prompt: located.callback.portablePrompt,
    promptDigest: reissue.promptDigest,
    route,
    generation: reissue.generation,
    issuedAt: reissue.issuedAt,
    eventId: stored.eventId,
  });
}

async function loadResultEvent(context: SliceContext, claimId: WakeflowDurableId<"work-claim">) {
  const repository = new DemandEventSourcingRepository(context.authority.demandRoot);
  try {
    const located = await repository.findTargetResultRecordedEvent(
      claimId,
      signalOptions(context.options.signal),
    );
    if (located === null) fail("precondition-failed", "result-missing", "$request.deliveryId");
    return located.event.data;
  } catch (error: unknown) {
    mapRepositoryError(error);
  }
}

/**
 * 回调重发（§13.87 D1）：只在 silent（签发后超过静默阈值仍无落地记录）时允许；不取声明，
 * 按当前 Controller 绑定重算目标（绑定已换即旧代际作废），代际加一，上限三次。
 */
async function executeCallbackReissue(
  context: SliceContext,
  target: Readonly<ResultBearingTarget>,
  binding: Readonly<AppendCommandBinding>,
): Promise<CallbackPermitOutcome> {
  const { authority, options } = context;
  const callback = target.currentDelivery.targetResult.callback;
  if (callback.generation >= TARGET_RESULT_CALLBACK_GENERATION_LIMIT) {
    rejectWith([`callback-limit:${callback.generation}`], "$request.deliveryId");
  }
  const route = await loadRoute(context, callback.controllerWindowId);
  const now = nowFrom(options);
  const records = await sessionRecords(context, route.binding.handle.value, callback.issuedAt);
  const status = deriveTargetResultCallbackStatus({
    issuedAt: callback.issuedAt,
    promptDigest: callback.promptDigest,
    landingRecords: records,
    acknowledged: false,
    now,
    silenceMilliseconds: TARGET_RESULT_CALLBACK_SILENCE_MILLISECONDS,
  });
  if (status.status !== "silent") rejectWith([`callback-${status.status}`], "$request.deliveryId");
  const located = await loadResultEvent(context, target.currentDelivery.fence.claimId);
  let reissue: Readonly<TargetResultCallbackReissue>;
  try {
    reissue = parseTargetResultCallbackReissue({
      targetResultId: target.currentDelivery.targetResult.targetResultId,
      callbackId: callback.callbackId,
      previousGeneration: callback.generation,
      generation: callback.generation + 1,
      controllerWindowId: callback.controllerWindowId,
      bindingId: route.binding.bindingId,
      bindingDigest: route.bindingDigest,
      promptDigest: callback.promptDigest,
      issuedAt: now,
    });
  } catch (error: unknown) {
    mapRecordError(error, "$request.deliveryId");
  }
  const demandId = authority.loaded.identity.demandId;
  const command = parseDemandEventSourcingCommand({
    commandType: "result.reissue-callback",
    commandVersion: 1,
    eventId: deriveDurableId("demand-event", "reissue-callback", demandId, binding.idempotencyKey),
    reissue,
  });
  const repository = new DemandEventSourcingRepository(authority.demandRoot);
  const commandResult = await appendCommand(repository, command, binding, options.signal);
  if (commandResult.disposition === "idempotent")
    return replayCallbackReissue(context, commandResult);
  const stored = commandResult.commit.events[0];
  if (stored === undefined) fail("unexpected", "commit-empty", "$result");
  return Object.freeze({
    kind: "callback" as const,
    commandResult,
    targetTaskId: target.targetTaskId,
    workType: target.workType === "test" ? ("test" as const) : ("implementation" as const),
    phase: target.phase,
    callbackId: callback.callbackId,
    resultDigest: target.currentDelivery.targetResult.resultDigest,
    prompt: located.callback.portablePrompt,
    promptDigest: callback.promptDigest,
    route,
    generation: reissue.generation,
    issuedAt: now,
    eventId: stored.eventId,
  });
}

async function executeRearm(
  context: SliceContext,
  input: RearmInput,
  binding: Readonly<AppendCommandBinding>,
): Promise<RearmOutcome> {
  const { authority, options } = context;
  const repository = new DemandEventSourcingRepository(authority.demandRoot);
  const bound = await boundCommit(repository, binding, options.signal);
  if (bound !== null) {
    if (bound.idempotency?.requestDigest !== binding.requestDigest) {
      fail("idempotency-mismatch", "request-digest", "$request.idempotencyKey");
    }
    const replayed = { commit: bound, aggregate: authority.loaded.aggregate };
    return bound.events[0].eventType === "result.callback-reissued"
      ? replayCallbackReissue(context, replayed)
      : replayPermit(context, replayed, "delivery.delivery-rearmed");
  }
  assertFreshRevision(context, binding);
  const callbackTarget = callbackTargetOf(context, input.deliveryId);
  if (callbackTarget !== null) return executeCallbackReissue(context, callbackTarget, binding);
  const target = deliveryTargetOf(context, input.deliveryId);
  const blockers = deriveRearmBlockers({
    phase: target.phase,
    generation: target.currentDelivery.generation,
  });
  if (blockers.length > 0) rejectWith(blockers, "$request.deliveryId");
  if (!("outcome" in target.currentDelivery)) {
    fail("precondition-failed", "outcome-missing", "$request.deliveryId");
  }
  const currentOutcome: Readonly<DemandDeliveryOutcomeSummary> = target.currentDelivery.outcome;
  const current: Readonly<DemandCurrentDeliveryBase> = target.currentDelivery;
  const envelope = await loadEnvelope(repository, input.deliveryId, options.signal);
  const route = await loadRoute(context, envelope.route.windowId);
  if (route.binding.bindingId !== envelope.route.bindingId) {
    fail("precondition-failed", "binding-changed", "$request.deliveryId");
  }
  const demandId = authority.loaded.identity.demandId;
  const claimId = deriveWorkClaimId("rearm-delivery", demandId, binding.idempotencyKey);
  const now = nowFrom(options);
  const generation = current.generation + 1;
  const taken = await takeClaim(
    context,
    route,
    { demandId, targetTaskId: target.targetTaskId, deliveryId: envelope.deliveryId, generation },
    claimId,
    now,
  );
  try {
    let rearm: Readonly<DeliveryRearm>;
    try {
      rearm = createDeliveryRearm({
        deliveryId: envelope.deliveryId,
        previousGeneration: current.generation,
        generation,
        previousFence: { claimId: current.fence.claimId, claimDigest: current.fence.claimDigest },
        rejectedOutcomeDigest: currentOutcome.outcomeDigest,
        fence: {
          claimId: taken.claim.claimId,
          claimDigest: taken.claim.claimDigest,
          expectedStreamRevision: binding.expectedStreamRevision,
        },
        rearmedAt: now,
      });
    } catch (error: unknown) {
      mapRecordError(error, "$request.deliveryId");
    }
    const command = parseDemandEventSourcingCommand({
      commandType: "delivery.rearm-delivery",
      commandVersion: 1,
      eventId: deriveDurableId("demand-event", "rearm-delivery", demandId, binding.idempotencyKey),
      rearm,
    });
    const commandResult = await appendCommand(repository, command, binding, options.signal);
    if (commandResult.disposition === "idempotent") {
      return replayPermit(context, commandResult, "delivery.delivery-rearmed");
    }
    return Object.freeze({
      commandResult,
      envelope,
      route,
      generation,
      fence: Object.freeze({ claimId: taken.claim.claimId, claimDigest: taken.claim.claimDigest }),
      issuedAt: now,
      eventId: committedEvent(commandResult, "delivery.delivery-rearmed").stored.eventId,
    });
  } catch (error: unknown) {
    if (taken.created) await releaseQuietly(context, taken.claim);
    throw error;
  }
}

/** 执行一次 `wakeflow_rearm_delivery`。 */
export async function executeRearmDeliveryRequest(
  facade: Readonly<DeliveryHostFacade>,
  value: unknown,
  options: ExecuteDeliveryOptions = {},
): Promise<RearmDeliveryResult> {
  return runAppendCommand<RearmInput, SliceContext, RearmOutcome, RearmDeliveryResult>(
    {
      tool: WAKEFLOW_REARM_DELIVERY_PUBLIC_TOOL_NAME,
      parseRequest: (raw) => {
        const request = parseRearmDeliveryRequest(raw);
        return Object.freeze({
          envelope: Object.freeze({
            root: request.root,
            demandId: request.demandId,
            idempotencyKey: request.idempotencyKey,
            expectedStreamRevision: request.expectedStreamRevision,
          }),
          input: Object.freeze({ deliveryId: request.deliveryId }),
        });
      },
      open: (workspaceRoot, envelope) => openContext(workspaceRoot, envelope, facade, options),
      close: closeContext,
      privateValues: (context) => [context.authority.ledgerRoot.absolutePath],
      execute: (context, input, binding) =>
        afterMutationRefresh(context.workspaceRoot, context.options.signal, () =>
          executeRearm(context, input, binding),
        ),
      next,
      result: rearmResult,
    },
    value,
    commandShellExecutionOptions(options.durability),
  );
}
