import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  handlers as claudeHandlers,
  tools as claudeTools,
} from "../plugins/claude-code-wakeflow/lib/wakeflow-mcp-tools.mjs";
import {
  handlers as codexHandlers,
  tools as codexTools,
} from "../plugins/codex-wakeflow/lib/wakeflow-mcp-tools.mjs";
import { hostProfile as claudeProfile } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import { hostProfile as codexProfile } from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const claudeRoot = path.join(repositoryRoot, "plugins/claude-code-wakeflow");
const codexRoot = path.join(repositoryRoot, "plugins/codex-wakeflow");

test("both hosts expose the same exact public v3 MCP surface", () => {
  const codexNames = codexTools.map((tool) => tool.name);
  const claudeNames = claudeTools.map((tool) => tool.name);
  assert.equal(codexNames.length, 31);
  assert.deepEqual(claudeNames, codexNames);
  assert.deepEqual(Object.keys(codexHandlers), codexNames);
  assert.deepEqual(Object.keys(claudeHandlers), claudeNames);
  for (const retired of [
    "wakeflow_adopt_demand_host",
    "wakeflow_initialize_workspace",
    "wakeflow_seed_readmes",
    "wakeflow_update_progress",
  ]) {
    assert.equal(codexNames.includes(retired), false);
    assert.equal(claudeNames.includes(retired), false);
    assert.equal(codexHandlers[retired], undefined);
    assert.equal(claudeHandlers[retired], undefined);
  }
});

test("Claude declares a thin facade and lifecycle owner while Codex stays on native host tools", () => {
  assert.equal(claudeProfile.hostId, "claude-code");
  assert.equal(claudeProfile.artifact.facadeHostFile, "scripts/lib/wakeflow-claude-host.mjs");
  assert.equal(claudeProfile.artifact.lifecycleHostFile, "scripts/lib/wakeflow-claude-lifecycle.mjs");
  assert.equal(claudeProfile.hostTools.createWindow, "wakeflow-claude-host launch-window");
  assert.deepEqual(Object.keys(claudeProfile.hostTools), ["createWindow"]);
  assert.equal(codexProfile.artifact.facadeHostFile, undefined);
  assert.equal(codexProfile.artifact.lifecycleHostFile, undefined);
  assert.deepEqual(codexProfile.hostTools, {
    createWindow: "create_thread",
  });
});

test("host capability differences stay explicit instead of recreating profile legacy fields", () => {
  assert.equal(claudeProfile.capabilities.locator.realization, "current");
  assert.equal(claudeProfile.capabilities.settings.realization, "current");
  assert.equal(claudeProfile.capabilities.activity.realization, "current");
  assert.equal(claudeProfile.capabilities.close.realization, "current");
  assert.equal(codexProfile.capabilities.locator.realization, "not-applicable");
  assert.equal(codexProfile.capabilities.settings.realization, "not-applicable");
  assert.equal(codexProfile.capabilities.close.realization, "manual-gate");
  for (const profile of [claudeProfile, codexProfile]) {
    assert.equal(profile.kinds, undefined);
    assert.equal(profile.texts, undefined);
    assert.equal(profile.launch?.entryExtras, undefined);
    assert.equal(profile.pod?.entryExtras, undefined);
  }
});

test("Claude current host files are packaged without the retired mixed adapters", () => {
  for (const relativePath of [
    claudeProfile.artifact.facadeHostFile,
    claudeProfile.artifact.lifecycleHostFile,
    claudeProfile.artifact.locatorHostFile,
    claudeProfile.artifact.transportHostFile,
    claudeProfile.artifact.settingsAssetsHostFile,
    claudeProfile.artifact.activityHostFile,
  ]) assert.equal(existsSync(path.join(claudeRoot, relativePath)), true, relativePath);

  for (const root of [claudeRoot, codexRoot]) {
    for (const retired of [
      "scripts/lib/wakeflow-host-send-adapter.mjs",
      "scripts/lib/wakeflow-stream-overlay.mjs",
      "scripts/lib/wakeflow-pod-runtime.mjs",
      "scripts/lib/wakeflow-window-runtime.mjs",
    ]) assert.equal(existsSync(path.join(root, retired)), false, `${root}/${retired}`);
  }

  const facade = readFileSync(path.join(claudeRoot, claudeProfile.artifact.facadeHostFile), "utf8");
  assert.doesNotMatch(facade, /stream-(?:open|close|list)|window-host|runtime-meta|git worktree remove/iu);
});
