#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Pins the local-storage clarity contract: the storage map classifies known
// trees, flags legacy residue and unknown trees (never deletes them),
// seed-readmes converges the in-place orientation files idempotently, and
// preserve/prune-preserved implement the canonical audit-hold lifecycle.

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const script = path.join(pluginRoot, "scripts/wakeflow-storage.mjs");

function run(args, options = {}) {
  return spawnSync(process.execPath, [script, ...args, "--json"], { encoding: "utf8", shell: false, ...options });
}

function makeWorkspace() {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-storage-"));
  mkdirSync(path.join(root, ".wakeflow-active/current"), { recursive: true });
  mkdirSync(path.join(root, ".wakeflow-local/wakeflow-delivery/hosts"), { recursive: true });
  mkdirSync(path.join(root, "wakeflow-ledger/workspace"), { recursive: true });
  writeFileSync(path.join(root, "wakeflow.config.json"), `${JSON.stringify({ projectLedgerRoot: "wakeflow-ledger" }, null, 2)}\n`);
  return root;
}

test("map classifies known trees and flags legacy residue + unknown trees without touching them", () => {
  const root = makeWorkspace();
  mkdirSync(path.join(root, ".wakeflow-local/preserved-state-roots/old"), { recursive: true });
  writeFileSync(path.join(root, ".wakeflow-local/preserved-state-roots/old/x.json"), "{}\n");
  mkdirSync(path.join(root, ".wakeflow-local/mystery"), { recursive: true });
  writeFileSync(path.join(root, ".wakeflow-local/mystery/blob.bin"), "data\n");

  const result = run(["map", "--root", root]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.ok(payload.trees.length >= 10);
  const ledger = payload.trees.find((t) => t.path === "wakeflow-ledger");
  assert.equal(ledger.class, "authority");
  assert.deepEqual(payload.legacy.map((l) => l.path), [".wakeflow-local/preserved-state-roots"]);
  assert.deepEqual(payload.unknown.map((u) => u.path), [".wakeflow-local/mystery"]);
  assert.match(payload.agentNext, /route to the user/);
  assert.ok(payload.forbiddenConclusions.includes("legacy-or-unknown-trees-are-safe-to-auto-delete"));
  // read-only: nothing moved or deleted
  assert.equal(existsSync(path.join(root, ".wakeflow-local/mystery/blob.bin")), true);
  assert.equal(existsSync(path.join(root, ".wakeflow-local/preserved-state-roots/old/x.json")), true);
});

test("seed-readmes converges in-place READMEs idempotently and honors the configured ledger path", () => {
  const root = makeWorkspace();
  const first = JSON.parse(run(["seed-readmes", "--root", root, "--write"]).stdout);
  const created = first.results.filter((r) => r.status === "created").map((r) => r.file);
  assert.ok(created.includes(".wakeflow-local/README.md"));
  assert.ok(created.includes("wakeflow-ledger/README.md"), "ledger README lands at the CONFIGURED ledger root");
  assert.match(readFileSync(path.join(root, ".wakeflow-local/README.md"), "utf8"), /never auto-delete/i);

  const second = JSON.parse(run(["seed-readmes", "--root", root, "--write"]).stdout);
  assert.ok(second.results.every((r) => r.status === "current" || r.status === "skipped-missing-parent"), JSON.stringify(second.results));

  // a missing tier is skipped, never invented
  assert.ok(first.results.every((r) => r.status !== "created" || existsSync(path.join(root, r.file))));
});

test("preserve moves a tree into preserved/<date>-<reason>/ with a manifest; prune-preserved lists then deletes by cutoff", () => {
  const root = makeWorkspace();
  mkdirSync(path.join(root, ".wakeflow-local/runtime-quarantine"), { recursive: true });
  writeFileSync(path.join(root, ".wakeflow-local/runtime-quarantine/q.json"), "{}\n");

  const dry = JSON.parse(run(["preserve", "--root", root, "--source", ".wakeflow-local/runtime-quarantine", "--reason", "fold-legacy"]).stdout);
  assert.equal(dry.wrote, false);
  assert.equal(existsSync(path.join(root, ".wakeflow-local/runtime-quarantine")), true, "dry-run moves nothing");

  const moved = JSON.parse(run(["preserve", "--root", root, "--source", ".wakeflow-local/runtime-quarantine", "--reason", "fold-legacy", "--write"]).stdout);
  assert.equal(moved.ok, true);
  const dest = path.join(root, moved.moved.to);
  assert.equal(existsSync(path.join(dest, "q.json")), true);
  const manifest = readFileSync(path.join(dest, "MANIFEST.md"), "utf8");
  assert.match(manifest, /Source: \.wakeflow-local\/runtime-quarantine/);
  assert.equal(existsSync(path.join(root, ".wakeflow-local/runtime-quarantine")), false);

  // default retention (30d): fresh entry is NOT a candidate
  const list = JSON.parse(run(["prune-preserved", "--root", root]).stdout);
  assert.equal(list.candidates.length, 0);
  // explicit future cutoff: candidate listed on dry-run, deleted on --apply
  const listAll = JSON.parse(run(["prune-preserved", "--root", root, "--before", "2099-01-01"]).stdout);
  assert.equal(listAll.candidates.length, 1);
  assert.equal(existsSync(dest), true, "dry-run deletes nothing");
  const pruned = JSON.parse(run(["prune-preserved", "--root", root, "--before", "2099-01-01", "--apply"]).stdout);
  assert.deepEqual(pruned.deleted, [moved.moved.to]);
  assert.equal(existsSync(dest), false);
});

test("preserve refuses a missing source and a source already inside preserved/", () => {
  const root = makeWorkspace();
  const missing = run(["preserve", "--root", root, "--source", ".wakeflow-local/nope", "--reason", "x", "--write"]);
  assert.notEqual(missing.status, 0);
  mkdirSync(path.join(root, ".wakeflow-local/preserved/2026-01-01-held"), { recursive: true });
  const inside = run(["preserve", "--root", root, "--source", ".wakeflow-local/preserved/2026-01-01-held", "--reason", "x", "--write"]);
  assert.notEqual(inside.status, 0);
  assert.match(JSON.parse(inside.stdout).error, /already inside preserved/);
});
