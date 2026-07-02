#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// wakeflow.config.json is the canonical config name; the legacy
// workspace.config.json keeps resolving READ-side so pre-rename workspaces
// never break. These tests pin that contract on both the tracked file and the
// .wakeflow-local overlay layer.

const codexPluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const claudePluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/claude-code-wakeflow");
const nextWorkScript = path.join(codexPluginRoot, "scripts/wakeflow-next-work.mjs");
const hostScript = path.join(claudePluginRoot, "scripts/lib/wakeflow-claude-host.mjs");

function runSync(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", shell: false, ...options });
}

function writeFile(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${content.trimEnd()}\n`);
}

function makeBoardFixture(root) {
  writeFile(
    path.join(root, ".wakeflow-active/current/workspace-current-status.md"),
    "# Status\n\nStatus: idle\n",
  );
  writeFile(
    path.join(root, ".wakeflow-active/current/global-todo-board.md"),
    "# Global TODO\n\n## Global TODO\n\n| ID | Status | Type | Priority | Owner | Item / Goal | Affects Retest / Dispatch | Dependency / Trigger | Recommended Window | Current Mount |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| LEGACY-2026-07-02 | pending-claim | requirement | P1 | Wakeflow | legacy config fixture | no | none | Wakeflow | none |\n",
  );
}

test("legacy tracked workspace.config.json still resolves (capacity read through the old name)", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-legacy-config-"));
  makeBoardFixture(root);
  writeFile(path.join(root, "workspace.config.json"), JSON.stringify({ maxActiveDemands: 1 }, null, 2));
  writeFile(path.join(root, ".wakeflow-active/current/other-demand/wakeflow-state.json"), JSON.stringify({
    demandKey: "other-demand",
    state: "planned",
  }, null, 2));

  const result = runSync(process.execPath, [nextWorkScript, "--json", "--source", "todo"], { cwd: root });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  // maxActiveDemands=1 only takes effect if the LEGACY file name was read.
  assert.equal(parsed.demandCapacity.max, 1);
  assert.equal(parsed.demandCapacity.atCapacity, true);
});

test("wakeflow.config.json wins over a coexisting legacy file", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-config-pref-"));
  makeBoardFixture(root);
  writeFile(path.join(root, "workspace.config.json"), JSON.stringify({ maxActiveDemands: 1 }, null, 2));
  writeFile(path.join(root, "wakeflow.config.json"), JSON.stringify({ maxActiveDemands: 7 }, null, 2));

  const result = runSync(process.execPath, [nextWorkScript, "--json", "--source", "todo"], { cwd: root });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).demandCapacity.max, 7);
});

test("stream-open on a legacy-named workspace works and writes the canonical overlay name; check-workspace suggests the rename", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-legacy-stream-"));
  const repoDir = path.join(root, "RepoA");
  mkdirSync(repoDir, { recursive: true });
  runSync("git", ["init", "-q", "-b", "main", repoDir]);
  writeFileSync(path.join(repoDir, "README.md"), "fixture\n");
  runSync("git", ["-C", repoDir, "-c", "user.email=t@t", "-c", "user.name=t", "add", "README.md"]);
  runSync("git", ["-C", repoDir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
  writeFile(path.join(root, "workspace.config.json"), JSON.stringify({
    workspaceName: "LegacyFixture",
    controllerWindow: "Controller",
    projectLedgerRoot: "wakeflow-ledger",
    repositories: [{ windowName: "RepoA", path: "RepoA", role: "Fixture repo" }],
    hosts: { "claude-code": { maxStreamsPerRepo: 2 } },
  }, null, 2));

  const opened = runSync(process.execPath, [hostScript, "stream-open", "--root", root, "--repo", "RepoA", "--stream", "a", "--demand-key", "LEG-DK", "--no-launch"]);
  assert.equal(opened.status, 0, opened.stderr || opened.stdout);
  // Fresh overlays get the canonical name even when the tracked file is legacy.
  const overlay = path.join(root, ".wakeflow-local/wakeflow.config.json");
  assert.equal(existsSync(overlay), true);
  const parsed = JSON.parse(readFileSync(overlay, "utf8"));
  assert.equal(parsed.derived.from, "workspace.config.json");

  const check = runSync(process.execPath, [hostScript, "check-workspace", "--root", root]);
  const payload = JSON.parse(check.stdout);
  const legacyNote = (payload.gaps ?? []).find((gap) => gap.status === "legacy-name");
  assert.ok(legacyNote, `check-workspace must suggest the rename: ${check.stdout}`);
});
