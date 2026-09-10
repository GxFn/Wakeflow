import { types } from "node:util";

import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  closeDemandOperationAuthorityContext,
  openDemandOperationAuthorityContext,
  DemandOperationAuthorityContextError,
} from "../demand/demand-operation-authority-context.js";
import type { LoadedDemandEventSourcingRootAuthority } from "../demand/event-sourcing/demand-event-sourcing-root-authority.js";
import type {
  DemandPendingTestRetest,
  DemandTargetTaskState,
} from "../demand/model/demand-aggregate-state.js";
import {
  TEST_ENVIRONMENT_AUTHORITY_ROLE,
  type DemandTestingDecision,
} from "../demand/model/demand-authority.js";
import type { DemandType } from "../demand/model/demand-identity.js";
import type { LedgerAuthorityMemberReference } from "../ledger/ledger-authority-store.js";
import {
  readDemandResultReviewSnapshot,
  DemandResultReviewSnapshotError,
  type DemandResultReviewSnapshot,
  type DemandResultReviewTarget,
} from "./demand-result-review-snapshot.js";

/**
 * Wakeflow Governance / Review：Controller完成Implementation或Test审查后的下一阶段路由读模型。
 *
 * 本模块只根据冻结Demand Authority和完整Review Snapshot选择下一位业务owner。它不创建
 * test 任务包、不提交completion Event、不解释或返回测试环境正文，也不把`accepted`解释为Demand已经完成。
 * `completion-preflight`明确携带controller-only或real-environment Test closure；它只表示
 * Completion owner可以开始当前准入，不表示Demand已经完成。所有planning状态都只是后续
 * owner的准入入口。
 */

const ROUTE_KIND = "WakeflowDemandPostAcceptanceRoute" as const;
const ROUTE_SCHEMA_VERSION = 1 as const;

export interface DemandPostAcceptanceAcceptedTarget {
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly taskPackageId: WakeflowDurableId<"task-package">;
  readonly taskPackageDigest: Sha256Digest;
  readonly repositoryId: WakeflowDurableId<"repository">;
  readonly windowId: WakeflowDurableId<"window">;
  readonly targetResultId: WakeflowDurableId<"target-result">;
  readonly resultDigest: Sha256Digest;
  readonly targetReviewDecisionId: WakeflowDurableId<"target-review-decision">;
  readonly decisionDigest: Sha256Digest;
}

export interface DemandPostAcceptanceBlockingTarget {
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly taskPackageId: WakeflowDurableId<"task-package">;
  readonly taskPackageDigest: Sha256Digest;
  readonly phase: DemandTargetTaskState["phase"];
}

export interface DemandPostAcceptanceReviewedTest {
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly taskPackageId: WakeflowDurableId<"task-package">;
  readonly taskPackageDigest: Sha256Digest;
  readonly testAttemptId: WakeflowDurableId<"test-attempt">;
  readonly testWindowId: WakeflowDurableId<"window">;
  readonly targetResultId: WakeflowDurableId<"target-result">;
  readonly resultDigest: Sha256Digest;
  readonly targetReviewDecisionId: WakeflowDurableId<"target-review-decision">;
  readonly decisionDigest: Sha256Digest;
}

export type DemandPostAcceptanceTestingClosure =
  | Readonly<{
      readonly mode: "controller-only";
    }>
  | Readonly<{
      readonly mode: "real-environment";
      readonly testReview: Readonly<DemandPostAcceptanceReviewedTest>;
    }>;

export type DemandPostAcceptanceNextStage =
  | Readonly<{
      readonly status: "not-ready";
      readonly reason:
        | "demand-cancelled"
        | "demand-completed"
        | "no-target-tasks"
        | "targets-not-accepted"
        | "testing-not-applicable";
      readonly blockingTargets: readonly Readonly<DemandPostAcceptanceBlockingTarget>[];
    }>
  | Readonly<{
      readonly status: "completion-preflight";
      readonly testingClosure: Readonly<DemandPostAcceptanceTestingClosure>;
    }>
  | Readonly<{
      /** 首个或复测 test 任务包的规划入口；`retest` 非空时新任务包必须以 retest 谱系消费它。 */
      readonly status: "test-task-planning";
      readonly testEnvironmentAuthority: Readonly<LedgerAuthorityMemberReference>;
      readonly retest: Readonly<DemandPendingTestRetest> | null;
    }>
  | Readonly<{
      readonly status: "test-delivery-planning";
      readonly testTask: Readonly<{
        readonly targetTaskId: WakeflowDurableId<"target-task">;
        readonly taskPackageId: WakeflowDurableId<"task-package">;
        readonly taskPackageDigest: Sha256Digest;
        readonly testWindowId: WakeflowDurableId<"window">;
      }>;
    }>
  | Readonly<{
      readonly status: "test-host-effect-execution";
      readonly testDelivery: Readonly<DemandPostAcceptanceTestDelivery>;
    }>
  | Readonly<{
      readonly status: "test-result-planning";
      readonly testDelivery: Readonly<
        DemandPostAcceptanceTestDelivery & {
          readonly outcomeDigest: Sha256Digest;
          readonly disposition: "accepted" | "indeterminate";
          readonly readbackStatus: "confirmed" | "pending" | "unavailable";
        }
      >;
    }>
  | Readonly<{
      readonly status: "test-result-review-planning";
      readonly testResult: Readonly<{
        readonly targetTaskId: WakeflowDurableId<"target-task">;
        readonly taskPackageId: WakeflowDurableId<"task-package">;
        readonly taskPackageDigest: Sha256Digest;
        readonly deliveryId: WakeflowDurableId<"target-delivery">;
        readonly testAttemptId: WakeflowDurableId<"test-attempt">;
        readonly targetResultId: WakeflowDurableId<"target-result">;
        readonly resultDigest: Sha256Digest;
        readonly outcome: "completed" | "blocked" | "needs-review";
      }>;
    }>
  | Readonly<{
      readonly status: "test-another-attempt-planning";
      readonly testReview: Readonly<DemandPostAcceptanceReviewedTest>;
    }>
  | Readonly<{
      readonly status: "test-product-defect-escalated";
      readonly testReview: Readonly<DemandPostAcceptanceReviewedTest>;
    }>
  | Readonly<{
      readonly status: "test-review-blocked";
      readonly testReview: Readonly<DemandPostAcceptanceReviewedTest>;
    }>
  | Readonly<{
      readonly status: "test-delivery-rearm-planning";
      readonly rejectedDelivery: Readonly<
        DemandPostAcceptanceTestDelivery & {
          readonly outcomeDigest: Sha256Digest;
        }
      >;
    }>;

/** 当前 test 投递的最小摘要：信封身份、代际与围栏；prompt 与处置全文留在事件里。 */
export interface DemandPostAcceptanceTestDelivery {
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly taskPackageId: WakeflowDurableId<"task-package">;
  readonly taskPackageDigest: Sha256Digest;
  readonly deliveryId: WakeflowDurableId<"target-delivery">;
  readonly envelopeDigest: Sha256Digest;
  readonly generation: number;
  readonly fence: Readonly<{
    readonly claimId: WakeflowDurableId<"work-claim">;
    readonly claimDigest: Sha256Digest;
  }>;
  readonly testAttemptId: WakeflowDurableId<"test-attempt">;
  readonly testWindowId: WakeflowDurableId<"window">;
}

type TestTargetState = Extract<
  DemandTargetTaskState,
  { readonly workType: "test" }
>;
type ReviewedTestTargetState = Extract<
  TestTargetState,
  {
    readonly phase:
      | "test-accepted"
      | "test-another-attempt-requested"
      | "test-product-defect"
      | "test-review-blocked";
  }
>;
type DeliveryBearingTestTargetState = Exclude<
  TestTargetState,
  { readonly phase: "planned" }
>;

export interface DemandPostAcceptanceRoute {
  readonly kind: typeof ROUTE_KIND;
  readonly schemaVersion: typeof ROUTE_SCHEMA_VERSION;
  readonly programId: WakeflowDurableId<"program">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly demandType: DemandType;
  readonly authorityDigest: Sha256Digest;
  readonly testingDecision: Readonly<DemandTestingDecision>;
  readonly reviewSnapshotDigest: Sha256Digest;
  readonly observedEventStream: Readonly<{
    readonly streamRevision: number;
    readonly stateDigest: Sha256Digest;
    readonly lastEventId: WakeflowDurableId<"demand-event">;
    readonly lastEventDigest: Sha256Digest;
  }>;
  readonly acceptedTargets: readonly Readonly<DemandPostAcceptanceAcceptedTarget>[];
  readonly nextStage: Readonly<DemandPostAcceptanceNextStage>;
  readonly routeDigest: Sha256Digest;
}

export type DemandPostAcceptanceRouteErrorReason =
  | "input"
  | "root"
  | "config"
  | "demand-authority"
  | "review"
  | "relation"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Demand post-acceptance route input is invalid.",
  root: "Demand post-acceptance route root could not be held safely.",
  config: "Demand post-acceptance route Config authority is invalid.",
  "demand-authority":
    "Demand post-acceptance route Demand authority is invalid.",
  review: "Demand post-acceptance route Review Snapshot is invalid.",
  relation: "Demand post-acceptance route sources are inconsistent.",
  aborted: "Demand post-acceptance route read was aborted.",
  "operation-failure": "Demand post-acceptance route read failed.",
} as const satisfies Readonly<
  Record<DemandPostAcceptanceRouteErrorReason, string>
>;

/** Accepted后路由无法由当前Authority与Review事实安全重建时的稳定错误。 */
export class DemandPostAcceptanceRouteError extends Error {
  override readonly name = "DemandPostAcceptanceRouteError";
  readonly code = "wakeflow-demand-post-acceptance-route" as const;
  readonly reason: DemandPostAcceptanceRouteErrorReason;

  constructor(reason: DemandPostAcceptanceRouteErrorReason) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

function fail(reason: DemandPostAcceptanceRouteErrorReason): never {
  throw new DemandPostAcceptanceRouteError(reason);
}

function targetPhase(
  target: Readonly<DemandResultReviewTarget>,
): DemandTargetTaskState["phase"] {
  return target.status === "reported"
    ? target.taskPackage.workType === "test"
      ? "test-result-reported"
      : "result-reported"
    : target.phase;
}

function targetWorkType(
  target: Readonly<DemandResultReviewTarget>,
): "implementation" | "test" {
  return target.status === "awaiting-result"
    ? target.workType
    : target.taskPackage.workType;
}

function acceptedTarget(
  target: Readonly<DemandResultReviewTarget>,
): Readonly<DemandPostAcceptanceAcceptedTarget> | null {
  if (
    target.status !== "review-decided" ||
    target.phase !== "accepted" ||
    target.reviewDecision.decision !== "accept" ||
    target.taskPackage.workType !== "implementation" ||
    target.targetResult.workType !== "implementation"
  ) {
    return null;
  }
  return Object.freeze({
    targetTaskId: target.targetTaskId,
    taskPackageId: target.taskPackage.taskPackageId,
    taskPackageDigest: target.targetResult.taskPackage.digest,
    repositoryId: target.targetResult.assignment.repositoryId,
    windowId: target.targetResult.assignment.windowId,
    targetResultId: target.targetResult.targetResultId,
    resultDigest: target.targetResult.resultDigest,
    targetReviewDecisionId: target.reviewDecision.targetReviewDecisionId,
    decisionDigest: target.reviewDecision.decisionDigest,
  });
}

function blockingTarget(
  target: Readonly<DemandResultReviewTarget>,
): Readonly<DemandPostAcceptanceBlockingTarget> {
  return Object.freeze({
    targetTaskId: target.targetTaskId,
    taskPackageId: target.taskPackage.taskPackageId,
    taskPackageDigest:
      target.status === "awaiting-result"
        ? target.taskPackage.digest
        : target.targetResult.taskPackage.digest,
    phase: targetPhase(target),
  });
}

/** 真实环境测试的环境权威是需求包里唯一的环境角色成员，且其摘要与Ledger记录一致。 */
export function resolveDemandTestEnvironmentAuthority(
  loaded: Readonly<LoadedDemandEventSourcingRootAuthority>,
): Readonly<LedgerAuthorityMemberReference> {
  const candidates = loaded.admittedAuthority.resolvedAuthority.filter(
    (entry) => entry.reference.role === TEST_ENVIRONMENT_AUTHORITY_ROLE,
  );
  const source = candidates[0];
  if (
    loaded.authority.testingDecision.environmentMemberRef !== null ||
    candidates.length !== 1 ||
    source === undefined ||
    source.reference.memberDigest !==
      source.record.documents.find(
        (document) => document.memberRef === source.reference.memberRef,
      )?.digest
  ) {
    fail("relation");
  }
  return source.reference;
}

function nextStage(
  loaded: Readonly<LoadedDemandEventSourcingRootAuthority>,
  snapshot: Readonly<DemandResultReviewSnapshot>,
  blockingTargets: readonly Readonly<DemandPostAcceptanceBlockingTarget>[],
): Readonly<DemandPostAcceptanceNextStage> {
  if (snapshot.demand.lifecycle === "cancelled") {
    return Object.freeze({
      status: "not-ready" as const,
      reason: "demand-cancelled" as const,
      blockingTargets,
    });
  }
  if (snapshot.demand.lifecycle === "completed") {
    return Object.freeze({
      status: "not-ready" as const,
      reason: "demand-completed" as const,
      blockingTargets,
    });
  }
  if (loaded.authority.testingDecision.mode === "not-applicable") {
    return Object.freeze({
      status: "not-ready" as const,
      reason: "testing-not-applicable" as const,
      blockingTargets,
    });
  }
  if (
    snapshot.targets.every(
      (target) => targetWorkType(target) !== "implementation",
    )
  ) {
    return Object.freeze({
      status: "not-ready" as const,
      reason: "no-target-tasks" as const,
      blockingTargets,
    });
  }
  if (blockingTargets.length > 0) {
    return Object.freeze({
      status: "not-ready" as const,
      reason: "targets-not-accepted" as const,
      blockingTargets,
    });
  }
  const state = loaded.aggregate.state;
  const testTargets = state.targetTasks.filter(
    (target): target is TestTargetState => target.workType === "test",
  );
  if (loaded.authority.testingDecision.mode === "controller-only") {
    if (testTargets.length > 0 || state.pendingTestRetest !== undefined) {
      fail("relation");
    }
    return Object.freeze({
      status: "completion-preflight" as const,
      testingClosure: Object.freeze({ mode: "controller-only" as const }),
    });
  }
  // 同一时间只有一个未终结的 test 目标；历史代际只能停在 test-product-defect。
  const openTestTargets = testTargets.filter(
    (target) => target.phase !== "test-product-defect",
  );
  if (openTestTargets.length > 1) fail("relation");
  const testTarget = openTestTargets[0];
  if (testTarget === undefined) {
    return closedTestStage(loaded, snapshot, testTargets);
  }
  return openTestStage(testTarget);
}

/** 没有未终结 test 目标：待消费复测或首个合同交给 test 任务规划；否则最新缺陷代际等待升级授权。 */
function closedTestStage(
  loaded: Readonly<LoadedDemandEventSourcingRootAuthority>,
  snapshot: Readonly<DemandResultReviewSnapshot>,
  testTargets: readonly Readonly<TestTargetState>[],
): Readonly<DemandPostAcceptanceNextStage> {
  const pendingTestRetest = loaded.aggregate.state.pendingTestRetest;
  if (pendingTestRetest !== undefined || testTargets.length === 0) {
    return Object.freeze({
      status: "test-task-planning" as const,
      testEnvironmentAuthority: resolveDemandTestEnvironmentAuthority(loaded),
      retest: pendingTestRetest ?? null,
    });
  }
  const retestedTargetIds = new Set(
    snapshot.targets.flatMap((target) =>
      target.status !== "awaiting-result" &&
      target.taskPackage.workType === "test" &&
      target.taskPackage.lineage !== null
        ? [target.taskPackage.lineage.retestsTargetTaskId]
        : [],
    ),
  );
  const latest = testTargets.filter(
    (target) => !retestedTargetIds.has(target.targetTaskId),
  );
  const escalated = latest[0];
  if (
    latest.length !== 1 ||
    escalated === undefined ||
    escalated.phase !== "test-product-defect"
  ) {
    fail("relation");
  }
  return Object.freeze({
    status: "test-product-defect-escalated" as const,
    testReview: reviewedTest(escalated),
  });
}

function testDelivery(
  target: Readonly<DeliveryBearingTestTargetState>,
): Readonly<DemandPostAcceptanceTestDelivery> {
  return Object.freeze({
    targetTaskId: target.targetTaskId,
    taskPackageId: target.taskPackageId,
    taskPackageDigest: target.taskPackageDigest,
    deliveryId: target.currentDelivery.deliveryId,
    envelopeDigest: target.currentDelivery.envelopeDigest,
    generation: target.currentDelivery.generation,
    fence: Object.freeze({
      claimId: target.currentDelivery.fence.claimId,
      claimDigest: target.currentDelivery.fence.claimDigest,
    }),
    testAttemptId: target.currentDelivery.testAttemptId,
    testWindowId: target.windowId,
  });
}

function reviewedTest(
  target: Readonly<ReviewedTestTargetState>,
): Readonly<DemandPostAcceptanceReviewedTest> {
  return Object.freeze({
    targetTaskId: target.targetTaskId,
    taskPackageId: target.taskPackageId,
    taskPackageDigest: target.taskPackageDigest,
    testAttemptId: target.currentDelivery.testAttemptId,
    testWindowId: target.windowId,
    targetResultId: target.currentDelivery.targetResult.targetResultId,
    resultDigest: target.currentDelivery.targetResult.resultDigest,
    targetReviewDecisionId:
      target.currentDelivery.reviewDecision.targetReviewDecisionId,
    decisionDigest: target.currentDelivery.reviewDecision.decisionDigest,
  });
}

/** 唯一未终结 test 目标按其阶段决定下一位 owner。 */
function openTestStage(
  testTarget: Readonly<TestTargetState>,
): Readonly<DemandPostAcceptanceNextStage> {
  switch (testTarget.phase) {
    case "planned":
      return Object.freeze({
        status: "test-delivery-planning" as const,
        testTask: Object.freeze({
          targetTaskId: testTarget.targetTaskId,
          taskPackageId: testTarget.taskPackageId,
          taskPackageDigest: testTarget.taskPackageDigest,
          testWindowId: testTarget.windowId,
        }),
      });
    case "test-delivery-prepared":
      return Object.freeze({
        status: "test-host-effect-execution" as const,
        testDelivery: testDelivery(testTarget),
      });
    case "test-host-effect-accepted":
    case "test-host-effect-indeterminate":
      return Object.freeze({
        status: "test-result-planning" as const,
        testDelivery: Object.freeze({
          ...testDelivery(testTarget),
          outcomeDigest: testTarget.currentDelivery.outcome.outcomeDigest,
          disposition:
            testTarget.phase === "test-host-effect-accepted"
              ? ("accepted" as const)
              : ("indeterminate" as const),
          readbackStatus: testTarget.currentDelivery.outcome.readbackStatus,
        }),
      });
    case "test-host-effect-rejected":
      return Object.freeze({
        status: "test-delivery-rearm-planning" as const,
        rejectedDelivery: Object.freeze({
          ...testDelivery(testTarget),
          outcomeDigest: testTarget.currentDelivery.outcome.outcomeDigest,
        }),
      });
    case "test-result-reported":
      return Object.freeze({
        status: "test-result-review-planning" as const,
        testResult: Object.freeze({
          targetTaskId: testTarget.targetTaskId,
          taskPackageId: testTarget.taskPackageId,
          taskPackageDigest: testTarget.taskPackageDigest,
          deliveryId: testTarget.currentDelivery.deliveryId,
          testAttemptId: testTarget.currentDelivery.testAttemptId,
          targetResultId:
            testTarget.currentDelivery.targetResult.targetResultId,
          resultDigest: testTarget.currentDelivery.targetResult.resultDigest,
          outcome: testTarget.currentDelivery.targetResult.outcome,
        }),
      });
    case "test-accepted":
      return Object.freeze({
        status: "completion-preflight" as const,
        testingClosure: Object.freeze({
          mode: "real-environment" as const,
          testReview: reviewedTest(testTarget),
        }),
      });
    case "test-another-attempt-requested":
      return Object.freeze({
        status: "test-another-attempt-planning" as const,
        testReview: reviewedTest(testTarget),
      });
    case "test-review-blocked":
      return Object.freeze({
        status: "test-review-blocked" as const,
        testReview: reviewedTest(testTarget),
      });
    case "test-product-defect":
      return Object.freeze({
        status: "test-product-defect-escalated" as const,
        testReview: reviewedTest(testTarget),
      });
  }
}

function routeBasis(
  loaded: Readonly<LoadedDemandEventSourcingRootAuthority>,
  snapshot: Readonly<DemandResultReviewSnapshot>,
): Omit<DemandPostAcceptanceRoute, "routeDigest"> {
  const { snapshotDigest: suppliedSnapshotDigest, ...snapshotBasis } = snapshot;
  if (
    computeCanonicalJsonSha256Digest(snapshotBasis) !==
      suppliedSnapshotDigest ||
    loaded.identity.demandId !== snapshot.demand.demandId ||
    loaded.aggregate.demandId !== snapshot.demand.demandId ||
    loaded.aggregate.state.lifecycle !== snapshot.demand.lifecycle ||
    loaded.aggregate.streamRevision !== snapshot.eventStream.streamRevision ||
    loaded.aggregate.stateDigest !== snapshot.eventStream.stateDigest ||
    loaded.aggregate.lastEvent.eventId !== snapshot.eventStream.lastEventId ||
    loaded.aggregate.lastEventDigest !== snapshot.eventStream.lastEventDigest ||
    loaded.aggregate.state.targetTasks.length !== snapshot.targets.length ||
    loaded.aggregate.state.targetTasks.some(
      (target, index) =>
        target.targetTaskId !== snapshot.targets[index]?.targetTaskId,
    )
  ) {
    fail("relation");
  }
  const acceptedTargets: Readonly<DemandPostAcceptanceAcceptedTarget>[] = [];
  const blockingTargets: Readonly<DemandPostAcceptanceBlockingTarget>[] = [];
  for (const target of snapshot.targets) {
    if (targetWorkType(target) !== "implementation") continue;
    // 被替代的目标是历史，既不阻塞也不计入 accepted。
    if (target.status === "awaiting-result" && target.phase === "superseded") continue;
    const accepted = acceptedTarget(target);
    if (accepted === null) {
      blockingTargets.push(blockingTarget(target));
    } else {
      acceptedTargets.push(accepted);
    }
  }
  return {
    kind: ROUTE_KIND,
    schemaVersion: ROUTE_SCHEMA_VERSION,
    programId: loaded.identity.programId,
    demandId: loaded.identity.demandId,
    demandType: loaded.identity.demandType,
    authorityDigest: loaded.authorityDigest,
    testingDecision: loaded.authority.testingDecision,
    reviewSnapshotDigest: snapshot.snapshotDigest,
    observedEventStream: Object.freeze({
      streamRevision: snapshot.eventStream.streamRevision,
      stateDigest: snapshot.eventStream.stateDigest,
      lastEventId: snapshot.eventStream.lastEventId,
      lastEventDigest: snapshot.eventStream.lastEventDigest,
    }),
    acceptedTargets: Object.freeze(acceptedTargets),
    nextStage: nextStage(loaded, snapshot, blockingTargets),
  };
}

/** 从已验证Demand根Authority和同修订Review Snapshot构造确定性路由。 */
export function buildDemandPostAcceptanceRoute(
  loaded: Readonly<LoadedDemandEventSourcingRootAuthority>,
  snapshot: Readonly<DemandResultReviewSnapshot>,
): Readonly<DemandPostAcceptanceRoute> {
  const basis = routeBasis(loaded, snapshot);
  return Object.freeze({
    ...basis,
    routeDigest: computeCanonicalJsonSha256Digest(basis),
  });
}

function parseInput(
  workspaceRootValue: unknown,
  demandIdValue: unknown,
  optionsValue: unknown,
): Readonly<{
  readonly workspaceRoot: RootedDirectory;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly signal: AbortSignal | undefined;
}> {
  if (
    typeof workspaceRootValue !== "object" ||
    workspaceRootValue === null ||
    types.isProxy(workspaceRootValue) ||
    !(workspaceRootValue instanceof RootedDirectory)
  ) {
    fail("input");
  }
  let demandId: WakeflowDurableId<"demand">;
  try {
    demandId = parseWakeflowDurableIdOfKind(
      demandIdValue,
      "demand",
      "$demandId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("input");
    throw error;
  }
  let options: Readonly<Record<string, unknown>>;
  try {
    options = parsePlainRecord(
      optionsValue === undefined ? {} : optionsValue,
      "$options",
    );
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input");
    throw error;
  }
  if (
    Object.keys(options).some((key) => key !== "signal") ||
    (options.signal !== undefined &&
      (typeof options.signal !== "object" ||
        options.signal === null ||
        types.isProxy(options.signal) ||
        !(options.signal instanceof AbortSignal)))
  ) {
    fail("input");
  }
  const signal = options.signal as AbortSignal | undefined;
  if (signal?.aborted === true) fail("aborted");
  return Object.freeze({
    workspaceRoot: workspaceRootValue,
    demandId,
    signal,
  });
}

function mapContextError(error: DemandOperationAuthorityContextError): never {
  if (error.reason === "root") fail("root");
  if (error.reason === "config" || error.reason === "stale-config") {
    fail("config");
  }
  if (error.reason === "demand-authority") fail("demand-authority");
  fail("aborted");
}

/**
 * 零写读取当前Demand的post-acceptance下一阶段路由；任何后续owner都必须重新复验其
 * `authorityDigest + reviewSnapshotDigest + observedEventStream`，不能把本读模型当成写许可。
 */
export async function readDemandPostAcceptanceRoute(
  workspaceRootValue: unknown,
  demandIdValue: unknown,
  optionsValue?: { readonly signal?: AbortSignal },
): Promise<Readonly<DemandPostAcceptanceRoute>> {
  const input = parseInput(workspaceRootValue, demandIdValue, optionsValue);
  let context;
  try {
    context = await openDemandOperationAuthorityContext(
      input.workspaceRoot,
      input.demandId,
      input.signal,
    );
  } catch (error: unknown) {
    if (error instanceof DemandOperationAuthorityContextError) {
      mapContextError(error);
    }
    throw error;
  }
  let result: Readonly<DemandPostAcceptanceRoute> | undefined;
  let failure: unknown;
  try {
    let snapshot: Readonly<DemandResultReviewSnapshot>;
    try {
      snapshot = await readDemandResultReviewSnapshot(
        context.demandRoot,
        input.signal === undefined ? undefined : { signal: input.signal },
      );
    } catch (error: unknown) {
      if (error instanceof DemandResultReviewSnapshotError) {
        if (error.reason === "aborted") fail("aborted");
        fail("review");
      }
      throw error;
    }
    result = buildDemandPostAcceptanceRoute(context.loaded, snapshot);
  } catch (error: unknown) {
    failure = error;
  }
  try {
    await closeDemandOperationAuthorityContext(context);
  } catch (error: unknown) {
    if (failure === undefined) {
      if (error instanceof DemandOperationAuthorityContextError) {
        mapContextError(error);
      }
      failure = error;
    }
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) fail("operation-failure");
  return result;
}
