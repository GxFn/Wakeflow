import { deepEqual, equal, notEqual, ok, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../../src/contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../../../src/foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest } from "../../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../../src/foundation/time/utc-instant.js";
import { decideDemandEventSourcingCommand } from "../../../../src/governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import {
  computeDemandEventSourcingPersistedEventEnvelopeDigest,
  DEMAND_EVENT_SOURCING_PERSISTED_EVENT_ARTIFACT_KIND,
  DEMAND_EVENT_SOURCING_PERSISTED_EVENT_SCHEMA_VERSION,
  DemandEventSourcingPersistedEventEnvelopeError,
  type DemandEventSourcingPersistedEventEnvelopeErrorReason,
  parseDemandEventSourcingPersistedEventEnvelope,
  parseDemandEventSourcingPersistedEventEnvelopeDocument,
  renderDemandEventSourcingPersistedEventEnvelope,
} from "../../../../src/governance/demand/event-sourcing/demand-event-sourcing-persisted-event-envelope.js";
import { prepareDemandEventStreamCommit } from "../../../../src/governance/demand/event-sourcing/demand-event-stream-commit.js";

/** Direct coverage of the version-stable persisted event envelope, fed by a real decider event. */

const DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_11111111-1111-4111-8111-111111111111",
  "demand",
);
const EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_22222222-2222-4222-8222-222222222222",
  "demand-event",
);
const COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_44444444-4444-4444-8444-444444444444",
  "demand-event-commit",
);
const RECORDED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");
const IDENTITY_DIGEST = parseSha256Digest(`sha256:${"a".repeat(64)}`);
const AUTHORITY_DIGEST = parseSha256Digest(`sha256:${"b".repeat(64)}`);
const COMMAND_DIGEST = parseSha256Digest(`sha256:${"c".repeat(64)}`);

/** The first stored event of a real first commit: the writer-side producer of this envelope. */
function committedEvent() {
  const events = decideDemandEventSourcingCommand(null, {
    commandType: "publication.publish-demand",
    commandVersion: 1,
    demandId: DEMAND_ID,
    eventId: EVENT_ID,
    recordedAt: RECORDED_AT,
    identityDigest: IDENTITY_DIGEST,
    authorityDigest: AUTHORITY_DIGEST,
  });
  return prepareDemandEventStreamCommit(null, {
    commitId: COMMIT_ID,
    commandDigest: COMMAND_DIGEST,
    events,
  }).commit.events[0];
}

/** A mutable plain-JSON copy of the committed envelope, ready for tampering. */
function wireOf(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(committedEvent())) as Record<string, unknown>;
}

function expectEnvelopeError(
  action: () => unknown,
  reason: DemandEventSourcingPersistedEventEnvelopeErrorReason,
  errorPath?: string,
): void {
  throws(action, (error: unknown) => {
    if (!(error instanceof DemandEventSourcingPersistedEventEnvelopeError)) return false;
    equal(error.reason, reason);
    equal(error.name, "DemandEventSourcingPersistedEventEnvelopeError");
    equal(error.code, "wakeflow-demand-event-sourcing-persisted-event-envelope");
    if (errorPath !== undefined) equal(error.path, errorPath);
    return true;
  });
}

test("a committed Demand event round-trips through wire, document and digest", () => {
  const event = committedEvent();
  equal(DEMAND_EVENT_SOURCING_PERSISTED_EVENT_ARTIFACT_KIND, "wakeflow-demand-event-sourcing-event");
  equal(DEMAND_EVENT_SOURCING_PERSISTED_EVENT_SCHEMA_VERSION, 1);
  const parsed = parseDemandEventSourcingPersistedEventEnvelope(wireOf());
  deepEqual(parsed, event);
  ok(Object.isFrozen(parsed));
  equal(parsed.artifactKind, DEMAND_EVENT_SOURCING_PERSISTED_EVENT_ARTIFACT_KIND);
  equal(parsed.schemaVersion, DEMAND_EVENT_SOURCING_PERSISTED_EVENT_SCHEMA_VERSION);
  equal(parsed.demandId, DEMAND_ID);
  equal(parsed.eventId, EVENT_ID);
  equal(parsed.streamRevision, 1);
  equal(parsed.recordedAt, RECORDED_AT);

  const text = renderDemandEventSourcingPersistedEventEnvelope(event);
  equal(text, `${JSON.stringify(event, null, 2)}\n`);
  deepEqual(parseDemandEventSourcingPersistedEventEnvelopeDocument(text), event);

  const digest = computeDemandEventSourcingPersistedEventEnvelopeDigest(event);
  equal(digest, computeCanonicalJsonSha256Digest(event));
  // Wire key order is not identity: the envelope is rebuilt in its own field order.
  const reversed = Object.fromEntries(Object.entries(wireOf()).reverse());
  equal(computeDemandEventSourcingPersistedEventEnvelopeDigest(reversed), digest);
  equal(renderDemandEventSourcingPersistedEventEnvelope(reversed), text);
});

test("unknown eventType and eventVersion stay parseable routing facts with their data intact", () => {
  const data = { nested: { list: [1, "two", null, false], empty: {} } };
  const parsed = parseDemandEventSourcingPersistedEventEnvelope({
    ...wireOf(),
    eventType: "future.family.event-v2",
    eventVersion: 99,
    resultingStateModelVersion: 7,
    data,
  });
  equal(parsed.eventType, "future.family.event-v2");
  equal(parsed.eventVersion, 99);
  equal(parsed.resultingStateModelVersion, 7);
  deepEqual(JSON.parse(JSON.stringify(parsed.data)), data);
  equal(Object.getPrototypeOf(parsed.data), null);
  notEqual(parsed.data, data);
});

test("the envelope digest changes with every persisted field", () => {
  const base = computeDemandEventSourcingPersistedEventEnvelopeDigest(wireOf());
  const variants: readonly (readonly [string, unknown])[] = [
    ["eventId", "demand-event_33333333-3333-4333-8333-333333333333"],
    ["demandId", "demand_33333333-3333-4333-8333-333333333333"],
    ["streamRevision", 2],
    ["recordedAt", "2026-08-26T10:00:00.001Z"],
    ["eventType", "publication.other-event"],
    ["eventVersion", 2],
    ["data", {}],
    ["resultingStateModelVersion", 2],
    ["resultingStateDigest", `sha256:${"f".repeat(64)}`],
  ];
  for (const [key, value] of variants) {
    notEqual(computeDemandEventSourcingPersistedEventEnvelopeDigest({ ...wireOf(), [key]: value }), base, key);
  }
});

test("values that are not passive JSON data are rejected as json before the Schema runs", () => {
  expectEnvelopeError(() => parseDemandEventSourcingPersistedEventEnvelope(undefined), "json", "$event");
  expectEnvelopeError(() => parseDemandEventSourcingPersistedEventEnvelope("{}"), "schema", "$");
  expectEnvelopeError(
    () => parseDemandEventSourcingPersistedEventEnvelope(new Proxy(wireOf(), {})),
    "json",
    "$event",
  );
  expectEnvelopeError(
    () => parseDemandEventSourcingPersistedEventEnvelope({ ...wireOf(), data: { callback() {} } }),
    "json",
  );
  const cyclic = wireOf();
  cyclic.data = { self: cyclic };
  expectEnvelopeError(() => parseDemandEventSourcingPersistedEventEnvelope(cyclic), "json");
  expectEnvelopeError(
    () => parseDemandEventSourcingPersistedEventEnvelope({ ...wireOf(), streamRevision: -0 }),
    "json",
    "$event/streamRevision",
  );
});

test("Schema rejections cover kind, version, identity, time, shape, bounds and extra fields", () => {
  // Identity, digest, revision and state-version formats are already closed by the Schema, so
  // malformed values surface as `schema` rather than their dedicated reasons.
  const rejected: readonly (readonly [Record<string, unknown>, string])[] = [
    [{ artifactKind: "wakeflow-demand-event" }, "$/artifactKind"],
    [{ schemaVersion: 2 }, "$/schemaVersion"],
    [{ eventId: "demand-event_not-a-uuid" }, "$/eventId"],
    [{ eventId: "demand_11111111-1111-4111-8111-111111111111" }, "$/eventId"],
    [{ demandId: "DEMAND_11111111-1111-4111-8111-111111111111" }, "$/demandId"],
    [{ streamRevision: 0 }, "$/streamRevision"],
    [{ streamRevision: 1.5 }, "$/streamRevision"],
    [{ streamRevision: "1" }, "$/streamRevision"],
    [{ recordedAt: "2026-08-26 10:00:00" }, "$/recordedAt"],
    [{ recordedAt: "2026-08-26T10:00:00.000+00:00" }, "$/recordedAt"],
    [{ eventType: "no-dots" }, "$/eventType"],
    [{ eventType: "Upper.case" }, "$/eventType"],
    [{ eventType: `${"a".repeat(130)}.b` }, "$/eventType"],
    [{ eventVersion: 0 }, "$/eventVersion"],
    [{ data: [] }, "$/data"],
    [{ data: null }, "$/data"],
    [{ data: "text" }, "$/data"],
    [{ data: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, i])) }, "$/data"],
    [{ resultingStateModelVersion: 0 }, "$/resultingStateModelVersion"],
    [{ resultingStateDigest: "sha256:short" }, "$/resultingStateDigest"],
    [{ resultingStateDigest: `SHA256:${"a".repeat(64)}` }, "$/resultingStateDigest"],
  ];
  for (const [patch, errorPath] of rejected) {
    expectEnvelopeError(
      () => parseDemandEventSourcingPersistedEventEnvelope({ ...wireOf(), ...patch }),
      "schema",
      errorPath,
    );
  }
  for (const key of Object.keys(wireOf())) {
    const missing = wireOf();
    delete missing[key];
    expectEnvelopeError(() => parseDemandEventSourcingPersistedEventEnvelope(missing), "schema", "$");
  }
  expectEnvelopeError(
    () => parseDemandEventSourcingPersistedEventEnvelope({ ...wireOf(), extra: true }),
    "schema",
    "$",
  );
  expectEnvelopeError(() => parseDemandEventSourcingPersistedEventEnvelope([]), "schema", "$");
  expectEnvelopeError(() => parseDemandEventSourcingPersistedEventEnvelope(null), "schema", "$");
});

test("a calendar-impossible instant passes the Schema pattern but is rejected as time", () => {
  expectEnvelopeError(
    () =>
      parseDemandEventSourcingPersistedEventEnvelope({
        ...wireOf(),
        recordedAt: "2026-02-30T00:00:00.000Z",
      }),
    "time",
    "$/recordedAt",
  );
  expectEnvelopeError(
    () => computeDemandEventSourcingPersistedEventEnvelopeDigest({ ...wireOf(), recordedAt: "2026-04-31T12:00:00Z" }),
    "time",
    "$/recordedAt",
  );
});

test("document parsing admits only the exact deterministic rendering of an envelope", () => {
  const text = renderDemandEventSourcingPersistedEventEnvelope(committedEvent());
  const parse = parseDemandEventSourcingPersistedEventEnvelopeDocument;
  expectEnvelopeError(() => parse(42), "representation", "$event");
  expectEnvelopeError(() => parse(undefined), "representation", "$event");
  expectEnvelopeError(() => parse("{"), "representation", "$event");
  expectEnvelopeError(() => parse(text.trimEnd()), "representation", "$event");
  expectEnvelopeError(() => parse(`${text}\n`), "representation", "$event");
  expectEnvelopeError(() => parse(JSON.stringify(JSON.parse(text))), "representation", "$event");
  expectEnvelopeError(() => parse(text.replace('"streamRevision": 1', '"streamRevision": 1 ')), "representation", "$event");
  // Reordered keys are deterministic text, but not the envelope's own rendering.
  const reordered = `${JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(text)).reverse()), null, 2)}\n`;
  notEqual(reordered, text);
  expectEnvelopeError(() => parse(reordered), "representation", "$event");
  // Deterministic text that is not an envelope keeps the inner rejection.
  expectEnvelopeError(() => parse(`${JSON.stringify({ hello: "world" }, null, 2)}\n`), "schema", "$");
  const impossible = text.replace("2026-08-26T10:00:00.000Z", "2026-02-30T10:00:00.000Z");
  expectEnvelopeError(() => parse(impossible), "time", "$/recordedAt");
  deepEqual(parse(text), committedEvent());
});
