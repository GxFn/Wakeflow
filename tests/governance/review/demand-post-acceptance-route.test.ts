import { deepEqual, equal, rejects } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { inspectDemandEventSourcingRootInventory } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-root-inventory.js";
import { executeDemandEventSourcingCommand } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { ControllerImplementationReviewDecisionService } from "../../../src/governance/review/controller-implementation-review-decision-service.js";
import {
  readDemandPostAcceptanceRoute,
  DemandPostAcceptanceRouteError,
} from "../../../src/governance/review/demand-post-acceptance-route.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
} from "../tasking/target-task-planning-service.fixture.js";
import {
  cleanupControllerImplementationReviewDecisionServiceFixture,
  createControllerImplementationReviewDecisionServiceFixture,
  type ControllerImplementationReviewDecisionServiceFixture,
} from "./controller-implementation-review-decision-service.fixture.js";

const ACCEPTED_AT = parseUtcInstant("2026-08-29T12:15:00.000Z");
const ACCEPT_UUID = "c2c2c2c2-c2c2-42c2-82c2-c2c2c2c2c2c2";

async function acceptCurrentTarget(
  fixture: Readonly<ControllerImplementationReviewDecisionServiceFixture>,
) {
  return new ControllerImplementationReviewDecisionService(
    fixture.workspaceRoot,
  ).decide(fixture.decisionRequest, {
    clock: () => ACCEPTED_AT,
    uuidFactory: () => ACCEPT_UUID,
  });
}

async function inspectDemandInventory(workspacePath: string, demandId: string) {
  const root = await RootedDirectory.open(
    path.join(workspacePath, ...demandFinalRootRef(demandId).split("/")),
  );
  try {
    return await inspectDemandEventSourcingRootInventory(root);
  } finally {
    await root.close();
  }
}

test("controller-only在全部产品Target accepted后只进入completion preflight", async () => {
  const fixture =
    await createControllerImplementationReviewDecisionServiceFixture();
  try {
    const waiting = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.intent.demandId,
    );
    equal(waiting.nextStage.status, "not-ready");
    if (waiting.nextStage.status !== "not-ready") {
      throw new Error("Expected not-ready route before acceptance.");
    }
    equal(waiting.nextStage.reason, "targets-not-accepted");
    equal(waiting.nextStage.blockingTargets[0]?.phase, "result-reported");
    equal(waiting.acceptedTargets.length, 0);

    const decision = await acceptCurrentTarget(fixture);
    const before = await inspectDemandInventory(
      fixture.workspacePath,
      fixture.intent.demandId,
    );
    const first = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.intent.demandId,
    );
    const second = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.intent.demandId,
    );
    const after = await inspectDemandInventory(
      fixture.workspacePath,
      fixture.intent.demandId,
    );
    deepEqual(second, first);
    deepEqual(after, before);
    equal(first.testingDecision.mode, "controller-only");
    equal(first.nextStage.status, "completion-preflight");
    if (first.nextStage.status !== "completion-preflight") {
      throw new Error("Expected controller-only Completion preflight.");
    }
    equal(first.nextStage.testingClosure.mode, "controller-only");
    equal(first.acceptedTargets.length, 1);
    equal(
      first.acceptedTargets[0]?.targetReviewDecisionId,
      decision.decision.targetReviewDecisionId,
    );
    equal(
      first.acceptedTargets[0]?.targetResultId,
      decision.decision.reviewed.targetResultId,
    );
    const { routeDigest, ...basis } = first;
    equal(routeDigest, computeCanonicalJsonSha256Digest(basis));
    equal(Object.hasOwn(first.nextStage, "testEnvironmentAuthority"), false);
    equal(
      /(?:TestCard|completionEvent|completeDemand)/u.test(
        JSON.stringify(first),
      ),
      false,
    );

    await rejects(
      readDemandPostAcceptanceRoute(
        fixture.workspaceRoot,
        fixture.intent.demandId,
        { extra: true } as never,
      ),
      (error: unknown) =>
        error instanceof DemandPostAcceptanceRouteError &&
        error.reason === "input",
    );
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});

test("real-environment只路由到Test planning并暴露精确环境Authority引用", async () => {
  const fixture =
    await createControllerImplementationReviewDecisionServiceFixture({
      testingMode: "real-environment",
    });
  try {
    await acceptCurrentTarget(fixture);
    const route = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.intent.demandId,
    );
    equal(route.testingDecision.mode, "real-environment");
    equal(route.nextStage.status, "real-environment-test-planning");
    if (route.nextStage.status !== "real-environment-test-planning") {
      throw new Error("Expected real-environment Test planning route.");
    }
    equal(route.nextStage.testEnvironmentAuthority.role, "test-environment");
    equal(
      route.nextStage.testEnvironmentAuthority.memberRef,
      route.testingDecision.environmentMemberRef,
    );
    equal(route.acceptedTargets.length, 1);
    equal(
      /(?:bytes|source|rawHandle|threadId|sessionId)/u.test(
        JSON.stringify(route.nextStage.testEnvironmentAuthority),
      ),
      false,
    );
    equal(Object.hasOwn(route, "testCard"), false);
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});

test("尚未规划Target的非research Demand保持明确not-ready默认分支", async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const route = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.request.demandId,
    );
    equal(route.nextStage.status, "not-ready");
    if (route.nextStage.status !== "not-ready") {
      throw new Error("Expected no-target not-ready route.");
    }
    equal(route.nextStage.reason, "no-target-tasks");
    equal(route.nextStage.blockingTargets.length, 0);
    equal(route.acceptedTargets.length, 0);

    const demandRoot = await RootedDirectory.open(
      path.join(
        fixture.workspacePath,
        ...demandFinalRootRef(fixture.request.demandId).split("/"),
      ),
    );
    try {
      const repository = new DemandEventSourcingRepository(demandRoot);
      const current = await repository.audit();
      await executeDemandEventSourcingCommand(
        repository,
        {
          commandType: "lifecycle.cancel-demand",
          commandVersion: 1,
          demandId: fixture.request.demandId,
          eventId: parseWakeflowDurableIdOfKind(
            "demand-event_c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3",
            "demand-event",
          ),
          recordedAt: parseUtcInstant("2026-08-29T12:20:00.000Z"),
          reason: "验证取消后的路由默认分支",
        },
        {
          commitId: parseWakeflowDurableIdOfKind(
            "demand-event-commit_c4c4c4c4-c4c4-44c4-84c4-c4c4c4c4c4c4",
            "demand-event-commit",
          ),
          expectedStreamRevision: current.aggregate.streamRevision,
        },
      );
    } finally {
      await demandRoot.close();
    }
    const cancelled = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.request.demandId,
    );
    equal(cancelled.nextStage.status, "not-ready");
    if (cancelled.nextStage.status !== "not-ready") {
      throw new Error("Expected cancelled not-ready route.");
    }
    equal(cancelled.nextStage.reason, "demand-cancelled");
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});

test("Post-acceptance route拒绝非RootedDirectory与预取消读取", async () => {
  await rejects(
    readDemandPostAcceptanceRoute(
      {},
      "demand_22222222-2222-4222-8222-222222222222",
    ),
    (error: unknown) =>
      error instanceof DemandPostAcceptanceRouteError &&
      error.reason === "input",
  );
  const fixture = await createTargetTaskPlanningWorkspaceFixture();
  const abort = new AbortController();
  abort.abort();
  try {
    await rejects(
      readDemandPostAcceptanceRoute(
        fixture.workspaceRoot,
        fixture.request.demandId,
        { signal: abort.signal },
      ),
      (error: unknown) =>
        error instanceof DemandPostAcceptanceRouteError &&
        error.reason === "aborted",
    );
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});
