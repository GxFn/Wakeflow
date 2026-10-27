import { equal, ok, rejects, throws } from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { computeSha256Digest, parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import { createFileCandidateDurably } from "../../../src/foundation/filesystem/durable-file-candidate.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { decideDemandEventSourcingCommand } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import { demandEventSourcingSnapshotRef } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-paths.js";
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { prepareDemandEventStreamCommit } from "../../../src/governance/demand/event-sourcing/demand-event-stream-commit.js";
import { DemandFileEventSnapshotStore } from "../../../src/governance/demand/event-sourcing/demand-file-event-snapshot-store.js";
import { DemandFileEventStore } from "../../../src/governance/demand/event-sourcing/demand-file-event-store.js";
import { durableAtomicFileStageRefForTest } from "../../foundation/filesystem/durable-atomic-file-test-support.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { disposableRoot } from "../../support/temp-root.js";

useDisposableDurability();

/**
 * Governance / Demand Event Sourcing 仓储（ADR-0005），1 级（组件）测试：正常 load 走快照加尾部、audit
 * 完整重放、崩溃残留的暂存与不兼容快照只让快照不可用而不拒绝加载，以及把 `constructor`、`toString`、
 * `__proto__` 当客户端幂等键时经索引重放命中、未命中返回 null（R-ROOT-01）。
 */

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
    const repository = new DemandEventSourcingRepository(root);
    throws(
      () => new DemandEventSourcingRepository(eventStore as never),
      (error: unknown) =>
        error instanceof DemandEventSourcingRepositoryError && error.reason === "input",
    );
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

    const snapshotRef = demandEventSourcingSnapshotRef(first.commit.commitSequence);
    const intendedSnapshotBytes = encodeUtf8("intended-snapshot");
    const stageAddress = issueDurableAtomicFileStageAddress(
      "create",
      snapshotRef,
      computeSha256Digest(intendedSnapshotBytes),
      0o600,
    );
    const stageRef = durableAtomicFileStageRefForTest(snapshotRef, stageAddress);
    try {
      await createFileCandidateDurably(root, stageRef, encodeUtf8("partial"), { mode: 0o600 });
    } finally {
      releaseDurableAtomicFileStageAddress(stageAddress);
    }
    // 残留暂存文件只让快照不可用：load 退回完整重放并报告 invalid，不再拒绝。
    const staged = await repository.load();
    equal(staged?.snapshotStatus, "invalid");
    equal(staged?.replayedCommitCount, 1);
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
    const persistedSnapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Record<
      string,
      unknown
    >;
    const incompatibleSnapshot = {
      ...persistedSnapshot,
      versionCompatibilityDigest: IDENTITY_DIGEST,
    };
    const incompatibleSnapshotText = `${JSON.stringify(incompatibleSnapshot, null, 2)}\n`;
    writeFileSync(snapshotPath, incompatibleSnapshotText, { mode: 0o600 });
    const fallback = await repository.load();
    equal(fallback?.snapshotStatus, "invalid");
    equal(fallback?.replayedCommitCount, 2);
    equal(fallback?.aggregate.state.lifecycle, "cancelled");
    equal(readFileSync(snapshotPath, "utf8"), incompatibleSnapshotText);

    await repository.publishSnapshot(second.aggregate);
    writeFileSync(
      path.join(fixtureRoot, "event-sourcing", "commits", "0000000000000001.json"),
      "{}\n",
      { mode: 0o600 },
    );
    const prefixOptimized = await repository.load();
    equal(prefixOptimized?.snapshotStatus, "used");
    equal(prefixOptimized?.snapshotCommitSequence, 2);
    equal(prefixOptimized?.replayedCommitCount, 0);
    await rejects(
      repository.audit(),
      (error: unknown) =>
        error instanceof DemandEventSourcingRepositoryError && error.reason === "stream",
    );
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("constructor、toString、__proto__ 作客户端幂等键：已提交的键经索引重放命中，未提交的键返回 null 而不是把原型函数当序号（R-ROOT-01）", async (t) => {
  const fixtureRoot = disposableRoot(t, "wakeflow-demand-repository-keys-");
  const root = await RootedDirectory.open(fixtureRoot);
  try {
    const eventStore = new DemandFileEventStore(root);
    const repository = new DemandEventSourcingRepository(root);
    await eventStore.initialize();
    const first = prepareDemandEventStreamCommit(null, {
      commitId: FIRST_COMMIT_ID,
      commandDigest: FIRST_COMMAND_DIGEST,
      events: decideDemandEventSourcingCommand(null, {
        commandType: "publication.publish-demand",
        commandVersion: 1,
        demandId: DEMAND_ID,
        eventId: FIRST_EVENT_ID,
        recordedAt: PUBLISHED_AT,
        identityDigest: IDENTITY_DIGEST,
        authorityDigest: AUTHORITY_DIGEST,
      }),
      idempotency: { key: "__proto__", requestDigest: FIRST_COMMAND_DIGEST },
    });
    await eventStore.append(first);
    const second = prepareDemandEventStreamCommit(first.aggregate, {
      commitId: SECOND_COMMIT_ID,
      commandDigest: SECOND_COMMAND_DIGEST,
      events: decideDemandEventSourcingCommand(first.aggregate.state, {
        commandType: "lifecycle.cancel-demand",
        commandVersion: 1,
        demandId: DEMAND_ID,
        eventId: SECOND_EVENT_ID,
        recordedAt: CANCELLED_AT,
        reason: "用户终止该 Demand",
      }),
      idempotency: { key: "constructor", requestDigest: SECOND_COMMAND_DIGEST },
    });
    await eventStore.append(second);

    // 索引随追加发布；它的键字典只认自有键，`__proto__` 不会被原型 setter 吞掉。
    const located = await eventStore.readIndex(DEMAND_ID);
    ok(located);
    equal(located.index.commitSequence, 2);
    equal(Object.getPrototypeOf(located.index.keys), null);
    const committed: readonly (readonly [string, number])[] = [
      ["__proto__", 1],
      ["constructor", 2],
    ];
    for (const [key, sequence] of committed) {
      equal(Object.hasOwn(located.index.keys, key), true);
      equal(located.index.keys[key], sequence);
      const found = await repository.findCommitByIdempotencyKey(key);
      equal(found?.commitSequence, sequence);
      equal(found?.idempotency?.key, key);
    }
    // 没提交过的键：Object.prototype.toString 不是提交序号，查找是未命中而不是 io 失败。
    equal(await repository.findCommitByIdempotencyKey("toString"), null);
  } finally {
    await root.close();
  }
});
