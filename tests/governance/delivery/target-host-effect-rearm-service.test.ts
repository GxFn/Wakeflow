import { equal, notEqual, rejects } from "node:assert/strict";
import { readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { claudeCodeWindowHostIdentityProfile } from "../../../src/hosts/claude-code/claude-code-window-host-identity-profile.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { TargetHostEffectClaimService } from "../../../src/governance/delivery/target-host-effect-claim-service.js";
import { TargetHostEffectOutcomeService } from "../../../src/governance/delivery/target-host-effect-outcome-service.js";
import {
  TargetHostEffectRearmService,
  TargetHostEffectRearmServiceError,
} from "../../../src/governance/delivery/target-host-effect-rearm-service.js";
import {
  CLAIMED_AT,
  claimUuidFactory,
  cleanupTargetHostEffectClaimWorkspaceFixture,
  createTargetHostEffectClaimWorkspaceFixture,
} from "./target-host-effect-claim-service.fixture.js";

const OUTCOME_AT = parseUtcInstant("2026-08-29T12:06:00.000Z");
const REARMED_AT = parseUtcInstant("2026-08-29T12:03:00.000Z");
const SECOND_OBSERVED_AT = parseUtcInstant("2026-08-29T12:08:00.000Z");
const SECOND_CLAIMED_AT = parseUtcInstant("2026-08-29T12:09:00.000Z");
const SECOND_CLAIM_UUIDS = [
  "13131313-1313-4313-8313-131313131313",
  "14141414-1414-4414-8414-141414141414",
  "15151515-1515-4515-8515-151515151515",
];

async function aggregate(workspacePath: string, demandId: string) {
  const root = await RootedDirectory.open(
    path.join(workspacePath, ...demandFinalRootRef(demandId).split("/")),
  );
  try {
    return (await new DemandEventSourcingRepository(root).audit()).aggregate;
  } finally {
    await root.close();
  }
}

async function issueClaim(
  fixture: Awaited<
    ReturnType<typeof createTargetHostEffectClaimWorkspaceFixture>
  >,
) {
  const result = await new TargetHostEffectClaimService(
    fixture.workspaceRoot,
    codexWorkspaceHostResourceProfile,
    codexWindowHostIdentityProfile,
  ).claim(fixture.claimRequest, {
    clock: () => CLAIMED_AT,
    uuidFactory: claimUuidFactory(),
  });
  if (result.action === null)
    throw new Error("Expected first Action issuance.");
  return result;
}

async function recordOutcome(
  fixture: Awaited<
    ReturnType<typeof createTargetHostEffectClaimWorkspaceFixture>
  >,
  issued: Awaited<ReturnType<typeof issueClaim>>,
  status: "accepted" | "rejected-before-effect",
) {
  return new TargetHostEffectOutcomeService(
    fixture.workspaceRoot,
    "codex",
  ).record({
    demandId: fixture.intent.demandId,
    actionId: issued.claim.claimId,
    claimDigest: issued.claim.claimDigest,
    attempt: { status, evidence: { fixture: status } },
    readback:
      status === "accepted"
        ? { status: "pending", evidence: { visible: false } }
        : { status: "unavailable" },
    observedAt: OUTCOME_AT,
  });
}

function rearmRequest(
  fixture: Awaited<
    ReturnType<typeof createTargetHostEffectClaimWorkspaceFixture>
  >,
  issued: Awaited<ReturnType<typeof issueClaim>>,
  observationDigest: string,
) {
  return {
    demandId: fixture.intent.demandId,
    actionId: issued.claim.claimId,
    observationDigest,
  };
}

function secondClaimUuidFactory() {
  let index = 0;
  return () => SECOND_CLAIM_UUIDS[index++] ?? "invalid";
}

test("rejected尾部显式Rearm后必须取得全新Claim才能再次签发Action", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  try {
    const issued = await issueClaim(fixture);
    const outcome = await recordOutcome(
      fixture,
      issued,
      "rejected-before-effect",
    );
    const request = rearmRequest(
      fixture,
      issued,
      outcome.observation.observationDigest,
    );
    const service = new TargetHostEffectRearmService(
      fixture.workspaceRoot,
      codexWorkspaceHostResourceProfile,
      codexWindowHostIdentityProfile,
    );
    await rejects(
      service.rearm({
        ...request,
        targetTaskId: fixture.intent.target.targetTaskId,
      }),
      (error: unknown) =>
        error instanceof TargetHostEffectRearmServiceError &&
        error.reason === "input" &&
        error.eventAuthority === "unchanged",
    );
    const rearmed = await service.rearm(request, {
      clock: () => REARMED_AT,
    });
    equal(rearmed.status, "rearmed");
    equal(rearmed.disposition, "committed");
    equal(rearmed.claimAuthority, "released");
    equal(rearmed.rearm.rearmedAt < outcome.observation.observedAt, true);
    equal(
      (await aggregate(fixture.workspacePath, fixture.intent.demandId)).state
        .targetTasks[0]?.phase,
      "delivery-prepared",
    );

    const replayed = await service.rearm(request, {
      clock: () => SECOND_CLAIMED_AT,
    });
    equal(replayed.status, "already-rearmed");
    equal(replayed.rearm.rearmedAt, REARMED_AT);

    const nextClaim = await new TargetHostEffectClaimService(
      fixture.workspaceRoot,
      codexWorkspaceHostResourceProfile,
      codexWindowHostIdentityProfile,
    ).claim(
      {
        ...fixture.claimRequest,
        observation: {
          ...fixture.claimRequest.observation,
          observedAt: SECOND_OBSERVED_AT,
        },
      },
      {
        clock: () => SECOND_CLAIMED_AT,
        uuidFactory: secondClaimUuidFactory(),
      },
    );
    equal(nextClaim.status, "issued");
    notEqual(nextClaim.claim.claimId, issued.claim.claimId);

    const bindingEntry = readdirSync(fixture.bindingRootPath)[0];
    if (bindingEntry === undefined) throw new Error("Expected Binding entry.");
    unlinkSync(path.join(fixture.bindingRootPath, bindingEntry));
    const replayedAfterNewClaim = await service.rearm(request);
    equal(replayedAfterNewClaim.status, "already-rearmed");
    equal(replayedAfterNewClaim.eventAuthority, "current");
    equal(replayedAfterNewClaim.rearm.rearmDigest, rearmed.rearm.rearmDigest);
  } finally {
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("accepted outcome不能Rearm", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  try {
    const issued = await issueClaim(fixture);
    const outcome = await recordOutcome(fixture, issued, "accepted");
    await rejects(
      new TargetHostEffectRearmService(
        fixture.workspaceRoot,
        codexWorkspaceHostResourceProfile,
        codexWindowHostIdentityProfile,
      ).rearm(
        rearmRequest(fixture, issued, outcome.observation.observationDigest),
        {
          clock: () => REARMED_AT,
        },
      ),
      (error: unknown) =>
        error instanceof TargetHostEffectRearmServiceError &&
        error.reason === "observation" &&
        error.eventAuthority === "unchanged",
    );
  } finally {
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("Rearm在Event提交前拒绝当前Binding漂移", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  try {
    const issued = await issueClaim(fixture);
    const outcome = await recordOutcome(
      fixture,
      issued,
      "rejected-before-effect",
    );
    const bindingEntry = readdirSync(fixture.bindingRootPath)[0];
    if (bindingEntry === undefined) throw new Error("Expected Binding entry.");
    unlinkSync(path.join(fixture.bindingRootPath, bindingEntry));

    await rejects(
      new TargetHostEffectRearmService(
        fixture.workspaceRoot,
        codexWorkspaceHostResourceProfile,
        codexWindowHostIdentityProfile,
      ).rearm(
        rearmRequest(fixture, issued, outcome.observation.observationDigest),
        {
          clock: () => REARMED_AT,
        },
      ),
      (error: unknown) =>
        error instanceof TargetHostEffectRearmServiceError &&
        error.reason === "binding" &&
        error.eventAuthority === "unchanged",
    );
    equal(
      (await aggregate(fixture.workspacePath, fixture.intent.demandId)).state
        .targetTasks[0]?.phase,
      "host-effect-rejected",
    );
  } finally {
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("Rearm固定Host并在settled错误中保留Event current", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  try {
    const issued = await issueClaim(fixture);
    const outcome = await recordOutcome(
      fixture,
      issued,
      "rejected-before-effect",
    );
    const request = rearmRequest(
      fixture,
      issued,
      outcome.observation.observationDigest,
    );
    const foreignHost = new TargetHostEffectRearmService(
      fixture.workspaceRoot,
      claudeCodeWorkspaceHostResourceProfile,
      claudeCodeWindowHostIdentityProfile,
    );
    await rejects(
      foreignHost.rearm(request),
      (error: unknown) =>
        error instanceof TargetHostEffectRearmServiceError &&
        error.reason === "host" &&
        error.eventAuthority === "unchanged",
    );

    const owner = new TargetHostEffectRearmService(
      fixture.workspaceRoot,
      codexWorkspaceHostResourceProfile,
      codexWindowHostIdentityProfile,
    );
    const rearmed = await owner.rearm(request, { clock: () => REARMED_AT });
    equal(rearmed.status, "rearmed");

    await rejects(
      foreignHost.rearm(request),
      (error: unknown) =>
        error instanceof TargetHostEffectRearmServiceError &&
        error.reason === "host" &&
        error.eventAuthority === "current",
    );
    await rejects(
      owner.rearm({
        ...request,
        observationDigest:
          "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      }),
      (error: unknown) =>
        error instanceof TargetHostEffectRearmServiceError &&
        error.reason === "observation" &&
        error.eventAuthority === "current",
    );
  } finally {
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});
