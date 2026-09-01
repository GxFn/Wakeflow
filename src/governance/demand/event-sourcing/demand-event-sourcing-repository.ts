import { types } from "node:util";

import type { Sha256Digest } from "../../../foundation/crypto/sha256.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../../foundation/data/passive-own-data.js";
import { RootedDirectory } from "../../../foundation/filesystem/rooted-directory.js";
import {
  computeTaskPackageDigest,
  type TaskPackage,
} from "../../tasking/task-package.js";
import type { DemandTargetTaskState } from "../model/demand-aggregate-state.js";
import {
  parseWindowWorkClaimId,
  WindowWorkClaimError,
  type WindowWorkClaimId,
} from "../../delivery/window-work-claim.js";

import {
  applyDemandEventStreamCommit,
  DemandEventStreamCommitError,
  type DemandEventStreamCommit,
  type PreparedDemandEventStreamCommit,
} from "./demand-event-stream-commit.js";
import type { DemandEventSourcingAggregate } from "./demand-event-sourcing-aggregate.js";
import type {
  TargetTaskPlannedUncommittedEvent,
  TestCardCreatedUncommittedEvent,
  TestDeliveryPreparedUncommittedEvent,
  TargetDeliveryPreparedUncommittedEvent,
  TargetHostEffectClaimedUncommittedEvent,
  TargetHostEffectObservedUncommittedEvent,
  TargetHostEffectRearmedUncommittedEvent,
  TargetResultRecordedUncommittedEvent,
  ControllerTargetReviewDecidedUncommittedEvent,
  ControllerTargetReviewResumedUncommittedEvent,
  ProductDefectRemediationAuthorizedUncommittedEvent,
} from "./demand-event-sourcing-event.js";
import type {
  DemandEventCommitSequence,
  DemandEventStreamRevision,
} from "./demand-event-stream-position.js";
import {
  createDemandEventSourcingSnapshot,
  restoreDemandEventSourcingSnapshot,
  DemandEventSourcingSnapshotError,
} from "./demand-event-sourcing-snapshot.js";
import {
  DemandFileEventStore,
  DemandFileEventStoreError,
  type DemandFileEventStoreAppendReceipt,
} from "./demand-file-event-store.js";
import {
  DemandFileEventSnapshotStore,
  DemandFileEventSnapshotStoreError,
  type DemandFileEventSnapshotPublishReceipt,
} from "./demand-file-event-snapshot-store.js";
import {
  computeDemandEventSourcingStoredEventDigest,
  type DemandEventSourcingStoredEvent,
} from "./demand-event-sourcing-stored-event.js";
import {
  upcastDemandEventSourcingStoredEvent,
  DemandEventSourcingUpcasterError,
} from "./demand-event-sourcing-upcaster.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：聚合仓储。
 *
 * 正常加载选择最新可用的不可变快照，只打开它的锚定提交和后续事件流尾部；审计始终
 * 从提交 1 完整重放。仓储不会在加载过程中写入快照、不决定命令、不访问 Ledger 或
 * TODO，也不执行 Demand 根目录发布。
 */

export interface LoadedDemandEventSourcingAggregate {
  readonly aggregate: Readonly<DemandEventSourcingAggregate>;
  readonly snapshotStatus: "used" | "missing" | "invalid";
  readonly snapshotCommitSequence: DemandEventCommitSequence | null;
  readonly replayedCommitCount: number;
}

export interface AuditedDemandEventSourcingAggregate {
  readonly aggregate: Readonly<DemandEventSourcingAggregate>;
  readonly replayedCommitCount: number;
}

/** TargetResult消费者引用的一条已验证事件位置，不复制Commit或结果状态。 */
export interface DemandTargetResultSourceEvent {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly eventDigest: Sha256Digest;
  readonly streamRevision: DemandEventStreamRevision;
}

/** 一个Target Task的不可变TaskPackage事件来源。 */
export interface AuditedTargetTaskPackageSource {
  readonly sourceEvent: Readonly<DemandTargetResultSourceEvent>;
  readonly taskPackage: Readonly<
    TargetTaskPlannedUncommittedEvent["data"]["taskPackage"]
  >;
}

/** 一份TargetResult的不可变记录事件来源。 */
export interface AuditedTargetResultSource {
  readonly sourceEvent: Readonly<DemandTargetResultSourceEvent>;
  readonly result: Readonly<
    TargetResultRecordedUncommittedEvent["data"]["result"]
  >;
}

/** 一份TestCard创建事件的不可变来源。 */
export interface AuditedTestCardSource {
  readonly sourceEvent: Readonly<DemandTargetResultSourceEvent>;
  readonly testCard: Readonly<
    TestCardCreatedUncommittedEvent["data"]["testCard"]
  >;
  readonly generationSource: Readonly<
    TestCardCreatedUncommittedEvent["data"]["generationSource"]
  >;
}

/** 一份Implementation或Test Controller Review Decision的不可变事件来源。 */
export interface AuditedControllerReviewDecisionSource {
  readonly sourceEvent: Readonly<DemandTargetResultSourceEvent>;
  readonly decision: Readonly<
    ControllerTargetReviewDecidedUncommittedEvent["data"]["decision"]
  >;
}

/** 一份Controller Target Review Resume的不可变记录事件来源。 */
export interface AuditedControllerTargetReviewResumeSource {
  readonly sourceEvent: Readonly<DemandTargetResultSourceEvent>;
  readonly resume: Readonly<
    ControllerTargetReviewResumedUncommittedEvent["data"]["resume"]
  >;
}

/** 一份Controller产品缺陷修复授权的不可变记录事件来源。 */
export interface AuditedProductDefectRemediationAuthorizationSource {
  readonly sourceEvent: Readonly<DemandTargetResultSourceEvent>;
  readonly authorization: Readonly<
    ProductDefectRemediationAuthorizedUncommittedEvent["data"]["authorization"]
  >;
}

/** 一次完整Event Stream审计生成的TaskPackage、TargetResult与Review历史来源。 */
export interface AuditedDemandTargetResultHistory {
  readonly aggregate: Readonly<DemandEventSourcingAggregate>;
  readonly taskPackages: readonly Readonly<AuditedTargetTaskPackageSource>[];
  readonly targetResults: readonly Readonly<AuditedTargetResultSource>[];
  readonly testCards: readonly Readonly<AuditedTestCardSource>[];
  readonly targetReviewDecisions: readonly Readonly<AuditedControllerReviewDecisionSource>[];
  readonly targetReviewResumes: readonly Readonly<AuditedControllerTargetReviewResumeSource>[];
  readonly productDefectRemediationAuthorizations: readonly Readonly<AuditedProductDefectRemediationAuthorizationSource>[];
  readonly replayedCommitCount: number;
}

export interface LocatedTargetTaskPlannedEvent {
  readonly storedEvent: Readonly<DemandEventSourcingStoredEvent>;
  readonly event: Readonly<TargetTaskPlannedUncommittedEvent>;
}

export interface LocatedTestCardCreatedEvent {
  readonly storedEvent: Readonly<DemandEventSourcingStoredEvent>;
  readonly event: Readonly<TestCardCreatedUncommittedEvent>;
}

export interface LocatedTargetDeliveryPreparedEvent {
  readonly storedEvent: Readonly<DemandEventSourcingStoredEvent>;
  readonly event: Readonly<TargetDeliveryPreparedUncommittedEvent>;
}

export interface LocatedTestDeliveryPreparedEvent {
  readonly storedEvent: Readonly<DemandEventSourcingStoredEvent>;
  readonly event: Readonly<TestDeliveryPreparedUncommittedEvent>;
}

export interface LocatedTargetHostEffectClaimedEvent {
  readonly storedEvent: Readonly<DemandEventSourcingStoredEvent>;
  readonly event: Readonly<TargetHostEffectClaimedUncommittedEvent>;
}

export interface LocatedTargetHostEffectObservedEvent {
  readonly storedEvent: Readonly<DemandEventSourcingStoredEvent>;
  readonly event: Readonly<TargetHostEffectObservedUncommittedEvent>;
}

export interface LocatedTargetHostEffectRearmedEvent {
  readonly storedEvent: Readonly<DemandEventSourcingStoredEvent>;
  readonly event: Readonly<TargetHostEffectRearmedUncommittedEvent>;
}

export interface LocatedTargetResultRecordedEvent {
  readonly storedEvent: Readonly<DemandEventSourcingStoredEvent>;
  readonly event: Readonly<TargetResultRecordedUncommittedEvent>;
}

function taskPackageMatchesTargetSummary(
  taskPackage: Readonly<TaskPackage>,
  target: Readonly<DemandTargetTaskState>,
): boolean {
  if (
    (taskPackage.workType === "test") !== (target.workType === "test") ||
    taskPackage.targetTaskId !== target.targetTaskId ||
    taskPackage.assignment.windowId !== target.windowId
  ) {
    return false;
  }
  if (taskPackage.workType === "test") {
    return (
      target.workType === "test" &&
      taskPackage.testCard.testCardId === target.testCard.testCardId &&
      taskPackage.testCard.testCardDigest === target.testCard.testCardDigest
    );
  }
  return (
    target.workType !== "test" &&
    taskPackage.assignment.repositoryId === target.repositoryId &&
    taskPackage.commitExpectation === target.commitExpectation &&
    taskPackage.acceptanceAnchors.length ===
      target.acceptanceAnchorIds.length &&
    taskPackage.acceptanceAnchors.every(
      (anchor, index) => anchor.anchorId === target.acceptanceAnchorIds[index],
    )
  );
}

export type DemandEventSourcingRepositoryErrorReason =
  | "input"
  | "not-found"
  | "stream"
  | "snapshot"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Demand Event Sourcing Repository input is invalid.",
  "not-found": "Demand Event Sourcing stream does not exist.",
  stream: "Demand Event Sourcing stream cannot be rehydrated.",
  snapshot: "Demand Event Sourcing snapshot cannot be published.",
  aborted: "Demand Event Sourcing Repository operation was aborted.",
  "operation-failure": "Demand Event Sourcing Repository operation failed.",
} as const satisfies Readonly<
  Record<DemandEventSourcingRepositoryErrorReason, string>
>;

export class DemandEventSourcingRepositoryError extends Error {
  override readonly name = "DemandEventSourcingRepositoryError";
  readonly code = "wakeflow-demand-event-sourcing-repository" as const;
  readonly reason: DemandEventSourcingRepositoryErrorReason;
  readonly path: string;

  constructor(reason: DemandEventSourcingRepositoryErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: DemandEventSourcingRepositoryErrorReason,
  path: string,
): never {
  throw new DemandEventSourcingRepositoryError(reason, path);
}

function parseSignal(value: unknown): AbortSignal | undefined {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
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
    fail("input", "$options");
  }
  return record.signal as AbortSignal | undefined;
}

function replayCommits(
  initial: Readonly<DemandEventSourcingAggregate> | null,
  commits: readonly Readonly<DemandEventStreamCommit>[],
): Readonly<DemandEventSourcingAggregate> {
  let aggregate = initial;
  for (const [index, commit] of commits.entries()) {
    try {
      aggregate = applyDemandEventStreamCommit(aggregate, commit);
    } catch (error: unknown) {
      if (error instanceof DemandEventStreamCommitError) {
        fail("stream", `$commits/${index}`);
      }
      throw error;
    }
  }
  if (aggregate === null) fail("not-found", "$commits");
  return aggregate;
}

function targetResultSourceEvent(
  storedEvent: Readonly<DemandEventSourcingStoredEvent>,
): Readonly<DemandTargetResultSourceEvent> {
  return Object.freeze({
    eventId: storedEvent.eventId,
    eventDigest: computeDemandEventSourcingStoredEventDigest(storedEvent),
    streamRevision: storedEvent.streamRevision,
  });
}

function mapStoreError(error: unknown): never {
  if (error instanceof DemandFileEventStoreError) {
    if (error.reason === "aborted") fail("aborted", "$signal");
    if (
      error.reason === "stream-invalid" ||
      error.reason === "stream-changed" ||
      error.reason === "node-policy" ||
      error.reason === "capacity"
    ) {
      fail("stream", "$commits");
    }
    fail("operation-failure", "$eventStore");
  }
  if (error instanceof DemandFileEventSnapshotStoreError) {
    if (error.reason === "aborted") fail("aborted", "$signal");
    fail("operation-failure", "$snapshotStore");
  }
  throw error;
}

export class DemandEventSourcingRepository {
  readonly #eventStore: DemandFileEventStore;
  readonly #snapshotStore: DemandFileEventSnapshotStore;

  constructor(root: RootedDirectory) {
    if (
      typeof root !== "object" ||
      root === null ||
      types.isProxy(root) ||
      !(root instanceof RootedDirectory)
    ) {
      fail("input", "$root");
    }
    this.#eventStore = new DemandFileEventStore(root);
    this.#snapshotStore = new DemandFileEventSnapshotStore(root);
  }

  /** 正常读取；不存在事件流时返回 `null`，读取过程中绝不创建或修复快照。 */
  async load(options?: {
    readonly signal?: AbortSignal;
  }): Promise<Readonly<LoadedDemandEventSourcingAggregate> | null> {
    const signal = parseSignal(options);
    let observations;
    try {
      observations = await this.#snapshotStore.readSnapshots(
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      mapStoreError(error);
    }
    const valid = observations.snapshots
      .filter((entry) => entry.status === "valid")
      .sort((left, right) => right.commitSequence - left.commitSequence);
    let snapshotAttemptFailed = observations.snapshots.some(
      (entry) => entry.status === "invalid",
    );

    for (const observation of valid) {
      if (observation.status !== "valid") continue;
      try {
        const tail = await this.#eventStore.readCommitsAfter(
          {
            commitSequence: observation.snapshot.commitSequence,
            streamRevision: observation.snapshot.streamRevision,
            lastCommitDigest: observation.snapshot.lastCommitDigest,
          },
          signal === undefined ? undefined : { signal },
        );
        let aggregate = restoreDemandEventSourcingSnapshot(
          observation.snapshot,
          tail.anchorCommit,
        );
        aggregate = replayCommits(aggregate, tail.commits);
        return Object.freeze({
          aggregate,
          snapshotStatus: "used" as const,
          snapshotCommitSequence: observation.snapshot.commitSequence,
          replayedCommitCount: tail.commits.length,
        });
      } catch (error: unknown) {
        if (error instanceof DemandEventSourcingSnapshotError) {
          snapshotAttemptFailed = true;
          continue;
        }
        if (
          error instanceof DemandFileEventStoreError &&
          error.reason === "stream-invalid"
        ) {
          snapshotAttemptFailed = true;
          continue;
        }
        if (error instanceof DemandFileEventStoreError) mapStoreError(error);
        throw error;
      }
    }

    let stream;
    try {
      stream = await this.#eventStore.readCommits(
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      mapStoreError(error);
    }
    if (stream.commits.length === 0) {
      if (observations.snapshots.length !== 0) fail("stream", "$snapshots");
      return null;
    }
    const aggregate = replayCommits(null, stream.commits);
    return Object.freeze({
      aggregate,
      snapshotStatus: snapshotAttemptFailed
        ? ("invalid" as const)
        : ("missing" as const),
      snapshotCommitSequence: null,
      replayedCommitCount: stream.commits.length,
    });
  }

  /** 从提交 1 开始完整验证摘要链、事件转换和每一步结果状态。 */
  async audit(options?: {
    readonly signal?: AbortSignal;
  }): Promise<Readonly<AuditedDemandEventSourcingAggregate>> {
    const signal = parseSignal(options);
    let stream;
    try {
      stream = await this.#eventStore.readCommits(
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      mapStoreError(error);
    }
    if (stream.commits.length === 0) fail("not-found", "$commits");
    return Object.freeze({
      aggregate: replayCommits(null, stream.commits),
      replayedCommitCount: stream.commits.length,
    });
  }

  /**
   * 从提交1开始只扫描一次完整事件流，同时返回TaskPackage与TargetResult历史来源。
   *
   * 该查询不创建持久化读模型，也不解释Result的上层用途。Aggregate仍是current
   * selector；历史数组只提供消费者重建当前投影所需的不可变完整载荷。
   */
  async auditTargetResultHistory(options?: {
    readonly signal?: AbortSignal;
  }): Promise<Readonly<AuditedDemandTargetResultHistory>> {
    const signal = parseSignal(options);
    let stream;
    try {
      stream = await this.#eventStore.readCommits(
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      mapStoreError(error);
    }
    if (stream.commits.length === 0) fail("not-found", "$commits");
    const aggregate = replayCommits(null, stream.commits);
    const taskPackages: Readonly<AuditedTargetTaskPackageSource>[] = [];
    const targetResults: Readonly<AuditedTargetResultSource>[] = [];
    const testCards: Readonly<AuditedTestCardSource>[] = [];
    const targetReviewDecisions: Readonly<AuditedControllerReviewDecisionSource>[] =
      [];
    const targetReviewResumes: Readonly<AuditedControllerTargetReviewResumeSource>[] =
      [];
    const productDefectRemediationAuthorizations: Readonly<AuditedProductDefectRemediationAuthorizationSource>[] =
      [];
    const taskPackageIds = new Set<string>();
    const targetTaskIds = new Set<string>();
    const targetDeliveryIds = new Set<string>();
    const targetResultIds = new Set<string>();
    const testCardIds = new Set<string>();
    const resultActionIds = new Set<string>();
    const targetReviewDecisionIds = new Set<string>();
    const reviewedGenerationKeys = new Set<string>();
    const targetReviewResumeIds = new Set<string>();
    const resumedBlockedDecisionIds = new Set<string>();
    const productDefectRemediationIds = new Set<string>();
    const remediatedTestDecisionIds = new Set<string>();
    const storedEventByRevision = new Map<
      number,
      Readonly<DemandEventSourcingStoredEvent>
    >();

    for (const commit of stream.commits) {
      for (const storedEvent of commit.events) {
        storedEventByRevision.set(storedEvent.streamRevision, storedEvent);
        let event;
        try {
          event = upcastDemandEventSourcingStoredEvent(storedEvent);
        } catch (error: unknown) {
          if (error instanceof DemandEventSourcingUpcasterError) {
            fail("stream", "$events");
          }
          throw error;
        }
        if (event.eventType === "tasking.target-task-planned") {
          const taskPackage = event.data.taskPackage;
          if (
            taskPackageIds.has(taskPackage.taskPackageId) ||
            targetTaskIds.has(taskPackage.targetTaskId)
          ) {
            fail("stream", "$events");
          }
          taskPackageIds.add(taskPackage.taskPackageId);
          targetTaskIds.add(taskPackage.targetTaskId);
          taskPackages.push(
            Object.freeze({
              sourceEvent: targetResultSourceEvent(storedEvent),
              taskPackage,
            }),
          );
          continue;
        }
        if (event.eventType === "delivery.target-delivery-prepared") {
          const targetDeliveryId = event.data.intent.targetDeliveryId;
          if (targetDeliveryIds.has(targetDeliveryId)) {
            fail("stream", "$events");
          }
          targetDeliveryIds.add(targetDeliveryId);
          continue;
        }
        if (event.eventType === "testing.test-card-created") {
          const testCard = event.data.testCard;
          if (testCardIds.has(testCard.testCardId)) {
            fail("stream", "$events");
          }
          testCardIds.add(testCard.testCardId);
          testCards.push(
            Object.freeze({
              sourceEvent: targetResultSourceEvent(storedEvent),
              testCard,
              generationSource: event.data.generationSource,
            }),
          );
          continue;
        }
        if (event.eventType === "result.target-result-recorded") {
          const result = event.data.result;
          if (
            targetResultIds.has(result.targetResultId) ||
            resultActionIds.has(result.hostEffect.actionId)
          ) {
            fail("stream", "$events");
          }
          targetResultIds.add(result.targetResultId);
          resultActionIds.add(result.hostEffect.actionId);
          targetResults.push(
            Object.freeze({
              sourceEvent: targetResultSourceEvent(storedEvent),
              result,
            }),
          );
          continue;
        }
        if (event.eventType === "review.target-result-decided") {
          const decision = event.data.decision;
          const generationKey = [
            decision.reviewed.targetResultId,
            decision.reviewed.snapshotDigest,
          ].join("\u0000");
          if (
            targetReviewDecisionIds.has(decision.targetReviewDecisionId) ||
            reviewedGenerationKeys.has(generationKey)
          ) {
            fail("stream", "$events");
          }
          targetReviewDecisionIds.add(decision.targetReviewDecisionId);
          reviewedGenerationKeys.add(generationKey);
          targetReviewDecisions.push(
            Object.freeze({
              sourceEvent: targetResultSourceEvent(storedEvent),
              decision,
            }),
          );
          continue;
        }
        if (event.eventType === "review.target-result-resumed") {
          const resume = event.data.resume;
          if (
            targetReviewResumeIds.has(resume.targetReviewResumeId) ||
            resumedBlockedDecisionIds.has(
              resume.blockedDecision.targetReviewDecisionId,
            )
          ) {
            fail("stream", "$events");
          }
          targetReviewResumeIds.add(resume.targetReviewResumeId);
          resumedBlockedDecisionIds.add(
            resume.blockedDecision.targetReviewDecisionId,
          );
          targetReviewResumes.push(
            Object.freeze({
              sourceEvent: targetResultSourceEvent(storedEvent),
              resume,
            }),
          );
          continue;
        }
        if (
          event.eventType === "review.product-defect-remediation-authorized"
        ) {
          const authorization = event.data.authorization;
          if (
            productDefectRemediationIds.has(
              authorization.productDefectRemediationId,
            ) ||
            remediatedTestDecisionIds.has(
              authorization.source.testReviewDecision.targetReviewDecisionId,
            )
          ) {
            fail("stream", "$events");
          }
          productDefectRemediationIds.add(
            authorization.productDefectRemediationId,
          );
          remediatedTestDecisionIds.add(
            authorization.source.testReviewDecision.targetReviewDecisionId,
          );
          productDefectRemediationAuthorizations.push(
            Object.freeze({
              sourceEvent: targetResultSourceEvent(storedEvent),
              authorization,
            }),
          );
        }
      }
    }

    const targetById = new Map(
      aggregate.state.targetTasks.map(
        (target) => [target.targetTaskId, target] as const,
      ),
    );
    const taskPackageById = new Map(
      taskPackages.map(
        (source) => [source.taskPackage.taskPackageId, source] as const,
      ),
    );
    const testCardById = new Map(
      testCards.map((source) => [source.testCard.testCardId, source] as const),
    );
    const targetResultById = new Map(
      targetResults.map(
        (source) => [source.result.targetResultId, source] as const,
      ),
    );
    const reviewDecisionById = new Map(
      targetReviewDecisions.map(
        (source) => [source.decision.targetReviewDecisionId, source] as const,
      ),
    );
    if (taskPackages.length !== targetById.size) fail("stream", "$events");
    for (const target of targetById.values()) {
      const taskPackageSource = taskPackageById.get(target.taskPackageId);
      if (
        taskPackageSource === undefined ||
        !taskPackageMatchesTargetSummary(
          taskPackageSource.taskPackage,
          target,
        ) ||
        computeTaskPackageDigest(taskPackageSource.taskPackage) !==
          target.taskPackageDigest ||
        taskPackageSource.sourceEvent.streamRevision > aggregate.streamRevision
      ) {
        fail("stream", "$events");
      }
      if (target.workType === "test") {
        const testCardSource = testCardById.get(target.testCard.testCardId);
        if (
          testCardSource === undefined ||
          testCardSource.testCard.testCardDigest !==
            target.testCard.testCardDigest ||
          testCardSource.testCard.targetTaskId !== target.targetTaskId ||
          testCardSource.testCard.testWindowId !== target.windowId ||
          testCardSource.sourceEvent.streamRevision >=
            taskPackageSource.sourceEvent.streamRevision
        ) {
          fail("stream", "$events");
        }
      }
      if (
        target.phase !== "result-reported" &&
        target.phase !== "test-result-reported" &&
        target.phase !== "accepted" &&
        target.phase !== "product-defect-rework-requested" &&
        target.phase !== "rework-requested" &&
        target.phase !== "redesign-requested" &&
        target.phase !== "review-blocked" &&
        target.phase !== "test-accepted" &&
        target.phase !== "test-another-attempt-requested" &&
        target.phase !== "test-product-defect" &&
        target.phase !== "test-review-blocked"
      ) {
        continue;
      }
      const resultSource = targetResultById.get(
        target.currentDelivery.targetResult.targetResultId,
      );
      if (
        resultSource === undefined ||
        (resultSource.result.workType === "test") !==
          (target.workType === "test") ||
        resultSource.result.targetTaskId !== target.targetTaskId ||
        resultSource.result.taskPackage.taskPackageId !==
          target.taskPackageId ||
        resultSource.result.taskPackage.digest !== target.taskPackageDigest ||
        resultSource.result.resultDigest !==
          target.currentDelivery.targetResult.resultDigest ||
        resultSource.result.report.outcome !==
          target.currentDelivery.targetResult.outcome ||
        resultSource.result.report.reportedAt !==
          target.currentDelivery.targetResult.reportedAt ||
        resultSource.sourceEvent.streamRevision > aggregate.streamRevision
      ) {
        fail("stream", "$events");
      }
      if (
        target.phase === "result-reported" ||
        target.phase === "test-result-reported"
      ) {
        continue;
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
          resultSource.result.targetResultId ||
        decisionSource.decision.reviewed.targetResultDigest !==
          resultSource.result.resultDigest ||
        decisionSource.decision.decisionDigest !==
          target.currentDelivery.reviewDecision.decisionDigest ||
        decisionSource.decision.decision !==
          target.currentDelivery.reviewDecision.decision ||
        decisionSource.decision.controllerWindowId !==
          target.currentDelivery.reviewDecision.controllerWindowId ||
        decisionSource.decision.decidedAt !==
          target.currentDelivery.reviewDecision.decidedAt ||
        decisionSource.sourceEvent.streamRevision > aggregate.streamRevision
      ) {
        fail("stream", "$events");
      }
    }
    for (const source of targetResults) {
      if (!targetById.has(source.result.targetTaskId)) {
        fail("stream", "$events");
      }
    }
    const referencedTestCardIds = new Set(
      aggregate.state.targetTasks.flatMap((target) =>
        target.workType === "test" ? [target.testCard.testCardId] : [],
      ),
    );
    if (aggregate.state.currentTestCard !== undefined) {
      const source = testCardById.get(
        aggregate.state.currentTestCard.testCardId,
      );
      if (
        source === undefined ||
        source.testCard.testCardDigest !==
          aggregate.state.currentTestCard.testCardDigest ||
        source.testCard.targetTaskId !==
          aggregate.state.currentTestCard.targetTaskId ||
        source.testCard.testWindowId !==
          aggregate.state.currentTestCard.testWindowId ||
        source.sourceEvent.streamRevision > aggregate.streamRevision
      ) {
        fail("stream", "$events");
      }
      referencedTestCardIds.add(source.testCard.testCardId);
    }
    if (
      testCards.some(
        (source) => !referencedTestCardIds.has(source.testCard.testCardId),
      )
    ) {
      fail("stream", "$events");
    }
    for (const source of targetReviewDecisions) {
      const target = targetById.get(source.decision.targetTaskId);
      if (
        target === undefined ||
        (source.decision.kind === "WakeflowControllerTestReviewDecision") !==
          (target.workType === "test")
      ) {
        fail("stream", "$events");
      }
    }
    const decisionById = new Map(
      targetReviewDecisions.map(
        (source) => [source.decision.targetReviewDecisionId, source] as const,
      ),
    );
    for (const source of targetReviewResumes) {
      const blocked = decisionById.get(
        source.resume.blockedDecision.targetReviewDecisionId,
      );
      const target = targetById.get(source.resume.targetTaskId);
      if (
        target === undefined ||
        blocked === undefined ||
        (blocked.decision.kind === "WakeflowControllerTestReviewDecision") !==
          (target.workType === "test") ||
        blocked.decision.decision !== "blocked" ||
        blocked.decision.decisionDigest !==
          source.resume.blockedDecision.decisionDigest ||
        blocked.decision.reviewed.targetResultId !==
          source.resume.blockedDecision.targetResultId ||
        blocked.decision.reviewed.targetResultDigest !==
          source.resume.blockedDecision.targetResultDigest ||
        blocked.sourceEvent.streamRevision >= source.sourceEvent.streamRevision
      ) {
        fail("stream", "$events");
      }
    }
    const remediationById = new Map(
      productDefectRemediationAuthorizations.map(
        (source) =>
          [source.authorization.productDefectRemediationId, source] as const,
      ),
    );
    for (const source of productDefectRemediationAuthorizations) {
      const authorization = source.authorization;
      const sourceDecision = reviewDecisionById.get(
        authorization.source.testReviewDecision.targetReviewDecisionId,
      );
      const sourceCard = testCardById.get(
        authorization.source.testCard.testCardId,
      );
      const priorStoredEvent = storedEventByRevision.get(
        authorization.source.streamRevision,
      );
      const decision = sourceDecision?.decision;
      const expectedFailedChecks =
        decision?.kind === "WakeflowControllerTestReviewDecision"
          ? decision.independentChecks.filter(
              (check) => check.outcome === "failed",
            )
          : [];
      if (
        decision === undefined ||
        decision.kind !== "WakeflowControllerTestReviewDecision" ||
        decision.decision !== "escalate-product-defect" ||
        decision.programId !== authorization.programId ||
        decision.demandId !== authorization.demandId ||
        decision.controllerWindowId !== authorization.controllerWindowId ||
        decision.targetTaskId !== authorization.source.testTargetTaskId ||
        decision.decisionDigest !==
          authorization.source.testReviewDecision.decisionDigest ||
        decision.decidedAt !==
          authorization.source.testReviewDecision.decidedAt ||
        decision.reviewed.targetResultId !==
          authorization.source.targetResult.targetResultId ||
        decision.reviewed.targetResultDigest !==
          authorization.source.targetResult.resultDigest ||
        decision.testExecution.testCard.testCardId !==
          authorization.source.testCard.testCardId ||
        decision.testExecution.testCard.testCardDigest !==
          authorization.source.testCard.testCardDigest ||
        decision.testExecution.testAttemptId !==
          authorization.source.testAttemptId ||
        decision.testExecution.testDispatchPacketDigest !==
          authorization.source.testDispatchPacketDigest ||
        sourceDecision?.sourceEvent.streamRevision !==
          authorization.source.streamRevision ||
        source.sourceEvent.streamRevision !==
          authorization.source.streamRevision + 1 ||
        priorStoredEvent?.resultingStateDigest !==
          authorization.source.stateDigest ||
        sourceCard === undefined ||
        sourceCard.testCard.testCardDigest !==
          authorization.source.testCard.testCardDigest ||
        sourceCard.testCard.targetTaskId !==
          authorization.source.testTargetTaskId ||
        sourceCard.sourceEvent.streamRevision >=
          authorization.source.streamRevision ||
        expectedFailedChecks.length !== authorization.failedChecks.length ||
        expectedFailedChecks.some((check, index) => {
          const projected = authorization.failedChecks[index];
          return (
            projected === undefined ||
            projected.checkId !== check.checkId ||
            projected.outcome !== "failed" ||
            projected.method !== check.method ||
            projected.observation !== check.observation
          );
        })
      ) {
        fail("stream", "$events");
      }
      const baselineByTarget = new Map(
        sourceCard.testCard.implementationBaselines.map(
          (baseline) => [baseline.targetTaskId, baseline] as const,
        ),
      );
      for (const affected of authorization.affectedTargets) {
        const baseline = affected.baseline;
        const cardBaseline = baselineByTarget.get(baseline.targetTaskId);
        const taskPackageSource = taskPackageById.get(baseline.taskPackageId);
        const resultSource = targetResultById.get(baseline.targetResultId);
        const reviewSource = reviewDecisionById.get(
          baseline.targetReviewDecisionId,
        );
        if (
          cardBaseline === undefined ||
          cardBaseline.taskPackageId !== baseline.taskPackageId ||
          cardBaseline.taskPackageDigest !== baseline.taskPackageDigest ||
          cardBaseline.repositoryId !== baseline.repositoryId ||
          cardBaseline.windowId !== baseline.windowId ||
          cardBaseline.targetResultId !== baseline.targetResultId ||
          cardBaseline.resultDigest !== baseline.resultDigest ||
          cardBaseline.targetReviewDecisionId !==
            baseline.targetReviewDecisionId ||
          cardBaseline.decisionDigest !== baseline.decisionDigest ||
          taskPackageSource?.taskPackage.targetTaskId !==
            baseline.targetTaskId ||
          taskPackageSource.taskPackage.workType !== "implementation" ||
          computeTaskPackageDigest(taskPackageSource.taskPackage) !==
            baseline.taskPackageDigest ||
          resultSource?.result.targetTaskId !== baseline.targetTaskId ||
          resultSource.result.workType !== "implementation" ||
          resultSource.result.resultDigest !== baseline.resultDigest ||
          reviewSource?.decision.kind !==
            "WakeflowControllerImplementationReviewDecision" ||
          reviewSource.decision.decision !== "accept" ||
          reviewSource.decision.targetTaskId !== baseline.targetTaskId ||
          reviewSource.decision.decisionDigest !== baseline.decisionDigest ||
          reviewSource.sourceEvent.streamRevision >=
            source.sourceEvent.streamRevision
        ) {
          fail("stream", "$events");
        }
      }
    }
    const consumedPreviousCardIds = new Set<string>();
    const consumedRemediationIds = new Set<string>();
    for (let index = 0; index < testCards.length; index += 1) {
      const source = testCards[index]!;
      const card = source.testCard;
      const precedingStateEvent = storedEventByRevision.get(
        card.source.streamRevision,
      );
      if (
        source.sourceEvent.streamRevision !== card.source.streamRevision + 1 ||
        precedingStateEvent?.resultingStateDigest !== card.source.stateDigest
      ) {
        fail("stream", "$events");
      }
      if (source.generationSource.kind === "initial") {
        if (index !== 0) fail("stream", "$events");
        continue;
      }
      const generation = source.generationSource;
      const previousCardSource = testCardById.get(
        generation.previousTestCard.testCardId,
      );
      const decisionSource = reviewDecisionById.get(
        generation.testReviewDecision.targetReviewDecisionId,
      );
      const remediationSource = remediationById.get(
        generation.productDefectRemediation.productDefectRemediationId,
      );
      const previousTestTarget =
        previousCardSource === undefined
          ? undefined
          : targetById.get(previousCardSource.testCard.targetTaskId);
      if (
        previousCardSource === undefined ||
        previousCardSource.sourceEvent.streamRevision >=
          source.sourceEvent.streamRevision ||
        previousCardSource.testCard.testCardDigest !==
          generation.previousTestCard.testCardDigest ||
        previousTestTarget?.workType !== "test" ||
        previousTestTarget.phase !== "test-product-defect" ||
        previousTestTarget.testCard.testCardId !==
          generation.previousTestCard.testCardId ||
        decisionSource?.decision.kind !==
          "WakeflowControllerTestReviewDecision" ||
        decisionSource.decision.decision !== "escalate-product-defect" ||
        decisionSource.decision.decisionDigest !==
          generation.testReviewDecision.decisionDigest ||
        decisionSource.decision.testExecution.testCard.testCardId !==
          generation.previousTestCard.testCardId ||
        remediationSource === undefined ||
        remediationSource.authorization.authorizationDigest !==
          generation.productDefectRemediation.authorizationDigest ||
        remediationSource.authorization.source.testCard.testCardId !==
          generation.previousTestCard.testCardId ||
        remediationSource.authorization.source.testReviewDecision
          .targetReviewDecisionId !==
          generation.testReviewDecision.targetReviewDecisionId ||
        remediationSource.sourceEvent.streamRevision >=
          source.sourceEvent.streamRevision ||
        consumedPreviousCardIds.has(generation.previousTestCard.testCardId) ||
        consumedRemediationIds.has(
          generation.productDefectRemediation.productDefectRemediationId,
        )
      ) {
        fail("stream", "$events");
      }
      consumedPreviousCardIds.add(generation.previousTestCard.testCardId);
      consumedRemediationIds.add(
        generation.productDefectRemediation.productDefectRemediationId,
      );
    }
    const pendingTestRetest = aggregate.state.pendingTestRetest;
    const unconsumedRemediations =
      productDefectRemediationAuthorizations.filter(
        (source) =>
          !consumedRemediationIds.has(
            source.authorization.productDefectRemediationId,
          ),
      );
    if (pendingTestRetest === undefined) {
      if (unconsumedRemediations.length !== 0) fail("stream", "$events");
    } else {
      const source = unconsumedRemediations[0];
      if (
        unconsumedRemediations.length !== 1 ||
        source === undefined ||
        source.authorization.productDefectRemediationId !==
          pendingTestRetest.productDefectRemediation
            .productDefectRemediationId ||
        source.authorization.authorizationDigest !==
          pendingTestRetest.productDefectRemediation.authorizationDigest ||
        source.authorization.source.testCard.testCardId !==
          pendingTestRetest.previousTestCard.testCardId ||
        source.authorization.source.testCard.testCardDigest !==
          pendingTestRetest.previousTestCard.testCardDigest ||
        source.authorization.source.testReviewDecision
          .targetReviewDecisionId !==
          pendingTestRetest.testReviewDecision.targetReviewDecisionId ||
        source.authorization.source.testReviewDecision.decisionDigest !==
          pendingTestRetest.testReviewDecision.decisionDigest
      ) {
        fail("stream", "$events");
      }
    }
    for (const target of aggregate.state.targetTasks) {
      if (target.phase !== "product-defect-rework-requested") continue;
      const source = remediationById.get(
        target.productDefectRemediation.productDefectRemediationId,
      );
      const affected = source?.authorization.affectedTargets.find(
        (entry) => entry.baseline.targetTaskId === target.targetTaskId,
      );
      if (
        source === undefined ||
        affected === undefined ||
        source.authorization.authorizationDigest !==
          target.productDefectRemediation.authorizationDigest ||
        source.authorization.source.testReviewDecision
          .targetReviewDecisionId !==
          target.productDefectRemediation.testReviewDecisionId ||
        source.authorization.source.testReviewDecision.decisionDigest !==
          target.productDefectRemediation.testReviewDecisionDigest ||
        source.authorization.authorizedAt !==
          target.productDefectRemediation.authorizedAt ||
        affected.correctionObjective !==
          target.productDefectRemediation.correctionObjective ||
        affected.failedCheckIds.length !==
          target.productDefectRemediation.failedCheckIds.length ||
        affected.failedCheckIds.some(
          (id, index) =>
            id !== target.productDefectRemediation.failedCheckIds[index],
        )
      ) {
        fail("stream", "$events");
      }
    }
    return Object.freeze({
      aggregate,
      taskPackages: Object.freeze(taskPackages),
      targetResults: Object.freeze(targetResults),
      testCards: Object.freeze(testCards),
      targetReviewDecisions: Object.freeze(targetReviewDecisions),
      targetReviewResumes: Object.freeze(targetReviewResumes),
      productDefectRemediationAuthorizations: Object.freeze(
        productDefectRemediationAuthorizations,
      ),
      replayedCommitCount: stream.commits.length,
    });
  }

  /** 完整审计事件流后，按TestCard身份定位唯一创建事件。 */
  async findTestCardCreatedEvent(
    testCardIdValue: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<LocatedTestCardCreatedEvent> | null> {
    const signal = parseSignal(options);
    let testCardId: WakeflowDurableId<"test-card">;
    try {
      testCardId = parseWakeflowDurableIdOfKind(
        testCardIdValue,
        "test-card",
        "$testCardId",
      );
    } catch (error: unknown) {
      if (error instanceof WakeflowDurableIdError) {
        fail("input", "$testCardId");
      }
      throw error;
    }
    let stream;
    try {
      stream = await this.#eventStore.readCommits(
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      mapStoreError(error);
    }
    if (stream.commits.length === 0) return null;
    const aggregate = replayCommits(null, stream.commits);
    let located: Readonly<LocatedTestCardCreatedEvent> | undefined;
    for (const commit of stream.commits) {
      for (const storedEvent of commit.events) {
        let event;
        try {
          event = upcastDemandEventSourcingStoredEvent(storedEvent);
        } catch (error: unknown) {
          if (error instanceof DemandEventSourcingUpcasterError) {
            fail("stream", "$events");
          }
          throw error;
        }
        if (
          event.eventType !== "testing.test-card-created" ||
          event.data.testCard.testCardId !== testCardId
        ) {
          continue;
        }
        if (located !== undefined) fail("stream", "$events");
        located = Object.freeze({ storedEvent, event });
      }
    }
    if (located === undefined) return null;
    const testCard = located.event.data.testCard;
    const currentSummary = aggregate.state.currentTestCard;
    const targetSummary = aggregate.state.targetTasks.find(
      (target) =>
        target.workType === "test" &&
        target.testCard.testCardId === testCard.testCardId,
    );
    const retainedByCurrent =
      currentSummary !== undefined &&
      currentSummary.testCardId === testCard.testCardId &&
      currentSummary.testCardDigest === testCard.testCardDigest &&
      currentSummary.targetTaskId === testCard.targetTaskId &&
      currentSummary.testWindowId === testCard.testWindowId;
    const retainedByTarget =
      targetSummary?.workType === "test" &&
      targetSummary.testCard.testCardDigest === testCard.testCardDigest &&
      targetSummary.targetTaskId === testCard.targetTaskId &&
      targetSummary.windowId === testCard.testWindowId;
    if (
      (!retainedByCurrent && !retainedByTarget) ||
      located.storedEvent.streamRevision > aggregate.streamRevision
    ) {
      fail("stream", "$events");
    }
    return located;
  }

  /**
   * 完整审计事件流后，按不可变 TaskPackage 身份定位唯一规划事件。
   *
   * 本查询只为可重建投影提供权威来源；它不读取投影文件，也不把 Aggregate 摘要
   * 反向扩展成 TaskPackage 内容。
   */
  async findTargetTaskPlannedEvent(
    taskPackageIdValue: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<LocatedTargetTaskPlannedEvent> | null> {
    const signal = parseSignal(options);
    let taskPackageId: WakeflowDurableId<"task-package">;
    try {
      taskPackageId = parseWakeflowDurableIdOfKind(
        taskPackageIdValue,
        "task-package",
        "$taskPackageId",
      );
    } catch (error: unknown) {
      if (error instanceof WakeflowDurableIdError) {
        fail("input", "$taskPackageId");
      }
      throw error;
    }
    let stream;
    try {
      stream = await this.#eventStore.readCommits(
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      mapStoreError(error);
    }
    if (stream.commits.length === 0) return null;
    const aggregate = replayCommits(null, stream.commits);
    let located: Readonly<LocatedTargetTaskPlannedEvent> | undefined;
    for (const commit of stream.commits) {
      for (const storedEvent of commit.events) {
        let event;
        try {
          event = upcastDemandEventSourcingStoredEvent(storedEvent);
        } catch (error: unknown) {
          if (error instanceof DemandEventSourcingUpcasterError) {
            fail("stream", "$events");
          }
          throw error;
        }
        if (
          event.eventType !== "tasking.target-task-planned" ||
          event.data.taskPackage.taskPackageId !== taskPackageId
        ) {
          continue;
        }
        if (located !== undefined) fail("stream", "$events");
        located = Object.freeze({ storedEvent, event });
      }
    }
    if (located === undefined) return null;
    const taskPackage = located.event.data.taskPackage;
    const summary = aggregate.state.targetTasks.find(
      (entry) => entry.taskPackageId === taskPackageId,
    );
    if (
      summary === undefined ||
      !taskPackageMatchesTargetSummary(taskPackage, summary) ||
      summary.taskPackageDigest !== computeTaskPackageDigest(taskPackage) ||
      located.storedEvent.streamRevision > aggregate.streamRevision
    ) {
      fail("stream", "$events");
    }
    return located;
  }

  /** 完整审计事件流后，按Test Delivery身份定位唯一prepared事件。 */
  async findTestDeliveryPreparedEvent(
    targetDeliveryIdValue: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<LocatedTestDeliveryPreparedEvent> | null> {
    const signal = parseSignal(options);
    let targetDeliveryId: WakeflowDurableId<"target-delivery">;
    try {
      targetDeliveryId = parseWakeflowDurableIdOfKind(
        targetDeliveryIdValue,
        "target-delivery",
        "$targetDeliveryId",
      );
    } catch (error: unknown) {
      if (error instanceof WakeflowDurableIdError) {
        fail("input", "$targetDeliveryId");
      }
      throw error;
    }
    let stream;
    try {
      stream = await this.#eventStore.readCommits(
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      mapStoreError(error);
    }
    if (stream.commits.length === 0) return null;
    const aggregate = replayCommits(null, stream.commits);
    let located: Readonly<LocatedTestDeliveryPreparedEvent> | undefined;
    for (const commit of stream.commits) {
      for (const storedEvent of commit.events) {
        let event;
        try {
          event = upcastDemandEventSourcingStoredEvent(storedEvent);
        } catch (error: unknown) {
          if (error instanceof DemandEventSourcingUpcasterError) {
            fail("stream", "$events");
          }
          throw error;
        }
        if (
          event.eventType !== "testing.test-delivery-prepared" ||
          event.data.intent.targetDeliveryId !== targetDeliveryId
        ) {
          continue;
        }
        if (located !== undefined) fail("stream", "$events");
        located = Object.freeze({ storedEvent, event });
      }
    }
    if (located === undefined) return null;
    const intent = located.event.data.intent;
    const target = aggregate.state.targetTasks.find(
      (entry) => entry.targetTaskId === intent.target.targetTaskId,
    );
    const authorization =
      target?.workType === "test" && target.phase !== "planned"
        ? target.testAttempts
            .flatMap((attempt) => attempt.deliveryAuthorizations)
            .find((entry) => entry.targetDeliveryId === intent.targetDeliveryId)
        : undefined;
    if (
      aggregate.demandId !== intent.demandId ||
      target === undefined ||
      target.workType !== "test" ||
      target.taskPackageId !== intent.target.taskPackageId ||
      target.taskPackageDigest !== intent.target.taskPackageDigest ||
      target.windowId !== intent.route.windowId ||
      target.testCard.testCardId !== intent.target.testCard.testCardId ||
      target.testCard.testCardDigest !==
        intent.target.testCard.testCardDigest ||
      authorization === undefined ||
      authorization.intentDigest !== intent.intentDigest ||
      authorization.preparedAt !== intent.preparedAt ||
      located.storedEvent.streamRevision > aggregate.streamRevision
    ) {
      fail("stream", "$events");
    }
    return located;
  }

  /** 完整审计事件流后，按Target Delivery身份定位唯一prepared事件。 */
  async findTargetDeliveryPreparedEvent(
    targetDeliveryIdValue: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<LocatedTargetDeliveryPreparedEvent> | null> {
    const signal = parseSignal(options);
    let targetDeliveryId: WakeflowDurableId<"target-delivery">;
    try {
      targetDeliveryId = parseWakeflowDurableIdOfKind(
        targetDeliveryIdValue,
        "target-delivery",
        "$targetDeliveryId",
      );
    } catch (error: unknown) {
      if (error instanceof WakeflowDurableIdError) {
        fail("input", "$targetDeliveryId");
      }
      throw error;
    }
    let stream;
    try {
      stream = await this.#eventStore.readCommits(
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      mapStoreError(error);
    }
    if (stream.commits.length === 0) return null;
    const aggregate = replayCommits(null, stream.commits);
    let located: Readonly<LocatedTargetDeliveryPreparedEvent> | undefined;
    for (const commit of stream.commits) {
      for (const storedEvent of commit.events) {
        let event;
        try {
          event = upcastDemandEventSourcingStoredEvent(storedEvent);
        } catch (error: unknown) {
          if (error instanceof DemandEventSourcingUpcasterError) {
            fail("stream", "$events");
          }
          throw error;
        }
        if (
          event.eventType !== "delivery.target-delivery-prepared" ||
          event.data.intent.targetDeliveryId !== targetDeliveryId
        ) {
          continue;
        }
        if (located !== undefined) fail("stream", "$events");
        located = Object.freeze({ storedEvent, event });
      }
    }
    if (located === undefined) return null;
    const intent = located.event.data.intent;
    const target = aggregate.state.targetTasks.find(
      (entry) => entry.targetTaskId === intent.target.targetTaskId,
    );
    if (
      aggregate.demandId !== intent.demandId ||
      target === undefined ||
      target.taskPackageId !== intent.target.taskPackageId ||
      target.taskPackageDigest !== intent.target.taskPackageDigest ||
      target.windowId !== intent.route.windowId ||
      located.storedEvent.streamRevision > aggregate.streamRevision
    ) {
      fail("stream", "$events");
    }
    return located;
  }

  /** 完整审计事件流后，按WindowWorkClaim身份定位唯一Claim Event。 */
  async findTargetHostEffectClaimedEvent(
    claimIdValue: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<LocatedTargetHostEffectClaimedEvent> | null> {
    const signal = parseSignal(options);
    let claimId: WindowWorkClaimId;
    try {
      claimId = parseWindowWorkClaimId(claimIdValue, "$claimId");
    } catch (error: unknown) {
      if (error instanceof WindowWorkClaimError) fail("input", "$claimId");
      throw error;
    }
    let stream;
    try {
      stream = await this.#eventStore.readCommits(
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      mapStoreError(error);
    }
    if (stream.commits.length === 0) return null;
    const aggregate = replayCommits(null, stream.commits);
    let located: Readonly<LocatedTargetHostEffectClaimedEvent> | undefined;
    for (const commit of stream.commits) {
      for (const storedEvent of commit.events) {
        let event;
        try {
          event = upcastDemandEventSourcingStoredEvent(storedEvent);
        } catch (error: unknown) {
          if (error instanceof DemandEventSourcingUpcasterError) {
            fail("stream", "$events");
          }
          throw error;
        }
        if (
          event.eventType !== "delivery.target-host-effect-claimed" ||
          event.data.claim.claimId !== claimId
        ) {
          continue;
        }
        if (located !== undefined) fail("stream", "$events");
        located = Object.freeze({ storedEvent, event });
      }
    }
    if (located === undefined) return null;
    const claim = located.event.data.claim;
    if (
      aggregate.demandId !== claim.target.demandId ||
      located.storedEvent.eventId !== claim.claimTransition.eventId ||
      located.storedEvent.streamRevision !==
        claim.claimTransition.expectedStreamRevision + 1 ||
      located.storedEvent.streamRevision > aggregate.streamRevision
    ) {
      fail("stream", "$events");
    }
    return located;
  }

  /** 完整审计事件流后，按Action/Claim身份定位唯一Host Effect Observation。 */
  async findTargetHostEffectObservedEvent(
    actionIdValue: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<LocatedTargetHostEffectObservedEvent> | null> {
    const signal = parseSignal(options);
    let actionId: WindowWorkClaimId;
    try {
      actionId = parseWindowWorkClaimId(actionIdValue, "$actionId");
    } catch (error: unknown) {
      if (error instanceof WindowWorkClaimError) fail("input", "$actionId");
      throw error;
    }
    let stream;
    try {
      stream = await this.#eventStore.readCommits(
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      mapStoreError(error);
    }
    if (stream.commits.length === 0) return null;
    const aggregate = replayCommits(null, stream.commits);
    let located: Readonly<LocatedTargetHostEffectObservedEvent> | undefined;
    for (const commit of stream.commits) {
      for (const storedEvent of commit.events) {
        let event;
        try {
          event = upcastDemandEventSourcingStoredEvent(storedEvent);
        } catch (error: unknown) {
          if (error instanceof DemandEventSourcingUpcasterError) {
            fail("stream", "$events");
          }
          throw error;
        }
        if (
          event.eventType !== "delivery.target-host-effect-observed" ||
          event.data.observation.action.actionId !== actionId
        ) {
          continue;
        }
        if (located !== undefined) fail("stream", "$events");
        located = Object.freeze({ storedEvent, event });
      }
    }
    if (located === undefined) return null;
    const observation = located.event.data.observation;
    if (
      aggregate.demandId !== located.event.demandId ||
      located.storedEvent.streamRevision <=
        observation.action.claimEventStreamRevision ||
      located.storedEvent.streamRevision > aggregate.streamRevision
    ) {
      fail("stream", "$events");
    }
    return located;
  }

  /** 完整审计事件流后，按旧Action/Claim身份定位唯一Rearm Event。 */
  async findTargetHostEffectRearmedEvent(
    actionIdValue: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<LocatedTargetHostEffectRearmedEvent> | null> {
    const signal = parseSignal(options);
    let actionId: WindowWorkClaimId;
    try {
      actionId = parseWindowWorkClaimId(actionIdValue, "$actionId");
    } catch (error: unknown) {
      if (error instanceof WindowWorkClaimError) fail("input", "$actionId");
      throw error;
    }
    let stream;
    try {
      stream = await this.#eventStore.readCommits(
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      mapStoreError(error);
    }
    if (stream.commits.length === 0) return null;
    const aggregate = replayCommits(null, stream.commits);
    let located: Readonly<LocatedTargetHostEffectRearmedEvent> | undefined;
    for (const commit of stream.commits) {
      for (const storedEvent of commit.events) {
        let event;
        try {
          event = upcastDemandEventSourcingStoredEvent(storedEvent);
        } catch (error: unknown) {
          if (error instanceof DemandEventSourcingUpcasterError) {
            fail("stream", "$events");
          }
          throw error;
        }
        if (
          event.eventType !== "delivery.target-host-effect-rearmed" ||
          event.data.rearm.rejectedAttempt.claimId !== actionId
        ) {
          continue;
        }
        if (located !== undefined) fail("stream", "$events");
        located = Object.freeze({ storedEvent, event });
      }
    }
    if (located === undefined) return null;
    if (located.storedEvent.streamRevision > aggregate.streamRevision) {
      fail("stream", "$events");
    }
    return located;
  }

  /** 完整审计事件流后，按Action/Claim身份定位唯一TargetResult Event。 */
  async findTargetResultRecordedEvent(
    actionIdValue: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<LocatedTargetResultRecordedEvent> | null> {
    const signal = parseSignal(options);
    let actionId: WindowWorkClaimId;
    try {
      actionId = parseWindowWorkClaimId(actionIdValue, "$actionId");
    } catch (error: unknown) {
      if (error instanceof WindowWorkClaimError) fail("input", "$actionId");
      throw error;
    }
    let stream;
    try {
      stream = await this.#eventStore.readCommits(
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      mapStoreError(error);
    }
    if (stream.commits.length === 0) return null;
    const aggregate = replayCommits(null, stream.commits);
    let located: Readonly<LocatedTargetResultRecordedEvent> | undefined;
    for (const commit of stream.commits) {
      for (const storedEvent of commit.events) {
        let event;
        try {
          event = upcastDemandEventSourcingStoredEvent(storedEvent);
        } catch (error: unknown) {
          if (error instanceof DemandEventSourcingUpcasterError) {
            fail("stream", "$events");
          }
          throw error;
        }
        if (
          event.eventType !== "result.target-result-recorded" ||
          event.data.result.hostEffect.actionId !== actionId
        ) {
          continue;
        }
        if (located !== undefined) fail("stream", "$events");
        located = Object.freeze({ storedEvent, event });
      }
    }
    if (located === undefined) return null;
    if (located.storedEvent.streamRevision > aggregate.streamRevision) {
      fail("stream", "$events");
    }
    return located;
  }

  /** 仅为命令重试解析 `commitId`；普通加载不会因此扫描历史。 */
  async findCommitById(
    commitIdValue: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<DemandEventStreamCommit> | null> {
    const signal = parseSignal(options);
    let commitId: WakeflowDurableId<"demand-event-commit">;
    try {
      commitId = parseWakeflowDurableIdOfKind(
        commitIdValue,
        "demand-event-commit",
        "$commitId",
      );
    } catch (error: unknown) {
      if (error instanceof WakeflowDurableIdError) fail("input", "$commitId");
      throw error;
    }
    let stream;
    try {
      stream = await this.#eventStore.readCommits(
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      mapStoreError(error);
    }
    return (
      stream.commits.find((commit) => commit.commitId === commitId) ?? null
    );
  }

  /** 持久追加一条已经由决策器和状态演进逻辑完整准备的不可变提交记录。 */
  async appendPreparedCommit(
    prepared: Readonly<PreparedDemandEventStreamCommit>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<DemandFileEventStoreAppendReceipt>> {
    const signal = parseSignal(options);
    return this.#eventStore.append(
      prepared,
      signal === undefined ? undefined : { signal },
    );
  }

  /** 显式发布当前聚合的不可变检查点；该操作不属于加载副作用。 */
  async publishSnapshot(
    aggregateValue: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<DemandFileEventSnapshotPublishReceipt>> {
    const signal = parseSignal(options);
    let snapshot;
    try {
      snapshot = createDemandEventSourcingSnapshot(aggregateValue);
    } catch (error: unknown) {
      if (error instanceof DemandEventSourcingSnapshotError) {
        fail("input", "$aggregate");
      }
      throw error;
    }
    try {
      return await this.#snapshotStore.publish(
        snapshot,
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      if (error instanceof DemandFileEventSnapshotStoreError) {
        if (error.reason === "aborted") fail("aborted", "$signal");
        fail("snapshot", "$snapshot");
      }
      throw error;
    }
  }
}
