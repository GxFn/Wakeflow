import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  decideDemandEventSourcingCommand,
  evolveDemandEventSourcingState,
  DemandEventSourcingDecisionError,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import { computeDemandAggregateStateDigest } from "../../../src/governance/demand/model/demand-aggregate-state.js";
import { createTargetDeliveryIntent } from "../../../src/governance/delivery/target-delivery-intent.js";
import { createTargetDeliveryReworkContext } from "../../../src/governance/delivery/target-delivery-rework-context.js";
import {
  createTaskPackageFixture,
  TARGET_TASK_ID,
  TASKING_AUTHORITY_DIGEST,
  TASKING_DEMAND_ID,
} from "../tasking/task-package.fixture.js";
import {
  createTargetDeliveryIntentFixture,
  TARGET_DELIVERY_BINDING_ID,
} from "../delivery/target-delivery-intent.fixture.js";
import { createWindowWorkClaimFixture } from "../delivery/window-work-claim.fixture.js";
import { createTargetDeliveryHostEffectObservationFixture } from "../delivery/target-delivery-host-effect-observation.fixture.js";
import { createTargetHostEffectRearmFixture } from "../delivery/target-host-effect-rearm.fixture.js";
import { createTargetResultFixture } from "../result/target-result.fixture.js";
import { createControllerImplementationReviewDecisionForState } from "../review/controller-implementation-review-decision.fixture.js";

const PUBLISHED_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_22222222-2222-4222-8222-222222222222",
  "demand-event",
);
const PLANNED_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_33333333-3333-4333-8333-333333333333",
  "demand-event",
);
const CANCELLED_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_99999999-9999-4999-8999-999999999999",
  "demand-event",
);
const DELIVERY_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_88888888-8888-4888-8888-888888888888",
  "demand-event",
);
const PUBLISHED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");
const CANCELLED_AT = parseUtcInstant("2026-08-26T11:00:00.000Z");
const IDENTITY_DIGEST = parseSha256Digest(`sha256:${"a".repeat(64)}`);
const WRONG_AUTHORITY_DIGEST = parseSha256Digest(`sha256:${"d".repeat(64)}`);

test("Demand Event Sourcing decider 只产生业务事件，持久化位置由 Store 分配", () => {
  const [published] = decideDemandEventSourcingCommand(null, {
    commandType: "publication.publish-demand",
    commandVersion: 1,
    demandId: TASKING_DEMAND_ID,
    eventId: PUBLISHED_EVENT_ID,
    recordedAt: PUBLISHED_AT,
    identityDigest: IDENTITY_DIGEST,
    authorityDigest: TASKING_AUTHORITY_DIGEST,
  });

  equal(published?.eventType, "publication.demand-published");
  equal(Object.hasOwn(published ?? {}, "eventVersion"), false);
  equal(Object.hasOwn(published ?? {}, "streamRevision"), false);
  equal(Object.hasOwn(published ?? {}, "previousEvent"), false);
  equal(Object.hasOwn(published ?? {}, "resultingStateDigest"), false);

  const active = evolveDemandEventSourcingState(null, published);
  equal(active.lifecycle, "active");

  const taskPackage = createTaskPackageFixture();
  const [planned] = decideDemandEventSourcingCommand(active, {
    commandType: "tasking.plan-target-task",
    commandVersion: 1,
    eventId: PLANNED_EVENT_ID,
    taskPackage,
  });
  equal(planned?.eventType, "tasking.target-task-planned");
  if (planned?.eventType !== "tasking.target-task-planned") {
    throw new Error("Expected target task planned event.");
  }
  deepEqual(planned.data.taskPackage, taskPackage);
  const tasking = evolveDemandEventSourcingState(active, planned);
  equal(tasking.targetTasks[0]?.targetTaskId, TARGET_TASK_ID);

  const intent = createTargetDeliveryIntentFixture();
  const [prepared] = decideDemandEventSourcingCommand(tasking, {
    commandType: "delivery.prepare-target-delivery",
    commandVersion: 1,
    eventId: DELIVERY_EVENT_ID,
    intent,
    taskPackage,
  });
  equal(prepared?.eventType, "delivery.target-delivery-prepared");
  if (prepared?.eventType !== "delivery.target-delivery-prepared") {
    throw new Error("Expected target delivery prepared event.");
  }
  equal(prepared.data.intent.intentDigest, intent.intentDigest);
  const deliveryPrepared = evolveDemandEventSourcingState(tasking, prepared);
  equal(deliveryPrepared.targetTasks[0]?.phase, "delivery-prepared");

  const claim = createWindowWorkClaimFixture(
    undefined,
    computeDemandAggregateStateDigest(deliveryPrepared),
  );
  const [claimed] = decideDemandEventSourcingCommand(deliveryPrepared, {
    commandType: "delivery.claim-target-host-effect",
    commandVersion: 1,
    claim,
  });
  equal(claimed?.eventType, "delivery.target-host-effect-claimed");
  if (claimed?.eventType !== "delivery.target-host-effect-claimed") {
    throw new Error("Expected target host effect claimed event.");
  }
  equal(claimed.eventId, claim.claimTransition.eventId);
  const hostEffectClaimed = evolveDemandEventSourcingState(
    deliveryPrepared,
    claimed,
  );
  equal(hostEffectClaimed.targetTasks[0]?.phase, "host-effect-claimed");
  const observation = createTargetDeliveryHostEffectObservationFixture({
    claim,
  });
  const [observed] = decideDemandEventSourcingCommand(hostEffectClaimed, {
    commandType: "delivery.record-target-host-effect-observation",
    commandVersion: 1,
    observation,
  });
  equal(observed?.eventType, "delivery.target-host-effect-observed");
  if (observed?.eventType !== "delivery.target-host-effect-observed") {
    throw new Error("Expected target host effect observed event.");
  }
  equal(
    observed.data.observation.observationDigest,
    observation.observationDigest,
  );
  const hostEffectObserved = evolveDemandEventSourcingState(
    hostEffectClaimed,
    observed,
  );
  equal(hostEffectObserved.targetTasks[0]?.phase, "host-effect-accepted");
  const targetResult = createTargetResultFixture({ claim, observation });
  const [resultEvent] = decideDemandEventSourcingCommand(hostEffectObserved, {
    commandType: "result.record-target-result",
    commandVersion: 1,
    result: targetResult,
  });
  equal(resultEvent?.eventType, "result.target-result-recorded");
  const resultReported = evolveDemandEventSourcingState(
    hostEffectObserved,
    resultEvent,
  );
  equal(resultReported.targetTasks[0]?.phase, "result-reported");
  const reviewDecision = createControllerImplementationReviewDecisionForState(
    computeDemandAggregateStateDigest(resultReported),
    "accept",
    8,
    targetResult,
  );
  const [reviewedEvent] = decideDemandEventSourcingCommand(resultReported, {
    commandType: "review.decide-target-result",
    commandVersion: 1,
    decision: reviewDecision,
  });
  equal(reviewedEvent?.eventType, "review.target-result-decided");
  if (reviewedEvent?.eventType !== "review.target-result-decided") {
    throw new Error("Expected target review decided event.");
  }
  equal(reviewedEvent.data.decision.decision, "accept");
  const acceptedState = evolveDemandEventSourcingState(
    resultReported,
    reviewedEvent,
  );
  equal(acceptedState.targetTasks[0]?.phase, "accepted");

  const reworkDecision = createControllerImplementationReviewDecisionForState(
    computeDemandAggregateStateDigest(resultReported),
    "rework",
    8,
    targetResult,
  );
  const [reworkDecisionEvent] = decideDemandEventSourcingCommand(
    resultReported,
    {
      commandType: "review.decide-target-result",
      commandVersion: 1,
      decision: reworkDecision,
    },
  );
  const reworkRequested = evolveDemandEventSourcingState(
    resultReported,
    reworkDecisionEvent,
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
      clock: () => parseUtcInstant("2026-08-29T12:16:00.000Z"),
    },
  );
  throws(
    () =>
      decideDemandEventSourcingCommand(reworkRequested, {
        commandType: "delivery.prepare-target-delivery",
        commandVersion: 1,
        eventId: parseWakeflowDurableIdOfKind(
          "demand-event_89898989-8989-4989-8989-898989898989",
          "demand-event",
        ),
        intent: reworkIntent,
        taskPackage,
      }),
    (error: unknown) =>
      error instanceof DemandEventSourcingDecisionError &&
      error.reason === "target-delivery-rework-context",
  );
  throws(
    () =>
      decideDemandEventSourcingCommand(reworkRequested, {
        commandType: "delivery.prepare-target-delivery",
        commandVersion: 1,
        eventId: parseWakeflowDurableIdOfKind(
          "demand-event_89898989-8989-4989-8989-898989898989",
          "demand-event",
        ),
        intent: reworkIntent,
        taskPackage,
        reworkSource: {
          decision: reviewDecision,
          previousResult: targetResult,
        },
      }),
    (error: unknown) =>
      error instanceof DemandEventSourcingDecisionError &&
      error.reason === "target-delivery-rework-context",
  );
  const [reworkPreparedEvent] = decideDemandEventSourcingCommand(
    reworkRequested,
    {
      commandType: "delivery.prepare-target-delivery",
      commandVersion: 1,
      eventId: parseWakeflowDurableIdOfKind(
        "demand-event_89898989-8989-4989-8989-898989898989",
        "demand-event",
      ),
      intent: reworkIntent,
      taskPackage,
      reworkSource: {
        decision: reworkDecision,
        previousResult: targetResult,
      },
    },
  );
  equal(reworkPreparedEvent?.eventType, "delivery.target-delivery-prepared");
  throws(
    () =>
      decideDemandEventSourcingCommand(acceptedState, {
        commandType: "review.decide-target-result",
        commandVersion: 1,
        decision: reviewDecision,
      }),
    (error: unknown) =>
      error instanceof DemandEventSourcingDecisionError &&
      error.reason === "transition",
  );
  const rejectedObservation = createTargetDeliveryHostEffectObservationFixture({
    claim,
    attemptStatus: "rejected-before-effect",
    readbackStatus: "unavailable",
  });
  const [rejectedEvent] = decideDemandEventSourcingCommand(hostEffectClaimed, {
    commandType: "delivery.record-target-host-effect-observation",
    commandVersion: 1,
    observation: rejectedObservation,
  });
  const rejectedState = evolveDemandEventSourcingState(
    hostEffectClaimed,
    rejectedEvent,
  );
  const rearm = createTargetHostEffectRearmFixture(claim, rejectedObservation);
  const [rearmedEvent] = decideDemandEventSourcingCommand(rejectedState, {
    commandType: "delivery.rearm-target-host-effect",
    commandVersion: 1,
    rearm,
  });
  equal(rearmedEvent?.eventType, "delivery.target-host-effect-rearmed");
  const rearmedState = evolveDemandEventSourcingState(
    rejectedState,
    rearmedEvent,
  );
  equal(rearmedState.targetTasks[0]?.phase, "delivery-prepared");

  throws(
    () =>
      decideDemandEventSourcingCommand(tasking, {
        commandType: "tasking.plan-target-task",
        commandVersion: 1,
        eventId: PLANNED_EVENT_ID,
        taskPackage,
      }),
    (error: unknown) =>
      error instanceof DemandEventSourcingDecisionError &&
      error.reason === "transition",
  );
  throws(
    () =>
      decideDemandEventSourcingCommand(active, {
        commandType: "tasking.plan-target-task",
        commandVersion: 1,
        eventId: PLANNED_EVENT_ID,
        taskPackage: {
          ...taskPackage,
          demandAuthorityDigest: WRONG_AUTHORITY_DIGEST,
        },
      }),
    (error: unknown) =>
      error instanceof DemandEventSourcingDecisionError &&
      error.reason === "transition",
  );

  const [cancelled] = decideDemandEventSourcingCommand(resultReported, {
    commandType: "lifecycle.cancel-demand",
    commandVersion: 1,
    demandId: TASKING_DEMAND_ID,
    eventId: CANCELLED_EVENT_ID,
    recordedAt: CANCELLED_AT,
    reason: "用户终止该 Demand",
  });
  equal(cancelled?.eventType, "lifecycle.demand-cancelled");
  const terminal = evolveDemandEventSourcingState(resultReported, cancelled);
  equal(terminal.lifecycle, "cancelled");

  throws(
    () =>
      decideDemandEventSourcingCommand(terminal, {
        commandType: "lifecycle.cancel-demand",
        commandVersion: 1,
        demandId: TASKING_DEMAND_ID,
        eventId: CANCELLED_EVENT_ID,
        recordedAt: CANCELLED_AT,
        reason: "重复终止",
      }),
    DemandEventSourcingDecisionError,
  );
});
