import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import { chmodSync, linkSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest } from "../../../../src/foundation/crypto/sha256.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../../src/foundation/time/utc-instant.js";
import { decideDemandEventSourcingCommand } from "../../../../src/governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import {
  DEMAND_EVENT_STREAM_COMMITS_ROOT_REF,
  demandEventStreamCommitRef,
} from "../../../../src/governance/demand/event-sourcing/demand-event-sourcing-paths.js";
import { computeDemandEventSourcingStoredEventDigest } from "../../../../src/governance/demand/event-sourcing/demand-event-sourcing-stored-event.js";
import {
  computeDemandEventStreamCommitDigest,
  type DemandEventStreamCommitIdempotency,
  prepareDemandEventStreamCommit,
  renderDemandEventStreamCommit,
} from "../../../../src/governance/demand/event-sourcing/demand-event-stream-commit.js";
import { parseDemandEventCommitSequence } from "../../../../src/governance/demand/event-sourcing/demand-event-stream-position.js";
import {
  DemandFileEventStore,
  DemandFileEventStoreError,
} from "../../../../src/governance/demand/event-sourcing/demand-file-event-store.js";
import {
  assertDemandFileEventAppendAdmissionAgainstPrefix,
  readAllDemandFileEventCommits,
  readDemandFileEventCommit,
  readDemandFileEventCommitAt,
  readDemandFileEventCommitOrNull,
  readDemandFileEventCommitsAfter,
  readDemandFileEventDirectory,
} from "../../../../src/governance/demand/event-sourcing/demand-file-event-store-reader.js";
import { DISPOSABLE_ROOT_OPTIONS } from "../../../support/prepared-workspace.js";
import { disposableRoot } from "../../../support/temp-root.js";

/** 直接覆盖读取边界：与 demand-file-event-store.test.ts 同一套 prepared commit 夹具。 */

const DEMAND_ID = parseWakeflowDurableIdOfKind("demand_11111111-1111-4111-8111-111111111111", "demand");
const EVENT_ID = parseWakeflowDurableIdOfKind("demand-event_22222222-2222-4222-8222-222222222222", "demand-event");
const OTHER_EVENT_ID = parseWakeflowDurableIdOfKind("demand-event_33333333-3333-4333-8333-333333333333", "demand-event");
const THIRD_EVENT_ID = parseWakeflowDurableIdOfKind("demand-event_66666666-6666-4666-8666-666666666666", "demand-event");
const COMMIT_ID = parseWakeflowDurableIdOfKind("demand-event-commit_44444444-4444-4444-8444-444444444444", "demand-event-commit");
const OTHER_COMMIT_ID = parseWakeflowDurableIdOfKind("demand-event-commit_55555555-5555-4555-8555-555555555555", "demand-event-commit");
const THIRD_COMMIT_ID = parseWakeflowDurableIdOfKind("demand-event-commit_77777777-7777-4777-8777-777777777777", "demand-event-commit");
const RECORDED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");
const CANCELLED_AT = parseUtcInstant("2026-08-26T11:00:00.000Z");
const IDENTITY_DIGEST = parseSha256Digest(`sha256:${"a".repeat(64)}`);
const AUTHORITY_DIGEST = parseSha256Digest(`sha256:${"b".repeat(64)}`);
const COMMAND_DIGEST = parseSha256Digest(`sha256:${"c".repeat(64)}`);
const OTHER_COMMAND_DIGEST = parseSha256Digest(`sha256:${"d".repeat(64)}`);
const THIRD_COMMAND_DIGEST = parseSha256Digest(`sha256:${"e".repeat(64)}`);
const COMMITS_REF = DEMAND_EVENT_STREAM_COMMITS_ROOT_REF;
const FIRST_REF = demandEventStreamCommitRef(parseDemandEventCommitSequence(1));
const SECOND_REF = demandEventStreamCommitRef(parseDemandEventCommitSequence(2));

// 被测导出的短别名；导入语句保留完整名称。
const readDirectory = readDemandFileEventDirectory;
const readCommit = readDemandFileEventCommit;
const readAll = readAllDemandFileEventCommits;
const readAfter = readDemandFileEventCommitsAfter;
const readOrNull = readDemandFileEventCommitOrNull;
const readAt = readDemandFileEventCommitAt;
const admit = assertDemandFileEventAppendAdmissionAgainstPrefix;
const digestOf = computeDemandEventStreamCommitDigest;
const render = renderDemandEventStreamCommit;

function prepared(
  commitId = COMMIT_ID,
  eventId = EVENT_ID,
  commandDigest = COMMAND_DIGEST,
  idempotency?: Readonly<DemandEventStreamCommitIdempotency>,
) {
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
    ...(idempotency === undefined ? {} : { idempotency }),
  });
}

function preparedCancellation(
  current: ReturnType<typeof prepared>["aggregate"],
  commitId = OTHER_COMMIT_ID,
  eventId = OTHER_EVENT_ID,
  commandDigest = OTHER_COMMAND_DIGEST,
  idempotency?: Readonly<DemandEventStreamCommitIdempotency>,
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
    ...(idempotency === undefined ? {} : { idempotency }),
  });
}

async function openStore(t: TestContext, prefix: string) {
  const fixtureRoot = disposableRoot(t, prefix);
  const root = await RootedDirectory.open(fixtureRoot, "$root", DISPOSABLE_ROOT_OPTIONS);
  t.after(() => root.close());
  const store = new DemandFileEventStore(root);
  await store.initialize();
  const nodeAt = async (ref: PortableResourcePath) => (await root.inspectExistingResource(ref)).node;
  return { fixtureRoot, root, store, nodeAt, commitsPath: path.join(fixtureRoot, "event-sourcing", "commits") };
}

function commitFile(commitsPath: string, sequence: number): string {
  return path.join(commitsPath, `${String(sequence).padStart(16, "0")}.json`);
}

function abortedSignal(): AbortSignal {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}

function isStoreError(reason: DemandFileEventStoreError["reason"], errorPath?: string) {
  return (error: unknown): boolean =>
    error instanceof DemandFileEventStoreError
    && error.reason === reason
    && (errorPath === undefined || error.path === errorPath);
}

const aborted = isStoreError("aborted", "$signal");

test("readDemandFileEventDirectory 读取稳定清单并按政策判定目录节点", async (t) => {
  const { root, store, commitsPath } = await openStore(t, "wakeflow-reader-directory-");
  const first = prepared();
  await store.append(first);
  await store.append(preparedCancellation(first.aggregate));

  const read = await readDirectory(root, COMMITS_REF, 16, undefined);
  equal(read.directoryNode.kind, "directory");
  equal(read.directoryNode.permissionBits, 0o700);
  deepEqual(read.entries.map((entry) => entry.name), ["0000000000000001.json", "0000000000000002.json"]);
  equal(read.entries[0]?.resourcePath, FIRST_REF);
  equal((await readDirectory(root, COMMITS_REF, 16, undefined, read.directoryNode)).entries.length, 2);

  await rejects(readDirectory(root, COMMITS_REF, 1, undefined), isStoreError("capacity", `$${COMMITS_REF}`));
  const missing = parsePortableResourcePath("event-sourcing/missing");
  await rejects(readDirectory(root, missing, 16, undefined), isStoreError("not-initialized", `$${missing}`));
  await rejects(readDirectory(root, COMMITS_REF, 16, abortedSignal()), aborted);
  // 预期节点是另一个目录：清单读取报告预期变化，读取方归为 stream-changed。
  const snapshots = await readDirectory(root, parsePortableResourcePath("event-sourcing/snapshots"), 16, undefined);
  const changed = isStoreError("stream-changed", `$${COMMITS_REF}`);
  await rejects(readDirectory(root, COMMITS_REF, 16, undefined, snapshots.directoryNode), changed);
  await rejects(readDirectory(root, FIRST_REF, 16, undefined), isStoreError("stream-changed", `$${FIRST_REF}`));

  chmodSync(commitsPath, 0o755);
  await rejects(readDirectory(root, COMMITS_REF, 16, undefined), isStoreError("node-policy", `$${COMMITS_REF}`));
  equal((await readDirectory(root, COMMITS_REF, 16, undefined, undefined, "archived")).entries.length, 2);
  rmSync(commitsPath, { recursive: true });
  writeFileSync(commitsPath, "", { mode: 0o600 });
  await rejects(readDirectory(root, COMMITS_REF, 16, undefined, undefined, "archived"), changed);
});

test("readDemandFileEventCommit 区分私有与归档节点政策并分类内容失败", async (t) => {
  const { fixtureRoot, root, store, nodeAt, commitsPath } = await openStore(t, "wakeflow-reader-commit-");
  const first = prepared();
  await store.append(first);
  await store.append(preparedCancellation(first.aggregate));
  const node = await nodeAt(FIRST_REF);
  const loaded = await readCommit(root, FIRST_REF, node, undefined, "$commit");
  deepEqual(loaded.commit, first.commit);
  equal(loaded.text, render(first.commit));
  equal(loaded.node.inodeId, node.inodeId);
  const policy = isStoreError("node-policy", "$commit");

  const file = commitFile(commitsPath, 1);
  const linkPath = path.join(fixtureRoot, "event-sourcing", "linked.json");
  linkSync(file, linkPath);
  const linked = await nodeAt(FIRST_REF);
  equal(linked.linkCount, 2n);
  await rejects(readCommit(root, FIRST_REF, linked, undefined, "$commit"), policy);
  // 归档政策放宽模式与属主，但提交文件仍必须是单链接普通文件。
  await rejects(readCommit(root, FIRST_REF, linked, undefined, "$commit", [1n], "archived"), policy);
  deepEqual((await readCommit(root, FIRST_REF, linked, undefined, "$commit", [1n, 2n])).commit, first.commit);
  rmSync(linkPath);

  chmodSync(file, 0o644);
  const relaxed = await nodeAt(FIRST_REF);
  await rejects(readCommit(root, FIRST_REF, relaxed, undefined, "$commit"), policy);
  deepEqual((await readCommit(root, FIRST_REF, relaxed, undefined, "$commit", [1n], "archived")).commit, first.commit);
  chmodSync(file, 0o600);

  const secondNode = await nodeAt(SECOND_REF);
  const changed = isStoreError("stream-changed", "$commit");
  await rejects(readCommit(root, FIRST_REF, secondNode, undefined, "$commit"), changed);
  await rejects(readCommit(root, FIRST_REF, secondNode, undefined, "$commit", [1n], "archived"), changed);

  for (const text of ["{not json\n", '{\n  "artifactKind": "other"\n}\n']) {
    writeFileSync(file, text);
    const broken = await nodeAt(FIRST_REF);
    await rejects(readCommit(root, FIRST_REF, broken, undefined, "$commit"), isStoreError("stream-invalid", "$commit"));
  }
  truncateSync(file, 17 * 1024 * 1024);
  const oversized = await nodeAt(FIRST_REF);
  await rejects(readCommit(root, FIRST_REF, oversized, undefined, "$commit"), isStoreError("capacity", "$commit"));
  await rejects(readCommit(root, FIRST_REF, oversized, abortedSignal(), "$commit"), aborted);
});

test("readAllDemandFileEventCommits 校验清单名称、摘要链与两种节点政策", async (t) => {
  const { fixtureRoot, root, store, commitsPath } = await openStore(t, "wakeflow-reader-all-");
  const empty = await readAll(root, undefined);
  deepEqual(empty.commits, []);
  equal(empty.cursor, null);

  const first = prepared();
  const second = preparedCancellation(first.aggregate);
  await store.append(first);
  await store.append(second);
  const all = await readAll(root, undefined);
  deepEqual(all.commits, [first.commit, second.commit]);
  deepEqual(all.cursor, { commitSequence: 2, streamRevision: 2, lastCommitDigest: digestOf(second.commit) });
  await rejects(readAll(root, abortedSignal()), aborted);

  const stray = path.join(commitsPath, "0000000000000002.json.bak");
  writeFileSync(stray, "{}\n", { mode: 0o600 });
  await rejects(readAll(root, undefined), isStoreError("stream-invalid", "$commits/2"));
  rmSync(stray);

  const firstFile = commitFile(commitsPath, 1);
  const secondFile = commitFile(commitsPath, 2);
  const secondText = readFileSync(secondFile, "utf8");
  writeFileSync(secondFile, render({ ...second.commit, previousCommitDigest: IDENTITY_DIGEST }));
  await rejects(readAll(root, undefined), isStoreError("stream-invalid", "$commits/1"));
  writeFileSync(secondFile, secondText);
  const firstText = readFileSync(firstFile, "utf8");
  rmSync(firstFile);
  await rejects(readAll(root, undefined), isStoreError("stream-invalid", "$commits/0"));
  writeFileSync(firstFile, firstText, { mode: 0o600 });
  deepEqual((await readAll(root, undefined)).commits, [first.commit, second.commit]);

  chmodSync(commitsPath, 0o755);
  chmodSync(firstFile, 0o644);
  chmodSync(secondFile, 0o644);
  await rejects(readAll(root, undefined), isStoreError("node-policy", `$${COMMITS_REF}`));
  const archived = await readAll(root, undefined, "archived");
  deepEqual(archived.commits, [first.commit, second.commit]);
  deepEqual(archived.cursor, all.cursor);
  linkSync(firstFile, path.join(fixtureRoot, "event-sourcing", "copy.json"));
  await rejects(readAll(root, undefined, "archived"), isStoreError("node-policy", "$commits/0"));
});

test("readDemandFileEventCommitsAfter 从精确锚点逐槽位读取尾部", async (t) => {
  const { root, store, commitsPath } = await openStore(t, "wakeflow-reader-tail-");
  const first = prepared();
  const second = preparedCancellation(first.aggregate);
  await store.append(first);
  await store.append(second);
  const anchor = { commitSequence: 1, streamRevision: 1, lastCommitDigest: digestOf(first.commit) };
  const tail = await readAfter(root, anchor, undefined);
  deepEqual(tail.anchorCommit, first.commit);
  deepEqual(tail.commits, [second.commit]);
  deepEqual(tail.cursor, { commitSequence: 2, streamRevision: 2, lastCommitDigest: digestOf(second.commit) });
  const atTail = await readAfter(root, tail.cursor, undefined);
  deepEqual(atTail.anchorCommit, second.commit);
  deepEqual(atTail.commits, []);
  deepEqual(atTail.cursor, tail.cursor);

  const input = (errorPath: string) => isStoreError("input", errorPath);
  await rejects(readAfter(root, null, undefined), input("$cursor"));
  await rejects(readAfter(root, { ...anchor, extra: 1 }, undefined), input("$cursor"));
  await rejects(readAfter(root, { ...anchor, lastCommitDigest: "sha256:zz" }, undefined), input("$/lastCommitDigest"));
  await rejects(readAfter(root, { ...anchor, commitSequence: 0 }, undefined), input("$/commitSequence"));
  await rejects(readAfter(root, { ...anchor, streamRevision: 0 }, undefined), input("$/streamRevision"));
  const stale = isStoreError("stream-invalid", "$cursor");
  await rejects(readAfter(root, { ...anchor, streamRevision: 2 }, undefined), stale);
  await rejects(readAfter(root, { ...anchor, lastCommitDigest: AUTHORITY_DIGEST }, undefined), stale);
  await rejects(readAfter(root, { ...anchor, commitSequence: 3, streamRevision: 3 }, undefined), stale);
  await rejects(readAfter(root, anchor, abortedSignal()), aborted);

  writeFileSync(commitFile(commitsPath, 2), render({ ...second.commit, previousCommitDigest: IDENTITY_DIGEST }));
  await rejects(readAfter(root, anchor, undefined), isStoreError("stream-invalid", "$tail/0"));
});

test("readDemandFileEventCommitOrNull 与 readDemandFileEventCommitAt 定位单个提交槽位", async (t) => {
  const { fixtureRoot, root, store, commitsPath } = await openStore(t, "wakeflow-reader-slot-");
  const first = prepared();
  await store.append(first);

  equal(await readOrNull(root, SECOND_REF, undefined), null);
  const loaded = await readOrNull(root, FIRST_REF, undefined);
  deepEqual(loaded?.commit, first.commit);
  equal(loaded?.text, render(first.commit));
  const nested = parsePortableResourcePath(`${FIRST_REF}/child.json`);
  await rejects(readOrNull(root, nested, undefined), isStoreError("root-scope", "$root"));
  const linkPath = path.join(fixtureRoot, "event-sourcing", "linked.json");
  linkSync(commitFile(commitsPath, 1), linkPath);
  await rejects(readOrNull(root, FIRST_REF, undefined), isStoreError("node-policy", "$commit"));
  deepEqual((await readOrNull(root, FIRST_REF, undefined, [1n, 2n]))?.commit, first.commit);
  rmSync(linkPath);

  deepEqual(await readAt(root, 1, undefined), first.commit);
  equal(await readAt(root, 2, undefined), null);
  await rejects(readAt(root, 0, undefined), isStoreError("input", "$sequence"));
  await rejects(readAt(root, "1", undefined), isStoreError("input", "$sequence"));
  await rejects(readAt(root, 1, abortedSignal()), aborted);
  // 槽位 2 里放着提交 1 的内容：文件名与内容序号不一致。
  writeFileSync(commitFile(commitsPath, 2), render(first.commit), { mode: 0o600 });
  await rejects(readAt(root, 2, undefined), isStoreError("stream-invalid", "$commit/commitSequence"));
});

test("assertDemandFileEventAppendAdmissionAgainstPrefix 对已读前缀执行全部追加准入", () => {
  const first = prepared();
  const second = preparedCancellation(first.aggregate);
  admit([], first);
  admit([first.commit], second);
  const provenance = isStoreError("append-provenance-conflict", "$preparedCommit/sourceExpectation");
  throws(() => admit([first.commit], first), isStoreError("concurrency-conflict", "$commit/commitSequence"));
  throws(() => admit([], second), isStoreError("concurrency-conflict", "$commit/commitSequence"));
  // 提交 1 的 expectedStreamRevision/previousCommitDigest 由提交解析器与序号绑定，首提交的
  // concurrency-conflict 分支对可解析的提交不可达；这里只覆盖来源预期分支。
  const forgedSource = { lastEventDigest: IDENTITY_DIGEST, stateDigest: AUTHORITY_DIGEST };
  throws(() => admit([], { ...first, sourceExpectation: forgedSource }), provenance);
  const otherFirst = prepared(THIRD_COMMIT_ID, THIRD_EVENT_ID, THIRD_COMMAND_DIGEST);
  throws(() => admit([otherFirst.commit], second), isStoreError("concurrency-conflict", "$commit"));
  // 链接正确但聚合来源被伪造：与 store 测试同一构造。
  const forgedLastEvent = Object.freeze({
    ...second.aggregate.lastEvent,
    resultingStateDigest: first.aggregate.stateDigest,
  });
  const forgedAggregate: ReturnType<typeof prepared>["aggregate"] = Object.freeze({
    ...second.aggregate,
    lastEvent: forgedLastEvent,
    lastEventDigest: computeDemandEventSourcingStoredEventDigest(forgedLastEvent),
    state: first.aggregate.state,
    stateDigest: first.aggregate.stateDigest,
  });
  const forged = preparedCancellation(forgedAggregate, THIRD_COMMIT_ID, THIRD_EVENT_ID, THIRD_COMMAND_DIGEST);
  throws(() => admit([first.commit, second.commit], forged), provenance);

  const identity = (errorPath: string) => isStoreError("append-identity-conflict", errorPath);
  const reusedCommitId = preparedCancellation(first.aggregate, COMMIT_ID, OTHER_EVENT_ID);
  throws(() => admit([first.commit], reusedCommitId), identity("$commit/commitId"));
  const reusedEventId = preparedCancellation(first.aggregate, OTHER_COMMIT_ID, EVENT_ID);
  throws(() => admit([first.commit], reusedEventId), identity("$commit/events/0/eventId"));
  const key = { key: "client-request-1", requestDigest: COMMAND_DIGEST };
  const keyedFirst = prepared(COMMIT_ID, EVENT_ID, COMMAND_DIGEST, key);
  const keyedSecond = preparedCancellation(keyedFirst.aggregate, OTHER_COMMIT_ID, OTHER_EVENT_ID, OTHER_COMMAND_DIGEST, key);
  throws(() => admit([keyedFirst.commit], keyedSecond), identity("$commit/idempotency/key"));

  const fullPrefix = Array.from({ length: 10_000 }, () => first.commit);
  const overflow = { ...second, commit: { ...second.commit, commitSequence: parseDemandEventCommitSequence(10_001) } };
  throws(() => admit(fullPrefix, overflow), isStoreError("capacity", "$commit"));
});
