import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../src/foundation/identity/wakeflow-durable-id.js";
import {
  cancelDemandAggregateState,
  createInitialDemandAggregateState,
  parseDemandAggregateState,
  DemandAggregateStateError,
} from "../../../src/governance/demand/model/demand-aggregate-state.js";

const DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_11111111-1111-4111-8111-111111111111",
  "demand",
);

test("Demand 聚合只保存已由事件拥有的最小业务状态", () => {
  const active = createInitialDemandAggregateState(DEMAND_ID);
  deepEqual(active, {
    artifactKind: "wakeflow-demand-aggregate-state",
    schemaVersion: 1,
    demandId: DEMAND_ID,
    lifecycle: "active",
  });
  equal(Object.isFrozen(active), true);

  const cancelled = cancelDemandAggregateState(active);
  deepEqual(cancelled, {
    ...active,
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
      ...createInitialDemandAggregateState(DEMAND_ID),
      tasking: { taskPackages: [], targetTasks: [] },
    }),
    (error: unknown) => (
      error instanceof DemandAggregateStateError
      && error.reason === "schema"
    ),
  );
});
