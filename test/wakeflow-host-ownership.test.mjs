import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

// Real dual-host coverage: the codex artifact runs as controller host "codex",
// the claude artifact as "claude-code". A demand stamped by one host must fail
// closed on the other host's mutating commands unless --adopt-host transfers it.
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const codexState = path.join(repoRoot, "plugins/codex-wakeflow/scripts/wakeflow-state.mjs");
const claudeState = path.join(repoRoot, "plugins/claude-code-wakeflow/scripts/wakeflow-state.mjs");
const codexDelivery = path.join(repoRoot, "plugins/codex-wakeflow/scripts/wakeflow-delivery.mjs");

function run(script, args, cwd) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", cwd });
}

function runJson(script, args, cwd) {
  const result = run(script, [...args, "--json"], cwd);
  let payload = null;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    // keep raw output for the assertion message
  }
  return { result, payload };
}

function makeRoot() {
  return mkdtempSync(path.join(os.tmpdir(), "wf-host-own-"));
}

function initDemand(root) {
  const { result, payload } = runJson(codexState, ["init", "--root", root, "--demand-key", "OWN-1", "--title", "Ownership Fixture", "--write"], root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return { stateRootRef: payload.stateRoot, stateFile: path.join(root, payload.stateRoot, "wakeflow-state.json") };
}

function addTaskArgs(stateRootRef, taskId) {
  return ["add-task-package", "--state-root", stateRootRef, "--task-package-id", `PKG-${taskId}`, "--summary", "Pkg", "--target-window", "WinA", "--target-task-id", taskId, "--write"];
}

test("demand creation is host-neutral; the first driving command claims it", () => {
  const root = makeRoot();
  const { stateRootRef, stateFile } = initDemand(root);
  const created = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(created.controllerHost ?? null, null, "init leaves the demand unclaimed");

  const { result } = runJson(codexState, [...addTaskArgs(stateRootRef, "T1"), "--root", root], root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const claimed = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(claimed.controllerHost, "codex", "first driving host claims the demand");
});

test("creation does not bind: codex creates, claude claims first and owns it", () => {
  const root = makeRoot();
  const { stateRootRef, stateFile } = initDemand(root); // created by codex

  const claudeClaim = runJson(claudeState, [...addTaskArgs(stateRootRef, "T1"), "--root", root], root);
  assert.equal(claudeClaim.result.status, 0, claudeClaim.result.stderr || claudeClaim.result.stdout);
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.controllerHost, "claude-code", "first claimer owns, regardless of creator");

  const codexRefused = runJson(codexState, [...addTaskArgs(stateRootRef, "T2"), "--root", root], root);
  assert.notEqual(codexRefused.result.status, 0);
  assert.match(codexRefused.result.stdout + codexRefused.result.stderr, /owned by controller host claude-code/);
});

test("the other host fails closed and --adopt-host transfers ownership explicitly", () => {
  const root = makeRoot();
  const { stateRootRef, stateFile } = initDemand(root);
  // codex claims the demand first
  const claim = runJson(codexState, [...addTaskArgs(stateRootRef, "T1"), "--root", root], root);
  assert.equal(claim.result.status, 0);

  // claude-code controller tries to drive the codex-owned demand -> refused
  const refused = runJson(claudeState, [...addTaskArgs(stateRootRef, "T2"), "--root", root], root);
  assert.notEqual(refused.result.status, 0);
  assert.match(refused.result.stdout + refused.result.stderr, /owned by controller host codex/);

  // explicit transfer
  const adopted = runJson(claudeState, [...addTaskArgs(stateRootRef, "T2"), "--adopt-host", "--root", root], root);
  assert.equal(adopted.result.status, 0, adopted.result.stderr || adopted.result.stdout);
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.controllerHost, "claude-code", "ownership transferred to claude-code");

  // and now codex is the foreign host
  const codexRefused = runJson(codexState, [...addTaskArgs(stateRootRef, "T3"), "--root", root], root);
  assert.notEqual(codexRefused.result.status, 0);
  assert.match(codexRefused.result.stdout + codexRefused.result.stderr, /owned by controller host claude-code/);
});

test("legacy demands without a controllerHost field follow the same first-claim rule", () => {
  const root = makeRoot();
  const { stateRootRef, stateFile } = initDemand(root);
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  delete state.controllerHost; // pre-feature demand shape
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);

  const { result } = runJson(claudeState, [...addTaskArgs(stateRootRef, "T4"), "--root", root], root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const after = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(after.controllerHost, "claude-code", "legacy demand claimed on first write");
});

test("dispatch preparation refuses a demand owned by the other host", () => {
  const root = makeRoot();
  mkdirSync(path.join(root, "WinA"), { recursive: true });
  writeFileSync(path.join(root, "workspace.config.json"), JSON.stringify({
    workspaceName: "OwnFlow",
    controllerWindow: "OwnFlow",
    repositories: [{ windowName: "WinA", path: "WinA", role: "Repository window" }],
  }));
  const { stateRootRef, stateFile } = initDemand(root);
  const added = runJson(codexState, [...addTaskArgs(stateRootRef, "T5"), "--root", root], root);
  assert.equal(added.result.status, 0);
  const reg = runJson(codexDelivery, ["register-thread", "--root", root, "--window", "WinA", "--thread-id", "thread-own-1", "--write"], root);
  assert.equal(reg.result.status, 0);

  // hand the demand to claude-code, then codex tries to dispatch it
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  state.controllerHost = "claude-code";
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);

  const prepared = runJson(codexDelivery, [
    "prepare-dispatch-from-state",
    "--root", root,
    "--state-root", stateRootRef,
    "--target-task-id", "T5",
    "--controller-window", "OwnFlow",
    "--write",
  ], root);
  assert.notEqual(prepared.result.status, 0);
  assert.match(prepared.result.stdout + prepared.result.stderr, /owned by controller host claude-code/);
});
