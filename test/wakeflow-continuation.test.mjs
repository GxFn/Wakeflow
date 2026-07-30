#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { handlers, tools } from "../plugins/codex-wakeflow/lib/wakeflow-mcp-tools.mjs";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const stateScript = path.join(pluginRoot, "scripts/wakeflow-state.mjs");

function run(args) {
  return runSync(process.execPath, [stateScript, ...args], { cwd: pluginRoot, encoding: "utf8" });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function makeCompletedDemand(demandKey = "CONT-1") {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-continuation-"));
  writeJson(path.join(root, "wakeflow.config.json"), {
    workspaceName: "Continuation Fixture",
    controllerWindow: "Controller",
    projectLedgerRoot: "wakeflow-ledger",
  });
  const initialized = run([
    "init", "--root", root, "--demand-key", demandKey, "--title", "Completed demand",
    "--write", "--json",
  ]);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  const stateRoot = JSON.parse(initialized.stdout).stateRoot;
  const stateFile = path.join(root, stateRoot, "wakeflow-state.json");
  const completed = run([
    "complete-demand", "--root", root, "--state-root", stateRoot,
    "--reason", "first completion", "--evidence-ref", "reports/first-completion.json",
    "--write", "--json",
  ]);
  assert.equal(completed.status, 0, completed.stderr || completed.stdout);
  return { root, stateRoot, stateFile };
}

function continuationArgs(root, stateRoot, apply = false) {
  return [
    "continue-demand", "--root", root, "--state-root", stateRoot,
    "--continuation-type", "verified-bug",
    "--reason", "The accepted behavior fails the original isolation criterion.",
    "--evidence-ref", "reports/reproduction.json",
    "--task-package-id", "CONT-P1", "--summary", "Repair the verified isolation bug",
    "--target-window", "Plugin", "--target-task-id", "CONT-T1",
    "--source-ref", "reports/reproduction.json",
    ...(apply ? ["--write"] : []), "--json",
  ];
}

function makeCompletedDemandWithAcceptedTask() {
  // Build the fixture through the full state machine. This mirrors the real
  // report: old
  // accepted work must remain accepted while only the continuation is reviewed.
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-continuation-lifecycle-"));
  writeJson(path.join(root, "wakeflow.config.json"), {
    workspaceName: "Continuation Lifecycle Fixture",
    controllerWindow: "Controller",
    projectLedgerRoot: "wakeflow-ledger",
  });
  const initialized = JSON.parse(run([
    "init", "--root", root, "--demand-key", "CONT-LIFECYCLE", "--title", "Lifecycle",
    "--write", "--json",
  ]).stdout);
  const stateRoot = initialized.stateRoot;
  assert.equal(run([
    "add-task-package", "--root", root, "--state-root", stateRoot,
    "--task-package-id", "OLD-P1", "--summary", "Original work",
    "--target-window", "Plugin", "--target-task-id", "OLD-T1", "--write", "--json",
  ]).status, 0);
  mkdirSync(path.join(root, stateRoot, "reports"), { recursive: true });
  writeFileSync(path.join(root, stateRoot, "reports/old.json"), "{}\n");
  assert.equal(run([
    "import-target-result", "--root", root, "--state-root", stateRoot,
    "--target-task-id", "OLD-T1", "--target-window", "Plugin", "--status", "completed",
    "--evidence-ref", "reports/old.json", "--write", "--json",
  ]).status, 0);
  const reduced = JSON.parse(run([
    "reduce-results", "--root", root, "--state-root", stateRoot, "--write", "--json",
  ]).stdout);
  assert.equal(run([
    "decide-review", "--root", root, "--state-root", stateRoot,
    "--candidate-id", reduced.candidateId, "--decision", "accept", "--reason", "original accepted",
    "--evidence-ref", "reports/old.json", "--write", "--json",
  ]).status, 0);
  assert.equal(run([
    "complete-demand", "--root", root, "--state-root", stateRoot,
    "--reason", "original demand complete", "--evidence-ref", "reports/old.json", "--write", "--json",
  ]).status, 0);
  return { root, stateRoot, stateFile: path.join(root, stateRoot, "wakeflow-state.json") };
}

test("continue-demand dry-run preserves the completed state and creates no package", () => {
  const { root, stateRoot, stateFile } = makeCompletedDemand("CONT-DRY");
  const before = readFileSync(stateFile, "utf8");
  const result = run(continuationArgs(root, stateRoot));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.wrote, false);
  assert.equal(payload.previousState, "completed");
  assert.equal(payload.nextState, "planned");
  assert.equal(readFileSync(stateFile, "utf8"), before);
  assert.equal(existsSync(path.join(root, stateRoot, "task-packages/CONT-P1.json")), false);
});

test("continue-demand preserves completion history and adds the first package in one locked operation", () => {
  const { root, stateRoot, stateFile } = makeCompletedDemand("CONT-WRITE");
  const result = run(continuationArgs(root, stateRoot, true));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.wrote, true);
  assert.equal(payload.continuation.type, "verified-bug");

  const state = readJson(stateFile);
  assert.equal(state.state, "planned");
  assert.equal(state.review.status, "none");
  assert.equal(state.taskPackages.at(-1).taskPackageId, "CONT-P1");
  assert.equal(state.taskPackages.at(-1).continuation.type, "verified-bug");
  assert.equal(state.targetTasks.at(-1).targetTaskId, "CONT-T1");
  assert.equal(state.targetTasks.at(-1).status, "pending");
  assert.deepEqual(state.allowedActions, ["prepare-dispatch-from-state", "add-task-package", "wakeflow-render-progress"]);

  const packageRecord = readJson(path.join(root, stateRoot, "task-packages/CONT-P1.json"));
  assert.equal(packageRecord.continuation.priorCompletionRevision, 2);
  const events = readFileSync(path.join(root, stateRoot, "controller-events.jsonl"), "utf8")
    .trim().split("\n").map(JSON.parse);
  assert.equal(events[0].type, "state.initialized", "the earlier history remains present");
  assert.equal(events.at(-2).type, "demand.completed", "the prior completion remains an explicit historical event");
  assert.equal(packageRecord.continuation.priorCompletionEventId, events.at(-2).eventId);
  assert.equal(events.at(-1).type, "demand.continued");
  assert.equal(events.at(-1).from, "completed");
  assert.equal(events.at(-1).to, "planned");
  assert.match(readFileSync(path.join(root, stateRoot, "developer-progress.md"), "utf8"), /demand continued \(verified-bug\)/);
  assert.match(readFileSync(path.join(root, ".wakeflow-active/current/workspace-current-status.md"), "utf8"), /Status: active/);
});

test("continued demand completes again through the normal result/review lifecycle without reopening old tasks", () => {
  const { root, stateRoot, stateFile } = makeCompletedDemandWithAcceptedTask();
  const continued = run(continuationArgs(root, stateRoot, true));
  assert.equal(continued.status, 0, continued.stderr || continued.stdout);

  writeFileSync(path.join(root, stateRoot, "reports/new.json"), "{}\n");
  const imported = run([
    "import-target-result", "--root", root, "--state-root", stateRoot,
    "--target-task-id", "CONT-T1", "--target-window", "Plugin", "--status", "completed",
    "--evidence-ref", "reports/new.json", "--write", "--json",
  ]);
  assert.equal(imported.status, 0, imported.stderr || imported.stdout);
  const reduced = JSON.parse(run([
    "reduce-results", "--root", root, "--state-root", stateRoot, "--write", "--json",
  ]).stdout);
  const candidate = readJson(path.join(root, stateRoot, `transition-candidates/${reduced.candidateId}.json`));
  assert.deepEqual(candidate.targetTaskIds, ["CONT-T1"], "accepted tasks from the prior completion stay outside the new review scope");
  assert.equal(run([
    "decide-review", "--root", root, "--state-root", stateRoot,
    "--candidate-id", reduced.candidateId, "--decision", "accept", "--reason", "continuation accepted",
    "--evidence-ref", "reports/new.json", "--write", "--json",
  ]).status, 0);
  const completedAgain = run([
    "complete-demand", "--root", root, "--state-root", stateRoot,
    "--reason", "continuation complete", "--evidence-ref", "reports/new.json", "--write", "--json",
  ]);
  assert.equal(completedAgain.status, 0, completedAgain.stderr || completedAgain.stdout);

  const state = readJson(stateFile);
  assert.equal(state.state, "completed");
  assert.deepEqual(state.targetTasks.map((task) => [task.targetTaskId, task.status]), [
    ["OLD-T1", "accepted"],
    ["CONT-T1", "accepted"],
  ]);
  const events = readFileSync(path.join(root, stateRoot, "controller-events.jsonl"), "utf8")
    .trim().split("\n").map(JSON.parse);
  assert.equal(events.filter((event) => event.type === "demand.completed").length, 2);
  assert.equal(events.filter((event) => event.type === "demand.continued").length, 1);
});

test("continue-demand refuses active or archived roots and requires evidence", () => {
  const active = makeCompletedDemand("CONT-ACTIVE");
  const activeState = readJson(active.stateFile);
  writeJson(active.stateFile, { ...activeState, state: "planned" });
  const activeResult = run(continuationArgs(active.root, active.stateRoot, true));
  assert.notEqual(activeResult.status, 0);
  assert.match(activeResult.stdout, /requires state=completed/);

  const archived = makeCompletedDemand("CONT-ARCHIVED");
  const archivedState = readJson(archived.stateFile);
  writeJson(archived.stateFile, { ...archivedState, state: "archived" });
  const archivedResult = run(continuationArgs(archived.root, archived.stateRoot, true));
  assert.notEqual(archivedResult.status, 0);
  assert.match(archivedResult.stdout, /Archived demand history is immutable/);

  const missingEvidence = makeCompletedDemand("CONT-NO-EVIDENCE");
  const args = continuationArgs(missingEvidence.root, missingEvidence.stateRoot, true);
  const evidenceIndex = args.indexOf("--evidence-ref");
  args.splice(evidenceIndex, 2);
  const missingResult = run(args);
  assert.notEqual(missingResult.status, 0);
  assert.match(missingResult.stdout, /requires at least one --evidence-ref/);

  const inconsistent = makeCompletedDemand("CONT-INCONSISTENT");
  const inconsistentState = readJson(inconsistent.stateFile);
  writeJson(inconsistent.stateFile, {
    ...inconsistentState,
    taskPackages: [{ taskPackageId: "OLD-OPEN", status: "pending" }],
  });
  const inconsistentResult = run(continuationArgs(inconsistent.root, inconsistent.stateRoot, true));
  assert.notEqual(inconsistentResult.status, 0);
  assert.match(inconsistentResult.stdout, /inconsistent completed state with non-accepted history/);
});

test("MCP exposes continue-demand and cancel forwards root to the state runtime", async () => {
  const continuationTool = tools.find((tool) => tool.name === "wakeflow_continue_demand");
  assert.ok(continuationTool);
  assert.deepEqual(continuationTool.inputSchema.properties.continuationType.enum,
    ["verified-bug", "requirement-supplement", "optimization"]);
  assert.equal(continuationTool.inputSchema.properties.acceptanceAnchors.type, "array");

  const continued = makeCompletedDemand("CONT-MCP");
  mkdirSync(path.join(continued.root, "decisions"), { recursive: true });
  writeFileSync(
    path.join(continued.root, "decisions/user-confirmation.md"),
    "# Confirmation\n\n## Confirmed supplement\n\nThe missing case remains in the original completion scope.\n",
  );
  const continuationResult = await handlers.wakeflow_continue_demand({
    root: continued.root,
    stateRoot: continued.stateRoot,
    continuationType: "requirement-supplement",
    reason: "The user confirmed this missing case remains in the original completion scope.",
    evidenceRefs: ["decisions/user-confirmation.md"],
    taskId: "CONT-MCP-T1",
    packageId: "CONT-MCP-P1",
    targetWindow: "Plugin",
    summary: "Implement the confirmed supplement",
    workType: "implementation",
    objective: "Implement the confirmed missing case without reopening accepted history.",
    contextSummary: ["The user confirmed this case remains in the original demand scope."],
    requirementRefs: [{ ref: "decisions/user-confirmation.md#confirmed-supplement", role: "goal" }],
    boundaries: {
      inScope: ["The confirmed supplemental case."],
      outOfScope: ["Previously accepted behavior."],
      forbidden: ["Do not rewrite accepted task history."],
    },
    completionExpectations: ["The supplemental regression passes through the public entrypoint."],
    dependsOnTaskIds: [],
    commitExpectation: "leave-uncommitted",
    acceptanceAnchors: [{
      id: "AC-CONT-1",
      claim: "The confirmed supplemental case is handled.",
      probe: "Run the supplemental regression through the public entrypoint.",
      expected: "The previously missing case succeeds.",
    }],
    apply: true,
  });
  assert.equal(continuationResult.ok, true, continuationResult.stderr || continuationResult.stdout);
  const continuedState = readJson(continued.stateFile);
  assert.equal(continuedState.state, "planned");
  assert.equal(continuedState.taskPackages.at(-1).acceptanceAnchors[0].id, "AC-CONT-1");

  const cancelled = makeCompletedDemand("CANCEL-MCP-ROOT");
  const cancelState = readJson(cancelled.stateFile);
  writeJson(cancelled.stateFile, { ...cancelState, state: "planned", review: { ...cancelState.review, status: "none" } });
  const cancelResult = await handlers.wakeflow_cancel_demand({
    root: cancelled.root,
    stateRoot: cancelled.stateRoot,
    reason: "fixture cancellation",
    apply: true,
  });
  assert.equal(cancelResult.ok, true, cancelResult.stderr || cancelResult.stdout);
  assert.equal(readJson(cancelled.stateFile).state, "cancelled");
  assert.ok(cancelResult.args.includes(cancelled.root), "the MCP adapter must pass --root, not only change cwd");
});
