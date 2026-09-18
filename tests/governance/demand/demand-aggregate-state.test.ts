import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { createTargetDeliveryReworkContext } from "../../../src/governance/delivery/target-delivery-rework-context.js";

import {
  computeTaskPackageDigest,
  createTaskPackage,
} from "../../../src/governance/tasking/task-package.js";
import {
  cancelDemandAggregateState,
  computeDemandAggregateStateDigest,
  createInitialDemandAggregateState,
  decideTargetResultReviewInDemandAggregateState,
  prepareDeliveryInDemandAggregateState,
  planTargetTaskInDemandAggregateState,
  parseDemandAggregateState,
  rearmDeliveryInDemandAggregateState,
  recordDeliveryOutcomeInDemandAggregateState,
  recordTargetResultInDemandAggregateState,
  DemandAggregateStateError,
} from "../../../src/governance/demand/model/demand-aggregate-state.js";
import {
  createTaskPackageFixture,
  TARGET_TASK_ID,
  TASKING_AUTHORITY_DIGEST,
  TASKING_CREATED_AT,
  TASKING_DEMAND_ID,
  TASKING_REPOSITORY_ID,
  TASKING_WINDOW_ID,
  TASK_PACKAGE_ID,
  taskPackageDraft,
} from "../tasking/task-package.fixture.js";
import {
  createDeliveryEnvelopeFixture,
  createDeliveryOutcomeFixture,
  createDeliveryRearmFixture,
  createWorkClaimFixture,
  DELIVERY_BINDING_ID,
  DELIVERY_ID,
  OTHER_DELIVERY_CLAIM_ID,
  THIRD_DELIVERY_CLAIM_ID,
} from "../delivery/delivery-records.fixture.js";
import {
  createTargetResultCallbackFixture,
  createTargetResultFixture,
} from "../result/target-result.fixture.js";
import { createControllerImplementationReviewDecisionForState } from "../review/controller-implementation-review-decision.fixture.js";

test("Demand 聚合保存任务决策所需的最小 authority 与 target 摘要", () => {
  const active = createInitialDemandAggregateState(
    TASKING_DEMAND_ID,
    TASKING_AUTHORITY_DIGEST,
  );
  deepEqual(active, {
    artifactKind: "wakeflow-demand-aggregate-state",
    schemaVersion: 1,
    demandId: TASKING_DEMAND_ID,
    authorityDigest: TASKING_AUTHORITY_DIGEST,
    lifecycle: "active",
    targetTasks: [],
  });
  equal(Object.isFrozen(active), true);

  const taskPackage = createTaskPackageFixture();
  if (taskPackage.workType !== "implementation") {
    throw new Error("Expected implementation TaskPackage fixture.");
  }
  const planned = planTargetTaskInDemandAggregateState(active, taskPackage);
  deepEqual(planned.targetTasks, [
    {
      targetTaskId: TARGET_TASK_ID,
      taskPackageId: TASK_PACKAGE_ID,
      taskPackageDigest: computeTaskPackageDigest(taskPackage),
      repositoryId: TASKING_REPOSITORY_ID,
      windowId: TASKING_WINDOW_ID,
      commitExpectation: taskPackage.commitExpectation,
      acceptanceAnchorIds: taskPackage.acceptanceAnchors.map(
        (anchor) => anchor.anchorId,
      ),
      phase: "planned",
    },
  ]);
  equal(Object.isFrozen(planned.targetTasks), true);
  equal(Object.isFrozen(planned.targetTasks[0]), true);
  equal(Object.hasOwn(planned.targetTasks[0]!, "workType"), false);

  const claim = createWorkClaimFixture();
  const envelope = createDeliveryEnvelopeFixture({ claim });
  const prepared = prepareDeliveryInDemandAggregateState(planned, envelope);
  deepEqual(prepared.targetTasks[0], {
    ...planned.targetTasks[0],
    phase: "delivery-prepared",
    currentDelivery: {
      deliveryId: DELIVERY_ID,
      envelopeDigest: envelope.envelopeDigest,
      promptDigest: envelope.promptDigest,
      generation: 1,
      hostId: "codex",
      bindingId: DELIVERY_BINDING_ID,
      fence: {
        claimId: claim.claimId,
        claimDigest: claim.claimDigest,
        streamRevision: envelope.fence.expectedStreamRevision + 1,
      },
    },
  });
  throws(
    () => prepareDeliveryInDemandAggregateState(prepared, envelope),
    (error: unknown) =>
      error instanceof DemandAggregateStateError &&
      error.reason === "transition",
  );

  const observedCases = [
    {
      disposition: "accepted" as const,
      readbackStatus: "pending" as const,
      phase: "host-effect-accepted" as const,
      claimHandling: "retain" as const,
    },
    {
      disposition: "indeterminate" as const,
      readbackStatus: "unavailable" as const,
      phase: "host-effect-indeterminate" as const,
      claimHandling: "retain" as const,
    },
    {
      disposition: "rejected-before-send" as const,
      readbackStatus: "unavailable" as const,
      phase: "host-effect-rejected" as const,
      claimHandling: "release-authorized" as const,
    },
  ];
  let accepted = prepared;
  let acceptedOutcome: ReturnType<typeof createDeliveryOutcomeFixture> | undefined;
  let rejected = prepared;
  let rejectedOutcome: ReturnType<typeof createDeliveryOutcomeFixture> | undefined;
  for (const candidate of observedCases) {
    const outcome = createDeliveryOutcomeFixture({
      claim,
      envelope,
      disposition: candidate.disposition,
      readbackStatus: candidate.readbackStatus,
    });
    const observed = recordDeliveryOutcomeInDemandAggregateState(prepared, outcome);
    equal(observed.targetTasks[0]?.phase, candidate.phase);
    const current = observed.targetTasks[0];
    if (
      current?.phase !== "host-effect-accepted" &&
      current?.phase !== "host-effect-indeterminate" &&
      current?.phase !== "host-effect-rejected"
    ) {
      throw new Error("Expected observed delivery outcome state.");
    }
    equal(current.currentDelivery.outcome.disposition, candidate.disposition);
    equal(current.currentDelivery.outcome.claimHandling, candidate.claimHandling);
    equal(current.currentDelivery.outcome.outcomeDigest, outcome.outcomeDigest);
    if (current.phase === "host-effect-accepted") {
      accepted = observed;
      acceptedOutcome = outcome;
    }
    if (current.phase === "host-effect-rejected") {
      rejected = observed;
      rejectedOutcome = outcome;
    }
  }

  if (rejectedOutcome === undefined || acceptedOutcome === undefined) {
    throw new Error("Expected accepted and rejected outcome fixtures.");
  }
  // accepted 之后不能再记录结局；indeterminate 才允许再次记录。
  throws(
    () => recordDeliveryOutcomeInDemandAggregateState(accepted, acceptedOutcome),
    (error: unknown) =>
      error instanceof DemandAggregateStateError &&
      error.reason === "transition",
  );
  const rearm = createDeliveryRearmFixture(envelope, rejectedOutcome);
  const rearmed = rearmDeliveryInDemandAggregateState(rejected, rearm);
  equal(rearmed.targetTasks[0]?.phase, "delivery-prepared");
  if (rearmed.targetTasks[0]?.phase !== "delivery-prepared") {
    throw new Error("Expected rearmed delivery-prepared target.");
  }
  equal(rearmed.targetTasks[0].currentDelivery.generation, 2);
  equal(rearmed.targetTasks[0].currentDelivery.fence.claimId, rearm.fence.claimId);
  equal(rearmed.targetTasks[0].currentDelivery.deliveryId, DELIVERY_ID);
  throws(
    () => rearmDeliveryInDemandAggregateState(accepted, rearm),
    (error: unknown) =>
      error instanceof DemandAggregateStateError &&
      error.reason === "transition",
  );

  const targetResult = createTargetResultFixture({
    claim,
    envelope,
    outcome: acceptedOutcome,
  });
  const resultReported = recordTargetResultInDemandAggregateState(
    accepted,
    targetResult,
    createTargetResultCallbackFixture(targetResult),
  );
  equal(resultReported.targetTasks[0]?.phase, "result-reported");
  const reportedTarget = resultReported.targetTasks[0];
  if (reportedTarget?.phase !== "result-reported") {
    throw new Error("Expected result-reported target.");
  }
  equal(reportedTarget.currentDelivery.targetResult.outcome, "completed");
  equal(reportedTarget.currentDelivery.targetResult.callback.generation, 1);
  equal(reportedTarget.currentDelivery.outcome.disposition, "accepted");

  for (const candidate of [
    { decision: "accept" as const, phase: "accepted" as const },
    { decision: "rework" as const, phase: "rework-requested" as const },
    { decision: "escalate" as const, phase: "escalated" as const },
    { decision: "blocked" as const, phase: "review-blocked" as const },
  ]) {
    const decision = createControllerImplementationReviewDecisionForState(
      computeDemandAggregateStateDigest(resultReported),
      candidate.decision,
      8,
      targetResult,
    );
    const reviewed = decideTargetResultReviewInDemandAggregateState(
      resultReported,
      decision,
    );
    equal(reviewed.targetTasks[0]?.phase, candidate.phase);
    const target = reviewed.targetTasks[0];
    if (
      target?.phase !== "accepted" &&
      target?.phase !== "rework-requested" &&
      target?.phase !== "escalated" &&
      target?.phase !== "review-blocked"
    ) {
      throw new Error("Expected reviewed target state.");
    }
    equal(target.currentDelivery.reviewDecision.decision, candidate.decision);
    equal(
      target.currentDelivery.reviewDecision.decisionDigest,
      decision.decisionDigest,
    );
  }

  const reworkDecision = createControllerImplementationReviewDecisionForState(
    computeDemandAggregateStateDigest(resultReported),
    "rework",
    8,
    targetResult,
  );
  const reworkRequested = decideTargetResultReviewInDemandAggregateState(
    resultReported,
    reworkDecision,
  );
  const reworkDeliveryId = parseWakeflowDurableIdOfKind(
    "target-delivery_89898989-8989-4989-8989-898989898989",
    "target-delivery",
  );
  const reworkClaim = createWorkClaimFixture({
    claimId: OTHER_DELIVERY_CLAIM_ID,
    deliveryId: reworkDeliveryId,
  });
  const reworkEnvelope = createDeliveryEnvelopeFixture({
    claim: reworkClaim,
    deliveryId: reworkDeliveryId,
    rework: createTargetDeliveryReworkContext({
      decision: reworkDecision,
      previousResult: targetResult,
    }),
    preparedAt: parseUtcInstant("2026-08-29T12:14:00.000Z"),
  });
  const reworkPrepared = prepareDeliveryInDemandAggregateState(
    reworkRequested,
    reworkEnvelope,
  );
  equal(reworkPrepared.targetTasks[0]?.phase, "delivery-prepared");
  if (reworkPrepared.targetTasks[0]?.phase !== "delivery-prepared") {
    throw new Error("Expected rework delivery-prepared target.");
  }
  equal(reworkPrepared.targetTasks[0].currentDelivery.deliveryId, reworkDeliveryId);
  equal(reworkPrepared.targetTasks[0].currentDelivery.generation, 1);
  equal(reworkPrepared.targetTasks[0].taskPackageId, taskPackage.taskPackageId);
  throws(
    () => prepareDeliveryInDemandAggregateState(planned, reworkEnvelope),
    (error: unknown) =>
      error instanceof DemandAggregateStateError &&
      error.reason === "transition",
  );
  throws(
    () =>
      prepareDeliveryInDemandAggregateState(
        reworkRequested,
        createDeliveryEnvelopeFixture({
          claim: createWorkClaimFixture({
            claimId: THIRD_DELIVERY_CLAIM_ID,
            deliveryId: parseWakeflowDurableIdOfKind(
              "target-delivery_90909090-9090-4090-8090-909090909090",
              "target-delivery",
            ),
          }),
          deliveryId: parseWakeflowDurableIdOfKind(
            "target-delivery_90909090-9090-4090-8090-909090909090",
            "target-delivery",
          ),
          preparedAt: parseUtcInstant("2026-08-29T12:16:00.000Z"),
        }),
      ),
    (error: unknown) =>
      error instanceof DemandAggregateStateError &&
      error.reason === "transition",
  );
  throws(
    () =>
      decideTargetResultReviewInDemandAggregateState(
        resultReported,
        createControllerImplementationReviewDecisionForState(
          TASKING_AUTHORITY_DIGEST,
          "accept",
          8,
          targetResult,
        ),
      ),
    (error: unknown) =>
      error instanceof DemandAggregateStateError &&
      error.reason === "transition",
  );

  const cancelled = cancelDemandAggregateState(resultReported);
  deepEqual(cancelled, {
    ...resultReported,
    lifecycle: "cancelled",
  });
  throws(
    () => cancelDemandAggregateState(cancelled),
    (error: unknown) =>
      error instanceof DemandAggregateStateError &&
      error.reason === "transition",
  );
  throws(
    () =>
      parseDemandAggregateState({
        ...planned,
        targetTasks: [
          {
            ...planned.targetTasks[0],
            currentDelivery:
              prepared.targetTasks[0]?.phase === "delivery-prepared"
                ? prepared.targetTasks[0].currentDelivery
                : undefined,
          },
        ],
      }),
    (error: unknown) =>
      error instanceof DemandAggregateStateError && error.reason === "schema",
  );
});

test("completed终态允许零实现目标（research 的 not-applicable 闭合，§13.94 D8），未实现业务域仍不能空占位", () => {
  // 目标数量由完成转换按测试模式把关：controller-only / real-environment 仍要求至少一个已接受目标。
  equal(
    parseDemandAggregateState({
      ...createInitialDemandAggregateState(
        TASKING_DEMAND_ID,
        TASKING_AUTHORITY_DIGEST,
      ),
      lifecycle: "completed",
    }).lifecycle,
    "completed",
  );
  throws(
    () =>
      parseDemandAggregateState({
        ...createInitialDemandAggregateState(
          TASKING_DEMAND_ID,
          TASKING_AUTHORITY_DIGEST,
        ),
        delivery: { dispatchGroups: [] },
      }),
    (error: unknown) =>
      error instanceof DemandAggregateStateError && error.reason === "schema",
  );
});

test("replacement 谱系：旧目标进入 superseded，后续规划与 completed 终态只计入未被替代的目标", () => {
  const active = createInitialDemandAggregateState(
    TASKING_DEMAND_ID,
    TASKING_AUTHORITY_DIGEST,
  );
  const planned = planTargetTaskInDemandAggregateState(
    active,
    createTaskPackageFixture(),
  );
  const clock = () => TASKING_CREATED_AT;
  const replacementTargetTaskId =
    "target-task_13131313-1313-4313-8313-131313131313";
  const replacement = createTaskPackage(
    {
      ...taskPackageDraft(),
      taskPackageId: "task-package_12121212-1212-4212-8212-121212121212",
      targetTaskId: replacementTargetTaskId,
      lineage: { kind: "replacement", replacesTargetTaskId: TARGET_TASK_ID },
    },
    { clock },
  );
  // 同仓库已有未接受目标时，没有谱系的新包被拒绝。
  throws(
    () =>
      planTargetTaskInDemandAggregateState(
        planned,
        createTaskPackage(
          {
            ...taskPackageDraft(),
            taskPackageId: "task-package_12121212-1212-4212-8212-121212121212",
            targetTaskId: replacementTargetTaskId,
          },
          { clock },
        ),
      ),
    (error: unknown) =>
      error instanceof DemandAggregateStateError &&
      error.reason === "transition" &&
      error.path === "$state/targetTasks/lineage",
  );
  const replaced = planTargetTaskInDemandAggregateState(planned, replacement);
  const superseded = replaced.targetTasks.find(
    (target) => target.targetTaskId === TARGET_TASK_ID,
  );
  if (superseded?.phase !== "superseded") {
    throw new Error("Expected the replaced target to be superseded.");
  }
  equal(superseded.supersededByTargetTaskId, replacementTargetTaskId);
  equal(superseded.taskPackageId, TASK_PACKAGE_ID);
  equal(
    replaced.targetTasks.find(
      (target) => String(target.targetTaskId) === replacementTargetTaskId,
    )?.phase,
    "planned",
  );
  // 已被替代的目标不能再被替代：第三个包必须替代当前未接受的新目标。
  throws(
    () =>
      planTargetTaskInDemandAggregateState(
        replaced,
        createTaskPackage(
          {
            ...taskPackageDraft(),
            taskPackageId: "task-package_14141414-1414-4414-8414-141414141414",
            targetTaskId: "target-task_15151515-1515-4515-8515-151515151515",
            lineage: {
              kind: "replacement",
              replacesTargetTaskId: TARGET_TASK_ID,
            },
          },
          { clock },
        ),
      ),
    (error: unknown) =>
      error instanceof DemandAggregateStateError &&
      error.reason === "transition",
  );
  // completed 终态要求每个未被替代的实现目标都已接受：替代目标仍是 planned 就不能是 completed
  //（Schema 的逐目标相位约束先于关系规则拒绝，所以是 schema 而不是 relation）。
  throws(
    () =>
      parseDemandAggregateState({
        ...replaced,
        lifecycle: "completed",
      }),
    (error: unknown) =>
      error instanceof DemandAggregateStateError && error.reason === "schema",
  );
});
