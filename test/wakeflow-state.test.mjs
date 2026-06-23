#!/usr/bin/env node

import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const script = path.join(workspaceRoot, "scripts/wakeflow-state.mjs");
const renderScript = path.join(workspaceRoot, "scripts/wakeflow-render-progress.mjs");
const appendScript = path.join(workspaceRoot, "scripts/wakeflow-progress-log.mjs");

function makeRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-state-"));
  mkdirSync(root, { recursive: true });
  return root;
}

function run(args, cwd = workspaceRoot) {
  return runSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
  });
}

function runScript(targetScript, args, cwd = workspaceRoot) {
  return runSync(process.execPath, [targetScript, ...args], {
    cwd,
    encoding: "utf8",
  });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeStateRootEvidence(root, stateRootRef, ref, content = "{}\n") {
  const file = path.resolve(root, stateRootRef, ref);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

test("trace-bearing state-machine schemas expose wakeflowTrace explicitly", () => {
  for (const schemaName of [
    "target-result.schema.json",
    "transition-candidate.schema.json",
    "controller-event.schema.json",
  ]) {
    const schema = readJson(path.join(workspaceRoot, "schemas/wakeflow-state-machine", schemaName));
    assert.equal(schema.properties.wakeflowTrace.type, "object", schemaName);
  }
});

test("wakeflow-progress-log help documents append-only usage", () => {
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
  assert.equal(payload.stateRoot, ".wakeflow-active/current/CSMR-FIXTURE-2026-06-05");
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
  const state = readJson(path.join(stateRoot, "wakeflow-state.json"));
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
  assert.deepEqual(payload.outputs.sort(), [
    ".wakeflow-active/current/CSMR-FIXTURE-2026-06-05/controller-events.jsonl",
    ".wakeflow-active/current/CSMR-FIXTURE-2026-06-05/demand.json",
    ".wakeflow-active/current/CSMR-FIXTURE-2026-06-05/developer-progress.md",
    ".wakeflow-active/current/CSMR-FIXTURE-2026-06-05/projection.json",
    ".wakeflow-active/current/CSMR-FIXTURE-2026-06-05/wakeflow-state.json",
  ].sort());
  assert.equal(existsSync(path.join(stateRoot, "intake")), false);
  assert.equal(existsSync(path.join(stateRoot, "test-cards")), false);
  assert.equal(existsSync(path.join(stateRoot, "task-packages")), false);
  assert.equal(existsSync(path.join(stateRoot, "automation")), false);
  assert.equal(existsSync(path.join(stateRoot, "transition-candidates")), false);
});

test("init refuses to overwrite an existing state root", () => {
  const root = makeRoot();
  const first = run([
    "init",
    "--root",
    root,
    "--demand-key",
    "REINIT-FIXTURE",
    "--title",
    "Reinit Fixture",
    "--write",
    "--json",
  ]);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const repeat = run([
    "init",
    "--root",
    root,
    "--demand-key",
    "REINIT-FIXTURE",
    "--title",
    "Reinit Fixture",
    "--write",
    "--json",
  ]);
  assert.notEqual(repeat.status, 0);
  assert.match(repeat.stdout + repeat.stderr, /refuse to re-initialize/);
});

test("init refuses to start another demand while one is unarchived", () => {
  const root = makeRoot();
  const first = run([
    "init",
    "--root",
    root,
    "--demand-key",
    "ACTIVE-FIXTURE",
    "--title",
    "Active Fixture",
    "--write",
    "--json",
  ]);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const second = run([
    "init",
    "--root",
    root,
    "--demand-key",
    "SECOND-FIXTURE",
    "--title",
    "Second Fixture",
    "--write",
    "--json",
  ]);
  assert.notEqual(second.status, 0);
  assert.match(second.stdout + second.stderr, /cannot initialize SECOND-FIXTURE while unarchived demand state root/);
  assert.equal(existsSync(path.join(root, ".wakeflow-active/current/SECOND-FIXTURE/wakeflow-state.json")), false);
});

test("RA5: render-progress emits structured projection slices alongside the display strings", () => {
  const root = makeRoot();
  const init = JSON.parse(run([
    "init", "--root", root, "--demand-key", "SLICE-FIXTURE", "--title", "Slice Fixture", "--write", "--json",
  ]).stdout);
  const stateRootRel = init.stateRoot;
  const add = run([
    "add-task-package", "--root", root, "--state-root", stateRootRel,
    "--task-package-id", "SLICE-PKG", "--summary", "pkg",
    "--target-window", "WinA", "--target-task-id", "SLICE-TASK", "--target-summary", "do it",
    "--write", "--json",
  ]);
  assert.equal(add.status, 0, add.stderr || add.stdout);
  const render = runScript(renderScript, ["--root", root, "--state-root", stateRootRel, "--write", "--json"]);
  assert.equal(render.status, 0, render.stderr || render.stdout);
  const projection = readJson(path.join(root, stateRootRel, "projection.json"));
  assert.ok(projection.slices, "projection carries a structured slices object");
  assert.ok(Array.isArray(projection.slices.targetTasks), "slices.targetTasks is an array of objects");
  const task = projection.slices.targetTasks.find((item) => item.targetTaskId === "SLICE-TASK");
  assert.ok(task, "slices.targetTasks includes the task as a structured object");
  assert.equal(task.targetWindow, "WinA");
  assert.ok(Array.isArray(projection.slices.windows), "slices.windows is an array of objects");
  assert.equal(typeof projection.unifiedStatus.windows, "string", "the lossy display string is retained for back-compat");
});

test("RA5: render-progress writes an idempotent navigable state-root index.md", () => {
  const root = makeRoot();
  const init = JSON.parse(run([
    "init", "--root", root, "--demand-key", "INDEX-FIXTURE", "--title", "Index Fixture", "--write", "--json",
  ]).stdout);
  const stateRootRel = init.stateRoot;
  run([
    "add-task-package", "--root", root, "--state-root", stateRootRel,
    "--task-package-id", "IDX-PKG", "--summary", "pkg",
    "--target-window", "WinA", "--target-task-id", "IDX-TASK", "--target-summary", "do",
    "--write", "--json",
  ]);
  const indexPath = path.join(root, stateRootRel, "index.md");
  assert.equal(runScript(renderScript, ["--root", root, "--state-root", stateRootRel, "--write", "--json"]).status, 0);
  assert.ok(existsSync(indexPath), "render-progress writes index.md");
  const first = readFileSync(indexPath, "utf8");
  assert.match(first, /# INDEX-FIXTURE/);
  assert.match(first, /\[wakeflow-state\.json\]\(wakeflow-state\.json\)/, "links the state file");
  assert.match(first, /\[projection\.json\]\(projection\.json\)/, "links the projection");
  assert.match(first, /IDX-PKG/, "lists the task package");
  assert.match(first, /IDX-TASK/, "lists the target task");
  // idempotent: regenerating against the same state yields an identical index (no wall-clock)
  assert.equal(runScript(renderScript, ["--root", root, "--state-root", stateRootRel, "--write", "--json"]).status, 0);
  assert.equal(readFileSync(indexPath, "utf8"), first, "regenerating against the same state is idempotent");
});

test("RA5: focus-doc distills a per-window card (dry-run default, --write emits md + json)", () => {
  const root = makeRoot();
  const init = JSON.parse(run([
    "init", "--root", root, "--demand-key", "FOCUS-FIXTURE", "--title", "Focus Fixture", "--write", "--json",
  ]).stdout);
  const stateRootRel = init.stateRoot;
  run([
    "add-task-package", "--root", root, "--state-root", stateRootRel,
    "--task-package-id", "FOC-PKG", "--summary", "pkg",
    "--target-window", "WinA", "--target-task-id", "FOC-TASK", "--target-summary", "do",
    "--write", "--json",
  ]);
  const dry = JSON.parse(run(["focus-doc", "--root", root, "--state-root", stateRootRel, "--window", "WinA", "--json"]).stdout);
  assert.equal(dry.command, "focus-doc");
  assert.equal(dry.wrote, false, "focus-doc is dry-run by default");
  assert.equal(existsSync(path.join(root, dry.files[0])), false, "dry-run writes nothing");
  const wrote = JSON.parse(run(["focus-doc", "--root", root, "--state-root", stateRootRel, "--window", "WinA", "--write", "--json"]).stdout);
  assert.equal(wrote.wrote, true);
  assert.ok(existsSync(path.join(root, wrote.files[0])), "focus-doc --write writes the window card markdown");
  assert.ok(existsSync(path.join(root, wrote.files[1])), "and the card json");
  const md = readFileSync(path.join(root, wrote.files[0]), "utf8");
  assert.match(md, /# Focus: WinA/);
  assert.match(md, /FOC-TASK/);
});

// F41: crash-injection — a failed state.json write must NOT advance the revision (the event
// is written first, so a crash leaves at most a harmless extra event, never a missing-event
// gap). Skipped under root, where chmod 0555 does not block writes.
test("F41: a failed state.json commit leaves the revision unadvanced (no half-commit)", {
  skip: typeof process.getuid === "function" && process.getuid() === 0 ? "chmod is bypassed when running as root" : false,
}, () => {
  const root = makeRoot();
  const init = JSON.parse(run([
    "init", "--root", root, "--demand-key", "CRASH-FIXTURE", "--title", "Crash Fixture", "--write", "--json",
  ]).stdout);
  const stateRootRel = init.stateRoot;
  const stateRootAbs = path.join(root, stateRootRel);
  run(["add-task-package", "--root", root, "--state-root", stateRootRel, "--task-package-id", "C-PKG-1", "--summary", "p1", "--write", "--json"]);
  const stateFile = path.join(stateRootAbs, "wakeflow-state.json");
  const eventsFile = path.join(stateRootAbs, "controller-events.jsonl");
  const beforeRev = readJson(stateFile).revision;
  const beforeEvents = readFileSync(eventsFile, "utf8").trim().split("\n").length;
  // make the state-root dir read-only so the state.json temp+rename fails AFTER the event append
  chmodSync(stateRootAbs, 0o555);
  let failed;
  try {
    failed = run([
      "add-task-package", "--root", root, "--state-root", stateRootRel,
      "--task-package-id", "C-PKG-2", "--summary", "p2", "--write", "--json",
    ]).status !== 0;
  } finally {
    chmodSync(stateRootAbs, 0o755);
  }
  assert.equal(failed, true, "the commit fails when state.json cannot be written");
  assert.equal(readJson(stateFile).revision, beforeRev, "state.json revision is NOT advanced on a failed commit");
  const afterEvents = readFileSync(eventsFile, "utf8").trim().split("\n").length;
  assert.ok(afterEvents >= beforeEvents, "an extra event may exist (harmless), never a missing event for an advanced revision");
});

test("init and render-progress localize generated state-root docs for Chinese workspaces", () => {
  const root = makeRoot();
  const result = run([
    "init",
    "--root",
    root,
    "--demand-key",
    "ZH-FIXTURE-2026-06-10",
    "--title",
    "Chinese Demand",
    "--language",
    "zh",
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  const stateRoot = path.join(root, payload.stateRoot);
  const state = readJson(path.join(stateRoot, "wakeflow-state.json"));
  const demand = readJson(path.join(stateRoot, "demand.json"));
  const projection = readJson(path.join(stateRoot, "projection.json"));
  const progress = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");

  assert.equal(state.interfaceLanguage, "zh");
  assert.equal(state.projection.interfaceLanguage, "zh");
  assert.equal(demand.interfaceLanguage, "zh");
  assert.equal(projection.interfaceLanguage, "zh");
  assert.match(progress, /# Chinese Demand \u8fdb\u5ea6/);
  assert.match(progress, /\u7edf\u4e00\u72b6\u6001/);
  assert.match(progress, /\u4e3b\u72b6\u6001: intake/);
  assert.match(progress, /\u7531\u603b\u63a7\u5224\u65ad\u8865\u5145\u3002/);
  assert.doesNotMatch(progress, /Main state:/);

  const render = runScript(renderScript, [
    "--root",
    root,
    "--state-root",
    payload.stateRoot,
    "--write",
    "--json",
  ]);
  assert.equal(render.status, 0, render.stderr || render.stdout);
  const progressAfter = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");
  const stateAfter = readJson(path.join(stateRoot, "wakeflow-state.json"));
  assert.equal(stateAfter.projection.interfaceLanguage, "zh");
  assert.match(progressAfter, /\u4e0b\u4e00\u6b65: \u7531\u603b\u63a7\u5224\u65ad\u5b9a\u4e49\u9636\u6bb5\u548c\u4efb\u52a1\u5305\u3002/);
  assert.doesNotMatch(progressAfter, /Next action:/);
});

test("init refuses state roots outside workspace or configured ledger", () => {
  const root = makeRoot();
  const outside = path.join(os.tmpdir(), "wakeflow-state-outside", String(Date.now()));
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
  assert.match(result.stdout, /must stay inside the Wakeflow runtime or configured project ledger/);
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

  const state = readJson(path.join(stateRoot, "wakeflow-state.json"));
  const taskPackage = readJson(path.join(stateRoot, "task-packages/CSMR-PKG-1.json"));
  const events = readFileSync(path.join(stateRoot, "controller-events.jsonl"), "utf8").trim().split("\n");
  const progressAfter = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");

  assert.equal(state.revision, 2);
  assert.equal(state.state, "planned");
  assert.equal(state.stateReason, "task package added: CSMR-PKG-1");
  assert.deepEqual(state.allowedActions, ["prepare-dispatch-from-state", "add-task-package", "wakeflow-render-progress"]);
  assert.equal(state.projection.status, "stale");
  assert.equal(state.taskPackages[0].taskPackageId, "CSMR-PKG-1");
  assert.equal(state.targetTasks[0].targetTaskId, "CSMR-TASK-1");
  assert.equal(state.windows[0].windowName, "AlembicWorkspace");
  assert.equal(taskPackage.targetTasks[0].targetWindow, "AlembicWorkspace");
  assert.equal(existsSync(path.join(stateRoot, "task-packages")), true);
  assert.equal(existsSync(path.join(stateRoot, "automation")), false);
  assert.equal(events.length, 2);
  assert.equal(JSON.parse(events[1]).type, "task-package.added");
  assert.equal(progressAfter, progressBefore);
});

test("wakeflow-render-progress updates only Unified Status after task package changes", () => {
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

  const state = readJson(path.join(stateRoot, "wakeflow-state.json"));
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

test("wakeflow-progress-log appends timestamped entries without state transition", () => {
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
  const stateBefore = readJson(path.join(stateRoot, "wakeflow-state.json"));

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
  const stateAfter = readJson(path.join(stateRoot, "wakeflow-state.json"));
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
  const stateBefore = readJson(path.join(stateRoot, "wakeflow-state.json"));
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
  assert.match(payload.agentNext, /not controller acceptance/);
  assert.equal(payload.deliveryContext.resolution, "state-only-result");
  assert.equal(payload.controllerReturn.required, false);
  assert.match(payload.agentNext, /not controller acceptance/);

  const stateAfter = readJson(path.join(stateRoot, "wakeflow-state.json"));
  const progressAfter = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");
  const resultFile = readJson(path.join(stateRoot, "target-results/CSMR-RESULT-1.json"));

  assert.deepEqual(stateAfter, stateBefore);
  assert.equal(progressAfter, progressBefore);
  assert.equal(resultFile.status, "completed");
  assert.equal(resultFile.stateRoot, initPayload.stateRoot);
  assert.equal(resultFile.deliveryContext.resolution, "state-only-result");
  assert.equal(resultFile.controllerActionRequired, false);
  assert.equal(resultFile.wakeflowTrace.artifactKind, "target-result");
  assert.equal(resultFile.wakeflowTrace.source, "wakeflow-state");
  assert.equal(resultFile.wakeflowTrace.stateRoot, initPayload.stateRoot);
  assert.equal(resultFile.wakeflowTrace.stateRevision, 2);
  assert.equal(resultFile.wakeflowTrace.resultId, "CSMR-RESULT-1");
  assert.equal(resultFile.wakeflowTrace.targetTaskId, "CSMR-TASK-1");
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
  writeStateRootEvidence(root, initPayload.stateRoot, "reports/result.json");
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

  const state = readJson(path.join(stateRoot, "wakeflow-state.json"));
  const candidate = readJson(path.join(stateRoot, `transition-candidates/${payload.candidateId}.json`));
  const progressAfter = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");

  assert.equal(state.state, "review-ready");
  assert.equal(state.revision, 3);
  assert.equal(state.review.status, "ready-for-controller-review");
  assert.equal(state.taskPackages[0].status, "pending");
  assert.equal(state.targetTasks[0].status, "completed");
  assert.equal(state.allowedActions[0], "decide-review");
  assert.equal(candidate.fromRevision, 3);
  assert.deepEqual(candidate.allowedDecisions, ["accept", "rework", "blocked", "redesign"]);
  assert.equal(candidate.wakeflowTrace.artifactKind, "transition-candidate");
  assert.equal(candidate.wakeflowTrace.candidateId, payload.candidateId);
  assert.equal(candidate.wakeflowTrace.stateRoot, initPayload.stateRoot);
  assert.equal(candidate.wakeflowTrace.stateRevision, 3);
  const reviewEvent = readFileSync(path.join(stateRoot, "controller-events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((event) => event.type === "review.reduced");
  assert.equal(reviewEvent.wakeflowTrace.artifactKind, "controller-event");
  assert.equal(reviewEvent.wakeflowTrace.stateRoot, initPayload.stateRoot);
  assert.equal(reviewEvent.wakeflowTrace.stateRevision, 3);
  assert.equal(progressAfter, progressBefore);
});

test("reduce-results refuses to create a review candidate with missing evidence refs", () => {
  const root = makeRoot();
  const init = JSON.parse(run([
    "init",
    "--root",
    root,
    "--demand-key",
    "MISSING-EVIDENCE-FIXTURE",
    "--title",
    "Missing Evidence Fixture",
    "--write",
    "--json",
  ]).stdout);
  const stateRoot = path.join(root, init.stateRoot);
  run([
    "add-task-package",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--task-package-id",
    "PKG-1",
    "--summary",
    "Package with missing evidence.",
    "--target-window",
    "WinA",
    "--target-task-id",
    "TASK-1",
    "--write",
    "--json",
  ]);
  run([
    "import-target-result",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--target-task-id",
    "TASK-1",
    "--target-window",
    "WinA",
    "--status",
    "completed",
    "--result-id",
    "RESULT-1",
    "--evidence-ref",
    "reports/missing.json",
    "--write",
    "--json",
  ]);

  const refused = run([
    "reduce-results",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--write",
    "--json",
  ]);
  assert.notEqual(refused.status, 0, "missing evidence must block candidate creation");
  const refusedPayload = JSON.parse(refused.stdout);
  assert.equal(refusedPayload.ok, false);
  assert.equal(refusedPayload.reviewGate, "evidence-repair-required");
  assert.equal(refusedPayload.stateRevisionUnchanged, 2);
  assert.deepEqual(refusedPayload.missingEvidenceRefs.map((item) => item.ref), ["reports/missing.json"]);
  assert.match(refusedPayload.agentNext, /repair.*target result evidence.*rerun reduce-results/);
  const unchangedState = readJson(path.join(stateRoot, "wakeflow-state.json"));
  assert.equal(unchangedState.state, "planned");
  assert.equal(unchangedState.revision, 2);
  assert.equal(existsSync(path.join(stateRoot, "transition-candidates")), false);

  writeStateRootEvidence(root, init.stateRoot, "reports/missing.json");
  const repaired = JSON.parse(run([
    "reduce-results",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--write",
    "--json",
  ]).stdout);
  assert.equal(repaired.ok, true);
  assert.equal(repaired.nextState, "review-ready");
  assert.match(repaired.candidateId, /^tc-/);
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
  writeStateRootEvidence(root, initPayload.stateRoot, "reports/result.json");
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

  const state = readJson(path.join(stateRoot, "wakeflow-state.json"));
  const events = readFileSync(path.join(stateRoot, "controller-events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const progressAfter = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");

  assert.equal(state.state, "planned");
  assert.equal(state.revision, 4);
  assert.equal(state.review.status, "decision-accept");
  assert.equal(state.taskPackages[0].status, "accepted");
  assert.equal(state.targetTasks[0].status, "accepted");
  assert.equal(state.windows[0].windowState, "accepted");
  assert.deepEqual(state.allowedActions, ["add-task-package", "complete-demand", "wakeflow-render-progress"]);
  assert.equal(events.at(-1).type, "review.decided");
  assert.match(events.at(-1).forbiddenConclusions.join(","), /decision-creates-dispatch/);
  assert.equal(progressAfter, progressBefore);
});

test("review decisions affect open targets without rewriting accepted history", () => {
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

  const addTask = (taskPackageId, targetTaskId) => {
    const result = run([
      "add-task-package",
      "--root",
      root,
      "--state-root",
      initPayload.stateRoot,
      "--task-package-id",
      taskPackageId,
      "--summary",
      `Package ${taskPackageId}.`,
      "--target-window",
      "AlembicWorkspace",
      "--target-task-id",
      targetTaskId,
      "--write",
      "--json",
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  const importResult = (targetTaskId, resultId) => {
    const result = run([
      "import-target-result",
      "--root",
      root,
      "--state-root",
      initPayload.stateRoot,
      "--target-task-id",
      targetTaskId,
      "--target-window",
      "AlembicWorkspace",
      "--status",
      "completed",
      "--result-id",
      resultId,
      "--evidence-ref",
      `reports/${resultId}.json`,
      "--write",
      "--json",
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    writeStateRootEvidence(root, initPayload.stateRoot, `reports/${resultId}.json`);
  };
  const reduce = () => {
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
    return JSON.parse(result.stdout);
  };
  const decide = (candidateId, decision) => {
    const result = run([
      "decide-review",
      "--root",
      root,
      "--state-root",
      initPayload.stateRoot,
      "--candidate-id",
      candidateId,
      "--decision",
      decision,
      "--reason",
      `Controller decision ${decision}.`,
      "--evidence-ref",
      `reports/${candidateId}.json`,
      "--write",
      "--json",
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  };

  addTask("CSMR-PKG-0", "CSMR-TASK-0");
  importResult("CSMR-TASK-0", "CSMR-RESULT-0");
  decide(reduce().candidateId, "accept");

  addTask("CSMR-PKG-1", "CSMR-TASK-1");
  importResult("CSMR-TASK-1", "CSMR-RESULT-1");
  const reworkCandidatePayload = reduce();
  const reworkCandidateFile = path.join(stateRoot, `transition-candidates/${reworkCandidatePayload.candidateId}.json`);
  const reworkCandidate = readJson(reworkCandidateFile);
  assert.deepEqual(reworkCandidate.targetTaskIds, ["CSMR-TASK-1"]);
  assert.deepEqual(reworkCandidate.excludedTargetTaskIds, ["CSMR-TASK-0"]);
  writeFileSync(reworkCandidateFile, `${JSON.stringify({
    ...reworkCandidate,
    targetTaskIds: ["CSMR-TASK-0", "CSMR-TASK-1"],
    excludedTargetTaskIds: [],
  }, null, 2)}\n`);
  const reworkDecision = decide(reworkCandidatePayload.candidateId, "rework");
  assert.deepEqual(reworkDecision.targetTaskIds, ["CSMR-TASK-1"]);
  assert.deepEqual(reworkDecision.excludedTargetTaskIds, ["CSMR-TASK-0"]);

  const afterRework = readJson(path.join(stateRoot, "wakeflow-state.json"));
  assert.equal(afterRework.taskPackages.find((item) => item.taskPackageId === "CSMR-PKG-0").status, "accepted");
  assert.equal(afterRework.targetTasks.find((item) => item.targetTaskId === "CSMR-TASK-0").status, "accepted");
  assert.equal(afterRework.taskPackages.find((item) => item.taskPackageId === "CSMR-PKG-1").status, "needs-rework");
  assert.equal(afterRework.targetTasks.find((item) => item.targetTaskId === "CSMR-TASK-1").status, "needs-rework");

  const prematureReduce = reduce();
  assert.equal(prematureReduce.candidateId, null);
  assert.equal(prematureReduce.nextState, "needs-rework");
  assert.equal(prematureReduce.reviewStatus, "rework-route-waiting-results");
  assert.deepEqual(prematureReduce.targetTaskIds, ["CSMR-TASK-1"]);
  assert.deepEqual(prematureReduce.missingResultIds, ["CSMR-TASK-1"]);

  addTask("CSMR-PKG-1A", "CSMR-TASK-1A");
  importResult("CSMR-TASK-1A", "CSMR-RESULT-1A");
  const stateWithLegacyNextStepFile = path.join(stateRoot, "wakeflow-state.json");
  const stateWithLegacyNextStep = readJson(stateWithLegacyNextStepFile);
  stateWithLegacyNextStep.taskPackages.push({
    taskPackageId: "CSMR-PKG-2",
    summary: "Legacy next step",
    status: "pending",
    createdAt: "2026-06-05T00:02:00.000Z",
  });
  stateWithLegacyNextStep.targetTasks.push({
    targetTaskId: "CSMR-TASK-2",
    taskPackageId: "CSMR-PKG-2",
    targetWindow: "AlembicWorkspace",
    summary: "Legacy next-step task",
    status: "pending",
    createdAt: "2026-06-05T00:02:00.000Z",
  });
  writeFileSync(stateWithLegacyNextStepFile, `${JSON.stringify(stateWithLegacyNextStep, null, 2)}\n`);
  writeFileSync(path.join(stateRoot, "task-packages/CSMR-PKG-2.json"), `${JSON.stringify({
    schemaVersion: 1,
    taskPackageId: "CSMR-PKG-2",
    demandKey: "CANDIDATE-SCOPE-MERGE",
    summary: "Legacy next step",
    status: "pending",
    targetTasks: [{
      targetTaskId: "CSMR-TASK-2",
      taskPackageId: "CSMR-PKG-2",
      targetWindow: "AlembicWorkspace",
      summary: "Legacy next-step task",
      status: "pending",
    }],
    createdAt: "2026-06-05T00:02:00.000Z",
  }, null, 2)}\n`);
  importResult("CSMR-TASK-2", "CSMR-RESULT-2");
  const acceptCandidatePayload = reduce();
  const acceptCandidate = readJson(path.join(stateRoot, `transition-candidates/${acceptCandidatePayload.candidateId}.json`));
  assert.equal(acceptCandidate.reviewScope, "rework-first-controller-review-targets");
  assert.deepEqual(acceptCandidate.targetTaskIds, ["CSMR-TASK-1", "CSMR-TASK-1A"]);
  assert.deepEqual(acceptCandidate.excludedTargetTaskIds, ["CSMR-TASK-0", "CSMR-TASK-2"]);
  const reworkAccept = decide(acceptCandidatePayload.candidateId, "accept");
  assert.deepEqual(reworkAccept.targetTaskIds, ["CSMR-TASK-1", "CSMR-TASK-1A"]);
  assert.deepEqual(reworkAccept.excludedTargetTaskIds, ["CSMR-TASK-0", "CSMR-TASK-2"]);

  const afterReworkRouteAccept = readJson(path.join(stateRoot, "wakeflow-state.json"));
  assert.equal(afterReworkRouteAccept.taskPackages.find((item) => item.taskPackageId === "CSMR-PKG-2").status, "pending");
  assert.equal(afterReworkRouteAccept.targetTasks.find((item) => item.targetTaskId === "CSMR-TASK-2").status, "pending");

  const nextCandidatePayload = reduce();
  const nextCandidate = readJson(path.join(stateRoot, `transition-candidates/${nextCandidatePayload.candidateId}.json`));
  assert.equal(nextCandidate.reviewScope, "open-controller-review-targets");
  assert.deepEqual(nextCandidate.targetTaskIds, ["CSMR-TASK-2"]);
  assert.deepEqual(nextCandidate.excludedTargetTaskIds, ["CSMR-TASK-0", "CSMR-TASK-1", "CSMR-TASK-1A"]);
  decide(nextCandidatePayload.candidateId, "accept");

  const finalState = readJson(path.join(stateRoot, "wakeflow-state.json"));
  assert.deepEqual(finalState.taskPackages.map((item) => item.status), ["accepted", "accepted", "accepted", "accepted"]);
  assert.deepEqual(finalState.targetTasks.map((item) => item.status), ["accepted", "accepted", "accepted", "accepted"]);

  const completed = run([
    "complete-demand",
    "--root",
    root,
    "--state-root",
    initPayload.stateRoot,
    "--reason",
    "All open and rework tasks accepted.",
    "--evidence-ref",
    "reports/final.json",
    "--write",
    "--json",
  ]);
  assert.equal(completed.status, 0, completed.stderr || completed.stdout);
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
  writeStateRootEvidence(root, initPayload.stateRoot, "reports/result.json");
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
  const state = readJson(path.join(stateRoot, "wakeflow-state.json"));
  assert.equal(state.state, "blocked");
  assert.deepEqual(state.allowedActions, ["wakeflow-render-progress"]);

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
  writeStateRootEvidence(root, initPayload.stateRoot, "reports/result.json");
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

  const state = readJson(path.join(stateRoot, "wakeflow-state.json"));
  const events = readFileSync(path.join(stateRoot, "controller-events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const progressAfter = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");

  assert.equal(state.state, "completed");
  assert.equal(state.review.status, "demand-completed");
  assert.equal(state.allowedActions[0], "wakeflow-render-progress");
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
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
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


test("import-target-result auto-disambiguates the default result id on rework re-import", () => {
  const root = makeRoot();
  const init = JSON.parse(run(["init", "--root", root, "--demand-key", "REWORK-FIXTURE", "--title", "Rework Fixture", "--write", "--json"]).stdout);
  run(["add-task-package", "--root", root, "--state-root", init.stateRoot, "--task-package-id", "PKG-1", "--summary", "Pkg", "--target-window", "WinA", "--target-task-id", "TASK-1", "--write", "--json"]);

  const args = ["import-target-result", "--root", root, "--state-root", init.stateRoot, "--target-task-id", "TASK-1", "--target-window", "WinA", "--status", "completed", "--evidence-ref", "reports/a.json", "--write", "--json"];
  const first = JSON.parse(run(args).stdout);
  assert.equal(first.ok, true);

  const second = JSON.parse(run(args).stdout);
  assert.equal(second.ok, true, "rework re-import with the default result id must not collide");
  assert.notEqual(second.resultId, first.resultId, "second import gets a disambiguated id");

  const explicit = run(["import-target-result", "--root", root, "--state-root", init.stateRoot, "--target-task-id", "TASK-1", "--target-window", "WinA", "--status", "completed", "--result-id", first.resultId, "--evidence-ref", "reports/a.json", "--write", "--json"]);
  assert.notEqual(explicit.status, 0, "an explicit duplicate result id still fails");
});

test("decide-review refuses to accept over blocked results without --accept-blocked", () => {
  const root = makeRoot();
  const init = JSON.parse(run(["init", "--root", root, "--demand-key", "BLOCKED-FIXTURE", "--title", "Blocked Fixture", "--write", "--json"]).stdout);
  run(["add-task-package", "--root", root, "--state-root", init.stateRoot, "--task-package-id", "PKG-1", "--summary", "Pkg", "--target-window", "WinA", "--target-task-id", "TASK-1", "--write", "--json"]);
  run(["import-target-result", "--root", root, "--state-root", init.stateRoot, "--target-task-id", "TASK-1", "--target-window", "WinA", "--status", "blocked", "--summary", "blocked by env", "--write", "--json"]);
  const reduced = JSON.parse(run(["reduce-results", "--root", root, "--state-root", init.stateRoot, "--write", "--json"]).stdout);
  assert.equal(reduced.ok, true);
  const candidateId = reduced.candidate?.candidateId ?? reduced.candidateId;
  assert.ok(candidateId, "reduce produced a candidate");

  const refused = run(["decide-review", "--root", root, "--state-root", init.stateRoot, "--candidate-id", candidateId, "--decision", "accept", "--reason", "try accept", "--write", "--json"]);
  assert.notEqual(refused.status, 0, "accept over blocked must fail without the explicit flag");
  assert.match(refused.stdout + refused.stderr, /blocked target results/);

  const allowed = JSON.parse(run(["decide-review", "--root", root, "--state-root", init.stateRoot, "--candidate-id", candidateId, "--decision", "accept", "--reason", "controller override with evidence", "--accept-blocked", "--write", "--json"]).stdout);
  assert.equal(allowed.ok, true, "explicit --accept-blocked allows the override");
});


test("a blocked review decision is recoverable: new evidence reopens review and accept clears blockers", () => {
  const root = makeRoot();
  const init = JSON.parse(run(["init", "--root", root, "--demand-key", "UNBLOCK-FIXTURE", "--title", "Unblock Fixture", "--write", "--json"]).stdout);
  run(["add-task-package", "--root", root, "--state-root", init.stateRoot, "--task-package-id", "PKG-1", "--summary", "Pkg", "--target-window", "WinA", "--target-task-id", "TASK-1", "--write", "--json"]);
  run(["import-target-result", "--root", root, "--state-root", init.stateRoot, "--target-task-id", "TASK-1", "--target-window", "WinA", "--status", "blocked", "--summary", "env broken", "--write", "--json"]);
  const reduced1 = JSON.parse(run(["reduce-results", "--root", root, "--state-root", init.stateRoot, "--write", "--json"]).stdout);
  const blockedDecision = JSON.parse(run(["decide-review", "--root", root, "--state-root", init.stateRoot, "--candidate-id", reduced1.candidateId, "--decision", "blocked", "--reason", "blocked pending env fix", "--write", "--json"]).stdout);
  assert.equal(blockedDecision.ok, true);

  // new evidence arrives -> the blocked task must be reviewable again
  const reimport = JSON.parse(run(["import-target-result", "--root", root, "--state-root", init.stateRoot, "--target-task-id", "TASK-1", "--target-window", "WinA", "--status", "completed", "--evidence-ref", "reports/fixed.json", "--write", "--json"]).stdout);
  assert.equal(reimport.ok, true, "import after a blocked decision must work");
  writeStateRootEvidence(root, init.stateRoot, "reports/fixed.json");
  const reduced2 = JSON.parse(run(["reduce-results", "--root", root, "--state-root", init.stateRoot, "--write", "--json"]).stdout);
  assert.equal(reduced2.ok, true, "reduce must form a new candidate from the fresh evidence");
  assert.ok(reduced2.candidateId, "blocked task is reviewable again");

  const accepted = JSON.parse(run(["decide-review", "--root", root, "--state-root", init.stateRoot, "--candidate-id", reduced2.candidateId, "--decision", "accept", "--reason", "fixed and verified", "--write", "--json"]).stdout);
  assert.equal(accepted.ok, true, "accept after unblock must work");

  const state = readJson(path.join(root, init.stateRoot, "wakeflow-state.json"));
  assert.equal((state.blockers ?? []).length, 0, "accept clears review-blockers");
  const added = JSON.parse(run(["add-task-package", "--root", root, "--state-root", init.stateRoot, "--task-package-id", "PKG-2", "--summary", "Next", "--target-window", "WinA", "--target-task-id", "TASK-2", "--write", "--json"]).stdout);
  assert.equal(added.ok, true, "demand is drivable again after the unblock cycle");
});

test("a redesign decision parks the task needs-rework and counts a Design rethink, not a product rework", () => {
  const root = makeRoot();
  const init = JSON.parse(run(["init", "--root", root, "--demand-key", "REDESIGN-FIXTURE", "--title", "Redesign Fixture", "--write", "--json"]).stdout);
  run(["add-task-package", "--root", root, "--state-root", init.stateRoot, "--task-package-id", "PKG-1", "--summary", "Pkg", "--target-window", "WinA", "--target-task-id", "TASK-1", "--write", "--json"]);
  run(["import-target-result", "--root", root, "--state-root", init.stateRoot, "--target-task-id", "TASK-1", "--target-window", "WinA", "--status", "completed", "--evidence-ref", "reports/done.json", "--write", "--json"]);
  writeStateRootEvidence(root, init.stateRoot, "reports/done.json");
  const reduced = JSON.parse(run(["reduce-results", "--root", root, "--state-root", init.stateRoot, "--write", "--json"]).stdout);

  const decided = JSON.parse(run(["decide-review", "--root", root, "--state-root", init.stateRoot, "--candidate-id", reduced.candidateId, "--decision", "redesign", "--reason", "valid implementation but the requirement was wrong — route to Design", "--write", "--json"]).stdout);
  assert.equal(decided.ok, true, "redesign is an accepted decision value");

  const state = readJson(path.join(root, init.stateRoot, "wakeflow-state.json"));
  assert.equal(state.state, "needs-rework", "redesign parks the demand like rework (existing state, no new top-level state)");
  const task = state.targetTasks.find((item) => item.targetTaskId === "TASK-1");
  assert.equal(task.status, "needs-rework");
  assert.equal(task.reviewDecision, "redesign", "the decision marker distinguishes redesign from rework");
  assert.equal(task.counts.redesignCount, 1, "redesignCount increments");
  assert.equal(task.counts.reworkCount ?? 0, 0, "a redesign is NOT a product rework — reworkCount untouched");
  assert.equal((state.blockers ?? []).length, 0, "redesign is not a hard block");

  // needs-rework allows the controller's next package: a Design outcome-redesign, not a product point-fix.
  const added = JSON.parse(run(["add-task-package", "--root", root, "--state-root", init.stateRoot, "--task-package-id", "PKG-2", "--summary", "Design outcome redesign", "--target-window", "Design", "--target-task-id", "TASK-2", "--write", "--json"]).stdout);
  assert.equal(added.ok, true, "after redesign, add a Design redesign task package");
});

test("import-target-result never claims an unclaimed demand and rejects --adopt-host", () => {
  const root = makeRoot();
  const init = JSON.parse(run(["init", "--root", root, "--demand-key", "NOCLAIM-FIXTURE", "--title", "NoClaim", "--write", "--json"]).stdout);
  run(["add-task-package", "--root", root, "--state-root", init.stateRoot, "--task-package-id", "PKG-1", "--summary", "Pkg", "--target-window", "WinA", "--target-task-id", "TASK-1", "--write", "--json"]);
  const stateFile = path.join(root, init.stateRoot, "wakeflow-state.json");
  // simulate the other host owning the demand
  const state = readJson(stateFile);
  state.controllerHost = "some-other-host";
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);

  const refused = run(["import-target-result", "--root", root, "--state-root", init.stateRoot, "--target-task-id", "TASK-1", "--target-window", "WinA", "--status", "completed", "--evidence-ref", "r.json", "--write", "--json"]);
  assert.notEqual(refused.status, 0, "foreign-owned demand refuses import");

  const adoptRefused = run(["import-target-result", "--root", root, "--state-root", init.stateRoot, "--target-task-id", "TASK-1", "--target-window", "WinA", "--status", "completed", "--evidence-ref", "r.json", "--adopt-host", "--write", "--json"]);
  assert.notEqual(adoptRefused.status, 0, "--adopt-host cannot persist from import");
  assert.match(adoptRefused.stdout + adoptRefused.stderr, /state-writing command/);

  // unclaimed: import passes WITHOUT stamping
  const state2 = readJson(stateFile);
  delete state2.controllerHost;
  writeFileSync(stateFile, `${JSON.stringify(state2, null, 2)}\n`);
  const imported = JSON.parse(run(["import-target-result", "--root", root, "--state-root", init.stateRoot, "--target-task-id", "TASK-1", "--target-window", "WinA", "--status", "completed", "--evidence-ref", "r.json", "--write", "--json"]).stdout);
  assert.equal(imported.ok, true);
  assert.equal(readJson(stateFile).controllerHost ?? null, null, "import does not claim");
});


test("import-target-result reports review readiness so reduce is never speculative", () => {
  const root = makeRoot();
  const init = JSON.parse(run(["init", "--root", root, "--demand-key", "READY-FIXTURE", "--title", "Ready", "--write", "--json"]).stdout);
  run(["add-task-package", "--root", root, "--state-root", init.stateRoot, "--task-package-id", "PKG-1", "--summary", "Pkg", "--target-window", "WinA", "--target-task-id", "TASK-1", "--write", "--json"]);
  run(["add-task-package", "--root", root, "--state-root", init.stateRoot, "--task-package-id", "PKG-2", "--summary", "Pkg2", "--target-window", "WinB", "--target-task-id", "TASK-2", "--write", "--json"]);

  const first = JSON.parse(run(["import-target-result", "--root", root, "--state-root", init.stateRoot, "--target-task-id", "TASK-1", "--target-window", "WinA", "--status", "completed", "--evidence-ref", "a.md", "--write", "--json"]).stdout);
  assert.equal(first.reviewReadiness.readyForReduce, false);
  assert.deepEqual(first.reviewReadiness.remainingTaskIds, ["TASK-2"], "names exactly what is still missing");

  const second = JSON.parse(run(["import-target-result", "--root", root, "--state-root", init.stateRoot, "--target-task-id", "TASK-2", "--target-window", "WinB", "--status", "completed", "--evidence-ref", "b.md", "--write", "--json"]).stdout);
  assert.equal(second.reviewReadiness.readyForReduce, true);
  assert.match(second.agentNext, /not controller acceptance.*run reduce-results/);
});

test("import-target-result readiness follows rework-first scope instead of stale results", () => {
  const root = makeRoot();
  const init = JSON.parse(run(["init", "--root", root, "--demand-key", "REWORK-READY-FIXTURE", "--title", "Rework Ready", "--write", "--json"]).stdout);
  run(["add-task-package", "--root", root, "--state-root", init.stateRoot, "--task-package-id", "PKG-1", "--summary", "Needs review", "--target-window", "WinA", "--target-task-id", "TASK-1", "--write", "--json"]);
  run(["import-target-result", "--root", root, "--state-root", init.stateRoot, "--target-task-id", "TASK-1", "--target-window", "WinA", "--status", "completed", "--evidence-ref", "old.md", "--write", "--json"]);
  writeStateRootEvidence(root, init.stateRoot, "old.md", "old evidence\n");
  const reduced = JSON.parse(run(["reduce-results", "--root", root, "--state-root", init.stateRoot, "--write", "--json"]).stdout);
  run(["decide-review", "--root", root, "--state-root", init.stateRoot, "--candidate-id", reduced.candidateId, "--decision", "rework", "--reason", "Needs rework.", "--write", "--json"]);

  const stateRoot = path.join(root, init.stateRoot);
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const state = readJson(stateFile);
  state.taskPackages.push({
    taskPackageId: "PKG-2",
    summary: "Ordinary next step",
    status: "pending",
    createdAt: "2026-06-05T00:01:00.000Z",
  });
  state.targetTasks.push({
    targetTaskId: "TASK-2",
    taskPackageId: "PKG-2",
    targetWindow: "WinB",
    summary: "Ordinary next-step task",
    status: "pending",
    createdAt: "2026-06-05T00:01:00.000Z",
  });
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  writeFileSync(path.join(stateRoot, "task-packages/PKG-2.json"), `${JSON.stringify({
    schemaVersion: 1,
    taskPackageId: "PKG-2",
    demandKey: "REWORK-READY-FIXTURE",
    summary: "Ordinary next step",
    status: "pending",
    targetTasks: [{
      targetTaskId: "TASK-2",
      taskPackageId: "PKG-2",
      targetWindow: "WinB",
      summary: "Ordinary next-step task",
      status: "pending",
    }],
    createdAt: "2026-06-05T00:01:00.000Z",
  }, null, 2)}\n`);

  const ordinary = JSON.parse(run(["import-target-result", "--root", root, "--state-root", init.stateRoot, "--target-task-id", "TASK-2", "--target-window", "WinB", "--status", "completed", "--evidence-ref", "next.md", "--write", "--json"]).stdout);
  assert.equal(ordinary.reviewReadiness.readyForReduce, false);
  assert.equal(ordinary.reviewReadiness.reviewScope.mode, "rework-first-controller-review-targets");
  assert.deepEqual(ordinary.reviewReadiness.remainingTaskIds, ["TASK-1"]);
  assert.deepEqual(ordinary.reviewReadiness.reviewScope.excludedTargetTaskIds, ["TASK-2"]);
  assert.match(ordinary.agentNext, /rework is still open/);
});

test("add-task-package refuses ordinary next-step work while a rework route is active", () => {
  const root = makeRoot();
  const init = JSON.parse(run(["init", "--root", root, "--demand-key", "REWORK-ADD-FIXTURE", "--title", "Rework Add", "--write", "--json"]).stdout);
  run(["add-task-package", "--root", root, "--state-root", init.stateRoot, "--task-package-id", "PKG-1", "--summary", "Needs review", "--target-window", "WinA", "--target-task-id", "TASK-1", "--write", "--json"]);
  const stateFile = path.join(root, init.stateRoot, "wakeflow-state.json");
  const state = readJson(stateFile);
  state.state = "dispatched";
  state.taskPackages[0].status = "sent";
  state.targetTasks[0].status = "sent";
  state.targetTasks[0].reviewRoute = "rework";
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);

  const refused = run(["add-task-package", "--root", root, "--state-root", init.stateRoot, "--task-package-id", "PKG-2", "--summary", "Ordinary next step", "--target-window", "WinB", "--target-task-id", "TASK-2", "--write", "--json"]);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stdout + refused.stderr, /cannot add task package while rework route is active/);

  const needsReworkState = readJson(stateFile);
  needsReworkState.state = "needs-rework";
  needsReworkState.taskPackages[0].status = "needs-rework";
  needsReworkState.targetTasks[0].status = "needs-rework";
  needsReworkState.targetTasks[0].reviewDecision = "rework";
  writeFileSync(stateFile, `${JSON.stringify(needsReworkState, null, 2)}\n`);

  const extension = JSON.parse(run(["add-task-package", "--root", root, "--state-root", init.stateRoot, "--task-package-id", "PKG-R", "--summary", "Rework extension", "--target-window", "WinA", "--target-task-id", "TASK-R", "--write", "--json"]).stdout);
  assert.equal(extension.ok, true);
  const afterExtension = readJson(stateFile);
  assert.equal(afterExtension.taskPackages.find((item) => item.taskPackageId === "PKG-R").reviewRoute, "rework");
  assert.equal(afterExtension.targetTasks.find((item) => item.targetTaskId === "TASK-R").reviewRoute, "rework");

  const secondExtension = JSON.parse(run(["add-task-package", "--root", root, "--state-root", init.stateRoot, "--task-package-id", "PKG-R2", "--summary", "Second rework extension", "--target-window", "WinB", "--target-task-id", "TASK-R2", "--write", "--json"]).stdout);
  assert.equal(secondExtension.ok, true);
  const afterSecondExtension = readJson(stateFile);
  assert.equal(afterSecondExtension.taskPackages.find((item) => item.taskPackageId === "PKG-R2").reviewRoute, "rework");
  assert.equal(afterSecondExtension.targetTasks.find((item) => item.targetTaskId === "TASK-R2").reviewRoute, "rework");
});
