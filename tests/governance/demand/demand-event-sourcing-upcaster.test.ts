import {
  equal,
  throws,
} from "node:assert/strict";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  upcastDemandEventSourcingStoredEvent,
  DemandEventSourcingUpcasterError,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-upcaster.js";
import {
  createTaskPackageFixture,
  TASKING_DEMAND_ID,
} from "../tasking/task-package.fixture.js";

const EVENT = Object.freeze({
  artifactKind: "wakeflow-demand-event-sourcing-event" as const,
  schemaVersion: 1 as const,
  eventId: parseWakeflowDurableIdOfKind(
    "demand-event_11111111-1111-4111-8111-111111111111",
    "demand-event",
  ),
  demandId: parseWakeflowDurableIdOfKind(
    "demand_22222222-2222-4222-8222-222222222222",
    "demand",
  ),
  streamRevision: 1,
  recordedAt: parseUtcInstant("2026-08-26T10:00:00.000Z"),
  eventType: "publication.demand-published" as const,
  eventVersion: 1 as const,
  data: Object.freeze({
    identityRef: "identity.json" as const,
    identityDigest: parseSha256Digest(`sha256:${"a".repeat(64)}`),
    authorityRef: "authority.json" as const,
    authorityDigest: parseSha256Digest(`sha256:${"b".repeat(64)}`),
  }),
  resultingStateModelVersion: 1,
  resultingStateDigest: parseSha256Digest(`sha256:${"c".repeat(64)}`),
});

test("Demand Event Sourcing upcaster 显式路由 eventType + eventVersion", () => {
  const current = upcastDemandEventSourcingStoredEvent(EVENT);
  equal(current.eventType, "publication.demand-published");
  equal(Object.hasOwn(current, "streamRevision"), false);
  equal(Object.hasOwn(current, "eventVersion"), false);

  const cancelled = upcastDemandEventSourcingStoredEvent({
    ...EVENT,
    eventType: "lifecycle.demand-cancelled",
    data: { reason: "用户终止该 Demand" },
  });
  equal(cancelled.eventType, "lifecycle.demand-cancelled");
  if (cancelled.eventType === "lifecycle.demand-cancelled") {
    equal(cancelled.data.reason, "用户终止该 Demand");
  }

  const taskPackage = createTaskPackageFixture();
  const planned = upcastDemandEventSourcingStoredEvent({
    ...EVENT,
    demandId: TASKING_DEMAND_ID,
    recordedAt: taskPackage.createdAt,
    eventType: "tasking.target-task-planned",
    data: { taskPackage },
  });
  equal(planned.eventType, "tasking.target-task-planned");
  if (planned.eventType === "tasking.target-task-planned") {
    equal(planned.data.taskPackage.taskPackageId, taskPackage.taskPackageId);
  }
  throws(
    () => upcastDemandEventSourcingStoredEvent({
      ...EVENT,
      demandId: TASKING_DEMAND_ID,
      eventType: "tasking.target-task-planned",
      data: { taskPackage },
    }),
    (error: unknown) => (
      error instanceof DemandEventSourcingUpcasterError
      && error.reason === "event"
    ),
  );

  throws(
    () => upcastDemandEventSourcingStoredEvent({ ...EVENT, eventVersion: 2 }),
    (error: unknown) => (
      error instanceof DemandEventSourcingUpcasterError
      && error.reason === "unsupported-version"
    ),
  );
  throws(
    () => upcastDemandEventSourcingStoredEvent({ ...EVENT, streamRevision: 0 }),
    (error: unknown) => (
      error instanceof DemandEventSourcingUpcasterError
      && error.reason === "input"
    ),
  );
  throws(
    () => upcastDemandEventSourcingStoredEvent({
      ...EVENT,
      eventType: "future.demand-reopened",
    }),
    (error: unknown) => (
      error instanceof DemandEventSourcingUpcasterError
      && error.reason === "unsupported-event-type"
    ),
  );
  throws(
    () => upcastDemandEventSourcingStoredEvent({
      ...EVENT,
      data: { ...EVENT.data, extra: true },
    }),
    (error: unknown) => (
      error instanceof DemandEventSourcingUpcasterError
      && error.reason === "codec"
    ),
  );
});
