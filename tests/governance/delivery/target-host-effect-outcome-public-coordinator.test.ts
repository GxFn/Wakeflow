import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { executeDemandControllerRoutePublicRequest } from "../../../src/governance/controller/demand-controller-route-public-coordinator.js";
import { parseTargetHostEffectOutcomePublicRequest } from "../../../src/governance/delivery/target-host-effect-outcome-public-contract.js";
import {
  executeTargetHostEffectOutcomePublicRequest,
  TargetHostEffectOutcomePublicContractError,
  TargetHostEffectOutcomePublicCoordinatorError,
} from "../../../src/governance/delivery/target-host-effect-outcome-public-coordinator.js";
import { executeTargetHostEffectClaimPublicRequest } from "../../../src/governance/delivery/target-host-effect-claim-public-coordinator.js";
import { WINDOW_WORK_CLAIMS_ROOT_REF } from "../../../src/governance/delivery/window-work-claim-resource-catalog.js";
import { WINDOW_WORK_CLAIM_DIRECTORY_MODE } from "../../../src/governance/delivery/window-work-claim-store.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  CLAIMED_AT,
  claimUuidFactory,
  cleanupTargetHostEffectClaimWorkspaceFixture,
  createTargetHostEffectClaimWorkspaceFixture,
} from "./target-host-effect-claim-service.fixture.js";
import {
  cleanupTestHostEffectClaimWorkspaceFixture,
  createTestHostEffectClaimWorkspaceFixture,
  TEST_CLAIMED_AT,
  testClaimUuidFactory,
} from "../testing/test-host-effect-claim-service.fixture.js";

const CODEX_CLAIM_FACADE = Object.freeze({
  hostId: "codex" as const,
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
});
const CODEX_OUTCOME_FACADE = Object.freeze({ hostId: "codex" as const });
const CLAUDE_CODE_OUTCOME_FACADE = Object.freeze({
  hostId: "claude-code" as const,
});
const IMPLEMENTATION_OUTCOME_AT = parseUtcInstant("2026-08-29T12:03:00.000Z");
const TEST_OUTCOME_AT = parseUtcInstant("2026-08-29T12:30:00.000Z");
const RAW_ATTEMPT = "private-host-attempt:must-not-survive";
const RAW_READBACK = "private-host-readback:must-not-survive";

function stringPathsContaining(
  value: unknown,
  needle: string,
  pathValue = "$",
  result: string[] = [],
): readonly string[] {
  if (typeof value === "string") {
    if (value.includes(needle)) result.push(pathValue);
    return result;
  }
  if (value === null || typeof value !== "object") return result;
  for (const [key, entry] of Object.entries(value)) {
    stringPathsContaining(
      entry,
      needle,
      `${pathValue}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
      result,
    );
  }
  return result;
}

test("Outcome Public Coordinator记录Implementation观察、保持隐私并幂等重放", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  const claimRootPath = path.join(
    fixture.workspacePath,
    ...WINDOW_WORK_CLAIMS_ROOT_REF.split("/"),
  );
  let claimRootRestricted = false;
  try {
    const issued = await executeTargetHostEffectClaimPublicRequest(
      CODEX_CLAIM_FACADE,
      { root: fixture.workspacePath, ...fixture.claimRequest },
      {
        claim: {
          clock: () => CLAIMED_AT,
          uuidFactory: claimUuidFactory(),
        },
      },
    );
    const request = {
      root: fixture.workspacePath,
      demandId: issued.claim.target.demandId,
      actionId: issued.claim.claimId,
      claimDigest: issued.claim.claimDigest,
      attempt: {
        status: "accepted" as const,
        evidence: { raw: RAW_ATTEMPT },
      },
      readback: {
        status: "pending" as const,
        evidence: { raw: RAW_READBACK },
      },
      observedAt: IMPLEMENTATION_OUTCOME_AT,
    };
    const parsed = parseTargetHostEffectOutcomePublicRequest(request);
    equal(Object.isFrozen(parsed), true);
    equal(Object.isFrozen(parsed.attempt.evidence), true);
    throws(
      () => parseTargetHostEffectOutcomePublicRequest(new Proxy(request, {})),
      (error: unknown) =>
        error instanceof TargetHostEffectOutcomePublicContractError &&
        error.reason === "json",
    );
    throws(
      () =>
        parseTargetHostEffectOutcomePublicRequest({
          ...request,
          attempt: {
            ...request.attempt,
            evidence: "x".repeat(129 * 1024),
          },
        }),
      (error: unknown) =>
        error instanceof TargetHostEffectOutcomePublicContractError &&
        error.reason === "capacity" &&
        error.path === "$/attempt/evidence",
    );

    await rejects(
      executeTargetHostEffectOutcomePublicRequest(
        { ...CODEX_OUTCOME_FACADE },
        request,
      ),
      (error: unknown) =>
        error instanceof TargetHostEffectOutcomePublicCoordinatorError &&
        error.reason === "host" &&
        error.claimAuthority === "unknown" &&
        error.eventAuthority === "unchanged",
    );
    await rejects(
      executeTargetHostEffectOutcomePublicRequest(
        CLAUDE_CODE_OUTCOME_FACADE,
        request,
      ),
      (error: unknown) =>
        error instanceof TargetHostEffectOutcomePublicCoordinatorError &&
        error.reason === "host" &&
        error.causeReason === "host" &&
        error.eventAuthority === "unchanged",
    );
    await rejects(
      executeTargetHostEffectOutcomePublicRequest(CODEX_OUTCOME_FACADE, {
        ...request,
        claimDigest: `sha256:${"f".repeat(64)}`,
      }),
      (error: unknown) =>
        error instanceof TargetHostEffectOutcomePublicCoordinatorError &&
        error.reason === "outcome" &&
        error.causeReason === "state" &&
        error.eventAuthority === "unchanged",
    );

    const recorded = await executeTargetHostEffectOutcomePublicRequest(
      CODEX_OUTCOME_FACADE,
      request,
    );
    equal(recorded.status, "recorded");
    equal(recorded.disposition, "committed");
    equal(recorded.effectDisposition, "accepted");
    equal(recorded.claimHandling, "retain");
    equal(recorded.claimAuthority, "current");
    equal(recorded.target.workType, "implementation");
    equal(recorded.claim.actionId, issued.claim.claimId);
    equal(recorded.observation.observedAt < issued.claim.claimedAt, true);
    equal(Object.isFrozen(recorded), true);
    deepEqual(stringPathsContaining(recorded, fixture.workspacePath), []);
    deepEqual(stringPathsContaining(recorded, fixture.rawHandle), []);
    deepEqual(stringPathsContaining(recorded, RAW_ATTEMPT), []);
    deepEqual(stringPathsContaining(recorded, RAW_READBACK), []);

    await rejects(
      executeTargetHostEffectOutcomePublicRequest(
        CLAUDE_CODE_OUTCOME_FACADE,
        request,
      ),
      (error: unknown) =>
        error instanceof TargetHostEffectOutcomePublicCoordinatorError &&
        error.reason === "host" &&
        error.causeReason === "host" &&
        error.claimAuthority === "unknown" &&
        error.eventAuthority === "current",
    );

    const route = await executeDemandControllerRoutePublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
    });
    equal(
      route.route.frontiers[0]?.kind,
      "implementation-target-result-import",
    );

    await chmod(claimRootPath, 0o500);
    claimRootRestricted = true;
    await rejects(
      executeTargetHostEffectOutcomePublicRequest(
        CODEX_OUTCOME_FACADE,
        request,
      ),
      (error: unknown) =>
        error instanceof TargetHostEffectOutcomePublicCoordinatorError &&
        error.reason === "outcome" &&
        error.causeReason === "claim" &&
        error.claimAuthority === "unknown" &&
        error.eventAuthority === "current",
    );
    await chmod(claimRootPath, WINDOW_WORK_CLAIM_DIRECTORY_MODE);
    claimRootRestricted = false;

    const replayed = await executeTargetHostEffectOutcomePublicRequest(
      CODEX_OUTCOME_FACADE,
      request,
    );
    equal(replayed.status, "already-recorded");
    equal(replayed.disposition, "idempotent");
    equal(
      replayed.observation.observationDigest,
      recorded.observation.observationDigest,
    );
    equal(replayed.event.eventId, recorded.event.eventId);
    equal(replayed.stateDigest, recorded.stateDigest);
  } finally {
    if (claimRootRestricted) {
      await chmod(claimRootPath, WINDOW_WORK_CLAIM_DIRECTORY_MODE);
    }
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("Outcome Public Coordinator从stored Test Claim派生目标并在拒绝Event后释放Claim", async () => {
  const fixture = await createTestHostEffectClaimWorkspaceFixture();
  try {
    const issued = await executeTargetHostEffectClaimPublicRequest(
      CODEX_CLAIM_FACADE,
      { root: fixture.workspacePath, ...fixture.testClaimRequest },
      {
        claim: {
          clock: () => TEST_CLAIMED_AT,
          uuidFactory: testClaimUuidFactory(),
        },
      },
    );
    const request = {
      root: fixture.workspacePath,
      demandId: issued.claim.target.demandId,
      actionId: issued.claim.claimId,
      claimDigest: issued.claim.claimDigest,
      attempt: {
        status: "rejected-before-effect" as const,
        evidence: { raw: RAW_ATTEMPT },
      },
      readback: { status: "unavailable" as const },
      observedAt: TEST_OUTCOME_AT,
    };
    const recorded = await executeTargetHostEffectOutcomePublicRequest(
      CODEX_OUTCOME_FACADE,
      request,
    );
    equal(recorded.effectDisposition, "rejected-before-effect");
    equal(recorded.claimHandling, "release-authorized");
    equal(recorded.claimAuthority, "released");
    equal(recorded.target.workType, "test");
    equal(recorded.observation.observedAt < issued.claim.claimedAt, true);
    if (recorded.target.workType !== "test") {
      throw new Error("Expected public Test Outcome target.");
    }
    equal(recorded.target.testAttemptId, fixture.testAttemptId);
    equal(
      recorded.target.testDispatchPacketDigest,
      fixture.testDispatchPacketDigest,
    );
    deepEqual(stringPathsContaining(recorded, fixture.workspacePath), []);
    deepEqual(stringPathsContaining(recorded, fixture.testRawHandle), []);
    deepEqual(stringPathsContaining(recorded, RAW_ATTEMPT), []);

    const route = await executeDemandControllerRoutePublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.testClaimRequest.demandId,
    });
    equal(route.route.frontiers[0]?.kind, "test-delivery-replacement-planning");

    const replayed = await executeTargetHostEffectOutcomePublicRequest(
      CODEX_OUTCOME_FACADE,
      request,
    );
    equal(replayed.status, "already-recorded");
    equal(replayed.claimAuthority, "released");
    equal(replayed.event.eventId, recorded.event.eventId);
  } finally {
    await cleanupTestHostEffectClaimWorkspaceFixture(fixture);
  }
});
