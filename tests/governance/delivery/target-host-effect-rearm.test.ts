import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  parseTargetHostEffectRearm,
  parseTargetHostEffectRearmDocument,
  renderTargetHostEffectRearm,
  targetHostEffectRearmCommitId,
  targetHostEffectRearmEventId,
  TargetHostEffectRearmError,
} from "../../../src/governance/delivery/target-host-effect-rearm.js";
import { createTargetDeliveryHostEffectObservationFixture } from "./target-delivery-host-effect-observation.fixture.js";
import { createWindowWorkClaimFixture } from "./window-work-claim.fixture.js";
import { createTargetHostEffectRearmFixture } from "./target-host-effect-rearm.fixture.js";

test("Target Host Effect Rearm绑定精确rejected尾部并派生稳定Event身份", () => {
  const claim = createWindowWorkClaimFixture();
  const observation = createTargetDeliveryHostEffectObservationFixture({
    claim,
    attemptStatus: "rejected-before-effect",
    readbackStatus: "unavailable",
  });
  const rearm = createTargetHostEffectRearmFixture(claim, observation);
  equal(rearm.rejectedAttempt.claimId, claim.claimId);
  equal(rearm.rejectedAttempt.observationDigest, observation.observationDigest);
  equal(rearm.rearmedAt < observation.observedAt, true);
  equal(
    targetHostEffectRearmEventId(rearm),
    `demand-event_${claim.claimTransition.commitId.slice("demand-event-commit_".length)}`,
  );
  equal(
    targetHostEffectRearmCommitId(rearm),
    `demand-event-commit_${claim.claimTransition.eventId.slice("demand-event_".length)}`,
  );
  const document = renderTargetHostEffectRearm(rearm);
  equal(
    parseTargetHostEffectRearmDocument(document).rearmDigest,
    rearm.rearmDigest,
  );
});

test("Target Host Effect Rearm拒绝摘要漂移", () => {
  const claim = createWindowWorkClaimFixture();
  const observation = createTargetDeliveryHostEffectObservationFixture({
    claim,
    attemptStatus: "rejected-before-effect",
    readbackStatus: "unavailable",
  });
  const rearm = createTargetHostEffectRearmFixture(claim, observation);
  throws(
    () =>
      parseTargetHostEffectRearm({
        ...rearm,
        rearmDigest: parseSha256Digest(`sha256:${"b".repeat(64)}`),
      }),
    (error: unknown) =>
      error instanceof TargetHostEffectRearmError && error.reason === "digest",
  );
});
