import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { parseDemandEventStreamRevision } from "../../../src/governance/demand/event-sourcing/demand-event-stream-position.js";
import { createControllerTargetReviewResume } from "../../../src/governance/review/controller-target-review-resume.js";
import {
  createControllerImplementationReviewDecisionFixture,
  CONTROLLER_REVIEW_WINDOW_ID,
} from "./controller-implementation-review-decision.fixture.js";

export const CONTROLLER_REVIEW_RESUMED_AT = parseUtcInstant(
  "2026-08-29T12:20:00.000Z",
);
export const CONTROLLER_REVIEW_RESUME_UUID =
  "ecececec-ecec-4cec-8cec-ecececececec";

export function createControllerTargetReviewResumeFixture() {
  const blocked =
    createControllerImplementationReviewDecisionFixture("blocked");
  return createControllerTargetReviewResume(
    {
      programId: blocked.programId,
      demandId: blocked.demandId,
      targetTaskId: blocked.targetTaskId,
      controllerWindowId: CONTROLLER_REVIEW_WINDOW_ID,
      blockedDecision: {
        targetReviewDecisionId: blocked.targetReviewDecisionId,
        decisionDigest: blocked.decisionDigest,
        targetResultId: blocked.reviewed.targetResultId,
        targetResultDigest: blocked.reviewed.targetResultDigest,
      },
      blockedSource: {
        snapshotDigest: parseSha256Digest(`sha256:${"4".repeat(64)}`),
        stateDigest: parseSha256Digest(`sha256:${"5".repeat(64)}`),
        streamRevision: parseDemandEventStreamRevision(9),
      },
      resolutionSummary: "用户已补充缺失决定，Controller可以重新执行独立审查。",
    },
    {
      clock: () => CONTROLLER_REVIEW_RESUMED_AT,
      uuidFactory: () => CONTROLLER_REVIEW_RESUME_UUID,
    },
  );
}
