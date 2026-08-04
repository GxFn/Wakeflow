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
  assert.equal(config.schemaVersion, 2, "the effective in-memory config uses the current contract");
});

test("workspace config v2 is compact on disk, derives the effective view, and rejects a future schema", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-config-v2-"));
  const {
    loadWorkspaceConfig,
    WAKEFLOW_CONFIG_SCHEMA_URL,
    workspaceConfigV2FromEffective,
  } = await import("../core/scripts/lib/wakeflow-config.mjs");
  writeFile(path.join(root, "wakeflow.config.json"), JSON.stringify({
    $schema: WAKEFLOW_CONFIG_SCHEMA_URL,
    schemaVersion: 2,
    workspace: {
      name: "V2",
      language: "zh",
      runtimeMode: "plugin",
      root: ".",
      wakeflowRepoDir: "",
    },
    roles: { controller: "V2", design: "Design", test: "Test" },
    storage: {
      activeRoot: ".wakeflow-active-v2",
      localRoot: ".wakeflow-local",
      ledgerRoot: "ledger-v2",
    },
    repositories: [
      { windowName: "App", path: "App", role: "Product" },
      { windowName: "Design", path: "Design", mode: "internal" },
      { windowName: "Test", path: "Test", mode: "internal" },
    ],
    hosts: {},
  }, null, 2));
  const current = loadWorkspaceConfig({ workspaceRoot: root, args: [] });
  assert.equal(current.schemaVersion, 2);
  assert.equal(current.workspaceName, "V2");
  assert.equal(current.workspaceCurrentDir, ".wakeflow-active-v2/current");
  assert.equal(current.requirementDesignsDir, "ledger-v2/requirement-designs");
  assert.deepEqual(current.dispatchWindows, ["App", "Test"]);
  assert.deepEqual(current.repoNames, ["App"]);
  assert.equal(current.configSourceShape, "nested-v2");
  assert.equal(current.configMigrationWarnings.length, 0);

  const durable = workspaceConfigV2FromEffective(current);
  assert.deepEqual(Object.keys(durable), [
    "$schema", "schemaVersion", "workspace", "roles", "storage", "policy", "repositories", "hosts",
  ]);
  assert.equal(durable.workspace.name, "V2");
  assert.equal(durable.dispatchWindows, undefined);
  assert.equal(durable.repositoryRoles, undefined);
  assert.equal(durable.storage.paths, undefined, "standard leaf paths stay derived from their roots");

  writeFile(path.join(root, "wakeflow.config.json"), JSON.stringify({
    ...durable,
    dispatchWindows: ["invented-v2-duplicate"],
  }, null, 2));
  assert.throws(
    () => loadWorkspaceConfig({ workspaceRoot: root, args: [] }),
    /unsupported field.*dispatchWindows/,
  );

  writeFile(path.join(root, "wakeflow.config.json"), JSON.stringify({ schemaVersion: 99 }, null, 2));
  assert.throws(
    () => loadWorkspaceConfig({ workspaceRoot: root, args: [] }),
    /schemaVersion 99 is not supported/,
  );
});

test("Codex and Claude Code derive byte-stable effective layout from the same v2 input", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-config-dual-host-"));
  writeFile(path.join(root, "wakeflow.config.json"), JSON.stringify({
    $schema: "https://raw.githubusercontent.com/GxFn/Wakeflow/main/core/schemas/wakeflow-config.schema.json",
    schemaVersion: 2,
    workspace: {
      name: "DualHost",
      language: "auto",
      runtimeMode: "plugin",
      root: ".",
      wakeflowRepoDir: "",
    },
    roles: { controller: "DualHost", design: "Design", test: "Test" },
    storage: {
      activeRoot: ".wakeflow-active",
      localRoot: ".wakeflow-local",
      ledgerRoot: "wakeflow-ledger",
    },
    repositories: [{ windowName: "App", path: "App", role: "Product" }],
    hosts: { codex: {}, "claude-code": {} },
  }, null, 2));
  const codex = await import("../plugins/codex-wakeflow/scripts/lib/wakeflow-config.mjs");
  const claude = await import("../plugins/claude-code-wakeflow/scripts/lib/wakeflow-config.mjs");
  const codexView = codex.workspaceConfigDiagnostics({ workspaceRoot: root, args: [] });
  const claudeView = claude.workspaceConfigDiagnostics({ workspaceRoot: root, args: [] });
  assert.equal(JSON.stringify(codexView), JSON.stringify(claudeView));
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
  assert.equal(config.configSourceShape, "legacy-flat");
  assert.match(config.configMigrationWarnings.join("\n"), /legacy flat Wakeflow config/);
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
