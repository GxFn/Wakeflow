import { equal, rejects } from "node:assert/strict";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  closeDemandOperationAuthorityContext,
  openDemandOperationAuthorityContext,
} from "../../../src/governance/demand/demand-operation-authority-context.js";
import {
  executeDemandEventSourcingCommand,
  DemandEventSourcingCommandHandlerError,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { TargetHostEffectClaimService } from "../../../src/governance/delivery/target-host-effect-claim-service.js";
import { TargetHostEffectOutcomeService } from "../../../src/governance/delivery/target-host-effect-outcome-service.js";
import { inspectWindowWorkClaim } from "../../../src/governance/delivery/window-work-claim-store.js";
import { WINDOW_WORK_CLAIMS_ROOT_REF } from "../../../src/governance/delivery/window-work-claim-resource-catalog.js";
import { WINDOW_WORK_CLAIM_DIRECTORY_MODE } from "../../../src/governance/delivery/window-work-claim-store.js";
import { targetResultRecordedCommitIdFromResult } from "../../../src/governance/result/target-result.js";
import { createImplementationTargetResult } from "../../../src/governance/result/implementation-target-result.js";
import {
  TargetResultImportService,
  TargetResultImportServiceError,
} from "../../../src/governance/result/target-result-import-service.js";
import { createImplementationTargetResultReport } from "../../../src/governance/result/implementation-target-result-report.js";
import { parseTargetResultImportRequest } from "../../../src/governance/result/target-result-import-input.js";
import {
  CLAIMED_AT,
  claimUuidFactory,
  cleanupTargetHostEffectClaimWorkspaceFixture,
  createTargetHostEffectClaimWorkspaceFixture,
} from "../delivery/target-host-effect-claim-service.fixture.js";
import { createImplementationTargetResultReportContentFixture } from "./implementation-target-result-report.fixture.js";

const OUTCOME_AT = parseUtcInstant("2026-08-29T12:06:00.000Z");
const REPORTED_AT = parseUtcInstant("2026-08-29T12:03:00.000Z");

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

async function loadTaskPackage(
  fixture: Awaited<
    ReturnType<typeof createTargetHostEffectClaimWorkspaceFixture>
  >,
) {
  const root = await RootedDirectory.open(
    path.join(
      fixture.workspacePath,
      ...demandFinalRootRef(fixture.intent.demandId).split("/"),
    ),
  );
  try {
    const located = await new DemandEventSourcingRepository(
      root,
    ).findTargetTaskPlannedEvent(fixture.intent.target.taskPackageId);
    if (located === null) throw new Error("Expected TaskPackage event.");
    return located.event.data.taskPackage;
  } finally {
    await root.close();
  }
}

async function prepareOutcome(
  fixture: Awaited<
    ReturnType<typeof createTargetHostEffectClaimWorkspaceFixture>
  >,
  status: "accepted" | "indeterminate",
) {
  const claimed = await new TargetHostEffectClaimService(
    fixture.workspaceRoot,
    codexWorkspaceHostResourceProfile,
    codexWindowHostIdentityProfile,
  ).claim(fixture.claimRequest, {
    clock: () => CLAIMED_AT,
    uuidFactory: claimUuidFactory(),
  });
  if (claimed.action === null) throw new Error("Expected issued Action.");
  const outcome = await new TargetHostEffectOutcomeService(
    fixture.workspaceRoot,
    "codex",
  ).record({
    demandId: fixture.intent.demandId,
    actionId: claimed.action.actionId,
    claimDigest: claimed.action.workClaim.claimDigest,
    attempt: { status, evidence: { fixture: status } },
    readback:
      status === "accepted"
        ? { status: "pending", evidence: { visible: false } }
        : { status: "unavailable" },
    observedAt: OUTCOME_AT,
  });
  return { claimed, outcome, taskPackage: await loadTaskPackage(fixture) };
}

function importRequest(
  fixture: Awaited<
    ReturnType<typeof createTargetHostEffectClaimWorkspaceFixture>
  >,
  actionId: string,
  observationDigest: string,
  taskPackage: Awaited<ReturnType<typeof loadTaskPackage>>,
) {
  return {
    demandId: fixture.intent.demandId,
    actionId,
    observationDigest,
    report: {
      workType: "implementation" as const,
      content:
        createImplementationTargetResultReportContentFixture(taskPackage),
    },
  };
}

async function seedResultEvent(
  fixture: Awaited<
    ReturnType<typeof createTargetHostEffectClaimWorkspaceFixture>
  >,
  requestValue: ReturnType<typeof importRequest>,
) {
  const request = parseTargetResultImportRequest(requestValue);
  const context = await openDemandOperationAuthorityContext(
    fixture.workspaceRoot,
    request.demandId,
    undefined,
  );
  try {
    const repository = new DemandEventSourcingRepository(context.demandRoot);
    const claimEvent = await repository.findTargetHostEffectClaimedEvent(
      request.actionId,
    );
    const preparedEvent =
      claimEvent === null
        ? null
        : await repository.findTargetDeliveryPreparedEvent(
            claimEvent.event.data.claim.target.targetDeliveryId,
          );
    const observedEvent = await repository.findTargetHostEffectObservedEvent(
      request.actionId,
    );
    if (
      claimEvent === null ||
      preparedEvent === null ||
      observedEvent === null
    ) {
      throw new Error("Expected complete result source events.");
    }
    const taskEvent = await repository.findTargetTaskPlannedEvent(
      preparedEvent.event.data.intent.target.taskPackageId,
    );
    if (
      taskEvent === null ||
      taskEvent.event.data.taskPackage.workType !== "implementation"
    ) {
      throw new Error("Expected implementation TaskPackage event.");
    }
    const result = createImplementationTargetResult({
      taskPackage: taskEvent.event.data.taskPackage,
      intent: preparedEvent.event.data.intent,
      claim: claimEvent.event.data.claim,
      observation: observedEvent.event.data.observation,
      report: createImplementationTargetResultReport(request.report.content, {
        clock: () => REPORTED_AT,
      }),
    });
    await rejects(
      executeDemandEventSourcingCommand(
        repository,
        {
          commandType: "result.record-target-result",
          commandVersion: 1,
          result,
        },
        {
          commitId: claimEvent.event.data.claim.claimTransition.commitId,
          expectedStreamRevision: context.loaded.aggregate.streamRevision,
        },
      ),
      (error: unknown) =>
        error instanceof DemandEventSourcingCommandHandlerError &&
        error.reason === "decision-rejected",
    );
    return await executeDemandEventSourcingCommand(
      repository,
      {
        commandType: "result.record-target-result",
        commandVersion: 1,
        result,
      },
      {
        commitId: targetResultRecordedCommitIdFromResult(result),
        expectedStreamRevision: context.loaded.aggregate.streamRevision,
      },
    );
  } finally {
    await closeDemandOperationAuthorityContext(context);
  }
}

test("accepted TargetResult Event提交后释放Claim且精确重试幂等", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  try {
    const { claimed, outcome, taskPackage } = await prepareOutcome(
      fixture,
      "accepted",
    );
    const request = importRequest(
      fixture,
      claimed.claim.claimId,
      outcome.observation.observationDigest,
      taskPackage,
    );
    const service = new TargetResultImportService(
      fixture.workspaceRoot,
      "codex",
    );
    const recorded = await service.import(request, {
      clock: () => REPORTED_AT,
    });
    equal(recorded.status, "recorded");
    equal(recorded.result.report.outcome, "completed");
    equal(
      recorded.result.report.reportedAt < recorded.result.hostEffect.observedAt,
      true,
    );
    equal(recorded.claimAuthority, "released");
    equal(
      (await aggregate(fixture.workspacePath, fixture.intent.demandId)).state
        .targetTasks[0]?.phase,
      "result-reported",
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

    const replayed = await service.import(request, {
      clock: () => parseUtcInstant("2026-08-29T12:20:00.000Z"),
    });
    equal(replayed.status, "already-recorded");
    equal(replayed.result.report.reportedAt, REPORTED_AT);
    await rejects(
      service.import({
        ...request,
        report: {
          ...request.report,
          content: {
            ...request.report.content,
            summary: "同一Action不能覆盖为另一份Agent Report。",
          },
        },
      }),
      (error: unknown) =>
        error instanceof TargetResultImportServiceError &&
        error.reason === "state" &&
        error.eventAuthority === "current",
    );
    await rejects(
      service.import({
        ...request,
        observationDigest: `sha256:${"f".repeat(64)}`,
      }),
      (error: unknown) =>
        error instanceof TargetResultImportServiceError &&
        error.reason === "state" &&
        error.eventAuthority === "current",
    );
    await rejects(
      new TargetResultImportService(
        fixture.workspaceRoot,
        "claude-code",
      ).import(request),
      (error: unknown) =>
        error instanceof TargetResultImportServiceError &&
        error.reason === "host" &&
        error.eventAuthority === "current",
    );
  } finally {
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("indeterminate transport可以由真实TargetResult关闭工作Claim", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  try {
    const { claimed, outcome, taskPackage } = await prepareOutcome(
      fixture,
      "indeterminate",
    );
    const recorded = await new TargetResultImportService(
      fixture.workspaceRoot,
      "codex",
    ).import(
      importRequest(
        fixture,
        claimed.claim.claimId,
        outcome.observation.observationDigest,
        taskPackage,
      ),
      {
        clock: () => REPORTED_AT,
      },
    );
    equal(recorded.result.hostEffect.disposition, "indeterminate");
    equal(recorded.claimAuthority, "released");
  } finally {
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("Result Event已提交但Claim仍在时，重试只完成精确释放", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  const claimRootPath = path.join(
    fixture.workspacePath,
    ...WINDOW_WORK_CLAIMS_ROOT_REF.split("/"),
  );
  let claimRootRestricted = false;
  try {
    const { claimed, outcome, taskPackage } = await prepareOutcome(
      fixture,
      "accepted",
    );
    const request = importRequest(
      fixture,
      claimed.claim.claimId,
      outcome.observation.observationDigest,
      taskPackage,
    );
    const seeded = await seedResultEvent(fixture, request);
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
    await chmod(claimRootPath, 0o500);
    claimRootRestricted = true;
    await rejects(
      new TargetResultImportService(fixture.workspaceRoot, "codex").import(
        request,
        { clock: () => REPORTED_AT },
      ),
      (error: unknown) =>
        error instanceof TargetResultImportServiceError &&
        error.reason === "claim" &&
        error.claimAuthority === "unknown" &&
        error.eventAuthority === "current",
    );
    await chmod(claimRootPath, WINDOW_WORK_CLAIM_DIRECTORY_MODE);
    claimRootRestricted = false;
    const recovered = await new TargetResultImportService(
      fixture.workspaceRoot,
      "codex",
    ).import(request, { clock: () => REPORTED_AT });
    equal(recovered.status, "already-recorded");
    equal(recovered.claimAuthority, "released");
  } finally {
    if (claimRootRestricted) {
      await chmod(claimRootPath, WINDOW_WORK_CLAIM_DIRECTORY_MODE);
    }
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});
