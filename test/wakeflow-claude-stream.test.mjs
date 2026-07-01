#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Dev-only test harness: git/node run via plain spawnSync here (no shell); the
// wakeflow-process whitelist guards runtime scripts, not this test file.
function runSync(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", shell: false, ...options });
}

// Guards W1-a/W1-b (next-phase roadmap Phase 1): stream = ordinary window
// `<repo>__<streamId>` + dedicated worktree on branch `<demandKey>/<streamId>`,
// registered ONLY via the derived local config overlay that every core resolver
// already prefers. Pool cap blocks (never widens), dirty/unmerged teardown
// refuses, and a hand-maintained local override is never overwritten.

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/claude-code-wakeflow");
const hostScript = path.join(pluginRoot, "scripts/lib/wakeflow-claude-host.mjs");
const deliveryScript = path.join(pluginRoot, "scripts/wakeflow-delivery.mjs");

function git(cwd, args) {
  const result = runSync("git", ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr || result.stdout}`);
  return result;
}

function makeWorkspace({ maxStreamsPerRepo = 2 } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stream-"));
  const repoDir = path.join(root, "RepoA");
  mkdirSync(repoDir, { recursive: true });
  runSync("git", ["init", "-q", "-b", "main", repoDir], { encoding: "utf8" });
  writeFileSync(path.join(repoDir, "README.md"), "fixture\n");
  git(repoDir, ["add", "README.md"]);
  git(repoDir, ["commit", "-q", "-m", "init"]);
  writeFileSync(path.join(root, "workspace.config.json"), `${JSON.stringify({
    workspaceName: "StreamFixture",
    controllerWindow: "Controller",
    repositories: [{ windowName: "RepoA", path: "RepoA", role: "Fixture repo" }],
    hosts: { "claude-code": { maxStreamsPerRepo } },
  }, null, 2)}\n`);
  return { root, repoDir };
}

function host(root, args) {
  // claude-host expects the subcommand as the FIRST argv entry.
  return runSync(process.execPath, [hostScript, args[0], "--root", root, ...args.slice(1)], { encoding: "utf8" });
}

function openStream(root, streamId, demandKey = "DK-2026-07-02") {
  return host(root, ["stream-open", "--repo", "RepoA", "--stream", streamId, "--demand-key", demandKey, "--no-launch"]);
}

function overlayFile(root) {
  return path.join(root, ".wakeflow-local/workspace.config.json");
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

test("stream-open creates worktree + branch and registers via the derived overlay", () => {
  const { root } = makeWorkspace();
  const result = openStream(root, "a");
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.windowName, "RepoA__a");
  assert.equal(payload.branch, "DK-2026-07-02/a");

  const worktree = path.join(root, payload.worktree);
  assert.equal(existsSync(worktree), true);
  const head = runSync("git", ["-C", worktree, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" });
  assert.equal(head.stdout.trim(), "DK-2026-07-02/a");

  const overlay = readJson(overlayFile(root));
  assert.equal(overlay.derived.kind, "WakeflowLocalConfigOverlay");
  assert.equal(typeof overlay.derived.baseHash, "string");
  const entry = overlay.repositories.find((repo) => repo.windowName === "RepoA__a");
  assert.equal(entry.managedAgents, false);
  assert.equal(entry.stream.repo, "RepoA");
  assert.equal(entry.stream.branch, "DK-2026-07-02/a");
});

test("core window resolution sees the stream window through the overlay", () => {
  const { root } = makeWorkspace();
  assert.equal(openStream(root, "a").status, 0);
  const result = runSync(process.execPath, [deliveryScript, "build-window-config", "--root", root, "--window", "RepoA__a", "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.config.windowName, "RepoA__a");
  assert.match(String(payload.config.repositoryPath ?? payload.config.cwd), /\.wakeflow-local\/worktrees\/RepoA__a/);
});

test("the stream pool blocks at maxStreams instead of opening more windows", () => {
  const { root } = makeWorkspace({ maxStreamsPerRepo: 2 });
  assert.equal(openStream(root, "a").status, 0);
  assert.equal(openStream(root, "b").status, 0);
  const third = openStream(root, "c");
  assert.equal(third.status, 1, third.stdout);
  const payload = JSON.parse(third.stdout);
  assert.equal(payload.code, "pool-exhausted");
  assert.deepEqual(payload.activeStreams.sort(), ["RepoA__a", "RepoA__b"]);
  assert.equal(existsSync(path.join(root, ".wakeflow-local/worktrees/RepoA__c")), false);
});

test("stream-close refuses a dirty worktree, then --force discards and deregisters", () => {
  const { root } = makeWorkspace();
  assert.equal(openStream(root, "a").status, 0);
  const worktree = path.join(root, ".wakeflow-local/worktrees/RepoA__a");
  writeFileSync(path.join(worktree, "wip.txt"), "uncommitted\n");

  const refused = host(root, ["stream-close", "--window", "RepoA__a"]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /uncommitted changes/);
  assert.equal(existsSync(worktree), true, "refused close must not touch the worktree");

  const forced = host(root, ["stream-close", "--window", "RepoA__a", "--force"]);
  assert.equal(forced.status, 0, forced.stderr || forced.stdout);
  assert.equal(existsSync(worktree), false);
  assert.equal(existsSync(overlayFile(root)), false, "overlay is removed when the last stream closes");
});

test("--delete-branch refuses an unmerged branch and close without it still deregisters", () => {
  const { root } = makeWorkspace();
  assert.equal(openStream(root, "a").status, 0);
  const worktree = path.join(root, ".wakeflow-local/worktrees/RepoA__a");
  writeFileSync(path.join(worktree, "work.txt"), "delivered\n");
  git(worktree, ["add", "work.txt"]);
  git(worktree, ["commit", "-q", "-m", "stream work"]);

  const refused = host(root, ["stream-close", "--window", "RepoA__a", "--delete-branch"]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /branch -d/);

  const closed = host(root, ["stream-close", "--window", "RepoA__a"]);
  assert.equal(closed.status, 0, closed.stderr || closed.stdout);
  const branches = runSync("git", ["-C", path.join(root, "RepoA"), "branch", "--list", "DK-2026-07-02/a"], { encoding: "utf8" });
  assert.match(branches.stdout, /DK-2026-07-02\/a/, "unmerged branch must survive a plain close");
});

test("a hand-maintained local config override blocks stream registration fail-closed", () => {
  const { root } = makeWorkspace();
  mkdirSync(path.join(root, ".wakeflow-local"), { recursive: true });
  writeFileSync(overlayFile(root), `${JSON.stringify({ controllerWindow: "Custom" }, null, 2)}\n`);
  const result = openStream(root, "a");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /hand-maintained/);
  const untouched = readJson(overlayFile(root));
  assert.equal(untouched.controllerWindow, "Custom", "user override must never be overwritten");
});

test("window-status exposes activity-monitor ownership (H-7) and set-unattended regenerates the overlay (H-8)", () => {
  const { root } = makeWorkspace();
  assert.equal(openStream(root, "a").status, 0);

  const status = JSON.parse(host(root, ["window-status"]).stdout);
  assert.equal(status.activityMonitor.root, root, "monitor ownership must name its workspace root");
  assert.equal(status.activityMonitor.running, false);
  assert.match(status.activityMonitor.cleanupRule, /--root/);

  // tracked-config write must not leave the derived overlay stale
  const changed = JSON.parse(host(root, ["set-unattended", "--mode", "bypassPermissions", "--write"]).stdout);
  assert.equal(changed.overlayRegenerated, true);
  const after = JSON.parse(host(root, ["stream-list"]).stdout);
  assert.equal(after.overlayStale, false, "overlay must be regenerated from the freshly written base");
  assert.equal(after.streams.length, 1, "stream registration must survive the regeneration");
  const overlay = readJson(overlayFile(root));
  assert.equal(overlay.hosts["claude-code"].permissionMode, "bypassPermissions", "overlay must carry the new base value");
});

test("archive-demand refuses while the demand's streams are open (PD-4 gate)", () => {
  const { root } = makeWorkspace();
  const stateScript = path.join(pluginRoot, "scripts/wakeflow-state.mjs");
  const init = runSync(process.execPath, [stateScript, "init", "--root", root, "--demand-key", "ARCH-DK", "--title", "Archive Gate Fixture", "--write", "--json"]);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  const stateRoot = path.join(root, JSON.parse(init.stdout).stateRoot);
  // Test shortcut: archive requires state=completed; flip the snapshot directly
  // instead of replaying the whole accept flow (covered by state-machine tests).
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  writeFileSync(stateFile, `${JSON.stringify({ ...readJson(stateFile), state: "completed" }, null, 2)}\n`);

  assert.equal(openStream(root, "a", "ARCH-DK").status, 0);
  const refused = runSync(process.execPath, [stateScript, "archive-demand", "--root", root, "--state-root", stateRoot, "--reason", "done", "--json"]);
  assert.equal(refused.status, 1, refused.stdout);
  assert.match(JSON.parse(refused.stdout).error, /stream window\(s\) are still open/);

  assert.equal(host(root, ["stream-close", "--window", "RepoA__a"]).status, 0);
  const dryRun = runSync(process.execPath, [stateScript, "archive-demand", "--root", root, "--state-root", stateRoot, "--reason", "done", "--json"]);
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  assert.equal(JSON.parse(dryRun.stdout).wrote, false);
});

test("stream-list reconciles overlay, worktree, and registration state", () => {
  const { root } = makeWorkspace();
  assert.equal(openStream(root, "a").status, 0);
  const result = host(root, ["stream-list"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.overlayStale, false);
  assert.equal(payload.streams.length, 1);
  const row = payload.streams[0];
  assert.equal(row.window, "RepoA__a");
  assert.equal(row.worktreePresent, true);
  assert.equal(row.status, "prepared", "no-launch stream has no registration yet");

  // base config edit -> overlay flagged stale
  const configFile = path.join(root, "workspace.config.json");
  const config = readJson(configFile);
  config.workspaceName = "Renamed";
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  const after = JSON.parse(host(root, ["stream-list"]).stdout);
  assert.equal(after.overlayStale, true);
});
