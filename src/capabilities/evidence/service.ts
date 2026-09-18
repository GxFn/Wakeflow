import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
  type WakeflowConfigAuthoritySnapshot,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest, Sha256Error } from "../../foundation/crypto/sha256.js";
import type { WakeflowErrorCode } from "../../contracts/vocabulary/wakeflow-error-code.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import type { UtcWallClock } from "../../foundation/time/wall-clock.js";
import { buildDemandControllerRoute } from "../../governance/controller/demand-controller-route.js";
import {
  closeDemandOperationAuthorityContext,
  DemandOperationAuthorityContextError,
  openDemandReadAuthorityContext,
  type DemandOperationAuthorityContext,
} from "../../governance/demand/demand-operation-authority-context.js";
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
} from "../../governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import type { DemandEventStreamCommit } from "../../governance/demand/event-sourcing/demand-event-stream-commit.js";
import type { DemandManagedEvidenceSummary } from "../../governance/demand/model/demand-aggregate-state.js";
import type { ManagedEvidenceCapturePlan } from "../../governance/evidence/managed-evidence-capture-plan.js";
import {
  ManagedEvidenceCapturePlanningService,
  ManagedEvidenceCapturePlanningServiceError,
} from "../../governance/evidence/managed-evidence-capture-planning-service.js";
import {
  ManagedEvidencePublicationApplicationService,
  ManagedEvidencePublicationApplicationServiceError,
  type ManagedEvidencePublicationCompletionResult,
  type ManagedEvidencePublicationRecoveryResult,
} from "../../governance/evidence/managed-evidence-publication-application-service.js";
import {
  computeManagedEvidencePublicationTransactionDigest,
  createManagedEvidencePublicationTransaction,
  ManagedEvidencePublicationTransactionError,
} from "../../governance/evidence/managed-evidence-publication-transaction.js";
import { readDemandResultReviewSnapshot } from "../../governance/review/demand-result-review-snapshot.js";
import { afterMutationRefresh } from "../../governance/observation/active-projection-refresh.js";
import { fail } from "../../kernel/error.js";
import { deriveNextProjection, type NextProjection } from "../../kernel/next-projection.js";
import {
  runPublicationTransaction,
  type PublicationTransactionEnvelope,
  type PublicationTransactionPhase,
  type PublicationTransactionPlan,
} from "../../kernel/publication-transaction.js";
import {
  admitRecordEvidenceResult,
  parseRecordEvidenceRequest,
  WAKEFLOW_RECORD_EVIDENCE_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_RECORD_EVIDENCE_PUBLIC_TOOL_NAME,
  type RecordEvidenceRequest,
  type RecordEvidenceResult,
} from "./contract.js";
import {
  deriveEvidenceEventIdentity,
  deriveEvidencePlanDigest,
  evidencePlanSummary,
  evidencePreviewNext,
} from "./decide.js";

/**
 * Wakeflow Capabilities / Evidence：`wakeflow_record_evidence` 的效果型服务（gate-log §13.89）。
 *
 * preview 与 apply 共用同一次零写捕获规划：apply 在当前工作区状态上重算计划，只有内容摘要
 * 相符才把计划交给治理层的发布应用服务（journal → stage → Event → final）。同一内容再次
 * apply 返回 `already-recorded`；recover 凭 demandId 完成 Demand 根内唯一的 journal。
 */

export interface ExecuteEvidenceOptions {
  readonly clock?: UtcWallClock;
  readonly signal?: AbortSignal;
}

interface EvidenceSliceContext {
  readonly root: RootedDirectory;
  readonly snapshot: Readonly<WakeflowConfigAuthoritySnapshot>;
  readonly options: ExecuteEvidenceOptions;
}

interface EvidencePlan {
  readonly capturePlan: Readonly<ManagedEvidenceCapturePlan>;
  readonly recorded: Readonly<DemandManagedEvidenceSummary> | null;
}

interface EvidencePublication {
  readonly evidenceId: string;
  readonly kind: string;
  readonly manifestDigest: string;
  readonly payloadArtifactDigest: string;
  readonly event: Readonly<{
    readonly eventId: string;
    readonly streamRevision: number;
    readonly commitId: string;
  }>;
  readonly stateDigest: string;
}

interface EvidenceOutcome {
  readonly disposition: "recorded" | "already-recorded" | "recovered" | "retired" | "healthy";
  readonly demandId: WakeflowDurableId<"demand">;
  readonly publication: Readonly<EvidencePublication> | null;
}

function signalOptions(signal: AbortSignal | undefined): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

function parseDemandId(value: unknown): WakeflowDurableId<"demand"> {
  try {
    return parseWakeflowDurableIdOfKind(value, "demand", "$request.demandId");
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("invalid-request", "demand-id", "$request.demandId", { cause: error });
    }
    throw error;
  }
}

function envelopeOf(request: RecordEvidenceRequest): PublicationTransactionEnvelope {
  if (request.mode === "recover") {
    return Object.freeze({
      root: request.root,
      mode: "recover" as const,
      planDigest: null,
      operationId: parseDemandId(request.demandId),
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
  options: ExecuteEvidenceOptions,
): Promise<EvidenceSliceContext> {
  try {
    const snapshot = await readWakeflowConfigAuthoritySnapshot(root, signalOptions(options.signal));
    return Object.freeze({ root, snapshot, options });
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      fail("precondition-failed", "config-authority", "$request.root", { cause: error });
    }
    throw error;
  }
}

function privateValues(context: EvidenceSliceContext): Iterable<string> {
  const values = new Set<string>([context.snapshot.ledgerRoot]);
  for (const entry of context.snapshot.placements.roots) {
    values.add(entry.absolutePath);
    if (entry.realPath !== null) values.add(entry.realPath);
  }
  return values;
}

type FailureRoute = readonly [WakeflowErrorCode, string, string];

const PLANNING_FAILURE_TABLE: Readonly<Partial<Record<string, FailureRoute>>> = Object.freeze({
  input: ["invalid-request", "selection", "$request.selection"],
  aborted: ["io-failure", "aborted", "$signal"],
  config: ["precondition-failed", "config-authority", "$request.root"],
  demand: ["precondition-failed", "demand-authority", "$request.demandId"],
  "source-root": ["precondition-failed", "source-root", "$request.selection.source"],
  source: ["precondition-failed", "source-missing", "$request.selection.source"],
  "source-type": ["precondition-failed", "source-type", "$request.selection"],
  "source-changed": ["precondition-failed", "source-changed", "$request.selection"],
  capacity: ["precondition-failed", "capacity", "$request.selection"],
  kind: ["precondition-failed", "kind", "$request.selection"],
});

function mapPlanningError(error: unknown): never {
  if (error instanceof ManagedEvidenceCapturePlanningServiceError) {
    const [code, reason, path] = PLANNING_FAILURE_TABLE[error.reason] ?? [
      "unexpected",
      error.reason,
      "$request",
    ];
    fail(code, reason, path, { cause: error });
  }
  throw error;
}

function mapApplicationError(error: unknown): never {
  if (error instanceof ManagedEvidencePublicationApplicationServiceError) {
    const cause = { cause: error, details: { authority: error.publicationAuthority } };
    if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", cause);
    if (error.reason === "input" || error.reason === "transaction") {
      fail("unexpected", error.reason, "$plan", cause);
    }
    if (error.reason === "config") {
      fail("precondition-failed", "config-authority", "$request.root", cause);
    }
    if (error.reason === "demand") {
      fail("precondition-failed", "demand-authority", "$request.demandId", cause);
    }
    fail("precondition-failed", error.reason, "$request", cause);
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

function mapContextError(error: unknown): never {
  if (error instanceof DemandOperationAuthorityContextError) {
    if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    fail("precondition-failed", `demand-root-${error.reason}`, "$request.demandId", {
      cause: error,
    });
  }
  throw error;
}

async function withDemandContext<Result>(
  context: EvidenceSliceContext,
  demandId: WakeflowDurableId<"demand">,
  use: (demand: Readonly<DemandOperationAuthorityContext>) => Promise<Result>,
): Promise<Result> {
  let demand: Readonly<DemandOperationAuthorityContext>;
  try {
    demand = await openDemandReadAuthorityContext(context.root, demandId, context.options.signal);
  } catch (error: unknown) {
    mapContextError(error);
  }
  let result: Result | undefined;
  let failure: unknown;
  let succeeded = false;
  try {
    result = await use(demand);
    succeeded = true;
  } catch (error: unknown) {
    failure = error;
  }
  try {
    await closeDemandOperationAuthorityContext(demand);
  } catch (error: unknown) {
    if (failure === undefined) failure = error;
  }
  if (failure !== undefined) throw failure;
  if (!succeeded) fail("unexpected", "demand-context", "$request.demandId");
  return result as Result;
}

async function planEvidence(
  context: EvidenceSliceContext,
  input: RecordEvidenceRequest,
): Promise<Readonly<PublicationTransactionPlan<EvidencePlan>>> {
  if (input.mode === "recover") fail("unexpected", "plan-mode", "$request.mode");
  const demandId = parseDemandId(input.demandId);
  let preview: Awaited<ReturnType<ManagedEvidenceCapturePlanningService["preview"]>>;
  try {
    preview = await new ManagedEvidenceCapturePlanningService(context.root).preview(
      demandId,
      input.selection,
      {
        ...(context.options.clock === undefined ? {} : { clock: context.options.clock }),
        ...signalOptions(context.options.signal),
      },
    );
  } catch (error: unknown) {
    mapPlanningError(error);
  }
  if (preview.status === "blocked") {
    return Object.freeze({
      status: "blocked" as const,
      blockers: preview.blockers,
      plan: null,
      digest: null,
    });
  }
  return Object.freeze({
    status: "ready" as const,
    blockers: Object.freeze([]),
    plan: Object.freeze({ capturePlan: preview.plan, recorded: preview.existing }),
    digest: deriveEvidencePlanDigest(preview.plan),
  });
}

function eventReceipt(
  commit: Readonly<DemandEventStreamCommit>,
  eventId: string,
): EvidencePublication["event"] {
  const stored = commit.events.find((event) => event.eventId === eventId);
  if (stored === undefined) fail("unexpected", "evidence-event-missing", "$result");
  return Object.freeze({
    eventId: stored.eventId,
    streamRevision: stored.streamRevision,
    commitId: commit.commitId,
  });
}

function completionPublication(
  completion: Readonly<ManagedEvidencePublicationCompletionResult>,
): Readonly<EvidencePublication> {
  const manifest = completion.transaction.manifest;
  return Object.freeze({
    evidenceId: manifest.evidenceId,
    kind: manifest.kind,
    manifestDigest: manifest.manifestDigest,
    payloadArtifactDigest: manifest.payload.artifactDigest,
    event: eventReceipt(
      completion.commit,
      completion.transaction.demandEventSourcingAppend.eventId,
    ),
    stateDigest: completion.loaded.aggregate.stateDigest,
  });
}

/** 同内容已记录：从聚合摘要与派生的 Commit 身份回放收据，不再读来源也不写任何东西。 */
async function replayRecorded(
  context: EvidenceSliceContext,
  demandId: WakeflowDurableId<"demand">,
  recorded: Readonly<DemandManagedEvidenceSummary>,
): Promise<EvidenceOutcome> {
  const identity = deriveEvidenceEventIdentity(recorded.evidenceId);
  return withDemandContext(context, demandId, async (demand) => {
    let commit: Readonly<DemandEventStreamCommit> | null;
    try {
      commit = await new DemandEventSourcingRepository(demand.demandRoot).findCommitById(
        identity.commitId,
        signalOptions(context.options.signal),
      );
    } catch (error: unknown) {
      mapRepositoryError(error);
    }
    if (commit === null) fail("precondition-failed", "evidence-commit-missing", "$request");
    return Object.freeze({
      disposition: "already-recorded" as const,
      demandId,
      publication: Object.freeze({
        evidenceId: recorded.evidenceId,
        kind: recorded.kind,
        manifestDigest: recorded.manifestDigest,
        payloadArtifactDigest: recorded.payloadArtifactDigest,
        event: eventReceipt(commit, identity.eventId),
        stateDigest: demand.loaded.aggregate.stateDigest,
      }),
    });
  });
}

async function applyEvidence(
  context: EvidenceSliceContext,
  input: RecordEvidenceRequest,
  plan: EvidencePlan,
): Promise<EvidenceOutcome> {
  const demandId = parseDemandId(input.demandId);
  if (plan.recorded !== null) return replayRecorded(context, demandId, plan.recorded);
  const identity = deriveEvidenceEventIdentity(plan.capturePlan.manifest.evidenceId);
  let transaction: ReturnType<typeof createManagedEvidencePublicationTransaction>;
  try {
    transaction = createManagedEvidencePublicationTransaction({
      capturePlan: plan.capturePlan,
      eventId: identity.eventId,
      commitId: identity.commitId,
    });
  } catch (error: unknown) {
    if (error instanceof ManagedEvidencePublicationTransactionError) {
      fail("unexpected", "transaction", "$plan", { cause: error });
    }
    throw error;
  }
  let completion: Readonly<ManagedEvidencePublicationCompletionResult>;
  try {
    completion = await new ManagedEvidencePublicationApplicationService(context.root).apply(
      transaction,
      computeManagedEvidencePublicationTransactionDigest(transaction),
      signalOptions(context.options.signal),
    );
  } catch (error: unknown) {
    mapApplicationError(error);
  }
  return Object.freeze({
    disposition: "recorded" as const,
    demandId,
    publication: completionPublication(completion),
  });
}

async function recoverEvidence(
  context: EvidenceSliceContext,
  operationId: string,
): Promise<EvidenceOutcome> {
  const demandId = parseDemandId(operationId);
  let recovered: Readonly<ManagedEvidencePublicationRecoveryResult>;
  try {
    recovered = await new ManagedEvidencePublicationApplicationService(context.root).recover(
      demandId,
      signalOptions(context.options.signal),
    );
  } catch (error: unknown) {
    mapApplicationError(error);
  }
  if (recovered.disposition === "completed") {
    return Object.freeze({
      disposition: "recovered" as const,
      demandId,
      publication: completionPublication(recovered),
    });
  }
  return Object.freeze({
    disposition:
      recovered.disposition === "retired-stale" ? ("retired" as const) : ("healthy" as const),
    demandId,
    publication: null,
  });
}

/** 变更后的 `next` 直接来自当前 Controller 路由；证据记录本身不改变前沿。 */
async function nextAfterMutation(
  context: EvidenceSliceContext,
  demandId: WakeflowDurableId<"demand">,
): Promise<NextProjection> {
  return withDemandContext(context, demandId, async (demand) => {
    const snapshot = await readDemandResultReviewSnapshot(
      demand.demandRoot,
      signalOptions(context.options.signal),
    );
    return deriveNextProjection(buildDemandControllerRoute(demand.loaded, snapshot));
  });
}

function assembleResult(
  input: RecordEvidenceRequest,
  phase: PublicationTransactionPhase<EvidencePlan, EvidenceOutcome>,
  next: Readonly<NextProjection>,
): RecordEvidenceResult {
  const base = {
    schemaVersion: WAKEFLOW_RECORD_EVIDENCE_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_RECORD_EVIDENCE_PUBLIC_TOOL_NAME,
    next,
  };
  if (phase.mode === "preview") {
    const plan = phase.planned.plan;
    return admitRecordEvidenceResult({
      kind: "WakeflowRecordEvidencePreview",
      ...base,
      mode: "preview",
      status: phase.planned.status,
      blockers: phase.planned.blockers,
      planDigest: phase.planned.digest,
      demandId: input.demandId,
      plan: plan === null ? null : evidencePlanSummary(plan.capturePlan, plan.recorded !== null),
    });
  }
  return admitRecordEvidenceResult({
    kind: "WakeflowRecordEvidenceMutation",
    ...base,
    mode: phase.mode,
    disposition: phase.outcome.disposition,
    demandId: phase.outcome.demandId,
    publication: phase.outcome.publication,
  });
}

/** 执行一次 `wakeflow_record_evidence`。 */
export async function executeRecordEvidenceRequest(
  value: unknown,
  options: ExecuteEvidenceOptions = {},
): Promise<RecordEvidenceResult> {
  return runPublicationTransaction<
    RecordEvidenceRequest,
    EvidenceSliceContext,
    EvidencePlan,
    EvidenceOutcome,
    RecordEvidenceResult
  >(
    {
      tool: WAKEFLOW_RECORD_EVIDENCE_PUBLIC_TOOL_NAME,
      parseRequest: (raw) => {
        const request = parseRecordEvidenceRequest(raw);
        return { envelope: envelopeOf(request), input: request };
      },
      open: (root) => openContext(root, options),
      close: async () => {},
      plan: planEvidence,
      apply: (context, input, plan) =>
        afterMutationRefresh(context.root, context.options.signal, () =>
          applyEvidence(context, input, plan),
        ),
      recover: recoverEvidence,
      next: async (context, phase) =>
        phase.mode === "preview"
          ? evidencePreviewNext(phase.planned)
          : nextAfterMutation(context, phase.outcome.demandId),
      result: (_envelope, input, phase, next) => assembleResult(input, phase, next),
      privateValues,
    },
    value,
  );
}
