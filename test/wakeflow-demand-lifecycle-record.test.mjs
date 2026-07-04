#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Pins the demand information lifecycle: provenance persists on demand.json,
// every real action appends a readable line to the progress doc's execution
// timeline (surviving re-render and riding the archive copy), and the archive
// carries a navigable spine (manifest v2 + archive-summary.md).

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const stateScript = path.join(pluginRoot, "scripts/wakeflow-state.mjs");
const seqScript = path.join(pluginRoot, "scripts/wakeflow-demand-sequence.mjs");
const renderScript = path.join(pluginRoot, "scripts/wakeflow-render-progress.mjs");

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args, "--json"], { encoding: "utf8", shell: false });
}

function makeWorkspace() {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-lifecycle-"));
  writeFileSync(path.join(root, "wakeflow.config.json"), `${JSON.stringify({ projectLedgerRoot: "wakeflow-ledger" }, null, 2)}\n`);
  mkdirSync(path.join(root, ".wakeflow-active/current"), { recursive: true });
  return root;
}

function progressDoc(root, stateRoot) {
  return readFileSync(path.join(root, stateRoot, "developer-progress.md"), "utf8");
}

test("provenance + execution timeline: create from a TODO row, act, and read the story in the progress doc", () => {
  const root = makeWorkspace();
  writeFileSync(
    path.join(root, ".wakeflow-active/current/global-todo-board.md"),
    [
      "# Global TODO", "", "## Global TODO", "",
      "| ID | Status | Type | Priority | Owner | Item / Goal | Affects Retest / Dispatch | Dependency / Trigger | Recommended Window | Current Mount | Auto Claim | Documents |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      "| LIFE-2026-07-04 | pending-claim | requirement | P1 | Wakeflow | lifecycle fixture | no | none | Wakeflow | none | yes | [design](wakeflow-ledger/requirement-designs/life/design.md) [plan](wakeflow-ledger/requirement-designs/life/plan.md) |",
      "",
    ].join("\n"),
  );

  const created = run(seqScript, ["create-demand", "--root", root, "--todo-id", "LIFE-2026-07-04", "--write"]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  const stateRoot = JSON.parse(created.stdout).created.stateRoot;

  // Provenance persists as data, not prose
  const demand = JSON.parse(readFileSync(path.join(root, stateRoot, "demand.json"), "utf8"));
  assert.equal(demand.source.designKey, "LIFE-2026-07-04");
  assert.deepEqual(demand.source.documents, [
    "wakeflow-ledger/requirement-designs/life/design.md",
    "wakeflow-ledger/requirement-designs/life/plan.md",
  ]);

  // Task package appended to the timeline (with intent)
  const added = run(stateScript, ["add-task-package", "--root", root, "--state-root", stateRoot,
    "--task-package-id", "pkg-1", "--summary", "build the thing", "--target-window", "RepoA",
    "--design-intent", "one canonical path", "--write"]);
  assert.equal(added.status, 0, added.stderr || added.stdout);
  let doc = progressDoc(root, stateRoot);
  assert.match(doc, /## Task Packages\n[\s\S]*pkg-1 → RepoA — build the thing \(intent: one canonical path\)/);

  // Target return appended under Backfill Summaries
  const imported = run(stateScript, ["import-target-result", "--root", root, "--state-root", stateRoot,
    "--target-task-id", "pkg-1__RepoA", "--target-window", "RepoA", "--status", "completed",
    "--summary", "done", "--evidence-ref", `${stateRoot}/demand.json`, "--write"]);
  assert.equal(imported.status, 0, imported.stderr || imported.stdout);
  doc = progressDoc(root, stateRoot);
  assert.match(doc, /## Backfill Summaries\n[\s\S]*RepoA\/pkg-1__RepoA returned completed \(result /);

  // Reduce -> decide -> complete land under Decisions And Append Log
  const reduced = run(stateScript, ["reduce-results", "--root", root, "--state-root", stateRoot, "--write"]);
  assert.equal(reduced.status, 0, reduced.stderr || reduced.stdout);
  const candidateId = JSON.parse(reduced.stdout).candidateId
    ?? JSON.parse(reduced.stdout).transitionCandidate?.candidateId;
  const decided = run(stateScript, ["decide-review", "--root", root, "--state-root", stateRoot,
    "--candidate-id", candidateId, "--decision", "accept", "--reason", "evidence reviewed", "--write"]);
  assert.equal(decided.status, 0, decided.stderr || decided.stdout);
  const completed = run(stateScript, ["complete-demand", "--root", root, "--state-root", stateRoot,
    "--reason", "all accepted", "--evidence-ref", `${stateRoot}/demand.json`, "--write"]);
  assert.equal(completed.status, 0, completed.stderr || completed.stdout);
  doc = progressDoc(root, stateRoot);
  assert.match(doc, /decision accept \(candidate /);
  assert.match(doc, /demand completed — all accepted/);

  // The timeline SURVIVES a re-render (render only rewrites the marker block)
  const rendered = run(renderScript, ["--root", root, "--state-root", stateRoot, "--write"]);
  assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
  doc = progressDoc(root, stateRoot);
  assert.match(doc, /pkg-1 → RepoA — build the thing/);
  assert.match(doc, /demand completed — all accepted/);

  // Archive: spine manifest v2 + human summary, and the closing line rides the copy
  const archived = run(stateScript, ["archive-demand", "--root", root, "--state-root", stateRoot,
    "--reason", "story closed", "--write"]);
  assert.equal(archived.status, 0, archived.stderr || archived.stdout);
  const ledgerDest = JSON.parse(archived.stdout).archived.ledgerDest;
  const manifest = JSON.parse(readFileSync(path.join(root, ledgerDest, "archive-manifest.json"), "utf8"));
  assert.equal(manifest.version, 2);
  assert.equal(manifest.designKey, "LIFE-2026-07-04");
  assert.equal(manifest.sourceDocuments.length, 2);
  assert.equal(manifest.conclusion.reason, "all accepted");
  assert.equal(manifest.taskLedger[0].targetTaskId, "pkg-1__RepoA");
  assert.equal(manifest.taskLedger[0].reviewDecision, "accept");

  const summary = readFileSync(path.join(root, ledgerDest, "archive-summary.md"), "utf8");
  assert.match(summary, /## Provenance/);
  assert.match(summary, /Design key: LIFE-2026-07-04/);
  assert.match(summary, /wakeflow-ledger\/requirement-designs\/life\/design\.md/);
  assert.match(summary, /## Conclusion/);
  assert.match(summary, /all accepted/);
  assert.match(summary, /\| pkg-1__RepoA \| RepoA \| accepted \| accept \| 0 \| 0 \| 0 \|/);

  const archivedDoc = readFileSync(path.join(root, ledgerDest, "developer-progress.md"), "utf8");
  assert.match(archivedDoc, /archived → /, "the archived progress doc closes its own story");
});

test("timeline appends never break the mutation when the progress doc is missing", () => {
  const root = makeWorkspace();
  const init = run(stateScript, ["init", "--root", root, "--demand-key", "NO-DOC", "--title", "t", "--write"]);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  const stateRoot = JSON.parse(init.stdout).stateRoot;
  const doc = path.join(root, stateRoot, "developer-progress.md");
  spawnSync("rm", [doc]);
  assert.equal(existsSync(doc), false);
  const added = run(stateScript, ["add-task-package", "--root", root, "--state-root", stateRoot,
    "--task-package-id", "p", "--summary", "s", "--target-window", "W", "--write"]);
  assert.equal(added.status, 0, added.stderr || added.stdout, "append degrades, mutation succeeds");
});
