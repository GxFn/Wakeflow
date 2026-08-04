#!/usr/bin/env node

import assert from "node:assert/strict";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import { handlers } from "../plugins/codex-wakeflow/lib/wakeflow-mcp-tools.mjs";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const script = path.join(workspaceRoot, "scripts/wakeflow-archive-todo.mjs");
const docsScript = path.join(workspaceRoot, "scripts/wakeflow-archive-docs.mjs");
const todoScript = path.join(workspaceRoot, "scripts/wakeflow-todo.mjs");

function writeFile(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${content.trimEnd()}\n`);
}

function makeFixture() {
  const parent = mkdtempSync(path.join(os.tmpdir(), "archive-global-todo-"));
  const root = path.join(parent, "workspace");
  mkdirSync(root, { recursive: true });
  writeFile(
    path.join(root, ".wakeflow-active/current/global-todo-board.md"),
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
  writeFile(path.join(root, ".wakeflow-active/current/plan.md"), "# Plan\n");
  writeFile(path.join(root, "authority.md"), `# Authority

## Reproduction

## Scope

## Non goals
`);
  writeFile(path.resolve(root, "../wakeflow-ledger/workspace/workspace-record-map.md"), "# Record Map\n");
  return root;
}

function bugAuthority(demandKey) {
  return JSON.stringify({
    demandKey,
    demandType: "bug",
    entryMode: "design-delivery",
    authorityRefs: ["reproduction", "scope", "non-goals"]
      .map((role) => ({ role, ref: `authority.md#${role}` })),
    testDecision: {
      mode: "controller-only",
      summary: "Controller verifies the bounded archive/TODO concurrency fixture.",
    },
  });
}

function run(root, args = []) {
  return runSync(process.execPath, [script, "--month", "2026-06", "--date", "2026-06-04", ...args, "--json"], {
    cwd: root,
    encoding: "utf8",
  });
}

function runAsync(scriptPath, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("archives completed rows even when the displayed status has a note suffix", () => {
  const root = makeFixture();
  const result = run(root, ["--apply"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.completedRows, 1);

  const board = readFileSync(path.join(root, ".wakeflow-active/current/global-todo-board.md"), "utf8");
  const archive = readFileSync(
    path.resolve(root, "../wakeflow-ledger/workspace/archive/2026-06/global-todo/global-todo-completed-2026-06-04.md"),
    "utf8",
  );
  assert.doesNotMatch(board, /DONE-SLASH-2026-06-04/);
  assert.match(board, /ACTIVE-2026-06-04/);
  const expectedRecordMapTarget = `${path.relative(
    path.dirname(path.join(root, ".wakeflow-active/current/global-todo-board.md")),
    path.resolve(root, "../wakeflow-ledger/workspace/workspace-record-map.md"),
  ).split(path.sep).join("/")}#todo-records`;
  assert.match(board, new RegExp(`\\(${expectedRecordMapTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`));
  assert.match(archive, /DONE-SLASH-2026-06-04/);
  const header = archive.split("\n").find((line) => line.startsWith("| ID |"));
  const divider = archive.split("\n").find((line) => line.startsWith("| --- |"));
  assert.equal(header.split("|").slice(1, -1).length, 13);
  assert.equal(divider.split("|").slice(1, -1).length, 13);
});

test("archive is idempotent by TODO ID after an archive-first partial recovery", () => {
  const root = makeFixture();
  const first = run(root, ["--apply"]);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const boardPath = path.join(root, ".wakeflow-active/current/global-todo-board.md");
  const board = readFileSync(boardPath, "utf8");
  writeFileSync(
    boardPath,
    board.replace(
      "| ACTIVE-2026-06-04",
      "| DONE-SLASH-2026-06-04 | completed / controller-accepted | fixture | P1 | Workspace | done with note | no | evidence | AlembicWorkspace | [plan](plan.md) |  |  |  |\n| ACTIVE-2026-06-04",
    ),
  );

  const second = run(root, ["--apply"]);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(JSON.parse(second.stdout).completedRows, 1);
  const archive = readFileSync(
    path.resolve(root, "../wakeflow-ledger/workspace/archive/2026-06/global-todo/global-todo-completed-2026-06-04.md"),
    "utf8",
  );
  assert.equal((archive.match(/DONE-SLASH-2026-06-04/g) ?? []).length, 1);
  assert.doesNotMatch(readFileSync(boardPath, "utf8"), /DONE-SLASH-2026-06-04/);
});

test("archive and TODO deliveries share one board lock without dropping rows", async () => {
  const root = makeFixture();
  const results = await Promise.all([
    runAsync(script, ["--month", "2026-06", "--date", "2026-06-04", "--apply", "--json"], root),
    runAsync(todoScript, [
      "deliver", "--type", "bug", "--design-key", "parallel-a-2026-07-30", "--title", "Parallel A",
      "--demand-authority", bugAuthority("parallel-a-2026-07-30"), "--apply", "--json",
    ], root),
    runAsync(todoScript, [
      "deliver", "--type", "bug", "--design-key", "parallel-b-2026-07-30", "--title", "Parallel B",
      "--demand-authority", bugAuthority("parallel-b-2026-07-30"), "--apply", "--json",
    ], root),
  ]);
  for (const result of results) assert.equal(result.status, 0, result.stderr || result.stdout);
  const board = readFileSync(path.join(root, ".wakeflow-active/current/global-todo-board.md"), "utf8");
  assert.doesNotMatch(board, /DONE-SLASH-2026-06-04/);
  assert.match(board, /parallel-a-2026-07-30/);
  assert.match(board, /parallel-b-2026-07-30/);
});


test("archives completed TODO rows through the public MCP wrapper", async () => {
  const root = makeFixture();
  const result = await handlers.wakeflow_archive({
    target: "todo",
    root,
    month: "2026-06",
    date: "2026-06-04",
    apply: true,
  });

  assert.equal(result.ok, true, result.stderr || result.stdout);
  assert.equal(result.parsedJson.completedRows, 1);

  const board = readFileSync(path.join(root, ".wakeflow-active/current/global-todo-board.md"), "utf8");
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
    path.join(root, ".wakeflow-active/index.md"),
    `# Workspace Index

## Current Controller Entry

| Type | Link | Status | Notes |
| --- | --- | --- | --- |
| Archived Plan | [plan](../../wakeflow-ledger/workspace/archive/2026-06/done-topic/plan.md) | completed | should prune |
| Current Status | [status](current/workspace-current-status.md) | active | should stay |
`,
  );
  writeFile(path.resolve(root, "../wakeflow-ledger/workspace/archive/2026-06/done-topic/plan.md"), "# Archived Plan\n");

  const result = await handlers.wakeflow_archive({
    target: "docs",
    root,
    pruneIndexOnly: true,
    apply: true,
  });

  assert.equal(result.ok, true, result.stderr || result.stdout);
  assert.equal(result.parsedJson.removedIndexRows.length, 1);
  const index = readFileSync(path.join(root, ".wakeflow-active/index.md"), "utf8");
  assert.doesNotMatch(index, /Archived Plan/);
  assert.match(index, /Current Status/);
});

test("workspace doc archive refuses a symlink source without reading or moving its target", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "archive-docs-symlink-"));
  writeFile(
    path.join(root, ".wakeflow-active/index.md"),
    "# Workspace Index\n\n## Current Controller Entry\n\n| Type | Link | Status | Notes |\n| --- | --- | --- | --- |\n",
  );
  const external = path.join(mkdtempSync(path.join(os.tmpdir(), "archive-docs-external-")), "outside.md");
  writeFile(external, "# Outside\n\nMust remain external.\n");
  const link = path.join(root, ".wakeflow-active/current/linked.md");
  mkdirSync(path.dirname(link), { recursive: true });
  symlinkSync(external, link);

  const result = runSync(process.execPath, [
    docsScript,
    "--root", root,
    "--topic", "unsafe",
    "--month", "2026-07",
    "--file", ".wakeflow-active/current/linked.md",
    "--apply",
    "--json",
  ], { cwd: root, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /cannot be a symbolic link/i);
  assert.match(readFileSync(external, "utf8"), /Must remain external/);
});
