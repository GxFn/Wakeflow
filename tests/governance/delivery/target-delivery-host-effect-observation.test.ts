import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  createTargetDeliveryHostEffectObservation,
  parseTargetDeliveryHostEffectObservation,
  parseTargetDeliveryHostEffectObservationDocument,
  renderTargetDeliveryHostEffectObservation,
  targetDeliveryHostEffectObservationCommitId,
  targetDeliveryHostEffectDisposition,
  targetDeliveryHostEffectObservationEventId,
  TargetDeliveryHostEffectObservationError,
} from "../../../src/governance/delivery/target-delivery-host-effect-observation.js";
import { createWindowWorkClaimFixture } from "./window-work-claim.fixture.js";

const OBSERVED_AT = parseUtcInstant("2026-08-29T09:56:00.000Z");
const RAW_HANDLE = "host-private:must-not-survive";

function actionReference() {
  const claim = createWindowWorkClaimFixture();
  return Object.freeze({
    actionId: claim.claimId,
    targetDeliveryId: claim.target.targetDeliveryId,
    intentDigest: claim.target.intentDigest,
    hostId: claim.route.hostId,
    windowId: claim.route.windowId,
    bindingId: claim.route.bindingId,
    claimDigest: claim.claimDigest,
    hostObservationAuthorityDigest: claim.hostObservation.authorityDigest,
    claimEventId: claim.claimTransition.eventId,
    claimCommitId: claim.claimTransition.commitId,
    claimEventStreamRevision: claim.claimTransition.expectedStreamRevision + 1,
    claimExpectedStateDigest: claim.claimTransition.expectedStateDigest,
    issuedAt: claim.claimedAt,
  });
}

test("Target Delivery host-effect observation只持久化脱敏双轴事实", () => {
  const observation = createTargetDeliveryHostEffectObservation({
    action: actionReference(),
    attempt: {
      status: "accepted",
      evidence: { hostResult: "accepted", rawHandle: RAW_HANDLE },
    },
    readback: {
      status: "pending",
      evidence: { promptVisible: false, rawHandle: RAW_HANDLE },
    },
    observedAt: OBSERVED_AT,
  });
  equal(observation.attempt.status, "accepted");
  equal(observation.readback.status, "pending");
  equal(observation.observedAt < observation.action.issuedAt, true);
  equal(Object.hasOwn(observation.action, "workType"), false);
  equal(targetDeliveryHostEffectDisposition(observation), "accepted");
  equal(JSON.stringify(observation).includes(RAW_HANDLE), false);
  equal(Object.isFrozen(observation), true);
  equal(Object.isFrozen(observation.action), true);
  equal(
    targetDeliveryHostEffectObservationEventId(observation.action.actionId),
    `demand-event_${observation.action.actionId.slice("window_work_claim_".length)}`,
  );
  equal(
    targetDeliveryHostEffectObservationCommitId(observation.action.actionId),
    `demand-event-commit_${observation.action.actionId.slice("window_work_claim_".length)}`,
  );

  const document = renderTargetDeliveryHostEffectObservation(observation);
  equal(
    parseTargetDeliveryHostEffectObservationDocument(document)
      .observationDigest,
    observation.observationDigest,
  );
});

test("confirmed readback把indeterminate attempt提升为accepted", () => {
  const observation = createTargetDeliveryHostEffectObservation({
    action: actionReference(),
    attempt: {
      status: "indeterminate",
      evidence: { failure: "connection-closed-without-result" },
    },
    readback: {
      status: "confirmed",
      evidence: { exactPromptObserved: true },
    },
    observedAt: OBSERVED_AT,
  });
  equal(observation.attempt.status, "indeterminate");
  equal(targetDeliveryHostEffectDisposition(observation), "accepted");
});

test("Test host-effect observation保留attempt与packet fence但不保留原始证据", () => {
  const observation = createTargetDeliveryHostEffectObservation({
    action: {
      ...actionReference(),
      workType: "test",
      testAttemptId: parseWakeflowDurableIdOfKind(
        "test-attempt_44444444-4444-4444-8444-444444444444",
        "test-attempt",
      ),
      testDispatchPacketDigest: parseSha256Digest(`sha256:${"c".repeat(64)}`),
    },
    attempt: {
      status: "indeterminate",
      evidence: { rawHandle: RAW_HANDLE, result: "unknown" },
    },
    readback: { status: "unavailable" },
    observedAt: OBSERVED_AT,
  });
  equal(observation.action.workType, "test");
  equal(targetDeliveryHostEffectDisposition(observation), "indeterminate");
  equal(JSON.stringify(observation).includes(RAW_HANDLE), false);
  equal(
    parseTargetDeliveryHostEffectObservationDocument(
      renderTargetDeliveryHostEffectObservation(observation),
    ).observationDigest,
    observation.observationDigest,
  );
});

test("rejected-before-effect拒绝readback、超限证据和摘要漂移", () => {
  const rejected = createTargetDeliveryHostEffectObservation({
    action: actionReference(),
    attempt: {
      status: "rejected-before-effect",
      evidence: { hostRejection: "correlated-before-effect" },
    },
    readback: { status: "unavailable" },
    observedAt: OBSERVED_AT,
  });
  equal(
    targetDeliveryHostEffectDisposition(rejected),
    "rejected-before-effect",
  );

  throws(
    () =>
      createTargetDeliveryHostEffectObservation({
        action: actionReference(),
        attempt: {
          status: "rejected-before-effect",
          evidence: { hostRejection: true },
        },
        readback: {
          status: "confirmed",
          evidence: { exactPromptObserved: true },
        },
        observedAt: OBSERVED_AT,
      }),
    (error: unknown) =>
      error instanceof TargetDeliveryHostEffectObservationError &&
      error.reason === "relation",
  );
  throws(
    () =>
      createTargetDeliveryHostEffectObservation({
        action: actionReference(),
        attempt: {
          status: "indeterminate",
          evidence: "x".repeat(128 * 1024 + 1),
        },
        readback: { status: "unavailable" },
        observedAt: OBSERVED_AT,
      }),
    (error: unknown) =>
      error instanceof TargetDeliveryHostEffectObservationError &&
      error.reason === "capacity",
  );
  throws(
    () =>
      parseTargetDeliveryHostEffectObservation({
        ...rejected,
        observationDigest: parseSha256Digest(`sha256:${"b".repeat(64)}`),
      }),
    (error: unknown) =>
      error instanceof TargetDeliveryHostEffectObservationError &&
      error.reason === "digest",
  );
});
