#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const stateScript = path.join(pluginRoot, "scripts/wakeflow-state.mjs");

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function run(args) {
  return runSync(process.execPath, [stateScript, ...args], { cwd: pluginRoot, encoding: "utf8" });
}

function makeLegacyArchive() {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-sanitize-archive-"));
  writeJson(path.join(root, "wakeflow.config.json"), {
    workspaceName: "Archive sanitize fixture",
    controllerWindow: "Controller",
    projectLedgerRoot: "wakeflow-ledger",
  });
  const archiveRoot = path.join(root, "wakeflow-ledger/workspace/archive/2026-07/legacy-archive");
  mkdirSync(archiveRoot, { recursive: true });
  writeJson(path.join(archiveRoot, "wakeflow-state.json"), {
    schemaVersion: 1,
    demandKey: "LEGACY-ARCHIVE",
    title: "Legacy archive",
    state: "archived",
    revision: 5,
    updatedAt: "2026-07-11T00:00:00.000Z",
    controllerHost: null,
    allowedActions: [],
    decisionsRequired: [],
  });
  writeFileSync(path.join(archiveRoot, "controller-events.jsonl"), `${JSON.stringify({
    eventId: "evt-old",
    createdAt: "2026-07-11T00:00:00.000Z",
    actor: "controller",
    type: "demand.archived",
    from: "completed",
    to: "archived",
    reason: "legacy",
    evidenceRefs: [`${root}/evidence/result.json`],
    allowedWrites: [],
    forbiddenConclusions: [],
    stateRevision: 5,
  })}\n`);
  writeJson(path.join(archiveRoot, "archive-manifest.json"), {
    kind: "WakeflowArchiveManifest",
    version: 2,
    demandKey: "LEGACY-ARCHIVE",
    archivedAt: "2026-07-11T00:00:00.000Z",
    sourceStateRoot: `${root}/.wakeflow-active/current/legacy-archive`,
    redactedFields: [],
  });
  writeJson(path.join(archiveRoot, "target-results/result.json"), {
    wakeflowTrace: { root },
    externalEvidence: `${os.homedir()}/.asd/history.sqlite`,
  });
  writeFileSync(path.join(archiveRoot, "archive-summary.md"), `# Legacy\n\nEvidence: ${root}/evidence/result.json\n`);
  return { root, archiveRoot };
}

test("sanitize-archive dry-runs, preserves the original, and replaces only the archived root with a clean audit amendment", () => {
  const { root, archiveRoot } = makeLegacyArchive();
  const args = ["sanitize-archive", "--root", root, "--state-root", archiveRoot, "--reason", "remove historical absolute paths", "--json"];

  const dry = run(args);
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const dryPayload = JSON.parse(dry.stdout);
  assert.equal(dryPayload.wrote, false);
  assert.ok(dryPayload.wouldSanitize.findingCounts["workspace-absolute-path"] > 0);
  assert.ok(dryPayload.wouldSanitize.findingCounts["home-absolute-path"] > 0);
  assert.match(readFileSync(path.join(archiveRoot, "target-results/result.json"), "utf8"), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const applied = run([...args.slice(0, -1), "--write", "--json"]);
  assert.equal(applied.status, 0, applied.stderr || applied.stdout);
  const payload = JSON.parse(applied.stdout);
  assert.equal(payload.wrote, true);
  assert.equal(payload.sanitized.stateRevision, 6);
  const entireArchive = [
    readFileSync(path.join(archiveRoot, "archive-manifest.json"), "utf8"),
    readFileSync(path.join(archiveRoot, "controller-events.jsonl"), "utf8"),
    readFileSync(path.join(archiveRoot, "target-results/result.json"), "utf8"),
    readFileSync(path.join(archiveRoot, "archive-summary.md"), "utf8"),
  ].join("\n");
  assert.doesNotMatch(entireArchive, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(entireArchive, new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(entireArchive, /<workspace-root>/);
  assert.match(entireArchive, /archive\.sanitized/);
  const state = readJson(path.join(archiveRoot, "wakeflow-state.json"));
  assert.equal(state.state, "archived", "sanitization never reopens the demand");
  assert.equal(state.revision, 6);
  const manifest = readJson(path.join(archiveRoot, "archive-manifest.json"));
  assert.equal(manifest.version, 3);
  assert.equal(manifest.sanitizationHistory.length, 1);
  assert.equal(existsSync(path.join(root, payload.sanitized.originalPreservedAt, "MANIFEST.md")), true);
  assert.match(readFileSync(path.join(root, payload.sanitized.originalPreservedAt, "target-results/result.json"), "utf8"), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "preserved original retains audit bytes");

  const second = run([...args.slice(0, -1), "--write", "--json"]);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  const secondPayload = JSON.parse(second.stdout);
  assert.equal(secondPayload.alreadyClean, true);
  assert.equal(secondPayload.wrote, false);
  assert.equal(readJson(path.join(archiveRoot, "wakeflow-state.json")).revision, 6, "clean no-op does not create another event");
});

test("sanitize-archive refuses an archived-looking root outside the configured archive ledger", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-sanitize-boundary-"));
  writeJson(path.join(root, "wakeflow.config.json"), { workspaceName: "X", controllerWindow: "C", projectLedgerRoot: "wakeflow-ledger" });
  const outside = path.join(root, ".wakeflow-active/current/not-an-archive");
  writeJson(path.join(outside, "wakeflow-state.json"), { demandKey: "OUTSIDE", state: "archived", revision: 1 });
  writeJson(path.join(outside, "archive-manifest.json"), { demandKey: "OUTSIDE", version: 2 });
  const result = run(["sanitize-archive", "--root", root, "--state-root", outside, "--reason", "must refuse", "--write", "--json"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /only an existing demand root below/);
  assert.equal(readJson(path.join(outside, "wakeflow-state.json")).revision, 1);
});
