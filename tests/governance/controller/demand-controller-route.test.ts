import { deepEqual, equal } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  buildDemandControllerRoute,
  type DemandControllerRoute,
} from "../../../src/governance/controller/demand-controller-route.js";
import { executeDemandEventSourcingCommand } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import {
  closeDemandOperationAuthorityContext,
  openDemandOperationAuthorityContext,
} from "../../../src/governance/demand/demand-operation-authority-context.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { readDemandResultReviewSnapshot } from "../../../src/governance/review/demand-result-review-snapshot.js";
import {
  cleanupDeliveryWorkspaceFixture,
  createDeliveryWorkspaceFixture,
  landFixturePrompt,
  prepareFixtureDelivery,
  recordFixtureDeliveryOutcome,
} from "../delivery/delivery-workspace.fixture.js";
import {
  cleanupControllerImplementationReviewDecisionServiceFixture,
  createControllerImplementationReviewDecisionServiceFixture,
  decideFixtureImplementation,
} from "../review/controller-implementation-review-decision-service.fixture.js";
import { implementationReviewJudgmentWire } from "../review/controller-implementation-review-decision.fixture.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
  planFixtureTargetTask,
} from "../tasking/target-task-planning-service.fixture.js";
import {
  cleanupTestTaskPlanningWorkspaceFixture,
  createTestTaskPlanningWorkspaceFixture,
  planFixtureTestTask,
} from "../tasking/test-task-planning.fixture.js";

async function readControllerRoute(
  workspaceRoot: RootedDirectory,
  demandId: string,
): Promise<Readonly<DemandControllerRoute>> {
  const context = await openDemandOperationAuthorityContext(
    workspaceRoot,
    parseWakeflowDurableIdOfKind(demandId, "demand"),
    undefined,
  );
  try {
    const snapshot = await readDemandResultReviewSnapshot(context.demandRoot);
    return buildDemandControllerRoute(context.loaded, snapshot);
  } finally {
    await closeDemandOperationAuthorityContext(context);
  }
}

test("Controller Route从空Demand进入Task Planning并跟随planned Target", async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const initial = await readControllerRoute(
      fixture.workspaceRoot,
      fixture.request.demandId,
    );
    equal(initial.disposition, "work-available");
    equal(initial.frontiers[0]?.kind, "implementation-task-planning");
    equal(initial.frontiers[0]?.owner, "target-task-planning");
    equal(initial.blockers.length, 0);
    equal(Object.hasOwn(initial, "postAcceptanceRouteDigest"), false);
    equal(Object.isFrozen(initial), true);
    equal(Object.isFrozen(initial.frontiers), true);
    const { routeDigest, ...basis } = initial;
    equal(routeDigest, computeCanonicalJsonSha256Digest(basis));

    const plannedTask = await planFixtureTargetTask(fixture);
    const planned = await readControllerRoute(
      fixture.workspaceRoot,
      fixture.request.demandId,
    );
    equal(planned.frontiers[0]?.kind, "implementation-delivery-planning");
    const plannedFrontier = planned.frontiers[0];
    if (plannedFrontier?.scope !== "target") {
      throw new Error("Expected target-scoped Controller frontier.");
    }
    equal(plannedFrontier.target.workType, "implementation");
    equal(plannedFrontier.target.phase, "planned");
    equal(plannedFrontier.target.targetTaskId, plannedTask.targetTask.targetTaskId);

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
            "demand-event_31313131-3131-4131-8131-313131313131",
            "demand-event",
          ),
          recordedAt: parseUtcInstant("2026-08-29T12:02:00.000Z"),
          reason: "验证Controller Route终态",
        },
        {
          commitId: parseWakeflowDurableIdOfKind(
            "demand-event-commit_32323232-3232-4232-8232-323232323232",
            "demand-event-commit",
          ),
          expectedStreamRevision: current.aggregate.streamRevision,
        },
      );
    } finally {
      await demandRoot.close();
    }
    const terminal = await readControllerRoute(
      fixture.workspaceRoot,
      fixture.request.demandId,
    );
    equal(terminal.disposition, "terminal");
    deepEqual(terminal.frontiers, []);
    deepEqual(terminal.blockers, []);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});

test("Controller Route保持投递准备、Agent宿主效果与Result Import边界", async () => {
  const fixture = await createDeliveryWorkspaceFixture();
  try {
    const planningReady = await readControllerRoute(fixture.workspaceRoot, fixture.demandId);
    equal(planningReady.frontiers[0]?.kind, "implementation-delivery-planning");
    equal(planningReady.frontiers[0]?.owner, "target-delivery-preparation");

    const prepared = await prepareFixtureDelivery(fixture);
    const hostEffect = await readControllerRoute(fixture.workspaceRoot, fixture.demandId);
    equal(hostEffect.frontiers[0]?.kind, "implementation-host-effect-execution");
    equal(hostEffect.frontiers[0]?.owner, "agent-host");

    await landFixturePrompt(fixture, fixture.route, prepared.permit.prompt);
    const recorded = await recordFixtureDeliveryOutcome(fixture, prepared);
    equal(recorded.outcome.disposition, "accepted");
    const resultImport = await readControllerRoute(fixture.workspaceRoot, fixture.demandId);
    equal(resultImport.frontiers[0]?.kind, "implementation-target-result-import");
    equal(resultImport.frontiers[0]?.owner, "target-result-import");
  } finally {
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});

test("Controller Route组合Review Snapshot并在accept后委托Completion Route", async () => {
  const fixture =
    await createControllerImplementationReviewDecisionServiceFixture();
  try {
    const review = await readControllerRoute(
      fixture.workspaceRoot,
      fixture.demandId,
    );
    equal(review.frontiers[0]?.kind, "implementation-result-review");
    equal(review.frontiers[0]?.owner, "controller-implementation-review");
    equal(Object.hasOwn(review, "postAcceptanceRouteDigest"), false);

    await decideFixtureImplementation(fixture);
    const completion = await readControllerRoute(
      fixture.workspaceRoot,
      fixture.demandId,
    );
    equal(completion.frontiers[0]?.kind, "demand-completion-preflight");
    equal(completion.frontiers[0]?.owner, "demand-completion");
    equal(Object.hasOwn(completion, "postAcceptanceRouteDigest"), true);
    equal(completion.blockers.length, 0);
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});

test("Controller Route把blocked评审暴露为外部条件阻塞，把escalate交给Demand的awaiting-decision前沿", async () => {
  const fixture =
    await createControllerImplementationReviewDecisionServiceFixture();
  try {
    const blocked = await decideFixtureImplementation(
      fixture,
      { ...implementationReviewJudgmentWire("blocked"), idempotencyKey: "fixture-decision-blocked" },
      {
        clock: () => parseUtcInstant("2026-08-29T12:16:00.000Z"),
        uuidFactory: () => "34343434-3434-4434-8434-343434343434",
      },
    );
    equal(blocked.target.phase, "review-blocked");
    const blockedRoute = await readControllerRoute(fixture.workspaceRoot, fixture.demandId);
    equal(blockedRoute.disposition, "blocked");
    equal(blockedRoute.frontiers[0]?.kind, "implementation-review-blocked");
    equal(blockedRoute.frontiers[0]?.owner, "controller-implementation-review");
    equal(blockedRoute.blockers[0]?.kind, "external-condition");
    equal(Object.hasOwn(blockedRoute, "postAcceptanceRouteDigest"), false);
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
  const escalating =
    await createControllerImplementationReviewDecisionServiceFixture();
  try {
    const escalated = await decideFixtureImplementation(
      escalating,
      { ...implementationReviewJudgmentWire("escalate"), idempotencyKey: "fixture-decision-escalate" },
      {
        clock: () => parseUtcInstant("2026-08-29T12:16:00.000Z"),
        uuidFactory: () => "35353535-3535-4535-8535-353535353535",
      },
    );
    equal(escalated.target.phase, "escalated");
    equal(typeof escalated.attached.escalationEventId, "string");
    const route = await readControllerRoute(escalating.workspaceRoot, escalating.demandId);
    equal(route.disposition, "awaiting-decision");
    equal(route.frontiers[0]?.kind, "decision-required");
    equal(route.blockers[0]?.kind, "awaiting-decision");
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(escalating);
  }
});

test("Controller Route只映射Post-Acceptance Test责任而不复制其领域来源", async () => {
  const fixture = await createTestTaskPlanningWorkspaceFixture();
  try {
    const testTaskPlanning = await readControllerRoute(
      fixture.workspaceRoot,
      fixture.demandId,
    );
    equal(testTaskPlanning.frontiers[0]?.kind, "test-task-planning");
    equal(testTaskPlanning.frontiers[0]?.owner, "test-task-planning");
    equal(Object.hasOwn(testTaskPlanning.frontiers[0] ?? {}, "source"), false);
    equal(Object.hasOwn(testTaskPlanning, "postAcceptanceRouteDigest"), true);
    equal(JSON.stringify(testTaskPlanning).includes("landing.md"), false);

    const planned = await planFixtureTestTask(fixture, 7);
    if (planned.targetTask.workType !== "test") {
      throw new Error("Expected a Test target task.");
    }
    equal(planned.targetTask.testContract.environmentMemberRef.endsWith("landing.md"), true);
    const testDeliveryPlanning = await readControllerRoute(
      fixture.workspaceRoot,
      fixture.demandId,
    );
    equal(testDeliveryPlanning.frontiers[0]?.kind, "test-delivery-planning");
    equal(testDeliveryPlanning.frontiers[0]?.owner, "test-delivery-preparation");
    equal(JSON.stringify(testDeliveryPlanning).includes("landing.md"), false);
  } finally {
    await cleanupTestTaskPlanningWorkspaceFixture(fixture);
  }
});
