import {
  deepEqual,
  equal,
  rejects,
} from "node:assert/strict";
import {
  existsSync,
  linkSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { threadId } from "node:worker_threads";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  RootedResourceParentHandle,
  RootedResourceParentHandleError,
} from "../../../src/foundation/filesystem/rooted-resource-parent-handle.js";
import { createFileCandidateDurably } from "../../../src/foundation/filesystem/durable-file-candidate.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/foundation/identity/wakeflow-durable-id.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  decideDemandEventSourcingCommand,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import {
  prepareDemandEventStreamCommit,
  renderDemandEventStreamCommit,
} from "../../../src/governance/demand/event-sourcing/demand-event-stream-commit.js";
import {
  computeDemandEventSourcingStoredEventDigest,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-stored-event.js";
import {
  demandEventAppendCandidateRef,
  demandEventStreamCommitRef,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-paths.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import {
  DemandFileEventStore,
  DemandFileEventStoreError,
} from "../../../src/governance/demand/event-sourcing/demand-file-event-store.js";

const DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_11111111-1111-4111-8111-111111111111",
  "demand",
);
const EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_22222222-2222-4222-8222-222222222222",
  "demand-event",
);
const OTHER_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_33333333-3333-4333-8333-333333333333",
  "demand-event",
);
const THIRD_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_66666666-6666-4666-8666-666666666666",
  "demand-event",
);
const COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_44444444-4444-4444-8444-444444444444",
  "demand-event-commit",
);
const OTHER_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_55555555-5555-4555-8555-555555555555",
  "demand-event-commit",
);
const THIRD_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_77777777-7777-4777-8777-777777777777",
  "demand-event-commit",
);
const RECORDED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");
const CANCELLED_AT = parseUtcInstant("2026-08-26T11:00:00.000Z");
const IDENTITY_DIGEST = parseSha256Digest(`sha256:${"a".repeat(64)}`);
const AUTHORITY_DIGEST = parseSha256Digest(`sha256:${"b".repeat(64)}`);
const COMMAND_DIGEST = parseSha256Digest(`sha256:${"c".repeat(64)}`);
const OTHER_COMMAND_DIGEST = parseSha256Digest(`sha256:${"d".repeat(64)}`);
const THIRD_COMMAND_DIGEST = parseSha256Digest(`sha256:${"e".repeat(64)}`);

function prepared(commitId = COMMIT_ID, eventId = EVENT_ID, commandDigest = COMMAND_DIGEST) {
  const events = decideDemandEventSourcingCommand(null, {
    commandType: "publication.publish-demand",
    commandVersion: 1,
    demandId: DEMAND_ID,
    eventId,
    recordedAt: RECORDED_AT,
    identityDigest: IDENTITY_DIGEST,
    authorityDigest: AUTHORITY_DIGEST,
  });
  return prepareDemandEventStreamCommit(null, {
    commitId,
    commandDigest,
    events,
  });
}

function preparedCancellation(
  current: ReturnType<typeof prepared>["aggregate"],
  commitId = OTHER_COMMIT_ID,
  eventId = OTHER_EVENT_ID,
  commandDigest = OTHER_COMMAND_DIGEST,
) {
  const events = decideDemandEventSourcingCommand(current.state, {
    commandType: "lifecycle.cancel-demand",
    commandVersion: 1,
    demandId: DEMAND_ID,
    eventId,
    recordedAt: CANCELLED_AT,
    reason: "用户终止该 Demand",
  });
  return prepareDemandEventStreamCommit(current, {
    commitId,
    commandDigest,
    events,
  });
}

test("Demand File Event Store 以固定 commitSequence 槽位执行 no-replace append", async () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-demand-file-event-store-"));
  const root = await RootedDirectory.open(fixtureRoot);
  try {
    const store = new DemandFileEventStore(root);
    await store.initialize();
    const first = prepared();

    const committed = await store.append(first);
    equal(committed.disposition, "committed");
    equal(committed.commitSequence, 1);

    const idempotent = await store.append(first);
    equal(idempotent.disposition, "idempotent");
    equal(idempotent.commitDigest, committed.commitDigest);

    const loaded = await store.readCommits();
    deepEqual(loaded.commits, [first.commit]);
    equal(loaded.cursor?.commitSequence, 1);
    equal(loaded.cursor?.streamRevision, 1);

    await rejects(
      store.append({ ...first } as typeof first),
      (error: unknown) => (
        error instanceof DemandFileEventStoreError
        && error.reason === "input"
      ),
    );

    await rejects(
      store.append(prepared(
        OTHER_COMMIT_ID,
        OTHER_EVENT_ID,
        OTHER_COMMAND_DIGEST,
      )),
      (error: unknown) => (
        error instanceof DemandFileEventStoreError
        && error.reason === "concurrency-conflict"
      ),
    );

    equal(
      readdirSync(path.join(fixtureRoot, "event-sourcing", "commits")).join(","),
      "0000000000000001.json",
    );
    deepEqual(
      readdirSync(path.join(fixtureRoot, "event-sourcing", "append-candidates")),
      [],
    );
    equal(readdirSync(fixtureRoot).includes("event-stream.lock"), false);
    equal(
      readdirSync(fixtureRoot).includes("transactions"),
      false,
    );
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("Demand File Event Store 在 append 前拒绝历史 commitId 与 eventId 重用", async () => {
  const fixtureRoot = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-demand-append-identity-",
  ));
  const root = await RootedDirectory.open(fixtureRoot);
  try {
    const store = new DemandFileEventStore(root);
    await store.initialize();
    const first = prepared();
    await store.append(first);

    await rejects(
      store.append(preparedCancellation(
        first.aggregate,
        COMMIT_ID,
        OTHER_EVENT_ID,
      )),
      (error: unknown) => (
        error instanceof DemandFileEventStoreError
        && error.reason === "append-identity-conflict"
        && error.path === "$commit/commitId"
      ),
    );
    await rejects(
      store.append(preparedCancellation(
        first.aggregate,
        OTHER_COMMIT_ID,
        EVENT_ID,
      )),
      (error: unknown) => (
        error instanceof DemandFileEventStoreError
        && error.reason === "append-identity-conflict"
        && error.path === "$commit/events/0/eventId"
      ),
    );
    equal((await store.readCommits()).commits.length, 1);
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("Demand File Event Store 拒绝未绑定 physical tail state 的 prepared commit", async () => {
  const fixtureRoot = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-demand-append-provenance-",
  ));
  const root = await RootedDirectory.open(fixtureRoot);
  try {
    const store = new DemandFileEventStore(root);
    await store.initialize();
    const first = prepared();
    const second = preparedCancellation(first.aggregate);
    await store.append(first);
    await store.append(second);

    const forgedLastEvent = Object.freeze({
      ...second.aggregate.lastEvent,
      resultingStateDigest: first.aggregate.stateDigest,
    });
    const forgedAggregate: ReturnType<typeof prepared>["aggregate"] =
      Object.freeze({
        ...second.aggregate,
        lastEvent: forgedLastEvent,
        lastEventDigest: computeDemandEventSourcingStoredEventDigest(
          forgedLastEvent,
        ),
        state: first.aggregate.state,
        stateDigest: first.aggregate.stateDigest,
      });
    const forged = preparedCancellation(
      forgedAggregate,
      THIRD_COMMIT_ID,
      THIRD_EVENT_ID,
      THIRD_COMMAND_DIGEST,
    );

    await rejects(
      store.append(forged),
      (error: unknown) => (
        error instanceof DemandFileEventStoreError
        && error.reason === "append-provenance-conflict"
        && error.path === "$preparedCommit/sourceExpectation"
      ),
    );
    equal((await store.readCommits()).commits.length, 2);
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("Demand File Event Store 在 commit parent 首次 sync 失败后重新结算", {
  concurrency: false,
}, async () => {
  const fixtureRoot = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-demand-append-settlement-",
  ));
  const root = await RootedDirectory.open(fixtureRoot);
  const originalSync = RootedResourceParentHandle.prototype.sync;
  const first = prepared();
  const commitRef = demandEventStreamCommitRef(first.commit.commitSequence);
  let commitParentSyncAttempts = 0;
  RootedResourceParentHandle.prototype.sync = async function patchedSync() {
    if (this.resourcePath === commitRef) {
      commitParentSyncAttempts += 1;
      if (commitParentSyncAttempts === 1) {
        throw new RootedResourceParentHandleError(
          "sync-failure",
          "$resourcePath",
        );
      }
    }
    return originalSync.call(this);
  };
  try {
    const store = new DemandFileEventStore(root);
    await store.initialize();
    const receipt = await store.append(first);

    equal(receipt.disposition, "committed");
    equal(commitParentSyncAttempts, 2);
    equal((await store.readCommits()).commits.length, 1);
    deepEqual(
      readdirSync(path.join(fixtureRoot, "event-sourcing", "append-candidates")),
      [],
    );
  } finally {
    RootedResourceParentHandle.prototype.sync = originalSync;
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("Demand File Event Store 只回滚 candidate-only，并结算已经 link 的 commit residue", async () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-demand-candidate-recovery-"));
  const root = await RootedDirectory.open(fixtureRoot);
  try {
    const store = new DemandFileEventStore(root);
    await store.initialize();
    const first = prepared();
    const bytes = encodeUtf8(renderDemandEventStreamCommit(first.commit));
    const rolledBackRef = demandEventAppendCandidateRef(
      first.commit.commitSequence,
      first.commit.commitId,
      `${process.pid}-${threadId}-66666666-6666-4666-8666-666666666666`,
    );
    await createFileCandidateDurably(root, rolledBackRef, bytes, { mode: 0o600 });

    const rolledBack = await store.recoverAppendCandidates();
    equal(rolledBack.rolledBackCount, 1);
    equal(rolledBack.committedResidueCount, 0);
    equal(rolledBack.durabilitySettledCommitCount, 0);
    equal(existsSync(path.join(fixtureRoot, ...rolledBackRef.split("/"))), false);

    const committedCandidateRef = demandEventAppendCandidateRef(
      first.commit.commitSequence,
      first.commit.commitId,
      `${process.pid}-${threadId}-77777777-7777-4777-8777-777777777777`,
    );
    await createFileCandidateDurably(root, committedCandidateRef, bytes, {
      mode: 0o600,
    });
    const targetRef = demandEventStreamCommitRef(first.commit.commitSequence);
    linkSync(
      path.join(fixtureRoot, ...committedCandidateRef.split("/")),
      path.join(fixtureRoot, ...targetRef.split("/")),
    );

    const settled = await store.recoverAppendCandidates();
    equal(settled.committedResidueCount, 1);
    equal(settled.durabilitySettledCommitCount, 1);
    equal(settled.retiredCount, 1);
    equal((await store.readCommits()).commits.length, 1);
    equal(existsSync(path.join(fixtureRoot, ...committedCandidateRef.split("/"))), false);
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("Demand File Event Store recovery 不删除 active 或不可确认 owner 的 candidate", async () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-demand-candidate-owner-"));
  const root = await RootedDirectory.open(fixtureRoot);
  try {
    const store = new DemandFileEventStore(root);
    await store.initialize();
    const first = prepared();
    const candidateRef = demandEventAppendCandidateRef(
      first.commit.commitSequence,
      first.commit.commitId,
      `${process.pid}-${threadId + 1}-99999999-9999-4999-8999-999999999999`,
    );
    await createFileCandidateDurably(
      root,
      candidateRef,
      encodeUtf8(renderDemandEventStreamCommit(first.commit)),
      { mode: 0o600 },
    );

    await rejects(
      store.recoverAppendCandidates(),
      (error: unknown) => (
        error instanceof DemandFileEventStoreError
        && error.reason === "candidate-busy"
      ),
    );
    equal(existsSync(path.join(fixtureRoot, ...candidateRef.split("/"))), true);
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("Demand File Event Store 在读取 payload 前执行 stream 总字节预算", async () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-demand-stream-capacity-"));
  const root = await RootedDirectory.open(fixtureRoot);
  try {
    const store = new DemandFileEventStore(root);
    await store.initialize();
    const oversized = path.join(
      fixtureRoot,
      "event-sourcing",
      "commits",
      "0000000000000001.json",
    );
    writeFileSync(oversized, "", { mode: 0o600 });
    truncateSync(oversized, 65 * 1024 * 1024);
    await rejects(
      store.readCommits(),
      (error: unknown) => (
        error instanceof DemandFileEventStoreError
        && error.reason === "capacity"
      ),
    );
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
