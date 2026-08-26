import {
  deepEqual,
  equal,
  throws,
} from "node:assert/strict";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/foundation/identity/wakeflow-durable-id.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  decideDemandEventSourcingCommand,
  evolveDemandEventSourcingState,
  DemandEventSourcingDecisionError,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-decider.js";

const DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_11111111-1111-4111-8111-111111111111",
  "demand",
);
const PUBLISHED_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_22222222-2222-4222-8222-222222222222",
  "demand-event",
);
const CANCELLED_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_33333333-3333-4333-8333-333333333333",
  "demand-event",
);
const PUBLISHED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");
const CANCELLED_AT = parseUtcInstant("2026-08-26T11:00:00.000Z");
const IDENTITY_DIGEST = parseSha256Digest(`sha256:${"a".repeat(64)}`);
const AUTHORITY_DIGEST = parseSha256Digest(`sha256:${"b".repeat(64)}`);

test("Demand Event Sourcing decider 只产生业务事件，持久化位置由 Store 分配", () => {
  const [published] = decideDemandEventSourcingCommand(null, {
    commandType: "publication.publish-demand",
    commandVersion: 1,
    demandId: DEMAND_ID,
    eventId: PUBLISHED_EVENT_ID,
    recordedAt: PUBLISHED_AT,
    identityDigest: IDENTITY_DIGEST,
    authorityDigest: AUTHORITY_DIGEST,
  });

  equal(published?.eventType, "publication.demand-published");
  equal(Object.hasOwn(published ?? {}, "streamRevision"), false);
  equal(Object.hasOwn(published ?? {}, "previousEvent"), false);
  equal(Object.hasOwn(published ?? {}, "resultingStateDigest"), false);

  const active = evolveDemandEventSourcingState(null, published);
  equal(active.lifecycle, "active");

  const [cancelled] = decideDemandEventSourcingCommand(active, {
    commandType: "lifecycle.cancel-demand",
    commandVersion: 1,
    demandId: DEMAND_ID,
    eventId: CANCELLED_EVENT_ID,
    recordedAt: CANCELLED_AT,
    reason: "用户终止该 Demand",
  });
  equal(cancelled?.eventType, "lifecycle.demand-cancelled");
  const terminal = evolveDemandEventSourcingState(active, cancelled);
  equal(terminal.lifecycle, "cancelled");
  deepEqual(terminal.tasking, { taskPackages: [], targetTasks: [] });

  throws(
    () => decideDemandEventSourcingCommand(terminal, {
      commandType: "lifecycle.cancel-demand",
      commandVersion: 1,
      demandId: DEMAND_ID,
      eventId: CANCELLED_EVENT_ID,
      recordedAt: CANCELLED_AT,
      reason: "重复终止",
    }),
    DemandEventSourcingDecisionError,
  );
});
