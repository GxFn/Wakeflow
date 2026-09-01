import { deepEqual, equal } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import type { WakeflowDemandControllerRouteResultV1 as RouteResultWire } from "../../../src/contracts/generated/entrypoints/wakeflow-demand-controller-route-result.generated.js";
import { WAKEFLOW_DEMAND_CONTROLLER_ROUTE_RESULT_SCHEMA } from "../../../src/contracts/generated/entrypoints/wakeflow-demand-controller-route-result.generated.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { createRuntimeJsonSchemaValidator } from "../../../src/foundation/schema/runtime-json-schema.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  buildDemandControllerRoute,
  type DemandControllerRoute,
} from "../../../src/governance/controller/demand-controller-route.js";
import { TargetHostEffectClaimService } from "../../../src/governance/delivery/target-host-effect-claim-service.js";
import { TargetHostEffectOutcomeService } from "../../../src/governance/delivery/target-host-effect-outcome-service.js";
import { executeDemandEventSourcingCommand } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import {
  closeDemandOperationAuthorityContext,
  openDemandOperationAuthorityContext,
} from "../../../src/governance/demand/demand-operation-authority-context.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { ControllerImplementationReviewDecisionService } from "../../../src/governance/review/controller-implementation-review-decision-service.js";
import { readDemandResultReviewSnapshot } from "../../../src/governance/review/demand-result-review-snapshot.js";
import { TargetTaskPlanningService } from "../../../src/governance/tasking/target-task-planning-service.js";
import { TestCardPlanningService } from "../../../src/governance/testing/test-card-planning-service.js";
import {
  CLAIMED_AT,
  claimUuidFactory,
  cleanupTargetHostEffectClaimWorkspaceFixture,
  createTargetHostEffectClaimWorkspaceFixture,
} from "../delivery/target-host-effect-claim-service.fixture.js";
import {
  cleanupControllerImplementationReviewDecisionServiceFixture,
  createControllerImplementationReviewDecisionServiceFixture,
} from "../review/controller-implementation-review-decision-service.fixture.js";
import { controllerImplementationReviewDecisionInput } from "../review/controller-implementation-review-decision.fixture.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
  planningUuidFactory,
  PLANNING_RECORDED_AT,
} from "../tasking/target-task-planning-service.fixture.js";
import {
  cleanupTestCardPlanningWorkspaceFixture,
  createTestCardPlanningWorkspaceFixture,
  TEST_CARD_CREATED_AT,
  testCardUuidFactory,
} from "../testing/test-card-planning-service.fixture.js";

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

    const planning = new TargetTaskPlanningService(fixture.workspaceRoot);
    const preview = await planning.preview(fixture.request, {
      clock: () => PLANNING_RECORDED_AT,
      uuidFactory: planningUuidFactory(),
    });
    await planning.apply(preview.plan, preview.planDigest);
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
    equal(
      plannedFrontier.target.targetTaskId,
      preview.plan.taskPackage.targetTaskId,
    );

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

test("Controller Route保持Claim、Agent宿主效果与Result Import边界", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  try {
    const claimReady = await readControllerRoute(
      fixture.workspaceRoot,
      fixture.intent.demandId,
    );
    equal(claimReady.frontiers[0]?.kind, "implementation-host-effect-claim");
    equal(claimReady.frontiers[0]?.owner, "target-host-effect-claim");

    const claimed = await new TargetHostEffectClaimService(
      fixture.workspaceRoot,
      codexWorkspaceHostResourceProfile,
      codexWindowHostIdentityProfile,
    ).claim(fixture.claimRequest, {
      clock: () => CLAIMED_AT,
      uuidFactory: claimUuidFactory(),
    });
    if (claimed.action === null) throw new Error("Expected Agent Host Action.");
    const hostEffect = await readControllerRoute(
      fixture.workspaceRoot,
      fixture.intent.demandId,
    );
    equal(
      hostEffect.frontiers[0]?.kind,
      "implementation-host-effect-execution",
    );
    equal(hostEffect.frontiers[0]?.owner, "agent-host");

    await new TargetHostEffectOutcomeService(
      fixture.workspaceRoot,
      "codex",
    ).record({
      demandId: fixture.intent.demandId,
      actionId: claimed.action.actionId,
      claimDigest: claimed.action.workClaim.claimDigest,
      attempt: { status: "accepted", evidence: { route: "accepted" } },
      readback: { status: "pending", evidence: { visible: false } },
      observedAt: parseUtcInstant("2026-08-29T12:06:00.000Z"),
    });
    const resultImport = await readControllerRoute(
      fixture.workspaceRoot,
      fixture.intent.demandId,
    );
    equal(
      resultImport.frontiers[0]?.kind,
      "implementation-target-result-import",
    );
    equal(resultImport.frontiers[0]?.owner, "target-result-import");
  } finally {
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("Controller Route组合Review Snapshot并在accept后委托Completion Route", async () => {
  const fixture =
    await createControllerImplementationReviewDecisionServiceFixture();
  try {
    const review = await readControllerRoute(
      fixture.workspaceRoot,
      fixture.intent.demandId,
    );
    equal(review.frontiers[0]?.kind, "implementation-result-review");
    equal(review.frontiers[0]?.owner, "controller-implementation-review");
    equal(Object.hasOwn(review, "postAcceptanceRouteDigest"), false);

    await new ControllerImplementationReviewDecisionService(
      fixture.workspaceRoot,
    ).decide(fixture.decisionRequest, {
      clock: () => parseUtcInstant("2026-08-29T12:15:00.000Z"),
      uuidFactory: () => "33333333-3333-4333-8333-333333333333",
    });
    const completion = await readControllerRoute(
      fixture.workspaceRoot,
      fixture.intent.demandId,
    );
    equal(completion.frontiers[0]?.kind, "demand-completion-preflight");
    equal(completion.frontiers[0]?.owner, "demand-completion");
    equal(Object.hasOwn(completion, "postAcceptanceRouteDigest"), true);
    equal(completion.blockers.length, 0);
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});

test("Controller Route把redesign诚实暴露为Design能力缺口", async () => {
  const fixture =
    await createControllerImplementationReviewDecisionServiceFixture();
  try {
    const judgment = controllerImplementationReviewDecisionInput("redesign");
    await new ControllerImplementationReviewDecisionService(
      fixture.workspaceRoot,
    ).decide(
      {
        ...fixture.decisionRequest,
        decision: judgment.decision,
        assessment: judgment.assessment,
        independentChecks: judgment.independentChecks,
        rationale: judgment.rationale,
        blockingReasons: judgment.blockingReasons,
        residualRisks: judgment.residualRisks,
      },
      {
        clock: () => parseUtcInstant("2026-08-29T12:16:00.000Z"),
        uuidFactory: () => "34343434-3434-4434-8434-343434343434",
      },
    );
    const route = await readControllerRoute(
      fixture.workspaceRoot,
      fixture.intent.demandId,
    );
    equal(route.disposition, "blocked");
    equal(route.frontiers[0]?.kind, "implementation-redesign-required");
    equal(route.frontiers[0]?.owner, "design");
    equal(route.blockers[0]?.kind, "implementation-redesign-not-implemented");
    equal(Object.hasOwn(route, "postAcceptanceRouteDigest"), false);
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});

test("Controller Route只映射Post-Acceptance Test责任而不复制其领域来源", async () => {
  const fixture = await createTestCardPlanningWorkspaceFixture();
  try {
    const testCardPlanning = await readControllerRoute(
      fixture.workspaceRoot,
      fixture.intent.demandId,
    );
    equal(testCardPlanning.frontiers[0]?.kind, "test-card-planning");
    equal(testCardPlanning.frontiers[0]?.owner, "test-card-planning");
    equal(Object.hasOwn(testCardPlanning.frontiers[0] ?? {}, "source"), false);
    equal(Object.hasOwn(testCardPlanning, "postAcceptanceRouteDigest"), true);

    const planning = new TestCardPlanningService(fixture.workspaceRoot);
    const preview = await planning.preview(
      {
        demandId: fixture.intent.demandId,
        testCard: fixture.testCardContent,
      },
      {
        clock: () => TEST_CARD_CREATED_AT,
        uuidFactory: testCardUuidFactory(),
      },
    );
    await planning.apply(preview.plan, preview.planDigest);
    const testTaskPlanning = await readControllerRoute(
      fixture.workspaceRoot,
      fixture.intent.demandId,
    );
    equal(testTaskPlanning.frontiers[0]?.kind, "test-task-planning");
    equal(testTaskPlanning.frontiers[0]?.owner, "test-task-planning");
    const basisMemberRef =
      preview.plan.testCard.testBasisAuthorities[0].memberRef;
    equal(JSON.stringify(testTaskPlanning).includes(basisMemberRef), false);
  } finally {
    await cleanupTestCardPlanningWorkspaceFixture(fixture);
  }
});

test("Controller Route不会把尚未支持的isolated Test Planning声明为可执行", async () => {
  const fixture = await createTestCardPlanningWorkspaceFixture({
    executionPlacement: "isolated",
  });
  try {
    const route = await readControllerRoute(
      fixture.workspaceRoot,
      fixture.intent.demandId,
    );
    equal(route.disposition, "blocked");
    equal(route.frontiers[0]?.kind, "test-card-planning");
    deepEqual(route.blockers, [
      {
        kind: "isolated-test-planning-not-implemented",
        owner: "test-card-planning",
      },
    ]);
    equal(Object.hasOwn(route, "postAcceptanceRouteDigest"), true);
    const { routeDigest, ...basis } = route;
    equal(routeDigest, computeCanonicalJsonSha256Digest(basis));
    const validateResult = createRuntimeJsonSchemaValidator<RouteResultWire>(
      WAKEFLOW_DEMAND_CONTROLLER_ROUTE_RESULT_SCHEMA,
    );
    const result = {
      kind: "WakeflowDemandControllerRouteInspectionResult",
      schemaVersion: 1,
      tool: "wakeflow_inspect_demand_route",
      status: "current",
      route,
    };
    equal(validateResult(result).ok, true);
    const missingSource = structuredClone(result) as typeof result & {
      route: { postAcceptanceRouteDigest?: string };
    };
    delete missingSource.route.postAcceptanceRouteDigest;
    equal(validateResult(missingSource).ok, false);
    const falsePostAcceptanceBlocker = structuredClone(result) as unknown as {
      route: {
        blockers: Array<{ kind: string; owner: string }>;
      };
    };
    falsePostAcceptanceBlocker.route.blockers = [
      {
        kind: "research-completion-not-implemented",
        owner: "demand-lifecycle",
      },
    ];
    equal(validateResult(falsePostAcceptanceBlocker).ok, false);
  } finally {
    await cleanupTestCardPlanningWorkspaceFixture(fixture);
  }
});
