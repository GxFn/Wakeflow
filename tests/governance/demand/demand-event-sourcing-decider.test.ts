import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  decideDemandEventSourcingCommand,
  evolveDemandEventSourcingState,
  DemandEventSourcingDecisionError,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import {
  createTaskPackageFixture,
  TARGET_TASK_ID,
  TASKING_AUTHORITY_DIGEST,
  TASKING_DEMAND_ID,
} from "../tasking/task-package.fixture.js";

const PUBLISHED_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_22222222-2222-4222-8222-222222222222",
  "demand-event",
);
const PLANNED_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_33333333-3333-4333-8333-333333333333",
  "demand-event",
);
const CANCELLED_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_99999999-9999-4999-8999-999999999999",
  "demand-event",
);
const PUBLISHED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");
const CANCELLED_AT = parseUtcInstant("2026-08-26T11:00:00.000Z");
const IDENTITY_DIGEST = parseSha256Digest(`sha256:${"a".repeat(64)}`);
const WRONG_AUTHORITY_DIGEST = parseSha256Digest(`sha256:${"d".repeat(64)}`);

test("Demand Event Sourcing decider 只产生业务事件，持久化位置由 Store 分配", () => {
  const [published] = decideDemandEventSourcingCommand(null, {
    commandType: "publication.publish-demand",
    commandVersion: 1,
    demandId: TASKING_DEMAND_ID,
    eventId: PUBLISHED_EVENT_ID,
    recordedAt: PUBLISHED_AT,
    identityDigest: IDENTITY_DIGEST,
    authorityDigest: TASKING_AUTHORITY_DIGEST,
  });

  equal(published?.eventType, "publication.demand-published");
  equal(Object.hasOwn(published ?? {}, "eventVersion"), false);
  equal(Object.hasOwn(published ?? {}, "streamRevision"), false);
  equal(Object.hasOwn(published ?? {}, "previousEvent"), false);
  equal(Object.hasOwn(published ?? {}, "resultingStateDigest"), false);

  const active = evolveDemandEventSourcingState(null, published);
  equal(active.lifecycle, "active");

  const taskPackage = createTaskPackageFixture();
  const [planned] = decideDemandEventSourcingCommand(active, {
    commandType: "tasking.plan-target-task",
    commandVersion: 1,
    eventId: PLANNED_EVENT_ID,
    taskPackage,
  });
  equal(planned?.eventType, "tasking.target-task-planned");
  if (planned?.eventType !== "tasking.target-task-planned") {
    throw new Error("Expected target task planned event.");
  }
  deepEqual(planned.data.taskPackage, taskPackage);
  const tasking = evolveDemandEventSourcingState(active, planned);
  equal(tasking.targetTasks[0]?.targetTaskId, TARGET_TASK_ID);

  throws(
    () => decideDemandEventSourcingCommand(tasking, {
      commandType: "tasking.plan-target-task",
      commandVersion: 1,
      eventId: PLANNED_EVENT_ID,
      taskPackage,
    }),
    (error: unknown) => (
      error instanceof DemandEventSourcingDecisionError
      && error.reason === "transition"
    ),
  );
  throws(
    () => decideDemandEventSourcingCommand(active, {
      commandType: "tasking.plan-target-task",
      commandVersion: 1,
      eventId: PLANNED_EVENT_ID,
      taskPackage: {
        ...taskPackage,
        demandAuthorityDigest: WRONG_AUTHORITY_DIGEST,
      },
    }),
    (error: unknown) => (
      error instanceof DemandEventSourcingDecisionError
      && error.reason === "transition"
    ),
  );

  const [cancelled] = decideDemandEventSourcingCommand(tasking, {
    commandType: "lifecycle.cancel-demand",
    commandVersion: 1,
    demandId: TASKING_DEMAND_ID,
    eventId: CANCELLED_EVENT_ID,
    recordedAt: CANCELLED_AT,
    reason: "用户终止该 Demand",
  });
  equal(cancelled?.eventType, "lifecycle.demand-cancelled");
  const terminal = evolveDemandEventSourcingState(tasking, cancelled);
  equal(terminal.lifecycle, "cancelled");

  throws(
    () => decideDemandEventSourcingCommand(terminal, {
      commandType: "lifecycle.cancel-demand",
      commandVersion: 1,
      demandId: TASKING_DEMAND_ID,
      eventId: CANCELLED_EVENT_ID,
      recordedAt: CANCELLED_AT,
      reason: "重复终止",
    }),
    DemandEventSourcingDecisionError,
  );
});
