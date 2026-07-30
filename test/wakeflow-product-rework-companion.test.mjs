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

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeEvidence(root, stateRoot, ref) {
  const file = path.join(root, stateRoot, ref);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "{}\n");
}

test("only configured product repo results can cover an old redesign task", () => {
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

  addTask("PKG-REAL", "TASK-REAL", "RealProject");
  importResult("TASK-REAL", "RealProject");
  const afterRealProject = reduce();
  assert.equal(afterRealProject.candidateId, null);
  assert.equal(afterRealProject.reviewStatus, "rework-route-waiting-results");
  assert.deepEqual(afterRealProject.missingResultIds, ["TASK-ORIGINAL"]);
  assert.equal(
    readJson(stateFile).targetTasks.find((task) => task.targetTaskId === "TASK-ORIGINAL").status,
    "needs-rework",
  );

  addTask("PKG-SUPPORT", "TASK-SUPPORT", "Support");
  importResult("TASK-SUPPORT", "Support");
  const afterSupport = reduce();
  assert.equal(afterSupport.candidateId, null);
  assert.equal(afterSupport.reviewStatus, "rework-route-waiting-results");
  assert.deepEqual(afterSupport.missingResultIds, ["TASK-ORIGINAL"]);
  assert.equal(
    readJson(stateFile).targetTasks.find((task) => task.targetTaskId === "TASK-ORIGINAL").status,
    "needs-rework",
  );

  // Pod/worktree suffixes keep the base product-repository identity.
  addTask("PKG-PRODUCT", "TASK-PRODUCT", "ProductRepo__POD-A");
  importResult("TASK-PRODUCT", "ProductRepo__POD-A");
  const productCandidate = reduce();
  assert.ok(productCandidate.candidateId, "a configured product repo companion unlocks review");

  const accepted = run(runtimeRoot, [
    "decide-review", "--root", root, "--state-root", init.stateRoot,
    "--candidate-id", productCandidate.candidateId,
    "--decision", "accept",
    "--reason", "Corrected product implementation is verified.",
    "--write", "--json",
  ]);
  assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
  assert.equal(
    readJson(stateFile).targetTasks.find((task) => task.targetTaskId === "TASK-ORIGINAL").status,
    "accepted",
  );
});

test("a product companion covers only pending anchors from the same configured repo lineage", () => {
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

  const initResult = run(runtimeRoot, [
    "init", "--root", root,
    "--demand-key", "PRODUCT-LINEAGE",
    "--title", "Product companion lineage",
    "--write", "--json",
  ]);
  assert.equal(initResult.status, 0, initResult.stderr || initResult.stdout);
  const init = JSON.parse(initResult.stdout);

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
    const result = run(runtimeRoot, [
      "import-target-result", "--root", root, "--state-root", init.stateRoot,
      "--target-task-id", taskId,
      "--target-window", targetWindow,
      "--status", "completed",
      "--summary", `${taskId} completed.`,
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
  addTask("PKG-B", "TASK-B", "RepoB");
  importResult("TASK-A", "RepoA");
  importResult("TASK-B", "RepoB");
  const originalCandidate = reduce();
  const rework = run(runtimeRoot, [
    "decide-review", "--root", root, "--state-root", init.stateRoot,
    "--candidate-id", originalCandidate.candidateId,
    "--decision", "rework",
    "--reason", "Both product repositories require corrections.",
    "--write", "--json",
  ]);
  assert.equal(rework.status, 0, rework.stderr || rework.stdout);

  addTask("PKG-A-FIX", "TASK-A-FIX", "RepoA__POD-A");
  importResult("TASK-A-FIX", "RepoA__POD-A");
  const reviewAfterOnlyA = runDelivery(runtimeRoot, [
    "review-pack", "--root", root, "--state-root", init.stateRoot, "--json",
  ]);
  assert.equal(reviewAfterOnlyA.status, 0, reviewAfterOnlyA.stderr || reviewAfterOnlyA.stdout);
  const reviewPack = JSON.parse(reviewAfterOnlyA.stdout).reviewPack;
  assert.equal(reviewPack.gates.controllerReviewReady, false);
  assert.deepEqual(
    reviewPack.groupSnapshot.missing.map((item) => item.taskId),
    ["TASK-B"],
  );
  const onlyA = reduce();
  assert.equal(onlyA.candidateId, null);
  assert.deepEqual(onlyA.missingResultIds, ["TASK-B"]);

  addTask("PKG-B-FIX", "TASK-B-FIX", "RepoB");
  importResult("TASK-B-FIX", "RepoB");
  const bothRepos = reduce();
  assert.ok(bothRepos.candidateId, "each configured repo lineage now has a current companion");
  assert.deepEqual(bothRepos.missingResultIds, []);
});
