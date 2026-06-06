#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const fixturesRoot = path.join(workspaceRoot, "scripts/fixtures/control-state-machine");
const controllerScript = path.join(workspaceRoot, "scripts/controller-state.mjs");
const renderScript = path.join(workspaceRoot, "scripts/render-progress-doc.mjs");
const appendScript = path.join(workspaceRoot, "scripts/append-progress-log.mjs");
const automationScript = path.join(workspaceRoot, "scripts/codex-automation-loop.mjs");

function readFixture(name) {
  return JSON.parse(readFileSync(path.join(fixturesRoot, name, "manifest.json"), "utf8"));
}

function makeRoot(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runNode(script, args, root) {
  return spawnSync("node", [script, ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      TZ: "UTC",
    },
  });
}

function runController(args, root) {
  return runNode(controllerScript, [...args, "--root", root, "--json"], root);
}

function runRender(args, root) {
  return runNode(renderScript, [...args, "--root", root, "--json"], root);
}

function runAppend(args, root) {
  return runNode(appendScript, [...args, "--root", root, "--json"], root);
}

function runAutomation(args, root) {
  return runNode(automationScript, [...args, "--root", root, "--json"], root);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function initDemand(root, manifest) {
  const init = runController([
    "init",
    "--demand-key",
    manifest.demandKey,
    "--title",
    manifest.title,
    "--goal",
    manifest.goal,
    "--completion-definition",
    manifest.completionDefinition,
    "--stage-plan",
    manifest.stagePlan,
    "--write",
  ], root);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  const payload = JSON.parse(init.stdout);
  return {
    payload,
    stateRootRef: payload.stateRoot,
    stateRoot: path.join(root, payload.stateRoot),
  };
}

function addTaskPackage(root, stateRootRef, manifest) {
  const task = manifest.taskPackage;
  const result = runController([
    "add-task-package",
    "--state-root",
    stateRootRef,
    "--task-package-id",
    task.taskPackageId,
    "--summary",
    task.summary,
    "--source-ref",
    task.sourceRef,
    "--target-window",
    task.targetWindow,
    "--target-task-id",
    task.targetTaskId,
    "--target-summary",
    task.targetSummary,
    "--write",
  ], root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function importResult(root, stateRootRef, manifest) {
  const task = manifest.taskPackage;
  const resultConfig = manifest.result;
  const args = [
    "import-target-result",
    "--state-root",
    stateRootRef,
    "--target-task-id",
    task.targetTaskId,
    "--target-window",
    task.targetWindow,
    "--status",
    resultConfig.status,
    "--result-id",
    resultConfig.resultId,
    "--summary",
    resultConfig.summary,
    "--evidence-ref",
    resultConfig.evidenceRef,
    "--verification",
    resultConfig.verification,
    "--write",
  ];
  if (resultConfig.risk) {
    args.push("--risk", resultConfig.risk);
  }
  const result = runController(args, root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function reduceResults(root, stateRootRef) {
  const result = runController(["reduce-results", "--state-root", stateRootRef, "--write"], root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function decideReview(root, stateRootRef, candidateId, manifest) {
  const result = runController([
    "decide-review",
    "--state-root",
    stateRootRef,
    "--candidate-id",
    candidateId,
    "--decision",
    manifest.decision.decision,
    "--reason",
    manifest.decision.reason,
    "--evidence-ref",
    manifest.result.evidenceRef,
    "--write",
  ], root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function renderProgress(root, stateRootRef) {
  const result = runRender(["--state-root", stateRootRef, "--write"], root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("manual route keeps state, result, decision, and progress projection separated", () => {
  const manifest = readFixture("manual-route");
  const root = makeRoot("csmr-manual-");
  const { stateRootRef, stateRoot } = initDemand(root, manifest);
  const taskPayload = addTaskPackage(root, stateRootRef, manifest);

  const appendTask = runAppend([
    "--state-root",
    stateRootRef,
    "--type",
    "task-package",
    "--task-package-id",
    manifest.taskPackage.taskPackageId,
    "--summary",
    manifest.taskPackage.summary,
    "--source-ref",
    manifest.taskPackage.sourceRef,
    "--timestamp",
    "2026-06-05 10:00 CST",
    "--write",
  ], root);
  assert.equal(appendTask.status, 0, appendTask.stderr || appendTask.stdout);

  writeJson(path.join(stateRoot, manifest.result.evidenceRef), { ok: true, route: "manual" });
  const stateBeforeResult = readJson(path.join(stateRoot, "controller-state.json"));
  importResult(root, stateRootRef, manifest);
  const stateAfterResult = readJson(path.join(stateRoot, "controller-state.json"));
  assert.deepEqual(stateAfterResult, stateBeforeResult);

  const reduced = reduceResults(root, stateRootRef);
  assert.equal(reduced.reviewStatus, "ready-for-controller-review");
  assert.equal(reduced.missingResultIds.length, 0);
  assert.match(reduced.candidateId, /^tc-/);

  const decision = decideReview(root, stateRootRef, reduced.candidateId, manifest);
  assert.equal(decision.nextState, "planned");
  assert.equal(decision.decision, "accept");

  const appendBackfill = runAppend([
    "--state-root",
    stateRootRef,
    "--type",
    "backfill",
    "--target-task-id",
    manifest.taskPackage.targetTaskId,
    "--target-window",
    manifest.taskPackage.targetWindow,
    "--evidence-ref",
    manifest.result.evidenceRef,
    "--timestamp",
    "2026-06-05 10:01 CST",
    "--write",
  ], root);
  assert.equal(appendBackfill.status, 0, appendBackfill.stderr || appendBackfill.stdout);

  const appendDecision = runAppend([
    "--state-root",
    stateRootRef,
    "--type",
    "decision",
    "--decision",
    `${manifest.decision.decision}: ${manifest.decision.reason}`,
    "--event-id",
    decision.eventId,
    "--evidence-ref",
    manifest.result.evidenceRef,
    "--timestamp",
    "2026-06-05 10:02 CST",
    "--write",
  ], root);
  assert.equal(appendDecision.status, 0, appendDecision.stderr || appendDecision.stdout);

  renderProgress(root, stateRootRef);
  const state = readJson(path.join(stateRoot, "controller-state.json"));
  const projection = readJson(path.join(stateRoot, "projection.json"));
  const progress = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");

  assert.equal(taskPayload.projectionStatus, "stale");
  assert.equal(state.state, "planned");
  assert.equal(state.taskPackages[0].status, "accepted");
  assert.equal(state.targetTasks[0].status, "accepted");
  assert.equal(state.review.status, "decision-accept");
  assert.equal(projection.unifiedStatus.mainState, "planned");
  assert.equal(projection.unifiedStatus.currentTaskPackages, "CSMR-MANUAL-PKG(accepted)");
  assert.match(progress, /Main state: planned/);
  assert.match(progress, /CSMR-MANUAL-PKG\(accepted\)/);
  assert.match(progress, /CSMR-MANUAL-TASK` \/ `AlembicWorkspace` backfill received/);
  assert.match(progress, /accept: Manual route fixture evidence reviewed by total control/);
});

test("unattended route prepares dispatch and controller return from stateRoot without controlPlan", () => {
  const manifest = readFixture("unattended-route");
  const root = makeRoot("csmr-unattended-");
  const { stateRootRef, stateRoot } = initDemand(root, manifest);
  addTaskPackage(root, stateRootRef, manifest);

  const registerTarget = runAutomation([
    "register-thread",
    "--window",
    manifest.taskPackage.targetWindow,
    "--thread-id",
    "019e-state-root-target-thread",
    "--role",
    "target",
    "--write",
  ], root);
  assert.equal(registerTarget.status, 0, registerTarget.stderr || registerTarget.stdout);

  const registerController = runAutomation([
    "register-thread",
    "--window",
    manifest.controllerWindow,
    "--thread-id",
    "019e-state-root-controller-thread",
    "--role",
    "controller",
    "--write",
  ], root);
  assert.equal(registerController.status, 0, registerController.stderr || registerController.stdout);

  const prepared = runAutomation([
    "prepare-dispatch-from-state",
    "--state-root",
    stateRootRef,
    "--target-task-id",
    manifest.taskPackage.targetTaskId,
    "--group",
    manifest.dispatchGroup,
    "--controller-window",
    manifest.controllerWindow,
    "--human-context-ref",
    `${stateRootRef}/developer-progress.md`,
    "--require-thread",
    "--write",
  ], root);
  assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
  const preparedPayload = JSON.parse(prepared.stdout);
  assert.equal(preparedPayload.packet.controlPlan, undefined);
  assert.equal(preparedPayload.dispatchGroup.controlPlan, undefined);
  assert.equal(preparedPayload.envelope.controlPlan, undefined);
  assert.equal(preparedPayload.packet.stateRef.stateRoot, stateRootRef);
  assert.doesNotMatch(preparedPayload.packet.prompt, /controlPlan:/);
  assert.doesNotMatch(preparedPayload.packet.prompt, /humanContextRef:/);
  assert.doesNotMatch(preparedPayload.packet.prompt, /stateRevision:/);
  assert.doesNotMatch(preparedPayload.packet.prompt, /taskPackageId:/);
  assert.doesNotMatch(preparedPayload.packet.prompt, /demandKey:/);
  assert.doesNotMatch(preparedPayload.packet.prompt, /rules:/);

  const submit = runAutomation([
    "submit-result",
    "--target-window",
    manifest.taskPackage.targetWindow,
    "--task-id",
    manifest.taskPackage.targetTaskId,
    "--group",
    manifest.dispatchGroup,
    "--status",
    "completed",
    "--evidence-ref",
    manifest.result.evidenceRef,
    "--verification",
    manifest.result.verification,
    "--write",
  ], root);
  assert.equal(submit.status, 0, submit.stderr || submit.stdout);

  const returned = runAutomation([
    "build-controller-return",
    "--group",
    manifest.dispatchGroup,
    "--trigger-target",
    manifest.taskPackage.targetWindow,
    "--trigger-task-id",
    manifest.taskPackage.targetTaskId,
    "--require-thread",
    "--write",
  ], root);
  assert.equal(returned.status, 0, returned.stderr || returned.stdout);
  const returnPayload = JSON.parse(returned.stdout);
  assert.equal(returnPayload.envelope.controlPlan, undefined);
  assert.equal(returnPayload.envelope.stateRef.stateRoot, stateRootRef);
  assert.equal(returnPayload.envelope.humanContextRef, `${stateRootRef}/developer-progress.md`);
  assert.doesNotMatch(returnPayload.envelope.prompt, /controlPlan:/);
  assert.doesNotMatch(returnPayload.envelope.prompt, /humanContextRef:/);
  assert.doesNotMatch(returnPayload.envelope.prompt, /stateRevision:/);
  assert.doesNotMatch(returnPayload.envelope.prompt, /taskPackageId:/);
  assert.doesNotMatch(returnPayload.envelope.prompt, /demandKey:/);
  assert.doesNotMatch(returnPayload.envelope.prompt, /returnPolicy:/);
  assert.doesNotMatch(returnPayload.envelope.prompt, /reviewScope:/);
  assert.doesNotMatch(returnPayload.envelope.prompt, /groupStatus:/);
  assert.doesNotMatch(returnPayload.envelope.prompt, /rules:/);
  assert.doesNotMatch(returned.stdout, /019e-state-root-controller-thread/);

  writeJson(path.join(stateRoot, manifest.result.evidenceRef), { ok: true, route: "unattended" });
  importResult(root, stateRootRef, manifest);
  const reviewPack = runAutomation(["review-pack", "--state-root", stateRootRef], root);
  assert.equal(reviewPack.status, 0, reviewPack.stderr || reviewPack.stdout);
  const reviewPayload = JSON.parse(reviewPack.stdout);
  assert.equal(reviewPayload.reviewPack.source, "controller-state-root");
  assert.equal(reviewPayload.reviewPack.controllerReturnDelivery.status, "not-applicable");
  assert.equal(reviewPayload.reviewPack.decision, "needs-controller-review");
  assert.equal(reviewPayload.reviewPack.gates.stateRootBased, true);
  assert.equal(reviewPayload.reviewPack.gates.totalControlVerdictRequired, true);

  const reduced = reduceResults(root, stateRootRef);
  const decision = decideReview(root, stateRootRef, reduced.candidateId, manifest);
  renderProgress(root, stateRootRef);
  const state = readJson(path.join(stateRoot, "controller-state.json"));
  const progress = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");

  assert.equal(decision.nextState, "planned");
  assert.equal(state.state, "planned");
  assert.equal(state.taskPackages[0].status, "accepted");
  assert.match(progress, /Main state: planned/);
});

test("failure route waits on missing results, surfaces blocked evidence, and rejects stale candidates", () => {
  const manifest = readFixture("failure-route");
  const root = makeRoot("csmr-failure-");
  const { stateRootRef, stateRoot } = initDemand(root, manifest);
  addTaskPackage(root, stateRootRef, manifest);

  const missingReview = runAutomation(["review-pack", "--state-root", stateRootRef], root);
  assert.equal(missingReview.status, 0, missingReview.stderr || missingReview.stdout);
  const missingPayload = JSON.parse(missingReview.stdout);
  assert.equal(missingPayload.reviewPack.decision, "wait");
  assert.equal(missingPayload.reviewPack.groupStatus, "waiting");
  assert.equal(missingPayload.reviewPack.gates.waitForMissingResults, true);

  const reducedMissing = reduceResults(root, stateRootRef);
  assert.equal(reducedMissing.nextState, "waiting-results");
  assert.equal(reducedMissing.candidateId, null);
  assert.deepEqual(reducedMissing.missingResultIds, [manifest.taskPackage.targetTaskId]);

  writeJson(path.join(stateRoot, manifest.result.evidenceRef), { ok: false, route: "failure" });
  importResult(root, stateRootRef, manifest);
  const blockedReview = runAutomation(["review-pack", "--state-root", stateRootRef], root);
  assert.equal(blockedReview.status, 0, blockedReview.stderr || blockedReview.stdout);
  const blockedPayload = JSON.parse(blockedReview.stdout);
  assert.equal(blockedPayload.reviewPack.decision, "blocked");
  assert.equal(blockedPayload.reviewPack.groupStatus, "blocked");
  assert.equal(blockedPayload.reviewPack.gates.blockedResultsPresent, true);

  const reducedBlocked = reduceResults(root, stateRootRef);
  assert.equal(reducedBlocked.reviewStatus, "blocked-results-ready");
  assert.match(reducedBlocked.candidateId, /^tc-/);
  const staleCandidate = reducedBlocked.candidateId;

  const revisionAdvance = reduceResults(root, stateRootRef);
  assert.match(revisionAdvance.candidateId, /^tc-/);

  const stale = runController([
    "decide-review",
    "--state-root",
    stateRootRef,
    "--candidate-id",
    staleCandidate,
    "--decision",
    "blocked",
    "--reason",
    "Attempting stale decision should fail.",
    "--write",
  ], root);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stdout, /is stale/);

  const decision = decideReview(root, stateRootRef, revisionAdvance.candidateId, manifest);
  renderProgress(root, stateRootRef);
  const state = readJson(path.join(stateRoot, "controller-state.json"));
  const progress = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");

  assert.equal(decision.nextState, "blocked");
  assert.equal(state.state, "blocked");
  assert.equal(state.blockers[0].summary, manifest.decision.reason);
  assert.match(progress, /Main state: blocked/);
  assert.match(progress, /Blockers: Failure route fixture intentionally records a controller blocker/);
  assert.equal(existsSync(path.join(stateRoot, "transition-candidates", `${staleCandidate}.json`)), true);
});
