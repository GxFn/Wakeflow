import {
  equal,
  throws,
} from "node:assert/strict";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/foundation/identity/wakeflow-durable-id.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  upcastDemandEventSourcingStoredEvent,
  DemandEventSourcingUpcasterError,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-upcaster.js";

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
  resultingStateDigest: parseSha256Digest(`sha256:${"c".repeat(64)}`),
});

test("Demand Event Sourcing upcaster 显式路由 eventType + eventVersion", () => {
  const current = upcastDemandEventSourcingStoredEvent(EVENT);
  equal(current.eventType, "publication.demand-published");
  equal(Object.hasOwn(current, "streamRevision"), false);

  throws(
    () => upcastDemandEventSourcingStoredEvent({ ...EVENT, eventVersion: 2 }),
    (error: unknown) => (
      error instanceof DemandEventSourcingUpcasterError
      && error.reason === "unsupported-version"
    ),
  );
});
