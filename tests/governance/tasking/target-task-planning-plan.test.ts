import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  parseWakeflowDurableIdOfKind,
} from "../../../src/contracts/identity/wakeflow-durable-id.js";
import {
  computeTargetTaskPlanningPlanDigest,
  createTargetTaskPlanningPlan,
  parseTargetTaskPlanningPlan,
  TargetTaskPlanningPlanError,
} from "../../../src/governance/tasking/target-task-planning-plan.js";
import {
  createTaskPackageFixture,
  TASKING_DEMAND_ID,
} from "./task-package.fixture.js";

const EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "demand-event",
);
const COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "demand-event-commit",
);

test("Target Task Planning plan closes one TaskPackage and append expectation", () => {
  const plan = createTargetTaskPlanningPlan({
    demandId: TASKING_DEMAND_ID,
    expectedStreamRevision: 1,
    commitId: COMMIT_ID,
    eventId: EVENT_ID,
    taskPackage: createTaskPackageFixture(),
  });

  deepEqual(parseTargetTaskPlanningPlan(plan), plan);
  equal(Object.isFrozen(plan), true);
  equal(Object.isFrozen(plan.taskPackage), true);
  equal(computeTargetTaskPlanningPlanDigest(plan).startsWith("sha256:"), true);
  throws(
    () => parseTargetTaskPlanningPlan({
      ...plan,
      demandId: "demand_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    }),
    (error: unknown) => (
      error instanceof TargetTaskPlanningPlanError
      && error.reason === "relation"
    ),
  );
  throws(
    () => parseTargetTaskPlanningPlan({
      ...plan,
      expectedStreamRevision: 0,
    }),
    (error: unknown) => (
      error instanceof TargetTaskPlanningPlanError
      && error.reason === "position"
    ),
  );
});
