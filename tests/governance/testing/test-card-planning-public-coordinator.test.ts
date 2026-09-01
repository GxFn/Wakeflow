import { deepEqual, equal, rejects } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { inspectDemandEventSourcingRootInventory } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-root-inventory.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { readDemandPostAcceptanceRoute } from "../../../src/governance/review/demand-post-acceptance-route.js";
import {
  executeTestCardPlanningPublicRequest,
  TestCardPlanningPublicContractError,
  TestCardPlanningPublicCoordinatorError,
} from "../../../src/governance/testing/test-card-planning-public-coordinator.js";
import {
  cleanupTestCardPlanningWorkspaceFixture,
  createTestCardPlanningWorkspaceFixture,
  TEST_CARD_CREATED_AT,
  testCardUuidFactory,
} from "./test-card-planning-service.fixture.js";

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

test("公共TestCard preview零写并以exact plan创建唯一Event", async () => {
  const fixture = await createTestCardPlanningWorkspaceFixture();
  try {
    const request = {
      root: fixture.workspacePath,
      mode: "preview" as const,
      demandId: fixture.intent.demandId,
      testCard: fixture.testCardContent,
    };
    const before = await demandInventory(
      fixture.workspacePath,
      fixture.intent.demandId,
    );
    const preview = await executeTestCardPlanningPublicRequest(request, {
      preview: {
        clock: () => TEST_CARD_CREATED_AT,
        uuidFactory: testCardUuidFactory(),
      },
    });
    deepEqual(
      await demandInventory(fixture.workspacePath, fixture.intent.demandId),
      before,
    );
    equal(preview.mode, "preview");
    if (preview.mode !== "preview") {
      throw new Error("Expected TestCard public preview result.");
    }
    equal(preview.tool, "wakeflow_plan_test_card");
    equal(preview.status, "ready");
    equal(preview.plan.testCard.demandId, fixture.intent.demandId);
    deepEqual(
      preview.plan.testCard.testBasisAuthorities.map(
        (reference) => reference.role,
      ),
      ["requirement-design"],
    );
    equal(JSON.stringify(preview).includes(fixture.workspacePath), false);

    const applied = await executeTestCardPlanningPublicRequest({
      root: fixture.workspacePath,
      mode: "apply",
      plan: preview.plan,
      planDigest: preview.planDigest,
    });
    equal(applied.mode, "apply");
    if (applied.mode !== "apply") {
      throw new Error("Expected TestCard public apply result.");
    }
    equal(applied.status, "created");
    equal(applied.disposition, "committed");
    equal(applied.eventAuthority, "current");
    equal(applied.testCard.testCardId, preview.plan.testCard.testCardId);
    equal(applied.generationSource.kind, "initial");
    equal(applied.planDigest, preview.planDigest);
    equal(JSON.stringify(applied).includes(fixture.workspacePath), false);
    const route = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.intent.demandId,
    );
    equal(route.nextStage.status, "test-task-planning");

    const replayed = await executeTestCardPlanningPublicRequest({
      root: fixture.workspacePath,
      mode: "apply",
      plan: preview.plan,
      planDigest: preview.planDigest,
    });
    equal(replayed.mode, "apply");
    if (replayed.mode !== "apply") {
      throw new Error("Expected replayed TestCard public apply result.");
    }
    equal(replayed.status, "already-created");
    equal(replayed.disposition, "idempotent");
    equal(replayed.event.eventId, applied.event.eventId);
    equal(replayed.stateDigest, applied.stateDigest);
  } finally {
    await cleanupTestCardPlanningWorkspaceFixture(fixture);
  }
});

test("公共TestCard边界拒绝未知字段、私有根、超限输入与伪造Plan", async () => {
  const fixture = await createTestCardPlanningWorkspaceFixture();
  try {
    const before = await demandInventory(
      fixture.workspacePath,
      fixture.intent.demandId,
    );
    const request = {
      root: fixture.workspacePath,
      mode: "preview" as const,
      demandId: fixture.intent.demandId,
      testCard: fixture.testCardContent,
    };
    await rejects(
      executeTestCardPlanningPublicRequest({
        ...request,
        strategyAuthorityMemberRef: "legacy/strategy.md",
      }),
      (error: unknown) =>
        error instanceof TestCardPlanningPublicContractError &&
        error.reason === "schema",
    );
    await rejects(
      executeTestCardPlanningPublicRequest(new Proxy(request, {})),
      (error: unknown) =>
        error instanceof TestCardPlanningPublicContractError &&
        error.reason === "json",
    );
    await rejects(
      executeTestCardPlanningPublicRequest({
        ...request,
        root: "x".repeat(25 * 1024 * 1024),
      }),
      (error: unknown) =>
        error instanceof TestCardPlanningPublicContractError &&
        error.reason === "capacity",
    );
    await rejects(
      executeTestCardPlanningPublicRequest({
        ...request,
        root: path.join(fixture.workspacePath, "missing"),
      }),
      (error: unknown) =>
        error instanceof TestCardPlanningPublicCoordinatorError &&
        error.reason === "root",
    );
    await rejects(
      executeTestCardPlanningPublicRequest({
        ...request,
        testCard: {
          ...fixture.testCardContent,
          controllerSelfChecks: [
            `Controller inspected ${fixture.workspacePath}`,
          ],
        },
      }),
      (error: unknown) =>
        error instanceof TestCardPlanningPublicCoordinatorError &&
        error.reason === "privacy" &&
        error.eventAuthority === "unchanged",
    );

    const preview = await executeTestCardPlanningPublicRequest(request, {
      preview: {
        clock: () => TEST_CARD_CREATED_AT,
        uuidFactory: testCardUuidFactory(),
      },
    });
    if (preview.mode !== "preview") {
      throw new Error("Expected TestCard public preview result.");
    }
    const privatePlan = structuredClone(preview.plan);
    privatePlan.testCard.controllerSelfChecks = [
      `Controller inspected ${fixture.workspacePath}`,
    ];
    await rejects(
      executeTestCardPlanningPublicRequest({
        root: fixture.workspacePath,
        mode: "apply",
        plan: privatePlan,
        planDigest: preview.planDigest,
      }),
      (error: unknown) =>
        error instanceof TestCardPlanningPublicCoordinatorError &&
        error.reason === "privacy" &&
        error.eventAuthority === "unchanged",
    );
    await rejects(
      executeTestCardPlanningPublicRequest({
        root: fixture.workspacePath,
        mode: "apply",
        plan: preview.plan,
        planDigest: `sha256:${"0".repeat(64)}`,
      }),
      (error: unknown) =>
        error instanceof TestCardPlanningPublicCoordinatorError &&
        error.reason === "apply" &&
        error.causeReason === "plan" &&
        error.eventAuthority === "unchanged",
    );
    deepEqual(
      await demandInventory(fixture.workspacePath, fixture.intent.demandId),
      before,
    );
  } finally {
    await cleanupTestCardPlanningWorkspaceFixture(fixture);
  }
});
