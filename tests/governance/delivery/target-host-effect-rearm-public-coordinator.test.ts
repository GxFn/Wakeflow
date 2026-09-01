import { equal, notEqual, rejects, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { claudeCodeWindowHostIdentityProfile } from "../../../src/hosts/claude-code/claude-code-window-host-identity-profile.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { executeDemandControllerRoutePublicRequest } from "../../../src/governance/controller/demand-controller-route-public-coordinator.js";
import { executeTargetHostEffectClaimPublicRequest } from "../../../src/governance/delivery/target-host-effect-claim-public-coordinator.js";
import { executeTargetHostEffectOutcomePublicRequest } from "../../../src/governance/delivery/target-host-effect-outcome-public-coordinator.js";
import {
  parseTargetHostEffectRearmPublicRequest,
  TargetHostEffectRearmPublicContractError,
} from "../../../src/governance/delivery/target-host-effect-rearm-public-contract.js";
import {
  executeTargetHostEffectRearmPublicRequest,
  TargetHostEffectRearmPublicCoordinatorError,
} from "../../../src/governance/delivery/target-host-effect-rearm-public-coordinator.js";
import {
  CLAIMED_AT,
  claimUuidFactory,
  cleanupTargetHostEffectClaimWorkspaceFixture,
  createTargetHostEffectClaimWorkspaceFixture,
} from "./target-host-effect-claim-service.fixture.js";

const CODEX_CLAIM_FACADE = Object.freeze({
  hostId: "codex" as const,
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
});
const CODEX_OUTCOME_FACADE = Object.freeze({ hostId: "codex" as const });
const CODEX_REARM_FACADE = Object.freeze({
  hostId: "codex" as const,
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
});
const CLAUDE_CODE_REARM_FACADE = Object.freeze({
  hostId: "claude-code" as const,
  resourceProfile: claudeCodeWorkspaceHostResourceProfile,
  identityProfile: claudeCodeWindowHostIdentityProfile,
});
const OUTCOME_AT = parseUtcInstant("2026-08-29T12:06:00.000Z");
const REARMED_AT = parseUtcInstant("2026-08-29T12:03:00.000Z");
const NEXT_OBSERVED_AT = parseUtcInstant("2026-08-29T12:08:00.000Z");
const NEXT_CLAIMED_AT = parseUtcInstant("2026-08-29T12:09:00.000Z");
const NEXT_CLAIM_UUIDS = Object.freeze([
  "13131313-1313-4313-8313-131313131313",
  "14141414-1414-4414-8414-141414141414",
  "15151515-1515-4515-8515-151515151515",
]);

function nextClaimUuidFactory(): () => string {
  let index = 0;
  return () => NEXT_CLAIM_UUIDS[index++] ?? "invalid";
}

function containsText(value: unknown, needle: string): boolean {
  if (typeof value === "string") return value.includes(needle);
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((entry) => containsText(entry, needle));
}

test("Rearm Public Coordinator闭合rejected尾部并准入fresh Claim", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  try {
    const claimed = await executeTargetHostEffectClaimPublicRequest(
      CODEX_CLAIM_FACADE,
      { root: fixture.workspacePath, ...fixture.claimRequest },
      {
        claim: {
          clock: () => CLAIMED_AT,
          uuidFactory: claimUuidFactory(),
        },
      },
    );
    const outcome = await executeTargetHostEffectOutcomePublicRequest(
      CODEX_OUTCOME_FACADE,
      {
        root: fixture.workspacePath,
        demandId: fixture.intent.demandId,
        actionId: claimed.claim.claimId,
        claimDigest: claimed.claim.claimDigest,
        attempt: {
          status: "rejected-before-effect",
          evidence: { hostRejectedBeforeEffect: true },
        },
        readback: { status: "unavailable" },
        observedAt: OUTCOME_AT,
      },
    );
    const request = {
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
      actionId: claimed.claim.claimId,
      observationDigest: outcome.observation.observationDigest,
    };
    const parsed = parseTargetHostEffectRearmPublicRequest(request);
    equal(Object.isFrozen(parsed), true);
    throws(
      () => parseTargetHostEffectRearmPublicRequest(new Proxy(request, {})),
      (error: unknown) =>
        error instanceof TargetHostEffectRearmPublicContractError &&
        error.reason === "json",
    );
    await rejects(
      executeTargetHostEffectRearmPublicRequest(
        { ...CODEX_REARM_FACADE },
        request,
      ),
      (error: unknown) =>
        error instanceof TargetHostEffectRearmPublicCoordinatorError &&
        error.reason === "host" &&
        error.eventAuthority === "unchanged",
    );
    await rejects(
      executeTargetHostEffectRearmPublicRequest(
        CLAUDE_CODE_REARM_FACADE,
        request,
      ),
      (error: unknown) =>
        error instanceof TargetHostEffectRearmPublicCoordinatorError &&
        error.reason === "host" &&
        error.eventAuthority === "unchanged",
    );

    const rearmed = await executeTargetHostEffectRearmPublicRequest(
      CODEX_REARM_FACADE,
      request,
      { rearm: { clock: () => REARMED_AT } },
    );
    equal(rearmed.status, "rearmed");
    equal(rearmed.disposition, "committed");
    equal(rearmed.claimAuthority, "released");
    equal(rearmed.eventAuthority, "current");
    equal(rearmed.rearm.rearmedAt < outcome.observation.observedAt, true);
    equal(
      rearmed.rearm.target.targetTaskId,
      fixture.intent.target.targetTaskId,
    );
    equal(
      rearmed.rearm.target.targetDeliveryId,
      fixture.intent.targetDeliveryId,
    );
    equal(rearmed.rearm.rejectedAttempt.claimId, claimed.claim.claimId);
    equal(
      rearmed.rearm.rejectedAttempt.observationDigest,
      outcome.observation.observationDigest,
    );
    equal(Object.hasOwn(rearmed, "action"), false);
    equal(containsText(rearmed, fixture.workspacePath), false);
    equal(containsText(rearmed, fixture.rawHandle), false);

    const route = await executeDemandControllerRoutePublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
    });
    equal(route.route.frontiers[0]?.kind, "implementation-host-effect-claim");

    const nextClaim = await executeTargetHostEffectClaimPublicRequest(
      CODEX_CLAIM_FACADE,
      {
        root: fixture.workspacePath,
        ...fixture.claimRequest,
        observation: {
          ...fixture.claimRequest.observation,
          observedAt: NEXT_OBSERVED_AT,
        },
      },
      {
        claim: {
          clock: () => NEXT_CLAIMED_AT,
          uuidFactory: nextClaimUuidFactory(),
        },
      },
    );
    equal(nextClaim.status, "issued");
    notEqual(nextClaim.claim.claimId, claimed.claim.claimId);

    const replayed = await executeTargetHostEffectRearmPublicRequest(
      CODEX_REARM_FACADE,
      request,
    );
    equal(replayed.status, "already-rearmed");
    equal(replayed.rearm.rearmDigest, rearmed.rearm.rearmDigest);
    equal(replayed.event.eventId, rearmed.event.eventId);

    await rejects(
      executeTargetHostEffectRearmPublicRequest(
        CLAUDE_CODE_REARM_FACADE,
        request,
      ),
      (error: unknown) =>
        error instanceof TargetHostEffectRearmPublicCoordinatorError &&
        error.reason === "host" &&
        error.eventAuthority === "current",
    );
    await rejects(
      executeTargetHostEffectRearmPublicRequest(CODEX_REARM_FACADE, {
        ...request,
        observationDigest:
          "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      }),
      (error: unknown) =>
        error instanceof TargetHostEffectRearmPublicCoordinatorError &&
        error.reason === "rearm" &&
        error.causeReason === "observation" &&
        error.eventAuthority === "current",
    );
  } finally {
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});
