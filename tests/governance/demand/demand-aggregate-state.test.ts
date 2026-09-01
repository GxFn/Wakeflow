import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { createTargetDeliveryIntent } from "../../../src/governance/delivery/target-delivery-intent.js";
import { createTargetDeliveryReworkContext } from "../../../src/governance/delivery/target-delivery-rework-context.js";

import { computeTaskPackageDigest } from "../../../src/governance/tasking/task-package.js";
import {
  cancelDemandAggregateState,
  claimTargetHostEffectInDemandAggregateState,
  computeDemandAggregateStateDigest,
  createInitialDemandAggregateState,
  decideTargetResultReviewInDemandAggregateState,
  observeTargetHostEffectInDemandAggregateState,
  prepareTargetDeliveryInDemandAggregateState,
  planTargetTaskInDemandAggregateState,
  parseDemandAggregateState,
  rearmTargetHostEffectInDemandAggregateState,
  recordTargetResultInDemandAggregateState,
  DemandAggregateStateError,
} from "../../../src/governance/demand/model/demand-aggregate-state.js";
import {
  createTaskPackageFixture,
  TARGET_TASK_ID,
  TASKING_AUTHORITY_DIGEST,
  TASKING_DEMAND_ID,
  TASKING_REPOSITORY_ID,
  TASKING_WINDOW_ID,
  TASK_PACKAGE_ID,
} from "../tasking/task-package.fixture.js";
import {
  createTargetDeliveryIntentFixture,
  TARGET_DELIVERY_BINDING_ID,
  TARGET_DELIVERY_ID,
} from "../delivery/target-delivery-intent.fixture.js";
import { createWindowWorkClaimFixture } from "../delivery/window-work-claim.fixture.js";
import { windowWorkClaimRef } from "../../../src/governance/delivery/window-work-claim-resource-catalog.js";
import { createTargetDeliveryHostEffectObservationFixture } from "../delivery/target-delivery-host-effect-observation.fixture.js";
import { createTargetHostEffectRearmFixture } from "../delivery/target-host-effect-rearm.fixture.js";
import { createTargetResultFixture } from "../result/target-result.fixture.js";
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

  const intent = createTargetDeliveryIntentFixture();
  const prepared = prepareTargetDeliveryInDemandAggregateState(planned, intent);
  deepEqual(prepared.targetTasks[0], {
    ...planned.targetTasks[0],
    phase: "delivery-prepared",
    currentDelivery: {
      targetDeliveryId: TARGET_DELIVERY_ID,
      intentDigest: intent.intentDigest,
      hostId: "codex",
      bindingId: TARGET_DELIVERY_BINDING_ID,
    },
  });
  throws(
    () => prepareTargetDeliveryInDemandAggregateState(prepared, intent),
    (error: unknown) =>
      error instanceof DemandAggregateStateError &&
      error.reason === "transition",
  );

  const claim = createWindowWorkClaimFixture(
    undefined,
    computeDemandAggregateStateDigest(prepared),
  );
  const claimed = claimTargetHostEffectInDemandAggregateState(prepared, claim);
  deepEqual(claimed.targetTasks[0], {
    ...prepared.targetTasks[0],
    phase: "host-effect-claimed",
    currentDelivery: {
      ...(prepared.targetTasks[0]?.phase === "delivery-prepared"
        ? prepared.targetTasks[0].currentDelivery
        : {}),
      workClaim: {
        claimId: claim.claimId,
        claimRef: windowWorkClaimRef(TASKING_WINDOW_ID),
        claimDigest: claim.claimDigest,
        claimedAt: claim.claimedAt,
        hostObservationAuthorityDigest: claim.hostObservation.authorityDigest,
        claimEventId: claim.claimTransition.eventId,
        claimCommitId: claim.claimTransition.commitId,
        claimEventStreamRevision:
          claim.claimTransition.expectedStreamRevision + 1,
        claimExpectedStateDigest: claim.claimTransition.expectedStateDigest,
      },
    },
  });
  throws(
    () => claimTargetHostEffectInDemandAggregateState(claimed, claim),
    (error: unknown) =>
      error instanceof DemandAggregateStateError &&
      error.reason === "transition",
  );

  const observedCases = [
    {
      attemptStatus: "accepted" as const,
      readbackStatus: "pending" as const,
      phase: "host-effect-accepted" as const,
      disposition: "accepted" as const,
      claimHandling: "retain" as const,
    },
    {
      attemptStatus: "indeterminate" as const,
      readbackStatus: "unavailable" as const,
      phase: "host-effect-indeterminate" as const,
      disposition: "indeterminate" as const,
      claimHandling: "retain" as const,
    },
    {
      attemptStatus: "rejected-before-effect" as const,
      readbackStatus: "unavailable" as const,
      phase: "host-effect-rejected" as const,
      disposition: "rejected-before-effect" as const,
      claimHandling: "release-authorized" as const,
    },
  ];
  let accepted = claimed;
  let acceptedObservation;
  let rejected = claimed;
  let rejectedObservation;
  for (const candidate of observedCases) {
    const observation = createTargetDeliveryHostEffectObservationFixture({
      claim,
      attemptStatus: candidate.attemptStatus,
      readbackStatus: candidate.readbackStatus,
    });
    const observed = observeTargetHostEffectInDemandAggregateState(
      claimed,
      observation,
    );
    equal(observed.targetTasks[0]?.phase, candidate.phase);
    const current = observed.targetTasks[0];
    if (
      current?.phase !== "host-effect-accepted" &&
      current?.phase !== "host-effect-indeterminate" &&
      current?.phase !== "host-effect-rejected"
    ) {
      throw new Error("Expected observed host effect state.");
    }
    equal(
      current.currentDelivery.hostEffect.disposition,
      candidate.disposition,
    );
    equal(
      current.currentDelivery.hostEffect.claimHandling,
      candidate.claimHandling,
    );
    if (current.phase === "host-effect-accepted") {
      accepted = observed;
      acceptedObservation = observation;
    }
    if (current.phase === "host-effect-rejected") {
      rejected = observed;
      rejectedObservation = observation;
    }
  }

  if (rejectedObservation === undefined) {
    throw new Error("Expected rejected observation fixture.");
  }
  const rearm = createTargetHostEffectRearmFixture(claim, rejectedObservation);
  const rearmed = rearmTargetHostEffectInDemandAggregateState(rejected, rearm);
  equal(rearmed.targetTasks[0]?.phase, "delivery-prepared");
  throws(
    () => rearmTargetHostEffectInDemandAggregateState(accepted, rearm),
    (error: unknown) =>
      error instanceof DemandAggregateStateError &&
      error.reason === "transition",
  );

  if (acceptedObservation === undefined) {
    throw new Error("Expected accepted observation fixture.");
  }
  const targetResult = createTargetResultFixture({
    claim,
    observation: acceptedObservation,
  });
  const resultReported = recordTargetResultInDemandAggregateState(
    accepted,
    targetResult,
  );
  equal(resultReported.targetTasks[0]?.phase, "result-reported");
  const reportedTarget = resultReported.targetTasks[0];
  if (reportedTarget?.phase !== "result-reported") {
    throw new Error("Expected result-reported target.");
  }
  equal(reportedTarget.currentDelivery.targetResult.outcome, "completed");
  equal(
    reportedTarget.currentDelivery.targetResult.claimHandling,
    "release-authorized",
  );

  for (const candidate of [
    { decision: "accept" as const, phase: "accepted" as const },
    { decision: "rework" as const, phase: "rework-requested" as const },
    { decision: "redesign" as const, phase: "redesign-requested" as const },
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
      target?.phase !== "redesign-requested" &&
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
  const reworkIntent = createTargetDeliveryIntent(
    {
      targetDeliveryId: parseWakeflowDurableIdOfKind(
        "target-delivery_89898989-8989-4989-8989-898989898989",
        "target-delivery",
      ),
      taskPackage,
      hostId: "codex",
      bindingId: TARGET_DELIVERY_BINDING_ID,
      language: "zh-Hans",
      rework: createTargetDeliveryReworkContext({
        decision: reworkDecision,
        previousResult: targetResult,
      }),
    },
    {
      clock: () => parseUtcInstant("2026-08-29T12:14:00.000Z"),
    },
  );
  const reworkPrepared = prepareTargetDeliveryInDemandAggregateState(
    reworkRequested,
    reworkIntent,
  );
  equal(reworkPrepared.targetTasks[0]?.phase, "delivery-prepared");
  if (reworkPrepared.targetTasks[0]?.phase !== "delivery-prepared") {
    throw new Error("Expected rework delivery-prepared target.");
  }
  equal(
    reworkPrepared.targetTasks[0].currentDelivery.targetDeliveryId,
    reworkIntent.targetDeliveryId,
  );
  equal(reworkPrepared.targetTasks[0].taskPackageId, taskPackage.taskPackageId);
  throws(
    () => prepareTargetDeliveryInDemandAggregateState(planned, reworkIntent),
    (error: unknown) =>
      error instanceof DemandAggregateStateError &&
      error.reason === "transition",
  );
  throws(
    () =>
      prepareTargetDeliveryInDemandAggregateState(
        reworkRequested,
        createTargetDeliveryIntent(
          {
            targetDeliveryId: parseWakeflowDurableIdOfKind(
              "target-delivery_90909090-9090-4090-8090-909090909090",
              "target-delivery",
            ),
            taskPackage,
            hostId: "codex",
            bindingId: TARGET_DELIVERY_BINDING_ID,
            language: "zh-Hans",
          },
          {
            clock: () => parseUtcInstant("2026-08-29T12:16:00.000Z"),
          },
        ),
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

test("completed终态需要accepted目标，未实现业务域仍不能空占位", () => {
  throws(
    () =>
      parseDemandAggregateState({
        ...createInitialDemandAggregateState(
          TASKING_DEMAND_ID,
          TASKING_AUTHORITY_DIGEST,
        ),
        lifecycle: "completed",
      }),
    (error: unknown) =>
      error instanceof DemandAggregateStateError && error.reason === "schema",
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
