#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const script = path.join(workspaceRoot, "scripts/wakeflow-delivery.mjs");

// One confirmed-send single-attempt OLD run (prunable), a repeated-attempt chain (retained by
// the replay gate), a recent confirmed send (retained by the cutoff), and a non-confirmed run.
const RUNS = [
  { deliveryRunId: "run-old", deliveryId: "d-old", status: "sent", readback: { ok: true }, createdAt: "2026-01-01T00:00:00.000Z" },
  { deliveryRunId: "run-chain-1", deliveryId: "d-chain", status: "sent", readback: { ok: true }, createdAt: "2026-01-02T00:00:00.000Z" },
  { deliveryRunId: "run-chain-2", deliveryId: "d-chain", status: "sent", readback: { ok: true }, createdAt: "2026-01-03T00:00:00.000Z" },
  { deliveryRunId: "run-recent", deliveryId: "d-recent", status: "sent", readback: { ok: true }, createdAt: "2026-12-01T00:00:00.000Z" },
  { deliveryRunId: "run-failed", deliveryId: "d-failed", status: "failed", readback: { ok: false }, createdAt: "2026-01-01T00:00:00.000Z" },
];

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-prune-"));
  const stateDir = path.join(root, ".workspace-local/wakeflow-delivery");
  const runsDir = path.join(stateDir, "delivery-runs");
  mkdirSync(runsDir, { recursive: true });
  for (const run of RUNS) {
    writeFileSync(path.join(runsDir, `${run.deliveryRunId}.json`), `${JSON.stringify({ kind: "DirectThreadDeliveryRun", ...run })}\n`);
  }
  return { root, stateDir, runsDir };
}

function run(root, stateDir, args) {
  return runSync(process.execPath, [script, "prune-runtime", "--root", root, "--state-dir", stateDir, "--json", ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
}

const CUTOFF = "2026-06-01T00:00:00.000Z";

test("prune-runtime dry-run reports the replay-safe confirmed-send run but deletes nothing", () => {
  const { root, stateDir, runsDir } = makeFixture();
  const result = run(root, stateDir, ["--before", CUTOFF]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.wrote, false);
  assert.equal(payload.removed, 0);
  assert.deepEqual(payload.prunable.map((p) => p.deliveryRunId), ["run-old"]);
  assert.equal(existsSync(path.join(runsDir, "run-old.json")), true, "dry-run must not delete");
});

test("prune-runtime --write requires --before to bound the deletion", () => {
  const { root, stateDir } = makeFixture();
  const result = run(root, stateDir, ["--write"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /requires --before/);
});

test("prune-runtime --write deletes only the replay-safe confirmed-send run before the cutoff", () => {
  const { root, stateDir, runsDir } = makeFixture();
  const result = run(root, stateDir, ["--write", "--before", CUTOFF]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.wrote, true);
  assert.equal(payload.removed, 1);
  assert.equal(existsSync(path.join(runsDir, "run-old.json")), false, "old replay-safe run is pruned");
  // retained: replay chain, recent, non-confirmed
  for (const kept of ["run-chain-1", "run-chain-2", "run-recent", "run-failed"]) {
    assert.equal(existsSync(path.join(runsDir, `${kept}.json`)), true, `${kept} must be retained`);
  }
  const reasons = Object.fromEntries(payload.retained.map((r) => [r.deliveryRunId, r.reasons]));
  assert.ok(reasons["run-chain-1"].includes("in-replay-chain"));
  assert.ok(reasons["run-recent"].includes("not-before-cutoff"));
  assert.ok(reasons["run-failed"].includes("not-a-confirmed-send"));
});
