import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { inspectActiveRoute } from "../../capabilities/demand/route.fixture.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import {
  parseTargetResultImportPublicRequest,
  TargetResultImportPublicContractError,
} from "../../../src/governance/result/target-result-import-public-contract.js";
import {
  executeTargetResultImportPublicRequest,
  TargetResultImportPublicCoordinatorError,
} from "../../../src/governance/result/target-result-import-public-coordinator.js";
import type { TaskPackage } from "../../../src/governance/tasking/task-package.js";
import {
  cleanupDeliveryWorkspaceFixture,
  createDeliveryWorkspaceFixture,
  deliverFixtureTarget,
} from "../delivery/delivery-workspace.fixture.js";
import {
  cleanupTestDeliveryWorkspaceFixture,
  createTestDeliveryWorkspaceFixture,
  deliverFixtureTestTarget,
} from "../delivery/test-delivery-workspace.fixture.js";
import { testResultReportContent } from "../review/controller-test-review-decision-service.fixture.js";
import { createImplementationTargetResultReportContentFixture } from "./implementation-target-result-report.fixture.js";

const CODEX_RESULT_FACADE = Object.freeze({ hostId: "codex" as const });
const CLAUDE_CODE_RESULT_FACADE = Object.freeze({
  hostId: "claude-code" as const,
});
const IMPLEMENTATION_REPORTED_AT = parseUtcInstant("2026-08-29T12:10:00.000Z");
const TEST_REPORTED_AT = parseUtcInstant("2026-08-29T12:40:00.000Z");

async function taskPackageForDelivery(
  workspacePath: string,
  demandId: string,
  deliveryId: string,
): Promise<Readonly<TaskPackage>> {
  const root = await RootedDirectory.open(
    path.join(workspacePath, ...demandFinalRootRef(demandId).split("/")),
  );
  try {
    const repository = new DemandEventSourcingRepository(root);
    const prepared = await repository.findDeliveryPreparedEvent(deliveryId);
    if (prepared === null) throw new Error("Expected Delivery Prepared Event.");
    const task = await repository.findTargetTaskPlannedEvent(
      prepared.event.data.envelope.target.taskPackageId,
    );
    if (task === null) throw new Error("Expected TaskPackage Event.");
    return task.event.data.taskPackage;
  } finally {
    await root.close();
  }
}

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

test("Result Import Public Coordinator生成Implementation TargetResult并释放Claim", async () => {
  const fixture = await createDeliveryWorkspaceFixture();
  try {
    const delivered = await deliverFixtureTarget(fixture);
    const taskPackage = await taskPackageForDelivery(
      fixture.workspacePath,
      fixture.demandId,
      delivered.prepared.delivery.deliveryId,
    );
    const request = {
      root: fixture.workspacePath,
      demandId: fixture.demandId,
      deliveryId: delivered.prepared.delivery.deliveryId,
      claimDigest: delivered.prepared.permit.fence.claimDigest,
      report: {
        workType: "implementation" as const,
        content:
          createImplementationTargetResultReportContentFixture(taskPackage),
      },
    };
    const parsed = parseTargetResultImportPublicRequest(request);
    equal(Object.isFrozen(parsed), true);
    equal(Object.isFrozen(parsed.report.content), true);
    throws(
      () => parseTargetResultImportPublicRequest(new Proxy(request, {})),
      (error: unknown) =>
        error instanceof TargetResultImportPublicContractError &&
        error.reason === "json",
    );
    throws(
      () =>
        parseTargetResultImportPublicRequest({
          ...request,
          report: {
            ...request.report,
            content: {
              ...request.report.content,
              summary: fixture.workspacePath,
            },
          },
        }),
      (error: unknown) =>
        error instanceof TargetResultImportPublicContractError &&
        error.reason === "privacy",
    );

    await rejects(
      executeTargetResultImportPublicRequest(
        { ...CODEX_RESULT_FACADE },
        request,
      ),
      (error: unknown) =>
        error instanceof TargetResultImportPublicCoordinatorError &&
        error.reason === "host" &&
        error.eventAuthority === "unchanged",
    );
    await rejects(
      executeTargetResultImportPublicRequest(
        CLAUDE_CODE_RESULT_FACADE,
        request,
      ),
      (error: unknown) =>
        error instanceof TargetResultImportPublicCoordinatorError &&
        error.reason === "host" &&
        error.causeReason === "host" &&
        error.eventAuthority === "unchanged",
    );

    const imported = await executeTargetResultImportPublicRequest(
      CODEX_RESULT_FACADE,
      request,
      { resultImport: { clock: () => IMPLEMENTATION_REPORTED_AT } },
    );
    equal(imported.status, "recorded");
    equal(imported.result.workType, "implementation");
    equal(imported.result.report.outcome, "completed");
    equal(imported.result.deliveryId, delivered.prepared.delivery.deliveryId);
    equal(imported.result.delivery.disposition, "accepted");
    equal(imported.claimAuthority, "released");
    equal(imported.eventAuthority, "current");
    equal(Object.hasOwn(imported, "controllerAccepted"), false);
    deepEqual(stringPathsContaining(imported, fixture.workspacePath), []);
    deepEqual(stringPathsContaining(imported, fixture.route.rawHandle), []);

    const route = await inspectActiveRoute({
      root: fixture.workspacePath,
      demandId: fixture.demandId,
    });
    equal(route.route.frontiers[0]?.kind, "implementation-result-review");

    await rejects(
      executeTargetResultImportPublicRequest(
        CLAUDE_CODE_RESULT_FACADE,
        request,
      ),
      (error: unknown) =>
        error instanceof TargetResultImportPublicCoordinatorError &&
        error.reason === "host",
    );

    const replayed = await executeTargetResultImportPublicRequest(
      CODEX_RESULT_FACADE,
      request,
    );
    equal(replayed.status, "already-recorded");
    equal(replayed.result.resultDigest, imported.result.resultDigest);
    equal(replayed.event.eventId, imported.event.eventId);
  } finally {
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});

test("Result Import Public Coordinator从Test Report生成共享TargetResult", async () => {
  const fixture = await createTestDeliveryWorkspaceFixture();
  try {
    const delivered = await deliverFixtureTestTarget(fixture);
    if (delivered.envelope.workType !== "test") throw new Error("Expected Test envelope.");
    const request = {
      root: fixture.workspacePath,
      demandId: fixture.demandId,
      deliveryId: delivered.prepared.delivery.deliveryId,
      claimDigest: delivered.prepared.permit.fence.claimDigest,
      report: {
        workType: "test" as const,
        content: testResultReportContent(fixture.testStepIds),
      },
    };
    const imported = await executeTargetResultImportPublicRequest(
      CODEX_RESULT_FACADE,
      request,
      { resultImport: { clock: () => TEST_REPORTED_AT } },
    );
    equal(imported.result.workType, "test");
    if (imported.result.workType !== "test") {
      throw new Error("Expected public Test TargetResult.");
    }
    equal(
      imported.result.testExecution?.testAttemptId,
      delivered.envelope.attempt.testAttemptId,
    );
    equal(imported.result.report.kind, "WakeflowTestTargetResultReport");
    equal(imported.result.delivery.disposition, "accepted");
    equal(imported.claimAuthority, "released");

    const route = await inspectActiveRoute({
      root: fixture.workspacePath,
      demandId: fixture.demandId,
    });
    equal(route.route.frontiers[0]?.kind, "test-result-review");

    const replayed = await executeTargetResultImportPublicRequest(
      CODEX_RESULT_FACADE,
      request,
    );
    equal(replayed.status, "already-recorded");
    equal(replayed.result.resultDigest, imported.result.resultDigest);
  } finally {
    await cleanupTestDeliveryWorkspaceFixture(fixture);
  }
});
