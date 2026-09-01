import { equal, rejects, throws } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { TargetHostEffectClaimService } from "../../../src/governance/delivery/target-host-effect-claim-service.js";
import { TargetHostEffectOutcomeService } from "../../../src/governance/delivery/target-host-effect-outcome-service.js";
import {
  TargetHostEffectRearmService,
  TargetHostEffectRearmServiceError,
} from "../../../src/governance/delivery/target-host-effect-rearm-service.js";
import {
  parseTargetHostEffectOutcomeRequest,
  TargetHostEffectOutcomeInputError,
} from "../../../src/governance/delivery/target-host-effect-outcome-input.js";
import { inspectWindowWorkClaim } from "../../../src/governance/delivery/window-work-claim-store.js";
import { readDemandPostAcceptanceRoute } from "../../../src/governance/review/demand-post-acceptance-route.js";
import {
  TestDeliveryPreparationService,
  TestDeliveryPreparationServiceError,
} from "../../../src/governance/testing/test-delivery-preparation-service.js";
import { executeTestDeliveryPreparationPublicRequest } from "../../../src/governance/testing/test-delivery-preparation-public-coordinator.js";
import { TestDispatchProjectionStore } from "../../../src/governance/testing/test-dispatch-projection-store.js";
import {
  TEST_CLAIMED_AT,
  cleanupTestHostEffectClaimWorkspaceFixture,
  createTestHostEffectClaimWorkspaceFixture,
  testClaimUuidFactory,
} from "./test-host-effect-claim-service.fixture.js";

const TEST_OUTCOME_OBSERVED_AT = parseUtcInstant("2026-08-29T12:30:00.000Z");
const TEST_REPLACEMENT_PREPARED_AT = parseUtcInstant(
  "2026-08-29T12:18:00.000Z",
);
const TEST_REPLACEMENT_CLAIM_OBSERVED_AT = parseUtcInstant(
  "2026-08-29T12:35:00.000Z",
);
const TEST_REPLACEMENT_CLAIMED_AT = parseUtcInstant("2026-08-29T12:36:00.000Z");
const RAW_HOST_RESULT = "private-test-host-result:must-not-survive";

const CODEX_TEST_DELIVERY_FACADE = Object.freeze({
  hostId: "codex" as const,
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
});

function replacementDeliveryUuidFactory(): () => string {
  const values = [
    "c5c5c5c5-c5c5-45c5-85c5-c5c5c5c5c5c5",
    "c6c6c6c6-c6c6-46c6-86c6-c6c6c6c6c6c6",
    "c7c7c7c7-c7c7-47c7-87c7-c7c7c7c7c7c7",
  ];
  let index = 0;
  return () => values[index++] ?? "invalid";
}

function replacementClaimUuidFactory(): () => string {
  const values = [
    "cacacaca-caca-4aca-8aca-cacacacacaca",
    "cbcbcbcb-cbcb-4bcb-8bcb-cbcbcbcbcbcb",
    "cececece-cece-4ece-8ece-cececececece",
  ];
  let index = 0;
  return () => values[index++] ?? "invalid";
}

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

async function issueTestAction(
  fixture: Awaited<
    ReturnType<typeof createTestHostEffectClaimWorkspaceFixture>
  >,
) {
  const result = await new TargetHostEffectClaimService(
    fixture.workspaceRoot,
    codexWorkspaceHostResourceProfile,
    codexWindowHostIdentityProfile,
  ).claim(fixture.testClaimRequest, {
    clock: () => TEST_CLAIMED_AT,
    uuidFactory: testClaimUuidFactory(),
  });
  if (result.action?.kind !== "WakeflowTestDeliveryAgentHostAction") {
    throw new Error("Expected first Test Action issuance.");
  }
  return result.action;
}

function outcomeRequest(
  fixture: Awaited<
    ReturnType<typeof createTestHostEffectClaimWorkspaceFixture>
  >,
  action: Awaited<ReturnType<typeof issueTestAction>>,
  status: "accepted" | "indeterminate" | "rejected-before-effect",
  readback: "confirmed" | "pending" | "unavailable",
) {
  return {
    demandId: fixture.testClaimRequest.demandId,
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
    observedAt: TEST_OUTCOME_OBSERVED_AT,
  };
}

test("Test accepted host effect记录共享Event、保留Claim并进入Result planning", async () => {
  const fixture = await createTestHostEffectClaimWorkspaceFixture();
  try {
    const action = await issueTestAction(fixture);
    const owner = new TargetHostEffectOutcomeService(
      fixture.workspaceRoot,
      "codex",
    );
    const request = outcomeRequest(fixture, action, "accepted", "pending");
    const recorded = await owner.record(request);
    equal(recorded.status, "recorded");
    equal(recorded.effectDisposition, "accepted");
    equal(recorded.claimHandling, "retain");
    equal(recorded.claimAuthority, "current");
    equal(
      recorded.observation.observedAt < recorded.observation.action.issuedAt,
      true,
    );
    equal(recorded.observation.action.workType, "test");
    if (recorded.observation.action.workType !== "test") {
      throw new Error("Expected Test observation action.");
    }
    equal(recorded.observation.action.testAttemptId, fixture.testAttemptId);
    equal(
      recorded.observation.action.testDispatchPacketDigest,
      fixture.testDispatchPacketDigest,
    );
    equal(
      JSON.stringify(recorded.observation).includes(RAW_HOST_RESULT),
      false,
    );
    equal(
      recorded.commandResult.commit.events[0]?.eventType,
      "delivery.target-host-effect-observed",
    );
    const state = await aggregate(
      fixture.workspacePath,
      fixture.testClaimRequest.demandId,
    );
    const target = state.state.targetTasks.find(
      (entry) => entry.targetTaskId === fixture.testTargetTaskId,
    );
    equal(target?.phase, "test-host-effect-accepted");
    equal(
      (
        await inspectWindowWorkClaim(
          fixture.workspaceRoot,
          fixture.testCard.testWindowId,
        )
      ).status,
      "claimed",
    );
    equal(
      (
        await readDemandPostAcceptanceRoute(
          fixture.workspaceRoot,
          fixture.testClaimRequest.demandId,
        )
      ).nextStage.status,
      "test-result-planning",
    );

    const replayed = await owner.record(request);
    equal(replayed.status, "already-recorded");
    equal(replayed.disposition, "idempotent");
    equal(replayed.claimAuthority, "current");
    const { claimDigest: _claimDigest, ...incomplete } = request;
    throws(
      () => parseTargetHostEffectOutcomeRequest(incomplete),
      (error: unknown) =>
        error instanceof TargetHostEffectOutcomeInputError &&
        error.reason === "input",
    );
  } finally {
    await cleanupTestHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("Test rejected-before-effect先记录Event再释放Claim并进入replacement planning", async () => {
  const fixture = await createTestHostEffectClaimWorkspaceFixture();
  try {
    const action = await issueTestAction(fixture);
    const owner = new TargetHostEffectOutcomeService(
      fixture.workspaceRoot,
      "codex",
    );
    const request = outcomeRequest(
      fixture,
      action,
      "rejected-before-effect",
      "unavailable",
    );
    const recorded = await owner.record(request);
    equal(recorded.status, "recorded");
    equal(recorded.effectDisposition, "rejected-before-effect");
    equal(recorded.claimHandling, "release-authorized");
    equal(recorded.claimAuthority, "released");
    equal(
      (
        await inspectWindowWorkClaim(
          fixture.workspaceRoot,
          fixture.testCard.testWindowId,
        )
      ).status,
      "absent",
    );
    const state = await aggregate(
      fixture.workspacePath,
      fixture.testClaimRequest.demandId,
    );
    const target = state.state.targetTasks.find(
      (entry) => entry.targetTaskId === fixture.testTargetTaskId,
    );
    equal(target?.phase, "test-host-effect-rejected");
    equal(
      (
        await readDemandPostAcceptanceRoute(
          fixture.workspaceRoot,
          fixture.testClaimRequest.demandId,
        )
      ).nextStage.status,
      "test-delivery-replacement-planning",
    );
    await rejects(
      new TargetHostEffectRearmService(
        fixture.workspaceRoot,
        codexWorkspaceHostResourceProfile,
        codexWindowHostIdentityProfile,
      ).rearm({
        demandId: fixture.testClaimRequest.demandId,
        actionId: action.actionId,
        observationDigest: recorded.observation.observationDigest,
      }),
      (error: unknown) =>
        error instanceof TargetHostEffectRearmServiceError &&
        error.reason === "observation" &&
        error.eventAuthority === "unchanged",
    );

    const replayed = await owner.record(request);
    equal(replayed.status, "already-recorded");
    equal(replayed.claimAuthority, "released");
  } finally {
    await cleanupTestHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("Test rejected-before-effect显式追加同一attempt的替代授权并准入下一次Claim", async () => {
  const fixture = await createTestHostEffectClaimWorkspaceFixture();
  let demandRoot: RootedDirectory | undefined;
  try {
    const action = await issueTestAction(fixture);
    const outcome = await new TargetHostEffectOutcomeService(
      fixture.workspaceRoot,
      "codex",
    ).record(
      outcomeRequest(fixture, action, "rejected-before-effect", "unavailable"),
    );
    const preparation = new TestDeliveryPreparationService(
      fixture.workspaceRoot,
      codexWorkspaceHostResourceProfile,
      codexWindowHostIdentityProfile,
    );
    await rejects(
      preparation.preview({
        mode: "replacement-authorization",
        demandId: fixture.testClaimRequest.demandId,
        targetTaskId: fixture.testClaimRequest.targetTaskId,
        previousTargetDeliveryId: fixture.targetDeliveryId,
        actionId: action.actionId,
        observationDigest:
          "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      }),
      (error: unknown) =>
        error instanceof TestDeliveryPreparationServiceError &&
        error.reason === "input",
    );

    const before = await aggregate(
      fixture.workspacePath,
      fixture.testClaimRequest.demandId,
    );
    const preview = await executeTestDeliveryPreparationPublicRequest(
      CODEX_TEST_DELIVERY_FACADE,
      {
        root: fixture.workspacePath,
        mode: "preview",
        demandId: fixture.testClaimRequest.demandId,
        targetTaskId: fixture.testClaimRequest.targetTaskId,
      },
      {
        preview: {
          clock: () => TEST_REPLACEMENT_PREPARED_AT,
          uuidFactory: replacementDeliveryUuidFactory(),
        },
      },
    );
    if (preview.mode !== "preview") {
      throw new Error("Expected public Test Delivery replacement preview.");
    }
    const replacementIntent = preview.plan.intent;
    equal(replacementIntent.preparedAt, TEST_REPLACEMENT_PREPARED_AT);
    equal(replacementIntent.preparedAt < outcome.observation.observedAt, true);
    equal(
      (
        await aggregate(
          fixture.workspacePath,
          fixture.testClaimRequest.demandId,
        )
      ).streamRevision,
      before.streamRevision,
    );
    equal(replacementIntent.attempt.testAttemptId, fixture.testAttemptId);
    equal(
      replacementIntent.targetDeliveryId === fixture.targetDeliveryId,
      false,
    );
    equal(replacementIntent.replacement?.authorizationOrdinal, 2);
    equal(
      replacementIntent.replacement?.previousDelivery.targetDeliveryId,
      fixture.targetDeliveryId,
    );
    equal(
      replacementIntent.replacement?.rejectedHostEffect.claimId,
      action.actionId,
    );
    equal(
      replacementIntent.replacement?.rejectedHostEffect.observationDigest,
      outcome.observation.observationDigest,
    );

    const applied = await executeTestDeliveryPreparationPublicRequest(
      CODEX_TEST_DELIVERY_FACADE,
      {
        root: fixture.workspacePath,
        mode: "apply",
        plan: preview.plan,
        planDigest: preview.planDigest,
      },
    );
    if (applied.mode !== "apply") {
      throw new Error("Expected public Test Delivery replacement apply.");
    }
    equal(applied.disposition, "committed");
    equal(applied.testDelivery.authorizationKind, "replacement");
    const replayed = await executeTestDeliveryPreparationPublicRequest(
      CODEX_TEST_DELIVERY_FACADE,
      {
        root: fixture.workspacePath,
        mode: "apply",
        plan: preview.plan,
        planDigest: preview.planDigest,
      },
    );
    if (replayed.mode !== "apply") {
      throw new Error("Expected public Test Delivery replacement replay.");
    }
    equal(replayed.disposition, "idempotent");
    const prepared = await aggregate(
      fixture.workspacePath,
      fixture.testClaimRequest.demandId,
    );
    const target = prepared.state.targetTasks.find(
      (entry) => entry.targetTaskId === fixture.testTargetTaskId,
    );
    equal(target?.phase, "test-delivery-prepared");
    if (
      target?.workType !== "test" ||
      target.phase !== "test-delivery-prepared"
    ) {
      throw new Error("Expected replacement Test Delivery state.");
    }
    equal(target.testAttempts.length, 1);
    equal(target.testAttempts[0]?.attempt.testAttemptId, fixture.testAttemptId);
    equal(target.testAttempts[0]?.deliveryAuthorizations.length, 2);
    equal(
      target.testAttempts[0]?.deliveryAuthorizations[1]?.targetDeliveryId,
      replacementIntent.targetDeliveryId,
    );
    const firstAuthorization =
      target.testAttempts[0]?.deliveryAuthorizations[0];
    const replacementAuthorization =
      target.testAttempts[0]?.deliveryAuthorizations[1];
    if (
      firstAuthorization === undefined ||
      replacementAuthorization === undefined
    ) {
      throw new Error("Expected initial and replacement authorizations.");
    }
    equal(replacementAuthorization.preparedAt, TEST_REPLACEMENT_PREPARED_AT);
    equal(
      replacementAuthorization.preparedAt < firstAuthorization.preparedAt,
      true,
    );
    equal(Object.hasOwn(applied, "action"), false);

    demandRoot = await RootedDirectory.open(
      path.join(
        fixture.workspacePath,
        ...demandFinalRootRef(fixture.testClaimRequest.demandId).split("/"),
      ),
    );
    const packet = (
      await new TestDispatchProjectionStore(demandRoot).materialize(
        replacementIntent.targetDeliveryId,
      )
    ).packet.projection.packet;
    await demandRoot.close();
    demandRoot = undefined;
    equal(packet.source.intentDigest, replacementIntent.intentDigest);
    equal(packet.attempt.testAttemptId, fixture.testAttemptId);

    const nextClaim = await new TargetHostEffectClaimService(
      fixture.workspaceRoot,
      codexWorkspaceHostResourceProfile,
      codexWindowHostIdentityProfile,
    ).claim(
      {
        ...fixture.testClaimRequest,
        targetDeliveryId: replacementIntent.targetDeliveryId,
        intentDigest: replacementIntent.intentDigest,
        testDispatchPacketDigest: packet.packetDigest,
        observation: {
          ...fixture.testClaimRequest.observation,
          observedAt: TEST_REPLACEMENT_CLAIM_OBSERVED_AT,
        },
      },
      {
        clock: () => TEST_REPLACEMENT_CLAIMED_AT,
        uuidFactory: replacementClaimUuidFactory(),
      },
    );
    equal(nextClaim.status, "issued");
    equal(nextClaim.action?.kind, "WakeflowTestDeliveryAgentHostAction");
    if (nextClaim.action?.kind !== "WakeflowTestDeliveryAgentHostAction") {
      throw new Error("Expected replacement Test Action.");
    }
    equal(nextClaim.action.testAttemptId, fixture.testAttemptId);
    equal(nextClaim.action.testDispatchPacket.digest, packet.packetDigest);
  } finally {
    if (demandRoot !== undefined) await demandRoot.close();
    await cleanupTestHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("Test indeterminate outcome保留Claim且不产生自动重试授权", async () => {
  const fixture = await createTestHostEffectClaimWorkspaceFixture();
  try {
    const action = await issueTestAction(fixture);
    const recorded = await new TargetHostEffectOutcomeService(
      fixture.workspaceRoot,
      "codex",
    ).record(outcomeRequest(fixture, action, "indeterminate", "unavailable"));
    equal(recorded.effectDisposition, "indeterminate");
    equal(recorded.claimHandling, "retain");
    equal(recorded.claimAuthority, "current");
    equal(Object.hasOwn(recorded, "retryAllowed"), false);
    const state = await aggregate(
      fixture.workspacePath,
      fixture.testClaimRequest.demandId,
    );
    const target = state.state.targetTasks.find(
      (entry) => entry.targetTaskId === fixture.testTargetTaskId,
    );
    equal(target?.phase, "test-host-effect-indeterminate");
    equal(
      (
        await readDemandPostAcceptanceRoute(
          fixture.workspaceRoot,
          fixture.testClaimRequest.demandId,
        )
      ).nextStage.status,
      "test-result-planning",
    );
  } finally {
    await cleanupTestHostEffectClaimWorkspaceFixture(fixture);
  }
});
