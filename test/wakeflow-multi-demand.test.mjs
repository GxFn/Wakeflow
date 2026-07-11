#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Guards E-2: parallelism exists ONLY at the demand level. Up to
// maxActiveDemands (default 2) demands run side by side; claiming past
// capacity fails closed; two demands' loops are fully independent (per-root
// state, revisions, candidates); the knob maxActiveDemands=1 restores the
// old single-active behavior exactly.

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const stateScript = path.join(pluginRoot, "scripts/wakeflow-state.mjs");

function run(args) {
  return spawnSync(process.execPath, [stateScript, ...args], { encoding: "utf8", shell: false });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function makeRoot(config = null) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-multi-"));
  mkdirSync(root, { recursive: true });
  if (config) writeFileSync(path.join(root, "wakeflow.config.json"), `${JSON.stringify(config, null, 2)}\n`);
  return root;
}

function initDemand(root, demandKey) {
  return run(["init", "--root", root, "--demand-key", demandKey, "--title", `Demand ${demandKey}`, "--write", "--json"]);
}

function driveToAccepted(root, stateRoot, id) {
  for (const args of [
    ["add-task-package", "--root", root, "--state-root", stateRoot, "--task-package-id", `tp-${id}`, "--summary", `Work ${id}`, "--target-window", "RepoA", "--write", "--json"],
    ["import-target-result", "--root", root, "--state-root", stateRoot, "--target-task-id", `tp-${id}__RepoA`, "--target-window", "RepoA", "--status", "completed", "--write", "--json"],
    ["reduce-results", "--root", root, "--state-root", stateRoot, "--write", "--json"],
  ]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    if (args[0] === "reduce-results") return JSON.parse(result.stdout).candidateId;
  }
  return null;
}

test("the demand's own controllerWindow is stamped at init and routes prepare by default", () => {
  const root = makeRoot();
  const init = run(["init", "--root", root, "--demand-key", "POD-DK", "--title", "Pod Demand", "--controller-window", "Controller__POD-DK", "--write", "--json"]);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  const stateRoot = path.join(root, ".wakeflow-active/current/POD-DK");
  const podState = readJson(path.join(stateRoot, "wakeflow-state.json"));
  assert.equal(podState.controllerWindow, "Controller__POD-DK");
  assert.deepEqual(podState.executionPlacement, { mode: "isolated", podId: "POD-DK" });

  assert.equal(run(["add-task-package", "--root", root, "--state-root", stateRoot, "--task-package-id", "tp-a", "--summary", "W", "--target-window", "RepoA__pod-dk", "--write", "--json"]).status, 0);
  const deliveryScript = path.join(pluginRoot, "scripts/wakeflow-delivery.mjs");
  const prepared = spawnSync(process.execPath, [
    deliveryScript, "prepare-dispatch-from-state", "--root", root, "--state-root", stateRoot,
    "--target-task-id", "tp-a__RepoA__pod-dk", "--write", "--json",
  ], { encoding: "utf8", shell: false });
  assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
  const packet = readJson(path.join(root, ".wakeflow-local/wakeflow-delivery/dispatch-packets", "tp-a__RepoA__pod-dk__tp-a__RepoA__pod-dk.json"));
  assert.equal(packet.controllerWindow, "Controller__POD-DK", "prepare must default the return route to the demand's own controller — the pod mis-route killer");
});

test("two demands run side by side; the third fails closed at capacity", () => {
  const root = makeRoot();
  assert.equal(initDemand(root, "D1").status, 0);
  assert.equal(initDemand(root, "D2").status, 0, "second demand must be claimable under default capacity 2");
  assert.deepEqual(
    readJson(path.join(root, ".wakeflow-active/current/D1/wakeflow-state.json")).executionPlacement,
    { mode: "main", podId: null },
  );
  const secondState = readJson(path.join(root, ".wakeflow-active/current/D2/wakeflow-state.json"));
  assert.deepEqual(secondState.executionPlacement, { mode: "isolated", podId: "D2" });
  assert.equal(secondState.controllerWindow, "Controller__D2");

  const third = initDemand(root, "D3");
  assert.equal(third.status, 1, third.stdout);
  const payload = JSON.parse(third.stdout);
  assert.match(payload.error, /active-demand capacity \(2\/2\)/);
  assert.match(payload.error, /D1/);
  assert.match(payload.error, /D2/);
});

test("maxActiveDemands=1 restores single-active behavior exactly", () => {
  const root = makeRoot({ workspaceName: "Single", controllerWindow: "Ctl", maxActiveDemands: 1 });
  assert.equal(initDemand(root, "ONLY").status, 0);
  const second = initDemand(root, "NEXT");
  assert.equal(second.status, 1, second.stdout);
  assert.match(JSON.parse(second.stdout).error, /capacity \(1\/1\)/);
});

test("two active demands' loops are fully independent — interleaved drive, per-root state", () => {
  const root = makeRoot();
  assert.equal(initDemand(root, "D1").status, 0);
  assert.equal(initDemand(root, "D2").status, 0);
  const rootD1 = path.join(root, ".wakeflow-active/current/D1");
  const rootD2 = path.join(root, ".wakeflow-active/current/D2");

  // interleave the two demands' loops deliberately
  const candidateD1 = driveToAccepted(root, rootD1, "a");
  const candidateD2 = driveToAccepted(root, rootD2, "b");
  const decideD2 = run(["decide-review", "--root", root, "--state-root", rootD2, "--candidate-id", candidateD2, "--decision", "accept", "--reason", "independent loop D2", "--write", "--json"]);
  assert.equal(decideD2.status, 0, decideD2.stderr || decideD2.stdout);
  const decideD1 = run(["decide-review", "--root", root, "--state-root", rootD1, "--candidate-id", candidateD1, "--decision", "accept", "--reason", "independent loop D1", "--write", "--json"]);
  assert.equal(decideD1.status, 0, decideD1.stderr || decideD1.stdout);

  const stateD1 = readJson(path.join(rootD1, "wakeflow-state.json"));
  const stateD2 = readJson(path.join(rootD2, "wakeflow-state.json"));
  assert.equal(stateD1.demandKey, "D1");
  assert.equal(stateD2.demandKey, "D2");
  assert.equal(stateD1.state, "planned");
  assert.equal(stateD2.state, "planned");
  assert.equal(stateD1.revision, 4, "D1 revisions must be untouched by D2's loop");
  assert.equal(stateD2.revision, 4, "D2 revisions must be untouched by D1's loop");
  assert.equal(stateD1.targetTasks[0].status, "accepted");
  assert.equal(stateD2.targetTasks[0].status, "accepted");
});

test("completing and archiving one demand frees capacity for the next", () => {
  // ledger INSIDE the sandbox: the default ../wakeflow-ledger would land in the
  // shared tmpdir and collide across test runs
  const root = makeRoot({ workspaceName: "MultiArchive", controllerWindow: "Ctl", projectLedgerRoot: "wakeflow-ledger" });
  assert.equal(initDemand(root, "D1").status, 0);
  assert.equal(initDemand(root, "D2").status, 0);
  const rootD1 = path.join(root, ".wakeflow-active/current/D1");
  const candidate = driveToAccepted(root, rootD1, "a");
  assert.equal(run(["decide-review", "--root", root, "--state-root", rootD1, "--candidate-id", candidate, "--decision", "accept", "--reason", "done", "--write", "--json"]).status, 0);
  assert.equal(run(["complete-demand", "--root", root, "--state-root", rootD1, "--reason", "done", "--evidence-ref", "controller-events.jsonl", "--write", "--json"]).status, 0);

  // completed-but-not-archived still occupies capacity
  const blocked = initDemand(root, "D3");
  assert.equal(blocked.status, 1, blocked.stdout);
  assert.match(JSON.parse(blocked.stdout).error, /completed but not archived/);

  assert.equal(run(["archive-demand", "--root", root, "--state-root", rootD1, "--reason", "shipped", "--write", "--json"]).status, 0);
  assert.equal(initDemand(root, "D3").status, 0, "archiving must free the slot");
  assert.deepEqual(
    readJson(path.join(root, ".wakeflow-active/current/D3/wakeflow-state.json")).executionPlacement,
    { mode: "isolated", podId: "D3" },
    "an isolated survivor keeps the main checkout reserved; a replacement demand must not silently become a second main editor",
  );
});
