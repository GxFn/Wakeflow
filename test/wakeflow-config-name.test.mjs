#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// wakeflow.config.json is the canonical config name; the legacy
// workspace.config.json keeps resolving READ-side so pre-rename workspaces
// never break. These tests pin that contract on both the tracked file and the
// explicit local-config safety boundary without treating a Pod binding as config.

const claudePluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/claude-code-wakeflow");
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

test("legacy tracked workspace.config.json still resolves while capacity fields become warnings", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-legacy-config-"));
  writeFile(path.join(root, "workspace.config.json"), JSON.stringify({
    workspaceName: "Legacy name",
    maxActiveDemands: 1,
  }, null, 2));
  const { loadWorkspaceConfig } = await import("../core/scripts/lib/wakeflow-config.mjs");
  const config = loadWorkspaceConfig({ workspaceRoot: root, args: [] });
  assert.equal(config.workspaceName, "Legacy name");
  assert.equal(config.maxActiveDemands, undefined);
  assert.match(config.configMigrationWarnings.join("\n"), /maxActiveDemands.*no admission effect/);
});

test("wakeflow.config.json wins over a coexisting legacy file without reviving capacity admission", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-config-pref-"));
  writeFile(path.join(root, "workspace.config.json"), JSON.stringify({
    workspaceName: "Legacy",
    maxActiveDemands: 1,
  }, null, 2));
  writeFile(path.join(root, "wakeflow.config.json"), JSON.stringify({
    workspaceName: "Canonical",
    maxActiveDemands: 7,
  }, null, 2));
  const { loadWorkspaceConfig } = await import("../core/scripts/lib/wakeflow-config.mjs");
  const config = loadWorkspaceConfig({ workspaceRoot: root, args: [] });
  assert.equal(config.workspaceName, "Canonical");
  assert.equal(config.maxActiveDemands, undefined);
  assert.match(config.configMigrationWarnings.join("\n"), /maxActiveDemands.*no admission effect/);
});

test("legacy host and repository stream limits are observation-only migration warnings", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-config-stream-limits-"));
  writeFile(path.join(root, "wakeflow.config.json"), JSON.stringify({
    hosts: {
      codex: { maxStreamsPerRepo: 1, launcher: "host-managed" },
    },
    repositories: [{
      windowName: "RepoA",
      path: "RepoA",
      role: "Fixture",
      maxStreams: 1,
    }],
  }, null, 2));
  const { loadWorkspaceConfig } = await import("../core/scripts/lib/wakeflow-config.mjs");
  const config = loadWorkspaceConfig({ workspaceRoot: root, args: [] });
  assert.equal(config.hosts.codex.maxStreamsPerRepo, undefined);
  assert.equal(config.hosts.codex.launcher, "host-managed");
  assert.equal(config.repositories[0].maxStreams, undefined);
  assert.match(config.configMigrationWarnings.join("\n"), /maxStreamsPerRepo.*no admission effect/);
  assert.match(config.configMigrationWarnings.join("\n"), /repositories\.RepoA\.maxStreams.*no admission effect/);
});

test("check-workspace recognizes a legacy config name and recommends the canonical rename", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-legacy-name-check-"));
  const repoDir = path.join(root, "RepoA");
  mkdirSync(repoDir, { recursive: true });
  makeBoardFixture(root);
  writeFile(path.join(root, "workspace.config.json"), JSON.stringify({
    workspaceName: "LegacyFixture",
    controllerWindow: "Controller",
    projectLedgerRoot: "wakeflow-ledger",
    repositories: [{ windowName: "RepoA", path: "RepoA", role: "Fixture repo" }],
  }, null, 2));

  const check = runSync(process.execPath, [hostScript, "check-workspace", "--root", root]);
  assert.equal(check.status, 0, check.stderr || check.stdout);
  const payload = JSON.parse(check.stdout);
  const legacyNote = (payload.gaps ?? []).find((gap) => gap.status === "legacy-name");
  assert.ok(legacyNote, `check-workspace must suggest the rename: ${check.stdout}`);
});

// Reduction wave W2: the window-list views are DERIVED from repositories[]
// at load time — the tracked config keeps one fact (repositories) and the
// loader produces the four views setup used to persist. Explicit values in
// legacy configs still win.
test("loader derives the window-list views from repositories[]", async () => {
  const { loadWorkspaceConfig } = await import("../core/scripts/lib/wakeflow-config.mjs");
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-derive-"));
  writeFileSync(path.join(root, "wakeflow.config.json"), JSON.stringify({
    workspaceName: "Derive",
    controllerWindow: "Ctl",
    designWindow: "Design",
    testWindow: "Test",
    repositories: [
      { windowName: "RepoA", path: "RepoA", role: "App repo" },
      { windowName: "RepoB", path: "RepoB", role: "Lib repo" },
      { windowName: "Design", path: "Design", role: "Design surface", mode: "internal" },
      { windowName: "Test", path: "Test", role: "Test surface", mode: "internal" },
    ],
  }));
  const config = loadWorkspaceConfig({ workspaceRoot: root, args: [] });
  assert.deepEqual(config.repoNames, ["RepoA", "RepoB"]);
  assert.deepEqual(config.dispatchWindows, ["RepoA", "RepoB", "Test"]);
  assert.deepEqual(config.requiredDispatchWindows, ["RepoA", "RepoB", "Design", "Test"]);
  assert.equal(config.repositoryRoles.RepoA, "App repo");
  assert.equal(config.repositoryRoles.Test, "Test surface");

  // Explicit legacy values still win over derivation.
  writeFileSync(path.join(root, "wakeflow.config.json"), JSON.stringify({
    workspaceName: "Derive",
    controllerWindow: "Ctl",
    designWindow: "Design",
    testWindow: "Test",
    repoNames: ["OnlyA"],
    repositories: [{ windowName: "RepoA", path: "RepoA", role: "App repo" }],
  }));
  const explicit = loadWorkspaceConfig({ workspaceRoot: root, args: [] });
  assert.deepEqual(explicit.repoNames, ["OnlyA"]);
});

test("automatic config reads reject a hand-written local override while explicit and durable reads stay independent", async () => {
  const {
    loadDurableWorkspaceConfig,
    loadWorkspaceConfig,
  } = await import("../core/scripts/lib/wakeflow-config.mjs");
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-config-layers-"));
  writeFileSync(path.join(root, "wakeflow.config.json"), JSON.stringify({
    workspaceName: "Durable",
  }));
  const local = path.join(root, ".wakeflow-local/wakeflow.config.json");
  writeFile(local, JSON.stringify({ workspaceName: "Explicit local override" }));
  assert.throws(
    () => loadWorkspaceConfig({ workspaceRoot: root, args: [] }),
    /move durable settings|explicit --config/i,
  );
  const explicit = loadWorkspaceConfig({ workspaceRoot: root, args: ["--config", local] });
  assert.equal(explicit.workspaceName, "Explicit local override");
  const durable = loadDurableWorkspaceConfig({ workspaceRoot: root, args: [] });
  assert.equal(durable.workspaceName, "Durable");
});
