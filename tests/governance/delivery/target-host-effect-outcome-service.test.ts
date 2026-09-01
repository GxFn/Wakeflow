import { equal, rejects } from "node:assert/strict";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { executeDemandEventSourcingCommand } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import {
  closeDemandOperationAuthorityContext,
  openDemandOperationAuthorityContext,
} from "../../../src/governance/demand/demand-operation-authority-context.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { TargetHostEffectClaimService } from "../../../src/governance/delivery/target-host-effect-claim-service.js";
import {
  TargetHostEffectOutcomeService,
  TargetHostEffectOutcomeServiceError,
} from "../../../src/governance/delivery/target-host-effect-outcome-service.js";
import { loadTargetHostEffectOutcomeSources } from "../../../src/governance/delivery/target-host-effect-outcome-authority.js";
import { parseTargetHostEffectOutcomeRequest } from "../../../src/governance/delivery/target-host-effect-outcome-input.js";
import { targetDeliveryHostEffectObservationCommitId } from "../../../src/governance/delivery/target-delivery-host-effect-observation.js";
import { WINDOW_WORK_CLAIMS_ROOT_REF } from "../../../src/governance/delivery/window-work-claim-resource-catalog.js";
import { WINDOW_WORK_CLAIM_DIRECTORY_MODE } from "../../../src/governance/delivery/window-work-claim-store.js";
import { inspectWindowWorkClaim } from "../../../src/governance/delivery/window-work-claim-store.js";
import {
  CLAIMED_AT,
  claimUuidFactory,
  cleanupTargetHostEffectClaimWorkspaceFixture,
  createTargetHostEffectClaimWorkspaceFixture,
} from "./target-host-effect-claim-service.fixture.js";

const OUTCOME_OBSERVED_AT = parseUtcInstant("2026-08-29T12:03:00.000Z");
const RAW_HOST_RESULT = "private-host-result:must-not-survive";

async function auditAggregate(workspacePath: string, demandId: string) {
  const root = await RootedDirectory.open(
    `${workspacePath}/${demandFinalRootRef(demandId)}`,
  );
  try {
    return (await new DemandEventSourcingRepository(root).audit()).aggregate;
  } finally {
    await root.close();
  }
}

async function issueAction(
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
  return result.action;
}

function outcomeRequest(
  fixture: Awaited<
    ReturnType<typeof createTargetHostEffectClaimWorkspaceFixture>
  >,
  action: Awaited<ReturnType<typeof issueAction>>,
  status: "accepted" | "indeterminate" | "rejected-before-effect",
  readback: "confirmed" | "pending" | "unavailable",
) {
  return {
    demandId: fixture.intent.demandId,
    actionId: action.actionId,
    claimDigest: action.workClaim.claimDigest,
    attempt: {
      status,
      evidence: { raw: RAW_HOST_RESULT, status },
    },
    readback:
      readback === "unavailable"
        ? { status: "unavailable" as const }
        : {
            status: readback,
            evidence: { raw: RAW_HOST_RESULT, readback },
          },
    observedAt: OUTCOME_OBSERVED_AT,
  };
}

async function seedOutcomeEvent(
  fixture: Awaited<
    ReturnType<typeof createTargetHostEffectClaimWorkspaceFixture>
  >,
  requestValue: ReturnType<typeof outcomeRequest>,
) {
  const request = parseTargetHostEffectOutcomeRequest(requestValue);
  const context = await openDemandOperationAuthorityContext(
    fixture.workspaceRoot,
    request.demandId,
    undefined,
  );
  try {
    const sources = await loadTargetHostEffectOutcomeSources(
      context,
      "codex",
      request,
      undefined,
    );
    return await executeDemandEventSourcingCommand(
      new DemandEventSourcingRepository(context.demandRoot),
      {
        commandType: "delivery.record-target-host-effect-observation",
        commandVersion: 1,
        observation: sources.observation,
      },
      {
        commitId: targetDeliveryHostEffectObservationCommitId(
          sources.claim.claimId,
        ),
        expectedStreamRevision: context.loaded.aggregate.streamRevision,
      },
    );
  } finally {
    await closeDemandOperationAuthorityContext(context);
  }
}

test("accepted outcome提交Event并保留当前Claim，精确重试不重复记录", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  try {
    const action = await issueAction(fixture);
    const request = outcomeRequest(fixture, action, "accepted", "pending");
    const service = new TargetHostEffectOutcomeService(
      fixture.workspaceRoot,
      "codex",
    );
    await rejects(
      service.record({
        ...request,
        claimDigest: parseSha256Digest(`sha256:${"9".repeat(64)}`),
      }),
      (error: unknown) =>
        error instanceof TargetHostEffectOutcomeServiceError &&
        error.reason === "state" &&
        error.eventAuthority === "unchanged",
    );
    const recorded = await service.record(request);
    equal(recorded.status, "recorded");
    equal(recorded.disposition, "committed");
    equal(recorded.effectDisposition, "accepted");
    equal(recorded.claimHandling, "retain");
    equal(recorded.claimAuthority, "current");
    equal(
      recorded.observation.observedAt < recorded.observation.action.issuedAt,
      true,
    );
    equal(
      JSON.stringify(recorded.observation).includes(RAW_HOST_RESULT),
      false,
    );
    equal(
      (await auditAggregate(fixture.workspacePath, fixture.intent.demandId))
        .state.targetTasks[0]?.phase,
      "host-effect-accepted",
    );
    equal(
      (
        await inspectWindowWorkClaim(
          fixture.workspaceRoot,
          fixture.intent.route.windowId,
        )
      ).status,
      "claimed",
    );

    const replayed = await service.record(request);
    equal(replayed.status, "already-recorded");
    equal(replayed.disposition, "idempotent");
    equal(
      replayed.observation.observationDigest,
      recorded.observation.observationDigest,
    );
    await rejects(
      service.record({
        ...request,
        claimDigest: parseSha256Digest(`sha256:${"9".repeat(64)}`),
      }),
      (error: unknown) =>
        error instanceof TargetHostEffectOutcomeServiceError &&
        error.reason === "state" &&
        error.eventAuthority === "current",
    );
  } finally {
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("Observed Event已提交后Claim结算读取失败仍报告Event current", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  const claimRootPath = path.join(
    fixture.workspacePath,
    ...WINDOW_WORK_CLAIMS_ROOT_REF.split("/"),
  );
  let claimRootRestricted = false;
  try {
    const action = await issueAction(fixture);
    const request = outcomeRequest(
      fixture,
      action,
      "rejected-before-effect",
      "unavailable",
    );
    await seedOutcomeEvent(fixture, request);
    await chmod(claimRootPath, 0o500);
    claimRootRestricted = true;

    await rejects(
      new TargetHostEffectOutcomeService(fixture.workspaceRoot, "codex").record(
        request,
      ),
      (error: unknown) =>
        error instanceof TargetHostEffectOutcomeServiceError &&
        error.reason === "claim" &&
        error.claimAuthority === "unknown" &&
        error.eventAuthority === "current",
    );

    await chmod(claimRootPath, WINDOW_WORK_CLAIM_DIRECTORY_MODE);
    claimRootRestricted = false;
    const recovered = await new TargetHostEffectOutcomeService(
      fixture.workspaceRoot,
      "codex",
    ).record(request);
    equal(recovered.status, "already-recorded");
    equal(recovered.claimAuthority, "released");
  } finally {
    if (claimRootRestricted) {
      await chmod(claimRootPath, WINDOW_WORK_CLAIM_DIRECTORY_MODE);
    }
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("indeterminate outcome保留Claim且不派生自动重试权限", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  try {
    const action = await issueAction(fixture);
    const recorded = await new TargetHostEffectOutcomeService(
      fixture.workspaceRoot,
      "codex",
    ).record(outcomeRequest(fixture, action, "indeterminate", "unavailable"));
    equal(recorded.effectDisposition, "indeterminate");
    equal(recorded.claimHandling, "retain");
    equal(recorded.claimAuthority, "current");
    equal(
      (await auditAggregate(fixture.workspacePath, fixture.intent.demandId))
        .state.targetTasks[0]?.phase,
      "host-effect-indeterminate",
    );
  } finally {
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("rejected-before-effect只接受无readback，Event提交后释放Claim", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  try {
    const action = await issueAction(fixture);
    const service = new TargetHostEffectOutcomeService(
      fixture.workspaceRoot,
      "codex",
    );
    await rejects(
      service.record(
        outcomeRequest(fixture, action, "rejected-before-effect", "confirmed"),
      ),
      (error: unknown) =>
        error instanceof TargetHostEffectOutcomeServiceError &&
        error.reason === "observation" &&
        error.eventAuthority === "unchanged",
    );
    equal(
      (await auditAggregate(fixture.workspacePath, fixture.intent.demandId))
        .streamRevision,
      4,
    );

    const request = outcomeRequest(
      fixture,
      action,
      "rejected-before-effect",
      "unavailable",
    );
    const recorded = await service.record(request);
    equal(recorded.effectDisposition, "rejected-before-effect");
    equal(recorded.claimHandling, "release-authorized");
    equal(recorded.claimAuthority, "released");
    equal(
      (await auditAggregate(fixture.workspacePath, fixture.intent.demandId))
        .state.targetTasks[0]?.phase,
      "host-effect-rejected",
    );
    equal(
      (
        await inspectWindowWorkClaim(
          fixture.workspaceRoot,
          fixture.intent.route.windowId,
        )
      ).status,
      "absent",
    );

    const replayed = await service.record(request);
    equal(replayed.status, "already-recorded");
    equal(replayed.claimAuthority, "released");
  } finally {
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("rejected Event已提交但Claim仍在时，重试只完成精确释放", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  try {
    const action = await issueAction(fixture);
    const request = outcomeRequest(
      fixture,
      action,
      "rejected-before-effect",
      "unavailable",
    );
    const seeded = await seedOutcomeEvent(fixture, request);
    equal(seeded.disposition, "committed");
    equal(
      (
        await inspectWindowWorkClaim(
          fixture.workspaceRoot,
          fixture.intent.route.windowId,
        )
      ).status,
      "claimed",
    );

    const recovered = await new TargetHostEffectOutcomeService(
      fixture.workspaceRoot,
      "codex",
    ).record(request);
    equal(recovered.status, "already-recorded");
    equal(recovered.disposition, "idempotent");
    equal(recovered.claimAuthority, "released");
    equal(
      (
        await inspectWindowWorkClaim(
          fixture.workspaceRoot,
          fixture.intent.route.windowId,
        )
      ).status,
      "absent",
    );
  } finally {
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});
