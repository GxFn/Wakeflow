import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  computeTaskPackageDigest,
} from "../../../src/governance/tasking/task-package.js";
import {
  cancelDemandAggregateState,
  createInitialDemandAggregateState,
  planTargetTaskInDemandAggregateState,
  parseDemandAggregateState,
  DemandAggregateStateError,
} from "../../../src/governance/demand/model/demand-aggregate-state.js";
import {
  createTaskPackageFixture,
  TARGET_TASK_ID,
  TASKING_AUTHORITY_DIGEST,
  TASKING_DEMAND_ID,
  TASKING_REPOSITORY_ID,
  TASKING_WINDOW_ID,
  TASK_PACKAGE_ID,
} from "../tasking/task-package.fixture.js";

test("Demand 聚合保存任务决策所需的最小 authority 与 target 摘要", () => {
  const active = createInitialDemandAggregateState(
    TASKING_DEMAND_ID,
    TASKING_AUTHORITY_DIGEST,
  );
  deepEqual(active, {
    artifactKind: "wakeflow-demand-aggregate-state",
    schemaVersion: 1,
    demandId: TASKING_DEMAND_ID,
    authorityDigest: TASKING_AUTHORITY_DIGEST,
    lifecycle: "active",
    targetTasks: [],
  });
  equal(Object.isFrozen(active), true);

  const taskPackage = createTaskPackageFixture();
  const planned = planTargetTaskInDemandAggregateState(active, taskPackage);
  deepEqual(planned.targetTasks, [{
    targetTaskId: TARGET_TASK_ID,
    taskPackageId: TASK_PACKAGE_ID,
    taskPackageDigest: computeTaskPackageDigest(taskPackage),
    repositoryId: TASKING_REPOSITORY_ID,
    windowId: TASKING_WINDOW_ID,
    phase: "planned",
  }]);
  equal(Object.isFrozen(planned.targetTasks), true);
  equal(Object.isFrozen(planned.targetTasks[0]), true);

  const cancelled = cancelDemandAggregateState(planned);
  deepEqual(cancelled, {
    ...planned,
    lifecycle: "cancelled",
  });
  throws(
    () => cancelDemandAggregateState(cancelled),
    (error: unknown) => (
      error instanceof DemandAggregateStateError
      && error.reason === "transition"
    ),
  );
});

test("未实现业务域不能以空占位字段进入 Demand 状态", () => {
  throws(
    () => parseDemandAggregateState({
      ...createInitialDemandAggregateState(
        TASKING_DEMAND_ID,
        TASKING_AUTHORITY_DIGEST,
      ),
      lifecycle: "completed",
    }),
    (error: unknown) => (
      error instanceof DemandAggregateStateError
      && error.reason === "schema"
    ),
  );
  throws(
    () => parseDemandAggregateState({
      ...createInitialDemandAggregateState(
        TASKING_DEMAND_ID,
        TASKING_AUTHORITY_DIGEST,
      ),
      delivery: { dispatchGroups: [] },
    }),
    (error: unknown) => (
      error instanceof DemandAggregateStateError
      && error.reason === "schema"
    ),
  );
});
