// Host-neutral demand pods (wakeflow-pod.mjs): the unified multi-demand model.
// One demand = one pod (own controller + own Test + one isolation worktree
// window per repo), the WHOLE pod sharing the demand's ONE worktree set;
// parallelism exists only at the demand level. The codex edition realizes the
// windowPlan with agent tools (create_thread cwd=worktree); the claude edition
// defers transport to wakeflow-claude-host (fleet.transport: host-helper).

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

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const codexPod = path.join(repoRoot, "plugins/codex-wakeflow/scripts/wakeflow-pod.mjs");
const claudePod = path.join(repoRoot, "plugins/claude-code-wakeflow/scripts/wakeflow-pod.mjs");

function git(cwd, args) {
  const result = runSync("git", ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr || result.stdout}`);
  return result;
}

function makeWorkspace({ maxStreamsPerRepo = 2 } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-pod-"));
  for (const name of ["RepoA", "RepoB"]) {
    const repoDir = path.join(root, name);
    mkdirSync(repoDir, { recursive: true });
    runSync("git", ["init", "-q", "-b", "main", repoDir], { encoding: "utf8" });
    writeFileSync(path.join(repoDir, "README.md"), "fixture\n");
    git(repoDir, ["add", "README.md"]);
    git(repoDir, ["commit", "-q", "-m", "init"]);
  }
  writeFileSync(path.join(root, "wakeflow.config.json"), `${JSON.stringify({
    workspaceName: "PodFixture",
    controllerWindow: "Controller",
    projectLedgerRoot: "wakeflow-ledger",
    internalTestPath: "wakeflow-ledger/testing",
    repositories: [
      { windowName: "RepoA", path: "RepoA", role: "Fixture repo" },
      { windowName: "RepoB", path: "RepoB", role: "Second fixture repo" },
    ],
    hosts: { codex: { maxStreamsPerRepo }, "claude-code": { maxStreamsPerRepo } },
  }, null, 2)}\n`);
  return { root };
}

function pod(script, root, args) {
  return runSync(process.execPath, [script, args[0], "--root", root, ...args.slice(1), "--json"], { encoding: "utf8" });
}

function setDemandState(root, demandKey, state) {
  const stateDir = path.join(root, ".wakeflow-active/current", demandKey);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(path.join(stateDir, "wakeflow-state.json"), `${JSON.stringify({ demandKey, state }, null, 2)}\n`);
}

test("codex pod open prepares the shared worktree set and an agent-tools window plan", () => {
  const { root } = makeWorkspace();
  const open = pod(codexPod, root, ["open", "--demand-key", "POD-A", "--repos", "RepoA,RepoB"]);
  assert.equal(open.status, 0, open.stderr || open.stdout);
  const payload = JSON.parse(open.stdout);
  assert.equal(payload.transport, "agent-tools");
  assert.deepEqual(payload.workWindows.map((win) => win.status), ["opened", "opened"]);
  assert.equal(existsSync(path.join(root, ".wakeflow-local/worktrees/RepoA__POD-A")), true);
  assert.equal(existsSync(path.join(root, ".wakeflow-local/wakeflow.config.json")), true);

  // The plan covers the whole pod: one window per repo + controller + test,
  // every entry carrying a create_thread prompt and a registration template.
  assert.deepEqual(payload.windowPlan.map((entry) => entry.role), ["work", "work", "controller", "test"]);
  for (const entry of payload.windowPlan) {
    assert.equal(entry.createWindowTool, "create_thread");
    assert.equal(entry.localRegistration.tool, "wakeflow_register_window");
    assert.equal(entry.localRegistration.args.windowHandle, "<create_thread.threadId>",
      "registration template carries the host-specific handle placeholder");
    assert.ok(entry.createThreadPrompt.length > 0, `${entry.windowName} carries a prompt`);
  }
  const work = payload.windowPlan[0];
  assert.equal(work.cwd, ".wakeflow-local/worktrees/RepoA__POD-A");
  assert.match(work.createThreadPrompt, /ONE window for this repository/);
  assert.match(work.createThreadPrompt, /ONE combined task package/);
  const controller = payload.windowPlan.find((entry) => entry.role === "controller");
  assert.match(controller.createThreadPrompt, /ONE worktree set/);
  assert.match(controller.createThreadPrompt, /Test included/);
  assert.match(controller.createThreadPrompt, /wakeflow_pod_close/);
  const testEntry = payload.windowPlan.find((entry) => entry.role === "test");
  assert.match(testEntry.createThreadPrompt, /\.wakeflow-local\/worktrees\/RepoA__POD-A/);
  assert.match(testEntry.createThreadPrompt, /never against a repository's main checkout/);
  assert.match(payload.agentNext, /create_thread/);

  // Idempotent resume: nothing re-created, nothing failed.
  const rerun = JSON.parse(pod(codexPod, root, ["open", "--demand-key", "POD-A", "--repos", "RepoA,RepoB"]).stdout);
  assert.deepEqual(rerun.workWindows.map((win) => win.status), ["already-registered", "already-registered"]);
});

test("pod open consumes persisted placement and refuses a main demand", () => {
  const mainWorkspace = makeWorkspace();
  setDemandState(mainWorkspace.root, "MAIN-A", "planned");
  const refused = pod(codexPod, mainWorkspace.root, ["open", "--demand-key", "MAIN-A", "--repos", "RepoA"]);
  assert.equal(refused.status, 1);
  assert.match(JSON.parse(refused.stderr).error, /assigned to main placement/);
  assert.equal(existsSync(path.join(mainWorkspace.root, ".wakeflow-local/worktrees/RepoA__MAIN-A")), false);

  const isolatedWorkspace = makeWorkspace();
  const stateDir = path.join(isolatedWorkspace.root, ".wakeflow-active/current/ISO-A");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(path.join(stateDir, "wakeflow-state.json"), `${JSON.stringify({
    demandKey: "ISO-A",
    state: "planned",
    controllerWindow: "Controller__ISO-A",
    executionPlacement: { mode: "isolated", podId: "ISO-A" },
  }, null, 2)}\n`);
  const opened = pod(codexPod, isolatedWorkspace.root, ["open", "--demand-key", "ISO-A", "--repos", "RepoA"]);
  assert.equal(opened.status, 0, opened.stderr || opened.stdout);
  assert.equal(JSON.parse(opened.stdout).workWindows[0].status, "opened");
});

test("within a demand a repo never gets a second window; the pool caps demands per repo", () => {
  const { root } = makeWorkspace({ maxStreamsPerRepo: 2 });
  assert.equal(pod(codexPod, root, ["open", "--demand-key", "POD-A", "--repos", "RepoA"]).status, 0);

  // Cross-pod intersection is foresight, not refusal.
  const podB = JSON.parse(pod(codexPod, root, ["open", "--demand-key", "POD-B", "--repos", "RepoA"]).stdout);
  assert.equal(podB.intersections.length, 1);
  assert.equal(podB.intersections[0].occupiedBy, "POD-A");

  // Third demand on the same repo: pool-exhausted hard block.
  const podC = pod(codexPod, root, ["open", "--demand-key", "POD-C", "--repos", "RepoA"]);
  assert.equal(podC.status, 1);
  const blocked = JSON.parse(podC.stdout);
  assert.equal(blocked.code, "pool-exhausted");
  assert.equal(blocked.maxStreams, 2);
});

test("pod close gates on completion, respects dirty worktrees, and records pending merges", () => {
  const { root } = makeWorkspace();
  assert.equal(pod(codexPod, root, ["open", "--demand-key", "POD-A", "--repos", "RepoA,RepoB"]).status, 0);

  // Close order: an open (not completed) demand refuses without --force.
  setDemandState(root, "POD-A", "planned");
  const early = pod(codexPod, root, ["close", "--demand-key", "POD-A"]);
  assert.equal(early.status, 1);
  assert.match(JSON.parse(early.stderr).error, /Close order: complete-demand/);

  // Evidence-first: a dirty worktree refuses teardown without --force.
  setDemandState(root, "POD-A", "completed");
  writeFileSync(path.join(root, ".wakeflow-local/worktrees/RepoA__POD-A/dirty.txt"), "evidence\n");
  const dirty = pod(codexPod, root, ["close", "--demand-key", "POD-A"]);
  assert.equal(dirty.status, 1);
  assert.match(JSON.parse(dirty.stderr).error, /uncommitted changes/);

  // Committed work closes cleanly; surviving branches land on the ledger.
  git(path.join(root, ".wakeflow-local/worktrees/RepoA__POD-A"), ["add", "dirty.txt"]);
  git(path.join(root, ".wakeflow-local/worktrees/RepoA__POD-A"), ["commit", "-q", "-m", "evidence"]);
  const closed = JSON.parse(pod(codexPod, root, ["close", "--demand-key", "POD-A"]).stdout);
  assert.equal(closed.closedIsolationWindows.length, 2);
  const ledger = readFileSync(path.join(root, "wakeflow-ledger/workspace/pending-merges.md"), "utf8");
  assert.match(ledger, /POD-A \| RepoA \| POD-A\/pod/);
  assert.match(ledger, /POD-A \| RepoB \| POD-A\/pod/);
  assert.equal(existsSync(path.join(root, ".wakeflow-local/worktrees/RepoA__POD-A")), false);
  assert.match(closed.agentNext, /archive the demand now/);

  // The overlay dropped back to the base config (no streams left).
  assert.equal(existsSync(path.join(root, ".wakeflow-local/wakeflow.config.json")), false);
  const list = JSON.parse(pod(codexPod, root, ["list"]).stdout);
  assert.equal(list.pods.length, 0);
});

test("claude edition defers transport to the host helper on open and refuses close without --neutral-only", () => {
  const { root } = makeWorkspace();
  const open = JSON.parse(pod(claudePod, root, ["open", "--demand-key", "POD-A", "--repos", "RepoA"]).stdout);
  assert.equal(open.transport, "host-helper");
  assert.match(open.agentNext, /wakeflow-claude-host\.mjs pod-open/);
  assert.equal(existsSync(path.join(root, ".wakeflow-local/worktrees/RepoA__POD-A")), true);

  setDemandState(root, "POD-A", "completed");
  const refused = pod(claudePod, root, ["close", "--demand-key", "POD-A"]);
  assert.equal(refused.status, 1);
  assert.match(JSON.parse(refused.stderr).error, /wakeflow-claude-host\.mjs pod-close/);

  const neutral = JSON.parse(pod(claudePod, root, ["close", "--demand-key", "POD-A", "--neutral-only"]).stdout);
  assert.equal(neutral.closedIsolationWindows.length, 1);
});

// Live-fleet defect W-pod-1: wakeflow_pod_open/close/list handlers reference
// the wakeflow-pod script, but the runtime allow-list did not carry it, so the
// MCP layer failed with "Unsupported Wakeflow runtime script". Pin the FORWARD
// direction: every script an MCP handler names must be allow-listed.
test("every MCP handler script is on the runtime allow-list", async () => {
  const { listWakeflowRuntimeScripts } = await import("../core/lib/wakeflow-runtime.mjs");
  const allowed = new Set(listWakeflowRuntimeScripts());
  const source = readFileSync(path.join(repoRoot, "core/lib/wakeflow-mcp-tools.mjs"), "utf8");
  const referenced = [...new Set([...source.matchAll(/script:\s*"([a-z-]+)"/g)].map((m) => m[1]))];
  assert.ok(referenced.includes("wakeflow-pod"), "the pod tools reference the wakeflow-pod script");
  const missing = referenced.filter((name) => !allowed.has(name));
  assert.deepEqual(missing, [], `MCP handlers reference non-allow-listed runtime scripts: ${missing.join(", ")}`);
});

// Live-fleet defect W-pod-2: register-thread failed closed for pod windows
// (Controller__<pod>, Test__<pod>) because they are never in the tracked
// config, so pod fleets could not survive a reboot through the registry.
// The pod SHAPE — literal Controller prefix, or a configured base window —
// is now accepted; everything else still fails closed.
test("register-thread accepts pod-shaped windows and still refuses unknown ones", () => {
  const { root } = makeWorkspace();
  const config = JSON.parse(readFileSync(path.join(root, "wakeflow.config.json"), "utf8"));
  config.testWindow = "Test";
  writeFileSync(path.join(root, "wakeflow.config.json"), `${JSON.stringify(config, null, 2)}\n`);
  const delivery = path.join(repoRoot, "plugins/codex-wakeflow/scripts/wakeflow-delivery.mjs");
  const register = (windowName) => runSync(process.execPath, [
    delivery, "register-thread", "--root", root,
    "--window", windowName, "--thread-id", `0192fac-${windowName}`, "--write", "--json",
  ], { encoding: "utf8", cwd: root });

  const controller = register("Controller__POD-A");
  assert.equal(controller.status, 0, controller.stderr || controller.stdout);
  assert.equal(JSON.parse(controller.stdout).ok, true);

  const testWindow = register("Test__POD-A");
  assert.equal(testWindow.status, 0, testWindow.stderr || testWindow.stdout);
  assert.equal(JSON.parse(testWindow.stdout).ok, true);

  const bogusSuffixed = register("Bogus__POD-A");
  assert.equal(bogusSuffixed.status, 1, "an unconfigured base window must still fail closed");
  const bogusPlain = register("Bogus");
  assert.equal(bogusPlain.status, 1, "an unconfigured plain window must still fail closed");
});

test("a prepared pod is resumed by the claude host helper instead of re-created", () => {
  const { root } = makeWorkspace();
  assert.equal(pod(claudePod, root, ["open", "--demand-key", "POD-A", "--repos", "RepoA"]).status, 0);
  const hostScript = path.join(repoRoot, "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-host.mjs");
  const opened = runSync(process.execPath, [hostScript, "pod-open", "--root", root, "--demand-key", "POD-A", "--repos", "RepoA", "--no-launch"], { encoding: "utf8" });
  assert.equal(opened.status, 0, opened.stderr || opened.stdout);
  const payload = JSON.parse(opened.stdout);
  assert.deepEqual(payload.windows.map((win) => win.status), ["already-registered"]);
});

// Cancel path: a pod whose demand was cancelled closes exactly like a
// completed one — worktrees down, branches on the ledger, then archive.
test("pod close accepts a cancelled demand in its close order", () => {
  const { root } = makeWorkspace();
  assert.equal(pod(codexPod, root, ["open", "--demand-key", "POD-X", "--repos", "RepoA"]).status, 0);
  setDemandState(root, "POD-X", "cancelled");
  const closed = pod(codexPod, root, ["close", "--demand-key", "POD-X"]);
  assert.equal(closed.status, 0, closed.stderr || closed.stdout);
  assert.equal(JSON.parse(closed.stdout).closedIsolationWindows.length, 1);
});


// P0 fix wave: a hard crash between `git worktree add` and the overlay write
// leaves an orphan worktree with no entry. Re-running open now ADOPTS a
// worktree that provably belongs to this stream (right repo, right branch)
// instead of dead-ending; anything else still refuses.
test("pod open adopts a crash-orphaned worktree and refuses a foreign directory", () => {
  const { root } = makeWorkspace();
  const worktreeDir = path.join(root, ".wakeflow-local/worktrees/RepoA__POD-O");
  mkdirSync(path.dirname(worktreeDir), { recursive: true });
  git(path.join(root, "RepoA"), ["worktree", "add", worktreeDir, "-b", "POD-O/pod"]);

  const open = pod(codexPod, root, ["open", "--demand-key", "POD-O", "--repos", "RepoA"]);
  assert.equal(open.status, 0, open.stderr || open.stdout);
  const payload = JSON.parse(open.stdout);
  assert.deepEqual(payload.workWindows.map((win) => win.status), ["adopted"]);
  const overlay = JSON.parse(readFileSync(path.join(root, ".wakeflow-local/wakeflow.config.json"), "utf8"));
  assert.ok(overlay.repositories.some((repo) => repo.windowName === "RepoA__POD-O"), "adopted worktree lands in the overlay");

  const foreignDir = path.join(root, ".wakeflow-local/worktrees/RepoB__POD-F");
  mkdirSync(foreignDir, { recursive: true });
  writeFileSync(path.join(foreignDir, "junk.txt"), "not a worktree\n");
  const refused = pod(codexPod, root, ["open", "--demand-key", "POD-F", "--repos", "RepoB"]);
  assert.equal(refused.status, 1);
  assert.match(JSON.parse(refused.stderr).error, /not RepoB__POD-F's worktree on branch/);
});
