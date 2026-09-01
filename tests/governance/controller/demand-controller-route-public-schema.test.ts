import { equal } from "node:assert/strict";
import { test } from "node:test";

import type { WakeflowDemandControllerRouteRequestV1 as RouteRequestWire } from "../../../src/contracts/generated/entrypoints/wakeflow-demand-controller-route-request.generated.js";
import { WAKEFLOW_DEMAND_CONTROLLER_ROUTE_REQUEST_SCHEMA } from "../../../src/contracts/generated/entrypoints/wakeflow-demand-controller-route-request.generated.js";
import type { WakeflowDemandControllerRouteResultV1 as RouteResultWire } from "../../../src/contracts/generated/entrypoints/wakeflow-demand-controller-route-result.generated.js";
import { WAKEFLOW_DEMAND_CONTROLLER_ROUTE_RESULT_SCHEMA } from "../../../src/contracts/generated/entrypoints/wakeflow-demand-controller-route-result.generated.js";
import { buildDemandControllerRoute } from "../../../src/governance/controller/demand-controller-route.js";
import {
  closeDemandOperationAuthorityContext,
  openDemandOperationAuthorityContext,
} from "../../../src/governance/demand/demand-operation-authority-context.js";
import { readDemandResultReviewSnapshot } from "../../../src/governance/review/demand-result-review-snapshot.js";
import { TargetTaskPlanningService } from "../../../src/governance/tasking/target-task-planning-service.js";
import { createRuntimeJsonSchemaValidator } from "../../../src/foundation/schema/runtime-json-schema.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
  planningUuidFactory,
  PLANNING_RECORDED_AT,
} from "../tasking/target-task-planning-service.fixture.js";

const validateRequest = createRuntimeJsonSchemaValidator<RouteRequestWire>(
  WAKEFLOW_DEMAND_CONTROLLER_ROUTE_REQUEST_SCHEMA,
);
const validateResult = createRuntimeJsonSchemaValidator<RouteResultWire>(
  WAKEFLOW_DEMAND_CONTROLLER_ROUTE_RESULT_SCHEMA,
);

test("Demand Controller Route公共Schema接受真实Route并拒绝关系漂移", async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const request = {
      root: fixture.workspacePath,
      demandId: fixture.request.demandId,
    };
    equal(validateRequest(request).ok, true);
    equal(validateRequest({ ...request, mode: "inspect" }).ok, false);
    equal(
      validateRequest({ ...request, demandId: "demand_invalid" }).ok,
      false,
    );

    const context = await openDemandOperationAuthorityContext(
      fixture.workspaceRoot,
      fixture.request.demandId,
      undefined,
    );
    let route;
    try {
      route = buildDemandControllerRoute(
        context.loaded,
        await readDemandResultReviewSnapshot(context.demandRoot),
      );
    } finally {
      await closeDemandOperationAuthorityContext(context);
    }
    const result = {
      kind: "WakeflowDemandControllerRouteInspectionResult",
      schemaVersion: 1,
      tool: "wakeflow_inspect_demand_route",
      status: "current",
      route,
    };
    equal(validateResult(result).ok, true);
    equal(JSON.stringify(result).includes(fixture.workspacePath), false);

    const wrongOwner = structuredClone(result) as unknown as {
      route: { frontiers: Array<{ owner: string }> };
    };
    wrongOwner.route.frontiers[0]!.owner = "design";
    equal(validateResult(wrongOwner).ok, false);

    const falseTerminal = structuredClone(result) as unknown as {
      route: { disposition: string };
    };
    falseTerminal.route.disposition = "terminal";
    equal(validateResult(falseTerminal).ok, false);

    const leakedSource = structuredClone(result) as typeof result & {
      source?: string;
    };
    leakedSource.source = fixture.workspacePath;
    equal(validateResult(leakedSource).ok, false);

    const planning = new TargetTaskPlanningService(fixture.workspaceRoot);
    const preview = await planning.preview(fixture.request, {
      clock: () => PLANNING_RECORDED_AT,
      uuidFactory: planningUuidFactory(),
    });
    await planning.apply(preview.plan, preview.planDigest);
    const plannedContext = await openDemandOperationAuthorityContext(
      fixture.workspaceRoot,
      fixture.request.demandId,
      undefined,
    );
    let plannedRoute;
    try {
      plannedRoute = buildDemandControllerRoute(
        plannedContext.loaded,
        await readDemandResultReviewSnapshot(plannedContext.demandRoot),
      );
    } finally {
      await closeDemandOperationAuthorityContext(plannedContext);
    }
    const plannedResult = {
      ...result,
      route: plannedRoute,
    };
    equal(validateResult(plannedResult).ok, true);
    const wrongPhase = structuredClone(plannedResult) as unknown as {
      route: { frontiers: Array<{ target: { phase: string } }> };
    };
    wrongPhase.route.frontiers[0]!.target.phase = "result-reported";
    equal(validateResult(wrongPhase).ok, false);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});
