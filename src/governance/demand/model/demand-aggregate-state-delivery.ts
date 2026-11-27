import type { WakeflowDurableId } from "../../../contracts/identity/wakeflow-durable-id.js";
import {
  type WakeflowRearmableTargetPhase,
  wakeflowRearmablePhase,
  wakeflowTargetPhaseAdmission,
} from "../../../contracts/vocabulary/wakeflow-target-phases.js";
import { computeCanonicalJsonSha256Digest } from "../../../foundation/crypto/canonical-json-sha256.js";
import type { WakeflowWindowHostBindingId } from "../../../contracts/identity/wakeflow-window-host-binding-id.js";
import { type DeliveryEnvelope, deliveryPurpose } from "../../delivery/delivery-envelope.js";
import type { DeliveryDisposition, DeliveryOutcome } from "../../delivery/delivery-outcome.js";
import { DELIVERY_REARM_LIMIT, type DeliveryRearm } from "../../delivery/delivery-rearm.js";
import {
  assertRerunTestExecutionAttemptFollows,
  type TestExecutionAttempt,
  TestExecutionAttemptError,
} from "../../testing/test-execution-attempt.js";
import {
  type DemandAggregateState,
  type DemandCurrentDeliveryBase,
  type DemandDeliveryOutcomeSummary,
  type DemandPlannedTargetTaskState,
  type DemandSupersededTargetTaskState,
  type DemandTargetTaskState,
  type DemandTestAttemptDeliverySummary,
  type DemandTestCurrentDeliveryBase,
  type DemandTestHostEffectRejectedTargetTaskState,
  type DemandTestPlannedTargetTaskState,
  fail,
  lastTestAttempt,
} from "./demand-aggregate-state-model.js";
import { parseDemandAggregateState, TEST_ATTEMPT_LIMIT } from "./demand-aggregate-state-wire.js";

/**
 * Wakeflow Governance / Demand Model / Aggregate Delivery：投递的三个转移：准备（含返工、产品缺陷修复与测试尝试的各自前提）、记录结局、rearm。
 *
 * 从 `demand-aggregate-state.ts` 按关注点分出来的一段（open-items L5，gate-log §13.255）；对外的入口仍是那个
 * 文件，它只转出别处在用的公开名字。
 */

type DeliveryBearingTargetTaskState = Exclude<
  DemandTargetTaskState,
  DemandPlannedTargetTaskState | DemandTestPlannedTargetTaskState | DemandSupersededTargetTaskState
>;

function deliveryBearingTargets(
  current: Readonly<DemandAggregateState>,
): readonly Readonly<DeliveryBearingTargetTaskState>[] {
  return current.targetTasks.filter(
    (entry): entry is Readonly<DeliveryBearingTargetTaskState> =>
      entry.phase !== "planned" && entry.phase !== "superseded",
  );
}

function currentDeliveryOf(
  envelope: Readonly<DeliveryEnvelope>,
  generation: number,
): Readonly<DemandCurrentDeliveryBase> {
  return Object.freeze({
    deliveryId: envelope.deliveryId,
    envelopeDigest: envelope.envelopeDigest,
    promptDigest: envelope.promptDigest,
    generation,
    hostId: envelope.route.hostId,
    bindingId: envelope.route.bindingId,
    fence: Object.freeze({
      claimId: envelope.fence.claimId,
      claimDigest: envelope.fence.claimDigest,
      streamRevision: envelope.fence.expectedStreamRevision + 1,
    }),
  });
}

function assertClaimUnused(
  current: Readonly<DemandAggregateState>,
  claimId: WakeflowDurableId<"work-claim">,
): void {
  if (
    deliveryBearingTargets(current).some((entry) => entry.currentDelivery.fence.claimId === claimId)
  ) {
    fail("transition", "$/targetTasks");
  }
}

/**
 * 发送前被拒的信封何时可以被一份新信封取代：rearm 已经用尽，或者新信封绑定的窗口绑定不是被拒信封的那一个
 * ——窗口在那之后被替换过，被拒的信封再也 rearm 不了（rearm 拒绝 `binding-changed`）。只认第一条时，窗口
 * 一被替换目标就既不能重签也不能重新准备（1.3.0 终验的桌面一轮）。
 */
function rejectedEnvelopeReplaceable(
  rejected: Readonly<Pick<DemandCurrentDeliveryBase, "generation" | "bindingId">>,
  replacementBindingId: WakeflowWindowHostBindingId,
): boolean {
  return rejected.generation > DELIVERY_REARM_LIMIT || replacementBindingId !== rejected.bindingId;
}

/** `delivery.delivery-prepared.v1` 使用的纯状态转换：实现与 test 两类目标共用。 */
/**
 * rearm 用尽（或窗口已被替换）的测试投递换新信封：同一次尝试原样重发，只替换这次尝试的投递摘要；
 * 被拒的投递从未到达会话，所以不产生新的尝试序号。
 */
function replaceRejectedTestAttemptDelivery(
  current: Readonly<DemandAggregateState>,
  target: Readonly<DemandTestHostEffectRejectedTargetTaskState>,
  attempt: Readonly<TestExecutionAttempt>,
  replacement: Readonly<{
    readonly currentDelivery: Readonly<DemandTestCurrentDeliveryBase>;
    readonly attemptDelivery: Readonly<DemandTestAttemptDeliverySummary>;
  }>,
): Readonly<DemandAggregateState> {
  const rejected = lastTestAttempt(target.testAttempts);
  if (
    !rejectedEnvelopeReplaceable(target.currentDelivery, replacement.currentDelivery.bindingId) ||
    rejected.delivery.deliveryId !== target.currentDelivery.deliveryId ||
    computeCanonicalJsonSha256Digest(rejected.attempt) !== computeCanonicalJsonSha256Digest(attempt)
  ) {
    fail("transition", "$/targetTasks");
  }
  return parseDemandAggregateState({
    ...current,
    targetTasks: current.targetTasks.map((entry) =>
      entry.targetTaskId === target.targetTaskId
        ? {
            ...target,
            phase: "test-delivery-prepared",
            currentDelivery: replacement.currentDelivery,
            testAttempts: [
              ...target.testAttempts.slice(0, -1),
              { attempt, delivery: replacement.attemptDelivery },
            ],
          }
        : entry,
    ),
  });
}

/**
 * 目标处在阶段表允许 rearm 的阶段（open-items L1）。运行时查表，类型上收窄到表里 `rearm: true` 的那些
 * 阶段对应的状态——它们都带着一次已有结局的投递。
 */
function isRearmableTarget<Target extends { readonly phase: string }>(
  target: Target,
): target is Extract<Target, { readonly phase: WakeflowRearmableTargetPhase }> {
  return wakeflowRearmablePhase(target.phase);
}

type TestDeliveryEnvelope = Extract<DeliveryEnvelope, { readonly workType: "test" }>;
type ImplementationDeliveryEnvelope = Exclude<DeliveryEnvelope, { readonly workType: "test" }>;
type ImplementationTargetTaskState = Exclude<DemandTargetTaskState, { readonly workType: "test" }>;
type DeliveryPurpose = ReturnType<typeof deliveryPurpose>;

/**
 * 给测试目标准备投递：信封里的尝试必须是这个目标、这份任务包的。三种情形——被拒的信封换新（rearm 用尽或
 * 窗口已替换）、第一次尝试、评审要求再跑一次之后的重跑（接得上上一项，谱系未满，依据的结果与决定就是当前
 * 这一份）。
 */
function prepareTestDelivery(
  current: Readonly<DemandAggregateState>,
  target: Readonly<DemandTargetTaskState>,
  envelope: Readonly<TestDeliveryEnvelope>,
  currentDelivery: ReturnType<typeof currentDeliveryOf>,
): Readonly<DemandAggregateState> {
  if (
    target.workType !== "test" ||
    envelope.attempt.targetTaskId !== target.targetTaskId ||
    envelope.attempt.contract.taskPackageId !== target.taskPackageId ||
    envelope.attempt.contract.taskPackageDigest !== target.taskPackageDigest
  ) {
    fail("transition", "$/targetTasks");
  }
  const attemptDelivery = Object.freeze({
    deliveryId: envelope.deliveryId,
    envelopeDigest: envelope.envelopeDigest,
    preparedAt: envelope.preparedAt,
  });
  const testCurrentDelivery = Object.freeze({
    ...currentDelivery,
    testAttemptId: envelope.attempt.testAttemptId,
  });
  if (target.phase === "test-host-effect-rejected") {
    return replaceRejectedTestAttemptDelivery(current, target, envelope.attempt, {
      currentDelivery: testCurrentDelivery,
      attemptDelivery,
    });
  }
  if (envelope.attempt.mode === "initial") {
    if (target.phase !== "planned") fail("transition", "$/targetTasks");
    return parseDemandAggregateState({
      ...current,
      targetTasks: current.targetTasks.map((entry) =>
        entry.targetTaskId === target.targetTaskId
          ? {
              ...target,
              phase: "test-delivery-prepared",
              currentDelivery: testCurrentDelivery,
              testAttempts: [{ attempt: envelope.attempt, delivery: attemptDelivery }],
            }
          : entry,
      ),
    });
  }
  if (target.phase !== "test-another-attempt-requested") {
    fail("transition", "$/targetTasks");
  }
  const previousAttempt = lastTestAttempt(target.testAttempts);
  try {
    assertRerunTestExecutionAttemptFollows(envelope.attempt, previousAttempt.attempt);
  } catch (error: unknown) {
    if (error instanceof TestExecutionAttemptError) {
      fail("transition", "$/targetTasks", error);
    }
    throw error;
  }
  const rerunSource = envelope.attempt.rerunSource;
  if (
    target.testAttempts.length >= TEST_ATTEMPT_LIMIT ||
    target.testAttempts.some(
      (entry) => entry.attempt.testAttemptId === envelope.attempt.testAttemptId,
    ) ||
    rerunSource.previousResult.targetResultId !==
      target.currentDelivery.targetResult.targetResultId ||
    rerunSource.previousResult.resultDigest !== target.currentDelivery.targetResult.resultDigest ||
    rerunSource.reviewDecision.targetReviewDecisionId !==
      target.currentDelivery.reviewDecision.targetReviewDecisionId ||
    rerunSource.reviewDecision.decisionDigest !==
      target.currentDelivery.reviewDecision.decisionDigest ||
    target.currentDelivery.reviewDecision.decision !== "request-another-attempt"
  ) {
    fail("transition", "$/targetTasks");
  }
  return parseDemandAggregateState({
    ...current,
    targetTasks: current.targetTasks.map((entry) =>
      entry.targetTaskId === target.targetTaskId
        ? {
            ...target,
            phase: "test-delivery-prepared",
            currentDelivery: testCurrentDelivery,
            testAttempts: [
              ...target.testAttempts,
              { attempt: envelope.attempt, delivery: attemptDelivery },
            ],
          }
        : entry,
    ),
  });
}

/** 评审要求返工之后的投递：信封带的返工依据就是当前这份决定与这份结果，并且是一份新的投递。 */
function assertReworkBasisMatches(
  target: Extract<ImplementationTargetTaskState, { readonly phase: "rework-requested" }>,
  envelope: Readonly<ImplementationDeliveryEnvelope>,
  purpose: DeliveryPurpose,
): void {
  if (
    purpose !== "implementation-review-rework" ||
    envelope.rework === undefined ||
    envelope.deliveryId === target.currentDelivery.deliveryId ||
    envelope.rework.decision.targetReviewDecisionId !==
      target.currentDelivery.reviewDecision.targetReviewDecisionId ||
    envelope.rework.decision.decisionDigest !==
      target.currentDelivery.reviewDecision.decisionDigest ||
    envelope.rework.previousResult.targetResultId !==
      target.currentDelivery.targetResult.targetResultId ||
    envelope.rework.previousResult.resultDigest !== target.currentDelivery.targetResult.resultDigest
  ) {
    fail("transition", "$/targetTasks");
  }
}

/**
 * 产品缺陷修复的投递：信封带的修复依据就是记下的那份授权、那次测试评审决定与当前这份结果，要改的步骤与
 * 记下的失败步骤逐项相同，并且是一份新的投递。
 */
function assertRemediationBasisMatches(
  target: Extract<
    ImplementationTargetTaskState,
    { readonly phase: "product-defect-rework-requested" }
  >,
  envelope: Readonly<ImplementationDeliveryEnvelope>,
  purpose: DeliveryPurpose,
): void {
  const remediation = envelope.productDefectRemediation;
  if (
    purpose !== "product-defect-remediation" ||
    remediation === undefined ||
    envelope.deliveryId === target.currentDelivery.deliveryId ||
    remediation.authorization.productDefectRemediationId !==
      target.productDefectRemediation.productDefectRemediationId ||
    remediation.authorization.authorizationDigest !==
      target.productDefectRemediation.authorizationDigest ||
    remediation.testReviewDecision.targetReviewDecisionId !==
      target.productDefectRemediation.testReviewDecisionId ||
    remediation.testReviewDecision.decisionDigest !==
      target.productDefectRemediation.testReviewDecisionDigest ||
    remediation.previousResult.targetResultId !==
      target.currentDelivery.targetResult.targetResultId ||
    remediation.previousResult.resultDigest !== target.currentDelivery.targetResult.resultDigest ||
    remediation.requiredCorrections.length !==
      target.productDefectRemediation.failedStepIds.length ||
    remediation.requiredCorrections.some(
      (correction, index) =>
        correction.stepId !== target.productDefectRemediation.failedStepIds[index],
    )
  ) {
    fail("transition", "$/targetTasks");
  }
}

/**
 * 给实现目标准备投递时各阶段自己的前提：planned 只收初次投递；被拒的信封要确实不能再 rearm；返工与产品
 * 缺陷修复各自核对依据。阶段表已经挡掉不能准备投递的阶段，落到最后一支的是表与这里不一致。
 */
function assertImplementationDeliveryAdmitted(
  target: Readonly<ImplementationTargetTaskState>,
  envelope: Readonly<ImplementationDeliveryEnvelope>,
): void {
  const purpose = deliveryPurpose(envelope);
  if (target.phase === "planned") {
    if (purpose !== "initial") fail("transition", "$/targetTasks");
  } else if (target.phase === "host-effect-rejected") {
    // rearm 用尽、或窗口已被替换之后换新信封重新准备。状态不保留被拒信封的返工依据，由切片从被拒信封
    // 原样带过来，决策器校验依据与信封自洽；这里只守住"被拒的那份信封确实不能再 rearm"。
    if (!rejectedEnvelopeReplaceable(target.currentDelivery, envelope.route.bindingId)) {
      fail("transition", "$/targetTasks");
    }
  } else if (target.phase === "rework-requested") {
    assertReworkBasisMatches(target, envelope, purpose);
  } else if (target.phase === "product-defect-rework-requested") {
    assertRemediationBasisMatches(target, envelope, purpose);
  } else {
    fail("transition", "$/targetTasks");
  }
}

export function prepareDeliveryInDemandAggregateState(
  current: Readonly<DemandAggregateState>,
  envelope: Readonly<DeliveryEnvelope>,
): Readonly<DemandAggregateState> {
  const target = current.targetTasks.find(
    (entry) => entry.targetTaskId === envelope.target.targetTaskId,
  );
  if (
    current.lifecycle !== "active" ||
    current.awaitingDecision !== undefined ||
    envelope.demandId !== current.demandId ||
    target === undefined ||
    target.taskPackageId !== envelope.target.taskPackageId ||
    target.taskPackageDigest !== envelope.target.taskPackageDigest ||
    target.windowId !== envelope.route.windowId ||
    deliveryBearingTargets(current).some(
      (entry) => entry.currentDelivery.deliveryId === envelope.deliveryId,
    )
  ) {
    fail("transition", "$/targetTasks");
  }
  // 阶段表是"这个阶段能不能准备投递"的唯一来源（open-items L1）：表说不能的，下面按用途展开的分支
  // 一个都不进；分支只负责各自用途的前提（返工依据、代际上限、尝试合同）。
  if (
    (wakeflowTargetPhaseAdmission(target.workType ?? "implementation", target.phase)?.prepare ??
      "no") === "no"
  ) {
    fail("transition", "$/targetTasks");
  }
  assertClaimUnused(current, envelope.fence.claimId);
  const currentDelivery = currentDeliveryOf(envelope, 1);
  if (envelope.workType === "test") {
    return prepareTestDelivery(current, target, envelope, currentDelivery);
  }
  if (target.workType === "test") fail("transition", "$/targetTasks");
  assertImplementationDeliveryAdmitted(target, envelope);
  return parseDemandAggregateState({
    ...current,
    targetTasks: current.targetTasks.map((entry) => {
      if (entry.targetTaskId !== target.targetTaskId) return entry;
      if (target.phase === "product-defect-rework-requested") {
        const { productDefectRemediation: _productDefectRemediation, ...withoutRemediation } =
          target;
        return {
          ...withoutRemediation,
          phase: "delivery-prepared",
          currentDelivery,
        };
      }
      const { currentDelivery: _previous, ...withoutDelivery } = target as typeof target & {
        readonly currentDelivery?: unknown;
      };
      return {
        ...withoutDelivery,
        phase: "delivery-prepared",
        currentDelivery,
      };
    }),
  });
}

function phaseForDisposition(
  workType: "implementation" | "test",
  disposition: DeliveryDisposition,
): DemandTargetTaskState["phase"] {
  if (workType === "test") {
    return disposition === "accepted"
      ? "test-host-effect-accepted"
      : disposition === "indeterminate"
        ? "test-host-effect-indeterminate"
        : "test-host-effect-rejected";
  }
  return disposition === "accepted"
    ? "host-effect-accepted"
    : disposition === "indeterminate"
      ? "host-effect-indeterminate"
      : "host-effect-rejected";
}

/**
 * `delivery.delivery-outcome-recorded.v1` 使用的纯状态转换。首次处置来自
 * delivery-prepared；indeterminate 之后允许再记一次（hook 记录到达或 Controller 显式解决）。
 */
export function recordDeliveryOutcomeInDemandAggregateState(
  current: Readonly<DemandAggregateState>,
  outcome: Readonly<DeliveryOutcome>,
): Readonly<DemandAggregateState> {
  const candidates = deliveryBearingTargets(current).filter(
    (entry) => entry.currentDelivery.deliveryId === outcome.deliveryId,
  );
  const target = candidates.length === 1 ? candidates[0] : undefined;
  if (
    target === undefined ||
    current.lifecycle !== "active" ||
    target.currentDelivery.generation !== outcome.generation ||
    target.currentDelivery.fence.claimId !== outcome.fence.claimId ||
    target.currentDelivery.fence.claimDigest !== outcome.fence.claimDigest
  ) {
    fail("transition", "$/targetTasks");
  }
  const firstOutcome =
    target.phase === "delivery-prepared" || target.phase === "test-delivery-prepared";
  const reevaluation =
    target.phase === "host-effect-indeterminate" ||
    target.phase === "test-host-effect-indeterminate";
  if (!firstOutcome && !reevaluation) fail("transition", "$/targetTasks");
  if (reevaluation && outcome.disposition === "indeterminate") {
    fail("transition", "$/targetTasks");
  }
  const workType = target.workType === "test" ? "test" : "implementation";
  const summary: DemandDeliveryOutcomeSummary = Object.freeze({
    outcomeDigest: outcome.outcomeDigest,
    disposition: outcome.disposition,
    evidenceKind: outcome.evidence.kind,
    readbackStatus: outcome.readback.status,
    claimHandling: outcome.claimHandling,
    observedAt: outcome.observedAt,
  });
  return parseDemandAggregateState({
    ...current,
    targetTasks: current.targetTasks.map((entry) =>
      entry.targetTaskId === target.targetTaskId
        ? {
            ...entry,
            phase: phaseForDisposition(workType, outcome.disposition),
            currentDelivery: {
              ...target.currentDelivery,
              outcome: summary,
            },
          }
        : entry,
    ),
  });
}

/** `delivery.delivery-rearmed.v1` 使用的纯状态转换：同一信封、新声明与围栏、代际加一。 */
export function rearmDeliveryInDemandAggregateState(
  current: Readonly<DemandAggregateState>,
  rearm: Readonly<DeliveryRearm>,
): Readonly<DemandAggregateState> {
  const candidates = deliveryBearingTargets(current).filter(
    (entry) => entry.currentDelivery.deliveryId === rearm.deliveryId,
  );
  const target = candidates.length === 1 ? candidates[0] : undefined;
  // rearmedAt 只保留来源时钟的审计事实；因果关系由处置摘要、围栏与追加 CAS 建立。
  if (
    target === undefined ||
    current.lifecycle !== "active" ||
    current.awaitingDecision !== undefined ||
    // 哪些阶段允许 rearm 由阶段表说了算（open-items L1）：与预览的判定是同一列。
    !isRearmableTarget(target) ||
    target.currentDelivery.generation !== rearm.previousGeneration ||
    target.currentDelivery.fence.claimId !== rearm.previousFence.claimId ||
    target.currentDelivery.fence.claimDigest !== rearm.previousFence.claimDigest ||
    target.currentDelivery.outcome.outcomeDigest !== rearm.rejectedOutcomeDigest ||
    target.currentDelivery.outcome.disposition !== "rejected-before-send" ||
    rearm.generation > DELIVERY_REARM_LIMIT + 1
  ) {
    fail("transition", "$/targetTasks");
  }
  assertClaimUnused(current, rearm.fence.claimId);
  const { outcome: _outcome, ...withoutOutcome } = target.currentDelivery;
  const rearmed = {
    ...withoutOutcome,
    generation: rearm.generation,
    fence: {
      claimId: rearm.fence.claimId,
      claimDigest: rearm.fence.claimDigest,
      streamRevision: rearm.fence.expectedStreamRevision + 1,
    },
  };
  return parseDemandAggregateState({
    ...current,
    targetTasks: current.targetTasks.map((entry) =>
      entry.targetTaskId === target.targetTaskId
        ? {
            ...entry,
            phase: target.workType === "test" ? "test-delivery-prepared" : "delivery-prepared",
            currentDelivery: rearmed,
          }
        : entry,
    ),
  });
}
