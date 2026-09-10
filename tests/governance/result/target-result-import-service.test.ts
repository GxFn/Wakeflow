import { equal, rejects } from "node:assert/strict";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
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
import { targetResultRecordedCommitIdFromResult } from "../../../src/governance/result/target-result.js";
import { createImplementationTargetResult } from "../../../src/governance/result/implementation-target-result.js";
import {
  TargetResultImportService,
  TargetResultImportServiceError,
} from "../../../src/governance/result/target-result-import-service.js";
import { createImplementationTargetResultReport } from "../../../src/governance/result/implementation-target-result-report.js";
import { parseTargetResultImportRequest } from "../../../src/governance/result/target-result-import-input.js";
import { deriveDurableId } from "../../../src/kernel/ids.js";
import { WORK_CLAIMS_ROOT_REF } from "../../../src/kernel/layout.js";
import { inspectWorkClaim } from "../../../src/kernel/work-claims.js";
import {
  cleanupDeliveryWorkspaceFixture,
  createDeliveryWorkspaceFixture,
  deliverFixtureTarget,
  loadFixtureDeliveryOutcome,
  prepareFixtureDelivery,
  recordFixtureDeliveryOutcome,
  type DeliveredTarget,
  type DeliveryWorkspaceFixture,
} from "../delivery/delivery-workspace.fixture.js";
import { createImplementationTargetResultReportContentFixture } from "./implementation-target-result-report.fixture.js";
import { deliveryBindingFromOutcome } from "./target-result.fixture.js";

const REPORTED_AT = parseUtcInstant("2026-08-29T12:10:00.000Z");
const CLAIM_DIRECTORY_MODE = 0o700;

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

async function loadTaskPackage(fixture: Readonly<DeliveryWorkspaceFixture>) {
  const root = await RootedDirectory.open(
    path.join(fixture.workspacePath, ...demandFinalRootRef(fixture.demandId).split("/")),
  );
  try {
    const located = await new DemandEventSourcingRepository(root).findTargetTaskPlannedEvent(
      fixture.taskPackageId,
    );
    if (located === null) throw new Error("Expected TaskPackage event.");
    return located.event.data.taskPackage;
  } finally {
    await root.close();
  }
}

async function importRequest(
  fixture: Readonly<DeliveryWorkspaceFixture>,
  delivered: Readonly<Pick<DeliveredTarget, "prepared">>,
) {
  return {
    demandId: fixture.demandId,
    deliveryId: delivered.prepared.delivery.deliveryId,
    claimDigest: delivered.prepared.permit.fence.claimDigest,
    report: {
      workType: "implementation" as const,
      content: createImplementationTargetResultReportContentFixture(await loadTaskPackage(fixture)),
    },
  };
}

async function seedResultEvent(
  fixture: Readonly<DeliveryWorkspaceFixture>,
  delivered: Readonly<DeliveredTarget>,
  requestValue: Awaited<ReturnType<typeof importRequest>>,
) {
  const request = parseTargetResultImportRequest(requestValue);
  const outcome = await loadFixtureDeliveryOutcome(fixture, request.deliveryId);
  const context = await openDemandOperationAuthorityContext(
    fixture.workspaceRoot,
    request.demandId,
    undefined,
  );
  try {
    const repository = new DemandEventSourcingRepository(context.demandRoot);
    const taskEvent = await repository.findTargetTaskPlannedEvent(
      delivered.envelope.target.taskPackageId,
    );
    if (taskEvent === null || taskEvent.event.data.taskPackage.workType !== "implementation") {
      throw new Error("Expected implementation TaskPackage event.");
    }
    const result = createImplementationTargetResult({
      taskPackage: taskEvent.event.data.taskPackage,
      envelope: delivered.envelope,
      delivery: deliveryBindingFromOutcome(outcome),
      report: createImplementationTargetResultReport(request.report.content, {
        clock: () => REPORTED_AT,
      }),
    });
    await rejects(
      executeDemandEventSourcingCommand(
        repository,
        { commandType: "result.record-target-result", commandVersion: 1, result },
        {
          commitId: deriveDurableId("demand-event-commit", "wrong-result-commit", request.demandId),
          expectedStreamRevision: context.loaded.aggregate.streamRevision,
        },
      ),
      (error: unknown) =>
        error instanceof DemandEventSourcingCommandHandlerError &&
        error.reason === "decision-rejected",
    );
    return await executeDemandEventSourcingCommand(
      repository,
      { commandType: "result.record-target-result", commandVersion: 1, result },
      {
        commitId: targetResultRecordedCommitIdFromResult(result),
        expectedStreamRevision: context.loaded.aggregate.streamRevision,
      },
    );
  } finally {
    await closeDemandOperationAuthorityContext(context);
  }
}

test("accepted TargetResult Event提交后释放声明且精确重试幂等；围栏、宿主与报告漂移被拒", async () => {
  const fixture = await createDeliveryWorkspaceFixture();
  try {
    const delivered = await deliverFixtureTarget(fixture);
    const request = await importRequest(fixture, delivered);
    const service = new TargetResultImportService(fixture.workspaceRoot, "codex");
    await rejects(
      service.import({ ...request, claimDigest: `sha256:${"f".repeat(64)}` }),
      (error: unknown) =>
        error instanceof TargetResultImportServiceError && error.reason === "fence",
    );
    await rejects(
      new TargetResultImportService(fixture.workspaceRoot, "claude-code").import(request),
      (error: unknown) =>
        error instanceof TargetResultImportServiceError && error.reason === "host",
    );
    const recorded = await service.import(request, { clock: () => REPORTED_AT });
    equal(recorded.status, "recorded");
    equal(recorded.result.report.outcome, "completed");
    equal(recorded.result.deliveryId, delivered.prepared.delivery.deliveryId);
    equal(recorded.result.delivery.disposition, "accepted");
    equal(recorded.result.delivery.fence.claimDigest, delivered.prepared.permit.fence.claimDigest);
    equal(recorded.claimAuthority, "released");
    equal(
      (await aggregate(fixture.workspacePath, fixture.demandId)).state.targetTasks[0]?.phase,
      "result-reported",
    );
    equal((await inspectWorkClaim(fixture.workspaceRoot, fixture.route.windowId)).status, "absent");

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
          content: { ...request.report.content, summary: "同一投递不能覆盖为另一份Agent Report。" },
        },
      }),
      (error: unknown) =>
        error instanceof TargetResultImportServiceError &&
        error.reason === "state" &&
        error.eventAuthority === "current",
    );
    await rejects(
      new TargetResultImportService(fixture.workspaceRoot, "claude-code").import(request),
      (error: unknown) =>
        error instanceof TargetResultImportServiceError && error.reason === "host",
    );
  } finally {
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});

test("indeterminate 结局可以由真实 TargetResult 关闭工作声明", async () => {
  const fixture = await createDeliveryWorkspaceFixture();
  try {
    const prepared = await prepareFixtureDelivery(fixture);
    const recorded = await recordFixtureDeliveryOutcome(fixture, prepared, {
      attempt: { status: "sent" },
      readback: { status: "unavailable" },
    });
    equal(recorded.outcome.disposition, "indeterminate");
    equal(recorded.outcome.claimHandling, "retain");
    const imported = await new TargetResultImportService(fixture.workspaceRoot, "codex").import(
      await importRequest(fixture, { prepared }),
      { clock: () => REPORTED_AT },
    );
    equal(imported.result.delivery.disposition, "indeterminate");
    equal(imported.claimAuthority, "released");
    equal((await inspectWorkClaim(fixture.workspaceRoot, fixture.route.windowId)).status, "absent");
  } finally {
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});

test("Result Event已提交但声明仍在时，重试只完成精确释放", async () => {
  const fixture = await createDeliveryWorkspaceFixture();
  const claimRootPath = path.join(fixture.workspacePath, ...WORK_CLAIMS_ROOT_REF.split("/"));
  let claimRootRestricted = false;
  try {
    const delivered = await deliverFixtureTarget(fixture);
    const request = await importRequest(fixture, delivered);
    const seeded = await seedResultEvent(fixture, delivered, request);
    equal(seeded.disposition, "committed");
    equal((await inspectWorkClaim(fixture.workspaceRoot, fixture.route.windowId)).status, "claimed");
    await chmod(claimRootPath, 0o500);
    claimRootRestricted = true;
    await rejects(
      new TargetResultImportService(fixture.workspaceRoot, "codex").import(request, {
        clock: () => REPORTED_AT,
      }),
      (error: unknown) =>
        error instanceof TargetResultImportServiceError &&
        error.reason === "claim" &&
        error.claimAuthority === "unknown" &&
        error.eventAuthority === "current",
    );
    await chmod(claimRootPath, CLAIM_DIRECTORY_MODE);
    claimRootRestricted = false;
    const recovered = await new TargetResultImportService(fixture.workspaceRoot, "codex").import(
      request,
      { clock: () => REPORTED_AT },
    );
    equal(recovered.status, "already-recorded");
    equal(recovered.claimAuthority, "released");
    equal((await inspectWorkClaim(fixture.workspaceRoot, fixture.route.windowId)).status, "absent");
  } finally {
    if (claimRootRestricted) await chmod(claimRootPath, CLAIM_DIRECTORY_MODE);
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});
