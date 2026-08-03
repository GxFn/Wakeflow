#!/usr/bin/env node

import assert from "node:assert/strict";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runSync } from "../core/lib/wakeflow-process.mjs";

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const coreRoot = path.join(projectRoot, "core");
const codexPluginRoot = path.join(projectRoot, "plugins/codex-wakeflow");
const templateBundle = path.join(projectRoot, "plugins/codex-wakeflow/templates/wakeflow-template-bundle.json");

function makeCoreRuntime() {
  const parent = mkdtempSync(path.join(os.tmpdir(), "wakeflow-core-runtime-"));
  const runtimeRoot = path.join(parent, "wakeflow");
  cpSync(coreRoot, runtimeRoot, { recursive: true });
  mkdirSync(path.join(runtimeRoot, "templates"), { recursive: true });
  copyFileSync(templateBundle, path.join(runtimeRoot, "templates/wakeflow-template-bundle.json"));
  copyFileSync(
    path.join(codexPluginRoot, "scripts/lib/wakeflow-host-send-adapter.mjs"),
    path.join(runtimeRoot, "scripts/lib/wakeflow-host-send-adapter.mjs"),
  );
  return runtimeRoot;
}

function run(runtimeRoot, args) {
  const stateScript = path.join(runtimeRoot, "scripts/wakeflow-state.mjs");
  return runSync(process.execPath, [stateScript, ...args], {
    cwd: runtimeRoot,
    encoding: "utf8",
  });
}

function runDelivery(runtimeRoot, args) {
  const deliveryScript = path.join(runtimeRoot, "scripts/wakeflow-delivery.mjs");
  return runSync(process.execPath, [deliveryScript, ...args], {
    cwd: runtimeRoot,
    encoding: "utf8",
  });
}

function runTodo(runtimeRoot, args) {
  const todoScript = path.join(runtimeRoot, "scripts/wakeflow-todo.mjs");
  return runSync(process.execPath, [todoScript, ...args], {
    cwd: runtimeRoot,
    encoding: "utf8",
  });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeEvidence(root, stateRoot, ref) {
  const file = path.join(root, stateRoot, ref);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "{}\n");
}

test("a same-repository task without replacesTargetTaskId cannot cover an old redesign task", () => {
  const runtimeRoot = makeCoreRuntime();
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-product-companion-"));
  writeFileSync(path.join(root, "wakeflow.config.json"), `${JSON.stringify({
    workspaceName: "CompanionFixture",
    controllerWindow: "Controller",
    designWindow: "Design",
    testWindow: "Test",
    realProjectWindow: "RealProject",
    repoNames: ["ProductRepo"],
    repositories: [
      { windowName: "ProductRepo", path: "ProductRepo", role: "Product repository" },
      { windowName: "Controller", path: ".", role: "Controller" },
      { windowName: "Design", path: "Design", role: "Design support" },
      { windowName: "Test", path: "Test", role: "Test support" },
      { windowName: "RealProject", path: "RealProject", role: "Real project fixture" },
      { windowName: "Support", path: "Support", role: "Auxiliary support" },
    ],
  }, null, 2)}\n`);
  writeFileSync(path.join(root, "requirements.md"), [
    "# Goal",
    "",
    "Replace the redesigned implementation without rewriting history.",
  ].join("\n"));

  const initResult = run(runtimeRoot, [
    "init", "--root", root,
    "--demand-key", "PRODUCT-COMPANION",
    "--title", "Product companion boundary",
    "--write", "--json",
  ]);
  assert.equal(initResult.status, 0, initResult.stderr || initResult.stdout);
  const init = JSON.parse(initResult.stdout);
  const stateFile = path.join(root, init.stateRoot, "wakeflow-state.json");

  const addTask = (packageId, taskId, targetWindow) => {
    const result = run(runtimeRoot, [
      "add-task-package", "--root", root, "--state-root", init.stateRoot,
      "--task-package-id", packageId,
      "--summary", `Implement ${taskId}.`,
      "--target-window", targetWindow,
      "--target-task-id", taskId,
      "--write", "--json",
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  const importResult = (taskId, targetWindow) => {
    const evidenceRef = `reports/${taskId}.json`;
    const result = run(runtimeRoot, [
      "import-target-result", "--root", root, "--state-root", init.stateRoot,
      "--target-task-id", taskId,
      "--target-window", targetWindow,
      "--status", "completed",
      "--result-id", `RESULT-${taskId}`,
      "--evidence-ref", evidenceRef,
      "--write", "--json",
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    writeEvidence(root, init.stateRoot, evidenceRef);
  };
  const reduce = () => {
    const result = run(runtimeRoot, [
      "reduce-results", "--root", root, "--state-root", init.stateRoot,
      "--write", "--json",
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  };

  addTask("PKG-ORIGINAL", "TASK-ORIGINAL", "ProductRepo");
  importResult("TASK-ORIGINAL", "ProductRepo");
  const originalCandidate = reduce();
  assert.ok(originalCandidate.candidateId);
  const redesign = run(runtimeRoot, [
    "decide-review", "--root", root, "--state-root", init.stateRoot,
    "--candidate-id", originalCandidate.candidateId,
    "--decision", "redesign",
    "--reason", "The product requirement needs a corrected implementation.",
    "--write", "--json",
  ]);
  assert.equal(redesign.status, 0, redesign.stderr || redesign.stdout);

  const directRedispatch = runDelivery(runtimeRoot, [
    "prepare-dispatch-from-state", "--root", root, "--state-root", init.stateRoot,
    "--target-task-id", "TASK-ORIGINAL", "--write", "--json",
  ]);
  assert.notEqual(directRedispatch.status, 0, "redesign must require a new explicit replacement task");
  assert.match(directRedispatch.stdout + directRedispatch.stderr, /replacesTargetTaskId|explicit replacement/i);

  const nonProductReplacement = (targetWindow, suffix) => run(runtimeRoot, [
    "add-task-package", "--root", root, "--state-root", init.stateRoot,
    "--task-package-id", `PKG-NON-PRODUCT-${suffix}`,
    "--summary", `Invalid replacement through ${targetWindow}.`,
    "--target-window", targetWindow,
    "--target-task-id", `TASK-NON-PRODUCT-${suffix}`,
    "--replaces-target-task-id", "TASK-ORIGINAL",
    "--work-type", "implementation",
    "--objective", "Implement the corrected product behavior.",
    "--context-summary", JSON.stringify(["The original task was rejected by redesign."]),
    "--requirement-refs", JSON.stringify([{ ref: "requirements.md#goal", role: "goal" }]),
    "--boundaries", JSON.stringify({
      inScope: ["Implement the corrected product behavior."],
      outOfScope: ["Unrelated repositories."],
      forbidden: ["Rewrite superseded history."],
    }),
    "--completion-expectations", JSON.stringify(["The corrected behavior is independently reviewable."]),
    "--depends-on-task-ids", "[]",
    "--commit-expectation", "leave-uncommitted",
    "--acceptance-anchors", JSON.stringify([{
      id: `replacement-${suffix}`,
      claim: "The corrected product behavior replaces the rejected outcome.",
      probe: "Run the focused product verification.",
      expected: "The corrected outcome passes.",
    }]),
    "--write", "--json",
  ]);
  for (const [targetWindow, suffix] of [
    ["Controller", "CONTROLLER"],
    ["RealProject", "REAL-PROJECT"],
    ["Support", "SUPPORT"],
    ["Unknown", "UNKNOWN"],
  ]) {
    const invalidReplacement = nonProductReplacement(targetWindow, suffix);
    assert.notEqual(
      invalidReplacement.status,
      0,
      `${targetWindow} must not supersede product work merely because it is a configured or named window`,
    );
    assert.match(
      invalidReplacement.stdout + invalidReplacement.stderr,
      /product responsibility window/,
    );
  }

  const unrelatedTask = run(runtimeRoot, [
    "add-task-package", "--root", root, "--state-root", init.stateRoot,
    "--task-package-id", "PKG-PRODUCT",
    "--summary", "Implicit same-repository replacement.",
    "--target-window", "ProductRepo__POD-A",
    "--target-task-id", "TASK-PRODUCT",
    "--write", "--json",
  ]);
  assert.notEqual(unrelatedTask.status, 0, "a same-repository task cannot create an implicit replacement branch");
  assert.match(unrelatedTask.stdout + unrelatedTask.stderr, /explicit replacesTargetTaskId/);
  const afterSameRepositoryTask = reduce();
  assert.equal(afterSameRepositoryTask.candidateId, null);
  assert.equal(afterSameRepositoryTask.reviewStatus, "rework-route-waiting-results");
  assert.deepEqual(afterSameRepositoryTask.missingResultIds, ["TASK-ORIGINAL"]);
  assert.equal(
    readJson(stateFile).targetTasks.find((task) => task.targetTaskId === "TASK-ORIGINAL").status,
    "needs-rework",
  );
  assert.equal(
    readJson(stateFile).targetTasks.some((task) => task.targetTaskId === "TASK-PRODUCT"),
    false,
  );
});

test("an explicit redesign replacement supersedes the old task and the demand can complete", () => {
  const runtimeRoot = makeCoreRuntime();
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-product-lineage-"));
  writeFileSync(path.join(root, "wakeflow.config.json"), `${JSON.stringify({
    workspaceName: "LineageFixture",
    controllerWindow: "Controller",
    repoNames: ["RepoA", "RepoB"],
    repositories: [
      { windowName: "RepoA", path: "RepoA", role: "Product repository A" },
      { windowName: "RepoB", path: "RepoB", role: "Product repository B" },
      { windowName: "Controller", path: ".", role: "Controller" },
    ],
  }, null, 2)}\n`);
  writeFileSync(path.join(root, "requirements.md"), [
    "# Goal",
    "",
    "Replace the redesigned implementation without rewriting history.",
  ].join("\n"));

  const initResult = run(runtimeRoot, [
    "init", "--root", root,
    "--demand-key", "PRODUCT-LINEAGE",
    "--title", "Product companion lineage",
    "--write", "--json",
  ]);
  assert.equal(initResult.status, 0, initResult.stderr || initResult.stdout);
  const init = JSON.parse(initResult.stdout);

  const addTask = (
    packageId,
    taskId,
    targetWindow,
    replacesTargetTaskId = "",
    requirementRef = "requirements.md#goal",
  ) => {
    const result = run(runtimeRoot, [
      "add-task-package", "--root", root, "--state-root", init.stateRoot,
      "--task-package-id", packageId,
      "--summary", `Implement ${taskId}.`,
      "--target-window", targetWindow,
      "--target-task-id", taskId,
      ...(replacesTargetTaskId ? ["--replaces-target-task-id", replacesTargetTaskId] : []),
      ...(replacesTargetTaskId ? [
        "--work-type", "implementation",
        "--objective", `Implement the corrected behavior in ${targetWindow}.`,
        "--context-summary", JSON.stringify(["The original task was rejected by an explicit redesign decision."]),
        "--requirement-refs", JSON.stringify([{ ref: requirementRef, role: "goal" }]),
        "--boundaries", JSON.stringify({
          inScope: ["Implement the corrected product behavior."],
          outOfScope: ["Unrelated repositories."],
          forbidden: ["Rewrite the superseded task history."],
        }),
        "--completion-expectations", JSON.stringify(["The corrected behavior is independently reviewable."]),
        "--depends-on-task-ids", "[]",
        "--commit-expectation", "leave-uncommitted",
        "--acceptance-anchors", JSON.stringify([{
          id: "replacement-behavior",
          claim: "The corrected behavior replaces the rejected outcome.",
          probe: "Run the focused product verification.",
          expected: "The corrected outcome passes without mutating old history.",
        }]),
      ] : []),
      "--write", "--json",
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  const importResult = (taskId, targetWindow, { replacement = false } = {}) => {
    const evidenceRef = `evidence/${taskId}.md`;
    mkdirSync(path.join(root, init.stateRoot, "evidence"), { recursive: true });
    writeFileSync(path.join(root, init.stateRoot, evidenceRef), `${taskId} focused verification passed.\n`);
    const result = run(runtimeRoot, [
      "import-target-result", "--root", root, "--state-root", init.stateRoot,
      "--target-task-id", taskId,
      "--target-window", targetWindow,
      "--status", "completed",
      "--summary", `${taskId} completed.`,
      "--evidence-ref", evidenceRef,
      "--commit-disposition", "no-changes",
      ...(replacement ? [
        "--craft-evidence", JSON.stringify([{
          kind: "acceptance-anchor",
          anchorId: "replacement-behavior",
          red: "The original target result was explicitly rejected for redesign.",
          green: "The replacement passed the focused product verification.",
          ref: evidenceRef,
        }]),
      ] : []),
      "--write", "--json",
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  const reduce = () => {
    const result = run(runtimeRoot, [
      "reduce-results", "--root", root, "--state-root", init.stateRoot,
      "--write", "--json",
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  };

  addTask("PKG-A", "TASK-A", "RepoA");
  importResult("TASK-A", "RepoA");
  const originalCandidate = reduce();
  const redesign = run(runtimeRoot, [
    "decide-review", "--root", root, "--state-root", init.stateRoot,
    "--candidate-id", originalCandidate.candidateId,
    "--decision", "redesign",
    "--reason", "The requirement must be replaced explicitly.",
    "--write", "--json",
  ]);
  assert.equal(redesign.status, 0, redesign.stderr || redesign.stdout);

  const todoBoard = path.join(root, ".wakeflow-active/current/global-todo-board.md");
  mkdirSync(path.dirname(todoBoard), { recursive: true });
  writeFileSync(todoBoard, [
    "# Global TODO",
    "",
    "## Global TODO",
    "",
    "| ID | Status | Type | Priority | Owner | Item / Goal | Affects Retest / Dispatch | Dependency / Trigger | Recommended Window | Current Mount | Auto Claim | Testing Decision | Documents |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    "",
  ].join("\n"));
  writeFileSync(path.join(root, "corrected-requirement.md"), [
    "# Goal",
    "",
    "Implement the corrected behavior without accepting the rejected result.",
  ].join("\n"));
  const designDelivery = runTodo(runtimeRoot, [
    "deliver", "--root", root,
    "--type", "supplement",
    "--design-key", "product-redesign-2026-07-30",
    "--title", "Corrected product requirement",
    "--requirement-design", "corrected-requirement.md",
    "--apply", "--json",
  ]);
  assert.equal(designDelivery.status, 0, designDelivery.stderr || designDelivery.stdout);
  assert.match(
    readFileSync(todoBoard, "utf8"),
    /\| product-redesign-2026-07-30 \| pending-claim \| supplement \|/,
    "Design correction must arrive through the stateless append-only delivery surface",
  );

  const researchReplacement = run(runtimeRoot, [
    "add-task-package", "--root", root, "--state-root", init.stateRoot,
    "--task-package-id", "PKG-A-RESEARCH",
    "--summary", "Research cannot replace product work.",
    "--target-window", "RepoA__POD-RESEARCH",
    "--target-task-id", "TASK-A-RESEARCH",
    "--replaces-target-task-id", "TASK-A",
    "--work-type", "research",
    "--objective", "Inspect the redesigned behavior.",
    "--context-summary", JSON.stringify(["The original task was redesigned."]),
    "--requirement-refs", JSON.stringify([{ ref: "requirements.md#goal", role: "goal" }]),
    "--boundaries", JSON.stringify({ inScope: ["Read-only inspection."], outOfScope: [], forbidden: ["Product changes."] }),
    "--completion-expectations", JSON.stringify(["Return a read-only finding."]),
    "--depends-on-task-ids", "[]",
    "--commit-expectation", "leave-uncommitted",
    "--write", "--json",
  ]);
  assert.notEqual(researchReplacement.status, 0);
  assert.match(researchReplacement.stdout + researchReplacement.stderr, /implementation task package/);

  addTask(
    "PKG-A-FIX",
    "TASK-A-FIX",
    "RepoA__POD-A",
    "TASK-A",
    "corrected-requirement.md#goal",
  );
  const linkedState = readJson(path.join(root, init.stateRoot, "wakeflow-state.json"));
  const oldTask = linkedState.targetTasks.find((task) => task.targetTaskId === "TASK-A");
  const replacementTask = linkedState.targetTasks.find((task) => task.targetTaskId === "TASK-A-FIX");
  assert.equal(oldTask.replacedByTargetTaskId, "TASK-A-FIX");
  assert.equal(replacementTask.replacesTargetTaskId, "TASK-A");

  importResult("TASK-A-FIX", "RepoA__POD-A", { replacement: true });
  const replacementReviewPackResult = runDelivery(runtimeRoot, [
    "review-pack", "--root", root, "--state-root", init.stateRoot, "--json",
  ]);
  assert.equal(replacementReviewPackResult.status, 0, replacementReviewPackResult.stderr || replacementReviewPackResult.stdout);
  const replacementReviewPack = JSON.parse(replacementReviewPackResult.stdout).reviewPack;
  assert.equal(replacementReviewPack.gates.reviewInputsComplete, true);
  assert.deepEqual(
    replacementReviewPack.groupSnapshot.ready.map((item) => item.taskId),
    ["TASK-A-FIX"],
  );
  const replacementCandidate = reduce();
  assert.ok(replacementCandidate.candidateId);
  assert.deepEqual(replacementCandidate.targetTaskIds, ["TASK-A-FIX"]);

  const accepted = run(runtimeRoot, [
    "decide-review", "--root", root, "--state-root", init.stateRoot,
    "--candidate-id", replacementCandidate.candidateId,
    "--decision", "accept",
    "--reason", "The explicit replacement is verified.",
    "--write", "--json",
  ]);
  assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);

  const acceptedState = readJson(path.join(root, init.stateRoot, "wakeflow-state.json"));
  assert.equal(
    acceptedState.targetTasks.find((task) => task.targetTaskId === "TASK-A").status,
    "superseded",
  );
  assert.equal(
    acceptedState.targetTasks.find((task) => task.targetTaskId === "TASK-A-FIX").status,
    "accepted",
  );
  assert.equal(
    acceptedState.taskPackages.find((taskPackage) => taskPackage.taskPackageId === "PKG-A").status,
    "superseded",
  );
  const stateBeforeLateResult = readFileSync(path.join(root, init.stateRoot, "wakeflow-state.json"), "utf8");
  const lateOldResult = run(runtimeRoot, [
    "import-target-result", "--root", root, "--state-root", init.stateRoot,
    "--target-task-id", "TASK-A",
    "--target-window", "RepoA",
    "--status", "completed",
    "--summary", "A late result must not revive superseded work.",
    "--supersede-result",
    "--write", "--json",
  ]);
  assert.notEqual(lateOldResult.status, 0);
  assert.match(lateOldResult.stdout + lateOldResult.stderr, /already superseded/);
  assert.equal(
    readFileSync(path.join(root, init.stateRoot, "wakeflow-state.json"), "utf8"),
    stateBeforeLateResult,
  );

  const completionEvidence = path.join(root, init.stateRoot, "reports/completion.json");
  mkdirSync(path.dirname(completionEvidence), { recursive: true });
  writeFileSync(completionEvidence, "{}\n");
  const completed = run(runtimeRoot, [
    "complete-demand", "--root", root, "--state-root", init.stateRoot,
    "--reason", "The explicit replacement is accepted.",
    "--evidence-ref", "reports/completion.json",
    "--write", "--json",
  ]);
  assert.equal(completed.status, 0, completed.stderr || completed.stdout);
  assert.equal(readJson(path.join(root, init.stateRoot, "wakeflow-state.json")).state, "completed");
});
