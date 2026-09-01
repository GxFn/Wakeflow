import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  createTargetDeliveryHostEffectObservation,
  type TargetDeliveryHostEffectAttemptStatus,
} from "../../../src/governance/delivery/target-delivery-host-effect-observation.js";
import type { WindowWorkClaim } from "../../../src/governance/delivery/window-work-claim.js";
import { createWindowWorkClaimFixture } from "./window-work-claim.fixture.js";

export const TARGET_HOST_EFFECT_OBSERVED_AT = parseUtcInstant(
  "2026-08-29T09:56:00.000Z",
);
export interface TargetDeliveryHostEffectObservationFixtureOptions {
  readonly claim?: Readonly<WindowWorkClaim>;
  readonly attemptStatus?: TargetDeliveryHostEffectAttemptStatus;
  readonly readbackStatus?: "confirmed" | "pending" | "unavailable";
}

export function createTargetDeliveryHostEffectObservationFixture(
  options: TargetDeliveryHostEffectObservationFixtureOptions = {},
) {
  const claim = options.claim ?? createWindowWorkClaimFixture();
  const readbackStatus = options.readbackStatus ?? "pending";
  return createTargetDeliveryHostEffectObservation({
    action: {
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
      claimEventStreamRevision:
        claim.claimTransition.expectedStreamRevision + 1,
      claimExpectedStateDigest: claim.claimTransition.expectedStateDigest,
      issuedAt: claim.claimedAt,
    },
    attempt: {
      status: options.attemptStatus ?? "accepted",
      evidence: { fixture: "target-host-effect-attempt" },
    },
    readback:
      readbackStatus === "unavailable"
        ? { status: "unavailable" }
        : {
            status: readbackStatus,
            evidence: { fixture: "target-host-effect-readback" },
          },
    observedAt: TARGET_HOST_EFFECT_OBSERVED_AT,
  });
}
