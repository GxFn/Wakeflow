import {
  deepEqual,
  equal,
  throws,
} from "node:assert/strict";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  decideDemandEventSourcingCommand,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import {
  prepareDemandEventStreamCommit,
} from "../../../src/governance/demand/event-sourcing/demand-event-stream-commit.js";
import {
  createDemandEventSourcingSnapshot,
  parseDemandEventSourcingSnapshot,
  parseDemandEventSourcingSnapshotDocument,
  renderDemandEventSourcingSnapshot,
  restoreDemandEventSourcingSnapshot,
  DemandEventSourcingSnapshotError,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-snapshot.js";
import {
  computeDemandEventSourcingVersionCompatibilityDigest,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-version-compatibility.js";

const DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_11111111-1111-4111-8111-111111111111",
  "demand",
);
const EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_22222222-2222-4222-8222-222222222222",
  "demand-event",
);
const COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_33333333-3333-4333-8333-333333333333",
  "demand-event-commit",
);
const RECORDED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");
const IDENTITY_DIGEST = parseSha256Digest(`sha256:${"a".repeat(64)}`);
const AUTHORITY_DIGEST = parseSha256Digest(`sha256:${"b".repeat(64)}`);
const COMMAND_DIGEST = parseSha256Digest(`sha256:${"c".repeat(64)}`);

function prepared() {
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
  });
}

test("Demand Event Sourcing snapshot 是按 commitSequence 定位的 immutable checkpoint", () => {
  const current = prepared();
  const snapshot = createDemandEventSourcingSnapshot(current.aggregate);

  equal(snapshot.artifactKind, "wakeflow-demand-event-sourcing-snapshot");
  equal(snapshot.schemaVersion, 1);
  equal(snapshot.commitSequence, 1);
  equal(snapshot.streamRevision, 1);
  equal(snapshot.lastCommitDigest, current.aggregate.lastCommitDigest);
  equal(
    snapshot.versionCompatibilityDigest,
    computeDemandEventSourcingVersionCompatibilityDigest(),
  );

  const restored = restoreDemandEventSourcingSnapshot(
    snapshot,
    current.commit,
  );
  deepEqual(restored, current.aggregate);

  const text = renderDemandEventSourcingSnapshot(snapshot);
  deepEqual(parseDemandEventSourcingSnapshotDocument(text), snapshot);
  throws(
    () => parseDemandEventSourcingSnapshot({
      ...snapshot,
      commitSequence: 2,
    }),
    DemandEventSourcingSnapshotError,
  );
  throws(
    () => parseDemandEventSourcingSnapshot({
      ...snapshot,
      versionCompatibilityDigest: IDENTITY_DIGEST,
    }),
    DemandEventSourcingSnapshotError,
  );
  throws(
    () => restoreDemandEventSourcingSnapshot(
      { ...snapshot, lastCommitDigest: IDENTITY_DIGEST },
      current.commit,
    ),
    DemandEventSourcingSnapshotError,
  );
});
