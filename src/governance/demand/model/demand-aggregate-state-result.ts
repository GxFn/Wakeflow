import type { WakeflowDurableId } from "../../../contracts/identity/wakeflow-durable-id.js";
import { type TargetResult, targetResultIdForClaim } from "../../result/target-result.js";
import {
  deriveTargetResultCallbackId,
  TARGET_RESULT_CALLBACK_GENERATION_LIMIT,
  type TargetResultCallbackRecord,
  type TargetResultCallbackReissue,
} from "../../result/target-result-callback.js";
import {
  type DemandAggregateState,
  type DemandTargetResultCallbackSummary,
  type DemandTargetTaskState,
  fail,
} from "./demand-aggregate-state-model.js";
import { parseDemandAggregateState, targetResultIdInUse } from "./demand-aggregate-state-wire.js";

/**
 * Wakeflow Governance / Demand Model / Aggregate Result：结果的两个转移：记录 TargetResult（实现与测试各自的准入）、重发 wake-controller 回调。
 *
 * 从 `demand-aggregate-state.ts` 按关注点分出来的一段（open-items L5，gate-log §13.255）；对外的入口仍是那个
 * 文件，它只转出别处在用的公开名字。
 */

function callbackSummaryOf(
  result: Readonly<TargetResult>,
  callback: Readonly<TargetResultCallbackRecord>,
): Readonly<DemandTargetResultCallbackSummary> {
  if (callback.callbackId !== deriveTargetResultCallbackId(result.targetResultId)) {
    fail("transition", "$callback/callbackId");
  }
  return Object.freeze({
    callbackId: callback.callbackId,
    generation: callback.generation,
    promptDigest: callback.promptDigest,
    issuedAt: callback.issuedAt,
    controllerWindowId: callback.controllerWindowId,
    bindingId: callback.bindingId,
  });
}

/**
 * 结果准入的阶段（R5）：第一份结果要求投递已落地（accepted 或 indeterminate）；带 `supersedes` 的
 * 结果要求目标正停在已回报、尚无决定的阶段，且点名的正是当前那份序号 1 的结果——一个投递只能
 * 取代一次，决定之后只有返工。
 */
function resultAdmitted(
  target: Readonly<{ readonly phase: string }>,
  result: Readonly<TargetResult>,
  reportedPhase: string,
  importablePhases: readonly string[],
): boolean {
  if (result.supersedes === undefined) return importablePhases.includes(target.phase);
  const delivery = (
    target as Readonly<{
      readonly currentDelivery?: Readonly<{
        readonly targetResult?: Readonly<{ readonly targetResultId: string }>;
      }>;
    }>
  ).currentDelivery;
  return (
    target.phase === reportedPhase &&
    delivery?.targetResult?.targetResultId === result.supersedes &&
    result.supersedes === targetResultIdForClaim(result.delivery.fence.claimId, 1)
  );
}

type TestImportTarget = Extract<
  DemandTargetTaskState,
  {
    readonly phase:
      | "test-host-effect-accepted"
      | "test-host-effect-indeterminate"
      | "test-result-reported";
  }
>;

type ImplementationImportTarget = Extract<
  DemandTargetTaskState,
  { readonly phase: "host-effect-accepted" | "host-effect-indeterminate" | "result-reported" }
>;

function isTestImportTarget(target: Readonly<DemandTargetTaskState>): target is TestImportTarget {
  return (
    target.phase === "test-host-effect-accepted" ||
    target.phase === "test-host-effect-indeterminate" ||
    target.phase === "test-result-reported"
  );
}

function isImplementationImportTarget(
  target: Readonly<DemandTargetTaskState>,
): target is ImplementationImportTarget {
  return (
    target.phase === "host-effect-accepted" ||
    target.phase === "host-effect-indeterminate" ||
    target.phase === "result-reported"
  );
}

function supersededIdsAfter(
  target: Readonly<{
    readonly supersededTargetResultIds?: readonly WakeflowDurableId<"target-result">[];
  }>,
  result: Readonly<TargetResult>,
): Readonly<{ supersededTargetResultIds?: readonly WakeflowDurableId<"target-result">[] }> {
  return result.supersedes === undefined
    ? {}
    : {
        supersededTargetResultIds: [...(target.supersededTargetResultIds ?? []), result.supersedes],
      };
}

/** `result.target-result-recorded.v1` 使用的纯状态转换：结果与其回调记录一起进入摘要。 */
type TestTargetResult = Extract<TargetResult, { readonly workType: "test" }>;
type ImplementationTargetResult = Exclude<TargetResult, { readonly workType: "test" }>;
type CallbackSummary = ReturnType<typeof callbackSummaryOf>;

/**
 * 测试目标收下一份结果：目标在等结果，结果是这个目标、这份任务包、这次投递与这次尝试的，围栏与结局摘要
 * 都对得上，结果标识没有被用过。
 */
function recordTestTargetResult(
  current: Readonly<DemandAggregateState>,
  target: Readonly<DemandTargetTaskState> | undefined,
  result: Readonly<TestTargetResult>,
  callback: CallbackSummary,
): Readonly<DemandAggregateState> {
  if (
    current.lifecycle !== "active" ||
    result.demandId !== current.demandId ||
    target === undefined ||
    target.workType !== "test" ||
    !isTestImportTarget(target) ||
    !resultAdmitted(target, result, "test-result-reported", [
      "test-host-effect-accepted",
      "test-host-effect-indeterminate",
    ]) ||
    target.taskPackageId !== result.taskPackage.taskPackageId ||
    target.taskPackageDigest !== result.taskPackage.digest ||
    target.windowId !== result.assignment.windowId ||
    target.currentDelivery.deliveryId !== result.deliveryId ||
    target.currentDelivery.testAttemptId !== result.testExecution.testAttemptId ||
    target.currentDelivery.generation !== result.delivery.generation ||
    target.currentDelivery.fence.claimId !== result.delivery.fence.claimId ||
    target.currentDelivery.fence.claimDigest !== result.delivery.fence.claimDigest ||
    target.currentDelivery.outcome.outcomeDigest !== result.delivery.outcomeDigest ||
    target.currentDelivery.outcome.disposition !== result.delivery.disposition ||
    target.currentDelivery.outcome.readbackStatus !== result.delivery.readbackStatus ||
    targetResultIdInUse(current.targetTasks, result.targetResultId)
  ) {
    fail("transition", "$/targetTasks");
  }
  return parseDemandAggregateState({
    ...current,
    targetTasks: current.targetTasks.map((entry) =>
      entry.targetTaskId === target.targetTaskId
        ? {
            ...target,
            ...supersededIdsAfter(target, result),
            phase: "test-result-reported",
            currentDelivery: {
              ...target.currentDelivery,
              targetResult: {
                targetResultId: result.targetResultId,
                resultDigest: result.resultDigest,
                outcome: result.report.outcome,
                reportedAt: result.report.reportedAt,
                claimHandling: "release-authorized",
                callback,
              },
            },
          }
        : entry,
    ),
  });
}

/**
 * 实现目标收下一份结果：除了与测试目标同样的对应关系，报告的仓库就是目标的仓库，报告里的验收锚点都是
 * 目标的；completed 的报告要把锚点交齐，并且提交与否符合任务包的提交期望。
 */
function recordImplementationTargetResult(
  current: Readonly<DemandAggregateState>,
  target: Readonly<DemandTargetTaskState> | undefined,
  result: Readonly<ImplementationTargetResult>,
  callback: CallbackSummary,
): Readonly<DemandAggregateState> {
  if (target === undefined || target.workType === "test") {
    fail("transition", "$/targetTasks");
  }
  const reportAnchorIds = result.report.anchorEvidence.map((entry) => entry.anchorId);
  const completedAnchorsClose =
    result.report.outcome !== "completed" ||
    (reportAnchorIds.length === target.acceptanceAnchorIds.length &&
      target.acceptanceAnchorIds.every((anchorId) => reportAnchorIds.includes(anchorId)));
  const commitPolicyCloses =
    result.report.outcome !== "completed" ||
    (target.commitExpectation === "commit"
      ? result.report.repositoryChange.disposition === "committed"
      : result.report.repositoryChange.disposition !== "committed");
  if (
    current.lifecycle !== "active" ||
    result.demandId !== current.demandId ||
    !isImplementationImportTarget(target) ||
    !resultAdmitted(target, result, "result-reported", [
      "host-effect-accepted",
      "host-effect-indeterminate",
    ]) ||
    target.taskPackageId !== result.taskPackage.taskPackageId ||
    target.taskPackageDigest !== result.taskPackage.digest ||
    target.repositoryId !== result.assignment.repositoryId ||
    target.windowId !== result.assignment.windowId ||
    target.currentDelivery.deliveryId !== result.deliveryId ||
    target.currentDelivery.generation !== result.delivery.generation ||
    target.currentDelivery.fence.claimId !== result.delivery.fence.claimId ||
    target.currentDelivery.fence.claimDigest !== result.delivery.fence.claimDigest ||
    target.currentDelivery.outcome.outcomeDigest !== result.delivery.outcomeDigest ||
    target.currentDelivery.outcome.disposition !== result.delivery.disposition ||
    target.currentDelivery.outcome.readbackStatus !== result.delivery.readbackStatus ||
    result.report.repositoryChange.repositoryId !== target.repositoryId ||
    reportAnchorIds.some((anchorId) => !target.acceptanceAnchorIds.includes(anchorId)) ||
    !completedAnchorsClose ||
    !commitPolicyCloses ||
    targetResultIdInUse(current.targetTasks, result.targetResultId)
  ) {
    fail("transition", "$/targetTasks");
  }
  return parseDemandAggregateState({
    ...current,
    targetTasks: current.targetTasks.map((entry) =>
      entry.targetTaskId === target.targetTaskId
        ? {
            ...entry,
            ...supersededIdsAfter(target, result),
            phase: "result-reported",
            currentDelivery: {
              ...target.currentDelivery,
              targetResult: {
                targetResultId: result.targetResultId,
                resultDigest: result.resultDigest,
                outcome: result.report.outcome,
                reportedAt: result.report.reportedAt,
                claimHandling: "release-authorized",
                callback,
              },
            },
          }
        : entry,
    ),
  });
}

export function recordTargetResultInDemandAggregateState(
  current: Readonly<DemandAggregateState>,
  result: Readonly<TargetResult>,
  callbackRecord: Readonly<TargetResultCallbackRecord>,
): Readonly<DemandAggregateState> {
  const callback = callbackSummaryOf(result, callbackRecord);
  const target = current.targetTasks.find((entry) => entry.targetTaskId === result.targetTaskId);
  if (result.workType === "test") {
    return recordTestTargetResult(current, target, result, callback);
  }
  return recordImplementationTargetResult(current, target, result, callback);
}

/**
 * `result.callback-reissued.v1` 使用的纯状态转换：同一回调换绑定与代际；只在结果尚未被
 * Controller 决定的阶段允许，决定一旦记录回调即 acknowledged。
 */
export function reissueCallbackInDemandAggregateState(
  current: Readonly<DemandAggregateState>,
  reissue: Readonly<TargetResultCallbackReissue>,
): Readonly<DemandAggregateState> {
  const target = current.targetTasks.find(
    (entry) =>
      (entry.phase === "result-reported" || entry.phase === "test-result-reported") &&
      entry.currentDelivery.targetResult.targetResultId === reissue.targetResultId,
  );
  if (
    current.lifecycle !== "active" ||
    target === undefined ||
    (target.phase !== "result-reported" && target.phase !== "test-result-reported")
  ) {
    fail("transition", "$/targetTasks");
  }
  const callback = target.currentDelivery.targetResult.callback;
  if (
    callback.callbackId !== reissue.callbackId ||
    callback.generation !== reissue.previousGeneration ||
    callback.promptDigest !== reissue.promptDigest ||
    reissue.generation > TARGET_RESULT_CALLBACK_GENERATION_LIMIT
  ) {
    fail("transition", "$/targetTasks");
  }
  return parseDemandAggregateState({
    ...current,
    targetTasks: current.targetTasks.map((entry) =>
      entry.targetTaskId === target.targetTaskId
        ? {
            ...target,
            currentDelivery: {
              ...target.currentDelivery,
              targetResult: {
                ...target.currentDelivery.targetResult,
                callback: {
                  ...callback,
                  generation: reissue.generation,
                  issuedAt: reissue.issuedAt,
                  controllerWindowId: reissue.controllerWindowId,
                  bindingId: reissue.bindingId,
                },
              },
            },
          }
        : entry,
    ),
  });
}
