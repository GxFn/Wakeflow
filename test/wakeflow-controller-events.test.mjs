#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appendControllerEventAtomic,
  controllerEventStateAlignment,
  readControllerEventsStrict,
  WakeflowControllerEventLogError,
} from "../core/scripts/lib/wakeflow-controller-events.mjs";

const roots = [];

test.after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function eventFile(events) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-controller-events-"));
  roots.push(root);
  const file = path.join(root, "controller-events.jsonl");
  writeFileSync(file, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  return file;
}

test("controller event history starts at revision one and remains contiguous", () => {
  const file = eventFile([
    { eventId: "evt-1", stateRevision: 1 },
    { eventId: "evt-2", stateRevision: 2 },
  ]);
  assert.deepEqual(
    readControllerEventsStrict(file).map((event) => event.stateRevision),
    [1, 2],
  );
});

test("controller event history rejects a deleted prefix", () => {
  const file = eventFile([{ eventId: "evt-3", stateRevision: 3 }]);
  assert.throws(
    () => readControllerEventsStrict(file),
    (error) => error instanceof WakeflowControllerEventLogError
      && /begin at revision 1/i.test(error.message),
  );
});

test("controller event history rejects gaps, duplicate ids, and string revisions", () => {
  for (const events of [
    [
      { eventId: "evt-1", stateRevision: 1 },
      { eventId: "evt-3", stateRevision: 3 },
    ],
    [
      { eventId: "evt-1", stateRevision: 1 },
      { eventId: "evt-1", stateRevision: 2 },
    ],
    [{ eventId: "evt-1", stateRevision: "1" }],
  ]) {
    assert.throws(
      () => readControllerEventsStrict(eventFile(events)),
      WakeflowControllerEventLogError,
    );
  }
});

test("state alignment distinguishes an audit gap from an interrupted event-first write", () => {
  const events = readControllerEventsStrict(eventFile([
    { eventId: "evt-1", stateRevision: 1 },
    { eventId: "evt-2", stateRevision: 2 },
  ]));
  assert.equal(controllerEventStateAlignment(events, 2).status, "aligned");
  assert.equal(controllerEventStateAlignment(events, 1).status, "event-ahead");
  assert.equal(controllerEventStateAlignment(events.slice(0, 1), 2).status, "state-ahead");
});

test("atomic controller event publication appends one contiguous event", () => {
  const file = eventFile([{ eventId: "evt-1", stateRevision: 1 }]);
  appendControllerEventAtomic(file, { eventId: "evt-2", stateRevision: 2 });
  assert.deepEqual(
    readControllerEventsStrict(file).map((event) => event.stateRevision),
    [1, 2],
  );
});

test("atomic controller event publication leaves authority unchanged when temp creation fails", {
  skip: typeof process.getuid === "function" && process.getuid() === 0
    ? "chmod is bypassed when running as root"
    : false,
}, () => {
  const file = eventFile([{ eventId: "evt-1", stateRevision: 1 }]);
  const directory = path.dirname(file);
  const before = readFileSync(file, "utf8");
  chmodSync(directory, 0o500);
  try {
    assert.throws(
      () => appendControllerEventAtomic(file, { eventId: "evt-2", stateRevision: 2 }),
    );
  } finally {
    chmodSync(directory, 0o700);
  }
  assert.equal(readFileSync(file, "utf8"), before);
  assert.deepEqual(readdirSync(directory), ["controller-events.jsonl"]);

  appendControllerEventAtomic(file, { eventId: "evt-2", stateRevision: 2 });
  assert.deepEqual(
    readControllerEventsStrict(file).map((event) => event.stateRevision),
    [1, 2],
  );
});
