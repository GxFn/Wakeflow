#!/usr/bin/env node

import assert from "node:assert/strict";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { handlers } from "../plugins/codex-wakeflow/lib/wakeflow-mcp-tools.mjs";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const script = path.join(workspaceRoot, "scripts/wakeflow-archive-todo.mjs");

function writeFile(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${content.trimEnd()}\n`);
}

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "archive-global-todo-"));
  writeFile(
    path.join(root, ".workspace-active/workspace/current/global-todo-board.md"),
    `# Global TODO Board

## Global TODO

| ID | Status | Type | Priority | Owner | Item / Goal | Affects Retest / Dispatch | Dependency / Trigger | Recommended Window | Current Mount |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DONE-SLASH-2026-06-04 | completed / controller-accepted | fixture | P1 | Workspace | done with note | no | evidence | AlembicWorkspace | [plan](plan.md) |
| ACTIVE-2026-06-04 | observing | fixture | P2 | Workspace | keep active | no | none | AlembicWorkspace | current |

## Completed TODOs and Historical Sync Records

Completed TODOs, historical sync records, and source archives are queried from [workspace-record-map.md](../../../../wakeflow-ledger/workspace/workspace-record-map.md#todo-records).
`,
  );
  writeFile(path.join(root, ".workspace-active/workspace/current/plan.md"), "# Plan\n");
  writeFile(path.resolve(root, "../wakeflow-ledger/workspace/workspace-record-map.md"), "# Record Map\n");
  return root;
}

function run(root, args = []) {
  return runSync("node", [script, "--month", "2026-06", "--date", "2026-06-04", ...args, "--json"], {
    cwd: root,
    encoding: "utf8",
  });
}

test("archives completed rows even when the displayed status has a note suffix", () => {
  const root = makeFixture();
  const result = run(root, ["--apply"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.completedRows, 1);

  const board = readFileSync(path.join(root, ".workspace-active/workspace/current/global-todo-board.md"), "utf8");
  const archive = readFileSync(
    path.resolve(root, "../wakeflow-ledger/workspace/archive/2026-06/global-todo/global-todo-completed-2026-06-04.md"),
    "utf8",
  );
  assert.doesNotMatch(board, /DONE-SLASH-2026-06-04/);
  assert.match(board, /ACTIVE-2026-06-04/);
  assert.match(archive, /DONE-SLASH-2026-06-04/);
});


test("archives completed TODO rows through the public MCP wrapper", async () => {
  const root = makeFixture();
  const result = await handlers.wakeflow_archive_todo({
    root,
    month: "2026-06",
    date: "2026-06-04",
    apply: true,
  });

  assert.equal(result.ok, true, result.stderr || result.stdout);
  assert.equal(result.parsedJson.completedRows, 1);

  const board = readFileSync(path.join(root, ".workspace-active/workspace/current/global-todo-board.md"), "utf8");
  const archive = readFileSync(
    path.resolve(root, "../wakeflow-ledger/workspace/archive/2026-06/global-todo/global-todo-completed-2026-06-04.md"),
    "utf8",
  );
  assert.doesNotMatch(board, /DONE-SLASH-2026-06-04/);
  assert.match(archive, /DONE-SLASH-2026-06-04/);
});


test("prunes already archived workspace index rows through the public MCP wrapper", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "archive-docs-prune-"));
  writeFile(
    path.join(root, ".workspace-active/workspace/index.md"),
    `# Workspace Index

## Current Controller Entry

| Type | Link | Status | Notes |
| --- | --- | --- | --- |
| Archived Plan | [plan](../../../wakeflow-ledger/workspace/archive/2026-06/done-topic/plan.md) | completed | should prune |
| Current Status | [status](current/workspace-current-status.md) | active | should stay |
`,
  );
  writeFile(path.resolve(root, "../wakeflow-ledger/workspace/archive/2026-06/done-topic/plan.md"), "# Archived Plan\n");

  const result = await handlers.wakeflow_archive_workspace_docs({
    root,
    pruneIndexOnly: true,
    apply: true,
  });

  assert.equal(result.ok, true, result.stderr || result.stdout);
  assert.equal(result.parsedJson.removedIndexRows.length, 1);
  const index = readFileSync(path.join(root, ".workspace-active/workspace/index.md"), "utf8");
  assert.doesNotMatch(index, /Archived Plan/);
  assert.match(index, /Current Status/);
});
