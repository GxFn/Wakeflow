import {
  equal,
  rejects,
} from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/foundation/identity/wakeflow-durable-id.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  executeDemandEventSourcingCommand,
  DemandEventSourcingCommandHandlerError,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import {
  DemandEventSourcingRepository,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { DemandFileEventStore } from "../../../src/governance/demand/event-sourcing/demand-file-event-store.js";
import { DemandFileEventSnapshotStore } from "../../../src/governance/demand/event-sourcing/demand-file-event-snapshot-store.js";

const DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_11111111-1111-4111-8111-111111111111",
  "demand",
);
const EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_22222222-2222-4222-8222-222222222222",
  "demand-event",
);
const OTHER_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_55555555-5555-4555-8555-555555555555",
  "demand-event",
);
const COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_33333333-3333-4333-8333-333333333333",
  "demand-event-commit",
);
const OTHER_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_44444444-4444-4444-8444-444444444444",
  "demand-event-commit",
);
const RECORDED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");
const CANCELLED_AT = parseUtcInstant("2026-08-26T11:00:00.000Z");
const IDENTITY_DIGEST = parseSha256Digest(`sha256:${"a".repeat(64)}`);
const AUTHORITY_DIGEST = parseSha256Digest(`sha256:${"b".repeat(64)}`);

const COMMAND = Object.freeze({
  commandType: "publication.publish-demand" as const,
  commandVersion: 1 as const,
  demandId: DEMAND_ID,
  eventId: EVENT_ID,
  recordedAt: RECORDED_AT,
  identityDigest: IDENTITY_DIGEST,
  authorityDigest: AUTHORITY_DIGEST,
});

function cancellationCommand(eventId = OTHER_EVENT_ID) {
  return Object.freeze({
    commandType: "lifecycle.cancel-demand" as const,
    commandVersion: 1 as const,
    demandId: DEMAND_ID,
    eventId,
    recordedAt: CANCELLED_AT,
    reason: "用户终止该 Demand",
  });
}

test("Demand Event Sourcing Command Handler 执行 load-decide-append 并按 commitId 幂等", async () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-demand-command-handler-"));
  const root = await RootedDirectory.open(fixtureRoot);
  try {
    const eventStore = new DemandFileEventStore(root);
    const repository = new DemandEventSourcingRepository(
      eventStore,
      new DemandFileEventSnapshotStore(root),
    );
    await eventStore.initialize();

    const committed = await executeDemandEventSourcingCommand(
      repository,
      COMMAND,
      { commitId: COMMIT_ID, expectedStreamRevision: 0 },
    );
    equal(committed.disposition, "committed");
    equal(committed.aggregate.streamRevision, 1);
    equal(committed.aggregate.state.lifecycle, "active");
    await repository.publishSnapshot(committed.aggregate);
    equal((await repository.load())?.snapshotStatus, "used");

    const retried = await executeDemandEventSourcingCommand(
      repository,
      COMMAND,
      { commitId: COMMIT_ID, expectedStreamRevision: 0 },
    );
    equal(retried.disposition, "idempotent");
    equal(retried.commit.commitId, COMMIT_ID);
    equal((await eventStore.readCommits()).commits.length, 1);

    await rejects(
      executeDemandEventSourcingCommand(repository, COMMAND, {
        commitId: OTHER_COMMIT_ID,
        expectedStreamRevision: 0,
      }),
      (error: unknown) => (
        error instanceof DemandEventSourcingCommandHandlerError
        && error.reason === "concurrency-conflict"
      ),
    );

    await rejects(
      executeDemandEventSourcingCommand(
        repository,
        cancellationCommand(),
        { commitId: COMMIT_ID, expectedStreamRevision: 1 },
      ),
      (error: unknown) => (
        error instanceof DemandEventSourcingCommandHandlerError
        && error.reason === "idempotency-conflict"
      ),
    );
    await rejects(
      executeDemandEventSourcingCommand(
        repository,
        cancellationCommand(EVENT_ID),
        { commitId: OTHER_COMMIT_ID, expectedStreamRevision: 1 },
      ),
      (error: unknown) => (
        error instanceof DemandEventSourcingCommandHandlerError
        && error.reason === "idempotency-conflict"
      ),
    );
    equal((await eventStore.readCommits()).commits.length, 1);
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
