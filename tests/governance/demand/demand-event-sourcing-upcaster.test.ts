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
import {
  createTargetDeliveryIntent,
  projectTargetDeliveryProductDefectRemediationContext,
} from "../../../src/governance/delivery/target-delivery-intent.js";
import { createTargetDeliveryReworkContext } from "../../../src/governance/delivery/target-delivery-rework-context.js";
import {
  createTaskPackageFixture,
  TASKING_DEMAND_ID,
} from "../tasking/task-package.fixture.js";
import {
  createTargetDeliveryIntentFixture,
  TARGET_DELIVERY_BINDING_ID,
} from "../delivery/target-delivery-intent.fixture.js";
import { createWindowWorkClaimFixture } from "../delivery/window-work-claim.fixture.js";
import { targetDeliveryHostEffectObservationEventId } from "../../../src/governance/delivery/target-delivery-host-effect-observation.js";
import { createTargetDeliveryHostEffectObservationFixture } from "../delivery/target-delivery-host-effect-observation.fixture.js";
import { targetHostEffectRearmEventId } from "../../../src/governance/delivery/target-host-effect-rearm.js";
import { createTargetHostEffectRearmFixture } from "../delivery/target-host-effect-rearm.fixture.js";
import { targetResultRecordedEventIdFromResult } from "../../../src/governance/result/target-result.js";
import { createTargetResultFixture } from "../result/target-result.fixture.js";
import { controllerImplementationReviewDecisionEventId } from "../../../src/governance/review/controller-implementation-review-decision.js";
import { createControllerImplementationReviewDecisionFixture } from "../review/controller-implementation-review-decision.fixture.js";
import { controllerTargetReviewResumeEventId } from "../../../src/governance/review/controller-target-review-resume.js";
import { createControllerTargetReviewResumeFixture } from "../review/controller-target-review-resume.fixture.js";

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

  const intent = createTargetDeliveryIntentFixture();
  const prepared = upcastDemandEventSourcingStoredEvent({
    ...EVENT,
    demandId: TASKING_DEMAND_ID,
    recordedAt: intent.preparedAt,
    eventType: "delivery.target-delivery-prepared",
    data: { intent },
  });
  equal(prepared.eventType, "delivery.target-delivery-prepared");
  if (prepared.eventType === "delivery.target-delivery-prepared") {
    equal(prepared.data.intent.targetDeliveryId, intent.targetDeliveryId);
  }

  const previousResult = createTargetResultFixture();
  const reworkDecision =
    createControllerImplementationReviewDecisionFixture("rework");
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
        previousResult,
      }),
    },
    {
      clock: () => parseUtcInstant("2026-08-29T12:16:00.000Z"),
    },
  );
  const preparedV2 = upcastDemandEventSourcingStoredEvent({
    ...EVENT,
    demandId: TASKING_DEMAND_ID,
    streamRevision: 9,
    recordedAt: reworkIntent.preparedAt,
    eventType: "delivery.target-delivery-prepared",
    eventVersion: 2,
    data: { intent: reworkIntent },
  });
  equal(preparedV2.eventType, "delivery.target-delivery-prepared");
  if (preparedV2.eventType === "delivery.target-delivery-prepared") {
    equal(
      preparedV2.data.intent.rework?.decision.targetReviewDecisionId,
      reworkDecision.targetReviewDecisionId,
    );
  }
  const encodedPreparedV3 = encodeCurrentDemandEventVersion({
    eventId: EVENT.eventId,
    demandId: TASKING_DEMAND_ID,
    recordedAt: reworkIntent.preparedAt,
    eventType: "delivery.target-delivery-prepared",
    data: { intent: reworkIntent },
  });
  equal(encodedPreparedV3.eventVersion, 3);
  throws(
    () =>
      upcastDemandEventSourcingStoredEvent({
        ...EVENT,
        demandId: TASKING_DEMAND_ID,
        streamRevision: 9,
        recordedAt: reworkIntent.preparedAt,
        eventType: "delivery.target-delivery-prepared",
        eventVersion: 1,
        data: { intent: reworkIntent },
      }),
    (error: unknown) =>
      error instanceof DemandEventSourcingUpcasterError &&
      error.reason === "codec",
  );

  const remediationIntent = createTargetDeliveryIntent(
    {
      targetDeliveryId: parseWakeflowDurableIdOfKind(
        "target-delivery_90909090-9090-4090-8090-909090909090",
        "target-delivery",
      ),
      taskPackage,
      hostId: "codex",
      bindingId: TARGET_DELIVERY_BINDING_ID,
      language: "zh-Hans",
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
          requiredCorrections: [
            {
              checkId: "product-defect",
              outcome: "failed",
              method: "复验真实入口。",
              observation: "产品行为不符合冻结目标。",
            },
          ],
        }),
    },
    {
      clock: () => parseUtcInstant("2026-08-29T12:17:00.000Z"),
    },
  );
  const preparedV3 = upcastDemandEventSourcingStoredEvent({
    ...EVENT,
    demandId: TASKING_DEMAND_ID,
    streamRevision: 10,
    recordedAt: remediationIntent.preparedAt,
    eventType: "delivery.target-delivery-prepared",
    eventVersion: 3,
    data: { intent: remediationIntent },
  });
  equal(preparedV3.eventType, "delivery.target-delivery-prepared");
  throws(
    () =>
      upcastDemandEventSourcingStoredEvent({
        ...EVENT,
        demandId: TASKING_DEMAND_ID,
        streamRevision: 10,
        recordedAt: remediationIntent.preparedAt,
        eventType: "delivery.target-delivery-prepared",
        eventVersion: 2,
        data: { intent: remediationIntent },
      }),
    (error: unknown) =>
      error instanceof DemandEventSourcingUpcasterError &&
      error.reason === "codec",
  );

  const claim = createWindowWorkClaimFixture();
  const claimed = upcastDemandEventSourcingStoredEvent({
    ...EVENT,
    eventId: claim.claimTransition.eventId,
    demandId: claim.target.demandId,
    streamRevision: 4,
    recordedAt: claim.claimedAt,
    eventType: "delivery.target-host-effect-claimed",
    data: { claim },
  });
  equal(claimed.eventType, "delivery.target-host-effect-claimed");
  if (claimed.eventType === "delivery.target-host-effect-claimed") {
    equal(claimed.data.claim.claimId, claim.claimId);
  }

  const observation = createTargetDeliveryHostEffectObservationFixture({
    claim,
  });
  const observed = upcastDemandEventSourcingStoredEvent({
    ...EVENT,
    eventId: targetDeliveryHostEffectObservationEventId(claim.claimId),
    demandId: claim.target.demandId,
    streamRevision: 5,
    recordedAt: observation.observedAt,
    eventType: "delivery.target-host-effect-observed",
    data: { observation },
  });
  equal(observed.eventType, "delivery.target-host-effect-observed");
  if (observed.eventType === "delivery.target-host-effect-observed") {
    equal(
      observed.data.observation.observationDigest,
      observation.observationDigest,
    );
  }

  const rejectedObservation = createTargetDeliveryHostEffectObservationFixture({
    claim,
    attemptStatus: "rejected-before-effect",
    readbackStatus: "unavailable",
  });
  const rearm = createTargetHostEffectRearmFixture(claim, rejectedObservation);
  const rearmed = upcastDemandEventSourcingStoredEvent({
    ...EVENT,
    eventId: targetHostEffectRearmEventId(rearm),
    demandId: claim.target.demandId,
    streamRevision: 6,
    recordedAt: rearm.rearmedAt,
    eventType: "delivery.target-host-effect-rearmed",
    data: { rearm },
  });
  equal(rearmed.eventType, "delivery.target-host-effect-rearmed");
  if (rearmed.eventType === "delivery.target-host-effect-rearmed") {
    equal(rearmed.data.rearm.rearmDigest, rearm.rearmDigest);
  }

  const targetResult = createTargetResultFixture({
    claim,
    observation,
  });
  const resultEvent = upcastDemandEventSourcingStoredEvent({
    ...EVENT,
    eventId: targetResultRecordedEventIdFromResult(targetResult),
    demandId: targetResult.demandId,
    streamRevision: 6,
    recordedAt: targetResult.report.reportedAt,
    eventType: "result.target-result-recorded",
    data: { result: targetResult },
  });
  equal(resultEvent.eventType, "result.target-result-recorded");
  if (resultEvent.eventType === "result.target-result-recorded") {
    equal(resultEvent.data.result.resultDigest, targetResult.resultDigest);
  }

  const reviewDecision = createControllerImplementationReviewDecisionFixture();
  const decided = upcastDemandEventSourcingStoredEvent({
    ...EVENT,
    eventId: controllerImplementationReviewDecisionEventId(reviewDecision),
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

  const reviewResume = createControllerTargetReviewResumeFixture();
  const resumed = upcastDemandEventSourcingStoredEvent({
    ...EVENT,
    eventId: controllerTargetReviewResumeEventId(reviewResume),
    demandId: reviewResume.demandId,
    streamRevision: reviewResume.blockedSource.streamRevision + 1,
    recordedAt: reviewResume.resumedAt,
    eventType: "review.target-result-resumed",
    data: { resume: reviewResume },
  });
  equal(resumed.eventType, "review.target-result-resumed");
  if (resumed.eventType === "review.target-result-resumed") {
    equal(resumed.data.resume.resumeDigest, reviewResume.resumeDigest);
  }

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
