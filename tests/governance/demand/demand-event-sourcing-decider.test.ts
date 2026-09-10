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
import { createTargetDeliveryReworkContext } from "../../../src/governance/delivery/target-delivery-rework-context.js";
import {
  createTaskPackageFixture,
  TARGET_TASK_ID,
  TASKING_AUTHORITY_DIGEST,
  TASKING_DEMAND_ID,
} from "../tasking/task-package.fixture.js";
import {
  createDeliveryEnvelopeFixture,
  createDeliveryOutcomeFixture,
  createDeliveryRearmFixture,
  createWorkClaimFixture,
  OTHER_DELIVERY_CLAIM_ID,
} from "../delivery/delivery-records.fixture.js";
import {
  createTargetResultCallbackFixture,
  createTargetResultFixture,
} from "../result/target-result.fixture.js";
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
const OUTCOME_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  "demand-event",
);
const REJECTED_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  "demand-event",
);
const REARM_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3",
  "demand-event",
);
const REWORK_DELIVERY_ID = parseWakeflowDurableIdOfKind(
  "target-delivery_89898989-8989-4989-8989-898989898989",
  "target-delivery",
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

  const claim = createWorkClaimFixture();
  const envelope = createDeliveryEnvelopeFixture({ claim });
  const [prepared] = decideDemandEventSourcingCommand(tasking, {
    commandType: "delivery.prepare-delivery",
    commandVersion: 1,
    eventId: DELIVERY_EVENT_ID,
    envelope,
    taskPackage,
  });
  equal(prepared?.eventType, "delivery.delivery-prepared");
  if (prepared?.eventType !== "delivery.delivery-prepared") {
    throw new Error("Expected delivery prepared event.");
  }
  equal(prepared.data.envelope.envelopeDigest, envelope.envelopeDigest);
  equal(prepared.recordedAt, envelope.preparedAt);
  const deliveryPrepared = evolveDemandEventSourcingState(tasking, prepared);
  equal(deliveryPrepared.targetTasks[0]?.phase, "delivery-prepared");

  const outcome = createDeliveryOutcomeFixture({ claim, envelope });
  const [observed] = decideDemandEventSourcingCommand(deliveryPrepared, {
    commandType: "delivery.record-delivery-outcome",
    commandVersion: 1,
    eventId: OUTCOME_EVENT_ID,
    outcome,
  });
  equal(observed?.eventType, "delivery.delivery-outcome-recorded");
  if (observed?.eventType !== "delivery.delivery-outcome-recorded") {
    throw new Error("Expected delivery outcome recorded event.");
  }
  equal(observed.data.outcome.outcomeDigest, outcome.outcomeDigest);
  const hostEffectObserved = evolveDemandEventSourcingState(
    deliveryPrepared,
    observed,
  );
  equal(hostEffectObserved.targetTasks[0]?.phase, "host-effect-accepted");
  const targetResult = createTargetResultFixture({ claim, envelope, outcome });
  const [resultEvent] = decideDemandEventSourcingCommand(hostEffectObserved, {
    commandType: "result.record-target-result",
    commandVersion: 1,
    result: targetResult,
    callback: createTargetResultCallbackFixture(targetResult),
    evidenceResolution: [],
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
  const reworkEnvelope = createDeliveryEnvelopeFixture({
    claim: createWorkClaimFixture({
      claimId: OTHER_DELIVERY_CLAIM_ID,
      deliveryId: REWORK_DELIVERY_ID,
    }),
    deliveryId: REWORK_DELIVERY_ID,
    rework: createTargetDeliveryReworkContext({
      decision: reworkDecision,
      previousResult: targetResult,
    }),
    preparedAt: parseUtcInstant("2026-08-29T12:16:00.000Z"),
  });
  throws(
    () =>
      decideDemandEventSourcingCommand(reworkRequested, {
        commandType: "delivery.prepare-delivery",
        commandVersion: 1,
        eventId: parseWakeflowDurableIdOfKind(
          "demand-event_89898989-8989-4989-8989-898989898989",
          "demand-event",
        ),
        envelope: reworkEnvelope,
        taskPackage,
      }),
    (error: unknown) =>
      error instanceof DemandEventSourcingDecisionError &&
      error.reason === "target-delivery-rework-context",
  );
  throws(
    () =>
      decideDemandEventSourcingCommand(reworkRequested, {
        commandType: "delivery.prepare-delivery",
        commandVersion: 1,
        eventId: parseWakeflowDurableIdOfKind(
          "demand-event_89898989-8989-4989-8989-898989898989",
          "demand-event",
        ),
        envelope: reworkEnvelope,
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
      commandType: "delivery.prepare-delivery",
      commandVersion: 1,
      eventId: parseWakeflowDurableIdOfKind(
        "demand-event_89898989-8989-4989-8989-898989898989",
        "demand-event",
      ),
      envelope: reworkEnvelope,
      taskPackage,
      reworkSource: {
        decision: reworkDecision,
        previousResult: targetResult,
      },
    },
  );
  equal(reworkPreparedEvent?.eventType, "delivery.delivery-prepared");
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
  const rejectedOutcome = createDeliveryOutcomeFixture({
    claim,
    envelope,
    disposition: "rejected-before-send",
    readbackStatus: "unavailable",
  });
  const [rejectedEvent] = decideDemandEventSourcingCommand(deliveryPrepared, {
    commandType: "delivery.record-delivery-outcome",
    commandVersion: 1,
    eventId: REJECTED_EVENT_ID,
    outcome: rejectedOutcome,
  });
  const rejectedState = evolveDemandEventSourcingState(
    deliveryPrepared,
    rejectedEvent,
  );
  equal(rejectedState.targetTasks[0]?.phase, "host-effect-rejected");
  const rearm = createDeliveryRearmFixture(envelope, rejectedOutcome);
  const [rearmedEvent] = decideDemandEventSourcingCommand(rejectedState, {
    commandType: "delivery.rearm-delivery",
    commandVersion: 1,
    eventId: REARM_EVENT_ID,
    rearm,
  });
  equal(rearmedEvent?.eventType, "delivery.delivery-rearmed");
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
