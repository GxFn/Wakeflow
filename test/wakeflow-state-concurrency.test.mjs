#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import test from "node:test";

// Guards W0-a/W0-b (next-phase roadmap Phase 0): every state-root read-modify-write
// command serializes on the sibling <root>.state-lock file, so parallel MCP calls
// from one controller turn cannot drop each other's revision. import-target-result
// stays lock-free by design (it never writes wakeflow-state.json).

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const script = path.join(workspaceRoot, "scripts/wakeflow-state.mjs");

function makeRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-state-lock-"));
  mkdirSync(root, { recursive: true });
  return root;
}

function run(args) {
  return runSync(process.execPath, [script, ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
}

function runAsync(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: workspaceRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function initDemand(root, demandKey) {
  const result = run([
    "init",
    "--root",
    root,
    "--demand-key",
    demandKey,
    "--title",
    "Concurrency Fixture",
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  return path.join(root, payload.stateRoot);
}

function addTaskArgs(root, stateRoot, id, targetWindow) {
  return [
    "add-task-package",
    "--root",
    root,
    "--state-root",
    stateRoot,
    "--task-package-id",
    id,
    "--summary",
    `Package ${id}`,
    "--target-window",
    targetWindow,
    "--write",
    "--json",
  ];
}

function lockFileFor(stateRoot) {
  return path.join(path.dirname(stateRoot), `${path.basename(stateRoot)}.state-lock`);
}

test("parallel add-task-package calls serialize instead of dropping an update", async () => {
  const root = makeRoot();
  const stateRoot = initDemand(root, "LOCK-PARALLEL-ADD-2026-07-02");
  const ids = ["tp-a", "tp-b", "tp-c", "tp-d"];

  const results = await Promise.all(
    ids.map((id, index) => runAsync(addTaskArgs(root, stateRoot, id, `Repo${index}`))),
  );
  for (const result of results) {
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  const state = readJson(path.join(stateRoot, "wakeflow-state.json"));
  assert.deepEqual(
    state.taskPackages.map((item) => item.taskPackageId).sort(),
    [...ids].sort(),
    "every parallel add must land; a missing package means a lost read-modify-write",
  );
  assert.equal(state.revision, 1 + ids.length);

  const eventLines = readFileSync(path.join(stateRoot, "controller-events.jsonl"), "utf8").trim().split("\n");
  const revisions = eventLines.map((line) => JSON.parse(line).stateRevision);
  assert.deepEqual(revisions, [1, 2, 3, 4, 5], "event revisions must be strictly sequential with no gaps or repeats");

  assert.equal(existsSync(lockFileFor(stateRoot)), false, "lock must be released after the commands finish");
});

test("parallel import-target-result stays lock-free and never mutates state", async () => {
  const root = makeRoot();
  const stateRoot = initDemand(root, "LOCK-PARALLEL-IMPORT-2026-07-02");
  for (const [id, windowName] of [["tp-a", "RepoA"], ["tp-b", "RepoB"]]) {
    const added = run(addTaskArgs(root, stateRoot, id, windowName));
    assert.equal(added.status, 0, added.stderr || added.stdout);
  }
  const before = readJson(path.join(stateRoot, "wakeflow-state.json"));

  const results = await Promise.all([
    runAsync([
      "import-target-result",
      "--root",
      root,
      "--state-root",
      stateRoot,
      "--target-task-id",
      "tp-a__RepoA",
      "--target-window",
      "RepoA",
      "--status",
      "completed",
      "--write",
      "--json",
    ]),
    runAsync([
      "import-target-result",
      "--root",
      root,
      "--state-root",
      stateRoot,
      "--target-task-id",
      "tp-b__RepoB",
      "--target-window",
      "RepoB",
      "--status",
      "completed",
      "--write",
      "--json",
    ]),
  ]);
  for (const result of results) {
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  const resultFiles = readdirSync(path.join(stateRoot, "target-results")).filter((name) => name.endsWith(".json"));
  assert.equal(resultFiles.length, 2);
  const after = readJson(path.join(stateRoot, "wakeflow-state.json"));
  assert.equal(after.revision, before.revision, "import-target-result must not bump the state revision");
});

test("a stale lock is broken with a warning instead of wedging the command", () => {
  const root = makeRoot();
  const stateRoot = initDemand(root, "LOCK-STALE-2026-07-02");
  const lockFile = lockFileFor(stateRoot);
  writeFileSync(
    lockFile,
    `${JSON.stringify({
      kind: "WakeflowStateLock",
      version: 1,
      pid: 99999999,
      token: "dead-crash-residue",
      createdAt: new Date(Date.now() - 60000).toISOString(),
    })}\n`,
  );

  const result = run(addTaskArgs(root, stateRoot, "tp-after-stale", "RepoA"));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /breaking stale state lock/);
  assert.equal(existsSync(lockFile), false);
});

test("a stale-aged lock held by a LIVE pid is protected, not stolen (H-10)", () => {
  const root = makeRoot();
  const stateRoot = initDemand(root, "LOCK-LIVE-2026-07-02");
  const lockFile = lockFileFor(stateRoot);
  writeFileSync(
    lockFile,
    `${JSON.stringify({
      kind: "WakeflowStateLock",
      version: 1,
      pid: process.pid,
      token: "live-long-archive",
      createdAt: new Date(Date.now() - 60000).toISOString(),
    })}\n`,
  );

  const result = run(addTaskArgs(root, stateRoot, "tp-blocked-live", "RepoA"));
  assert.equal(result.status, 1, result.stdout);
  assert.match(JSON.parse(result.stdout).error, /locked by a LIVE Wakeflow process/);
  assert.equal(existsSync(lockFile), true, "a live holder's lock must survive the stale threshold");
});

test("a LIVE pid's lock is never auto-stolen, however old (H-10 revised)", () => {
  // The old 4x-grace steal ran on wall clocks: a suspend/NTP jump past the
  // grace window let a contender break a lock whose holder was mid-critical-
  // section. A live holder now always fails the contender closed; only dead
  // pids are residue.
  const root = makeRoot();
  const stateRoot = initDemand(root, "LOCK-LIVE-4X-2026-07-02");
  const lockFile = lockFileFor(stateRoot);
  writeFileSync(
    lockFile,
    `${JSON.stringify({
      kind: "WakeflowStateLock",
      version: 1,
      pid: process.pid,
      token: "live-but-ancient",
      createdAt: new Date(Date.now() - 150000).toISOString(),
    })}\n`,
  );

  const result = run(addTaskArgs(root, stateRoot, "tp-after-4x", "RepoA"));
  assert.notEqual(result.status, 0, "contender fails closed against a live holder");
  assert.match(result.stderr + result.stdout, /locked by a LIVE Wakeflow process/);
  assert.equal(existsSync(lockFile), true, "the live holder's lock survives");
});

test("a fresh foreign lock fails the command closed after the acquire timeout", () => {
  const root = makeRoot();
  const stateRoot = initDemand(root, "LOCK-FRESH-2026-07-02");
  const lockFile = lockFileFor(stateRoot);
  writeFileSync(
    lockFile,
    `${JSON.stringify({
      kind: "WakeflowStateLock",
      version: 1,
      pid: process.pid,
      token: "held-by-a-live-process",
      createdAt: new Date().toISOString(),
    })}\n`,
  );

  const result = run(addTaskArgs(root, stateRoot, "tp-blocked", "RepoA"));
  assert.equal(result.status, 1, result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /locked by another Wakeflow process/);

  const state = readJson(path.join(stateRoot, "wakeflow-state.json"));
  assert.equal(state.revision, 1, "the blocked command must not have written anything");
  assert.equal(existsSync(lockFile), true, "a fresh foreign lock must never be deleted by a contender");
});
