import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { readDemandPostAcceptanceRoute } from "../../../src/governance/review/demand-post-acceptance-route.js";
import {
  parseTestDeliveryPreparationPublicRequest,
  TestDeliveryPreparationPublicContractError,
} from "../../../src/governance/testing/test-delivery-preparation-public-contract.js";
import {
  executeTestDeliveryPreparationPublicRequest,
  TestDeliveryPreparationPublicCoordinatorError,
} from "../../../src/governance/testing/test-delivery-preparation-public-coordinator.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  cleanupTestDeliveryPreparationWorkspaceFixture,
  createTestDeliveryPreparationWorkspaceFixture,
  TEST_DELIVERY_PREPARED_AT,
  testDeliveryUuidFactory,
} from "./test-delivery-preparation-service.fixture.js";

const CODEX_TEST_DELIVERY_FACADE = Object.freeze({
  hostId: "codex" as const,
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
});

const DEMAND_ID = "demand_11111111-1111-4111-8111-111111111111" as const;
const TARGET_TASK_ID =
  "target-task_22222222-2222-4222-8222-222222222222" as const;

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

test("公共Test Delivery preview零写并以exact plan提交initial授权Event", async () => {
  const fixture = await createTestDeliveryPreparationWorkspaceFixture();
  try {
    const before = await aggregate(
      fixture.workspacePath,
      fixture.testDeliveryRequest.demandId,
    );
    const preview = await executeTestDeliveryPreparationPublicRequest(
      CODEX_TEST_DELIVERY_FACADE,
      {
        root: fixture.workspacePath,
        mode: "preview",
        demandId: fixture.testDeliveryRequest.demandId,
        targetTaskId: fixture.testDeliveryRequest.targetTaskId,
      },
      {
        preview: {
          clock: () => TEST_DELIVERY_PREPARED_AT,
          uuidFactory: testDeliveryUuidFactory(),
        },
      },
    );
    deepEqual(
      await aggregate(
        fixture.workspacePath,
        fixture.testDeliveryRequest.demandId,
      ),
      before,
    );
    equal(preview.mode, "preview");
    if (preview.mode !== "preview") {
      throw new Error("Expected Test Delivery public preview result.");
    }
    equal(preview.tool, "wakeflow_prepare_test_delivery");
    equal(preview.status, "ready");
    equal(preview.plan.intent.attempt.mode, "initial");
    equal(preview.plan.intent.attempt.ordinal, 1);
    equal(Object.hasOwn(preview.plan.intent, "replacement"), false);
    equal(Object.hasOwn(preview.plan.intent, "packet"), false);
    equal(Object.hasOwn(preview.plan.intent, "workClaim"), false);
    equal(JSON.stringify(preview).includes(fixture.workspacePath), false);
    equal(JSON.stringify(preview).includes(fixture.testRawHandle), false);

    await rejects(
      executeTestDeliveryPreparationPublicRequest(CODEX_TEST_DELIVERY_FACADE, {
        root: fixture.workspacePath,
        mode: "apply",
        plan: preview.plan,
        planDigest: `sha256:${"f".repeat(64)}`,
      }),
      (error: unknown) =>
        error instanceof TestDeliveryPreparationPublicCoordinatorError &&
        error.reason === "apply" &&
        error.causeCode === "wakeflow-test-delivery-preparation-service" &&
        error.causeReason === "plan" &&
        error.eventAuthority === "unchanged",
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
    equal(applied.mode, "apply");
    if (applied.mode !== "apply") {
      throw new Error("Expected Test Delivery public apply result.");
    }
    equal(applied.status, "completed");
    equal(applied.disposition, "committed");
    equal(applied.eventAuthority, "current");
    equal(applied.planDigest, preview.planDigest);
    equal(applied.testDelivery.workType, "test");
    equal(applied.testDelivery.authorizationKind, "initial");
    equal(applied.testDelivery.targetTaskId, fixture.testTargetTaskId);
    equal(applied.testDelivery.taskPackageId, fixture.testTaskPackageId);
    equal(
      applied.testDelivery.testCard.testCardId,
      fixture.testCard.testCardId,
    );
    equal(
      applied.testDelivery.testAttemptId,
      preview.plan.intent.attempt.testAttemptId,
    );
    equal(applied.testDelivery.attemptOrdinal, 1);
    equal(applied.testDelivery.phase, "test-delivery-prepared");
    equal(JSON.stringify(applied).includes(fixture.workspacePath), false);
    equal(JSON.stringify(applied).includes(fixture.testRawHandle), false);

    const route = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.testDeliveryRequest.demandId,
    );
    equal(route.nextStage.status, "test-dispatch-planning");

    const replayed = await executeTestDeliveryPreparationPublicRequest(
      CODEX_TEST_DELIVERY_FACADE,
      {
        root: fixture.workspacePath,
        mode: "apply",
        plan: preview.plan,
        planDigest: preview.planDigest,
      },
    );
    equal(replayed.mode, "apply");
    if (replayed.mode !== "apply") {
      throw new Error("Expected replayed Test Delivery public result.");
    }
    equal(replayed.disposition, "idempotent");
    equal(replayed.event.eventId, applied.event.eventId);
    equal(replayed.stateDigest, applied.stateDigest);
    deepEqual(replayed.testDelivery, applied.testDelivery);
  } finally {
    await cleanupTestDeliveryPreparationWorkspaceFixture(fixture);
  }
});

test("公共Test Delivery边界拒绝旧mode、lineage echo、开放字段和错误宿主或根", async () => {
  const request = {
    root: "/tmp/wakeflow",
    mode: "preview" as const,
    demandId: DEMAND_ID,
    targetTaskId: TARGET_TASK_ID,
  };
  const parsed = parseTestDeliveryPreparationPublicRequest(request);
  equal(parsed.mode, "preview");
  equal(Object.isFrozen(parsed), true);

  for (const legacy of [
    { ...request, deliveryMode: "initial" },
    { ...request, rerunSource: {} },
    { ...request, replacement: {} },
    { ...request, hostAction: "send" },
  ]) {
    throws(
      () => parseTestDeliveryPreparationPublicRequest(legacy),
      (error: unknown) =>
        error instanceof TestDeliveryPreparationPublicContractError &&
        error.reason === "schema",
    );
  }
  throws(
    () => parseTestDeliveryPreparationPublicRequest(new Proxy(request, {})),
    (error: unknown) =>
      error instanceof TestDeliveryPreparationPublicContractError &&
      error.reason === "json",
  );
  throws(
    () =>
      parseTestDeliveryPreparationPublicRequest({
        ...request,
        root: `/${"x".repeat(25 * 1024 * 1024)}`,
      }),
    (error: unknown) =>
      error instanceof TestDeliveryPreparationPublicContractError &&
      error.reason === "capacity",
  );

  await rejects(
    executeTestDeliveryPreparationPublicRequest(
      { ...CODEX_TEST_DELIVERY_FACADE },
      request,
    ),
    (error: unknown) =>
      error instanceof TestDeliveryPreparationPublicCoordinatorError &&
      error.reason === "host" &&
      error.eventAuthority === "unchanged",
  );
  await rejects(
    executeTestDeliveryPreparationPublicRequest(CODEX_TEST_DELIVERY_FACADE, {
      ...request,
      root: "/definitely/missing/wakeflow-workspace",
    }),
    (error: unknown) =>
      error instanceof TestDeliveryPreparationPublicCoordinatorError &&
      error.reason === "root" &&
      error.eventAuthority === "unchanged",
  );
});
