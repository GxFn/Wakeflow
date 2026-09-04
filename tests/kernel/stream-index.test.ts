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
  parseStreamIndex,
  publishStreamIndex,
  readLatestStreamIndex,
  renderStreamIndex,
  retireStreamIndexesBefore,
  type IndexableCommit,
} from "../../src/kernel/event-stream/stream-index.js";

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
  deepEqual(index.commits, { "commit-1": 1, "commit-2": 2 });
  deepEqual(index.byType, {
    "demand.published": [1],
    "tasking.target-task-planned": [2],
  });
  deepEqual(index.events.e3, { sequence: 2, revision: 3, type: "tasking.target-task-planned" });
  const text = renderStreamIndex(index);
  deepEqual(parseStreamIndex(parseDeterministicJsonDocument(text)), index);
});

test("链接不上或身份重复的提交被拒绝，损坏文档解析失败", () => {
  const base = advanceStreamIndex(createStreamIndex("demand_x"), FIRST);
  throws(
    () => advanceStreamIndex(base, commit(3, DIGEST_A, DIGEST_B, [{ eventId: "e9", eventType: "t" }], 1)),
    (error: unknown) => isWakeflowError(error) && error.reason === "index-anchor",
  );
  throws(
    () => advanceStreamIndex(base, commit(2, DIGEST_A, DIGEST_B, [{ eventId: "e1", eventType: "t" }], 1)),
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
    deepEqual(
      readdirSync(path.join(fixtureRoot, "event-sourcing", "index")).sort(),
      ["0000000000000002.json", "0000000000000003.json"],
    );
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
