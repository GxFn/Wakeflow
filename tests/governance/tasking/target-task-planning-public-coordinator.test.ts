import { deepEqual, equal, rejects } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { inspectDemandEventSourcingRootInventory } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-root-inventory.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { readDemandPostAcceptanceRoute } from "../../../src/governance/review/demand-post-acceptance-route.js";
import {
  executeTargetTaskPlanningPublicRequest,
  TargetTaskPlanningPublicContractError,
  TargetTaskPlanningPublicCoordinatorError,
} from "../../../src/governance/tasking/target-task-planning-public-coordinator.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
  planningUuidFactory,
  PLANNING_RECORDED_AT,
} from "./target-task-planning-service.fixture.js";
import {
  cleanupTestTaskPlanningWorkspaceFixture,
  createTestTaskPlanningWorkspaceFixture,
  TEST_TASK_PACKAGE_CREATED_AT,
  testTaskPlanningUuidFactory,
} from "../testing/test-task-planning-service.fixture.js";

async function demandInventory(workspacePath: string, demandId: string) {
  const root = await RootedDirectory.open(
    path.join(workspacePath, ...demandFinalRootRef(demandId).split("/")),
  );
  try {
    return await inspectDemandEventSourcingRootInventory(root);
  } finally {
    await root.close();
  }
}

test("公共Target Task Planning以最小Test选择派生完整Package", async () => {
  const fixture = await createTestTaskPlanningWorkspaceFixture();
  try {
    const before = await demandInventory(
      fixture.workspacePath,
      fixture.intent.demandId,
    );
    const preview = await executeTargetTaskPlanningPublicRequest(
      {
        root: fixture.workspacePath,
        mode: "preview",
        demandId: fixture.intent.demandId,
        taskPackage: { workType: "test" },
      },
      {
        preview: {
          clock: () => TEST_TASK_PACKAGE_CREATED_AT,
          uuidFactory: testTaskPlanningUuidFactory(),
        },
      },
    );
    deepEqual(
      await demandInventory(fixture.workspacePath, fixture.intent.demandId),
      before,
    );
    equal(preview.mode, "preview");
    if (
      preview.mode !== "preview" ||
      preview.plan.taskPackage.workType !== "test" ||
      preview.plan.taskPackage.testCard === undefined
    ) {
      throw new Error("Expected public Test Task planning preview.");
    }
    equal(
      preview.plan.taskPackage.testCard.testCardId,
      fixture.testCard.testCardId,
    );
    equal(
      preview.plan.taskPackage.assignment.windowId,
      fixture.testCard.testWindowId,
    );
    equal(preview.plan.taskPackage.objective, fixture.testCard.question);
    equal(
      Object.hasOwn(preview.plan.taskPackage.assignment, "repositoryId"),
      false,
    );
    equal(Object.hasOwn(preview.plan.taskPackage, "commitExpectation"), false);
    equal(JSON.stringify(preview).includes(fixture.workspacePath), false);

    const applyRequest = {
      root: fixture.workspacePath,
      mode: "apply" as const,
      plan: preview.plan,
      planDigest: preview.planDigest,
    };
    const applied = await executeTargetTaskPlanningPublicRequest(applyRequest);
    equal(applied.mode, "apply");
    if (applied.mode !== "apply" || applied.targetTask.workType !== "test") {
      throw new Error("Expected public Test Task planning apply result.");
    }
    equal(applied.disposition, "committed");
    equal(applied.targetTask.phase, "planned");
    equal(applied.targetTask.testCard.testCardId, fixture.testCard.testCardId);
    equal(Object.hasOwn(applied.targetTask, "repositoryId"), false);
    equal(JSON.stringify(applied).includes(fixture.workspacePath), false);
    const route = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.intent.demandId,
    );
    equal(route.nextStage.status, "test-delivery-planning");

    const replayed = await executeTargetTaskPlanningPublicRequest(applyRequest);
    equal(replayed.mode, "apply");
    if (replayed.mode !== "apply" || replayed.targetTask.workType !== "test") {
      throw new Error("Expected replayed public Test Task result.");
    }
    equal(replayed.disposition, "idempotent");
    equal(replayed.targetTask.phase, "planned");
    equal(replayed.event.eventId, applied.event.eventId);
    equal(replayed.stateDigest, applied.stateDigest);
  } finally {
    await cleanupTestTaskPlanningWorkspaceFixture(fixture);
  }
});

test("公共Target Task Planning对两种work type统一执行容量和根隐私门禁", async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const before = await demandInventory(
      fixture.workspacePath,
      fixture.request.demandId,
    );
    await rejects(
      executeTargetTaskPlanningPublicRequest({
        root: "x".repeat(25 * 1024 * 1024),
        mode: "preview",
        demandId: fixture.request.demandId,
        taskPackage: fixture.request.taskPackage,
      }),
      (error: unknown) =>
        error instanceof TargetTaskPlanningPublicContractError &&
        error.reason === "capacity",
    );
    if (fixture.request.taskPackage.workType === "test") {
      throw new Error("Expected implementation planning fixture.");
    }
    await rejects(
      executeTargetTaskPlanningPublicRequest({
        root: fixture.workspacePath,
        mode: "preview",
        demandId: fixture.request.demandId,
        taskPackage: {
          ...fixture.request.taskPackage,
          objective: `Inspect ${fixture.workspacePath}`,
        },
      }),
      (error: unknown) =>
        error instanceof TargetTaskPlanningPublicCoordinatorError &&
        error.reason === "privacy" &&
        error.eventAuthority === "unchanged",
    );

    const preview = await executeTargetTaskPlanningPublicRequest(
      {
        root: fixture.workspacePath,
        mode: "preview",
        demandId: fixture.request.demandId,
        taskPackage: fixture.request.taskPackage,
      },
      {
        preview: {
          clock: () => PLANNING_RECORDED_AT,
          uuidFactory: planningUuidFactory(),
        },
      },
    );
    if (
      preview.mode !== "preview" ||
      preview.plan.taskPackage.workType === "test"
    ) {
      throw new Error("Expected implementation planning preview.");
    }
    const privatePlan = structuredClone(preview.plan);
    privatePlan.taskPackage.objective = `Inspect ${fixture.workspacePath}`;
    await rejects(
      executeTargetTaskPlanningPublicRequest({
        root: fixture.workspacePath,
        mode: "apply",
        plan: privatePlan,
        planDigest: preview.planDigest,
      }),
      (error: unknown) =>
        error instanceof TargetTaskPlanningPublicCoordinatorError &&
        error.reason === "privacy" &&
        error.eventAuthority === "unchanged",
    );
    deepEqual(
      await demandInventory(fixture.workspacePath, fixture.request.demandId),
      before,
    );
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});
