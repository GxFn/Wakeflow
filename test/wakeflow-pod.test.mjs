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
  assert.match(ledger, /POD-A \| RepoA \| POD-A\/POD-A/);
  assert.match(ledger, /POD-A \| RepoB \| POD-A\/POD-A/);
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

test("a prepared pod is resumed by the claude host helper instead of re-created", () => {
  const { root } = makeWorkspace();
  assert.equal(pod(claudePod, root, ["open", "--demand-key", "POD-A", "--repos", "RepoA"]).status, 0);
  const hostScript = path.join(repoRoot, "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-host.mjs");
  const opened = runSync(process.execPath, [hostScript, "pod-open", "--root", root, "--demand-key", "POD-A", "--repos", "RepoA", "--no-launch"], { encoding: "utf8" });
  assert.equal(opened.status, 0, opened.stderr || opened.stdout);
  const payload = JSON.parse(opened.stdout);
  assert.deepEqual(payload.windows.map((win) => win.status), ["already-registered"]);
});
