import { types } from "node:util";

import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import type { TaskPackage } from "../tasking/task-package.js";
import type { TargetResultOutcome } from "../result/target-result-report-contract.js";
import type { TargetResult } from "../result/target-result.js";
import type { ControllerReviewDecision } from "./controller-review-decision.js";
import type { ControllerTargetReviewResume } from "./controller-target-review-resume.js";
import type {
  DemandLifecycle,
  DemandTargetTaskState,
} from "../demand/model/demand-aggregate-state.js";
import type {
  DemandEventCommitSequence,
  DemandEventStreamRevision,
} from "../demand/event-sourcing/demand-event-stream-position.js";
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
  type AuditedDemandTargetResultHistory,
  type DemandTargetResultSourceEvent,
} from "../demand/event-sourcing/demand-event-sourcing-repository.js";

/**
 * Wakeflow Governance / Review：从Demand Event Stream即时重建的结果审查读模型。
 *
 * Snapshot把当前Aggregate选择的Target Task与完整TaskPackage、TargetResult及已有Review
 * Decision事件闭合，供Controller读取审查输入和既有决定。它是零写、可丢弃、可重建的
 * CQRS读模型，不生成ReviewCandidate、Controller决定或acceptance，也不推导allowed
 * decisions和next action。
 */

const SNAPSHOT_KIND = "WakeflowDemandResultReviewSnapshot" as const;
const SNAPSHOT_SCHEMA_VERSION = 1 as const;

type AwaitingResultPhase = Exclude<
  DemandTargetTaskState["phase"],
  | "result-reported"
  | "test-result-reported"
  | "accepted"
  | "product-defect-rework-requested"
  | "rework-requested"
  | "redesign-requested"
  | "review-blocked"
  | "test-accepted"
  | "test-another-attempt-requested"
  | "test-product-defect"
  | "test-review-blocked"
>;

type ReviewDecidedPhase = Extract<
  DemandTargetTaskState["phase"],
  | "accepted"
  | "product-defect-rework-requested"
  | "rework-requested"
  | "redesign-requested"
  | "review-blocked"
  | "test-accepted"
  | "test-another-attempt-requested"
  | "test-product-defect"
  | "test-review-blocked"
>;

export interface DemandResultReviewAwaitingTarget {
  readonly status: "awaiting-result";
  readonly phase: AwaitingResultPhase;
  readonly workType: TaskPackage["workType"];
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly taskPackage: Readonly<{
    readonly taskPackageId: WakeflowDurableId<"task-package">;
    readonly digest: Sha256Digest;
  }>;
  readonly assignment: TaskPackage["assignment"];
}

export interface DemandResultReviewReportedTarget {
  readonly status: "reported";
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly outcome: TargetResultOutcome;
  readonly taskPackageSourceEvent: Readonly<DemandTargetResultSourceEvent>;
  readonly taskPackage: Readonly<TaskPackage>;
  readonly targetResultSourceEvent: Readonly<DemandTargetResultSourceEvent>;
  readonly targetResult: Readonly<TargetResult>;
  readonly priorReviewHistory: readonly Readonly<DemandTargetReviewHistoryEntry>[];
  readonly reviewUnitDigest: Sha256Digest;
}

/** 当前Target Task在本次决定之前的有序Decision/Resume历史。 */
export type DemandTargetReviewHistoryEntry =
  | Readonly<{
      readonly kind: "decision";
      readonly sourceEvent: Readonly<DemandTargetResultSourceEvent>;
      readonly decision: Readonly<ControllerReviewDecision>;
    }>
  | Readonly<{
      readonly kind: "resume";
      readonly sourceEvent: Readonly<DemandTargetResultSourceEvent>;
      readonly resume: Readonly<ControllerTargetReviewResume>;
    }>;

export interface DemandResultReviewDecidedTarget {
  readonly status: "review-decided";
  readonly phase: ReviewDecidedPhase;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly outcome: TargetResultOutcome;
  readonly taskPackageSourceEvent: Readonly<DemandTargetResultSourceEvent>;
  readonly taskPackage: Readonly<TaskPackage>;
  readonly targetResultSourceEvent: Readonly<DemandTargetResultSourceEvent>;
  readonly targetResult: Readonly<TargetResult>;
  readonly priorReviewHistory: readonly Readonly<DemandTargetReviewHistoryEntry>[];
  readonly reviewUnitDigest: Sha256Digest;
  readonly reviewDecisionSourceEvent: Readonly<DemandTargetResultSourceEvent>;
  readonly reviewDecision: Readonly<ControllerReviewDecision>;
}

export type DemandResultReviewTarget =
  | DemandResultReviewAwaitingTarget
  | DemandResultReviewReportedTarget
  | DemandResultReviewDecidedTarget;

export interface DemandResultReviewSnapshot {
  readonly kind: typeof SNAPSHOT_KIND;
  readonly schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  readonly demand: Readonly<{
    readonly demandId: WakeflowDurableId<"demand">;
    readonly lifecycle: DemandLifecycle;
  }>;
  readonly eventStream: Readonly<{
    readonly commitSequence: DemandEventCommitSequence;
    readonly streamRevision: DemandEventStreamRevision;
    readonly lastCommitDigest: Sha256Digest;
    readonly lastEventId: WakeflowDurableId<"demand-event">;
    readonly lastEventDigest: Sha256Digest;
    readonly stateDigest: Sha256Digest;
  }>;
  readonly targets: readonly Readonly<DemandResultReviewTarget>[];
  readonly snapshotDigest: Sha256Digest;
}

export type DemandResultReviewSnapshotErrorReason =
  "input" | "stream" | "relation" | "aborted" | "operation-failure";

const ERROR_MESSAGES = {
  input: "Demand Result Review Snapshot input is invalid.",
  stream: "Demand Result Review Snapshot event stream is invalid.",
  relation: "Demand Result Review Snapshot sources are inconsistent.",
  aborted: "Demand Result Review Snapshot was aborted.",
  "operation-failure": "Demand Result Review Snapshot failed.",
} as const satisfies Readonly<
  Record<DemandResultReviewSnapshotErrorReason, string>
>;

/** 结果审查读模型无法由当前Event Stream安全重建时的稳定错误。 */
export class DemandResultReviewSnapshotError extends Error {
  override readonly name = "DemandResultReviewSnapshotError";
  readonly code = "wakeflow-demand-result-review-snapshot" as const;
  readonly reason: DemandResultReviewSnapshotErrorReason;

  constructor(reason: DemandResultReviewSnapshotErrorReason) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

function fail(reason: DemandResultReviewSnapshotErrorReason): never {
  throw new DemandResultReviewSnapshotError(reason);
}

function parseSignal(value: unknown): AbortSignal | undefined {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input");
    throw error;
  }
  if (
    Object.keys(record).some((key) => key !== "signal") ||
    (record.signal !== undefined &&
      (typeof record.signal !== "object" ||
        record.signal === null ||
        types.isProxy(record.signal) ||
        !(record.signal instanceof AbortSignal)))
  ) {
    fail("input");
  }
  return record.signal as AbortSignal | undefined;
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    !(value instanceof RootedDirectory)
  ) {
    fail("input");
  }
}

function lexicalCompare(left: string, right: string): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0;
}

function reportedTargetBasis(
  targetTaskId: WakeflowDurableId<"target-task">,
  taskPackageSourceEvent: Readonly<DemandTargetResultSourceEvent>,
  taskPackage: Readonly<TaskPackage>,
  targetResultSourceEvent: Readonly<DemandTargetResultSourceEvent>,
  targetResult: Readonly<TargetResult>,
  priorReviewHistory: readonly Readonly<DemandTargetReviewHistoryEntry>[],
): Omit<DemandResultReviewReportedTarget, "reviewUnitDigest"> {
  return {
    status: "reported",
    targetTaskId,
    outcome: targetResult.report.outcome,
    taskPackageSourceEvent,
    taskPackage,
    targetResultSourceEvent,
    targetResult,
    priorReviewHistory,
  };
}

function priorReviewHistory(
  sources: Readonly<AuditedDemandTargetResultHistory>,
  targetTaskId: WakeflowDurableId<"target-task">,
  beforeStreamRevision: number | null,
): readonly Readonly<DemandTargetReviewHistoryEntry>[] {
  const decisions = sources.targetReviewDecisions
    .filter(
      (entry) =>
        entry.decision.targetTaskId === targetTaskId &&
        (beforeStreamRevision === null ||
          entry.sourceEvent.streamRevision < beforeStreamRevision),
    )
    .map((entry) =>
      Object.freeze({
        kind: "decision" as const,
        sourceEvent: entry.sourceEvent,
        decision: entry.decision,
      }),
    );
  const resumes = sources.targetReviewResumes
    .filter(
      (entry) =>
        entry.resume.targetTaskId === targetTaskId &&
        (beforeStreamRevision === null ||
          entry.sourceEvent.streamRevision < beforeStreamRevision),
    )
    .map((entry) =>
      Object.freeze({
        kind: "resume" as const,
        sourceEvent: entry.sourceEvent,
        resume: entry.resume,
      }),
    );
  return Object.freeze(
    [...decisions, ...resumes].sort(
      (left, right) =>
        left.sourceEvent.streamRevision - right.sourceEvent.streamRevision,
    ),
  );
}

type ResultBearingTarget = Extract<
  DemandTargetTaskState,
  {
    readonly phase:
      "result-reported" | "test-result-reported" | ReviewDecidedPhase;
  }
>;

function isResultBearingTarget(
  target: Readonly<DemandTargetTaskState>,
): target is Readonly<ResultBearingTarget> {
  return (
    target.phase === "result-reported" ||
    target.phase === "test-result-reported" ||
    target.phase === "accepted" ||
    target.phase === "product-defect-rework-requested" ||
    target.phase === "rework-requested" ||
    target.phase === "redesign-requested" ||
    target.phase === "review-blocked" ||
    target.phase === "test-accepted" ||
    target.phase === "test-another-attempt-requested" ||
    target.phase === "test-product-defect" ||
    target.phase === "test-review-blocked"
  );
}

function buildTargets(
  sources: Readonly<AuditedDemandTargetResultHistory>,
): readonly Readonly<DemandResultReviewTarget>[] {
  const taskPackageById = new Map(
    sources.taskPackages.map(
      (source) => [source.taskPackage.taskPackageId, source] as const,
    ),
  );
  const targetResultById = new Map(
    sources.targetResults.map(
      (source) => [source.result.targetResultId, source] as const,
    ),
  );
  const reviewDecisionById = new Map(
    sources.targetReviewDecisions.map(
      (source) => [source.decision.targetReviewDecisionId, source] as const,
    ),
  );
  const targets = sources.aggregate.state.targetTasks.map((target) => {
    const taskPackageSource = taskPackageById.get(target.taskPackageId);
    if (
      taskPackageSource === undefined ||
      taskPackageSource.taskPackage.targetTaskId !== target.targetTaskId ||
      (taskPackageSource.taskPackage.workType === "test") !==
        (target.workType === "test") ||
      taskPackageSource.taskPackage.assignment.windowId !== target.windowId ||
      (taskPackageSource.taskPackage.workType === "implementation" &&
        (target.workType === "test" ||
          taskPackageSource.taskPackage.assignment.repositoryId !==
            target.repositoryId)) ||
      (taskPackageSource.taskPackage.workType === "test" &&
        (target.workType !== "test" ||
          taskPackageSource.taskPackage.testCard.testCardId !==
            target.testCard.testCardId ||
          taskPackageSource.taskPackage.testCard.testCardDigest !==
            target.testCard.testCardDigest))
    ) {
      fail("relation");
    }
    if (!isResultBearingTarget(target)) {
      return Object.freeze({
        status: "awaiting-result" as const,
        phase: target.phase,
        workType: target.workType === "test" ? "test" : "implementation",
        targetTaskId: target.targetTaskId,
        taskPackage: Object.freeze({
          taskPackageId: target.taskPackageId,
          digest: target.taskPackageDigest,
        }),
        assignment: taskPackageSource.taskPackage.assignment,
      });
    }
    const targetResultSource = targetResultById.get(
      target.currentDelivery.targetResult.targetResultId,
    );
    if (
      targetResultSource === undefined ||
      (targetResultSource.result.workType === "test") !==
        (target.workType === "test") ||
      targetResultSource.result.targetTaskId !== target.targetTaskId ||
      targetResultSource.result.taskPackage.taskPackageId !==
        taskPackageSource.taskPackage.taskPackageId ||
      targetResultSource.result.taskPackage.digest !==
        target.taskPackageDigest ||
      targetResultSource.result.resultDigest !==
        target.currentDelivery.targetResult.resultDigest
    ) {
      fail("relation");
    }
    if (
      target.phase === "result-reported" ||
      target.phase === "test-result-reported"
    ) {
      const reportedBasis = reportedTargetBasis(
        target.targetTaskId,
        taskPackageSource.sourceEvent,
        taskPackageSource.taskPackage,
        targetResultSource.sourceEvent,
        targetResultSource.result,
        priorReviewHistory(sources, target.targetTaskId, null),
      );
      return Object.freeze({
        ...reportedBasis,
        reviewUnitDigest: computeCanonicalJsonSha256Digest(reportedBasis),
      });
    }
    const decisionSource = reviewDecisionById.get(
      target.currentDelivery.reviewDecision.targetReviewDecisionId,
    );
    if (
      decisionSource === undefined ||
      (decisionSource.decision.kind ===
        "WakeflowControllerTestReviewDecision") !==
        (target.workType === "test") ||
      decisionSource.decision.targetTaskId !== target.targetTaskId ||
      decisionSource.decision.reviewed.targetResultId !==
        targetResultSource.result.targetResultId ||
      decisionSource.decision.decisionDigest !==
        target.currentDelivery.reviewDecision.decisionDigest
    ) {
      fail("relation");
    }
    const reportedBasis = reportedTargetBasis(
      target.targetTaskId,
      taskPackageSource.sourceEvent,
      taskPackageSource.taskPackage,
      targetResultSource.sourceEvent,
      targetResultSource.result,
      priorReviewHistory(
        sources,
        target.targetTaskId,
        decisionSource.sourceEvent.streamRevision,
      ),
    );
    const reviewUnitDigest = computeCanonicalJsonSha256Digest(reportedBasis);
    if (
      decisionSource.decision.reviewed.reviewUnitDigest !== reviewUnitDigest
    ) {
      fail("relation");
    }
    return Object.freeze({
      ...reportedBasis,
      status: "review-decided" as const,
      phase: target.phase,
      reviewUnitDigest,
      reviewDecisionSourceEvent: decisionSource.sourceEvent,
      reviewDecision: decisionSource.decision,
    });
  });
  targets.sort((left, right) =>
    lexicalCompare(left.targetTaskId, right.targetTaskId),
  );
  return Object.freeze(targets);
}

function snapshotBasis(
  sources: Readonly<AuditedDemandTargetResultHistory>,
): Omit<DemandResultReviewSnapshot, "snapshotDigest"> {
  const aggregate = sources.aggregate;
  return {
    kind: SNAPSHOT_KIND,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    demand: Object.freeze({
      demandId: aggregate.demandId,
      lifecycle: aggregate.state.lifecycle,
    }),
    eventStream: Object.freeze({
      commitSequence: aggregate.commitSequence,
      streamRevision: aggregate.streamRevision,
      lastCommitDigest: aggregate.lastCommitDigest,
      lastEventId: aggregate.lastEvent.eventId,
      lastEventDigest: aggregate.lastEventDigest,
      stateDigest: aggregate.stateDigest,
    }),
    targets: buildTargets(sources),
  };
}

/** 从Repository同一次完整审计结果构造零写Review Snapshot。 */
export function buildDemandResultReviewSnapshotFromHistory(
  sources: Readonly<AuditedDemandTargetResultHistory>,
): Readonly<DemandResultReviewSnapshot> {
  const basis = snapshotBasis(sources);
  return Object.freeze({
    ...basis,
    snapshotDigest: computeCanonicalJsonSha256Digest(basis),
  });
}

/**
 * 完整审计一个已经打开的Demand Event Sourcing根，并返回零写的当前结果审查快照。
 */
export async function readDemandResultReviewSnapshot(
  rootValue: unknown,
  options?: { readonly signal?: AbortSignal },
): Promise<Readonly<DemandResultReviewSnapshot>> {
  assertRoot(rootValue);
  const signal = parseSignal(options);
  let sources: Readonly<AuditedDemandTargetResultHistory>;
  try {
    sources = await new DemandEventSourcingRepository(
      rootValue,
    ).auditTargetResultHistory(signal === undefined ? undefined : { signal });
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingRepositoryError) {
      if (error.reason === "input") fail("input");
      if (error.reason === "aborted") fail("aborted");
      if (error.reason === "stream" || error.reason === "not-found") {
        fail("stream");
      }
      fail("operation-failure");
    }
    throw error;
  }
  return buildDemandResultReviewSnapshotFromHistory(sources);
}
