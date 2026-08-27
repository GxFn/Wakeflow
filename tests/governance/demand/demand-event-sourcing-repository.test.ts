import {
  equal,
  ok,
  rejects,
} from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  computeSha256Digest,
  parseSha256Digest,
} from "../../../src/foundation/crypto/sha256.js";
import {
  durableAtomicFileStageRef,
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import {
  createFileCandidateDurably,
} from "../../../src/foundation/filesystem/durable-file-candidate.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/foundation/identity/wakeflow-durable-id.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  decideDemandEventSourcingCommand,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import {
  prepareDemandEventStreamCommit,
} from "../../../src/governance/demand/event-sourcing/demand-event-stream-commit.js";
import {
  DemandFileEventStore,
} from "../../../src/governance/demand/event-sourcing/demand-file-event-store.js";
import {
  DemandFileEventSnapshotStore,
} from "../../../src/governance/demand/event-sourcing/demand-file-event-snapshot-store.js";
import {
  demandEventSourcingSnapshotRef,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-paths.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import {
  DemandEventSourcingRepository,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";

const DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_11111111-1111-4111-8111-111111111111",
  "demand",
);
const FIRST_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_22222222-2222-4222-8222-222222222222",
  "demand-event",
);
const SECOND_EVENT_ID = parseWakeflowDurableIdOfKind(
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

test("Demand Event Sourcing Repository 正常 load 使用 snapshot + tail，audit 完整 replay", async () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-demand-repository-"));
  const root = await RootedDirectory.open(fixtureRoot);
  try {
    const eventStore = new DemandFileEventStore(root);
    const snapshotStore = new DemandFileEventSnapshotStore(root);
    const repository = new DemandEventSourcingRepository(eventStore, snapshotStore);
    await eventStore.initialize();

    const firstEvents = decideDemandEventSourcingCommand(null, {
      commandType: "publication.publish-demand",
      commandVersion: 1,
      demandId: DEMAND_ID,
      eventId: FIRST_EVENT_ID,
      recordedAt: PUBLISHED_AT,
      identityDigest: IDENTITY_DIGEST,
      authorityDigest: AUTHORITY_DIGEST,
    });
    const first = prepareDemandEventStreamCommit(null, {
      commitId: FIRST_COMMIT_ID,
      commandDigest: FIRST_COMMAND_DIGEST,
      events: firstEvents,
    });
    await eventStore.append(first);

    const snapshotRef = demandEventSourcingSnapshotRef(
      first.commit.commitSequence,
    );
    const intendedSnapshotBytes = encodeUtf8("intended-snapshot");
    const stageAddress = issueDurableAtomicFileStageAddress(
      "create",
      snapshotRef,
      computeSha256Digest(intendedSnapshotBytes),
      0o600,
    );
    const stageRef = durableAtomicFileStageRef(snapshotRef, stageAddress);
    try {
      await createFileCandidateDurably(
        root,
        stageRef,
        encodeUtf8("partial"),
        { mode: 0o600 },
      );
    } finally {
      releaseDurableAtomicFileStageAddress(stageAddress);
    }
    await rejects(repository.load(), (error: unknown) => error instanceof Error);
    const stageRecovery = await snapshotStore.recoverPublicationStages();
    equal(stageRecovery.retiredStageCount, 1);

    const beforeSnapshot = await repository.load();
    equal(beforeSnapshot?.snapshotStatus, "missing");
    equal(beforeSnapshot?.replayedCommitCount, 1);
    await repository.publishSnapshot(first.aggregate);
    const snapshotCurrent = await repository.load();
    equal(snapshotCurrent?.snapshotStatus, "used");
    ok(snapshotCurrent);

    const secondEvents = decideDemandEventSourcingCommand(snapshotCurrent.aggregate.state, {
      commandType: "lifecycle.cancel-demand",
      commandVersion: 1,
      demandId: DEMAND_ID,
      eventId: SECOND_EVENT_ID,
      recordedAt: CANCELLED_AT,
      reason: "用户终止该 Demand",
    });
    const second = prepareDemandEventStreamCommit(snapshotCurrent.aggregate, {
      commitId: SECOND_COMMIT_ID,
      commandDigest: SECOND_COMMAND_DIGEST,
      events: secondEvents,
    });
    await eventStore.append(second);

    const loaded = await repository.load();
    equal(loaded?.snapshotStatus, "used");
    equal(loaded?.snapshotCommitSequence, 1);
    equal(loaded?.replayedCommitCount, 1);
    equal(loaded?.aggregate.state.lifecycle, "cancelled");

    const audited = await repository.audit();
    equal(audited.replayedCommitCount, 2);
    equal(audited.aggregate.lastCommitDigest, loaded?.aggregate.lastCommitDigest);
    equal(
      readdirSync(path.join(fixtureRoot, "event-sourcing", "snapshots")).join(","),
      "0000000000000001.json",
    );

    const snapshotPath = path.join(
      fixtureRoot,
      "event-sourcing",
      "snapshots",
      "0000000000000001.json",
    );
    const persistedSnapshot = JSON.parse(
      readFileSync(snapshotPath, "utf8"),
    ) as Record<string, unknown>;
    const incompatibleSnapshot = {
      ...persistedSnapshot,
      versionCompatibilityDigest: IDENTITY_DIGEST,
    };
    const incompatibleSnapshotText = `${JSON.stringify(
      incompatibleSnapshot,
      null,
      2,
    )}\n`;
    writeFileSync(snapshotPath, incompatibleSnapshotText, { mode: 0o600 });
    const fallback = await repository.load();
    equal(fallback?.snapshotStatus, "invalid");
    equal(fallback?.replayedCommitCount, 2);
    equal(fallback?.aggregate.state.lifecycle, "cancelled");
    equal(readFileSync(snapshotPath, "utf8"), incompatibleSnapshotText);

    await repository.publishSnapshot(second.aggregate);
    writeFileSync(path.join(
      fixtureRoot,
      "event-sourcing",
      "commits",
      "0000000000000001.json",
    ), "{}\n", { mode: 0o600 });
    const prefixOptimized = await repository.load();
    equal(prefixOptimized?.snapshotStatus, "used");
    equal(prefixOptimized?.snapshotCommitSequence, 2);
    equal(prefixOptimized?.replayedCommitCount, 0);
    await rejects(
      repository.audit(),
      (error: unknown) => error instanceof Error,
    );
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
