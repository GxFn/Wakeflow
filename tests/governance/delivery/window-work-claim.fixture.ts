import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  createWindowWorkClaim,
  parseWindowWorkClaimId,
} from "../../../src/governance/delivery/window-work-claim.js";
import {
  createTargetDeliveryIntentFixture,
  TARGET_DELIVERY_BINDING_ID,
} from "./target-delivery-intent.fixture.js";
import {
  TASKING_PROGRAM_ID,
  TASKING_WINDOW_ID,
} from "../tasking/task-package.fixture.js";

export const WINDOW_WORK_CLAIM_ID = parseWindowWorkClaimId(
  "window_work_claim_11111111-1111-4111-8111-111111111111",
);
export const OTHER_WINDOW_WORK_CLAIM_ID = parseWindowWorkClaimId(
  "window_work_claim_22222222-2222-4222-8222-222222222222",
);
export const WINDOW_WORK_CLAIM_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_abababab-abab-4bab-8bab-abababababab",
  "demand-event",
);
export const WINDOW_WORK_CLAIM_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
  "demand-event-commit",
);
export const WINDOW_WORK_CLAIM_OBSERVED_AT = parseUtcInstant(
  "2026-08-29T09:58:00.000Z",
);
export const WINDOW_WORK_CLAIMED_AT = parseUtcInstant(
  "2026-08-29T09:57:00.000Z",
);
export const WINDOW_WORK_CLAIM_OBSERVATION_DIGEST = parseSha256Digest(
  `sha256:${"e".repeat(64)}`,
);
export const WINDOW_WORK_CLAIM_STATE_DIGEST = parseSha256Digest(
  `sha256:${"f".repeat(64)}`,
);

export function createWindowWorkClaimFixture(
  claimId = WINDOW_WORK_CLAIM_ID,
  expectedStateDigest = WINDOW_WORK_CLAIM_STATE_DIGEST,
) {
  const intent = createTargetDeliveryIntentFixture();
  return createWindowWorkClaim(
    {
      claimId,
      programId: TASKING_PROGRAM_ID,
      target: {
        demandId: intent.demandId,
        targetTaskId: intent.target.targetTaskId,
        targetDeliveryId: intent.targetDeliveryId,
        intentDigest: intent.intentDigest,
        intentPreparedAt: intent.preparedAt,
      },
      route: {
        hostId: "codex",
        windowId: TASKING_WINDOW_ID,
        bindingId: TARGET_DELIVERY_BINDING_ID,
      },
      hostObservation: {
        authorityDigest: WINDOW_WORK_CLAIM_OBSERVATION_DIGEST,
        observedAt: WINDOW_WORK_CLAIM_OBSERVED_AT,
      },
      claimTransition: {
        commitId: WINDOW_WORK_CLAIM_COMMIT_ID,
        eventId: WINDOW_WORK_CLAIM_EVENT_ID,
        expectedStreamRevision: 3,
        expectedStateDigest,
      },
    },
    {
      clock: () => WINDOW_WORK_CLAIMED_AT,
    },
  );
}
