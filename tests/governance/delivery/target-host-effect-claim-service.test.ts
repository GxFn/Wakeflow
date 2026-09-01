import { equal, notEqual, rejects, throws } from "node:assert/strict";
import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  openDemandOperationAuthorityContext,
  closeDemandOperationAuthorityContext,
} from "../../../src/governance/demand/demand-operation-authority-context.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import {
  TargetHostEffectClaimService,
  TargetHostEffectClaimServiceError,
} from "../../../src/governance/delivery/target-host-effect-claim-service.js";
import { loadTargetHostEffectClaimSources } from "../../../src/governance/delivery/target-host-effect-claim-authority.js";
import {
  allocateTargetHostEffectClaimIds,
  parseTargetHostEffectClaimRequest,
  TargetHostEffectClaimInputError,
} from "../../../src/governance/delivery/target-host-effect-claim-input.js";
import {
  createWindowWorkClaim,
  parseWindowWorkClaimId,
} from "../../../src/governance/delivery/window-work-claim.js";
import {
  createWindowWorkClaimInStore,
  inspectWindowWorkClaim,
} from "../../../src/governance/delivery/window-work-claim-store.js";
import { windowWorkClaimRef } from "../../../src/governance/delivery/window-work-claim-resource-catalog.js";
import {
  CLAIM_OBSERVED_AT,
  CLAIMED_AT,
  claimUuidFactory,
  cleanupTargetHostEffectClaimWorkspaceFixture,
  createTargetHostEffectClaimWorkspaceFixture,
} from "./target-host-effect-claim-service.fixture.js";

function service(
  root: Parameters<typeof openDemandOperationAuthorityContext>[0],
) {
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

async function seedUncommittedClaim(
  fixture: Awaited<
    ReturnType<typeof createTargetHostEffectClaimWorkspaceFixture>
  >,
) {
  const request = parseTargetHostEffectClaimRequest(fixture.claimRequest);
  const context = await openDemandOperationAuthorityContext(
    fixture.workspaceRoot,
    request.demandId,
    undefined,
  );
  try {
    const sources = await loadTargetHostEffectClaimSources(
      fixture.workspaceRoot,
      context,
      request,
      codexWorkspaceHostResourceProfile,
      codexWindowHostIdentityProfile,
      undefined,
    );
    const ids = allocateTargetHostEffectClaimIds(claimUuidFactory());
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
      { clock: () => CLAIMED_AT },
    );
    await createWindowWorkClaimInStore(fixture.workspaceRoot, claim);
    return claim;
  } finally {
    await closeDemandOperationAuthorityContext(context);
  }
}

test("首次Claim Event提交签发一次Action，重试只返回already-claimed", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  try {
    const claimService = service(fixture.workspaceRoot);
    const issued = await claimService.claim(fixture.claimRequest, {
      clock: () => CLAIMED_AT,
      uuidFactory: claimUuidFactory(),
    });
    equal(issued.status, "issued");
    equal(issued.disposition, "committed");
    equal(issued.action?.kind, "WakeflowTargetDeliveryAgentHostAction");
    equal(issued.action?.effect, "send-message-to-observed-target-window");
    equal(issued.action?.actionId, issued.claim.claimId);
    equal(issued.action?.bindingId, fixture.bindingId);
    equal(
      issued.action?.hostObservation.authorityDigest,
      issued.claim.hostObservation.authorityDigest,
    );
    equal(issued.action?.prompt.includes(fixture.workspacePath), true);
    equal(JSON.stringify(issued).includes(fixture.rawHandle), false);
    equal(
      /(?:expiresAt|ttl|retryAllowed)/u.test(JSON.stringify(issued.claim)),
      false,
    );
    const claimPath = path.join(
      fixture.workspacePath,
      ...windowWorkClaimRef(fixture.intent.route.windowId).split("/"),
    );
    equal(existsSync(claimPath), true);
    equal(statSync(claimPath).mode & 0o777, 0o600);
    equal(
      (await aggregate(fixture.workspacePath, fixture.intent.demandId)).state
        .targetTasks[0]?.phase,
      "host-effect-claimed",
    );

    const replayed = await claimService.claim(fixture.claimRequest, {
      clock: () => CLAIMED_AT,
    });
    equal(replayed.status, "already-claimed");
    equal(replayed.disposition, "idempotent");
    equal(replayed.action, null);
    equal(replayed.claim.claimId, issued.claim.claimId);
    equal(replayed.commandResult.aggregate.streamRevision, 4);
    const { workType: _workType, ...undiscriminated } = fixture.claimRequest;
    throws(
      () => parseTargetHostEffectClaimRequest(undiscriminated),
      (error: unknown) =>
        error instanceof TargetHostEffectClaimInputError &&
        error.reason === "input",
    );
  } finally {
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("不同当前Claim阻断同一window且不推进Demand事件", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  try {
    const foreign = createWindowWorkClaim(
      {
        claimId: parseWindowWorkClaimId(
          "window_work_claim_34343434-3434-4434-8434-343434343434",
        ),
        programId: fixture.intent.programId,
        target: {
          demandId: fixture.intent.demandId,
          targetTaskId: fixture.intent.target.targetTaskId,
          targetDeliveryId: fixture.intent.targetDeliveryId,
          intentDigest: parseSha256Digest(`sha256:${"1".repeat(64)}`),
          intentPreparedAt: fixture.intent.preparedAt,
        },
        route: {
          hostId: fixture.intent.route.hostId,
          windowId: fixture.intent.route.windowId,
          bindingId: fixture.intent.route.bindingId,
        },
        hostObservation: {
          authorityDigest: parseSha256Digest(`sha256:${"2".repeat(64)}`),
          observedAt: parseUtcInstant("2026-08-29T12:04:00.000Z"),
        },
        claimTransition: {
          commitId: parseWakeflowDurableIdOfKind(
            "demand-event-commit_45454545-4545-4454-8454-454545454545",
            "demand-event-commit",
          ),
          eventId: parseWakeflowDurableIdOfKind(
            "demand-event_56565656-5656-4565-8565-565656565656",
            "demand-event",
          ),
          expectedStreamRevision: 3,
          expectedStateDigest: parseSha256Digest(`sha256:${"3".repeat(64)}`),
        },
      },
      { clock: () => CLAIMED_AT },
    );
    await createWindowWorkClaimInStore(fixture.workspaceRoot, foreign);
    await rejects(
      service(fixture.workspaceRoot).claim(fixture.claimRequest, {
        clock: () => CLAIMED_AT,
        uuidFactory: claimUuidFactory(),
      }),
      (error: unknown) =>
        error instanceof TargetHostEffectClaimServiceError &&
        error.reason === "occupied" &&
        error.claimAuthority === "current" &&
        error.eventAuthority === "unchanged",
    );
    equal(
      (await aggregate(fixture.workspacePath, fixture.intent.demandId))
        .streamRevision,
      3,
    );
  } finally {
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("超过五分钟的Agent observation在创建Claim前被拒绝", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  try {
    await rejects(
      service(fixture.workspaceRoot).claim(fixture.claimRequest, {
        clock: () => parseUtcInstant("2026-08-29T12:10:01.000Z"),
        uuidFactory: claimUuidFactory(),
      }),
      (error: unknown) =>
        error instanceof TargetHostEffectClaimServiceError &&
        error.reason === "stale-observation" &&
        error.claimAuthority === "unchanged",
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
  } finally {
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("已有Claim文件但事件缺失时使用原身份前向提交并签发首次Action", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  try {
    const seeded = await seedUncommittedClaim(fixture);

    const recovered = await service(fixture.workspaceRoot).claim(
      fixture.claimRequest,
      { clock: () => CLAIMED_AT },
    );
    equal(recovered.status, "issued");
    equal(recovered.disposition, "committed");
    equal(recovered.claim.claimId, seeded.claimId);
    equal(recovered.action?.actionId, seeded.claimId);
  } finally {
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("非过期Claim可由同一Binding的新鲜observation前向恢复", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  try {
    const seeded = await seedUncommittedClaim(fixture);

    const recovered = await service(fixture.workspaceRoot).claim(
      {
        ...fixture.claimRequest,
        observation: {
          ...fixture.claimRequest.observation,
          observedAt: "2026-08-29T12:19:00.000Z",
        },
      },
      {
        clock: () => parseUtcInstant("2026-08-29T12:20:00.000Z"),
      },
    );
    equal(recovered.status, "issued");
    equal(recovered.claim.claimId, seeded.claimId);
    equal(recovered.claim.hostObservation.observedAt, CLAIM_OBSERVED_AT);
    equal(
      recovered.action?.hostObservation.observedAt,
      "2026-08-29T12:19:00.000Z",
    );
    notEqual(
      recovered.action?.hostObservation.authorityDigest,
      recovered.claim.hostObservation.authorityDigest,
    );
  } finally {
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("Claim创建后的Binding漂移会精确补偿Claim文件", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  try {
    const bindingEntry = readdirSync(fixture.bindingRootPath)[0];
    if (bindingEntry === undefined) throw new Error("Expected Binding entry.");
    const baseFactory = claimUuidFactory();
    let allocation = 0;
    await rejects(
      service(fixture.workspaceRoot).claim(fixture.claimRequest, {
        clock: () => CLAIMED_AT,
        uuidFactory: () => {
          allocation += 1;
          const value = baseFactory();
          if (allocation === 3) {
            unlinkSync(path.join(fixture.bindingRootPath, bindingEntry));
          }
          return value;
        },
      }),
      (error: unknown) =>
        error instanceof TargetHostEffectClaimServiceError &&
        error.reason === "binding" &&
        error.claimAuthority === "unchanged" &&
        error.eventAuthority === "unchanged",
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
    equal(
      (await aggregate(fixture.workspacePath, fixture.intent.demandId))
        .streamRevision,
      3,
    );
  } finally {
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});
