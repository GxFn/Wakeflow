import { deepEqual, equal, rejects } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  executeDemandControllerRoutePublicRequest,
  DemandControllerRoutePublicContractError,
  DemandControllerRoutePublicCoordinatorError,
} from "../../../src/governance/controller/demand-controller-route-public-coordinator.js";
import { inspectDemandEventSourcingRootInventory } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-root-inventory.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { TargetTaskPlanningService } from "../../../src/governance/tasking/target-task-planning-service.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
  planningUuidFactory,
  PLANNING_RECORDED_AT,
} from "../tasking/target-task-planning-service.fixture.js";

async function demandInventory(workspacePath: string, demandId: string) {
  const demandRoot = await RootedDirectory.open(
    path.join(workspacePath, ...demandFinalRootRef(demandId).split("/")),
  );
  try {
    return await inspectDemandEventSourcingRootInventory(demandRoot);
  } finally {
    await demandRoot.close();
  }
}

test("公共Demand Route Query零写、确定性并跟随当前Event Stream", async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const request = {
      root: fixture.workspacePath,
      demandId: fixture.request.demandId,
    };
    const before = await demandInventory(
      fixture.workspacePath,
      fixture.request.demandId,
    );
    const first = await executeDemandControllerRoutePublicRequest(request);
    const second = await executeDemandControllerRoutePublicRequest(request);
    const after = await demandInventory(
      fixture.workspacePath,
      fixture.request.demandId,
    );
    deepEqual(second, first);
    deepEqual(after, before);
    equal(first.kind, "WakeflowDemandControllerRouteInspectionResult");
    equal(first.tool, "wakeflow_inspect_demand_route");
    equal(first.status, "current");
    equal(first.route.frontiers[0]?.kind, "implementation-task-planning");
    equal(JSON.stringify(first).includes(fixture.workspacePath), false);
    equal(Object.isFrozen(first), true);
    equal(Object.isFrozen(first.route), true);
    equal(Object.isFrozen(first.route.frontiers), true);

    const planning = new TargetTaskPlanningService(fixture.workspaceRoot);
    const preview = await planning.preview(fixture.request, {
      clock: () => PLANNING_RECORDED_AT,
      uuidFactory: planningUuidFactory(),
    });
    await planning.apply(preview.plan, preview.planDigest);
    const planned = await executeDemandControllerRoutePublicRequest(request);
    equal(
      planned.route.observedEventStream.streamRevision,
      first.route.observedEventStream.streamRevision + 1,
    );
    equal(planned.route.frontiers[0]?.kind, "implementation-delivery-planning");
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});

test("公共Demand Route Contract与Coordinator稳定区分输入、根和Route错误", async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const request = {
      root: fixture.workspacePath,
      demandId: fixture.request.demandId,
    };
    await rejects(
      executeDemandControllerRoutePublicRequest({
        ...request,
        mode: "inspect",
      }),
      (error: unknown) =>
        error instanceof DemandControllerRoutePublicContractError &&
        error.reason === "schema",
    );
    await rejects(
      executeDemandControllerRoutePublicRequest(new Proxy(request, {})),
      (error: unknown) =>
        error instanceof DemandControllerRoutePublicContractError &&
        error.reason === "json",
    );
    await rejects(
      executeDemandControllerRoutePublicRequest({
        ...request,
        root: "x".repeat(70 * 1024),
      }),
      (error: unknown) =>
        error instanceof DemandControllerRoutePublicContractError &&
        error.reason === "capacity",
    );
    await rejects(
      executeDemandControllerRoutePublicRequest({
        ...request,
        root: path.join(fixture.workspacePath, "missing"),
      }),
      (error: unknown) =>
        error instanceof DemandControllerRoutePublicCoordinatorError &&
        error.reason === "root",
    );
    await rejects(
      executeDemandControllerRoutePublicRequest({
        ...request,
        demandId: parseWakeflowDurableIdOfKind(
          "demand_45454545-4545-4545-8545-454545454545",
          "demand",
        ),
      }),
      (error: unknown) =>
        error instanceof DemandControllerRoutePublicCoordinatorError &&
        error.reason === "route" &&
        error.causeCode === "wakeflow-demand-operation-authority-context",
    );
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});
