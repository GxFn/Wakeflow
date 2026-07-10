#!/usr/bin/env node

// Thin-entry governance: a workspace may keep its active entry docs as
// pointer-only surfaces by opting in with an EXPLICIT marker
// (`<!-- wakeflow:doc-contract: thin -->`). With the marker, the docs/layout
// checkers require only the thin shape (Status line + Current Controller
// Entry for the index; ## Current Controller Status for the status doc).
// Without the marker the full section contract stays — a thin doc must be a
// decision, never an accident.

import assert from "node:assert/strict";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const wakeflowRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const layoutScript = path.join(wakeflowRoot, "scripts/wakeflow-check-layout.mjs");
const docsScript = path.join(wakeflowRoot, "scripts/verify-workspace-docs.mjs");
const templateBundle = JSON.parse(readFileSync(path.join(wakeflowRoot, "templates/wakeflow-template-bundle.json"), "utf8"));

function writeFile(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${content.trimEnd()}\n`);
}

function makeStarterFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-thin-"));
  for (const [relativePath, content] of Object.entries(templateBundle.files)) {
    if (!relativePath.startsWith("templates/starter-workspace/workspace/")) continue;
    writeFile(path.join(root, ".wakeflow-active", relativePath.slice("templates/starter-workspace/workspace/".length)), content);
  }
  writeFile(path.join(root, "AGENTS.md"), "# Fixture Workspace\n");
  writeFile(path.join(root, "wakeflow.config.json"), JSON.stringify({
    runtimeMode: "plugin",
    workspaceName: "FixtureWorkspace",
    controllerWindow: "Wakeflow",
    workspaceRoot: ".",
    activeLedgerRoot: ".wakeflow-active",
    projectLedgerRoot: "wakeflow-ledger",
    windowLedgerRoot: "wakeflow-ledger",
    workspaceDocsDir: ".wakeflow-active",
    workspaceCurrentDir: ".wakeflow-active/current",
    workspaceArchiveDir: "wakeflow-ledger/workspace/archive",
    workspaceIndexPath: ".wakeflow-active/index.md",
    workspaceCurrentIndexPath: ".wakeflow-active/current/index.md",
    workspaceCurrentStatusPath: ".wakeflow-active/current/workspace-current-status.md",
    globalTodoPath: ".wakeflow-active/current/global-todo-board.md",
    testExchangePath: ".wakeflow-active/current/test-exchange.md",
  }, null, 2));
  return root;
}

const THIN_MARKER = "<!-- wakeflow:doc-contract: thin -->";

function thinIndex({ marker = true } = {}) {
  return [
    "# Fixture Workspace Index",
    "",
    ...(marker ? [THIN_MARKER, ""] : []),
    "Status: **0 active demands — fresh-start ready**. Pointer-only entry; history lives in the ledger.",
    "",
    "## Current Controller Entry",
    "",
    "| Type | Document | Status | Notes |",
    "| --- | --- | --- | --- |",
    "| Current Status | [current/workspace-current-status.md](current/workspace-current-status.md) | maintained | thin |",
    "",
  ].join("\n");
}

function thinStatus({ marker = true } = {}) {
  return [
    "# Fixture Current Status",
    "",
    ...(marker ? [THIN_MARKER, ""] : []),
    "## Current Controller Status",
    "",
    "- No active demand; new work starts from the TODO board.",
    "",
  ].join("\n");
}

function run(script, root, args = []) {
  return runSync(process.execPath, [script, "--root", root, "--json", ...args], { cwd: root, encoding: "utf8" });
}

test("marked thin entry docs satisfy both the docs and layout contracts", () => {
  const root = makeStarterFixture();
  writeFile(path.join(root, ".wakeflow-active/index.md"), thinIndex());
  writeFile(path.join(root, ".wakeflow-active/current/workspace-current-status.md"), thinStatus());

  const layout = run(layoutScript, root);
  assert.equal(layout.status, 0, layout.stderr || layout.stdout);
  assert.deepEqual(JSON.parse(layout.stdout).issues, []);

  const docs = runSync(process.execPath, [docsScript, "--root", root, "--all-workspace"], { cwd: root, encoding: "utf8" });
  assert.equal(docs.status, 0, docs.stderr || docs.stdout);
});

test("thin-shaped docs WITHOUT the marker still fail the full contract", () => {
  const root = makeStarterFixture();
  writeFile(path.join(root, ".wakeflow-active/index.md"), thinIndex({ marker: false }));
  writeFile(path.join(root, ".wakeflow-active/current/workspace-current-status.md"), thinStatus({ marker: false }));

  const layout = run(layoutScript, root);
  assert.notEqual(layout.status, 0);
  assert.match(JSON.parse(layout.stdout).issues.join("\n"), /missing a Status: line/);

  const docs = runSync(process.execPath, [docsScript, "--root", root, "--all-workspace"], { cwd: root, encoding: "utf8" });
  assert.notEqual(docs.status, 0);
  assert.match(docs.stdout + docs.stderr, /missing required section/);
});

test("a marked thin status doc still needs its controller-status heading", () => {
  const root = makeStarterFixture();
  writeFile(path.join(root, ".wakeflow-active/index.md"), thinIndex());
  writeFile(path.join(root, ".wakeflow-active/current/workspace-current-status.md"), [
    "# Fixture Current Status",
    "",
    THIN_MARKER,
    "",
    "just some prose with no headings",
    "",
  ].join("\n"));

  const layout = run(layoutScript, root);
  assert.notEqual(layout.status, 0);
  assert.match(JSON.parse(layout.stdout).issues.join("\n"), /thin doc contract but is missing ## Current Controller Status/);
});
