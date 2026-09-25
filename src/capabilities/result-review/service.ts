import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { WakeflowHostId } from "../../contracts/vocabulary/wakeflow-host-id.js";
import type { WakeflowErrorCode } from "../../contracts/vocabulary/wakeflow-error-code.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  computeSha256Digest,
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import { parseJsonValue } from "../../foundation/data/json-value.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
} from "../../foundation/filesystem/portable-resource-path.js";
import type {
  RootedDirectory,
  RootedDirectoryDurability,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableFile,
  StableFileReadError,
} from "../../foundation/filesystem/stable-file-read.js";
import { deriveUuidV4, type UuidV4Factory } from "../../foundation/identity/uuid-v4.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import type { UtcInstant } from "../../foundation/time/utc-instant.js";
import { readUtcWallClock, type UtcWallClock } from "../../foundation/time/wall-clock.js";
import { buildDemandControllerRoute } from "../../governance/controller/demand-controller-route.js";
import type { DeliveryEnvelope } from "../../governance/delivery/delivery-envelope.js";
import {
  closeDemandOperationAuthorityContext,
  DemandOperationAuthorityContextError,
  openDemandOperationAuthorityContext,
  openDemandReadAuthorityContext,
  type DemandOperationAuthorityContext,
} from "../../governance/demand/demand-operation-authority-context.js";
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
import { parseDemandEventStreamRevision } from "../../governance/demand/event-sourcing/demand-event-stream-position.js";
import { upcastDemandEventSourcingStoredEvent } from "../../governance/demand/event-sourcing/demand-event-sourcing-upcaster.js";
import type { DemandEventSourcingStoredEvent } from "../../governance/demand/event-sourcing/demand-event-sourcing-stored-event.js";
import {
  computeDemandAggregateStateDigest,
  decideTargetResultReviewInDemandAggregateState,
  type DemandTargetTaskState,
} from "../../governance/demand/model/demand-aggregate-state.js";
import {
  MANAGED_EVIDENCE_MANIFEST_MAXIMUM_BYTES,
  MANAGED_EVIDENCE_PAYLOAD_LIMITS,
} from "../../governance/evidence/managed-evidence-manifest.js";
import {
  loadManagedEvidenceRecord,
  ManagedEvidenceRecordReaderError,
  readManagedEvidencePayloadMember,
} from "../../governance/evidence/managed-evidence-record-reader.js";
import { managedEvidenceRecordAddress } from "../../governance/evidence/managed-evidence-resource-paths.js";
import {
  createImplementationTargetResult,
  ImplementationTargetResultError,
} from "../../governance/result/implementation-target-result.js";
import {
  createImplementationTargetResultReport,
  ImplementationTargetResultReportError,
} from "../../governance/result/implementation-target-result-report.js";
import {
  computeTargetResultCallbackPromptDigest,
  deriveTargetResultCallbackId,
  deriveTargetResultCallbackStatus,
  parseTargetResultCallbackRecord,
  TARGET_RESULT_CALLBACK_SILENCE_MILLISECONDS,
  TargetResultCallbackError,
  type TargetResultCallbackRecord,
  type TargetResultEvidenceResolution,
} from "../../governance/result/target-result-callback.js";
import type { TargetResult } from "../../governance/result/target-result.js";
import {
  createTestTargetResult,
  TestTargetResultError,
} from "../../governance/result/test-target-result.js";
import {
  createTestTargetResultReport,
  TestTargetResultReportError,
} from "../../governance/result/test-target-result-report.js";
import {
  createControllerImplementationReviewDecision,
  type CreateControllerImplementationReviewDecisionInput,
  ControllerImplementationReviewDecisionError,
  type ControllerImplementationReviewDecision,
} from "../../governance/review/controller-implementation-review-decision.js";
import {
  createControllerProductDefectRemediationAuthorization,
  ControllerProductDefectRemediationAuthorizationError,
  type ControllerProductDefectRemediationAuthorization,
} from "../../governance/review/controller-product-defect-remediation-authorization.js";
import type { ControllerReviewDecision } from "../../governance/review/controller-review-decision.js";
import {
  normalizeControllerReviewEscalation,
  normalizeControllerReviewResumption,
  normalizeControllerTestReviewEscalation,
  type ControllerReviewSharedErrorReason,
} from "../../governance/review/controller-review-decision-contract.js";
import {
  createControllerTestReviewDecision,
  ControllerTestReviewDecisionError,
  type ControllerTestReviewDecision,
} from "../../governance/review/controller-test-review-decision.js";
import {
  buildDemandResultReviewSnapshotFromHistory,
  computeReportedReviewUnitDigest,
  readDemandResultReviewSnapshot,
  type DemandResultReviewTarget,
  type DemandTargetReviewHistoryEntry,
} from "../../governance/review/demand-result-review-snapshot.js";
import type { TaskPackage, TestTaskPackage } from "../../governance/tasking/task-package.js";
import { afterMutationRefresh } from "../../governance/observation/active-projection-refresh.js";
import {
  runAppendCommand,
  type AppendCommandBinding,
  type AppendCommandEnvelope,
} from "../../kernel/append-command.js";
import { commandShellExecutionOptions, runCommandShell } from "../../kernel/command-shell.js";
import { fail, failWithBlockers as rejectWith } from "../../kernel/error.js";
import { readHostHookObservations } from "../../kernel/hook-observations.js";
import { deriveNextProjection, type NextProjection } from "../../kernel/next-projection.js";
import { DEFAULT_ALLOWED_ID_PREFIXES } from "../../kernel/privacy-scan.js";
import { releaseWorkClaimIfHeld } from "../../kernel/work-claims.js";
import {
  inspectWakeflowWindowHostBindingInventory,
  WakeflowWindowHostBindingStoreError,
} from "../../workspace/window-runtime/wakeflow-window-host-binding-store.js";
import { compileWakeflowWindowHostBindingStoreAuthority } from "../../workspace/window-runtime/wakeflow-window-host-binding-store-authority.js";
import type { WakeflowWindowHostBinding } from "../../workspace/window-runtime/wakeflow-window-host-binding.js";
import type { WakeflowWindowHostIdentityProfile } from "../../workspace/window-runtime/wakeflow-window-host-identity-profile.js";
import { compileWakeflowWindowLaunchIntents } from "../../workspace/window-runtime/wakeflow-window-launch-intent.js";
import type { WakeflowWorkspaceHostResourceProfile } from "../../workspace/workspace-host-resource-profile.js";
import {
  admitImplementationReviewDecisionResult,
  admitTargetResultImportResult,
  admitTargetResultReviewInspectionResult,
  admitTestReviewDecisionResult,
  parseImplementationReviewDecisionRequest,
  parseTargetResultImportRequest,
  parseTargetResultReviewInspectionRequest,
  parseTestReviewDecisionRequest,
  WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
  WAKEFLOW_RESULT_REVIEW_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
  WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
  WAKEFLOW_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME,
  type ImplementationReviewDecisionRequest,
  type ImplementationReviewDecisionResult,
  type TargetResultImportRequest,
  type TargetResultImportResult,
  type TargetResultReviewInspectionRequest,
  type TargetResultReviewInspectionResult,
  type TestReviewDecisionRequest,
  type TestReviewDecisionResult,
} from "./contract.js";
import {
  collectEvidenceReferences,
  deriveCallbackLanding,
  deriveImplementationAllowedDecisions,
  type ImplementationAdmissionView,
  deriveImplementationDecisionBlockers,
  derivePrivacyRules,
  deriveResumptionBlockers,
  deriveStepViews,
  deriveTargetCompletion,
  deriveTestAllowedDecisions,
  deriveTestDecisionBlockers,
  findReviewEscalationEventId,
  implementationPhaseForDecision,
  planEvidenceLocator,
  reportTexts,
  summarizeResultForCallback,
  testPhaseForDecision,
  type EvidenceReference,
  type PriorTestResultView,
  type ResumptionSourceView,
  type ReviewUnitStatus,
  type SessionRecordView,
  type StepView,
  type TargetCompletionView,
  type TestAdmissionView,
} from "./decide.js";
import { renderWakeControllerPrompt } from "./prompt.js";

/**
 * Wakeflow Capabilities / Result Review：四个执行器（能力卡 7 修订，ADR-0012 D1 D4 D5，§13.87）。
 *
 * import：目标报告 → 定位符解析与隐私扫描 → 结果记录 → 追加结果事件（含回调记录）→ 释放声明 →
 * 返回回调许可。inspect：从事件流重建评审单元并附回调、完成证据、允许的决定与逐步记录。
 * 两类决定：核对快照基线、派生阻塞项、创建决定记录、同一提交附带升级或缺陷修复授权。
 * 宿主效果始终由 Agent 执行；原始句柄只以摘要出现。
 */

export interface ResultReviewHostFacade {
  readonly hostId: WakeflowHostId;
  readonly resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly identityProfile: Readonly<WakeflowWindowHostIdentityProfile>;
}

export interface ExecuteResultReviewOptions {
  /** 本次调用打开工作区根用的持久化级别；与 `clock` 同类的注入值，生产不传。 */
  readonly durability?: RootedDirectoryDurability;
  readonly clock?: UtcWallClock;
  readonly signal?: AbortSignal;
  readonly uuidFactory?: UuidV4Factory;
}

interface SliceContext {
  readonly workspaceRoot: RootedDirectory;
  readonly authority: Readonly<DemandOperationAuthorityContext>;
  readonly facade: Readonly<ResultReviewHostFacade>;
  readonly options: ExecuteResultReviewOptions;
}

interface WindowView {
  readonly binding: Readonly<WakeflowWindowHostBinding>;
  readonly bindingDigest: Sha256Digest;
  readonly handleDigest: Sha256Digest;
  readonly displayTitle: string;
}

interface CommandOutcome {
  readonly commandResult: Readonly<
    Pick<DemandEventSourcingCommandResult, "disposition" | "commit" | "aggregate">
  >;
}

const REPORT_PRIVACY_POLICY = Object.freeze({
  allowedPathRoots: Object.freeze([]),
  allowedIdPrefixes: DEFAULT_ALLOWED_ID_PREFIXES,
});
const MANIFEST_READ_LIMIT = parseByteCount(MANAGED_EVIDENCE_MANIFEST_MAXIMUM_BYTES, "$limit");
const PAYLOAD_READ_LIMIT = parseByteCount(MANAGED_EVIDENCE_PAYLOAD_LIMITS.maxFileBytes, "$limit");
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
    error instanceof ImplementationTargetResultReportError ||
    error instanceof TestTargetResultReportError ||
    error instanceof ImplementationTargetResultError ||
    error instanceof TestTargetResultError ||
    error instanceof TargetResultCallbackError ||
    error instanceof ControllerImplementationReviewDecisionError ||
    error instanceof ControllerTestReviewDecisionError ||
    error instanceof ControllerProductDefectRemediationAuthorizationError
  ) {
    fail("precondition-failed", `record-${error.reason}`, path, { cause: error });
  }
  throw error;
}

function sharedFail(reason: ControllerReviewSharedErrorReason, path: string): never {
  fail("invalid-request", reason, `$request${path.slice(1)}`);
}

function nowFrom(options: ExecuteResultReviewOptions): UtcInstant {
  return readUtcWallClock(options.clock);
}

// ---- 上下文 -------------------------------------------------------------------

async function openContext(
  workspaceRoot: RootedDirectory,
  demandId: string,
  facade: Readonly<ResultReviewHostFacade>,
  options: ExecuteResultReviewOptions,
  mode: "append" | "read",
): Promise<SliceContext> {
  try {
    const open =
      mode === "append" ? openDemandOperationAuthorityContext : openDemandReadAuthorityContext;
    const authority = await open(
      workspaceRoot,
      demandId as WakeflowDurableId<"demand">,
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

/** 追加前先核对观察到的流修订：过期修订不该先做 I/O 再在提交边界失败。 */
function assertFreshRevision(context: SliceContext, binding: Readonly<AppendCommandBinding>): void {
  if (context.authority.loaded.aggregate.streamRevision !== binding.expectedStreamRevision) {
    fail("concurrency-conflict", "stream-revision", "$request.expectedStreamRevision", {
      details: { observed: String(context.authority.loaded.aggregate.streamRevision) },
    });
  }
}

/** Demand 所在 pod 的作用域：回调落到该 pod 的 Controller（ADR-0010 D2）。 */
function demandPodScope(context: SliceContext) {
  const podId = context.authority.loaded.identity.podId;
  const scope = Object.hasOwn(context.authority.config.indexes.podScopes, podId)
    ? context.authority.config.indexes.podScopes[podId]
    : undefined;
  if (scope === undefined) {
    fail("precondition-failed", "pod-unknown", "$request.demandId", { details: { podId } });
  }
  return scope;
}

/** worktree pod 的实现结果必须报分支：Codex 的 worktree 线程从 detached HEAD 起步（ADR-0010 D4）。 */
function assertWorktreeBranch(context: SliceContext, result: Readonly<TargetResult>): void {
  if (result.workType !== "implementation") return;
  if (demandPodScope(context).pod.placement !== "worktree") return;
  if (result.report.repositoryChange.branch === null) {
    fail(
      "precondition-failed",
      "worktree-branch-required",
      "$request.report.content.repositoryChange.branch",
    );
  }
}

async function loadWindow(context: SliceContext, windowId: string): Promise<WindowView> {
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
      fail("precondition-failed", "binding-store", "$request.demandId", { cause: error });
    }
    throw error;
  }
  const binding = bindings.find((entry) => entry.windowId === windowId);
  if (binding === undefined) fail("precondition-failed", "binding-missing", "$request.demandId");
  if (binding.hostId !== facade.hostId) {
    fail("precondition-failed", "binding-host", "$request.demandId");
  }
  const intent = compileWakeflowWindowLaunchIntents(
    authority.config.model,
    facade.resourceProfile,
  ).intents.find((entry) => entry.windowId === windowId);
  if (intent === undefined) fail("precondition-failed", "window-unknown", "$request.demandId");
  return Object.freeze({
    binding,
    bindingDigest: computeCanonicalJsonSha256Digest(parseJsonValue(binding, "$binding")),
    handleDigest: computeSha256Digest(encodeUtf8(binding.handle.value, "$handle"), "$handle"),
    displayTitle: intent.displayTitle,
  });
}

async function sessionRecords(
  context: SliceContext,
  sessionId: string,
  since: UtcInstant,
): Promise<readonly Readonly<SessionRecordView>[]> {
  const inventory = await readHostHookObservations(
    context.workspaceRoot,
    context.facade.hostId,
    { sessionId, since },
    signalOptions(context.options.signal),
  );
  return inventory.records.map((record) =>
    Object.freeze({
      recordId: record.recordId,
      event: record.event,
      promptDigest: record.promptDigest,
      recordedAt: record.recordedAt,
    }),
  );
}

/** 某窗口当前绑定会话的 hook 记录；窗口尚无绑定时视为没有记录。 */
async function windowRecords(
  context: SliceContext,
  windowId: string,
  since: UtcInstant,
): Promise<readonly Readonly<SessionRecordView>[]> {
  const storeAuthority = compileWakeflowWindowHostBindingStoreAuthority(
    context.authority.config.model,
    context.facade.resourceProfile,
    context.facade.identityProfile,
  );
  let binding: Readonly<WakeflowWindowHostBinding> | undefined;
  try {
    binding = (
      await inspectWakeflowWindowHostBindingInventory(
        context.workspaceRoot,
        storeAuthority,
        signalOptions(context.options.signal),
      )
    ).bindings.find((entry) => entry.windowId === windowId);
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingStoreError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      fail("precondition-failed", "binding-store", "$request.demandId", { cause: error });
    }
    throw error;
  }
  if (binding === undefined || binding.hostId !== context.facade.hostId) return Object.freeze([]);
  return sessionRecords(context, binding.handle.value, since);
}

// ---- 事件流 -------------------------------------------------------------------

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

async function boundCommit(
  repository: DemandEventSourcingRepository,
  binding: Readonly<AppendCommandBinding>,
  signal: AbortSignal | undefined,
) {
  try {
    const bound = await repository.findCommitByIdempotencyKey(
      binding.idempotencyKey,
      signalOptions(signal),
    );
    if (bound !== null && bound.idempotency?.requestDigest !== binding.requestDigest) {
      fail("idempotency-mismatch", "request-digest", "$request.idempotencyKey");
    }
    return bound;
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

function upcast(stored: Readonly<DemandEventSourcingStoredEvent>) {
  return upcastDemandEventSourcingStoredEvent(stored);
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

function receipts(commandResult: CommandOutcome["commandResult"]) {
  const first = commandResult.commit.events[0];
  const last = commandResult.commit.events.at(-1);
  if (first === undefined || last === undefined) fail("unexpected", "commit-empty", "$result");
  return {
    event: { eventId: first.eventId, streamRevision: first.streamRevision },
    commit: {
      commitId: commandResult.commit.commitId,
      commitSequence: commandResult.commit.commitSequence,
      commitDigest: computeDemandEventStreamCommitDigest(commandResult.commit),
    },
    stateDigest: last.resultingStateDigest,
  };
}

// ---- import ---------------------------------------------------------------------

interface ImportInput {
  readonly deliveryId: string;
  readonly claimDigest: string;
  readonly report: TargetResultImportRequest["report"];
}

interface ImportOutcome extends CommandOutcome {
  readonly result: Readonly<TargetResult>;
  readonly callback: Readonly<TargetResultCallbackRecord>;
  readonly window: Readonly<WindowView>;
}

type DeliveryBearingTarget = Exclude<
  DemandTargetTaskState,
  { readonly phase: "planned" | "superseded" }
>;

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

const IMPORTABLE_PHASES: readonly string[] = Object.freeze([
  "host-effect-accepted",
  "host-effect-indeterminate",
  "test-host-effect-accepted",
  "test-host-effect-indeterminate",
]);

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

/**
 * 重新武装不重渲染 prompt，窗口手里只有第一代的围栏摘要。重新武装只跟在一次可证明
 * 从未到达会话的发送之后，所以同一 deliveryId 更早一代记录过的围栏同样认作本投递。
 */
async function assertEarlierGenerationFence(
  repository: DemandEventSourcingRepository,
  input: ImportInput,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    const outcomes = await repository.findDeliveryOutcomeRecordedEvents(
      input.deliveryId,
      signalOptions(signal),
    );
    const known = outcomes.some(
      (entry) => entry.event.data.outcome.fence.claimDigest === input.claimDigest,
    );
    if (known) return;
  } catch (error: unknown) {
    mapRepositoryError(error);
  }
  fail("precondition-failed", "fence-mismatch", "$request.claimDigest");
}

async function loadTaskPackage(
  repository: DemandEventSourcingRepository,
  taskPackageId: string,
  signal: AbortSignal | undefined,
): Promise<Readonly<TaskPackage>> {
  try {
    const located = await repository.findTargetTaskPlannedEvent(
      taskPackageId,
      signalOptions(signal),
    );
    if (located === null)
      fail("precondition-failed", "task-package-missing", "$request.deliveryId");
    return located.event.data.taskPackage;
  } catch (error: unknown) {
    mapRepositoryError(error);
  }
}

/** 定位符只在同 Demand 的受管证据记录内解析，逐条核 sha256（§13.87 D3）。 */
async function resolveEvidence(
  context: SliceContext,
  references: readonly Readonly<EvidenceReference>[],
): Promise<readonly Readonly<TargetResultEvidenceResolution>[]> {
  const recorded = new Set(
    (context.authority.loaded.aggregate.state.managedEvidence ?? []).map(
      (entry) => entry.evidenceId,
    ),
  );
  const unresolved: number[] = [];
  const mismatched: number[] = [];
  const resolutions: Readonly<TargetResultEvidenceResolution>[] = [];
  for (const [index, reference] of references.entries()) {
    const resolved = await resolveEvidenceReference(context, reference, recorded);
    if (resolved === null) unresolved.push(index);
    else if (resolved === "kind-mismatch") mismatched.push(index);
    else resolutions.push(resolved);
  }
  if (unresolved.length > 0 || mismatched.length > 0) {
    rejectWith(
      [
        ...unresolved.slice(0, 2).map((index) => `evidence-unresolved:${index}`),
        ...mismatched.slice(0, 2).map((index) => `evidence-kind-mismatch:${index}`),
      ],
      "$request.report",
    );
  }
  return Object.freeze(resolutions);
}

interface EvidenceMemberFacts {
  readonly digest: Sha256Digest;
  readonly bytes: number;
  /** payload 成员已加载记录时顺带给出的清单 kind；manifest 成员为 null。 */
  readonly manifestKind: string | null;
}

/** 读取定位符指向的成员并返回它的摘要、字节数与（已加载记录时的）清单 kind；manifest 走稳定读取，payload 成员经记录读取器核对。 */
async function readEvidenceMember(
  root: RootedDirectory,
  plan: NonNullable<ReturnType<typeof planEvidenceLocator>>,
  signal: { readonly signal?: AbortSignal },
): Promise<EvidenceMemberFacts> {
  if (plan.member === "manifest") {
    const read = await readStableFile(
      root,
      managedEvidenceRecordAddress(plan.evidenceId).manifestRef,
      { maximumBytes: MANIFEST_READ_LIMIT, ...signal },
    );
    return Object.freeze({
      digest: read.digest,
      bytes: Number(read.byteCount),
      manifestKind: null,
    });
  }
  const record = await loadManagedEvidenceRecord(root, plan.evidenceId, signal);
  const member = await readManagedEvidencePayloadMember(root, record, plan.memberRef, {
    maximumBytes: PAYLOAD_READ_LIMIT,
    ...signal,
  });
  return Object.freeze({
    digest: member.member.digest,
    bytes: Number(member.member.bytes),
    manifestKind: record.manifest.kind,
  });
}

function unresolvedOrRethrow(error: unknown): null {
  if (error instanceof PortableResourcePathError || error instanceof Sha256Error) return null;
  if (error instanceof StableFileReadError || error instanceof ManagedEvidenceRecordReaderError) {
    if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    return null;
  }
  throw error;
}

async function resolveEvidenceReference(
  context: SliceContext,
  reference: Readonly<EvidenceReference>,
  recorded: ReadonlySet<string>,
): Promise<Readonly<TargetResultEvidenceResolution> | "kind-mismatch" | null> {
  const plan = planEvidenceLocator(reference.ref);
  if (plan === null || !recorded.has(plan.evidenceId)) return null;
  try {
    const ref = parsePortableResourcePath(reference.ref, "$ref");
    const digest = parseSha256Digest(reference.digest, "$digest");
    const signal = signalOptions(context.options.signal);
    const facts = await readEvidenceMember(context.authority.demandRoot, plan, signal);
    if (facts.digest !== digest) return null;
    if (reference.kind !== null) {
      const kind =
        facts.manifestKind ??
        (await loadManagedEvidenceRecord(context.authority.demandRoot, plan.evidenceId, signal))
          .manifest.kind;
      if (kind !== reference.kind) return "kind-mismatch";
    }
    return Object.freeze({ ref, digest, evidenceId: plan.evidenceId, bytes: facts.bytes });
  } catch (error: unknown) {
    return unresolvedOrRethrow(error);
  }
}

function buildResult(
  input: ImportInput,
  target: Readonly<DeliveryBearingTarget>,
  envelope: Readonly<DeliveryEnvelope>,
  taskPackage: Readonly<TaskPackage>,
  options: ExecuteResultReviewOptions,
): Readonly<TargetResult> {
  if (!("outcome" in target.currentDelivery)) {
    fail("precondition-failed", "outcome-missing", "$request.deliveryId");
  }
  const outcome = target.currentDelivery.outcome;
  if (outcome.disposition === "rejected-before-send") {
    fail("precondition-failed", "outcome-rejected", "$request.deliveryId");
  }
  const delivery = Object.freeze({
    generation: target.currentDelivery.generation,
    fence: Object.freeze({
      claimId: target.currentDelivery.fence.claimId,
      claimDigest: target.currentDelivery.fence.claimDigest,
    }),
    outcomeDigest: outcome.outcomeDigest,
    disposition: outcome.disposition,
    readbackStatus: outcome.readbackStatus,
    observedAt: outcome.observedAt,
  });
  const clock = options.clock === undefined ? {} : { clock: options.clock };
  try {
    if (input.report.workType === "test") {
      if (taskPackage.workType !== "test") {
        fail("precondition-failed", "work-type", "$request.report.workType");
      }
      const report = createTestTargetResultReport(input.report.content, clock);
      return createTestTargetResult({ taskPackage, envelope, delivery, report });
    }
    if (taskPackage.workType !== "implementation") {
      fail("precondition-failed", "work-type", "$request.report.workType");
    }
    const report = createImplementationTargetResultReport(input.report.content, clock);
    return createImplementationTargetResult({ taskPackage, envelope, delivery, report });
  } catch (error: unknown) {
    mapRecordError(error, "$request.report");
  }
}

async function issueCallback(
  context: SliceContext,
  result: Readonly<TargetResult>,
  taskPackage: Readonly<TaskPackage>,
  streamRevision: number,
  now: UtcInstant,
): Promise<
  Readonly<{ readonly callback: Readonly<TargetResultCallbackRecord>; readonly window: WindowView }>
> {
  const scope = demandPodScope(context);
  const controllerWindowId = scope.controllerWindow.windowId;
  const window = await loadWindow(context, controllerWindowId);
  const summary = summarizeResultForCallback(result);
  const prompt = renderWakeControllerPrompt({
    language: context.authority.config.model.presentation.language,
    demandId: result.demandId,
    podId: `${scope.pod.name} (${scope.pod.podId})`,
    target: {
      targetTaskId: result.targetTaskId,
      taskPackageId: taskPackage.taskPackageId,
      workType: result.workType,
      objective: taskPackage.objective,
    },
    result: {
      targetResultId: result.targetResultId,
      resultDigest: result.resultDigest,
      outcome: summary.outcome,
      summary: summary.summary,
      branch: summary.branch,
      commits: summary.commits,
      verdict: summary.verdict,
      streamRevision,
    },
  });
  try {
    const callback = parseTargetResultCallbackRecord({
      callbackId: deriveTargetResultCallbackId(result.targetResultId),
      controllerWindowId,
      bindingId: window.binding.bindingId,
      bindingDigest: window.bindingDigest,
      portablePrompt: prompt,
      promptDigest: computeTargetResultCallbackPromptDigest(prompt),
      generation: 1,
      issuedAt: now,
    });
    return Object.freeze({ callback, window });
  } catch (error: unknown) {
    mapRecordError(error, "$request.deliveryId");
  }
}

/** 结果事件之后释放围栏声明；缺失或已易主都不是错误——事件已经提交，清理找不到目标不能否定它。 */
async function releaseFence(
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

type ReplayableCommandResult = Readonly<
  Pick<DemandEventSourcingCommandResult, "commit" | "aggregate">
>;

async function replayImport(
  context: SliceContext,
  commandResult: ReplayableCommandResult,
): Promise<ImportOutcome> {
  const stored = commandResult.commit.events[0];
  if (stored === undefined) fail("precondition-failed", "commit-empty", "$request.idempotencyKey");
  const event = upcast(stored);
  if (event.eventType !== "result.target-result-recorded") {
    fail("precondition-failed", "commit-kind", "$request.idempotencyKey");
  }
  const window = await loadWindow(context, event.data.callback.controllerWindowId);
  if (window.binding.bindingId !== event.data.callback.bindingId) {
    fail("precondition-failed", "binding-changed", "$request.idempotencyKey");
  }
  await releaseFence(
    context,
    event.data.result.assignment.windowId,
    event.data.result.delivery.fence,
  );
  return Object.freeze({
    commandResult: Object.freeze({ ...commandResult, disposition: "idempotent" as const }),
    result: event.data.result,
    callback: event.data.callback,
    window,
  });
}

async function executeImport(
  context: SliceContext,
  input: ImportInput,
  binding: Readonly<AppendCommandBinding>,
): Promise<ImportOutcome> {
  const { authority, options } = context;
  const repository = new DemandEventSourcingRepository(authority.demandRoot);
  const bound = await boundCommit(repository, binding, options.signal);
  if (bound !== null) {
    return replayImport(context, { commit: bound, aggregate: authority.loaded.aggregate });
  }
  assertFreshRevision(context, binding);
  const target = deliveryTargetOf(context, input.deliveryId);
  if (!IMPORTABLE_PHASES.includes(target.phase)) {
    rejectWith([`target-phase:${target.phase}`], "$request.deliveryId");
  }
  if (target.currentDelivery.hostId !== context.facade.hostId) {
    fail("precondition-failed", "delivery-host", "$request.deliveryId");
  }
  if (target.currentDelivery.fence.claimDigest !== input.claimDigest) {
    await assertEarlierGenerationFence(repository, input, options.signal);
  }
  const privacyRules = derivePrivacyRules(reportTexts(input.report.content), REPORT_PRIVACY_POLICY);
  if (privacyRules.length > 0) {
    rejectWith(
      privacyRules.map((rule) => `privacy:${rule}`),
      "$request.report",
    );
  }
  const envelope = await loadEnvelope(repository, input.deliveryId, options.signal);
  if (envelope.workType !== input.report.workType) {
    fail("precondition-failed", "work-type", "$request.report.workType");
  }
  const taskPackage = await loadTaskPackage(
    repository,
    envelope.target.taskPackageId,
    options.signal,
  );
  const evidenceResolution = await resolveEvidence(
    context,
    collectEvidenceReferences(input.report.content),
  );
  const result = buildResult(input, target, envelope, taskPackage, options);
  assertWorktreeBranch(context, result);
  const now = nowFrom(options);
  const issued = await issueCallback(
    context,
    result,
    taskPackage,
    binding.expectedStreamRevision + 1,
    now,
  );
  const command = parseDemandEventSourcingCommand({
    commandType: "result.record-target-result",
    commandVersion: 1,
    result,
    callback: issued.callback,
    evidenceResolution,
  });
  const commandResult = await appendCommand(repository, command, binding, options.signal);
  if (commandResult.disposition === "idempotent") return replayImport(context, commandResult);
  await releaseFence(context, envelope.route.windowId, result.delivery.fence);
  return Object.freeze({
    commandResult,
    result,
    callback: issued.callback,
    window: issued.window,
  });
}

function importResult(
  envelope: Readonly<AppendCommandEnvelope>,
  outcome: ImportOutcome,
  nextProjection: Readonly<NextProjection>,
): TargetResultImportResult {
  const { callback, window } = outcome;
  return admitTargetResultImportResult({
    kind: "WakeflowTargetResultImportResult",
    schemaVersion: WAKEFLOW_RESULT_REVIEW_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
    status: outcome.commandResult.disposition,
    demandId: envelope.demandId,
    result: outcome.result,
    callback: {
      callbackId: callback.callbackId,
      permit: {
        prompt: callback.portablePrompt,
        hostAction: {
          effect: "send-prompt-to-window",
          hostId: window.binding.hostId,
          windowId: window.binding.windowId,
          displayTitle: window.displayTitle,
          bindingId: callback.bindingId,
          handleDigest: window.handleDigest,
        },
        generation: callback.generation,
        issuedAt: callback.issuedAt,
      },
    },
    ...receipts(outcome.commandResult),
    next: nextProjection,
  });
}

/** 执行一次 `wakeflow_import_target_result`。 */
export async function executeTargetResultImportRequest(
  facade: Readonly<ResultReviewHostFacade>,
  value: unknown,
  options: ExecuteResultReviewOptions = {},
): Promise<TargetResultImportResult> {
  return runAppendCommand<ImportInput, SliceContext, ImportOutcome, TargetResultImportResult>(
    {
      tool: WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
      parseRequest: (raw) => {
        const request = parseTargetResultImportRequest(raw);
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
            report: request.report,
          }),
        });
      },
      open: (workspaceRoot, envelope) =>
        openContext(workspaceRoot, envelope.demandId, facade, options, "append"),
      close: closeContext,
      privateValues: (context) => [context.authority.ledgerRoot.absolutePath],
      execute: (context, input, binding) =>
        afterMutationRefresh(context.workspaceRoot, context.options.signal, () =>
          executeImport(context, input, binding),
        ),
      next,
      result: importResult,
    },
    value,
    commandShellExecutionOptions(options.durability),
  );
}

// ---- 评审单元 -----------------------------------------------------------------------

type ReviewUnitTarget = Exclude<DemandResultReviewTarget, { readonly status: "awaiting-result" }>;

interface ReviewUnit {
  readonly status: ReviewUnitStatus;
  readonly target: Readonly<ReviewUnitTarget>;
  readonly aggregateTarget: Readonly<DemandTargetTaskState>;
  readonly currentDecision: Readonly<ControllerReviewDecision> | null;
  readonly currentDecisionSourceEvent: Readonly<
    DemandTargetReviewHistoryEntry["sourceEvent"]
  > | null;
  /** 下一份决定必须携带的评审单元摘要：blocked/escalated 单元把当前决定计入历史。 */
  readonly reviewUnitDigest: Sha256Digest;
  readonly escalationEventId: string | null;
  readonly escalationAnswered: boolean;
}

function targetPhaseLabel(target: Readonly<DemandResultReviewTarget>): string {
  return target.status === "reported" ? "reported" : target.phase;
}

const RESUMABLE_PHASES: Readonly<Record<string, ReviewUnitStatus>> = Object.freeze({
  "review-blocked": "review-blocked",
  "test-review-blocked": "review-blocked",
  escalated: "escalated",
  "test-escalated": "escalated",
});

function reviewUnitOf(
  history: Readonly<AuditedDemandTargetResultHistory>,
  target: Readonly<DemandResultReviewTarget>,
): ReviewUnit | null {
  if (target.status === "awaiting-result") return null;
  const aggregateTarget = history.aggregate.state.targetTasks.find(
    (entry) => entry.targetTaskId === target.targetTaskId,
  );
  if (aggregateTarget === undefined) fail("unexpected", "target-missing", "$request");
  if (target.status === "reported") {
    return Object.freeze({
      status: "reported" as const,
      target,
      aggregateTarget,
      currentDecision: null,
      currentDecisionSourceEvent: null,
      reviewUnitDigest: target.reviewUnitDigest,
      escalationEventId: null,
      escalationAnswered: false,
    });
  }
  const status = RESUMABLE_PHASES[target.phase];
  if (status === undefined) return null;
  const escalationEventId = findReviewEscalationEventId(
    history.escalations.map((entry) => ({
      eventId: entry.sourceEvent.eventId,
      source: entry.escalation.source,
    })),
    target.reviewDecision,
  );
  const reviewUnitDigest = computeReportedReviewUnitDigest(
    target.targetTaskId,
    target.taskPackageSourceEvent,
    target.taskPackage,
    target.targetResultSourceEvent,
    target.targetResult,
    [
      ...target.priorReviewHistory,
      { sourceEvent: target.reviewDecisionSourceEvent, decision: target.reviewDecision },
    ],
  );
  return Object.freeze({
    status,
    target,
    aggregateTarget,
    currentDecision: target.reviewDecision,
    currentDecisionSourceEvent: target.reviewDecisionSourceEvent,
    reviewUnitDigest,
    escalationEventId,
    escalationAnswered:
      escalationEventId !== null &&
      history.decisionRecords.some(
        (entry) => entry.decision.escalationEventId === escalationEventId,
      ),
  });
}

interface ReviewEvidence {
  readonly targetCompletion: TargetCompletionView;
  readonly callbackLanding: Readonly<{
    readonly recordId: string;
    readonly landedAt: UtcInstant;
  }> | null;
  readonly callbackRecords: readonly Readonly<SessionRecordView>[];
}

/** 完成证据来自目标窗口会话，回调落地来自 Controller 窗口会话；都按记录时间过滤。 */
async function loadReviewEvidence(
  context: SliceContext,
  unit: ReviewUnit,
): Promise<ReviewEvidence> {
  const result = unit.target.targetResult;
  const aggregateTarget = unit.aggregateTarget;
  if (
    !("currentDelivery" in aggregateTarget) ||
    !("targetResult" in aggregateTarget.currentDelivery)
  ) {
    fail("unexpected", "result-missing", "$request");
  }
  const callback = aggregateTarget.currentDelivery.targetResult.callback;
  const [targetRecords, callbackRecords] = await Promise.all([
    windowRecords(context, result.assignment.windowId, result.report.reportedAt),
    windowRecords(context, callback.controllerWindowId, callback.issuedAt),
  ]);
  return Object.freeze({
    targetCompletion: deriveTargetCompletion(targetRecords, result.report.reportedAt),
    callbackLanding: deriveCallbackLanding(
      callbackRecords,
      callback.promptDigest,
      callback.issuedAt,
    ),
    callbackRecords,
  });
}

function testResultView(
  history: Readonly<AuditedDemandTargetResultHistory>,
  result: Readonly<Extract<TargetResult, { readonly workType: "test" }>>,
): Readonly<PriorTestResultView> | null {
  const source = history.taskPackages.find(
    (entry) => entry.taskPackage.taskPackageId === result.taskPackage.taskPackageId,
  );
  if (source === undefined || source.taskPackage.workType !== "test") return null;
  return Object.freeze({
    targetTaskId: result.targetTaskId,
    attemptOrdinal: result.testExecution.ordinal,
    steps: result.report.steps,
    itemIdByStepId: new Map(
      source.taskPackage.testContract.steps.map(
        (step) => [step.stepId, step.requirementRef.itemId] as const,
      ),
    ),
  });
}

interface TestUnitView {
  readonly taskPackage: Readonly<TestTaskPackage>;
  readonly steps: readonly Readonly<StepView>[];
  readonly admission: Readonly<TestAdmissionView>;
  readonly attemptScope: Readonly<{
    readonly ordinal: number;
    readonly stepIds: readonly string[] | null;
  }>;
}

function testUnitView(
  history: Readonly<AuditedDemandTargetResultHistory>,
  unit: ReviewUnit,
  targetCompletion: TargetCompletionView,
): TestUnitView | null {
  const { target, aggregateTarget } = unit;
  if (
    target.taskPackage.workType !== "test" ||
    target.targetResult.workType !== "test" ||
    aggregateTarget.workType !== "test" ||
    !("testAttempts" in aggregateTarget)
  ) {
    return null;
  }
  const result = target.targetResult;
  const views = (results: readonly Readonly<TargetResult>[]) =>
    results.flatMap((entry) => {
      const view = entry.workType === "test" ? testResultView(history, entry) : null;
      return view === null ? [] : [view];
    });
  const priorAttempts = views(
    history.targetResults
      .map((entry) => entry.result)
      .filter(
        (entry) =>
          entry.workType === "test" &&
          entry.targetTaskId === result.targetTaskId &&
          entry.testExecution.ordinal < result.testExecution.ordinal,
      ),
  );
  const lineage = target.taskPackage.lineage;
  const retested = views(
    lineage === null
      ? []
      : history.targetResults
          .map((entry) => entry.result)
          .filter((entry) => entry.targetTaskId === lineage.retestsTargetTaskId),
  );
  const steps = deriveStepViews(
    target.taskPackage.testContract.steps,
    { steps: result.report.steps, stepIds: result.testExecution.stepIds },
    priorAttempts,
    retested,
  );
  const previous = priorAttempts.find(
    (entry) => entry.attemptOrdinal === result.testExecution.ordinal - 1,
  );
  return Object.freeze({
    taskPackage: target.taskPackage,
    steps,
    admission: Object.freeze({
      outcome: result.report.outcome,
      targetCompletion,
      steps,
      attemptCount: aggregateTarget.testAttempts.length,
      maxAttempts: target.taskPackage.testContract.maxAttempts,
      previouslyFlakyStepIds: Object.freeze(
        (previous?.steps ?? [])
          .filter((step) => step.failure?.classification === "flaky")
          .map((step) => step.stepId),
      ),
    }),
    attemptScope: Object.freeze({
      ordinal: result.testExecution.ordinal,
      stepIds: result.testExecution.stepIds,
    }),
  });
}

function decisionSummary(decision: Readonly<ControllerReviewDecision>) {
  const shared = {
    targetReviewDecisionId: decision.targetReviewDecisionId,
    decisionDigest: decision.decisionDigest,
    decision: decision.decision,
    assessment: decision.assessment,
    independentChecks: decision.independentChecks,
    rationale: decision.rationale,
    blockingReasons: decision.blockingReasons,
    residualRisks: decision.residualRisks,
    resumption: decision.resumption,
    callbackLanding: decision.callbackLanding,
    targetCompletion: decision.targetCompletion,
    decidedAt: decision.decidedAt,
  };
  return decision.kind === "WakeflowControllerImplementationReviewDecision"
    ? { workType: "implementation" as const, ...shared, escalation: decision.escalation }
    : {
        workType: "test" as const,
        ...shared,
        stepIds: decision.stepIds,
        escalation: decision.escalation,
      };
}

function resumptionBasisView(unit: ReviewUnit) {
  if (unit.status === "reported") return null;
  if (unit.status === "review-blocked") return { kind: "condition-cleared" as const };
  if (unit.escalationEventId === null) fail("unexpected", "escalation-missing", "$request");
  return {
    kind: "decision-recorded" as const,
    escalationEventId: unit.escalationEventId,
    answered: unit.escalationAnswered,
  };
}

/**
 * 允许的决定（§13.87 D6）：分类到决定的机器规则；升级尚未被用户回答时任何决定都不能记录，
 * 集合为空，`resumptionBasis.answered` 说明原因。
 */
function allowedDecisionsFor(
  unit: ReviewUnit,
  testView: ReturnType<typeof testUnitView>,
  targetCompletion: ReviewEvidence["targetCompletion"],
  resumptionBasis: ReturnType<typeof resumptionBasisView>,
  managedEvidenceIds: readonly string[],
) {
  if (resumptionBasis?.kind === "decision-recorded" && !resumptionBasis.answered) {
    return Object.freeze([]);
  }
  return testView === null
    ? deriveImplementationAllowedDecisions(
        implementationAdmissionView(unit, targetCompletion, managedEvidenceIds),
      )
    : deriveTestAllowedDecisions(testView.admission);
}

/** 本 Demand 已登记的托管证据 id：needs-review 结果的 accept 只能绑定它们（§13.121 D7）。 */
function managedEvidenceIdsOf(context: SliceContext): readonly string[] {
  return Object.freeze(
    (context.authority.loaded.aggregate.state.managedEvidence ?? []).map(
      (entry) => entry.evidenceId,
    ),
  );
}

function implementationAdmissionView(
  unit: ReviewUnit,
  targetCompletion: ReviewEvidence["targetCompletion"],
  managedEvidenceIds: readonly string[],
): ImplementationAdmissionView {
  return {
    outcome: unit.target.outcome,
    targetCompletion,
    acceptanceAnchorIds: unit.target.taskPackage.acceptanceAnchors.map((anchor) => anchor.anchorId),
    managedEvidenceIds,
  };
}

function anchorEvidenceInputOf(
  value: ImplementationReviewDecisionRequest["anchorEvidence"],
): CreateControllerImplementationReviewDecisionInput["anchorEvidence"] {
  if (value === undefined) return null;
  return value.map((entry) => {
    const [first, ...rest] = entry.evidenceIds.map(
      (evidenceId) => evidenceId as WakeflowDurableId<"evidence">,
    );
    if (first === undefined) fail("invalid-request", "anchor-evidence", "$request.anchorEvidence");
    return { anchorId: entry.anchorId, evidenceIds: [first, ...rest] as const };
  });
}

async function inspectReview(
  context: SliceContext,
  request: TargetResultReviewInspectionRequest,
): Promise<TargetResultReviewInspectionResult> {
  const repository = new DemandEventSourcingRepository(context.authority.demandRoot);
  const history = await loadHistory(repository, context.options.signal);
  const snapshot = buildDemandResultReviewSnapshotFromHistory(history);
  if (snapshot.demand.lifecycle !== "active") {
    fail("precondition-failed", `lifecycle-${snapshot.demand.lifecycle}`, "$request.demandId");
  }
  const target = snapshot.targets.find((entry) => entry.targetTaskId === request.targetTaskId);
  if (target === undefined) fail("not-found", "target-unknown", "$request.targetTaskId");
  const unit = reviewUnitOf(history, target);
  if (unit === null)
    rejectWith([`target-phase:${targetPhaseLabel(target)}`], "$request.targetTaskId");
  const evidence = await loadReviewEvidence(context, unit);
  const aggregateTarget = unit.aggregateTarget;
  if (
    !("currentDelivery" in aggregateTarget) ||
    !("targetResult" in aggregateTarget.currentDelivery)
  ) {
    fail("unexpected", "result-missing", "$request");
  }
  const callback = aggregateTarget.currentDelivery.targetResult.callback;
  const callbackStatus = deriveTargetResultCallbackStatus({
    issuedAt: callback.issuedAt,
    promptDigest: callback.promptDigest,
    landingRecords: evidence.callbackRecords,
    acknowledged: unit.currentDecision !== null,
    now: nowFrom(context.options),
    silenceMilliseconds: TARGET_RESULT_CALLBACK_SILENCE_MILLISECONDS,
  });
  const testView = testUnitView(history, unit, evidence.targetCompletion);
  const resumptionBasis = resumptionBasisView(unit);
  return admitTargetResultReviewInspectionResult({
    kind: "WakeflowTargetResultReviewInspectionResult",
    schemaVersion: WAKEFLOW_RESULT_REVIEW_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
    status: "current",
    demand: snapshot.demand,
    eventStream: snapshot.eventStream,
    snapshotDigest: snapshot.snapshotDigest,
    reviewUnit: {
      status: unit.status,
      workType: unit.target.taskPackage.workType,
      targetTaskId: unit.target.targetTaskId,
      outcome: unit.target.outcome,
      taskPackageSourceEvent: unit.target.taskPackageSourceEvent,
      taskPackage: unit.target.taskPackage,
      targetResultSourceEvent: unit.target.targetResultSourceEvent,
      targetResult: unit.target.targetResult,
      priorReviewHistory: unit.target.priorReviewHistory.map((entry) => ({
        sourceEvent: entry.sourceEvent,
        decision: decisionSummary(entry.decision),
      })),
      reviewUnitDigest: unit.reviewUnitDigest,
      currentDecision:
        unit.currentDecision === null || unit.currentDecisionSourceEvent === null
          ? null
          : {
              sourceEvent: unit.currentDecisionSourceEvent,
              decision: decisionSummary(unit.currentDecision),
            },
      resumptionBasis,
      callback: {
        status: callbackStatus.status,
        generation: callback.generation,
        issuedAt: callback.issuedAt,
        landedRecordId: callbackStatus.landedRecordId,
      },
      targetCompletion: evidence.targetCompletion,
      allowedDecisions: allowedDecisionsFor(
        unit,
        testView,
        evidence.targetCompletion,
        resumptionBasis,
        managedEvidenceIdsOf(context),
      ),
      testSteps: testView === null ? null : testView.steps,
      attemptScope: testView === null ? null : testView.attemptScope,
    },
  });
}

/** 执行一次 `wakeflow_inspect_target_result_review`。 */
export async function executeTargetResultReviewInspectionRequest(
  facade: Readonly<ResultReviewHostFacade>,
  value: unknown,
  options: ExecuteResultReviewOptions = {},
): Promise<TargetResultReviewInspectionResult> {
  return runCommandShell<
    { readonly root: string; readonly demandId: string },
    TargetResultReviewInspectionRequest,
    SliceContext,
    TargetResultReviewInspectionResult
  >(
    {
      tool: WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
      parseRequest: (raw) => {
        const request = parseTargetResultReviewInspectionRequest(raw);
        return { envelope: { root: request.root, demandId: request.demandId }, input: request };
      },
      open: (workspaceRoot, envelope) =>
        openContext(workspaceRoot, envelope.demandId, facade, options, "read"),
      close: closeContext,
      privateValues: (context) => [context.authority.ledgerRoot.absolutePath],
    },
    value,
    () => undefined,
    (context, binding) => inspectReview(context, binding.input),
    commandShellExecutionOptions(options.durability),
  );
}

// ---- 决定 ---------------------------------------------------------------------------

interface DecisionSources {
  readonly repository: DemandEventSourcingRepository;
  readonly history: Readonly<AuditedDemandTargetResultHistory>;
  readonly unit: ReviewUnit;
  readonly evidence: ReviewEvidence;
}

interface DecisionBaseline {
  readonly targetResultId: string;
  readonly snapshotDigest: string;
  readonly reviewUnitDigest: string;
  readonly resumption?: ImplementationReviewDecisionRequest["resumption"];
}

async function loadDecisionSources(
  context: SliceContext,
  request: DecisionBaseline,
  workType: "implementation" | "test",
): Promise<DecisionSources> {
  const repository = new DemandEventSourcingRepository(context.authority.demandRoot);
  const history = await loadHistory(repository, context.options.signal);
  const snapshot = buildDemandResultReviewSnapshotFromHistory(history);
  if (snapshot.snapshotDigest !== request.snapshotDigest) {
    fail("precondition-failed", "snapshot-stale", "$request.snapshotDigest");
  }
  const target = snapshot.targets.find(
    (entry) =>
      entry.status !== "awaiting-result" &&
      entry.targetResult.targetResultId === request.targetResultId,
  );
  if (target === undefined) fail("not-found", "result-unknown", "$request.targetResultId");
  const unit = reviewUnitOf(history, target);
  if (unit === null)
    rejectWith([`target-phase:${targetPhaseLabel(target)}`], "$request.targetResultId");
  if (unit.target.taskPackage.workType !== workType) {
    fail("precondition-failed", "work-type", "$request.targetResultId");
  }
  if (unit.reviewUnitDigest !== request.reviewUnitDigest) {
    fail("precondition-failed", "review-unit-stale", "$request.reviewUnitDigest");
  }
  const resumptionBlockers = deriveResumptionBlockers(resumptionSource(unit), request.resumption);
  if (resumptionBlockers.length > 0) rejectWith(resumptionBlockers, "$request.resumption");
  const evidence = await loadReviewEvidence(context, unit);
  return Object.freeze({ repository, history, unit, evidence });
}

function resumptionSource(unit: ReviewUnit): ResumptionSourceView {
  return Object.freeze({
    status: unit.status,
    currentDecisionId: unit.currentDecision?.targetReviewDecisionId ?? null,
    escalationEventId: unit.escalationEventId,
    escalationAnswered: unit.escalationAnswered,
  });
}

function reviewedOf(sources: DecisionSources, request: DecisionBaseline) {
  const { target } = sources.unit;
  return Object.freeze({
    snapshotDigest: request.snapshotDigest as Sha256Digest,
    reviewUnitDigest: request.reviewUnitDigest as Sha256Digest,
    stateDigest: sources.history.aggregate.stateDigest,
    streamRevision: sources.history.aggregate.streamRevision,
    taskPackageId: target.taskPackage.taskPackageId,
    taskPackageDigest: target.targetResult.taskPackage.digest,
    targetResultId: target.targetResult.targetResultId,
    targetResultDigest: target.targetResult.resultDigest,
    targetResultOutcome: target.targetResult.report.outcome,
    targetResultReportedAt: target.targetResult.report.reportedAt,
  });
}

function decisionOptions(options: ExecuteResultReviewOptions) {
  return {
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.uuidFactory === undefined ? {} : { uuidFactory: options.uuidFactory }),
  };
}

function assertControllerAuthority(context: SliceContext, sources: DecisionSources): void {
  const programId = sources.unit.target.taskPackage.programId;
  if (
    context.authority.config.model.program.programId !== programId ||
    context.authority.loaded.identity.programId !== programId
  ) {
    fail("precondition-failed", "controller-authority", "$request.demandId");
  }
}

interface DecisionOutcome extends CommandOutcome {
  readonly decision: Readonly<ControllerReviewDecision>;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
}

function attachedEvents(commandResult: CommandOutcome["commandResult"]) {
  let escalationEventId: string | null = null;
  let productDefectRemediationId: string | null = null;
  for (const stored of commandResult.commit.events.slice(1)) {
    const event = upcast(stored);
    if (event.eventType === "lifecycle.demand-escalated") escalationEventId = event.eventId;
    if (event.eventType === "review.product-defect-remediation-authorized") {
      productDefectRemediationId = event.data.authorization.productDefectRemediationId;
    }
  }
  return { escalationEventId, productDefectRemediationId };
}

function replayDecision(
  commandResult: ReplayableCommandResult,
  kind: ControllerReviewDecision["kind"],
): DecisionOutcome {
  const stored = commandResult.commit.events[0];
  if (stored === undefined) fail("precondition-failed", "commit-empty", "$request.idempotencyKey");
  const event = upcast(stored);
  if (event.eventType !== "review.target-result-decided" || event.data.decision.kind !== kind) {
    fail("precondition-failed", "commit-kind", "$request.idempotencyKey");
  }
  return Object.freeze({
    commandResult: Object.freeze({ ...commandResult, disposition: "idempotent" as const }),
    decision: event.data.decision,
    targetTaskId: event.data.decision.targetTaskId,
  });
}

function decisionReceiptBody(outcome: DecisionOutcome) {
  const decision = outcome.decision;
  return {
    decision: {
      targetReviewDecisionId: decision.targetReviewDecisionId,
      decisionDigest: decision.decisionDigest,
      decision: decision.decision,
      decidedAt: decision.decidedAt,
      callbackLanding: decision.callbackLanding === null ? "unlanded" : "landed",
      targetCompletion: decision.targetCompletion === null ? "pending" : "confirmed",
    },
    ...receipts(outcome.commandResult),
  };
}

function aggregateTargetOf(outcome: DecisionOutcome): Readonly<DemandTargetTaskState> {
  const target = outcome.commandResult.aggregate.state.targetTasks.find(
    (entry) => entry.targetTaskId === outcome.targetTaskId,
  );
  if (target === undefined) fail("unexpected", "target-missing", "$result");
  return target;
}

// ---- implementation decision ------------------------------------------------------

interface ImplementationDecisionInput {
  readonly request: ImplementationReviewDecisionRequest;
}

async function executeImplementationDecision(
  context: SliceContext,
  input: ImplementationDecisionInput,
  binding: Readonly<AppendCommandBinding>,
): Promise<DecisionOutcome> {
  const { authority, options } = context;
  const { request } = input;
  const repository = new DemandEventSourcingRepository(authority.demandRoot);
  const bound = await boundCommit(repository, binding, options.signal);
  if (bound !== null) {
    return replayDecision(
      { commit: bound, aggregate: authority.loaded.aggregate },
      "WakeflowControllerImplementationReviewDecision",
    );
  }
  assertFreshRevision(context, binding);
  const sources = await loadDecisionSources(context, request, "implementation");
  assertControllerAuthority(context, sources);
  // 记录时未给绑定就是 null（缺失）；undefined 只留给允许集推导（§13.121 D7）。
  const blockers = deriveImplementationDecisionBlockers(
    request.decision,
    implementationAdmissionView(
      sources.unit,
      sources.evidence.targetCompletion,
      managedEvidenceIdsOf(context),
    ),
    request.independentChecks,
    request.anchorEvidence ?? null,
  );
  if (blockers.length > 0) rejectWith(blockers, "$request.decision");
  let decision: Readonly<ControllerImplementationReviewDecision>;
  try {
    decision = createControllerImplementationReviewDecision(
      {
        programId: sources.unit.target.taskPackage.programId,
        demandId: request.demandId as WakeflowDurableId<"demand">,
        targetTaskId: sources.unit.target.targetTaskId,
        controllerWindowId: demandPodScope(context).controllerWindow.windowId,
        reviewed: reviewedOf(sources, request),
        decision: request.decision,
        assessment: request.assessment,
        independentChecks: request.independentChecks,
        rationale: request.rationale,
        blockingReasons: request.blockingReasons,
        residualRisks: request.residualRisks,
        escalation:
          request.escalation === undefined
            ? null
            : normalizeControllerReviewEscalation(request.escalation, "$/escalation", sharedFail),
        resumption:
          request.resumption === undefined
            ? null
            : normalizeControllerReviewResumption(request.resumption, "$/resumption", sharedFail),
        callbackLanding: sources.evidence.callbackLanding,
        targetCompletion:
          sources.evidence.targetCompletion.status === "confirmed"
            ? {
                recordId: sources.evidence.targetCompletion.recordId,
                event: sources.evidence.targetCompletion.event,
                observedAt: sources.evidence.targetCompletion.observedAt,
              }
            : null,
        anchorEvidence: anchorEvidenceInputOf(request.anchorEvidence),
      },
      decisionOptions(options),
    );
  } catch (error: unknown) {
    mapRecordError(error, "$request.decision");
  }
  const command = parseDemandEventSourcingCommand({
    commandType: "review.decide-target-result",
    commandVersion: 1,
    decision,
  });
  const commandResult = await appendCommand(repository, command, binding, options.signal);
  if (commandResult.disposition === "idempotent") {
    return replayDecision(commandResult, "WakeflowControllerImplementationReviewDecision");
  }
  return Object.freeze({ commandResult, decision, targetTaskId: decision.targetTaskId });
}

function implementationDecisionResult(
  envelope: Readonly<AppendCommandEnvelope>,
  outcome: DecisionOutcome,
  nextProjection: Readonly<NextProjection>,
): ImplementationReviewDecisionResult {
  const decision = outcome.decision;
  if (decision.kind !== "WakeflowControllerImplementationReviewDecision") {
    fail("unexpected", "decision-kind", "$result");
  }
  const target = aggregateTargetOf(outcome);
  if (target.workType === "test") fail("unexpected", "target-kind", "$result");
  // 相位取自记录下的决定本身，重放时目标可能已前进（如返工投递已准备），当前相位不可用；
  // reworkCount 反映当前聚合状态。
  const phase = implementationPhaseForDecision(decision.decision);
  return admitImplementationReviewDecisionResult({
    kind: "WakeflowImplementationReviewDecisionResult",
    schemaVersion: WAKEFLOW_RESULT_REVIEW_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
    status: outcome.commandResult.disposition,
    demandId: envelope.demandId,
    ...decisionReceiptBody(outcome),
    target: {
      targetTaskId: target.targetTaskId,
      phase,
      reworkCount: target.reworkCount ?? 0,
    },
    attached: { escalationEventId: attachedEvents(outcome.commandResult).escalationEventId },
    next: nextProjection,
  });
}

/** 执行一次 `wakeflow_record_implementation_review_decision`。 */
export async function executeImplementationReviewDecisionRequest(
  facade: Readonly<ResultReviewHostFacade>,
  value: unknown,
  options: ExecuteResultReviewOptions = {},
): Promise<ImplementationReviewDecisionResult> {
  return runAppendCommand<
    ImplementationDecisionInput,
    SliceContext,
    DecisionOutcome,
    ImplementationReviewDecisionResult
  >(
    {
      tool: WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
      parseRequest: (raw) => {
        const request = parseImplementationReviewDecisionRequest(raw);
        return Object.freeze({
          envelope: Object.freeze({
            root: request.root,
            demandId: request.demandId,
            idempotencyKey: request.idempotencyKey,
            expectedStreamRevision: request.expectedStreamRevision,
          }),
          input: Object.freeze({ request }),
        });
      },
      open: (workspaceRoot, envelope) =>
        openContext(workspaceRoot, envelope.demandId, facade, options, "append"),
      close: closeContext,
      privateValues: (context) => [context.authority.ledgerRoot.absolutePath],
      execute: (context, input, binding) =>
        afterMutationRefresh(context.workspaceRoot, context.options.signal, () =>
          executeImplementationDecision(context, input, binding),
        ),
      next,
      result: implementationDecisionResult,
    },
    value,
    commandShellExecutionOptions(options.durability),
  );
}

// ---- test decision ------------------------------------------------------------------

interface TestDecisionInput {
  readonly request: TestReviewDecisionRequest;
}

function stepIdTuple(values: readonly string[] | undefined): readonly [string, ...string[]] | null {
  if (values === undefined) return null;
  const [first, ...rest] = values;
  if (first === undefined) fail("invalid-request", "step-ids", "$request.stepIds");
  return Object.freeze([first, ...rest]);
}

/**
 * `escalate{product-defect}` 的缺陷修复授权：失败步骤取自结果，基线取自测试任务包的
 * 实现基线，状态摘要是决定之后的聚合状态（§13.87 D5）。
 */
function remediationAuthorization(
  sources: DecisionSources,
  decision: Readonly<ControllerTestReviewDecision>,
  options: ExecuteResultReviewOptions,
): Readonly<ControllerProductDefectRemediationAuthorization> | undefined {
  if (decision.escalation?.classification !== "product-defect") return undefined;
  const { target } = sources.unit;
  if (target.taskPackage.workType !== "test" || target.targetResult.workType !== "test") {
    fail("unexpected", "work-type", "$request");
  }
  const decided = decideTargetResultReviewInDemandAggregateState(
    sources.history.aggregate.state,
    decision,
  );
  // 授权身份从决定派生：同一决定永远得到同一授权与事件身份，也不消耗第二个 UUID。
  const authorizationUuidFactory: UuidV4Factory = () =>
    deriveUuidV4("product-defect-remediation", decision.targetReviewDecisionId);
  try {
    return createControllerProductDefectRemediationAuthorization(
      {
        decision,
        routeSource: {
          reviewSnapshotDigest: decision.reviewed.snapshotDigest,
          stateDigest: computeDemandAggregateStateDigest(decided),
          streamRevision: parseDemandEventStreamRevision(decision.reviewed.streamRevision + 1),
        },
        testTaskPackage: {
          taskPackageId: target.taskPackage.taskPackageId,
          taskPackageDigest: target.targetResult.taskPackage.digest,
        },
        failedSteps: target.targetResult.report.steps
          .filter((step) => step.verdict === "fail")
          .map((step) => ({ stepId: step.stepId, observed: step.observed })),
        baselines: target.taskPackage.implementationBaselines,
      },
      { ...decisionOptions(options), uuidFactory: authorizationUuidFactory },
    );
  } catch (error: unknown) {
    mapRecordError(error, "$request.escalation");
  }
}

async function executeTestDecision(
  context: SliceContext,
  input: TestDecisionInput,
  binding: Readonly<AppendCommandBinding>,
): Promise<DecisionOutcome> {
  const { authority, options } = context;
  const { request } = input;
  const repository = new DemandEventSourcingRepository(authority.demandRoot);
  const bound = await boundCommit(repository, binding, options.signal);
  if (bound !== null) {
    return replayDecision(
      { commit: bound, aggregate: authority.loaded.aggregate },
      "WakeflowControllerTestReviewDecision",
    );
  }
  assertFreshRevision(context, binding);
  const sources = await loadDecisionSources(context, request, "test");
  assertControllerAuthority(context, sources);
  const testView = testUnitView(sources.history, sources.unit, sources.evidence.targetCompletion);
  if (testView === null || sources.unit.target.targetResult.workType !== "test") {
    fail("precondition-failed", "work-type", "$request.targetResultId");
  }
  const blockers = deriveTestDecisionBlockers(request, testView.admission);
  if (blockers.length > 0) rejectWith(blockers, "$request.decision");
  let decision: Readonly<ControllerTestReviewDecision>;
  try {
    decision = createControllerTestReviewDecision(
      {
        programId: sources.unit.target.taskPackage.programId,
        demandId: request.demandId as WakeflowDurableId<"demand">,
        targetTaskId: sources.unit.target.targetTaskId,
        controllerWindowId: demandPodScope(context).controllerWindow.windowId,
        reviewed: reviewedOf(sources, request),
        testExecution: {
          testAttemptId: sources.unit.target.targetResult.testExecution.testAttemptId,
        },
        decision: request.decision,
        assessment: request.assessment,
        independentChecks: request.independentChecks,
        rationale: request.rationale,
        blockingReasons: request.blockingReasons,
        residualRisks: request.residualRisks,
        stepIds: stepIdTuple(request.stepIds),
        escalation:
          request.escalation === undefined
            ? null
            : normalizeControllerTestReviewEscalation(
                request.escalation,
                "$/escalation",
                sharedFail,
              ),
        resumption:
          request.resumption === undefined
            ? null
            : normalizeControllerReviewResumption(request.resumption, "$/resumption", sharedFail),
        callbackLanding: sources.evidence.callbackLanding,
        targetCompletion:
          sources.evidence.targetCompletion.status === "confirmed"
            ? {
                recordId: sources.evidence.targetCompletion.recordId,
                event: sources.evidence.targetCompletion.event,
                observedAt: sources.evidence.targetCompletion.observedAt,
              }
            : null,
      },
      decisionOptions(options),
    );
  } catch (error: unknown) {
    mapRecordError(error, "$request.decision");
  }
  const authorization = remediationAuthorization(sources, decision, options);
  const command = parseDemandEventSourcingCommand({
    commandType: "review.decide-target-result",
    commandVersion: 1,
    decision,
    ...(authorization === undefined ? {} : { authorization }),
  });
  const commandResult = await appendCommand(repository, command, binding, options.signal);
  if (commandResult.disposition === "idempotent") {
    return replayDecision(commandResult, "WakeflowControllerTestReviewDecision");
  }
  return Object.freeze({ commandResult, decision, targetTaskId: decision.targetTaskId });
}

function testDecisionResult(
  envelope: Readonly<AppendCommandEnvelope>,
  outcome: DecisionOutcome,
  nextProjection: Readonly<NextProjection>,
): TestReviewDecisionResult {
  const decision = outcome.decision;
  if (decision.kind !== "WakeflowControllerTestReviewDecision") {
    fail("unexpected", "decision-kind", "$result");
  }
  const target = aggregateTargetOf(outcome);
  if (target.workType !== "test" || !("testAttempts" in target)) {
    fail("unexpected", "target-kind", "$result");
  }
  // 相位取自记录下的决定本身（重放时目标可能已进入下一次尝试）；attemptCount 反映当前聚合状态。
  const phase = testPhaseForDecision(
    decision.decision,
    decision.escalation?.classification ?? null,
  );
  return admitTestReviewDecisionResult({
    kind: "WakeflowTestReviewDecisionResult",
    schemaVersion: WAKEFLOW_RESULT_REVIEW_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME,
    status: outcome.commandResult.disposition,
    demandId: envelope.demandId,
    ...decisionReceiptBody(outcome),
    target: {
      targetTaskId: target.targetTaskId,
      phase,
      attemptCount: target.testAttempts.length,
    },
    attached: attachedEvents(outcome.commandResult),
    next: nextProjection,
  });
}

/** 执行一次 `wakeflow_record_test_review_decision`。 */
export async function executeTestReviewDecisionRequest(
  facade: Readonly<ResultReviewHostFacade>,
  value: unknown,
  options: ExecuteResultReviewOptions = {},
): Promise<TestReviewDecisionResult> {
  return runAppendCommand<
    TestDecisionInput,
    SliceContext,
    DecisionOutcome,
    TestReviewDecisionResult
  >(
    {
      tool: WAKEFLOW_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME,
      parseRequest: (raw) => {
        const request = parseTestReviewDecisionRequest(raw);
        return Object.freeze({
          envelope: Object.freeze({
            root: request.root,
            demandId: request.demandId,
            idempotencyKey: request.idempotencyKey,
            expectedStreamRevision: request.expectedStreamRevision,
          }),
          input: Object.freeze({ request }),
        });
      },
      open: (workspaceRoot, envelope) =>
        openContext(workspaceRoot, envelope.demandId, facade, options, "append"),
      close: closeContext,
      privateValues: (context) => [context.authority.ledgerRoot.absolutePath],
      execute: (context, input, binding) =>
        afterMutationRefresh(context.workspaceRoot, context.options.signal, () =>
          executeTestDecision(context, input, binding),
        ),
      next,
      result: testDecisionResult,
    },
    value,
    commandShellExecutionOptions(options.durability),
  );
}
