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
import type {
  RootedDirectory,
  RootedDirectoryDurability,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableRootResourceTree,
  StableResourceTreeReadError,
  type StableResourceTreeReadResult,
} from "../../foundation/filesystem/stable-resource-tree-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
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
import {
  ManagedEvidenceRecordTreePlanError,
  planManagedEvidenceRecordTree,
} from "../../governance/evidence/managed-evidence-record-tree-plan.js";
import {
  DemandResultReviewSnapshotError,
  readDemandResultReviewSnapshot,
} from "../../governance/review/demand-result-review-snapshot.js";
import { afterMutationRefresh } from "../../governance/observation/active-projection-refresh.js";
import { fail } from "../../kernel/error.js";
import { WAKEFLOW_DEMAND_TREE_CAPACITY } from "../../kernel/limits.js";
import { deriveNextProjection, type NextProjection } from "../../kernel/next-projection.js";
import {
  runPublicationTransaction,
  type PublicationTransactionEnvelope,
  type PublicationTransactionPhase,
  type PublicationTransactionPlan,
} from "../../kernel/publication-transaction.js";
import { commandShellExecutionOptions } from "../../kernel/command-shell.js";
import {
  admitRecordEvidenceResult,
  parseRecordEvidenceRequest,
  WAKEFLOW_RECORD_EVIDENCE_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_RECORD_EVIDENCE_PUBLIC_TOOL_NAME,
  type RecordEvidenceRequest,
  type RecordEvidenceResult,
} from "./contract.js";
import {
  type DemandTreeOccupancy,
  deriveDemandCapacityBlockers,
  MANAGED_EVIDENCE_RECORD_EVENT_OCCUPANCY,
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
 *
 * 规划就绪后还要过累计容量（open-items W10）：归档与取消按 Demand 树容量读 Demand 根整树，所以这里用
 * 同一容量读当前整树、加上计划记录的成员，超出即以 `demand-capacity:<上限>` 阻塞；apply 重算计划时自然
 * 走同一条路，不另设检查。
 */

export interface ExecuteEvidenceOptions {
  /** 本次调用打开工作区根用的持久化级别；与 `clock` 同类的注入值，生产不传。 */
  readonly durability?: RootedDirectoryDurability;
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

/**
 * kind 与来源不配时路径指到 `kind` 字段：选择本身不配（文件来源配 `transcript`）与观察到的记录
 * 不带 transcript 都是改 kind 就能过的请求问题（gate-log §13.134，收 §13.133 G12）。
 */
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
  kind: ["invalid-request", "kind-source-mismatch", "$request.selection.kind"],
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
  let closeFailure: unknown;
  try {
    await closeDemandOperationAuthorityContext(demand);
  } catch (error: unknown) {
    closeFailure = error;
  }
  if (failure !== undefined) throw failure;
  if (closeFailure !== undefined) {
    fail("io-failure", "demand-root-close", "$request.demandId", { cause: closeFailure });
  }
  if (!succeeded) fail("unexpected", "demand-context", "$request.demandId");
  return result as Result;
}

/** 归档读 Demand 根整树的容量（kernel 常量）：与 demand 切片的归档读取同一组上限，切片之间不互相导入。 */
const DEMAND_TREE_CAPACITY = Object.freeze({
  maximumEntries: WAKEFLOW_DEMAND_TREE_CAPACITY.maximumEntries,
  maximumDepth: WAKEFLOW_DEMAND_TREE_CAPACITY.maximumDepth,
  maximumFiles: WAKEFLOW_DEMAND_TREE_CAPACITY.maximumFiles,
  maximumFileBytes: parseByteCount(
    WAKEFLOW_DEMAND_TREE_CAPACITY.maximumFileBytes,
    "$tree.maximumFileBytes",
  ),
  maximumTotalBytes: parseByteCount(
    WAKEFLOW_DEMAND_TREE_CAPACITY.maximumTotalBytes,
    "$tree.maximumTotalBytes",
  ),
});

/** 整树读取因容量失败的原因：当前 Demand 树本身已经超出，再记什么都归档不了。 */
const DEMAND_TREE_CAPACITY_REASONS: ReadonlySet<string> = new Set([
  "entry-limit",
  "depth-limit",
  "file-count",
  "file-bytes",
  "total-bytes",
]);

function mapDemandTreeReadError(error: StableResourceTreeReadError): never {
  if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
  if (error.reason === "source-changed") {
    fail("concurrency-conflict", "demand-root-read-source-changed", "$request.demandId", {
      cause: error,
      retryable: true,
    });
  }
  fail("io-failure", `demand-root-read-${error.reason}`, "$request.demandId", { cause: error });
}

/** `resourcePath` 的祖先目录里当前树还没有的个数：记录会把它们一并建出来。 */
function absentAncestorCount(resourcePath: string, present: ReadonlySet<string>): number {
  const segments = resourcePath.split("/");
  let absent = 0;
  for (let length = 1; length < segments.length; length += 1) {
    if (!present.has(segments.slice(0, length).join("/"))) absent += 1;
  }
  return absent;
}

/**
 * 计划记录会给 Demand 根增加的成员：记录目录自身、缺失的前缀目录、清单与 payload 的目录和文件，再加上
 * 记录事件追加到事件存储的 commit、index 与 snapshot。
 */
function plannedRecordOccupancy(
  plan: Readonly<ManagedEvidenceCapturePlan>,
  present: ReadonlySet<string>,
): DemandTreeOccupancy {
  let record: ReturnType<typeof planManagedEvidenceRecordTree>;
  try {
    record = planManagedEvidenceRecordTree(plan.manifest);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceRecordTreePlanError) {
      fail("unexpected", "record-tree-plan", "$plan", { cause: error });
    }
    throw error;
  }
  const members = record.directoryPlan.directories.length + record.directoryPlan.files.length;
  const event = MANAGED_EVIDENCE_RECORD_EVENT_OCCUPANCY;
  return Object.freeze({
    entries: 1 + absentAncestorCount(record.destinationRootPath, present) + members + event.entries,
    files: record.directoryPlan.files.length + event.files,
    totalBytes: Number(record.directoryPlan.totalBytes) + event.totalBytes,
  });
}

/**
 * 累计容量（open-items W10）：用归档的容量读当前 Demand 根整树，加上计划记录的成员，超出的上限成为阻塞项。
 * 当前树本身已经读不下时阻塞项带读取给出的上限名。同内容已记录的重放不增加成员，调用方不查。
 */
async function deriveDemandCapacityBlockersFor(
  context: EvidenceSliceContext,
  demandId: WakeflowDurableId<"demand">,
  plan: Readonly<ManagedEvidenceCapturePlan>,
): Promise<readonly string[]> {
  return withDemandContext(context, demandId, async (demand) => {
    let tree: Readonly<StableResourceTreeReadResult<null>>;
    try {
      tree = await readStableRootResourceTree(demand.demandRoot, {
        ...DEMAND_TREE_CAPACITY,
        ...signalOptions(context.options.signal),
      });
    } catch (error: unknown) {
      if (error instanceof StableResourceTreeReadError) {
        if (DEMAND_TREE_CAPACITY_REASONS.has(error.reason)) {
          return Object.freeze([`demand-capacity:${error.reason}`]);
        }
        mapDemandTreeReadError(error);
      }
      throw error;
    }
    const present = new Set<string>(tree.entries.map((entry) => entry.resourcePath));
    return deriveDemandCapacityBlockers(
      {
        entries: tree.entries.length,
        files: tree.files.length,
        totalBytes: Number(tree.totalFileBytes),
      },
      plannedRecordOccupancy(plan, present),
    );
  });
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
  if (preview.existing === null) {
    const blockers = await deriveDemandCapacityBlockersFor(context, demandId, preview.plan);
    if (blockers.length > 0) {
      return Object.freeze({ status: "blocked" as const, blockers, plan: null, digest: null });
    }
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

/** 提交后读取复核快照；快照错误映射为稳定的 Wakeflow 错误，而不是 unexpected。 */
async function readSnapshotForNext(
  context: EvidenceSliceContext,
  demand: Readonly<DemandOperationAuthorityContext>,
): ReturnType<typeof readDemandResultReviewSnapshot> {
  try {
    return await readDemandResultReviewSnapshot(
      demand.demandRoot,
      signalOptions(context.options.signal),
    );
  } catch (error: unknown) {
    if (error instanceof DemandResultReviewSnapshotError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      fail("io-failure", "result-review-snapshot", "$request.demandId", { cause: error });
    }
    throw error;
  }
}

/** 变更后的 `next` 直接来自当前 Controller 路由；证据记录本身不改变前沿。 */
async function nextAfterMutation(
  context: EvidenceSliceContext,
  demandId: WakeflowDurableId<"demand">,
): Promise<NextProjection> {
  return withDemandContext(context, demandId, async (demand) => {
    const snapshot = await readSnapshotForNext(context, demand);
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
      mutationScope: "shared",
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
    commandShellExecutionOptions(options.durability, options.signal),
  );
}
