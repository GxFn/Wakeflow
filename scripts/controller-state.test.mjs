#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const script = path.join(workspaceRoot, "scripts/controller-state.mjs");
const renderScript = path.join(workspaceRoot, "scripts/render-progress-doc.mjs");
const appendScript = path.join(workspaceRoot, "scripts/append-progress-log.mjs");

function makeRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "controller-state-"));
  mkdirSync(root, { recursive: true });
  return root;
}

function run(args, cwd = workspaceRoot) {
  return spawnSync("node", [script, ...args], {
    cwd,
    encoding: "utf8",
  });
}

function runScript(targetScript, args, cwd = workspaceRoot) {
  return spawnSync("node", [targetScript, ...args], {
    cwd,
    encoding: "utf8",
  });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

test("append-progress-log help documents append-only usage", () => {
  const result = runScript(appendScript, ["--help"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Append an entry to a controller state-root developer progress document/);
  assert.match(result.stdout, /--type task-package/);
  assert.match(result.stdout, /does not change machine state, dispatch work, or accept evidence/);
});

test("init dry-run reports generated files without writing active state", () => {
  const root = makeRoot();
  const result = run([
    "init",
    "--root",
    root,
    "--demand-key",
    "CSMR-FIXTURE-2026-06-05",
    "--title",
    "Fixture Demand",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.wrote, false);
  assert.equal(payload.stateRoot, ".workspace-active/workspace/current/CSMR-FIXTURE-2026-06-05");
  assert.equal(existsSync(path.join(root, payload.stateRoot)), false);
});

test("init --write creates ignored state root from tracked templates", () => {
  const root = makeRoot();
  const result = run([
    "init",
    "--root",
    root,
    "--demand-key",
    "CSMR-FIXTURE-2026-06-05",
    "--title",
    "Fixture Demand",
    "--goal",
    "Prove init can create a state root.",
    "--completion-definition",
    "State, events, projection, and progress doc exist.",
    "--stage-plan",
    "Stage 0 then Stage 1.",
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.wrote, true);

  const stateRoot = path.join(root, payload.stateRoot);
  const state = readJson(path.join(stateRoot, "controller-state.json"));
  const demand = readJson(path.join(stateRoot, "demand.json"));
  const projection = readJson(path.join(stateRoot, "projection.json"));
  const events = readFileSync(path.join(stateRoot, "controller-events.jsonl"), "utf8").trim().split("\n");
  const progress = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");

  assert.equal(demand.demandKey, "CSMR-FIXTURE-2026-06-05");
  assert.equal(state.state, "intake");
  assert.equal(state.revision, 1);
  assert.equal(state.automation.enabled, false);
  assert.equal(projection.sourceRevision, 1);
  assert.equal(events.length, 1);
  assert.match(progress, /<!-- unified-status:start -->/);
  assert.match(progress, /Main state: intake/);
  assert.match(progress, /Prove init can create a state root\./);
  assert.equal(existsSync(path.join(stateRoot, "intake")), true);
  assert.equal(existsSync(path.join(stateRoot, "test-cards")), true);
  assert.equal(existsSync(path.join(stateRoot, "task-packages")), true);
  assert.equal(existsSync(path.join(stateRoot, "automation/delivery-runs")), true);
  assert.equal(existsSync(path.join(stateRoot, "transition-candidates")), true);
});

test("init refuses state roots outside workspace or configured ledger", () => {
  const root = makeRoot();
  const outside = path.join(os.tmpdir(), "controller-state-outside", String(Date.now()));
  const result = run([
    "init",
    "--root",
    root,
    "--state-root",
    outside,
    "--demand-key",
    "CSMR-FIXTURE-2026-06-05",
    "--title",
    "Fixture Demand",
    "--write",
    "--json",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /must stay inside the control workspace or configured project ledger/);
  assert.equal(existsSync(outside), false);
});

test("add-task-package updates machine state without changing progress doc", () => {
  const root = makeRoot();
  const init = run([
    "init",
    "--root",
    root,
    "--demand-key",
    "CSMR-FIXTURE-2026-06-05",
    "--title",
    "Fixture Demand",
    "--write",
    "--json",
  ]);
  const initPayload = JSON.parse(init.stdout);
  const stateRoot = path.join(root, initPayload.stateRoot);
  const progressBefore = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");

  const result = run([
    "add-task-package",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--task-package-id",
    "CSMR-PKG-1",
    "--summary",
    "Create the first task package.",
    "--source-ref",
    "test-source",
    "--target-window",
    "AlembicWorkspace",
    "--target-task-id",
    "CSMR-TASK-1",
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.projectionStatus, "stale");

  const state = readJson(path.join(stateRoot, "controller-state.json"));
  const taskPackage = readJson(path.join(stateRoot, "task-packages/CSMR-PKG-1.json"));
  const events = readFileSync(path.join(stateRoot, "controller-events.jsonl"), "utf8").trim().split("\n");
  const progressAfter = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");

  assert.equal(state.revision, 2);
  assert.equal(state.state, "planned");
  assert.equal(state.stateReason, "task package added: CSMR-PKG-1");
  assert.deepEqual(state.allowedActions, ["prepare-dispatch-from-state", "add-task-package", "render-progress-doc"]);
  assert.equal(state.projection.status, "stale");
  assert.equal(state.taskPackages[0].taskPackageId, "CSMR-PKG-1");
  assert.equal(state.targetTasks[0].targetTaskId, "CSMR-TASK-1");
  assert.equal(state.windows[0].windowName, "AlembicWorkspace");
  assert.equal(taskPackage.targetTasks[0].targetWindow, "AlembicWorkspace");
  assert.equal(events.length, 2);
  assert.equal(JSON.parse(events[1]).type, "task-package.added");
  assert.equal(progressAfter, progressBefore);
});

test("render-progress-doc updates only Unified Status after task package changes", () => {
  const root = makeRoot();
  const init = run([
    "init",
    "--root",
    root,
    "--demand-key",
    "CSMR-FIXTURE-2026-06-05",
    "--title",
    "Fixture Demand",
    "--write",
    "--json",
  ]);
  const initPayload = JSON.parse(init.stdout);
  const stateRoot = path.join(root, initPayload.stateRoot);
  run([
    "add-task-package",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--task-package-id",
    "CSMR-PKG-1",
    "--summary",
    "Create the first task package.",
    "--target-window",
    "AlembicWorkspace",
    "--target-task-id",
    "CSMR-TASK-1",
    "--write",
    "--json",
  ]);
  const progressBefore = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");

  const result = runScript(renderScript, [
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.sourceRevision, 2);

  const state = readJson(path.join(stateRoot, "controller-state.json"));
  const projection = readJson(path.join(stateRoot, "projection.json"));
  const progressAfter = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");
  const outsideBefore = progressBefore.replace(/<!-- unified-status:start -->[\s\S]*?<!-- unified-status:end -->/, "");
  const outsideAfter = progressAfter.replace(/<!-- unified-status:start -->[\s\S]*?<!-- unified-status:end -->/, "");

  assert.equal(state.projection.status, "synced");
  assert.equal(projection.sourceRevision, 2);
  assert.match(progressAfter, /Main state: planned/);
  assert.match(progressAfter, /Current task packages: CSMR-PKG-1\(pending\)/);
  assert.match(progressAfter, /Windows: AlembicWorkspace\(pending\)/);
  assert.equal(outsideAfter, outsideBefore);
});

test("append-progress-log appends timestamped entries without state transition", () => {
  const root = makeRoot();
  const init = run([
    "init",
    "--root",
    root,
    "--demand-key",
    "CSMR-FIXTURE-2026-06-05",
    "--title",
    "Fixture Demand",
    "--write",
    "--json",
  ]);
  const initPayload = JSON.parse(init.stdout);
  const stateRoot = path.join(root, initPayload.stateRoot);
  const stateBefore = readJson(path.join(stateRoot, "controller-state.json"));

  const result = runScript(appendScript, [
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--type",
    "task-package",
    "--task-package-id",
    "CSMR-PKG-1",
    "--summary",
    "Create the first task package.",
    "--source-ref",
    "test-source",
    "--timestamp",
    "2026-06-05 12:34 CST",
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.section, "Task Packages");

  const progress = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");
  const stateAfter = readJson(path.join(stateRoot, "controller-state.json"));
  assert.match(progress, /2026-06-05 12:34 CST: `CSMR-PKG-1` - Create the first task package\.; Source: test-source\./);
  assert.deepEqual(stateAfter, stateBefore);
});

test("import-target-result stores result evidence without changing controller state", () => {
  const root = makeRoot();
  const init = run([
    "init",
    "--root",
    root,
    "--demand-key",
    "CSMR-FIXTURE-2026-06-05",
    "--title",
    "Fixture Demand",
    "--write",
    "--json",
  ]);
  const initPayload = JSON.parse(init.stdout);
  const stateRoot = path.join(root, initPayload.stateRoot);
  run([
    "add-task-package",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--task-package-id",
    "CSMR-PKG-1",
    "--summary",
    "Create the first task package.",
    "--target-window",
    "AlembicWorkspace",
    "--target-task-id",
    "CSMR-TASK-1",
    "--write",
    "--json",
  ]);
  const stateBefore = readJson(path.join(stateRoot, "controller-state.json"));
  const progressBefore = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");

  const result = run([
    "import-target-result",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--target-task-id",
    "CSMR-TASK-1",
    "--target-window",
    "AlembicWorkspace",
    "--status",
    "completed",
    "--result-id",
    "CSMR-RESULT-1",
    "--evidence-ref",
    "reports/result.json",
    "--verification",
    "node --test fixture.test.mjs",
    "--summary",
    "Fixture task completed.",
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.stateRevisionUnchanged, 2);

  const stateAfter = readJson(path.join(stateRoot, "controller-state.json"));
  const progressAfter = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");
  const resultFile = readJson(path.join(stateRoot, "target-results/CSMR-RESULT-1.json"));

  assert.deepEqual(stateAfter, stateBefore);
  assert.equal(progressAfter, progressBefore);
  assert.equal(resultFile.status, "completed");
  assert.deepEqual(resultFile.forbiddenConclusions, [
    "target-result-is-controller-acceptance",
    "target-result-closes-task-package",
    "target-result-creates-next-dispatch",
    "target-result-updates-progress-doc-status",
  ]);
});

test("reduce-results creates controller review candidate without accepting work", () => {
  const root = makeRoot();
  const init = run([
    "init",
    "--root",
    root,
    "--demand-key",
    "CSMR-FIXTURE-2026-06-05",
    "--title",
    "Fixture Demand",
    "--write",
    "--json",
  ]);
  const initPayload = JSON.parse(init.stdout);
  const stateRoot = path.join(root, initPayload.stateRoot);
  run([
    "add-task-package",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--task-package-id",
    "CSMR-PKG-1",
    "--summary",
    "Create the first task package.",
    "--target-window",
    "AlembicWorkspace",
    "--target-task-id",
    "CSMR-TASK-1",
    "--write",
    "--json",
  ]);
  run([
    "import-target-result",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--target-task-id",
    "CSMR-TASK-1",
    "--target-window",
    "AlembicWorkspace",
    "--status",
    "completed",
    "--result-id",
    "CSMR-RESULT-1",
    "--evidence-ref",
    "reports/result.json",
    "--write",
    "--json",
  ]);
  const progressBefore = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");

  const result = run([
    "reduce-results",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.nextState, "review-ready");
  assert.equal(payload.reviewStatus, "ready-for-controller-review");
  assert.equal(payload.readyResultIds[0], "CSMR-RESULT-1");
  assert.equal(payload.missingResultIds.length, 0);
  assert.match(payload.candidateId, /^tc-/);

  const state = readJson(path.join(stateRoot, "controller-state.json"));
  const candidate = readJson(path.join(stateRoot, `transition-candidates/${payload.candidateId}.json`));
  const progressAfter = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");

  assert.equal(state.state, "review-ready");
  assert.equal(state.revision, 3);
  assert.equal(state.review.status, "ready-for-controller-review");
  assert.equal(state.taskPackages[0].status, "pending");
  assert.equal(state.targetTasks[0].status, "completed");
  assert.equal(state.allowedActions[0], "decide-review");
  assert.equal(candidate.fromRevision, 3);
  assert.deepEqual(candidate.allowedDecisions, ["accept", "rework", "blocked"]);
  assert.equal(progressAfter, progressBefore);
});

test("decide-review records explicit controller judgment before task acceptance", () => {
  const root = makeRoot();
  const init = run([
    "init",
    "--root",
    root,
    "--demand-key",
    "CSMR-FIXTURE-2026-06-05",
    "--title",
    "Fixture Demand",
    "--write",
    "--json",
  ]);
  const initPayload = JSON.parse(init.stdout);
  const stateRoot = path.join(root, initPayload.stateRoot);
  run([
    "add-task-package",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--task-package-id",
    "CSMR-PKG-1",
    "--summary",
    "Create the first task package.",
    "--target-window",
    "AlembicWorkspace",
    "--target-task-id",
    "CSMR-TASK-1",
    "--write",
    "--json",
  ]);
  run([
    "import-target-result",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--target-task-id",
    "CSMR-TASK-1",
    "--target-window",
    "AlembicWorkspace",
    "--status",
    "completed",
    "--result-id",
    "CSMR-RESULT-1",
    "--evidence-ref",
    "reports/result.json",
    "--write",
    "--json",
  ]);
  const reduced = run([
    "reduce-results",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--write",
    "--json",
  ]);
  const reducedPayload = JSON.parse(reduced.stdout);
  const progressBefore = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");

  const result = run([
    "decide-review",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--candidate-id",
    reducedPayload.candidateId,
    "--decision",
    "accept",
    "--reason",
    "Evidence reviewed by total-control.",
    "--evidence-ref",
    "reports/result.json",
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.nextState, "planned");
  assert.equal(payload.decision, "accept");
  assert.equal(payload.appendLog.type, "decision");

  const state = readJson(path.join(stateRoot, "controller-state.json"));
  const events = readFileSync(path.join(stateRoot, "controller-events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const progressAfter = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");

  assert.equal(state.state, "planned");
  assert.equal(state.revision, 4);
  assert.equal(state.review.status, "decision-accept");
  assert.equal(state.taskPackages[0].status, "accepted");
  assert.equal(state.targetTasks[0].status, "accepted");
  assert.equal(state.windows[0].windowState, "accepted");
  assert.deepEqual(state.allowedActions, ["add-task-package", "complete-demand", "render-progress-doc"]);
  assert.equal(events.at(-1).type, "review.decided");
  assert.match(events.at(-1).forbiddenConclusions.join(","), /decision-creates-dispatch/);
  assert.equal(progressAfter, progressBefore);
});

test("blocked and review-ready demands reject new task packages before explicit decision", () => {
  const root = makeRoot();
  const init = run([
    "init",
    "--root",
    root,
    "--demand-key",
    "CSMR-FIXTURE-2026-06-05",
    "--title",
    "Fixture Demand",
    "--write",
    "--json",
  ]);
  const initPayload = JSON.parse(init.stdout);
  const stateRoot = path.join(root, initPayload.stateRoot);
  run([
    "add-task-package",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--task-package-id",
    "CSMR-PKG-1",
    "--summary",
    "Create the first task package.",
    "--target-window",
    "AlembicWorkspace",
    "--target-task-id",
    "CSMR-TASK-1",
    "--write",
    "--json",
  ]);
  run([
    "import-target-result",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--target-task-id",
    "CSMR-TASK-1",
    "--target-window",
    "AlembicWorkspace",
    "--status",
    "blocked",
    "--result-id",
    "CSMR-RESULT-1",
    "--evidence-ref",
    "reports/result.json",
    "--write",
    "--json",
  ]);
  const reduced = run([
    "reduce-results",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--write",
    "--json",
  ]);
  const reducedPayload = JSON.parse(reduced.stdout);

  const beforeDecision = run([
    "add-task-package",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--task-package-id",
    "CSMR-PKG-LATE",
    "--summary",
    "Late task",
    "--write",
    "--json",
  ]);
  assert.notEqual(beforeDecision.status, 0);
  assert.match(beforeDecision.stdout, /cannot add task package while demand is review-ready/);

  const blocked = run([
    "decide-review",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--candidate-id",
    reducedPayload.candidateId,
    "--decision",
    "blocked",
    "--reason",
    "Total-control needs user decision.",
    "--evidence-ref",
    "reports/result.json",
    "--write",
    "--json",
  ]);
  assert.equal(blocked.status, 0, blocked.stderr || blocked.stdout);
  const state = readJson(path.join(stateRoot, "controller-state.json"));
  assert.equal(state.state, "blocked");
  assert.deepEqual(state.allowedActions, ["render-progress-doc"]);

  const afterBlocked = run([
    "add-task-package",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--task-package-id",
    "CSMR-PKG-BLOCKED",
    "--summary",
    "Blocked task",
    "--write",
    "--json",
  ]);
  assert.notEqual(afterBlocked.status, 0);
  assert.match(afterBlocked.stdout, /cannot add task package while demand is blocked/);
});

test("complete-demand refuses open tasks and records final completion explicitly", () => {
  const root = makeRoot();
  const init = run([
    "init",
    "--root",
    root,
    "--demand-key",
    "CSMR-FIXTURE-2026-06-05",
    "--title",
    "Fixture Demand",
    "--write",
    "--json",
  ]);
  const initPayload = JSON.parse(init.stdout);
  const stateRoot = path.join(root, initPayload.stateRoot);
  run([
    "add-task-package",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--task-package-id",
    "CSMR-PKG-1",
    "--summary",
    "Create the first task package.",
    "--target-window",
    "AlembicWorkspace",
    "--target-task-id",
    "CSMR-TASK-1",
    "--write",
    "--json",
  ]);

  const openTask = run([
    "complete-demand",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--reason",
    "Trying to close too early.",
    "--evidence-ref",
    "reports/result.json",
    "--write",
    "--json",
  ]);
  assert.notEqual(openTask.status, 0);
  assert.match(openTask.stdout, /requires all task packages and target tasks to be accepted/);

  run([
    "import-target-result",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--target-task-id",
    "CSMR-TASK-1",
    "--target-window",
    "AlembicWorkspace",
    "--status",
    "completed",
    "--result-id",
    "CSMR-RESULT-1",
    "--evidence-ref",
    "reports/result.json",
    "--write",
    "--json",
  ]);
  const reduced = run([
    "reduce-results",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--write",
    "--json",
  ]);
  const reducedPayload = JSON.parse(reduced.stdout);
  run([
    "decide-review",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--candidate-id",
    reducedPayload.candidateId,
    "--decision",
    "accept",
    "--reason",
    "Evidence reviewed by total-control.",
    "--evidence-ref",
    "reports/result.json",
    "--write",
    "--json",
  ]);
  const progressBefore = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");

  const result = run([
    "complete-demand",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--reason",
    "All target tasks are accepted and no blockers remain.",
    "--evidence-ref",
    "reports/result.json",
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.nextState, "completed");
  assert.equal(payload.appendLog.type, "decision");

  const state = readJson(path.join(stateRoot, "controller-state.json"));
  const events = readFileSync(path.join(stateRoot, "controller-events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const progressAfter = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");

  assert.equal(state.state, "completed");
  assert.equal(state.review.status, "demand-completed");
  assert.equal(state.allowedActions[0], "render-progress-doc");
  assert.equal(events.at(-1).type, "demand.completed");
  assert.match(events.at(-1).forbiddenConclusions.join(","), /completion-creates-dispatch/);
  assert.equal(progressAfter, progressBefore);
});

test("completed demands reject follow-up task and result mutations", () => {
  const root = makeRoot();
  const init = run([
    "init",
    "--root",
    root,
    "--demand-key",
    "CSMR-FIXTURE-2026-06-05",
    "--title",
    "Fixture Demand",
    "--write",
    "--json",
  ]);
  const initPayload = JSON.parse(init.stdout);
  const stateRoot = path.join(root, initPayload.stateRoot);
  const stateFile = path.join(stateRoot, "controller-state.json");
  const state = readJson(stateFile);
  state.state = "completed";
  state.review.status = "demand-completed";
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);

  const addTask = run([
    "add-task-package",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--task-package-id",
    "CSMR-PKG-LATE",
    "--summary",
    "Late task",
    "--write",
    "--json",
  ]);
  assert.notEqual(addTask.status, 0);
  assert.match(addTask.stdout, /cannot add task package while demand is completed/);

  const importResult = run([
    "import-target-result",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--target-task-id",
    "CSMR-TASK-LATE",
    "--target-window",
    "AlembicWorkspace",
    "--status",
    "completed",
    "--evidence-ref",
    "reports/result.json",
    "--write",
    "--json",
  ]);
  assert.notEqual(importResult.status, 0);
  assert.match(importResult.stdout, /cannot import target result while demand is completed/);
});
