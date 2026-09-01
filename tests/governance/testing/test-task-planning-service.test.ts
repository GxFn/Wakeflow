import { deepEqual, equal, rejects } from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { renderWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3-document.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { createWindowWorkClaimInStore } from "../../../src/governance/delivery/window-work-claim-store.js";
import { readDemandPostAcceptanceRoute } from "../../../src/governance/review/demand-post-acceptance-route.js";
import {
  computeTargetTaskPlanningPlanDigest,
  createTargetTaskPlanningPlan,
} from "../../../src/governance/tasking/target-task-planning-plan.js";
import { taskPackageProjectionRef } from "../../../src/governance/tasking/task-package-projection-paths.js";
import {
  parseTaskPackage,
  renderTaskPackage,
} from "../../../src/governance/tasking/task-package.js";
import {
  TargetTaskPlanningService,
  TargetTaskPlanningServiceError,
} from "../../../src/governance/tasking/target-task-planning-service.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";
import {
  cleanupTestCardPlanningWorkspaceFixture,
  createTestCardPlanningWorkspaceFixture,
} from "./test-card-planning-service.fixture.js";
import {
  cleanupTestTaskPlanningWorkspaceFixture,
  createTestTaskPlanningWorkspaceFixture,
  TEST_TASK_PACKAGE_CREATED_AT,
  testTaskPlanningUuidFactory,
} from "./test-task-planning-service.fixture.js";

const ROLLED_BACK_TEST_TASK_CREATED_AT = parseUtcInstant(
  "2026-08-29T12:19:00.000Z",
);

async function streamRevision(
  workspacePath: string,
  demandId: string,
): Promise<number> {
  const root = await RootedDirectory.open(
    path.join(workspacePath, ...demandFinalRootRef(demandId).split("/")),
  );
  try {
    return (await new DemandEventSourcingRepository(root).audit()).aggregate
      .streamRevision;
  } finally {
    await root.close();
  }
}

function projectionPath(
  workspacePath: string,
  demandId: string,
  taskPackageId: string,
): string {
  return path.join(
    workspacePath,
    ...demandFinalRootRef(demandId).split("/"),
    ...taskPackageProjectionRef(taskPackageId).split("/"),
  );
}

function rewriteConfig(workspacePath: string): void {
  const value = createMinimalWakeflowConfigV3();
  const program = value.program as Record<string, unknown>;
  program.displayName = "Changed after Test Task planning";
  writeFileSync(
    path.join(workspacePath, "wakeflow.config.json"),
    renderWakeflowConfigV3(parseWakeflowConfigV3(value)),
    { mode: 0o644 },
  );
}

test("Test Task在wall clock回拨时仍从TestCard派生Package并提交规划Event", async () => {
  const fixture = await createTestTaskPlanningWorkspaceFixture();
  try {
    const service = new TargetTaskPlanningService(fixture.workspaceRoot);
    const beforeRevision = await streamRevision(
      fixture.workspacePath,
      fixture.intent.demandId,
    );
    const preview = await service.preview(fixture.testTaskRequest, {
      clock: () => ROLLED_BACK_TEST_TASK_CREATED_AT,
      uuidFactory: testTaskPlanningUuidFactory(),
    });
    equal(
      await streamRevision(fixture.workspacePath, fixture.intent.demandId),
      beforeRevision,
    );
    const taskPackage = preview.plan.taskPackage;
    equal(taskPackage.workType, "test");
    if (taskPackage.workType !== "test") {
      throw new Error("Expected Test TaskPackage.");
    }
    equal(taskPackage.createdAt, ROLLED_BACK_TEST_TASK_CREATED_AT);
    equal(taskPackage.targetTaskId, fixture.testCard.targetTaskId);
    deepEqual(taskPackage.assignment, {
      windowId: fixture.testCard.testWindowId,
    });
    deepEqual(taskPackage.testCard, {
      testCardId: fixture.testCard.testCardId,
      testCardDigest: fixture.testCard.testCardDigest,
    });
    equal(taskPackage.objective, fixture.testCard.question);
    deepEqual(taskPackage.acceptanceAnchors, []);
    equal(Object.hasOwn(taskPackage, "commitExpectation"), false);
    equal(Object.hasOwn(taskPackage.assignment, "repositoryId"), false);
    deepEqual(
      taskPackage.selectedAuthorityRefs.map((reference) => reference.memberRef),
      [
        ...fixture.testCard.testBasisAuthorities.map(
          (reference) => reference.memberRef,
        ),
        fixture.testCard.environmentAuthority.memberRef,
      ].sort(),
    );
    equal(
      renderTaskPackage(parseTaskPackage(taskPackage)),
      renderTaskPackage(taskPackage),
    );
    const targetPath = projectionPath(
      fixture.workspacePath,
      fixture.intent.demandId,
      taskPackage.taskPackageId,
    );
    equal(existsSync(targetPath), false);

    const applied = await service.apply(preview.plan, preview.planDigest);
    equal(applied.disposition, "committed");
    equal(applied.commandResult.aggregate.streamRevision, beforeRevision + 1);
    equal(applied.projection.disposition, "created");
    equal(existsSync(targetPath), true);
    const target = applied.commandResult.aggregate.state.targetTasks.find(
      (entry) => entry.targetTaskId === taskPackage.targetTaskId,
    );
    equal(target?.workType, "test");
    equal(target?.phase, "planned");
    const route = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.intent.demandId,
    );
    equal(route.nextStage.status, "test-delivery-planning");
    if (route.nextStage.status !== "test-delivery-planning") {
      throw new Error("Expected Test Delivery planning route.");
    }
    equal(route.nextStage.testTask.taskPackageId, taskPackage.taskPackageId);

    rewriteConfig(fixture.workspacePath);
    const replayed = await service.apply(preview.plan, preview.planDigest);
    equal(replayed.disposition, "idempotent");
    equal(replayed.projection.disposition, "current");
  } finally {
    await cleanupTestTaskPlanningWorkspaceFixture(fixture);
  }
});

test("并发相同Test Task plan收敛为一个target-task-planned Event", async () => {
  const fixture = await createTestTaskPlanningWorkspaceFixture();
  try {
    const service = new TargetTaskPlanningService(fixture.workspaceRoot);
    const preview = await service.preview(fixture.testTaskRequest, {
      clock: () => TEST_TASK_PACKAGE_CREATED_AT,
      uuidFactory: testTaskPlanningUuidFactory(),
    });
    const settled = await Promise.allSettled([
      service.apply(preview.plan, preview.planDigest),
      service.apply(preview.plan, preview.planDigest),
    ]);
    equal(
      settled.some(
        (entry) =>
          entry.status === "fulfilled" &&
          entry.value.disposition === "committed",
      ),
      true,
    );
    equal(
      (await service.apply(preview.plan, preview.planDigest)).disposition,
      "idempotent",
    );
    equal(
      await streamRevision(fixture.workspacePath, fixture.intent.demandId),
      9,
    );
  } finally {
    await cleanupTestTaskPlanningWorkspaceFixture(fixture);
  }
});

test("Test Task Planning拒绝缺失TestCard和伪造派生内容", async () => {
  const withoutCard = await createTestCardPlanningWorkspaceFixture();
  try {
    await rejects(
      new TargetTaskPlanningService(withoutCard.workspaceRoot).preview({
        demandId: withoutCard.intent.demandId,
        taskPackage: { workType: "test" },
      }),
      (error: unknown) =>
        error instanceof TargetTaskPlanningServiceError &&
        error.reason === "test-route",
    );
  } finally {
    await cleanupTestCardPlanningWorkspaceFixture(withoutCard);
  }

  const fixture = await createTestTaskPlanningWorkspaceFixture();
  try {
    const service = new TargetTaskPlanningService(fixture.workspaceRoot);
    const preview = await service.preview(fixture.testTaskRequest, {
      clock: () => TEST_TASK_PACKAGE_CREATED_AT,
      uuidFactory: testTaskPlanningUuidFactory(),
    });
    const tamperedPackage = parseTaskPackage({
      ...preview.plan.taskPackage,
      objective: "伪造一个未经TestCard批准的新目标",
    });
    const tamperedPlan = createTargetTaskPlanningPlan({
      demandId: preview.plan.demandId,
      expectedStreamRevision: preview.plan.expectedStreamRevision,
      commitId: preview.plan.commitId,
      eventId: preview.plan.eventId,
      taskPackage: tamperedPackage,
    });
    await rejects(
      service.apply(
        tamperedPlan,
        computeTargetTaskPlanningPlanDigest(tamperedPlan),
      ),
      (error: unknown) =>
        error instanceof TargetTaskPlanningServiceError &&
        error.reason === "task-package" &&
        error.eventAuthority === "unchanged",
    );
    const reported = fixture.reviewSnapshot.targets[0];
    if (reported?.status !== "reported") {
      throw new Error("Expected prior reported TargetResult fixture.");
    }
    const demandRoot = await RootedDirectory.open(
      path.join(
        fixture.workspacePath,
        ...demandFinalRootRef(fixture.intent.demandId).split("/"),
      ),
    );
    let priorClaim;
    try {
      const located = await new DemandEventSourcingRepository(
        demandRoot,
      ).findTargetHostEffectClaimedEvent(
        reported.targetResult.hostEffect.actionId,
      );
      if (located === null) throw new Error("Expected prior Claim Event.");
      priorClaim = located.event.data.claim;
    } finally {
      await demandRoot.close();
    }
    await createWindowWorkClaimInStore(fixture.workspaceRoot, priorClaim);
    await rejects(
      service.apply(preview.plan, preview.planDigest),
      (error: unknown) =>
        error instanceof TargetTaskPlanningServiceError &&
        error.reason === "claim" &&
        error.eventAuthority === "unchanged",
    );
    equal(
      await streamRevision(fixture.workspacePath, fixture.intent.demandId),
      8,
    );
  } finally {
    await cleanupTestTaskPlanningWorkspaceFixture(fixture);
  }
});
