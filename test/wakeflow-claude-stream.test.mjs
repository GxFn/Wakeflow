#!/usr/bin/env node

import assert from "node:assert/strict";
import * as childProcess from "node:child_process";
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
  for (const name of ["RepoA", "RepoB"]) {
    const repoDir = path.join(root, name);
    mkdirSync(repoDir, { recursive: true });
    runSync("git", ["init", "-q", "-b", "main", repoDir], { encoding: "utf8" });
    writeFileSync(path.join(repoDir, "README.md"), "fixture\n");
    git(repoDir, ["add", "README.md"]);
    git(repoDir, ["commit", "-q", "-m", "init"]);
  }
  writeFileSync(path.join(root, "wakeflow.config.json"), `${JSON.stringify({
    workspaceName: "StreamFixture",
    controllerWindow: "Controller",
    projectLedgerRoot: "wakeflow-ledger",
    repositories: [
      { windowName: "RepoA", path: "RepoA", role: "Fixture repo" },
      { windowName: "RepoB", path: "RepoB", role: "Second fixture repo" },
    ],
    hosts: { "claude-code": { maxStreamsPerRepo } },
  }, null, 2)}\n`);
  return { root, repoDir: path.join(root, "RepoA") };
}

function hostAsync(root, args) {
  return new Promise((resolve) => {
    const { spawn } = childProcess;
    const child = spawn(process.execPath, [hostScript, args[0], "--root", root, ...args.slice(1)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function host(root, args) {
  // claude-host expects the subcommand as the FIRST argv entry.
  return runSync(process.execPath, [hostScript, args[0], "--root", root, ...args.slice(1)], { encoding: "utf8" });
}

function openStream(root, streamId, demandKey = "DK-2026-07-02") {
  return host(root, ["stream-open", "--repo", "RepoA", "--stream", streamId, "--demand-key", demandKey, "--no-launch"]);
}

function overlayFile(root) {
  return path.join(root, ".wakeflow-local/wakeflow.config.json");
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

test("one isolation window per (repo, demand); the pool bounds concurrent demands", () => {
  const { root } = makeWorkspace({ maxStreamsPerRepo: 2 });
  assert.equal(openStream(root, "a").status, 0);

  // same repo + SAME demand = same-demand parallelism, rejected by design:
  // additional items for this repo belong in a combined task package
  const sameDemand = openStream(root, "a2");
  assert.equal(sameDemand.status, 1, sameDemand.stdout);
  assert.match(sameDemand.stderr, /within a demand each repo runs one window/);
  assert.equal(existsSync(path.join(root, ".wakeflow-local/worktrees/RepoA__a2")), false);

  // same repo + DIFFERENT demand = the cross-demand isolation this exists for
  assert.equal(openStream(root, "b", "DK-OTHER-2026-07-02").status, 0);

  // cap bounds how many demands may hold isolation worktrees on one repo
  const third = openStream(root, "c", "DK-THIRD-2026-07-02");
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

test("concurrent stream-opens for DIFFERENT repos both land in the overlay (global mutation lock)", async () => {
  const { root } = makeWorkspace();
  const [a, b] = await Promise.all([
    hostAsync(root, ["stream-open", "--repo", "RepoA", "--stream", "a", "--demand-key", "DK-2026-07-02", "--no-launch"]),
    hostAsync(root, ["stream-open", "--repo", "RepoB", "--stream", "b", "--demand-key", "DK-2026-07-02", "--no-launch"]),
  ]);
  assert.equal(a.status, 0, a.stderr || a.stdout);
  assert.equal(b.status, 0, b.stderr || b.stdout);
  const overlay = readJson(overlayFile(root));
  const streamNames = overlay.repositories.filter((repo) => repo.stream).map((repo) => repo.windowName).sort();
  assert.deepEqual(streamNames, ["RepoA__a", "RepoB__b"], "a cross-repo parallel open must not drop either overlay entry");
});

test("the stream branch name is git-ref-sanitized while the marker keeps the raw demand key", () => {
  const { root } = makeWorkspace();
  const rawKey = "DK 2026:bad?key";
  const result = host(root, ["stream-open", "--repo", "RepoA", "--stream", "a", "--demand-key", rawKey, "--no-launch"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.branch, "DK-2026-bad-key/a");
  const worktree = path.join(root, payload.worktree);
  const head = runSync("git", ["-C", worktree, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" });
  assert.equal(head.stdout.trim(), "DK-2026-bad-key/a");
  const entry = readJson(overlayFile(root)).repositories.find((repo) => repo.windowName === "RepoA__a");
  assert.equal(entry.stream.demandKey, rawKey, "the archive gate matches the RAW key, so the marker must keep it");
});

test("a stream name colliding with a configured repository fails BEFORE creating a worktree", () => {
  const { root } = makeWorkspace();
  const configFile = path.join(root, "wakeflow.config.json");
  const config = readJson(configFile);
  config.repositories.push({ windowName: "RepoA__x", path: "RepoA", role: "Colliding window" });
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);

  const result = host(root, ["stream-open", "--repo", "RepoA", "--stream", "x", "--demand-key", "DK", "--no-launch"]);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /collides with a configured repository/);
  assert.equal(existsSync(path.join(root, ".wakeflow-local/worktrees/RepoA__x")), false, "no orphan worktree may be left behind");
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
  // Open the stream while the demand is still open (stream-open refuses
  // completed/archived demands), THEN flip to completed for the archive gate.
  assert.equal(openStream(root, "a", "ARCH-DK").status, 0);
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  writeFileSync(stateFile, `${JSON.stringify({ ...readJson(stateFile), state: "completed" }, null, 2)}\n`);

  const refused = runSync(process.execPath, [stateScript, "archive-demand", "--root", root, "--state-root", stateRoot, "--reason", "done", "--json"]);
  assert.equal(refused.status, 1, refused.stdout);
  assert.match(JSON.parse(refused.stdout).error, /isolation worktree window\(s\) are still open/);

  assert.equal(host(root, ["stream-close", "--window", "RepoA__a"]).status, 0);
  const dryRun = runSync(process.execPath, [stateScript, "archive-demand", "--root", root, "--state-root", stateRoot, "--reason", "done", "--json"]);
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  assert.equal(JSON.parse(dryRun.stdout).wrote, false);
});

test("stream-open refuses a completed demand and stream-close refuses an in-flight delivery lock", () => {
  const { root } = makeWorkspace();
  const stateScript = path.join(pluginRoot, "scripts/wakeflow-state.mjs");
  const init = runSync(process.execPath, [stateScript, "init", "--root", root, "--demand-key", "DONE-DK", "--title", "T", "--write", "--json"]);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  const stateFile = path.join(root, JSON.parse(init.stdout).stateRoot, "wakeflow-state.json");
  writeFileSync(stateFile, `${JSON.stringify({ ...readJson(stateFile), state: "completed" }, null, 2)}\n`);
  const refusedOpen = openStream(root, "a", "DONE-DK");
  assert.equal(refusedOpen.status, 1, refusedOpen.stdout);
  assert.match(refusedOpen.stderr, /streams attach to open demands only/);

  assert.equal(openStream(root, "b", "LIVE-DK").status, 0);
  mkdirSync(path.join(root, ".wakeflow-local/wakeflow-delivery/locks"), { recursive: true });
  writeFileSync(path.join(root, ".wakeflow-local/wakeflow-delivery/locks/RepoA__b.json"), `${JSON.stringify({
    kind: "WakeflowWindowDeliveryLock", version: 1, windowName: "RepoA__b", host: "claude-code",
    deliveryId: "d1", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(),
  })}\n`);
  const refusedClose = host(root, ["stream-close", "--window", "RepoA__b"]);
  assert.equal(refusedClose.status, 1, refusedClose.stdout);
  assert.match(refusedClose.stderr, /in-flight delivery lock/);
  const forced = host(root, ["stream-close", "--window", "RepoA__b", "--force"]);
  assert.equal(forced.status, 0, forced.stderr || forced.stdout);
});

test("pod lifecycle headless: idempotent open, cross-pod intersection warning, close-order gate, pending-merges ledger", () => {
  const { root } = makeWorkspace();
  const open = host(root, ["pod-open", "--demand-key", "POD-A", "--repos", "RepoA,RepoB", "--no-launch"]);
  assert.equal(open.status, 0, open.stderr || open.stdout);
  const payload = JSON.parse(open.stdout);
  assert.deepEqual(payload.windows.map((w) => w.status), ["opened", "opened"]);
  assert.equal(payload.intersections.length, 0);
  assert.equal(existsSync(path.join(root, ".wakeflow-local/worktrees/RepoA__POD-A")), true);

  // Entry prompts are prepared even under --no-launch, and both bind the pod
  // to the demand's ONE shared worktree set (Test verifies there, never on a
  // main checkout).
  const podHostDir = path.join(root, ".wakeflow-local/wakeflow-delivery/hosts/claude-code");
  const controllerPrompt = readFileSync(path.join(podHostDir, "pod-entry-POD-A.txt"), "utf8");
  assert.match(controllerPrompt, /ONE worktree set/);
  assert.match(controllerPrompt, /Test included/);
  const testPrompt = readFileSync(path.join(podHostDir, "pod-entry-POD-A-test.txt"), "utf8");
  assert.match(testPrompt, /Test__POD-A/);
  assert.match(testPrompt, /\.wakeflow-local\/worktrees\/RepoA__POD-A/);
  assert.match(testPrompt, /never against a repository's main checkout/);

  // idempotent resume: nothing re-created, nothing failed
  const rerun = JSON.parse(host(root, ["pod-open", "--demand-key", "POD-A", "--repos", "RepoA,RepoB", "--no-launch"]).stdout);
  assert.deepEqual(rerun.windows.map((w) => w.status), ["already-registered", "already-registered"]);

  // second pod touching RepoA gets the merge-conflict foresight note
  const podB = JSON.parse(host(root, ["pod-open", "--demand-key", "POD-B", "--repos", "RepoA", "--no-launch"]).stdout);
  assert.equal(podB.intersections.length, 1);
  assert.equal(podB.intersections[0].occupiedBy, "POD-A");

  // close order: an unarchived (open) demand refuses pod-close without --force
  const stateDir = path.join(root, ".wakeflow-active/current/POD-A");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(path.join(stateDir, "wakeflow-state.json"), `${JSON.stringify({ demandKey: "POD-A", state: "planned" }, null, 2)}\n`);
  const refused = host(root, ["pod-close", "--demand-key", "POD-A"]);
  assert.equal(refused.status, 1, refused.stdout);
  assert.match(refused.stderr, /Close order: complete-demand/);

  // forced close sweeps leftovers and records every surviving branch
  const closed = JSON.parse(host(root, ["pod-close", "--demand-key", "POD-A", "--force"]).stdout);
  assert.equal(closed.closedIsolationWindows.length, 2);
  const ledger = readFileSync(path.join(root, "wakeflow-ledger/workspace/pending-merges.md"), "utf8");
  assert.match(ledger, /POD-A \| RepoA \| POD-A\/pod/);
  assert.match(ledger, /POD-A \| RepoB \| POD-A\/pod/);

  const list = JSON.parse(host(root, ["pod-list"]).stdout);
  assert.deepEqual(list.pods.map((p) => p.demandKey), ["POD-B"], "closed pod must disappear from the inventory");
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
  const configFile = path.join(root, "wakeflow.config.json");
  const config = readJson(configFile);
  config.workspaceName = "Renamed";
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  const after = JSON.parse(host(root, ["stream-list"]).stdout);
  assert.equal(after.overlayStale, true);
});
