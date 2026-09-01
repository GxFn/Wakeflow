import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  createWindowWorkClaim,
  parseWindowWorkClaim,
  parseWindowWorkClaimDocument,
  renderWindowWorkClaim,
  WindowWorkClaimError,
} from "../../../src/governance/delivery/window-work-claim.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  createWindowWorkClaimFixture,
  WINDOW_WORK_CLAIM_ID,
  WINDOW_WORK_CLAIM_OBSERVED_AT,
  WINDOW_WORK_CLAIMED_AT,
} from "./window-work-claim.fixture.js";

test("WindowWorkClaim形成无TTL的确定性当前窗口占用权威", () => {
  const claim = createWindowWorkClaimFixture();
  equal(claim.claimId, WINDOW_WORK_CLAIM_ID);
  equal(claim.hostObservation.observedAt, WINDOW_WORK_CLAIM_OBSERVED_AT);
  equal(claim.claimedAt, WINDOW_WORK_CLAIMED_AT);
  equal(claim.hostObservation.observedAt < claim.target.intentPreparedAt, true);
  equal(claim.claimedAt < claim.hostObservation.observedAt, true);
  equal(claim.claimTransition.expectedStreamRevision, 3);
  equal(Object.hasOwn(claim.target, "workType"), false);
  equal(Object.hasOwn(claim.target, "testAttemptId"), false);
  const document = renderWindowWorkClaim(claim);
  deepEqual(parseWindowWorkClaimDocument(document), claim);
  const encoded = JSON.stringify(claim);
  equal(
    /(?:expiresAt|ttl|retry|rawHandle|threadId|sessionId|sendResult|readback)/u.test(
      encoded,
    ),
    false,
  );
});

test("WindowWorkClaim允许wall clock逆序但拒绝摘要漂移和额外状态字段", () => {
  const claim = createWindowWorkClaimFixture();
  throws(
    () =>
      parseWindowWorkClaim({
        ...claim,
        claimedAt: claim.hostObservation.observedAt,
        claimDigest: `sha256:${"0".repeat(64)}`,
      }),
    (error: unknown) =>
      error instanceof WindowWorkClaimError && error.reason === "digest",
  );
  throws(
    () => parseWindowWorkClaim({ ...claim, expiresAt: WINDOW_WORK_CLAIMED_AT }),
    (error: unknown) =>
      error instanceof WindowWorkClaimError && error.reason === "schema",
  );
});

test("Test WindowWorkClaim额外绑定logical attempt与packet digest", () => {
  const implementation = createWindowWorkClaimFixture();
  const testAttemptId = parseWakeflowDurableIdOfKind(
    "test-attempt_33333333-3333-4333-8333-333333333333",
    "test-attempt",
  );
  const packetDigest = parseSha256Digest(`sha256:${"a".repeat(64)}`);
  const claim = createWindowWorkClaim(
    {
      claimId: implementation.claimId,
      programId: implementation.programId,
      target: {
        ...implementation.target,
        workType: "test",
        testAttemptId,
        testDispatchPacketDigest: packetDigest,
      },
      route: implementation.route,
      hostObservation: implementation.hostObservation,
      claimTransition: implementation.claimTransition,
    },
    { clock: () => WINDOW_WORK_CLAIMED_AT },
  );
  equal(claim.target.workType, "test");
  if (claim.target.workType !== "test") {
    throw new Error("Expected Test claim target.");
  }
  equal(claim.target.testAttemptId, testAttemptId);
  equal(claim.target.testDispatchPacketDigest, packetDigest);
  deepEqual(parseWindowWorkClaimDocument(renderWindowWorkClaim(claim)), claim);
  const { testAttemptId: _missing, ...incompleteTarget } = claim.target;
  throws(
    () => parseWindowWorkClaim({ ...claim, target: incompleteTarget }),
    (error: unknown) =>
      error instanceof WindowWorkClaimError && error.reason === "schema",
  );
});
