import {
  equal,
} from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  executeDemandEventSourcingCommand,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import {
  DemandEventSourcingRepository,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import {
  DemandFileEventStore,
} from "../../../src/governance/demand/event-sourcing/demand-file-event-store.js";

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

test("真实本地 v1 stream 在重新打开后经 Registry load 与 full audit", async () => {
  const fixtureRoot = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-demand-version-evolution-",
  ));
  const commitPath = path.join(
    fixtureRoot,
    "event-sourcing",
    "commits",
    "0000000000000001.json",
  );
  let root = await RootedDirectory.open(fixtureRoot);
  try {
    const eventStore = new DemandFileEventStore(root);
    const repository = new DemandEventSourcingRepository(root);
    await eventStore.initialize();
    await executeDemandEventSourcingCommand(repository, {
      commandType: "publication.publish-demand",
      commandVersion: 1,
      demandId: DEMAND_ID,
      eventId: EVENT_ID,
      recordedAt: parseUtcInstant("2026-08-26T10:00:00.000Z"),
      identityDigest: parseSha256Digest(`sha256:${"a".repeat(64)}`),
      authorityDigest: parseSha256Digest(`sha256:${"b".repeat(64)}`),
    }, {
      commitId: COMMIT_ID,
      expectedStreamRevision: 0,
    });
    const persistedBeforeRestart = readFileSync(commitPath, "utf8");
    const persistedJson = JSON.parse(persistedBeforeRestart) as {
      readonly events: readonly [{
        readonly eventVersion: number;
        readonly resultingStateModelVersion: number;
      }];
    };
    equal(persistedJson.events[0].eventVersion, 1);
    equal(persistedJson.events[0].resultingStateModelVersion, 1);

    await root.close();
    root = await RootedDirectory.open(fixtureRoot);
    const reopenedRepository = new DemandEventSourcingRepository(root);
    const loaded = await reopenedRepository.load();
    equal(loaded?.aggregate.state.lifecycle, "active");
    equal(loaded?.aggregate.streamRevision, 1);
    const audited = await reopenedRepository.audit();
    equal(audited.aggregate.state.lifecycle, "active");
    equal(audited.replayedCommitCount, 1);
    equal(readFileSync(commitPath, "utf8"), persistedBeforeRestart);
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
