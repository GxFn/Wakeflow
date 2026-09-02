import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  decideDemandEventSourcingCommand,
  evolveDemandEventSourcingState,
  DemandEventSourcingDecisionError,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import {
  parseDemandUncommittedEvent,
  DemandEventSourcingEventError,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-event.js";
import { encodeCurrentDemandEventVersion } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-event-version-codec.js";
import {
  applyDemandEventStreamCommit,
  prepareDemandEventStreamCommit,
} from "../../../src/governance/demand/event-sourcing/demand-event-stream-commit.js";
import { upcastDemandEventSourcingStoredEvent } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-upcaster.js";
import {
  computeDemandAggregateStateDigest,
  createInitialDemandAggregateState,
  parseDemandAggregateState,
  recordManagedEvidenceInDemandAggregateState,
  DemandAggregateStateError,
} from "../../../src/governance/demand/model/demand-aggregate-state.js";
import {
  createManagedEvidenceManifest,
  type ManagedEvidenceManifest,
} from "../../../src/governance/evidence/managed-evidence-manifest.js";

const DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_11111111-1111-4111-8111-111111111111",
  "demand",
);
const PROGRAM_ID = parseWakeflowDurableIdOfKind(
  "program_22222222-2222-4222-8222-222222222222",
  "program",
);
const REPOSITORY_ID = parseWakeflowDurableIdOfKind(
  "repository_33333333-3333-4333-8333-333333333333",
  "repository",
);
const WINDOW_ID = parseWakeflowDurableIdOfKind(
  "window_44444444-4444-4444-8444-444444444444",
  "window",
);
const EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_55555555-5555-4555-8555-555555555555",
  "demand-event",
);
const PUBLICATION_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_99999999-9999-4999-8999-999999999999",
  "demand-event",
);
const PUBLICATION_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "demand-event-commit",
);
const EVIDENCE_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "demand-event-commit",
);
const AUTHORITY_DIGEST = parseSha256Digest(`sha256:${"a".repeat(64)}`);
const CONFIG_DIGEST = parseSha256Digest(`sha256:${"b".repeat(64)}`);
const CONTENT_DIGEST = parseSha256Digest(`sha256:${"c".repeat(64)}`);
const CAPTURED_AT = parseUtcInstant("2026-09-01T22:00:00.000Z");

function createManifest(
  uuid = "66666666-6666-4666-8666-666666666666",
  demandAuthorityDigest = AUTHORITY_DIGEST,
): Readonly<ManagedEvidenceManifest> {
  const treeManifest = Object.freeze({
    artifactKind: "wakeflow-loaded-artifact-tree" as const,
    schemaVersion: 1 as const,
    fileCount: 1,
    files: Object.freeze([
      Object.freeze({
        bytes: 5,
        digest: CONTENT_DIGEST,
        executable: false,
        ref: "content",
      }),
    ]),
    totalBytes: 5,
  });
  return createManagedEvidenceManifest(
    {
      evidenceId: parseWakeflowDurableIdOfKind(`evidence_${uuid}`, "evidence"),
      programId: PROGRAM_ID,
      demandId: DEMAND_ID,
      demandAuthorityDigest,
      evidenceType: "test-output",
      recordedBy: { windowId: WINDOW_ID, configDigest: CONFIG_DIGEST },
      source: {
        root: { kind: "repository", repositoryId: REPOSITORY_ID },
        path: "artifacts/result.txt",
        resourceType: "file",
      },
      sensitivity: "internal",
      payload: {
        artifactDigest: computeCanonicalJsonSha256Digest(treeManifest),
        treeManifest,
      },
      contentReview: {
        disposition: "not-required",
        opaqueFileRefs: [],
      },
    },
    { clock: () => CAPTURED_AT },
  );
}

test("Managed Evidence Event保存完整Manifest，Aggregate只投影稳定selector", () => {
  const manifest = createManifest();
  const initial = createInitialDemandAggregateState(
    DEMAND_ID,
    AUTHORITY_DIGEST,
  );
  equal(Object.hasOwn(initial, "managedEvidence"), false);

  const [event] = decideDemandEventSourcingCommand(initial, {
    commandType: "evidence.record-managed-evidence",
    commandVersion: 1,
    eventId: EVENT_ID,
    manifest,
  });
  equal(event?.eventType, "evidence.managed-evidence-recorded");
  if (event?.eventType !== "evidence.managed-evidence-recorded") {
    throw new Error("Expected managed evidence recorded event.");
  }
  deepEqual(event.data.manifest, manifest);
  equal(Object.hasOwn(event, "eventVersion"), false);
  equal(Object.hasOwn(event, "streamRevision"), false);

  const state = evolveDemandEventSourcingState(initial, event);
  deepEqual(state.managedEvidence, [
    {
      evidenceId: manifest.evidenceId,
      manifestDigest: manifest.manifestDigest,
      payloadArtifactDigest: manifest.payload.artifactDigest,
    },
  ]);
  deepEqual(Object.keys(state.managedEvidence?.[0] ?? {}).sort(), [
    "evidenceId",
    "manifestDigest",
    "payloadArtifactDigest",
  ]);

  const encoded = encodeCurrentDemandEventVersion(event);
  equal(encoded.eventType, "evidence.managed-evidence-recorded");
  equal(encoded.eventVersion, 1);
  const upcast = upcastDemandEventSourcingStoredEvent({
    artifactKind: "wakeflow-demand-event-sourcing-event",
    schemaVersion: 1,
    eventId: EVENT_ID,
    demandId: DEMAND_ID,
    streamRevision: 2,
    recordedAt: CAPTURED_AT,
    eventType: encoded.eventType,
    eventVersion: encoded.eventVersion,
    data: encoded.data,
    resultingStateModelVersion: 1,
    resultingStateDigest: computeDemandAggregateStateDigest(state),
  });
  equal(upcast.eventType, "evidence.managed-evidence-recorded");
  if (upcast.eventType === "evidence.managed-evidence-recorded") {
    equal(upcast.data.manifest.manifestDigest, manifest.manifestDigest);
  }
});

test("Managed Evidence reducer按ID排序，并拒绝重复或错误Authority", () => {
  const initial = createInitialDemandAggregateState(
    DEMAND_ID,
    AUTHORITY_DIGEST,
  );
  const later = createManifest("88888888-8888-4888-8888-888888888888");
  const earlier = createManifest("77777777-7777-4777-8777-777777777777");
  const first = recordManagedEvidenceInDemandAggregateState(initial, later);
  const second = recordManagedEvidenceInDemandAggregateState(first, earlier);
  deepEqual(
    second.managedEvidence?.map((entry) => entry.evidenceId),
    [earlier.evidenceId, later.evidenceId],
  );

  throws(
    () => recordManagedEvidenceInDemandAggregateState(second, earlier),
    (error: unknown) =>
      error instanceof DemandAggregateStateError &&
      error.reason === "transition",
  );
  throws(
    () =>
      recordManagedEvidenceInDemandAggregateState(
        initial,
        createManifest(
          "99999999-9999-4999-8999-999999999999",
          parseSha256Digest(`sha256:${"d".repeat(64)}`),
        ),
      ),
    (error: unknown) =>
      error instanceof DemandAggregateStateError &&
      error.reason === "transition",
  );
  throws(
    () =>
      parseDemandAggregateState({
        ...second,
        managedEvidence: [...(second.managedEvidence ?? [])].reverse(),
      }),
    (error: unknown) =>
      error instanceof DemandAggregateStateError && error.reason === "relation",
  );
});

test("Managed Evidence Event经过真实Commit编码后可从前缀精确重放", () => {
  const [publishedEvent] = decideDemandEventSourcingCommand(null, {
    commandType: "publication.publish-demand",
    commandVersion: 1,
    demandId: DEMAND_ID,
    eventId: PUBLICATION_EVENT_ID,
    recordedAt: parseUtcInstant("2026-09-01T21:59:00.000Z"),
    identityDigest: parseSha256Digest(`sha256:${"e".repeat(64)}`),
    authorityDigest: AUTHORITY_DIGEST,
  });
  const published = prepareDemandEventStreamCommit(null, {
    commitId: PUBLICATION_COMMIT_ID,
    commandDigest: parseSha256Digest(`sha256:${"f".repeat(64)}`),
    events: [publishedEvent],
  });
  const manifest = createManifest();
  const [evidenceEvent] = decideDemandEventSourcingCommand(
    published.aggregate.state,
    {
      commandType: "evidence.record-managed-evidence",
      commandVersion: 1,
      eventId: EVENT_ID,
      manifest,
    },
  );
  const recorded = prepareDemandEventStreamCommit(published.aggregate, {
    commitId: EVIDENCE_COMMIT_ID,
    commandDigest: parseSha256Digest(`sha256:${"1".repeat(64)}`),
    events: [evidenceEvent],
  });

  equal(recorded.commit.events[0]?.eventVersion, 1);
  equal(
    recorded.commit.events[0]?.eventType,
    "evidence.managed-evidence-recorded",
  );
  const replayed = applyDemandEventStreamCommit(
    published.aggregate,
    recorded.commit,
  );
  deepEqual(replayed, recorded.aggregate);
  equal(
    replayed.state.managedEvidence?.[0]?.manifestDigest,
    manifest.manifestDigest,
  );
});

test("Event与Command严格闭合Manifest的Demand、时间和字段集合", () => {
  const manifest = createManifest();
  const initial = createInitialDemandAggregateState(
    DEMAND_ID,
    AUTHORITY_DIGEST,
  );
  throws(
    () =>
      parseDemandUncommittedEvent({
        eventId: EVENT_ID,
        demandId: DEMAND_ID,
        recordedAt: parseUtcInstant("2026-09-01T22:00:01.000Z"),
        eventType: "evidence.managed-evidence-recorded",
        data: { manifest },
      }),
    (error: unknown) =>
      error instanceof DemandEventSourcingEventError &&
      error.reason === "relation",
  );
  throws(
    () =>
      decideDemandEventSourcingCommand(initial, {
        commandType: "evidence.record-managed-evidence",
        commandVersion: 1,
        eventId: EVENT_ID,
        manifest,
        expectedStateDigest: computeDemandAggregateStateDigest(initial),
      }),
    (error: unknown) =>
      error instanceof DemandEventSourcingDecisionError &&
      error.reason === "input",
  );
});
