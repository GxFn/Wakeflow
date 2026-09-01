import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { renderWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3-document.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import {
  cancelDemandAggregateState,
  DemandAggregateStateError,
} from "../../../src/governance/demand/model/demand-aggregate-state.js";
import { inspectDemandEventSourcingRootInventory } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-root-inventory.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import {
  parseDemandCompletion,
  DemandCompletionError,
} from "../../../src/governance/lifecycle/demand-completion.js";
import {
  parseDemandCompletionPlan,
  DemandCompletionPlanError,
} from "../../../src/governance/lifecycle/demand-completion-plan.js";
import {
  DemandCompletionService,
  DemandCompletionServiceError,
} from "../../../src/governance/lifecycle/demand-completion-service.js";
import { readDemandPostAcceptanceRoute } from "../../../src/governance/review/demand-post-acceptance-route.js";
import { ControllerTestReviewDecisionService } from "../../../src/governance/review/controller-test-review-decision-service.js";
import { inspectTodoItems } from "../../../src/governance/todo/todo-collection-service.js";
import { todoStateRef } from "../../../src/governance/todo/todo-paths.js";
import { createWindowWorkClaimInStore } from "../../../src/governance/delivery/window-work-claim-store.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";
import {
  cleanupControllerTestReviewDecisionServiceFixture,
  createControllerTestReviewDecisionServiceFixture,
} from "../review/controller-test-review-decision-service.fixture.js";
import {
  cleanupAcceptedDemandCompletionWorkspaceFixture,
  completionUuidFactory,
  createAcceptedDemandCompletionWorkspaceFixture,
  COMPLETION_COMPLETED_AT,
} from "./demand-completion-service.fixture.js";

const REAL_ENVIRONMENT_TEST_ACCEPTED_AT = parseUtcInstant(
  "2026-08-29T12:35:00.000Z",
);
const REAL_ENVIRONMENT_COMPLETED_AT = parseUtcInstant(
  "2026-08-29T12:36:00.000Z",
);
const REAL_ENVIRONMENT_COMPLETION_UUIDS = Object.freeze([
  "f4f4f4f4-f4f4-44f4-84f4-f4f4f4f4f4f4",
  "f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f5",
]);

function realEnvironmentCompletionUuidFactory(): () => string {
  let index = 0;
  return () => REAL_ENVIRONMENT_COMPLETION_UUIDS[index++] ?? "invalid";
}

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

async function auditedAggregate(workspacePath: string, demandId: string) {
  const root = await RootedDirectory.open(
    path.join(workspacePath, ...demandFinalRootRef(demandId).split("/")),
  );
  try {
    return (await new DemandEventSourcingRepository(root).audit()).aggregate;
  } finally {
    await root.close();
  }
}

function rewriteConfig(workspacePath: string): void {
  const value = createMinimalWakeflowConfigV3();
  const program = value.program as Record<string, unknown>;
  program.displayName = "Changed after Demand Completion";
  writeFileSync(
    path.join(workspacePath, "wakeflow.config.json"),
    renderWakeflowConfigV3(parseWakeflowConfigV3(value)),
    { mode: 0o644 },
  );
}

test("Completion preview零写，Apply提交终态且精确重试不依赖后来Config", async () => {
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture();
  try {
    const service = new DemandCompletionService(fixture.workspaceRoot);
    const beforeDemand = await demandInventory(
      fixture.workspacePath,
      fixture.intent.demandId,
    );
    const beforeTodo = await inspectTodoItems(fixture.workspaceRoot);
    const preview = await service.preview(
      {
        demandId: fixture.intent.demandId,
      },
      {
        clock: () => COMPLETION_COMPLETED_AT,
        uuidFactory: completionUuidFactory(),
      },
    );
    deepEqual(
      await demandInventory(fixture.workspacePath, fixture.intent.demandId),
      beforeDemand,
    );
    equal(
      (await inspectTodoItems(fixture.workspaceRoot)).collection
        .collectionDigest,
      beforeTodo.collection.collectionDigest,
    );
    equal(preview.plan.completion.todoSource.stateRevision, 2);
    equal(
      parseDemandCompletion(preview.plan.completion).completionDigest,
      preview.plan.completion.completionDigest,
    );
    equal(
      parseDemandCompletionPlan(preview.plan).expectedStreamRevision,
      preview.plan.expectedStreamRevision,
    );
    throws(
      () =>
        parseDemandCompletion({
          ...preview.plan.completion,
          completionDigest: `sha256:${"0".repeat(64)}`,
        }),
      (error: unknown) =>
        error instanceof DemandCompletionError && error.reason === "digest",
    );
    throws(
      () =>
        parseDemandCompletionPlan({
          ...preview.plan,
          expectedStreamRevision: preview.plan.expectedStreamRevision + 1,
        }),
      (error: unknown) =>
        error instanceof DemandCompletionPlanError &&
        error.reason === "relation",
    );
    equal(
      preview.plan.completion.postAcceptanceRouteDigest.length,
      "sha256:".length + 64,
    );
    equal(JSON.stringify(preview).includes(fixture.rawHandle), false);

    const applied = await service.apply(preview.plan, preview.planDigest);
    equal(applied.status, "completed");
    equal(applied.disposition, "committed");
    equal(applied.commandResult.aggregate.state.lifecycle, "completed");
    equal(applied.commandResult.aggregate.streamRevision, 8);
    equal(
      applied.commandResult.commit.events[0]?.eventType,
      "lifecycle.demand-completed",
    );
    equal(applied.commandResult.commit.events[0]?.eventVersion, 1);
    const todoAfter = await inspectTodoItems(fixture.workspaceRoot);
    const todoItem = todoAfter.items.find(
      (item) => item.todoId === preview.plan.completion.todoSource.todoId,
    );
    equal(todoItem?.state.status, "claimed");
    equal(
      todoItem?.stateDigest,
      preview.plan.completion.todoSource.stateDigest,
    );
    const terminalRoute = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.intent.demandId,
    );
    equal(terminalRoute.nextStage.status, "not-ready");
    if (terminalRoute.nextStage.status !== "not-ready") {
      throw new Error("Expected terminal not-ready route.");
    }
    equal(terminalRoute.nextStage.reason, "demand-completed");
    await rejects(
      service.preview({ demandId: fixture.intent.demandId }),
      (error: unknown) =>
        error instanceof DemandCompletionServiceError &&
        error.reason === "route",
    );

    rewriteConfig(fixture.workspacePath);
    const replayed = await service.apply(preview.plan, preview.planDigest);
    equal(replayed.status, "already-completed");
    equal(replayed.disposition, "idempotent");
    equal(replayed.commandResult.aggregate.streamRevision, 8);
    const audited = await auditedAggregate(
      fixture.workspacePath,
      fixture.intent.demandId,
    );
    equal(audited.state.lifecycle, "completed");
    throws(
      () => cancelDemandAggregateState(audited.state),
      (error: unknown) =>
        error instanceof DemandAggregateStateError &&
        error.reason === "transition",
    );
  } finally {
    await cleanupAcceptedDemandCompletionWorkspaceFixture(fixture);
  }
});

test("并发相同Completion plan收敛为一个终态Event", async () => {
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture();
  try {
    const first = new DemandCompletionService(fixture.workspaceRoot);
    const second = new DemandCompletionService(fixture.workspaceRoot);
    const preview = await first.preview(
      {
        demandId: fixture.intent.demandId,
      },
      {
        clock: () => COMPLETION_COMPLETED_AT,
        uuidFactory: completionUuidFactory(),
      },
    );
    const results = await Promise.all([
      first.apply(preview.plan, preview.planDigest),
      second.apply(preview.plan, preview.planDigest),
    ]);
    deepEqual(results.map((result) => result.disposition).sort(), [
      "committed",
      "idempotent",
    ]);
    const aggregate = await auditedAggregate(
      fixture.workspacePath,
      fixture.intent.demandId,
    );
    equal(aggregate.state.lifecycle, "completed");
    equal(aggregate.streamRevision, 8);
  } finally {
    await cleanupAcceptedDemandCompletionWorkspaceFixture(fixture);
  }
});

test("real-environment Test accepted后Completion保留Card与attempt lineage", async () => {
  const fixture = await createControllerTestReviewDecisionServiceFixture();
  try {
    const accepted = await new ControllerTestReviewDecisionService(
      fixture.workspaceRoot,
    ).decide(fixture.testDecisionRequest, {
      clock: () => REAL_ENVIRONMENT_TEST_ACCEPTED_AT,
      uuidFactory: () => "91919191-9191-4191-8191-919191919191",
    });
    const before = await auditedAggregate(
      fixture.workspacePath,
      fixture.testClaimRequest.demandId,
    );
    const route = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.testClaimRequest.demandId,
    );
    equal(route.nextStage.status, "completion-preflight");
    if (
      route.nextStage.status !== "completion-preflight" ||
      route.nextStage.testingClosure.mode !== "real-environment"
    ) {
      throw new Error("Expected real-environment Completion preflight.");
    }
    equal(
      route.nextStage.testingClosure.testReview.targetReviewDecisionId,
      accepted.decision.targetReviewDecisionId,
    );
    equal(
      route.nextStage.testingClosure.testReview.testWindowId,
      fixture.testCard.testWindowId,
    );

    const service = new DemandCompletionService(fixture.workspaceRoot);
    const preview = await service.preview(
      {
        demandId: fixture.testClaimRequest.demandId,
      },
      {
        clock: () => REAL_ENVIRONMENT_COMPLETED_AT,
        uuidFactory: realEnvironmentCompletionUuidFactory(),
      },
    );
    equal(preview.plan.completion.testingMode, "real-environment");
    const applied = await service.apply(preview.plan, preview.planDigest);
    equal(applied.status, "completed");
    equal(applied.disposition, "committed");
    const terminal = applied.commandResult.aggregate.state;
    equal(terminal.lifecycle, "completed");
    deepEqual(terminal.targetTasks, before.state.targetTasks);
    deepEqual(terminal.currentTestCard, before.state.currentTestCard);
    const testTarget = terminal.targetTasks.find(
      (target) => target.workType === "test",
    );
    equal(testTarget?.phase, "test-accepted");
    if (testTarget?.workType !== "test" || !("testAttempts" in testTarget)) {
      throw new Error("Expected retained terminal Test lineage.");
    }
    equal(testTarget.testAttempts.length, 1);
    equal(
      testTarget.currentDelivery.reviewDecision.targetReviewDecisionId,
      accepted.decision.targetReviewDecisionId,
    );

    rewriteConfig(fixture.workspacePath);
    const replayed = await service.apply(preview.plan, preview.planDigest);
    equal(replayed.status, "already-completed");
    equal(replayed.disposition, "idempotent");
    deepEqual(
      replayed.commandResult.aggregate.state.targetTasks,
      terminal.targetTasks,
    );
    deepEqual(
      replayed.commandResult.aggregate.state.currentTestCard,
      terminal.currentTestCard,
    );
  } finally {
    await cleanupControllerTestReviewDecisionServiceFixture(fixture);
  }
});

test("Completion拒绝尚未执行Test的real-environment路线和残留WorkClaim", async () => {
  const realEnvironment = await createAcceptedDemandCompletionWorkspaceFixture({
    testingMode: "real-environment",
  });
  try {
    await rejects(
      new DemandCompletionService(realEnvironment.workspaceRoot).preview({
        demandId: realEnvironment.intent.demandId,
      }),
      (error: unknown) =>
        error instanceof DemandCompletionServiceError &&
        error.reason === "route",
    );
  } finally {
    await cleanupAcceptedDemandCompletionWorkspaceFixture(realEnvironment);
  }

  const claimed = await createAcceptedDemandCompletionWorkspaceFixture();
  try {
    const claimedService = new DemandCompletionService(claimed.workspaceRoot);
    const claimedPreview = await claimedService.preview(
      {
        demandId: claimed.intent.demandId,
      },
      {
        clock: () => COMPLETION_COMPLETED_AT,
        uuidFactory: completionUuidFactory(),
      },
    );
    const reported = claimed.reviewSnapshot.targets[0];
    if (reported?.status !== "reported") {
      throw new Error("Expected prior reported TargetResult fixture.");
    }
    const demandRoot = await RootedDirectory.open(
      path.join(
        claimed.workspacePath,
        ...demandFinalRootRef(claimed.intent.demandId).split("/"),
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
    await createWindowWorkClaimInStore(claimed.workspaceRoot, priorClaim);
    await rejects(
      claimedService.apply(claimedPreview.plan, claimedPreview.planDigest),
      (error: unknown) =>
        error instanceof DemandCompletionServiceError &&
        error.reason === "claim",
    );
  } finally {
    await cleanupAcceptedDemandCompletionWorkspaceFixture(claimed);
  }
});

test("Completion拒绝缺失的claimed TODO来源", async () => {
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture();
  try {
    const service = new DemandCompletionService(fixture.workspaceRoot);
    const preview = await service.preview(
      {
        demandId: fixture.intent.demandId,
      },
      {
        clock: () => COMPLETION_COMPLETED_AT,
        uuidFactory: completionUuidFactory(),
      },
    );
    const todo = await inspectTodoItems(fixture.workspaceRoot);
    const item = todo.items[0];
    if (item === undefined) throw new Error("Expected claimed TODO fixture.");
    rmSync(
      path.join(fixture.workspacePath, ...todoStateRef(item.todoId).split("/")),
    );
    await rejects(
      service.apply(preview.plan, preview.planDigest),
      (error: unknown) =>
        error instanceof DemandCompletionServiceError &&
        error.reason === "todo",
    );
  } finally {
    await cleanupAcceptedDemandCompletionWorkspaceFixture(fixture);
  }
});
