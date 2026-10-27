import { deepEqual, equal, throws } from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { parseDeterministicJsonDocument } from "../../src/foundation/data/deterministic-json-document.js";
import { parsePortableResourcePath } from "../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { isWakeflowError } from "../../src/kernel/error.js";
import {
  advanceStreamIndex,
  buildStreamIndex,
  createStreamIndex,
  type IndexableCommit,
  parseStreamIndex,
  publishStreamIndex,
  readLatestStreamIndex,
  renderStreamIndex,
  retireStreamIndexesBefore,
} from "../../src/kernel/event-stream/stream-index.js";
import { useDisposableDurability } from "../support/disposable-durability.js";

useDisposableDurability();

/**
 * Kernel / Event Stream 的身份索引检查点（ADR-0005、ADR-0013 L0.3），1 级（组件）测试：按提交推进与
 * 文档往返、链接与身份冲突、形状校验的失败路径、不可替换文件的发布/读取/退休，以及把 `constructor`、
 * `toString`、`__proto__` 当 commitId、eventId、事件类型与幂等键时五张字典仍只认自有键（R-ROOT-01）。
 */

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

function commit(
  sequence: number,
  previous: string | null,
  digest: string,
  events: readonly { readonly eventId: string; readonly eventType: string }[],
  expectedRevision: number,
): Readonly<IndexableCommit> {
  return Object.freeze({
    commitId: `commit-${sequence}`,
    commitSequence: sequence,
    expectedStreamRevision: expectedRevision,
    lastStreamRevision: expectedRevision + events.length,
    previousCommitDigest: previous,
    digest,
    byteLength: 100,
    events: events.map((event, position) =>
      Object.freeze({ ...event, streamRevision: expectedRevision + position + 1 }),
    ),
  });
}

const FIRST = commit(1, null, DIGEST_A, [{ eventId: "e1", eventType: "demand.published" }], 0);
const SECOND = commit(
  2,
  DIGEST_A,
  DIGEST_B,
  [
    { eventId: "e2", eventType: "tasking.target-task-planned" },
    { eventId: "e3", eventType: "tasking.target-task-planned" },
  ],
  1,
);

test("索引按提交推进并可从文档往返解析", () => {
  const index = buildStreamIndex("demand_x", [FIRST, SECOND]);
  equal(index.commitSequence, 2);
  equal(index.streamRevision, 3);
  equal(index.lastCommitDigest, DIGEST_B);
  equal(index.totalCommitBytes, 200);
  // 字典是无原型对象：按自有键比较。
  deepEqual({ ...index.commits }, { "commit-1": 1, "commit-2": 2 });
  deepEqual(
    { ...index.byType },
    {
      "demand.published": [1],
      "tasking.target-task-planned": [2],
    },
  );
  deepEqual(index.events.e3, { sequence: 2, revision: 3, type: "tasking.target-task-planned" });
  const text = renderStreamIndex(index);
  deepEqual(parseStreamIndex(parseDeterministicJsonDocument(text)), index);
});

test("链接不上或身份重复的提交被拒绝，损坏文档解析失败", () => {
  const base = advanceStreamIndex(createStreamIndex("demand_x"), FIRST);
  throws(
    () =>
      advanceStreamIndex(
        base,
        commit(3, DIGEST_A, DIGEST_B, [{ eventId: "e9", eventType: "t" }], 1),
      ),
    (error: unknown) => isWakeflowError(error) && error.reason === "index-anchor",
  );
  throws(
    () =>
      advanceStreamIndex(
        base,
        commit(2, DIGEST_A, DIGEST_B, [{ eventId: "e1", eventType: "t" }], 1),
      ),
    (error: unknown) => isWakeflowError(error) && error.reason === "event-id-conflict",
  );
  throws(
    () => advanceStreamIndex(base, { ...SECOND, commitId: "commit-1" }),
    (error: unknown) => isWakeflowError(error) && error.reason === "commit-id-conflict",
  );
  const tampered = { ...buildStreamIndex("demand_x", [FIRST, SECOND]), streamRevision: 9 };
  throws(
    () => parseStreamIndex(JSON.parse(JSON.stringify(tampered))),
    (error: unknown) => isWakeflowError(error) && error.reason === "index-shape",
  );
});

function failsAt(value: unknown, path: string): void {
  throws(
    () => parseStreamIndex(JSON.parse(JSON.stringify(value))),
    (error: unknown) =>
      isWakeflowError(error) &&
      error.code === "invalid-request" &&
      error.reason === "index-shape" &&
      error.path === path,
  );
}

test("byType 漏掉事件类型或列出不含该类型事件的提交时解析失败于 $.byType", () => {
  const index = buildStreamIndex("demand_x", [FIRST, SECOND]);
  failsAt({ ...index, byType: { "demand.published": [1] } }, "$.byType");
  failsAt(
    { ...index, byType: { "demand.published": [1, 2], "tasking.target-task-planned": [2] } },
    "$.byType",
  );
});

test("提交序号为 0 却带非空 lastCommitDigest 的索引解析失败于 $.lastCommitDigest", () => {
  failsAt({ ...createStreamIndex("demand_x"), lastCommitDigest: DIGEST_A }, "$.lastCommitDigest");
});

test("索引以不可替换文件发布、读取最新可用者、退休旧文件", async () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stream-index-"));
  const directory = parsePortableResourcePath("event-sourcing/index");
  mkdirSync(path.join(fixtureRoot, "event-sourcing", "index"), { recursive: true, mode: 0o700 });
  const root = await RootedDirectory.open(fixtureRoot);
  try {
    equal(await readLatestStreamIndex(root, directory, "demand_x"), null);
    const first = advanceStreamIndex(createStreamIndex("demand_x"), FIRST);
    equal(await publishStreamIndex(root, directory, first, { mode: 0o600 }), "published");
    equal(await publishStreamIndex(root, directory, first, { mode: 0o600 }), "existing");
    const second = advanceStreamIndex(first, SECOND);
    await publishStreamIndex(root, directory, second, { mode: 0o600 });
    writeFileSync(
      path.join(fixtureRoot, "event-sourcing", "index", "0000000000000003.json"),
      "{not json\n",
      { mode: 0o600 },
    );
    const located = await readLatestStreamIndex(root, directory, "demand_x");
    equal(located?.index.commitSequence, 2);
    equal(await readLatestStreamIndex(root, directory, "demand_other"), null);
    const retirement = await retireStreamIndexesBefore(root, directory, 2);
    equal(retirement.retired, 1);
    deepEqual(readdirSync(path.join(fixtureRoot, "event-sourcing", "index")).sort(), [
      "0000000000000002.json",
      "0000000000000003.json",
    ]);
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("constructor、toString、__proto__ 作 commitId、eventId、事件类型与幂等键时只落成自有键：推进、往返命中与重复身份冲突照常（R-ROOT-01）", () => {
  const names: readonly string[] = ["constructor", "toString", "__proto__"];
  let index = createStreamIndex("demand_x");
  let previous: string | null = null;
  for (const [position, name] of names.entries()) {
    const digest = `sha256:${String(position + 1).repeat(64)}`;
    index = advanceStreamIndex(index, {
      ...commit(position + 1, previous, digest, [{ eventId: name, eventType: name }], position),
      commitId: name,
      idempotencyKey: name,
    });
    previous = digest;
  }
  for (const dictionary of [index.commits, index.digests, index.events, index.byType, index.keys]) {
    equal(Object.getPrototypeOf(dictionary), null);
  }
  const replayed = parseStreamIndex(parseDeterministicJsonDocument(renderStreamIndex(index)));
  deepEqual(replayed, index);
  for (const [position, name] of names.entries()) {
    for (const candidate of [index, replayed]) {
      equal(Object.hasOwn(candidate.keys, name), true);
      equal(candidate.keys[name], position + 1);
      equal(candidate.commits[name], position + 1);
      equal(candidate.events[name]?.sequence, position + 1);
      deepEqual([...(candidate.byType[name] ?? [])], [position + 1]);
    }
  }
  const fourth = commit(4, previous, DIGEST_B, [{ eventId: "e4", eventType: "t" }], 3);
  throws(
    () => advanceStreamIndex(index, { ...fourth, idempotencyKey: "__proto__" }),
    (error: unknown) => isWakeflowError(error) && error.reason === "idempotency-key-conflict",
  );
  throws(
    () => advanceStreamIndex(index, { ...fourth, commitId: "constructor" }),
    (error: unknown) => isWakeflowError(error) && error.reason === "commit-id-conflict",
  );
  throws(
    () =>
      advanceStreamIndex(
        index,
        commit(4, previous, DIGEST_B, [{ eventId: "toString", eventType: "t" }], 3),
      ),
    (error: unknown) => isWakeflowError(error) && error.reason === "event-id-conflict",
  );
});
