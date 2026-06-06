#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
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
  return spawnSync("node", [script, "--month", "2026-06", "--date", "2026-06-04", ...args, "--json"], {
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
