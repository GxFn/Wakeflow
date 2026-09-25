import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  upcastDemandEventSourcingStoredEvent,
  DemandEventSourcingUpcasterError,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-upcaster.js";
import { encodeCurrentDemandEventVersion } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-event-version-codec.js";
import { projectTargetDeliveryProductDefectRemediationContext } from "../../../src/governance/delivery/delivery-envelope.js";
import { createTargetDeliveryReworkContext } from "../../../src/governance/delivery/target-delivery-rework-context.js";
import {
  createTaskPackageFixture,
  TASKING_DEMAND_ID,
} from "../tasking/task-package.fixture.js";
import {
  createDeliveryEnvelopeFixture,
  createDeliveryOutcomeFixture,
  createDeliveryRearmFixture,
  createWorkClaimFixture,
  OTHER_DELIVERY_CLAIM_ID,
  THIRD_DELIVERY_CLAIM_ID,
} from "../delivery/delivery-records.fixture.js";
import { targetResultRecordedEventIdFromResult } from "../../../src/governance/result/target-result.js";
import {
  createTargetResultCallbackFixture,
  createTargetResultFixture,
} from "../result/target-result.fixture.js";
import { controllerReviewDecisionEventId } from "../../../src/governance/review/controller-review-decision.js";
import { createControllerImplementationReviewDecisionFixture } from "../review/controller-implementation-review-decision.fixture.js";

const EVENT = Object.freeze({
  artifactKind: "wakeflow-demand-event-sourcing-event" as const,
  schemaVersion: 1 as const,
  eventId: parseWakeflowDurableIdOfKind(
    "demand-event_11111111-1111-4111-8111-111111111111",
    "demand-event",
  ),
  demandId: parseWakeflowDurableIdOfKind(
    "demand_22222222-2222-4222-8222-222222222222",
    "demand",
  ),
  streamRevision: 1,
  recordedAt: parseUtcInstant("2026-08-26T10:00:00.000Z"),
  eventType: "publication.demand-published" as const,
  eventVersion: 1 as const,
  data: Object.freeze({
    identityRef: "identity.json" as const,
    identityDigest: parseSha256Digest(`sha256:${"a".repeat(64)}`),
    authorityRef: "authority.json" as const,
    authorityDigest: parseSha256Digest(`sha256:${"b".repeat(64)}`),
  }),
  resultingStateModelVersion: 1,
  resultingStateDigest: parseSha256Digest(`sha256:${"c".repeat(64)}`),
});

test("Demand Event Sourcing upcaster 显式路由 eventType + eventVersion", () => {
  const current = upcastDemandEventSourcingStoredEvent(EVENT);
  equal(current.eventType, "publication.demand-published");
  equal(Object.hasOwn(current, "streamRevision"), false);
  equal(Object.hasOwn(current, "eventVersion"), false);

  const cancelled = upcastDemandEventSourcingStoredEvent({
    ...EVENT,
    eventType: "lifecycle.demand-cancelled",
    data: { reason: "用户终止该 Demand" },
  });
  equal(cancelled.eventType, "lifecycle.demand-cancelled");
  if (cancelled.eventType === "lifecycle.demand-cancelled") {
    equal(cancelled.data.reason, "用户终止该 Demand");
  }

  const taskPackage = createTaskPackageFixture();
  const planned = upcastDemandEventSourcingStoredEvent({
    ...EVENT,
    demandId: TASKING_DEMAND_ID,
    recordedAt: taskPackage.createdAt,
    eventType: "tasking.target-task-planned",
    data: { taskPackage },
  });
  equal(planned.eventType, "tasking.target-task-planned");
  if (planned.eventType === "tasking.target-task-planned") {
    equal(planned.data.taskPackage.taskPackageId, taskPackage.taskPackageId);
  }
  throws(
    () =>
      upcastDemandEventSourcingStoredEvent({
        ...EVENT,
        demandId: TASKING_DEMAND_ID,
        eventType: "tasking.target-task-planned",
        data: { taskPackage },
      }),
    (error: unknown) =>
      error instanceof DemandEventSourcingUpcasterError &&
      error.reason === "event",
  );

  const claim = createWorkClaimFixture();
  const envelope = createDeliveryEnvelopeFixture({ claim });
  const prepared = upcastDemandEventSourcingStoredEvent({
    ...EVENT,
    demandId: TASKING_DEMAND_ID,
    recordedAt: envelope.preparedAt,
    eventType: "delivery.delivery-prepared",
    data: { envelope },
  });
  equal(prepared.eventType, "delivery.delivery-prepared");
  if (prepared.eventType === "delivery.delivery-prepared") {
    equal(prepared.data.envelope.deliveryId, envelope.deliveryId);
  }

  const previousResult = createTargetResultFixture();
  const reworkDecision =
    createControllerImplementationReviewDecisionFixture("rework");
  const reworkDeliveryId = parseWakeflowDurableIdOfKind(
    "target-delivery_89898989-8989-4989-8989-898989898989",
    "target-delivery",
  );
  const reworkEnvelope = createDeliveryEnvelopeFixture({
    claim: createWorkClaimFixture({
      claimId: OTHER_DELIVERY_CLAIM_ID,
      deliveryId: reworkDeliveryId,
    }),
    deliveryId: reworkDeliveryId,
    rework: createTargetDeliveryReworkContext({
      decision: reworkDecision,
      previousResult,
    }),
    preparedAt: parseUtcInstant("2026-08-29T12:16:00.000Z"),
  });
  const preparedRework = upcastDemandEventSourcingStoredEvent({
    ...EVENT,
    demandId: TASKING_DEMAND_ID,
    streamRevision: 9,
    recordedAt: reworkEnvelope.preparedAt,
    eventType: "delivery.delivery-prepared",
    eventVersion: 1,
    data: { envelope: reworkEnvelope },
  });
  equal(preparedRework.eventType, "delivery.delivery-prepared");
  if (preparedRework.eventType === "delivery.delivery-prepared") {
    equal(
      preparedRework.data.envelope.rework?.decision.targetReviewDecisionId,
      reworkDecision.targetReviewDecisionId,
    );
  }
  const encodedPrepared = encodeCurrentDemandEventVersion({
    eventId: EVENT.eventId,
    demandId: TASKING_DEMAND_ID,
    recordedAt: reworkEnvelope.preparedAt,
    eventType: "delivery.delivery-prepared",
    data: { envelope: reworkEnvelope },
  });
  equal(encodedPrepared.eventVersion, 1);
  throws(
    () =>
      upcastDemandEventSourcingStoredEvent({
        ...EVENT,
        demandId: TASKING_DEMAND_ID,
        streamRevision: 9,
        recordedAt: reworkEnvelope.preparedAt,
        eventType: "delivery.delivery-prepared",
        eventVersion: 2,
        data: { envelope: reworkEnvelope },
      }),
    (error: unknown) =>
      error instanceof DemandEventSourcingUpcasterError &&
      error.reason === "unsupported-version",
  );

  const remediationDeliveryId = parseWakeflowDurableIdOfKind(
    "target-delivery_90909090-9090-4090-8090-909090909090",
    "target-delivery",
  );
  const remediationEnvelope = createDeliveryEnvelopeFixture({
    claim: createWorkClaimFixture({
      claimId: THIRD_DELIVERY_CLAIM_ID,
      deliveryId: remediationDeliveryId,
    }),
    deliveryId: remediationDeliveryId,
    productDefectRemediation:
      projectTargetDeliveryProductDefectRemediationContext({
        authorization: {
          productDefectRemediationId: parseWakeflowDurableIdOfKind(
            "product-defect-remediation_91919191-9191-4191-8191-919191919191",
            "product-defect-remediation",
          ),
          authorizationDigest: parseSha256Digest(`sha256:${"8".repeat(64)}`),
        },
        testReviewDecision: {
          targetReviewDecisionId: parseWakeflowDurableIdOfKind(
            "target-review-decision_92929292-9292-4292-8292-929292929292",
            "target-review-decision",
          ),
          decisionDigest: parseSha256Digest(`sha256:${"9".repeat(64)}`),
        },
        previousResult: {
          targetResultId: previousResult.targetResultId,
          resultDigest: previousResult.resultDigest,
        },
        authorizationRationale: "真实环境Evidence证明产品缺陷。",
        correctionObjective: "在原TaskPackage内修复产品行为。",
        requiredCorrections: [{ stepId: "ts-1", observed: "产品行为不符合冻结目标。" }],
      }),
    preparedAt: parseUtcInstant("2026-08-29T12:17:00.000Z"),
  });
  const preparedRemediation = upcastDemandEventSourcingStoredEvent({
    ...EVENT,
    demandId: TASKING_DEMAND_ID,
    streamRevision: 10,
    recordedAt: remediationEnvelope.preparedAt,
    eventType: "delivery.delivery-prepared",
    data: { envelope: remediationEnvelope },
  });
  equal(preparedRemediation.eventType, "delivery.delivery-prepared");
  throws(
    () =>
      upcastDemandEventSourcingStoredEvent({
        ...EVENT,
        demandId: TASKING_DEMAND_ID,
        streamRevision: 10,
        recordedAt: remediationEnvelope.preparedAt,
        eventType: "delivery.delivery-prepared",
        data: {
          envelope: { ...remediationEnvelope, rework: reworkEnvelope.rework },
        },
      }),
    (error: unknown) =>
      error instanceof DemandEventSourcingUpcasterError &&
      error.reason === "codec",
  );

  const outcome = createDeliveryOutcomeFixture({ claim, envelope });
  const observed = upcastDemandEventSourcingStoredEvent({
    ...EVENT,
    demandId: envelope.demandId,
    streamRevision: 4,
    recordedAt: outcome.observedAt,
    eventType: "delivery.delivery-outcome-recorded",
    data: { outcome },
  });
  equal(observed.eventType, "delivery.delivery-outcome-recorded");
  if (observed.eventType === "delivery.delivery-outcome-recorded") {
    equal(observed.data.outcome.outcomeDigest, outcome.outcomeDigest);
  }

  const rejectedOutcome = createDeliveryOutcomeFixture({
    claim,
    envelope,
    disposition: "rejected-before-send",
    readbackStatus: "unavailable",
  });
  const rearm = createDeliveryRearmFixture(envelope, rejectedOutcome);
  const rearmed = upcastDemandEventSourcingStoredEvent({
    ...EVENT,
    demandId: envelope.demandId,
    streamRevision: 5,
    recordedAt: rearm.rearmedAt,
    eventType: "delivery.delivery-rearmed",
    data: { rearm },
  });
  equal(rearmed.eventType, "delivery.delivery-rearmed");
  if (rearmed.eventType === "delivery.delivery-rearmed") {
    equal(rearmed.data.rearm.rearmDigest, rearm.rearmDigest);
  }

  const targetResult = createTargetResultFixture({ claim, envelope, outcome });
  const callback = createTargetResultCallbackFixture(targetResult);
  const resultEvent = upcastDemandEventSourcingStoredEvent({
    ...EVENT,
    eventId: targetResultRecordedEventIdFromResult(targetResult),
    demandId: targetResult.demandId,
    streamRevision: 6,
    recordedAt: targetResult.report.reportedAt,
    eventType: "result.target-result-recorded",
    data: { result: targetResult, callback, evidenceResolution: [] },
  });
  equal(resultEvent.eventType, "result.target-result-recorded");
  if (resultEvent.eventType === "result.target-result-recorded") {
    equal(resultEvent.data.result.resultDigest, targetResult.resultDigest);
    equal(resultEvent.data.callback.callbackId, callback.callbackId);
  }
  const reissued = upcastDemandEventSourcingStoredEvent({
    ...EVENT,
    demandId: targetResult.demandId,
    streamRevision: 7,
    recordedAt: parseUtcInstant("2026-08-29T10:10:00.000Z"),
    eventType: "result.callback-reissued",
    data: {
      reissue: {
        targetResultId: targetResult.targetResultId,
        callbackId: callback.callbackId,
        previousGeneration: 1,
        generation: 2,
        controllerWindowId: callback.controllerWindowId,
        bindingId: callback.bindingId,
        bindingDigest: callback.bindingDigest,
        promptDigest: callback.promptDigest,
        issuedAt: parseUtcInstant("2026-08-29T10:10:00.000Z"),
      },
    },
  });
  equal(reissued.eventType, "result.callback-reissued");
  if (reissued.eventType === "result.callback-reissued") {
    equal(reissued.data.reissue.generation, 2);
  }

  const reviewDecision = createControllerImplementationReviewDecisionFixture();
  const decided = upcastDemandEventSourcingStoredEvent({
    ...EVENT,
    eventId: controllerReviewDecisionEventId(reviewDecision),
    demandId: reviewDecision.demandId,
    streamRevision: reviewDecision.reviewed.streamRevision + 1,
    recordedAt: reviewDecision.decidedAt,
    eventType: "review.target-result-decided",
    data: { decision: reviewDecision },
  });
  equal(decided.eventType, "review.target-result-decided");
  if (decided.eventType === "review.target-result-decided") {
    equal(decided.data.decision.decisionDigest, reviewDecision.decisionDigest);
  }
  throws(
    () =>
      upcastDemandEventSourcingStoredEvent({
        ...EVENT,
        demandId: reviewDecision.demandId,
        streamRevision: reviewDecision.reviewed.streamRevision + 1,
        recordedAt: reviewDecision.decidedAt,
        eventType: "review.target-result-decided",
        data: { decision: reviewDecision },
      }),
    (error: unknown) =>
      error instanceof DemandEventSourcingUpcasterError &&
      error.reason === "event",
  );

  throws(
    () => upcastDemandEventSourcingStoredEvent({ ...EVENT, eventVersion: 2 }),
    (error: unknown) =>
      error instanceof DemandEventSourcingUpcasterError &&
      error.reason === "unsupported-version",
  );
  throws(
    () => upcastDemandEventSourcingStoredEvent({ ...EVENT, streamRevision: 0 }),
    (error: unknown) =>
      error instanceof DemandEventSourcingUpcasterError &&
      error.reason === "input",
  );
  throws(
    () =>
      upcastDemandEventSourcingStoredEvent({
        ...EVENT,
        eventType: "future.demand-reopened",
      }),
    (error: unknown) =>
      error instanceof DemandEventSourcingUpcasterError &&
      error.reason === "unsupported-event-type",
  );
  throws(
    () =>
      upcastDemandEventSourcingStoredEvent({
        ...EVENT,
        data: { ...EVENT.data, extra: true },
      }),
    (error: unknown) =>
      error instanceof DemandEventSourcingUpcasterError &&
      error.reason === "codec",
  );
});
