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
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import {
  applyDemandEventStreamCommit,
  computeDemandEventStreamCommitDigest,
  formatDemandEventStreamCommitFileName,
  parseDemandEventStreamCommitDocument,
  prepareDemandEventStreamCommit,
  renderDemandEventStreamCommit,
  DemandEventStreamCommitError,
} from "../../../src/governance/demand/event-sourcing/demand-event-stream-commit.js";

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
const FIRST_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_44444444-4444-4444-8444-444444444444",
  "demand-event-commit",
);
const SECOND_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_55555555-5555-4555-8555-555555555555",
  "demand-event-commit",
);
const PUBLISHED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");
const CANCELLED_AT = parseUtcInstant("2026-08-26T11:00:00.000Z");
const IDENTITY_DIGEST = parseSha256Digest(`sha256:${"a".repeat(64)}`);
const AUTHORITY_DIGEST = parseSha256Digest(`sha256:${"b".repeat(64)}`);
const FIRST_COMMAND_DIGEST = parseSha256Digest(`sha256:${"c".repeat(64)}`);
const SECOND_COMMAND_DIGEST = parseSha256Digest(`sha256:${"d".repeat(64)}`);

test("一次 Demand Event Sourcing append 形成一个固定 commitSequence 的 immutable commit", () => {
  const published = decideDemandEventSourcingCommand(null, {
    commandType: "publication.publish-demand",
    commandVersion: 1,
    demandId: DEMAND_ID,
    eventId: PUBLISHED_EVENT_ID,
    recordedAt: PUBLISHED_AT,
    identityDigest: IDENTITY_DIGEST,
    authorityDigest: AUTHORITY_DIGEST,
  });
  const first = prepareDemandEventStreamCommit(null, {
    commitId: FIRST_COMMIT_ID,
    commandDigest: FIRST_COMMAND_DIGEST,
    events: published,
  });

  equal(formatDemandEventStreamCommitFileName(1), "0000000000000001.json");
  equal(first.commit.commitSequence, 1);
  equal(first.commit.expectedStreamRevision, 0);
  equal(first.commit.firstStreamRevision, 1);
  equal(first.commit.lastStreamRevision, 1);
  equal(first.commit.previousCommitDigest, null);
  equal(first.commit.events[0]?.streamRevision, 1);
  equal(first.commit.events[0]?.eventVersion, 1);
  equal(first.commit.events[0]?.resultingStateModelVersion, 1);
  equal(Object.hasOwn(first.commit.events[0] ?? {}, "previousEvent"), false);
  equal(first.aggregate.state.lifecycle, "active");
  equal(first.sourceExpectation.lastEventDigest, null);
  equal(first.sourceExpectation.stateDigest, null);
  equal(Object.isFrozen(first.sourceExpectation), true);
  for (const [field, reason] of [
    ["eventVersion", "event-version"],
    ["resultingStateModelVersion", "state-version"],
  ] as const) {
    throws(
      () => applyDemandEventStreamCommit(null, {
        ...first.commit,
        events: [{ ...first.commit.events[0], [field]: 2 }],
      }),
      (error: unknown) => (
        error instanceof DemandEventStreamCommitError
        && error.reason === reason
      ),
    );
  }

  const cancelled = decideDemandEventSourcingCommand(first.aggregate.state, {
    commandType: "lifecycle.cancel-demand",
    commandVersion: 1,
    demandId: DEMAND_ID,
    eventId: CANCELLED_EVENT_ID,
    recordedAt: CANCELLED_AT,
    reason: "用户终止该 Demand",
  });
  const second = prepareDemandEventStreamCommit(first.aggregate, {
    commitId: SECOND_COMMIT_ID,
    commandDigest: SECOND_COMMAND_DIGEST,
    events: cancelled,
  });

  equal(second.commit.commitSequence, 2);
  equal(second.commit.expectedStreamRevision, 1);
  equal(second.commit.firstStreamRevision, 2);
  equal(second.commit.previousCommitDigest, computeDemandEventStreamCommitDigest(
    first.commit,
  ));
  equal(second.aggregate.state.lifecycle, "cancelled");
  equal(second.aggregate.streamRevision, 2);
  equal(second.aggregate.commitSequence, 2);
  equal(second.aggregate.lastCommitDigest, computeDemandEventStreamCommitDigest(
    second.commit,
  ));
  equal(
    second.sourceExpectation.lastEventDigest,
    first.aggregate.lastEventDigest,
  );
  equal(second.sourceExpectation.stateDigest, first.aggregate.stateDigest);

  const text = renderDemandEventStreamCommit(second.commit);
  deepEqual(parseDemandEventStreamCommitDocument(text), second.commit);
  throws(
    () => prepareDemandEventStreamCommit(second.aggregate, {
      commitId: SECOND_COMMIT_ID,
      commandDigest: SECOND_COMMAND_DIGEST,
      events: cancelled,
    }),
    DemandEventStreamCommitError,
  );
});
