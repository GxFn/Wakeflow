import type { WakeflowDurableId } from "../../../contracts/identity/wakeflow-durable-id.js";
import type { ManagedEvidenceManifest } from "../../evidence/managed-evidence-manifest.js";
import type { DemandCompletion } from "../../lifecycle/demand-completion.js";
import { computeTaskPackageDigest, type TaskPackage } from "../../tasking/task-package.js";
import {
  currentTestTargetsOf,
  type DemandAggregateState,
  type DemandAwaitingDecision,
  type DemandContinuationKind,
  type DemandSupersededTargetTaskState,
  type DemandTargetTaskState,
  fail,
} from "./demand-aggregate-state-model.js";
import {
  compareText,
  computeDemandAggregateStateDigest,
  parseDemandAggregateState,
} from "./demand-aggregate-state-wire.js";

/**
 * Wakeflow Governance / Demand Model / Aggregate Lifecycle：Demand 自己的转移：升级与决定、续接、受管证据、规划目标任务（含替代谱系）、取消与完成。
 *
 * 从 `demand-aggregate-state.ts` 按关注点分出来的一段（open-items L5，gate-log §13.255）；对外的入口仍是那个
 * 文件，它只转出别处在用的公开名字。
 */

export interface DemandEscalationSource {
  readonly issue: string;
  readonly source: DemandAwaitingDecision["source"];
}

/** `lifecycle.demand-escalated.v1`：活动 Demand 进入等待决定；同一时刻只能有一个未回答的升级。 */
export function escalateDemandAggregateState(
  current: Readonly<DemandAggregateState>,
  escalation: Readonly<DemandEscalationSource>,
  escalationEventId: WakeflowDurableId<"demand-event">,
): Readonly<DemandAggregateState> {
  if (
    current.lifecycle !== "active" ||
    current.awaitingDecision !== undefined ||
    !current.targetTasks.some((target) => target.targetTaskId === escalation.source.targetTaskId)
  ) {
    fail("transition", "$state/awaitingDecision");
  }
  return parseDemandAggregateState({
    ...current,
    awaitingDecision: {
      escalationEventId,
      issue: escalation.issue,
      source: escalation.source,
    },
  });
}

/** `lifecycle.decision-recorded.v1`：用户回答清除等待中的升级。 */
export function recordDecisionInDemandAggregateState(
  current: Readonly<DemandAggregateState>,
  escalationEventId: string,
): Readonly<DemandAggregateState> {
  if (
    current.lifecycle !== "active" ||
    current.awaitingDecision === undefined ||
    current.awaitingDecision.escalationEventId !== escalationEventId
  ) {
    fail("transition", "$state/awaitingDecision");
  }
  const { awaitingDecision: _awaitingDecision, ...rest } = current;
  return parseDemandAggregateState(rest);
}

/** 续接决策用：续接前状态里已有的 test 目标，随 `lifecycle.demand-continued` 事件持久化。 */
export function historicalTestTargetIdsAtContinuation(
  current: Readonly<DemandAggregateState>,
): readonly WakeflowDurableId<"target-task">[] {
  return current.targetTasks
    .filter((target) => target.workType === "test")
    .map((target) => target.targetTaskId);
}

/**
 * `lifecycle.demand-continued.v1`：已完成的 Demand 回到 active，并要求先规划新的任务包。
 * 历史 test 目标只取自事件携带的边界；早期事件没有该字段，重放得到与当时完全相同的状态。
 */
export function continueDemandAggregateState(
  current: Readonly<DemandAggregateState>,
  kindValue: DemandContinuationKind,
  eventId: WakeflowDurableId<"demand-event">,
  historicalTestTargetIdsValue?: readonly string[],
  supplementValue?: Readonly<{
    readonly requirementId: string;
    readonly recordRef: string;
    readonly recordDigest: string;
  }>,
): Readonly<DemandAggregateState> {
  if (current.lifecycle !== "completed") fail("transition", "$state/lifecycle");
  // 已接受的目标留在状态里作为历史；续接要求先规划新的任务包，同一仓库允许再次规划。
  // 事件携带的 test 目标成为历史，新一轮真实环境测试从零开始；成员关系由状态解析校验。
  const historicalTestTargetIds = historicalTestTargetIdsValue ?? [];
  if (historicalTestTargetIdsValue !== undefined) {
    const expected = historicalTestTargetIdsAtContinuation(current);
    if (
      historicalTestTargetIds.length !== expected.length ||
      expected.some((id) => !historicalTestTargetIds.includes(id))
    ) {
      fail("relation", "$/continuation/historicalTestTargetIds");
    }
  }
  // supplement 包只随 requirement-supplement 续接并入；重复并入由状态解析拒绝。事件没有带包的续接（1.3.0
  // 之前的 requirement-supplement 也是如此）重放时不改这张表。
  if (supplementValue !== undefined && kindValue !== "requirement-supplement") {
    fail("relation", "$/continuation/supplement");
  }
  return parseDemandAggregateState({
    ...current,
    lifecycle: "active",
    continuation: {
      eventId,
      kind: kindValue,
      planningRequired: true,
      ...(historicalTestTargetIds.length === 0 ? {} : { historicalTestTargetIds }),
    },
    ...(supplementValue === undefined
      ? {}
      : { supplements: [...(current.supplements ?? []), supplementValue] }),
  });
}

/** `evidence.managed-evidence-recorded.v1`使用的纯状态转换。 */
export function recordManagedEvidenceInDemandAggregateState(
  current: Readonly<DemandAggregateState>,
  manifest: Readonly<ManagedEvidenceManifest>,
): Readonly<DemandAggregateState> {
  const recorded = current.managedEvidence ?? [];
  if (
    current.lifecycle !== "active" ||
    manifest.demandId !== current.demandId ||
    manifest.demandAuthorityDigest !== current.authorityDigest ||
    recorded.some((entry) => entry.evidenceId === manifest.evidenceId)
  ) {
    fail("transition", "$state/managedEvidence");
  }
  return parseDemandAggregateState({
    ...current,
    managedEvidence: [
      ...recorded,
      {
        evidenceId: manifest.evidenceId,
        kind: manifest.kind,
        manifestDigest: manifest.manifestDigest,
        payloadArtifactDigest: manifest.payload.artifactDigest,
      },
    ].sort((left, right) => compareText(left.evidenceId, right.evidenceId)),
  });
}

/**
 * 可被替代的实现目标 phase：没有在飞的宿主效果，也没有待评审的结果。tasking 的谱系期望共用这一份。
 * `delivery-prepared` 不在其中（复审 D2、裁决 R3）：许可已发、尚未送出时替代会把窗口的工作声明困到恢复窗口；
 * 先记 `failed-before-send`（→ `host-effect-rejected`，声明释放）再替代。
 */
export const REPLACEABLE_PHASES: readonly DemandTargetTaskState["phase"][] = Object.freeze([
  "planned",
  "host-effect-rejected",
  "rework-requested",
  "product-defect-rework-requested",
  "escalated",
  "review-blocked",
]);

function supersedeTarget(
  target: Readonly<DemandTargetTaskState>,
  supersededByTargetTaskId: WakeflowDurableId<"target-task">,
): Readonly<DemandSupersededTargetTaskState> {
  if (target.workType === "test") fail("transition", "$state/targetTasks");
  return Object.freeze({
    targetTaskId: target.targetTaskId,
    taskPackageId: target.taskPackageId,
    taskPackageDigest: target.taskPackageDigest,
    repositoryId: target.repositoryId,
    windowId: target.windowId,
    commitExpectation: target.commitExpectation,
    acceptanceAnchorIds: target.acceptanceAnchorIds,
    ...(target.reworkCount === undefined ? {} : { reworkCount: target.reworkCount }),
    phase: "superseded" as const,
    supersededByTargetTaskId,
  });
}

/**
 * 同仓库谱系（能力卡 5 Q2）：仓库里已有未接受且未被替代的目标时，新包必须是它的
 * replacement 且旧目标可替代；只剩已接受目标时，新包必须是其中一个的 continuation；
 * 仓库尚无目标时不得声明谱系。返回被替代目标的标识。
 */
function applyLineage(
  current: Readonly<DemandAggregateState>,
  taskPackage: Readonly<TaskPackage>,
): WakeflowDurableId<"target-task"> | null {
  if (taskPackage.workType !== "implementation") return null;
  const repositoryId = taskPackage.assignment.repositoryId;
  const sameRepository = current.targetTasks.filter(
    (entry) => entry.workType !== "test" && entry.repositoryId === repositoryId,
  );
  const open = sameRepository.find(
    (entry) => entry.phase !== "accepted" && entry.phase !== "superseded",
  );
  const lineage = taskPackage.lineage;
  if (open !== undefined) {
    if (
      lineage === null ||
      lineage.kind !== "replacement" ||
      lineage.replacesTargetTaskId !== open.targetTaskId ||
      !REPLACEABLE_PHASES.includes(open.phase)
    ) {
      fail("transition", "$state/targetTasks/lineage");
    }
    return open.targetTaskId;
  }
  const accepted = sameRepository.filter((entry) => entry.phase === "accepted");
  if (accepted.length > 0) {
    if (
      lineage === null ||
      lineage.kind !== "continuation" ||
      !accepted.some((entry) => entry.targetTaskId === lineage.continuesTargetTaskId)
    ) {
      fail("transition", "$state/targetTasks/lineage");
    }
    return null;
  }
  if (lineage !== null) fail("transition", "$state/targetTasks/lineage");
  return null;
}

/** `tasking.target-task-planned.v1` 使用的纯状态转换。 */
type TestTaskPackageOf = Extract<TaskPackage, { readonly workType: "test" }>;
type ImplementationTaskPackageOf = Exclude<TaskPackage, { readonly workType: "test" }>;

/**
 * 规划一个测试目标：它的谱系要么是第一代（没有待复测、没有既有测试目标），要么正是待复测记录指的那一次；
 * 既有的测试目标都已停在产品缺陷；任务包的实现基线与全部在用的实现目标一一对应，并且每个都已接受、结果与
 * 评审决定就是基线里记的那一份。
 */
function planTestTargetTask(
  current: Readonly<DemandAggregateState>,
  taskPackage: Readonly<TestTaskPackageOf>,
): Readonly<DemandAggregateState> {
  const testTargets = currentTestTargetsOf(current);
  const liveImplementationTargets = current.targetTasks.filter(
    (target) => target.workType !== "test" && target.phase !== "superseded",
  );
  const baselineByTarget = new Map(
    taskPackage.implementationBaselines.map(
      (baseline) => [baseline.targetTaskId, baseline] as const,
    ),
  );
  const pendingTestRetest = current.pendingTestRetest;
  const lineage = taskPackage.lineage;
  const lineageCloses =
    lineage === null
      ? pendingTestRetest === undefined && testTargets.length === 0
      : pendingTestRetest !== undefined &&
        lineage.retestsTargetTaskId === pendingTestRetest.previousTestTarget.targetTaskId &&
        lineage.productDefectRemediationId ===
          pendingTestRetest.productDefectRemediation.productDefectRemediationId &&
        lineage.authorizationDigest ===
          pendingTestRetest.productDefectRemediation.authorizationDigest;
  if (
    !lineageCloses ||
    testTargets.some((target) => target.phase !== "test-product-defect") ||
    liveImplementationTargets.length === 0 ||
    liveImplementationTargets.length !== baselineByTarget.size ||
    liveImplementationTargets.some((target) => {
      const baseline = baselineByTarget.get(target.targetTaskId);
      return (
        target.phase !== "accepted" ||
        baseline === undefined ||
        baseline.taskPackageId !== target.taskPackageId ||
        baseline.taskPackageDigest !== target.taskPackageDigest ||
        baseline.repositoryId !== target.repositoryId ||
        baseline.windowId !== target.windowId ||
        baseline.targetResultId !== target.currentDelivery.targetResult.targetResultId ||
        baseline.resultDigest !== target.currentDelivery.targetResult.resultDigest ||
        baseline.targetReviewDecisionId !==
          target.currentDelivery.reviewDecision.targetReviewDecisionId ||
        baseline.decisionDigest !== target.currentDelivery.reviewDecision.decisionDigest
      );
    })
  ) {
    fail("transition", "$state/targetTasks");
  }
  const { pendingTestRetest: _pendingTestRetest, ...withoutPendingTestRetest } = current;
  return parseDemandAggregateState({
    ...withoutPendingTestRetest,
    targetTasks: [
      ...current.targetTasks,
      {
        targetTaskId: taskPackage.targetTaskId,
        taskPackageId: taskPackage.taskPackageId,
        taskPackageDigest: computeTaskPackageDigest(taskPackage),
        workType: "test",
        windowId: taskPackage.assignment.windowId,
        phase: "planned",
      },
    ].sort((left, right) => compareText(left.targetTaskId, right.targetTaskId)),
  });
}

/** 规划一个实现目标：没有待复测、没有测试目标；带替代谱系时把被替代的目标标成 superseded。 */
function planImplementationTargetTask(
  current: Readonly<DemandAggregateState>,
  taskPackage: Readonly<ImplementationTaskPackageOf>,
): Readonly<DemandAggregateState> {
  if (current.pendingTestRetest !== undefined || currentTestTargetsOf(current).length > 0) {
    fail("transition", "$state/targetTasks");
  }
  const superseded = applyLineage(current, taskPackage);
  const nextTargetTasks = [
    ...current.targetTasks.map((entry) =>
      entry.targetTaskId === superseded ? supersedeTarget(entry, taskPackage.targetTaskId) : entry,
    ),
    Object.freeze({
      targetTaskId: taskPackage.targetTaskId,
      taskPackageId: taskPackage.taskPackageId,
      taskPackageDigest: computeTaskPackageDigest(taskPackage),
      repositoryId: taskPackage.assignment.repositoryId,
      windowId: taskPackage.assignment.windowId,
      commitExpectation: taskPackage.commitExpectation,
      acceptanceAnchorIds: Object.freeze(
        taskPackage.acceptanceAnchors.map((anchor) => anchor.anchorId),
      ),
      phase: "planned" as const,
    }),
  ].sort((left, right) => compareText(left.targetTaskId, right.targetTaskId));
  return parseDemandAggregateState({
    ...current,
    ...(current.continuation === undefined
      ? {}
      : {
          continuation: { ...current.continuation, planningRequired: false },
        }),
    targetTasks: nextTargetTasks,
  });
}

export function planTargetTaskInDemandAggregateState(
  current: Readonly<DemandAggregateState>,
  taskPackage: Readonly<TaskPackage>,
): Readonly<DemandAggregateState> {
  if (
    current.lifecycle !== "active" ||
    taskPackage.demandId !== current.demandId ||
    taskPackage.demandAuthorityDigest !== current.authorityDigest ||
    current.targetTasks.some(
      (entry) =>
        entry.targetTaskId === taskPackage.targetTaskId ||
        entry.taskPackageId === taskPackage.taskPackageId,
    )
  ) {
    fail("transition", "$state/targetTasks");
  }
  if (taskPackage.workType === "test") return planTestTargetTask(current, taskPackage);
  return planImplementationTargetTask(current, taskPackage);
}

/** lifecycle.demand-cancelled.v1 使用的纯状态转换。 */
export function cancelDemandAggregateState(
  current: Readonly<DemandAggregateState>,
): Readonly<DemandAggregateState> {
  if (current.lifecycle !== "active") fail("transition", "$/lifecycle");
  // The cancellation event ends the wait; the escalation remains in event history.
  const { awaitingDecision: _awaitingDecision, ...rest } = current;
  return parseDemandAggregateState({
    ...rest,
    lifecycle: "cancelled",
  });
}

/** `lifecycle.demand-completed.v1`使用的成功终态转换。 */
export function completeDemandAggregateState(
  current: Readonly<DemandAggregateState>,
  completion: Readonly<DemandCompletion>,
): Readonly<DemandAggregateState> {
  const implementationTargets = current.targetTasks.filter(
    (target) => target.workType !== "test" && target.phase !== "superseded",
  );
  const testTargets = currentTestTargetsOf(current);
  const openTestTargets = testTargets.filter((target) => target.phase !== "test-product-defect");
  // research（not-applicable）没有测试环节，也允许零实现目标：完成物是受管证据（§13.94 D8）。
  const testingClosed =
    completion.testingMode === "controller-only" || completion.testingMode === "not-applicable"
      ? testTargets.length === 0
      : current.pendingTestRetest === undefined &&
        openTestTargets.length === 1 &&
        openTestTargets[0]?.phase === "test-accepted";
  const targetsClosed =
    (implementationTargets.length > 0 || completion.testingMode === "not-applicable") &&
    implementationTargets.every((target) => target.phase === "accepted");
  if (
    current.lifecycle !== "active" ||
    completion.demandId !== current.demandId ||
    completion.authorityDigest !== current.authorityDigest ||
    completion.observedState.stateDigest !== computeDemandAggregateStateDigest(current) ||
    !targetsClosed ||
    current.awaitingDecision !== undefined ||
    current.continuation?.planningRequired === true ||
    !testingClosed
  ) {
    fail("transition", "$state");
  }
  return parseDemandAggregateState({
    ...current,
    lifecycle: "completed",
  });
}
