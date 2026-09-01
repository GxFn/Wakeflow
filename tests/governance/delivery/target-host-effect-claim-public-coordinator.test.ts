import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { executeDemandControllerRoutePublicRequest } from "../../../src/governance/controller/demand-controller-route-public-coordinator.js";
import {
  parseTargetHostEffectClaimPublicRequest,
  TargetHostEffectClaimPublicContractError,
} from "../../../src/governance/delivery/target-host-effect-claim-public-contract.js";
import {
  executeTargetHostEffectClaimPublicRequest,
  TargetHostEffectClaimPublicCoordinatorError,
} from "../../../src/governance/delivery/target-host-effect-claim-public-coordinator.js";
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

function stringPathsContaining(
  value: unknown,
  needle: string,
  path = "$",
  result: string[] = [],
): readonly string[] {
  if (typeof value === "string") {
    if (value.includes(needle)) result.push(path);
    return result;
  }
  if (value === null || typeof value !== "object") return result;
  for (const [key, entry] of Object.entries(value)) {
    stringPathsContaining(
      entry,
      needle,
      `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
      result,
    );
  }
  return result;
}

test("Claim Public Coordinator签发一次Implementation Action并安全重放", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  try {
    const request = {
      root: fixture.workspacePath,
      ...fixture.claimRequest,
    } as const;
    const parsed = parseTargetHostEffectClaimPublicRequest(request);
    equal(parsed.workType, "implementation");
    equal(Object.isFrozen(parsed.observation), true);
    throws(
      () => parseTargetHostEffectClaimPublicRequest(new Proxy(request, {})),
      (error: unknown) =>
        error instanceof TargetHostEffectClaimPublicContractError &&
        error.reason === "json",
    );
    throws(
      () =>
        parseTargetHostEffectClaimPublicRequest({
          ...request,
          root: `/${"x".repeat(140 * 1024)}`,
        }),
      (error: unknown) =>
        error instanceof TargetHostEffectClaimPublicContractError &&
        error.reason === "capacity",
    );

    await rejects(
      executeTargetHostEffectClaimPublicRequest(
        { ...CODEX_CLAIM_FACADE },
        request,
      ),
      (error: unknown) =>
        error instanceof TargetHostEffectClaimPublicCoordinatorError &&
        error.reason === "host" &&
        error.claimAuthority === "unchanged" &&
        error.eventAuthority === "unchanged",
    );
    await rejects(
      executeTargetHostEffectClaimPublicRequest(CODEX_CLAIM_FACADE, {
        ...request,
        root: "/definitely/missing/wakeflow-workspace",
      }),
      (error: unknown) =>
        error instanceof TargetHostEffectClaimPublicCoordinatorError &&
        error.reason === "root" &&
        error.claimAuthority === "unchanged" &&
        error.eventAuthority === "unchanged",
    );
    await rejects(
      executeTargetHostEffectClaimPublicRequest(CODEX_CLAIM_FACADE, request, {
        claim: {
          clock: () => parseUtcInstant("2026-08-29T12:10:01.000Z"),
          uuidFactory: claimUuidFactory(),
        },
      }),
      (error: unknown) =>
        error instanceof TargetHostEffectClaimPublicCoordinatorError &&
        error.reason === "claim" &&
        error.causeReason === "stale-observation" &&
        error.claimAuthority === "unchanged" &&
        error.eventAuthority === "unchanged",
    );

    const issued = await executeTargetHostEffectClaimPublicRequest(
      CODEX_CLAIM_FACADE,
      request,
      {
        claim: {
          clock: () => CLAIMED_AT,
          uuidFactory: claimUuidFactory(),
        },
      },
    );
    equal(issued.status, "issued");
    equal(issued.disposition, "committed");
    equal(issued.claim.target.workType, "implementation");
    equal(issued.action?.effect, "send-message-to-observed-target-window");
    equal(Object.isFrozen(issued), true);
    deepEqual(stringPathsContaining(issued, fixture.workspacePath), [
      "$/action/prompt",
    ]);
    deepEqual(stringPathsContaining(issued, fixture.rawHandle), []);

    const route = await executeDemandControllerRoutePublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.claimRequest.demandId,
    });
    equal(
      route.route.frontiers[0]?.kind,
      "implementation-host-effect-execution",
    );

    const replayed = await executeTargetHostEffectClaimPublicRequest(
      CODEX_CLAIM_FACADE,
      request,
      { claim: { clock: () => CLAIMED_AT } },
    );
    equal(replayed.status, "already-claimed");
    equal(replayed.disposition, "idempotent");
    equal(replayed.action, null);
    equal(replayed.claim.claimId, issued.claim.claimId);
    equal(replayed.event.eventId, issued.event.eventId);
    equal(replayed.stateDigest, issued.stateDigest);
    deepEqual(stringPathsContaining(replayed, fixture.workspacePath), []);
    deepEqual(stringPathsContaining(replayed, fixture.rawHandle), []);
  } finally {
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("Claim Public Coordinator共享Test packet-bound Action且重放不重签", async () => {
  const fixture = await createTestHostEffectClaimWorkspaceFixture();
  try {
    const request = {
      root: fixture.workspacePath,
      ...fixture.testClaimRequest,
    } as const;
    const issued = await executeTargetHostEffectClaimPublicRequest(
      CODEX_CLAIM_FACADE,
      request,
      {
        claim: {
          clock: () => TEST_CLAIMED_AT,
          uuidFactory: testClaimUuidFactory(),
        },
      },
    );
    equal(issued.status, "issued");
    equal(issued.claim.target.workType, "test");
    if (issued.claim.target.workType !== "test") {
      throw new Error("Expected a public Test Claim summary.");
    }
    equal(issued.claim.target.testAttemptId, fixture.testAttemptId);
    equal(
      issued.claim.target.testDispatchPacketDigest,
      fixture.testDispatchPacketDigest,
    );
    equal(issued.action?.kind, "WakeflowTestDeliveryAgentHostAction");
    if (issued.action?.kind !== "WakeflowTestDeliveryAgentHostAction") {
      throw new Error("Expected a public Test Agent Host Action.");
    }
    equal(issued.action.testAttemptId, fixture.testAttemptId);
    equal(
      issued.action.testDispatchPacket.digest,
      fixture.testDispatchPacketDigest,
    );
    deepEqual(stringPathsContaining(issued, fixture.workspacePath), [
      "$/action/prompt",
    ]);
    deepEqual(stringPathsContaining(issued, fixture.testRawHandle), []);

    const route = await executeDemandControllerRoutePublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.testClaimRequest.demandId,
    });
    equal(route.route.frontiers[0]?.kind, "test-host-effect-execution");

    const replayed = await executeTargetHostEffectClaimPublicRequest(
      CODEX_CLAIM_FACADE,
      request,
      { claim: { clock: () => TEST_CLAIMED_AT } },
    );
    equal(replayed.status, "already-claimed");
    equal(replayed.action, null);
    equal(replayed.claim.claimId, issued.claim.claimId);
    deepEqual(stringPathsContaining(replayed, fixture.workspacePath), []);
    deepEqual(stringPathsContaining(replayed, fixture.testRawHandle), []);
  } finally {
    await cleanupTestHostEffectClaimWorkspaceFixture(fixture);
  }
});
