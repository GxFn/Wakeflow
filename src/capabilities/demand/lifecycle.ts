import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { renderDeterministicJsonDocument } from "../../foundation/data/deterministic-json-document.js";
import { parseJsonValue, type JsonValue } from "../../foundation/data/json-value.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import {
  createFileAtomically,
  replaceFileAtomically,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import { materializeDirectoryPath } from "../../foundation/filesystem/durable-directory-materialization.js";
import { unlinkRegularFileExactly } from "../../foundation/filesystem/exact-regular-file-unlink.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import type { UtcInstant } from "../../foundation/time/utc-instant.js";
import { listPodWorktreeReceiptsAnyHost } from "../../kernel/pod-worktree-receipts.js";
import { inspectWorkClaim, releaseWorkClaim } from "../../kernel/work-claims.js";
import {
  DemandEventSourcingCommandHandlerError,
  executeDemandEventSourcingCommand,
} from "../../governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import type { DemandEventSourcingCommand } from "../../governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
} from "../../governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import {
  createDemandCompletion,
  DemandCompletionError,
} from "../../governance/lifecycle/demand-completion.js";
import {
  buildDemandPostAcceptanceRoute,
  DemandPostAcceptanceRouteError,
} from "../../governance/review/demand-post-acceptance-route.js";
import { readDemandResultReviewSnapshot } from "../../governance/review/demand-result-review-snapshot.js";
import { afterMutationRefresh } from "../../governance/observation/active-projection-refresh.js";
import { fail, WakeflowError } from "../../kernel/error.js";
import {
  DEMAND_LIFECYCLE_JOURNALS_ROOT_REF,
  demandArchiveRef,
  demandLifecycleJournalRef,
} from "../../kernel/layout.js";
import { commandShellExecutionOptions } from "../../kernel/command-shell.js";
import type { NextProjection } from "../../kernel/next-projection.js";
import {
  runPublicationTransaction,
  type PublicationTransactionEnvelope,
  type PublicationTransactionPhase,
  type PublicationTransactionPlan,
} from "../../kernel/publication-transaction.js";
import {
  archiveRequirementClaim,
  readRequirementClaimState,
  reclaimRequirementPackage,
  refreshRequirementBoardIndex,
  replaceRequirementClaimStateFile,
  withdrawRequirementClaim,
  type RequirementClaimState,
  type RequirementClaimStateSource,
} from "../../kernel/requirement-board.js";
import {
  createArchiveManifest,
  findLatestDemandArchive,
  manifestDigest,
  manifestPath,
  mapFoundationError,
  readArchivePayload,
  readDemandRootSnapshot,
  readPayloadFiles,
  restoreDemandRoot,
  retireDemandRoot,
  sealDemandArchive,
  payloadTexts,
  type DemandArchiveManifest,
  type PayloadFile,
} from "./archive.js";
import {
  closeSliceContext,
  nextAfterMutation,
  now,
  openDemandHandle,
  openSliceContext,
  parseDemandId,
  previewNext,
  publicationEnvelope,
  releaseDemandHandle,
  signalOptions,
  type DemandHandle,
  type DemandServiceOptions,
  type DemandSliceContext,
} from "./context.js";
import {
  admitDemandCancellationResult,
  admitDemandCompletionResult,
  admitDemandContinuationResult,
  parseDemandCancellationRequest,
  parseDemandCompletionRequest,
  parseDemandContinuationRequest,
  WAKEFLOW_DEMAND_CANCELLATION_PUBLIC_TOOL_NAME,
  WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
  WAKEFLOW_DEMAND_CONTINUATION_PUBLIC_TOOL_NAME,
  WAKEFLOW_DEMAND_PUBLIC_SCHEMA_VERSION,
  type DemandCancellationRequest,
  type DemandCancellationResult,
  type DemandCompletionRequest,
  type DemandCompletionResult,
  type DemandContinuationRequest,
  type DemandContinuationResult,
} from "./contract.js";
import {
  computePayloadTreeDigest,
  demandWindowIds,
  deriveContinueBlockers,
  deriveDecisionBlockers,
  deriveLifecycleIds,
  deriveTerminalBlockers,
  payloadPrivacyBlockers,
  pendingReviewTargets,
} from "./decide.js";
import { activeDemandOnPod } from "./service.js";
import { evaluateVerifyGates, type VerifyReport } from "./verify.js";

/**
 * Wakeflow Capabilities / Demand：完成即归档、取消、续接与记录决定（ADR-0012 D3、D5）。
 *
 * 完成与取消是同一个五步事务：终态事件 → 封归档包 → 需求包置终态 → （取消）释放
 * 工作声明 → 删活动根。每步幂等，步骤日志在活动根之外，recover 按日志向前重放。
 */

const JOURNAL_FILE_MODE = 0o600;
const JOURNAL_DIRECTORY_MODE = 0o700;
const JOURNAL_MAXIMUM_BYTES = parseByteCount(4 * 1024 * 1024, "$journal.maximumBytes");
const JOURNAL_KIND = "WakeflowDemandLifecycleJournal";

interface EventReceipt {
  readonly eventId: string;
  readonly streamRevision: number;
  readonly commitId: string;
}

interface PackageReceipt {
  readonly requirementId: string;
  readonly recordRef: PortableResourcePath;
  readonly recordDigest: Sha256Digest;
  readonly status: RequirementClaimState["status"];
  readonly revision: number;
  readonly stateDigest: Sha256Digest;
}

interface ArchiveReceipt {
  readonly archiveRef: PortableResourcePath;
  readonly payloadTreeDigest: Sha256Digest;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly manifestDigest: Sha256Digest;
}

interface TerminalPlan {
  readonly action: "complete" | "cancel";
  readonly demandId: string;
  readonly expectedStreamRevision: number;
  readonly expectedStateDigest: Sha256Digest;
  readonly eventId: string;
  readonly commitId: string;
  readonly reason: string | null;
  readonly completion: Readonly<{
    readonly routeDigest: Sha256Digest;
    readonly reviewSnapshotDigest: Sha256Digest;
    readonly testingMode: "controller-only" | "real-environment" | "not-applicable";
  }> | null;
  readonly package: Readonly<{
    readonly requirementId: string;
    readonly expectedClaimStateDigest: Sha256Digest;
    readonly claimStateRevision: number;
    readonly recordRef: PortableResourcePath;
    readonly recordDigest: Sha256Digest;
  }>;
  readonly verify: Readonly<{ readonly observationDigest: string }>;
  readonly archive: Readonly<{
    readonly archiveRef: PortableResourcePath;
    readonly sourcePayloadTreeDigest: Sha256Digest;
  }>;
  readonly windowIds: readonly string[];
  readonly configDigest: Sha256Digest;
}

interface TerminalOutcome {
  readonly disposition: "completed" | "cancelled" | "current" | "recovered";
  readonly demandId: WakeflowDurableId<"demand">;
  readonly terminalEvent: EventReceipt;
  readonly archive: ArchiveReceipt;
  readonly package: PackageReceipt;
  readonly releasedClaims: number;
}

interface TerminalFacts {
  verify: VerifyReport | null;
  archiveRef: PortableResourcePath | null;
}

interface Journal {
  readonly kind: typeof JOURNAL_KIND;
  readonly schemaVersion: 1;
  readonly plan: TerminalPlan | ContinuePlan;
  readonly planDigest: Sha256Digest;
  readonly verify: VerifyReport | null;
}

function planDigest(plan: unknown): Sha256Digest {
  return computeCanonicalJsonSha256Digest(parseJsonValue(plan, "$plan"));
}

function blockedPlan<Plan>(blockers: readonly string[]): PublicationTransactionPlan<Plan> {
  return Object.freeze({ status: "blocked", blockers, plan: null, digest: null });
}

function readyPlan<Plan>(plan: Plan): PublicationTransactionPlan<Plan> {
  return Object.freeze({
    status: "ready",
    blockers: Object.freeze([]),
    plan,
    digest: planDigest(plan),
  });
}

async function readClaim(
  context: DemandSliceContext,
  requirementId: string,
): Promise<RequirementClaimStateSource | null> {
  return readRequirementClaimState(context.root, requirementId, context.signal);
}

function packageReceipt(
  source: RequirementClaimStateSource,
  lineage: Readonly<{
    readonly recordRef: PortableResourcePath;
    readonly recordDigest: Sha256Digest;
  }>,
): PackageReceipt {
  return Object.freeze({
    requirementId: source.state.requirementId,
    recordRef: lineage.recordRef,
    recordDigest: lineage.recordDigest,
    status: source.state.status,
    revision: source.state.revision,
    stateDigest: source.digest,
  });
}

// ---- 步骤日志 ------------------------------------------------------------

async function readJournal(context: DemandSliceContext, demandId: string): Promise<Journal | null> {
  try {
    const read = await readDeterministicJsonFile(
      context.root,
      demandLifecycleJournalRef(demandId),
      {
        maximumBytes: JOURNAL_MAXIMUM_BYTES,
        ...signalOptions(context.signal),
      },
    );
    const value = read.value;
    const kind =
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>).kind
        : undefined;
    if (kind !== JOURNAL_KIND) fail("recovery-required", "journal-invalid", "$journal");
    return value as unknown as Journal;
  } catch (error: unknown) {
    const reason =
      typeof error === "object" && error !== null && "reason" in error ? error.reason : null;
    if (reason === "not-found" || reason === "resource-not-found") return null;
    mapFoundationError(error, "journal-read", "$journal");
  }
}

async function writeJournal(context: DemandSliceContext, journal: Journal): Promise<void> {
  const ref = demandLifecycleJournalRef(journal.plan.demandId);
  const bytes = encodeUtf8(
    renderDeterministicJsonDocument(parseJsonValue(journal, "$journal"), "$journal"),
    "$journal",
  );
  try {
    await materializeDirectoryPath(context.root, DEMAND_LIFECYCLE_JOURNALS_ROOT_REF, {
      mode: JOURNAL_DIRECTORY_MODE,
      ...signalOptions(context.signal),
    });
    const existing = await readJournal(context, journal.plan.demandId);
    if (existing === null) {
      await createFileAtomically(context.root, ref, bytes, {
        mode: JOURNAL_FILE_MODE,
        ...signalOptions(context.signal),
      });
    } else if (existing.planDigest !== journal.planDigest) {
      const current = await readDeterministicJsonFile(context.root, ref, {
        maximumBytes: JOURNAL_MAXIMUM_BYTES,
        ...signalOptions(context.signal),
      });
      await replaceFileAtomically(context.root, ref, bytes, {
        mode: JOURNAL_FILE_MODE,
        expected: {
          resourcePath: current.resourcePath,
          node: current.node,
          byteCount: current.byteCount,
          digest: current.digest,
        },
        ...signalOptions(context.signal),
      });
    }
  } catch (error: unknown) {
    mapFoundationError(error, "journal-write", "$journal");
  }
}

async function deleteJournal(context: DemandSliceContext, demandId: string): Promise<void> {
  const ref = demandLifecycleJournalRef(demandId);
  try {
    const current = await readDeterministicJsonFile(context.root, ref, {
      maximumBytes: JOURNAL_MAXIMUM_BYTES,
      ...signalOptions(context.signal),
    });
    await unlinkRegularFileExactly(context.root, ref, {
      expectedNode: current.node,
      ...signalOptions(context.signal),
    });
  } catch (error: unknown) {
    const reason =
      typeof error === "object" && error !== null && "reason" in error ? error.reason : null;
    if (reason === "not-found" || reason === "resource-not-found") return;
    mapFoundationError(error, "journal-delete", "$journal");
  }
}

/** 索引是自愈的投影：五步都已提交，与并发写者的争用不能让终态事务报失败。 */
async function refreshBoardIndexQuietly(context: DemandSliceContext): Promise<void> {
  try {
    await refreshRequirementBoardIndex(context.root, context.signal);
  } catch (error: unknown) {
    if (!(error instanceof WakeflowError) || error.reason !== "board-index-contended") throw error;
  }
}

// ---- 事件追加 ------------------------------------------------------------

function commitIdOf(value: string): WakeflowDurableId<"demand-event-commit"> {
  try {
    return parseWakeflowDurableIdOfKind(value, "demand-event-commit", "$plan.commitId");
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError)
      fail("unexpected", "commit-id", "$plan.commitId", { cause: error });
    throw error;
  }
}

function mapCommandError(error: unknown): never {
  if (error instanceof DemandEventSourcingCommandHandlerError) {
    if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    if (error.reason === "concurrency-conflict") {
      fail("concurrency-conflict", "stream-revision", "$demandRoot", {
        cause: error,
        retryable: true,
      });
    }
    fail("precondition-failed", `command-${error.reason}`, "$demandRoot", { cause: error });
  }
  if (error instanceof DemandEventSourcingRepositoryError) {
    if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    fail("io-failure", `repository-${error.reason}`, "$demandRoot", { cause: error });
  }
  throw error;
}

async function appendLifecycleEvent(
  context: DemandSliceContext,
  handle: DemandHandle,
  command: Readonly<DemandEventSourcingCommand>,
  commitId: string,
  expectedStreamRevision: number,
): Promise<Readonly<{ readonly receipt: EventReceipt; readonly committed: boolean }>> {
  try {
    const result = await executeDemandEventSourcingCommand(
      new DemandEventSourcingRepository(handle.demandRoot),
      command,
      { commitId: commitIdOf(commitId), expectedStreamRevision, ...signalOptions(context.signal) },
    );
    return Object.freeze({
      receipt: Object.freeze({
        eventId: result.commit.events[0].eventId,
        streamRevision: result.commit.lastStreamRevision,
        commitId: result.commit.commitId,
      }),
      committed: result.disposition === "committed",
    });
  } catch (error: unknown) {
    mapCommandError(error);
  }
}

/** 已到终态或已续接时，从提交找回同一事件的回执；找不到即不是本计划写的终态。 */
async function findEventReceipt(
  context: DemandSliceContext,
  handle: DemandHandle,
  commitId: string,
): Promise<EventReceipt> {
  let commit: Awaited<ReturnType<DemandEventSourcingRepository["findCommitById"]>>;
  try {
    commit = await new DemandEventSourcingRepository(handle.demandRoot).findCommitById(
      commitId,
      signalOptions(context.signal),
    );
  } catch (error: unknown) {
    mapCommandError(error);
  }
  if (commit === null) fail("precondition-failed", "terminal-commit-mismatch", "$demandRoot");
  return Object.freeze({
    eventId: commit.events[0].eventId,
    streamRevision: commit.lastStreamRevision,
    commitId: commit.commitId,
  });
}

// ---- 完成与取消：计划 -------------------------------------------------------

async function postAcceptanceStage(
  handle: DemandHandle,
  signal: AbortSignal | undefined,
): Promise<ReturnType<typeof buildDemandPostAcceptanceRoute> | null> {
  try {
    const snapshot = await readDemandResultReviewSnapshot(handle.demandRoot, signalOptions(signal));
    return buildDemandPostAcceptanceRoute(handle.loaded, snapshot);
  } catch (error: unknown) {
    if (error instanceof DemandPostAcceptanceRouteError) return null;
    mapFoundationError(error, "review-snapshot", "$demandRoot");
  }
}

/** complete 的完成依据：只在路由已到 completion-preflight 时存在。 */
function completionOf(route: ReturnType<typeof buildDemandPostAcceptanceRoute> | null) {
  if (route === null || route.nextStage.status !== "completion-preflight") return null;
  return Object.freeze({
    routeDigest: route.routeDigest,
    reviewSnapshotDigest: route.reviewSnapshotDigest,
    testingMode: route.nextStage.testingClosure.mode,
  });
}

async function terminalBlockedWithoutRoot(
  context: DemandSliceContext,
  demandId: string,
): Promise<PublicationTransactionPlan<TerminalPlan>> {
  const archive = await findLatestDemandArchive(context.ledgerRoot, demandId, context.signal);
  return blockedPlan(
    archive === null ? ["demand-root-absent"] : [`already-archived:${archive.manifest.outcome}`],
  );
}

interface TerminalRequestInput {
  readonly action: "complete" | "cancel";
  readonly demandId: string;
  readonly reason: string | null;
}

async function planTerminal(
  context: DemandSliceContext,
  input: TerminalRequestInput,
  facts: TerminalFacts,
): Promise<PublicationTransactionPlan<TerminalPlan>> {
  const demandId = parseDemandId(input.demandId);
  const handle = await openDemandHandle(context, demandId);
  if (handle === null) return terminalBlockedWithoutRoot(context, demandId);
  const { loaded } = handle;
  const state = loaded.aggregate.state;
  const route = await postAcceptanceStage(handle, context.signal);
  const claim = await readClaim(context, loaded.identity.source.requirementId);
  const rootSnapshot = await readDemandRootSnapshot(handle.demandRoot, context.signal);
  const payload = await readPayloadFiles(handle.demandRoot, rootSnapshot.payload, context.signal);
  const payloadBlockers = payloadPrivacyBlockers(payloadTexts(payload));
  const windowIds = demandWindowIds(state);
  const verify = await evaluateVerifyGates({
    workspaceRoot: context.root,
    ledgerRoot: context.ledgerRoot,
    snapshot: context.snapshot,
    demandRoot: handle.demandRoot,
    loaded,
    claim,
    windowIds,
    payloadBlockers,
    signal: context.signal,
  });
  facts.verify = verify;
  const archiveRef = demandArchiveRef(demandId, loaded.aggregate.streamRevision + 1);
  facts.archiveRef = archiveRef;
  const existingArchive = await findLatestDemandArchive(
    context.ledgerRoot,
    demandId,
    context.signal,
  );
  const blockers = deriveTerminalBlockers({
    action: input.action,
    lifecycle: state.lifecycle,
    awaitingDecision: state.awaitingDecision !== undefined,
    postAcceptanceStage: route === null ? "unavailable" : route.nextStage.status,
    demandId,
    claim: claim?.state ?? null,
    pendingReviews: pendingReviewTargets(state),
    gates: verify.gates,
    payloadBlockers,
    archiveConflict: existingArchive !== null && existingArchive.archiveRef === archiveRef,
  });
  // 只有 complete 依赖接受后路由；cancel 在路由不可用时照常进行（路由不可用对 complete 已是阻塞项）。
  if (blockers.length > 0 || claim === null || (input.action === "complete" && route === null)) {
    return blockedPlan(blockers);
  }
  const ids = deriveLifecycleIds(demandId, input.action, loaded.aggregate.streamRevision);
  return readyPlan<TerminalPlan>(
    Object.freeze({
      action: input.action,
      demandId,
      expectedStreamRevision: loaded.aggregate.streamRevision,
      expectedStateDigest: loaded.aggregate.stateDigest,
      eventId: ids.eventId,
      commitId: ids.commitId,
      reason: input.reason,
      completion: input.action === "complete" ? completionOf(route) : null,
      package: Object.freeze({
        requirementId: claim.state.requirementId,
        expectedClaimStateDigest: claim.digest,
        claimStateRevision: claim.state.revision,
        recordRef: loaded.identity.source.recordRef,
        recordDigest: loaded.identity.source.recordDigest,
      }),
      verify: Object.freeze({ observationDigest: verify.observationDigest }),
      archive: Object.freeze({
        archiveRef,
        sourcePayloadTreeDigest: rootSnapshot.payloadTreeDigest,
      }),
      windowIds,
      configDigest: context.snapshot.configDigest,
    }),
  );
}

// ---- 完成与取消：应用 -------------------------------------------------------

async function completionCommand(
  context: DemandSliceContext,
  handle: DemandHandle,
  plan: TerminalPlan,
  claim: RequirementClaimStateSource,
  at: UtcInstant,
): Promise<Readonly<DemandEventSourcingCommand>> {
  const route = await postAcceptanceStage(handle, context.signal);
  if (
    route === null ||
    route.nextStage.status !== "completion-preflight" ||
    plan.completion === null
  ) {
    fail("precondition-failed", "completion-route", "$demandRoot");
  }
  try {
    const completion = createDemandCompletion(
      {
        controllerWindowId: demandPodScope(context, handle).controllerWindow.windowId,
        routeSource: {
          status: "completion-preflight",
          testingClosure: { mode: route.nextStage.testingClosure.mode },
          programId: route.programId,
          demandId: route.demandId,
          authorityDigest: route.authorityDigest,
          routeDigest: route.routeDigest,
          reviewSnapshotDigest: route.reviewSnapshotDigest,
          observedState: route.observedEventStream,
        },
        packageSource: {
          requirementId: handle.loaded.identity.source.requirementId,
          recordRef: handle.loaded.identity.source.recordRef,
          recordDigest: handle.loaded.identity.source.recordDigest,
          claimStateRevision: claim.state.revision,
          claimStateDigest: claim.digest,
        },
      },
      { clock: () => at },
    );
    return Object.freeze({
      commandType: "lifecycle.complete-demand",
      commandVersion: 1,
      eventId: plan.eventId as WakeflowDurableId<"demand-event">,
      authority: handle.loaded.authority,
      completion,
    });
  } catch (error: unknown) {
    if (error instanceof DemandCompletionError) {
      fail("precondition-failed", `completion-${error.reason}`, "$demandRoot", { cause: error });
    }
    throw error;
  }
}

function cancellationCommand(
  plan: TerminalPlan,
  at: UtcInstant,
): Readonly<DemandEventSourcingCommand> {
  if (plan.reason === null) fail("unexpected", "cancel-reason", "$plan");
  return Object.freeze({
    commandType: "lifecycle.cancel-demand",
    commandVersion: 1,
    demandId: plan.demandId as WakeflowDurableId<"demand">,
    eventId: plan.eventId as WakeflowDurableId<"demand-event">,
    recordedAt: at,
    reason: plan.reason,
  });
}

/** 步骤 1：终态事件。活动即追加；已终态则按 commitId 找回同一事件。 */
async function terminalEvent(
  context: DemandSliceContext,
  handle: DemandHandle,
  plan: TerminalPlan,
  claim: RequirementClaimStateSource,
): Promise<Readonly<{ readonly receipt: EventReceipt; readonly committed: boolean }>> {
  if (handle.loaded.aggregate.state.lifecycle !== "active") {
    return Object.freeze({
      receipt: await findEventReceipt(context, handle, plan.commitId),
      committed: false,
    });
  }
  if (handle.loaded.aggregate.streamRevision !== plan.expectedStreamRevision) {
    fail("concurrency-conflict", "stream-advanced", "$demandRoot", { retryable: true });
  }
  const at = now(context);
  const command =
    plan.action === "complete"
      ? await completionCommand(context, handle, plan, claim, at)
      : cancellationCommand(plan, at);
  return appendLifecycleEvent(context, handle, command, plan.commitId, plan.expectedStreamRevision);
}

/** Demand 所在 pod 的作用域；配置里已没有该 pod 时是 `precondition-failed/pod-unknown`。 */
function demandPodScope(context: DemandSliceContext, handle: DemandHandle) {
  const podId = handle.loaded.identity.podId;
  const scope = Object.hasOwn(context.snapshot.indexes.podScopes, podId)
    ? context.snapshot.indexes.podScopes[podId]
    : undefined;
  if (scope === undefined) {
    fail("precondition-failed", "pod-unknown", "$demandRoot", { details: { podId } });
  }
  return scope;
}

/** worktree 来源成员：配置里的 worktree 意图加各宿主回执里的分支与 HEAD；从不含路径。 */
async function worktreeMember(
  context: DemandSliceContext,
  scope: ReturnType<typeof demandPodScope>,
): Promise<DemandArchiveManifest["worktree"]> {
  if (scope.pod.placement !== "worktree") return null;
  const receipts = await listPodWorktreeReceiptsAnyHost(
    context.root,
    scope.pod.podId,
    signalOptions(context.signal),
  );
  return {
    podId: scope.pod.podId,
    name: scope.pod.name,
    placement: "worktree",
    repositories: scope.pod.worktrees.map((worktree) => {
      const receipt = receipts.find((entry) => entry.repositoryId === worktree.repositoryId);
      return {
        repositoryId: worktree.repositoryId,
        suggestedName: worktree.suggestedName,
        branch: receipt?.branch ?? null,
        head: receipt?.head ?? null,
      };
    }),
  };
}

/** 步骤 2：封归档包；负载是写入终态事件之后的活动根。 */
async function sealArchive(
  context: DemandSliceContext,
  handle: DemandHandle,
  plan: TerminalPlan,
  receipt: EventReceipt,
  verify: VerifyReport,
): Promise<ArchiveReceipt> {
  const podScope = demandPodScope(context, handle);
  const worktree = await worktreeMember(context, podScope);
  const rootSnapshot = await readDemandRootSnapshot(handle.demandRoot, context.signal);
  const payload = await readPayloadFiles(handle.demandRoot, rootSnapshot.payload, context.signal);
  const archivedAt = now(context);
  const sealed = await sealDemandArchive(
    context.ledgerRoot,
    {
      demandId: plan.demandId,
      streamRevision: receipt.streamRevision,
      payload,
      verifyReport: parseJsonValue(verify, "$verify"),
      manifest: (payloadSummary, reportDigest) =>
        createArchiveManifest({
          archiveRef: demandArchiveRef(plan.demandId, receipt.streamRevision),
          demandId: plan.demandId,
          programId: handle.loaded.identity.programId,
          requirementId: plan.package.requirementId,
          outcome: plan.action === "complete" ? "completed" : "cancelled",
          terminalEvent: receipt,
          archivedAt,
          controllerWindowId: podScope.controllerWindow.windowId,
          podId: handle.loaded.identity.podId,
          package: {
            requirementId: plan.package.requirementId,
            recordRef: plan.package.recordRef,
            recordDigest: plan.package.recordDigest,
            claimStateRevision: plan.package.claimStateRevision,
          },
          verify: {
            observationDigest: verify.observationDigest,
            reportDigest,
            gateCount: verify.gates.length,
            failedCount: verify.gates.filter((gate) => gate.status !== "pass").length,
          },
          payload: payloadSummary,
          worktree,
        }),
    },
    context.signal,
  );
  return archiveReceipt(sealed.archiveRef, sealed.manifest);
}

function archiveReceipt(
  archiveRef: PortableResourcePath,
  manifest: DemandArchiveManifest,
): ArchiveReceipt {
  return Object.freeze({
    archiveRef,
    payloadTreeDigest: manifestDigest(manifest.payload.treeDigest, "$manifest.payload.treeDigest"),
    fileCount: manifest.payload.fileCount,
    totalBytes: manifest.payload.totalBytes,
    manifestDigest: manifestDigest(manifest.manifestDigest, "$manifest.manifestDigest"),
  });
}

function manifestLineage(manifest: DemandArchiveManifest) {
  return Object.freeze({
    recordRef: manifestPath(manifest.package.recordRef, "$manifest.package.recordRef"),
    recordDigest: manifestDigest(manifest.package.recordDigest, "$manifest.package.recordDigest"),
  });
}

/** 步骤 3：需求包 claimed → archived（完成）或 withdrawn（取消）；已到位即 current。 */
async function settlePackage(
  context: DemandSliceContext,
  plan: TerminalPlan,
  lineage: Readonly<{
    readonly recordRef: PortableResourcePath;
    readonly recordDigest: Sha256Digest;
  }>,
): Promise<PackageReceipt> {
  const source = await readClaim(context, plan.package.requirementId);
  if (source === null) fail("recovery-required", "claim-state-vanished", "$board");
  const state = source.state;
  const settled =
    plan.action === "complete"
      ? state.status === "archived" && state.archive?.demandId === plan.demandId
      : state.status === "withdrawn";
  if (settled) return packageReceipt(source, lineage);
  if (state.status !== "claimed" || state.claim?.demandId !== plan.demandId) {
    fail("precondition-failed", `package-claim:${state.status}`, "$board");
  }
  const at = now(context);
  const next =
    plan.action === "complete"
      ? archiveRequirementClaim(state, at)
      : withdrawRequirementClaim(state, `demand-cancelled:${plan.demandId}`, at);
  await replaceRequirementClaimStateFile(context.root, source, next, context.signal);
  const reread = await readClaim(context, plan.package.requirementId);
  if (reread === null) fail("recovery-required", "claim-state-vanished", "$board");
  return packageReceipt(reread, lineage);
}

/** 步骤 4（取消）：释放本 Demand 在各窗口上的工作声明。 */
async function releaseClaims(context: DemandSliceContext, plan: TerminalPlan): Promise<number> {
  if (plan.action !== "cancel") return 0;
  let released = 0;
  for (const windowId of plan.windowIds) {
    const inspected = await inspectWorkClaim(context.root, windowId, signalOptions(context.signal));
    if (inspected.claim === null) continue;
    if (inspected.claim.holder.demandId !== plan.demandId) continue;
    await releaseWorkClaim(context.root, inspected.claim, signalOptions(context.signal));
    released += 1;
  }
  return released;
}

async function applyTerminal(
  context: DemandSliceContext,
  plan: TerminalPlan,
  verify: VerifyReport,
  disposition: "apply" | "recover",
): Promise<TerminalOutcome> {
  const demandId = parseDemandId(plan.demandId);
  await writeJournal(context, {
    kind: JOURNAL_KIND,
    schemaVersion: 1,
    plan,
    planDigest: planDigest(plan),
    verify,
  });
  const lineage = { recordRef: plan.package.recordRef, recordDigest: plan.package.recordDigest };
  let handle = await openDemandHandle(context, demandId, { reload: true });
  let terminal: EventReceipt;
  let archive: ArchiveReceipt;
  let committed = false;
  if (handle === null) {
    const located = await findLatestDemandArchive(context.ledgerRoot, demandId, context.signal);
    if (located === null)
      fail("recovery-required", "demand-root-and-archive-absent", "$demandRoot");
    terminal = located.manifest.terminalEvent;
    archive = archiveReceipt(located.archiveRef, located.manifest);
  } else {
    const claim = await readClaim(context, plan.package.requirementId);
    if (claim === null) fail("recovery-required", "claim-state-vanished", "$board");
    const appended = await terminalEvent(context, handle, plan, claim);
    terminal = appended.receipt;
    committed = appended.committed;
    handle = await openDemandHandle(context, demandId, { reload: true });
    if (handle === null) fail("recovery-required", "demand-root-vanished", "$demandRoot");
    archive = await sealArchive(context, handle, plan, terminal, verify);
  }
  const packageState = await settlePackage(context, plan, lineage);
  const releasedClaims = await releaseClaims(context, plan);
  await releaseDemandHandle(context);
  await retireDemandRoot(context.root, plan.demandId, archive.payloadTreeDigest, context.signal);
  await deleteJournal(context, plan.demandId);
  await refreshBoardIndexQuietly(context);
  return Object.freeze({
    disposition:
      disposition === "recover"
        ? "recovered"
        : committed
          ? plan.action === "complete"
            ? "completed"
            : "cancelled"
          : "current",
    demandId,
    terminalEvent: terminal,
    archive,
    package: packageState,
    releasedClaims,
  });
}

/** recover：有日志按日志重放；无日志而归档已在，说明事务已经收尾。 */
async function recoverTerminal(
  context: DemandSliceContext,
  action: "complete" | "cancel",
  operationId: string,
): Promise<TerminalOutcome> {
  const demandId = parseDemandId(operationId, "$request.operationId");
  const journal = await readJournal(context, demandId);
  if (journal !== null) {
    if (journal.plan.action !== action)
      fail("precondition-failed", `journal-action:${journal.plan.action}`, "$journal");
    if (journal.verify === null) fail("recovery-required", "journal-verify-missing", "$journal");
    return applyTerminal(context, journal.plan, journal.verify, "recover");
  }
  const handle = await openDemandHandle(context, demandId);
  if (handle !== null) fail("not-found", "journal-absent", "$request.operationId");
  const located = await findLatestDemandArchive(context.ledgerRoot, demandId, context.signal);
  if (located === null) fail("not-found", "demand-unknown", "$request.operationId");
  const expected = action === "complete" ? "completed" : "cancelled";
  if (located.manifest.outcome !== expected) {
    fail(
      "precondition-failed",
      `archive-outcome:${located.manifest.outcome}`,
      "$request.operationId",
    );
  }
  const claim = await readClaim(context, located.manifest.requirementId);
  if (claim === null) fail("recovery-required", "claim-state-vanished", "$board");
  return Object.freeze({
    disposition: "recovered",
    demandId,
    terminalEvent: located.manifest.terminalEvent,
    archive: archiveReceipt(located.archiveRef, located.manifest),
    package: packageReceipt(claim, manifestLineage(located.manifest)),
    releasedClaims: 0,
  });
}

// ---- 完成与取消：公共入口 ----------------------------------------------------

type TerminalRequest = DemandCompletionRequest | DemandCancellationRequest;

function assembleTerminalResult(
  action: "complete" | "cancel",
  envelope: Readonly<PublicationTransactionEnvelope>,
  input: TerminalRequest,
  phase: PublicationTransactionPhase<TerminalPlan, TerminalOutcome>,
  next: NextProjection,
  facts: TerminalFacts,
): JsonValue {
  const complete = action === "complete";
  const base = {
    schemaVersion: WAKEFLOW_DEMAND_PUBLIC_SCHEMA_VERSION,
    tool: complete
      ? WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME
      : WAKEFLOW_DEMAND_CANCELLATION_PUBLIC_TOOL_NAME,
    next,
  };
  if (phase.mode === "preview") {
    if (input.mode === "recover") fail("unexpected", "preview-mode", "$request.mode");
    return parseJsonValue(
      {
        ...base,
        kind: complete ? "WakeflowDemandCompletionPreview" : "WakeflowDemandCancellationPreview",
        mode: "preview",
        status: phase.planned.status,
        blockers: phase.planned.blockers,
        planDigest: phase.planned.digest,
        demandId: input.demandId,
        verify:
          facts.verify === null
            ? null
            : { observationDigest: facts.verify.observationDigest, gates: facts.verify.gates },
        archiveRef: facts.archiveRef,
      },
      "$result",
    );
  }
  return parseJsonValue(
    {
      ...base,
      kind: complete ? "WakeflowDemandCompletionMutation" : "WakeflowDemandCancellationMutation",
      mode: envelope.mode,
      disposition: phase.outcome.disposition,
      demandId: phase.outcome.demandId,
      terminalEvent: phase.outcome.terminalEvent,
      archive: phase.outcome.archive,
      package: phase.outcome.package,
      releasedClaims: phase.outcome.releasedClaims,
    },
    "$result",
  );
}

async function executeTerminal<Request extends TerminalRequest, Result>(
  action: "complete" | "cancel",
  tool: string,
  parse: (value: unknown) => Request,
  admit: (value: unknown) => Result,
  value: unknown,
  options: DemandServiceOptions,
): Promise<Result> {
  const facts: TerminalFacts = { verify: null, archiveRef: null };
  return runPublicationTransaction<
    Request,
    DemandSliceContext,
    TerminalPlan,
    TerminalOutcome,
    Result
  >(
    {
      tool,
      parseRequest: (raw) => {
        const request = parse(raw);
        return { envelope: publicationEnvelope(request), input: request };
      },
      open: (root) => openSliceContext(root, options),
      close: closeSliceContext,
      plan: (context, input) => {
        if (input.mode === "recover") fail("unexpected", "plan-mode", "$request.mode");
        return planTerminal(
          context,
          { action, demandId: input.demandId, reason: "reason" in input ? input.reason : null },
          facts,
        );
      },
      apply: (context, _input, plan) => {
        if (facts.verify === null) fail("unexpected", "verify-missing", "$plan");
        const verify = facts.verify;
        return afterMutationRefresh(context.root, context.signal, () =>
          applyTerminal(context, plan, verify, "apply"),
        );
      },
      recover: (context, operationId) => recoverTerminal(context, action, operationId),
      next: async (context, phase) =>
        phase.mode === "preview"
          ? previewNext(tool, `demand-${action}-apply`, phase.planned)
          : nextAfterMutation(context, phase.outcome.demandId),
      result: (envelope, input, phase, next) =>
        admit(assembleTerminalResult(action, envelope, input, phase, next, facts)),
      privateValues: (context) => [context.snapshot.ledgerRoot, context.ledgerRoot.absolutePath],
    },
    value,
    commandShellExecutionOptions(options.durability),
  );
}

/** 执行一次 `wakeflow_complete_demand`。 */
export async function executeDemandCompletionRequest(
  value: unknown,
  options: DemandServiceOptions = {},
): Promise<DemandCompletionResult> {
  return executeTerminal(
    "complete",
    WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
    parseDemandCompletionRequest,
    admitDemandCompletionResult,
    value,
    options,
  );
}

/** 执行一次 `wakeflow_cancel_demand`。 */
export async function executeDemandCancellationRequest(
  value: unknown,
  options: DemandServiceOptions = {},
): Promise<DemandCancellationResult> {
  return executeTerminal(
    "cancel",
    WAKEFLOW_DEMAND_CANCELLATION_PUBLIC_TOOL_NAME,
    parseDemandCancellationRequest,
    admitDemandCancellationResult,
    value,
    options,
  );
}

// ---- 续接与记录决定 ----------------------------------------------------------

interface ContinuePlan {
  readonly action: "continue";
  readonly demandId: string;
  readonly archiveRef: PortableResourcePath;
  readonly archiveManifestDigest: Sha256Digest;
  readonly payloadTreeDigest: Sha256Digest;
  readonly expectedStreamRevision: number;
  readonly eventId: string;
  readonly commitId: string;
  readonly continuation: Readonly<{
    readonly kind: "optimization" | "requirement-supplement" | "verified-bug";
    readonly summary: string;
  }>;
  readonly package: Readonly<{
    readonly requirementId: string;
    readonly expectedClaimStateDigest: Sha256Digest;
    readonly recordRef: PortableResourcePath;
    readonly recordDigest: Sha256Digest;
  }>;
  readonly configDigest: Sha256Digest;
}

interface DecisionPlan {
  readonly action: "record-decision";
  readonly demandId: string;
  readonly expectedStreamRevision: number;
  readonly eventId: string;
  readonly commitId: string;
  readonly escalationEventId: string;
  readonly decision: Readonly<{ readonly text: string; readonly chosenOption: string | null }>;
  readonly configDigest: Sha256Digest;
}

type ContinuationPlan = ContinuePlan | DecisionPlan;

interface ContinuationOutcome {
  readonly disposition: "continued" | "decision-recorded" | "current" | "recovered";
  readonly action: "continue" | "record-decision";
  readonly demandId: WakeflowDurableId<"demand">;
  readonly event: EventReceipt;
  readonly package: PackageReceipt | null;
}

/** 配置里的 pod（只取 continue 需要的 id 与 lifecycle）；已不存在即 null。 */
function configuredPod(context: DemandSliceContext, podId: string) {
  const pod = Object.hasOwn(context.snapshot.indexes.podById, podId)
    ? context.snapshot.indexes.podById[podId as WakeflowDurableId<"pod">]
    : undefined;
  return pod === undefined ? null : Object.freeze({ podId: pod.podId, lifecycle: pod.lifecycle });
}

async function planContinue(
  context: DemandSliceContext,
  input: Extract<DemandContinuationRequest, { readonly action: "continue" }>,
): Promise<PublicationTransactionPlan<ContinuationPlan>> {
  const demandId = parseDemandId(input.demandId);
  const handle = await openDemandHandle(context, demandId);
  const archive = await findLatestDemandArchive(context.ledgerRoot, demandId, context.signal);
  const claim = archive === null ? null : await readClaim(context, archive.manifest.requirementId);
  const blockers = deriveContinueBlockers({
    rootPresent: handle !== null,
    archiveOutcome: archive?.manifest.outcome ?? null,
    demandId,
    claim: claim?.state ?? null,
    otherActiveDemandId:
      archive === null ? null : await activeDemandOnPod(context, archive.manifest.podId, demandId),
    archivedPodId: archive?.manifest.podId ?? null,
    pod: archive === null ? null : configuredPod(context, archive.manifest.podId),
  });
  if (blockers.length > 0 || archive === null || claim === null) return blockedPlan(blockers);
  const ids = deriveLifecycleIds(
    demandId,
    "continue",
    archive.manifest.terminalEvent.streamRevision,
  );
  return readyPlan<ContinuationPlan>(
    Object.freeze({
      action: "continue",
      demandId,
      archiveRef: archive.archiveRef,
      archiveManifestDigest: manifestDigest(
        archive.manifest.manifestDigest,
        "$manifest.manifestDigest",
      ),
      payloadTreeDigest: manifestDigest(
        archive.manifest.payload.treeDigest,
        "$manifest.payload.treeDigest",
      ),
      expectedStreamRevision: archive.manifest.terminalEvent.streamRevision,
      eventId: ids.eventId,
      commitId: ids.commitId,
      continuation: Object.freeze({
        kind: input.continuation.kind,
        summary: input.continuation.summary,
      }),
      package: Object.freeze({
        requirementId: archive.manifest.requirementId,
        expectedClaimStateDigest: claim.digest,
        ...manifestLineage(archive.manifest),
      }),
      configDigest: context.snapshot.configDigest,
    }),
  );
}

async function planDecision(
  context: DemandSliceContext,
  input: Extract<DemandContinuationRequest, { readonly action: "record-decision" }>,
): Promise<PublicationTransactionPlan<ContinuationPlan>> {
  const demandId = parseDemandId(input.demandId);
  const handle = await openDemandHandle(context, demandId);
  const state = handle?.loaded.aggregate.state;
  const blockers = deriveDecisionBlockers({
    rootPresent: handle !== null,
    lifecycle: state?.lifecycle ?? null,
    awaitingDecision: state?.awaitingDecision !== undefined,
  });
  if (blockers.length > 0 || handle === null || state?.awaitingDecision === undefined)
    return blockedPlan(blockers);
  const ids = deriveLifecycleIds(
    demandId,
    "record-decision",
    handle.loaded.aggregate.streamRevision,
  );
  return readyPlan<ContinuationPlan>(
    Object.freeze({
      action: "record-decision",
      demandId,
      expectedStreamRevision: handle.loaded.aggregate.streamRevision,
      eventId: ids.eventId,
      commitId: ids.commitId,
      escalationEventId: state.awaitingDecision.escalationEventId,
      decision: Object.freeze({
        text: input.decision.text,
        chosenOption: input.decision.chosenOption,
      }),
      configDigest: context.snapshot.configDigest,
    }),
  );
}

async function restoredPayload(
  context: DemandSliceContext,
  plan: ContinuePlan,
): Promise<readonly PayloadFile[]> {
  const payload = await readArchivePayload(context.ledgerRoot, plan.archiveRef, context.signal);
  const digest = computePayloadTreeDigest(
    payload.map((file) => ({
      resourcePath: file.resourcePath,
      byteCount: file.bytes.byteLength,
      digest: file.digest,
    })),
  );
  if (digest !== plan.payloadTreeDigest)
    fail("precondition-failed", "archive-payload-drift", "$archive");
  return payload;
}

/** 步骤 3（续接）：需求包 archived → claimed；已 claimed 即 current。 */
async function reclaimPackage(
  context: DemandSliceContext,
  plan: ContinuePlan,
): Promise<PackageReceipt> {
  const source = await readClaim(context, plan.package.requirementId);
  if (source === null) fail("recovery-required", "claim-state-vanished", "$board");
  const lineage = { recordRef: plan.package.recordRef, recordDigest: plan.package.recordDigest };
  if (source.state.status === "claimed" && source.state.claim?.demandId === plan.demandId) {
    return packageReceipt(source, lineage);
  }
  const next = reclaimRequirementPackage(source.state, plan.demandId, now(context));
  await replaceRequirementClaimStateFile(context.root, source, next, context.signal);
  const reread = await readClaim(context, plan.package.requirementId);
  if (reread === null) fail("recovery-required", "claim-state-vanished", "$board");
  return packageReceipt(reread, lineage);
}

async function applyContinue(
  context: DemandSliceContext,
  plan: ContinuePlan,
  disposition: "apply" | "recover",
): Promise<ContinuationOutcome> {
  const demandId = parseDemandId(plan.demandId);
  await writeJournal(context, {
    kind: JOURNAL_KIND,
    schemaVersion: 1,
    plan,
    planDigest: planDigest(plan),
    verify: null,
  });
  await releaseDemandHandle(context);
  await restoreDemandRoot(
    context.root,
    plan.demandId,
    await restoredPayload(context, plan),
    context.signal,
  );
  const handle = await openDemandHandle(context, demandId, { reload: true });
  if (handle === null) fail("recovery-required", "demand-root-restore", "$demandRoot");
  let event: EventReceipt;
  let committed = false;
  if (handle.loaded.aggregate.state.lifecycle === "completed") {
    const appended = await appendLifecycleEvent(
      context,
      handle,
      Object.freeze({
        commandType: "lifecycle.continue-demand",
        commandVersion: 1,
        demandId,
        eventId: plan.eventId as WakeflowDurableId<"demand-event">,
        recordedAt: now(context),
        continuation: Object.freeze({
          kind: plan.continuation.kind,
          summary: plan.continuation.summary,
          archiveRef: plan.archiveRef,
          archiveManifestDigest: plan.archiveManifestDigest,
          previousStreamRevision: plan.expectedStreamRevision,
        }),
      }),
      plan.commitId,
      plan.expectedStreamRevision,
    );
    event = appended.receipt;
    committed = appended.committed;
  } else {
    event = await findEventReceipt(context, handle, plan.commitId);
  }
  const packageState = await reclaimPackage(context, plan);
  await deleteJournal(context, plan.demandId);
  await refreshBoardIndexQuietly(context);
  return Object.freeze({
    disposition: disposition === "recover" ? "recovered" : committed ? "continued" : "current",
    action: "continue",
    demandId,
    event,
    package: packageState,
  });
}

async function applyDecision(
  context: DemandSliceContext,
  plan: DecisionPlan,
): Promise<ContinuationOutcome> {
  const demandId = parseDemandId(plan.demandId);
  const handle = await openDemandHandle(context, demandId, { reload: true });
  if (handle === null) fail("precondition-failed", "demand-root-absent", "$demandRoot");
  const appended = await appendLifecycleEvent(
    context,
    handle,
    Object.freeze({
      commandType: "lifecycle.record-decision",
      commandVersion: 1,
      demandId,
      eventId: plan.eventId as WakeflowDurableId<"demand-event">,
      recordedAt: now(context),
      decision: Object.freeze({
        escalationEventId: plan.escalationEventId,
        text: plan.decision.text,
        chosenOption: plan.decision.chosenOption,
      }),
    }),
    plan.commitId,
    plan.expectedStreamRevision,
  );
  return Object.freeze({
    disposition: appended.committed ? "decision-recorded" : "current",
    action: "record-decision",
    demandId,
    event: appended.receipt,
    package: null,
  });
}

async function recoverContinuation(
  context: DemandSliceContext,
  operationId: string,
): Promise<ContinuationOutcome> {
  const demandId = parseDemandId(operationId, "$request.operationId");
  const journal = await readJournal(context, demandId);
  if (journal === null || journal.plan.action !== "continue") {
    fail("not-found", "journal-absent", "$request.operationId");
  }
  return applyContinue(context, journal.plan, "recover");
}

function assembleContinuationResult(
  envelope: Readonly<PublicationTransactionEnvelope>,
  input: DemandContinuationRequest,
  phase: PublicationTransactionPhase<ContinuationPlan, ContinuationOutcome>,
  next: NextProjection,
): DemandContinuationResult {
  const base = {
    schemaVersion: WAKEFLOW_DEMAND_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_DEMAND_CONTINUATION_PUBLIC_TOOL_NAME,
    next,
  };
  if (phase.mode === "preview") {
    if (input.mode === "recover") fail("unexpected", "preview-mode", "$request.mode");
    return admitDemandContinuationResult({
      ...base,
      kind: "WakeflowDemandContinuationPreview",
      mode: "preview",
      action: input.action,
      status: phase.planned.status,
      blockers: phase.planned.blockers,
      planDigest: phase.planned.digest,
      demandId: input.demandId,
    });
  }
  return admitDemandContinuationResult({
    ...base,
    kind: "WakeflowDemandContinuationMutation",
    mode: envelope.mode,
    action: phase.outcome.action,
    disposition: phase.outcome.disposition,
    demandId: phase.outcome.demandId,
    event: phase.outcome.event,
    package: phase.outcome.package,
  });
}

/** 执行一次 `wakeflow_continue_demand`。 */
export async function executeDemandContinuationRequest(
  value: unknown,
  options: DemandServiceOptions = {},
): Promise<DemandContinuationResult> {
  return runPublicationTransaction<
    DemandContinuationRequest,
    DemandSliceContext,
    ContinuationPlan,
    ContinuationOutcome,
    DemandContinuationResult
  >(
    {
      tool: WAKEFLOW_DEMAND_CONTINUATION_PUBLIC_TOOL_NAME,
      parseRequest: (raw) => {
        const request = parseDemandContinuationRequest(raw);
        return { envelope: publicationEnvelope(request), input: request };
      },
      open: (root) => openSliceContext(root, options),
      close: closeSliceContext,
      plan: (context, input) => {
        if (input.mode === "recover") fail("unexpected", "plan-mode", "$request.mode");
        return input.action === "continue"
          ? planContinue(context, input)
          : planDecision(context, input);
      },
      apply: (context, _input, plan) =>
        afterMutationRefresh(context.root, context.signal, () =>
          plan.action === "continue"
            ? applyContinue(context, plan, "apply")
            : applyDecision(context, plan),
        ),
      recover: (context, operationId) => recoverContinuation(context, operationId),
      next: async (context, phase) =>
        phase.mode === "preview"
          ? previewNext(
              WAKEFLOW_DEMAND_CONTINUATION_PUBLIC_TOOL_NAME,
              "demand-continuation-apply",
              phase.planned,
            )
          : nextAfterMutation(context, phase.outcome.demandId),
      result: (envelope, input, phase, next) =>
        assembleContinuationResult(envelope, input, phase, next),
      privateValues: (context) => [context.snapshot.ledgerRoot, context.ledgerRoot.absolutePath],
    },
    value,
    commandShellExecutionOptions(options.durability),
  );
}
