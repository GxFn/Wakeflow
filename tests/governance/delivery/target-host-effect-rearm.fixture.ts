import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { createTargetHostEffectRearm } from "../../../src/governance/delivery/target-host-effect-rearm.js";
import type { TargetDeliveryHostEffectObservation } from "../../../src/governance/delivery/target-delivery-host-effect-observation.js";
import type { WindowWorkClaim } from "../../../src/governance/delivery/window-work-claim.js";

export const TARGET_HOST_EFFECT_REARMED_AT = parseUtcInstant(
  "2026-08-29T09:55:00.000Z",
);

export function createTargetHostEffectRearmFixture(
  claim: Readonly<WindowWorkClaim>,
  observation: Readonly<TargetDeliveryHostEffectObservation>,
) {
  return createTargetHostEffectRearm(
    {
      target: {
        demandId: claim.target.demandId,
        targetTaskId: claim.target.targetTaskId,
        targetDeliveryId: claim.target.targetDeliveryId,
      },
      rejectedAttempt: {
        claimId: claim.claimId,
        claimDigest: claim.claimDigest,
        claimEventId: claim.claimTransition.eventId,
        claimCommitId: claim.claimTransition.commitId,
        observationDigest: observation.observationDigest,
      },
    },
    {
      clock: () => TARGET_HOST_EFFECT_REARMED_AT,
    },
  );
}
