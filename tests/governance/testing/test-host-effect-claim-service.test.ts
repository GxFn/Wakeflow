import { equal, rejects, throws } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import {
  closeDemandOperationAuthorityContext,
  openDemandOperationAuthorityContext,
} from "../../../src/governance/demand/demand-operation-authority-context.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import {
  TargetHostEffectClaimService,
  TargetHostEffectClaimServiceError,
} from "../../../src/governance/delivery/target-host-effect-claim-service.js";
import {
  parseTargetHostEffectClaimRequest,
  allocateTargetHostEffectClaimIds,
  TargetHostEffectClaimInputError,
} from "../../../src/governance/delivery/target-host-effect-claim-input.js";
import { createWindowWorkClaim } from "../../../src/governance/delivery/window-work-claim.js";
import {
  createWindowWorkClaimInStore,
  inspectWindowWorkClaim,
} from "../../../src/governance/delivery/window-work-claim-store.js";
import { readDemandPostAcceptanceRoute } from "../../../src/governance/review/demand-post-acceptance-route.js";
import { loadTestHostEffectClaimSources } from "../../../src/governance/testing/test-host-effect-claim-authority.js";
import {
  TEST_CLAIMED_AT,
  cleanupTestHostEffectClaimWorkspaceFixture,
  createTestHostEffectClaimWorkspaceFixture,
  testClaimUuidFactory,
} from "./test-host-effect-claim-service.fixture.js";

function service(root: RootedDirectory): TargetHostEffectClaimService {
  return new TargetHostEffectClaimService(
    root,
    codexWorkspaceHostResourceProfile,
    codexWindowHostIdentityProfile,
  );
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

async function seedUncommittedTestClaim(
  fixture: Awaited<
    ReturnType<typeof createTestHostEffectClaimWorkspaceFixture>
  >,
) {
  const request = parseTargetHostEffectClaimRequest(fixture.testClaimRequest);
  if (request.workType !== "test") throw new Error("Expected Test request.");
  const context = await openDemandOperationAuthorityContext(
    fixture.workspaceRoot,
    request.demandId,
    undefined,
  );
  try {
    const sources = await loadTestHostEffectClaimSources(
      fixture.workspaceRoot,
      context,
      request,
      codexWorkspaceHostResourceProfile,
      codexWindowHostIdentityProfile,
      undefined,
    );
    const ids = allocateTargetHostEffectClaimIds(testClaimUuidFactory());
    const claim = createWindowWorkClaim(
      {
        claimId: ids.claimId,
        programId: context.loaded.identity.programId,
        target: {
          demandId: request.demandId,
          targetTaskId: request.targetTaskId,
          targetDeliveryId: request.targetDeliveryId,
          intentDigest: request.intentDigest,
          intentPreparedAt: sources.intent.preparedAt,
          workType: "test",
          testAttemptId: sources.intent.attempt.testAttemptId,
          testDispatchPacketDigest: sources.packet.packetDigest,
        },
        route: sources.intent.route,
        hostObservation: {
          authorityDigest: sources.observationAuthority.authorityDigest,
          observedAt: sources.observationAuthority.rootAttestation.observedAt,
        },
        claimTransition: {
          commitId: ids.commitId,
          eventId: ids.eventId,
          expectedStreamRevision: context.loaded.aggregate.streamRevision,
          expectedStateDigest: context.loaded.aggregate.stateDigest,
        },
      },
      { clock: () => TEST_CLAIMED_AT },
    );
    await createWindowWorkClaimInStore(fixture.workspaceRoot, claim);
    return claim;
  } finally {
    await closeDemandOperationAuthorityContext(context);
  }
}

test("首次Test Claim提交共享Event并只签发一次packet-bound Action", async () => {
  const fixture = await createTestHostEffectClaimWorkspaceFixture();
  try {
    const before = await aggregate(
      fixture.workspacePath,
      fixture.testClaimRequest.demandId,
    );
    const owner = service(fixture.workspaceRoot);
    const issued = await owner.claim(fixture.testClaimRequest, {
      clock: () => TEST_CLAIMED_AT,
      uuidFactory: testClaimUuidFactory(),
    });
    equal(issued.status, "issued");
    equal(issued.disposition, "committed");
    equal(
      issued.commandResult.commit.events[0]?.eventType,
      "delivery.target-host-effect-claimed",
    );
    equal(issued.claim.target.workType, "test");
    if (issued.claim.target.workType !== "test") {
      throw new Error("Expected exact Test WindowWorkClaim target.");
    }
    equal(issued.claim.target.testAttemptId, fixture.testAttemptId);
    equal(
      issued.claim.target.testDispatchPacketDigest,
      fixture.testDispatchPacketDigest,
    );
    equal(issued.action?.kind, "WakeflowTestDeliveryAgentHostAction");
    equal(issued.action?.effect, "send-message-to-observed-target-window");
    if (issued.action?.kind !== "WakeflowTestDeliveryAgentHostAction") {
      throw new Error("Expected Test Agent Host Action.");
    }
    equal(issued.action.testAttemptId, fixture.testAttemptId);
    equal(
      issued.action.testDispatchPacket.digest,
      fixture.testDispatchPacketDigest,
    );
    equal(issued.action.prompt.includes(fixture.workspacePath), true);
    equal(JSON.stringify(issued).includes(fixture.testRawHandle), false);
    equal(Object.hasOwn(issued.action, "sendResult"), false);
    equal(Object.hasOwn(issued.action, "readback"), false);

    const after = await aggregate(
      fixture.workspacePath,
      fixture.testClaimRequest.demandId,
    );
    equal(after.streamRevision, before.streamRevision + 1);
    const target = after.state.targetTasks.find(
      (entry) => entry.targetTaskId === fixture.testTargetTaskId,
    );
    equal(target?.phase, "test-host-effect-claimed");
    if (
      target?.workType !== "test" ||
      target.phase !== "test-host-effect-claimed"
    ) {
      throw new Error("Expected claimed Test target.");
    }
    equal(
      target.currentDelivery.workClaim.testDispatchPacketDigest,
      fixture.testDispatchPacketDigest,
    );
    const route = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.testClaimRequest.demandId,
    );
    equal(route.nextStage.status, "test-host-effect-claimed");

    const replayed = await owner.claim(fixture.testClaimRequest, {
      clock: () => TEST_CLAIMED_AT,
    });
    equal(replayed.status, "already-claimed");
    equal(replayed.disposition, "idempotent");
    equal(replayed.action, null);
    equal(replayed.claim.claimId, issued.claim.claimId);
    equal(
      replayed.commandResult.aggregate.streamRevision,
      after.streamRevision,
    );
  } finally {
    await cleanupTestHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("Test Claim在创建窗口占用前拒绝未审阅的packet digest", async () => {
  const fixture = await createTestHostEffectClaimWorkspaceFixture();
  try {
    const before = await aggregate(
      fixture.workspacePath,
      fixture.testClaimRequest.demandId,
    );
    await rejects(
      service(fixture.workspaceRoot).claim(
        {
          ...fixture.testClaimRequest,
          testDispatchPacketDigest: parseSha256Digest(
            `sha256:${"f".repeat(64)}`,
          ),
        },
        {
          clock: () => TEST_CLAIMED_AT,
          uuidFactory: testClaimUuidFactory(),
        },
      ),
      (error: unknown) =>
        error instanceof TargetHostEffectClaimServiceError &&
        error.reason === "packet" &&
        error.claimAuthority === "unchanged" &&
        error.eventAuthority === "unchanged",
    );
    equal(
      (
        await inspectWindowWorkClaim(
          fixture.workspaceRoot,
          fixture.testCard.testWindowId,
        )
      ).status,
      "absent",
    );
    equal(
      (
        await aggregate(
          fixture.workspacePath,
          fixture.testClaimRequest.demandId,
        )
      ).streamRevision,
      before.streamRevision,
    );
    const {
      testDispatchPacketDigest: _testDispatchPacketDigest,
      ...incomplete
    } = fixture.testClaimRequest;
    throws(
      () => parseTargetHostEffectClaimRequest(incomplete),
      (error: unknown) =>
        error instanceof TargetHostEffectClaimInputError &&
        error.reason === "input",
    );
  } finally {
    await cleanupTestHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("已有Test Claim文件但Event缺失时前向完成且只签发首次Action", async () => {
  const fixture = await createTestHostEffectClaimWorkspaceFixture();
  try {
    const seeded = await seedUncommittedTestClaim(fixture);
    const recovered = await service(fixture.workspaceRoot).claim(
      fixture.testClaimRequest,
      { clock: () => TEST_CLAIMED_AT },
    );
    equal(recovered.status, "issued");
    equal(recovered.disposition, "committed");
    equal(recovered.claim.claimId, seeded.claimId);
    equal(recovered.action?.kind, "WakeflowTestDeliveryAgentHostAction");
    equal(recovered.action?.actionId, seeded.claimId);
  } finally {
    await cleanupTestHostEffectClaimWorkspaceFixture(fixture);
  }
});
