#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Multi-demand concurrency is an explicit placement contract: one ordinary
// mainline lane plus any number of user-authorized isolated pods. Wakeflow does
// not convert a second ordinary demand into a pod and does not admit by count.

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const runtimeTemp = mkdtempSync(path.join(os.tmpdir(), "wakeflow-multi-runtime-"));
const runtimeRoot = path.join(runtimeTemp, "runtime");
cpSync(path.join(repositoryRoot, "core"), runtimeRoot, { recursive: true });
cpSync(
  path.join(repositoryRoot, "plugins/codex-wakeflow/templates"),
  path.join(runtimeRoot, "templates"),
  { recursive: true },
);
cpSync(
  path.join(repositoryRoot, "plugins/codex-wakeflow/scripts/lib/wakeflow-host-send-adapter.mjs"),
  path.join(runtimeRoot, "scripts/lib/wakeflow-host-send-adapter.mjs"),
);
const stateScript = path.join(runtimeRoot, "scripts/wakeflow-state.mjs");
const podScript = path.join(runtimeRoot, "scripts/wakeflow-pod.mjs");
const deliveryScript = path.join(runtimeRoot, "scripts/wakeflow-delivery.mjs");

test.after(() => rmSync(runtimeTemp, { recursive: true, force: true }));

function run(args) {
  return spawnSync(process.execPath, [stateScript, ...args], { encoding: "utf8", shell: false });
}

function runScript(script, args, cwd) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    shell: false,
  });
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

function initDemand(root, demandKey, extra = []) {
  return run([
    "init", "--root", root, "--demand-key", demandKey, "--title", `Demand ${demandKey}`,
    ...extra, "--write", "--json",
  ]);
}

function initPod(root, demandKey) {
  return initDemand(root, demandKey, [
    "--placement", "pod",
    "--authorization-ref", `user://multi-demand/${demandKey}`,
  ]);
}

function git(root, args) {
  const result = spawnSync(
    "git",
    ["-C", root, "-c", "user.name=Wakeflow Test", "-c", "user.email=wakeflow@test", ...args],
    { encoding: "utf8", shell: false },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function configuredRepositoryRoot() {
  const root = makeRoot({
    controllerWindow: "Controller",
    designWindow: "Design",
    testWindow: "Test",
    repositories: [
      { windowName: "RepoA", path: "RepoA", role: "fixture implementation" },
    ],
  });
  const repositoryRoot = path.join(root, "RepoA");
  mkdirSync(repositoryRoot, { recursive: true });
  git(repositoryRoot, ["init", "-q", "-b", "main"]);
  writeFileSync(path.join(repositoryRoot, "README.md"), "RepoA\n");
  writeFileSync(path.join(root, "goal-stage-confirmation.md"), [
    "# Pod authority",
    "",
    "## Goal",
    "## Requirement design",
    "## Code facts",
    "## Landing plan",
    "## Non goals",
    "## User confirmation",
    "",
  ].join("\n"));
  git(repositoryRoot, ["add", "README.md"]);
  git(repositoryRoot, ["commit", "-q", "-m", "initial"]);
  return { root, repositoryRoot, head: git(repositoryRoot, ["rev-parse", "HEAD"]) };
}

function podCommand(root, command, option = null, value = null) {
  const args = [command, "--root", root];
  if (option) args.push(option, typeof value === "string" ? value : JSON.stringify(value));
  args.push("--write", "--json");
  return runScript(podScript, args, root);
}

function registerPodWindow(root, stateRoot, operation, threadIndex) {
  const threadId = `00000000-0000-4000-8000-${String(threadIndex).padStart(12, "0")}`;
  const registered = runScript(deliveryScript, [
    "register-thread",
    "--root", root,
    "--window", operation.windowName,
    "--thread-id", threadId,
    "--entry-sync-status", "ready",
    "--launch-correlation-id", operation.launchCorrelationId,
    "--binding-id", operation.registrationBindingId,
    "--state-root", stateRoot,
    "--write",
    "--json",
  ], root);
  assert.equal(registered.status, 0, registered.stderr || registered.stdout);
  return threadId;
}

function bindPodReceipt(root, receipt) {
  const bound = podCommand(root, "bind", "--receipt-json", receipt);
  assert.equal(bound.status, 0, bound.stderr || bound.stdout);
  return JSON.parse(bound.stdout);
}

function materializeReadyPod(root, demandKey, repositoryRoot, expectedBaseHead) {
  const stateRoot = path.join(root, ".wakeflow-active/current", demandKey);
  const controls = podCommand(root, "open", "--request-json", {
    demandKey,
    host: "codex",
    repositories: [],
  });
  assert.equal(controls.status, 0, controls.stderr || controls.stdout);
  const controlPlan = JSON.parse(controls.stdout);
  controlPlan.operations.forEach((operation, index) => {
    registerPodWindow(root, stateRoot, operation, index + 1);
    bindPodReceipt(root, {
      launchCorrelationId: operation.launchCorrelationId,
      windowName: operation.windowName,
      host: "codex",
      bindingId: operation.registrationBindingId,
      handleRegistered: true,
      handleKind: "final",
      stateRootRelative: path.relative(root, stateRoot).split(path.sep).join("/"),
      actualCwd: root,
      createdAt: new Date().toISOString(),
    });
  });

  const designRequestResult = podCommand(root, "prepare-design-request", "--request-json", {
    demandKey,
    podId: demandKey,
    demandType: "requirement",
    requestType: "initial-design",
    originalGoal: "Exercise an isolated result loop without changing its confirmed scope.",
    requirementAnchors: ["goal-stage-confirmation.md#goal"],
    codeEvidenceRefs: ["evidence/fixture-repository-facts.json"],
    pausedTargetIdentity: null,
    pausedReviewIdentity: null,
    nonGoals: ["Do not use the main checkout as the Pod target."],
    decisionsRequired: [],
  });
  assert.equal(
    designRequestResult.status,
    0,
    designRequestResult.stderr || designRequestResult.stdout,
  );
  const designRequest = JSON.parse(designRequestResult.stdout);
  const handoff = podCommand(root, "record-design-handoff", "--handoff-json", {
    demandKey,
    podId: demandKey,
    demandType: "requirement",
    designRequestId: designRequest.requestId,
    designRequestRef: designRequest.requestRef,
    designRequestDigest: designRequest.requestDigest,
    requestType: designRequest.requestType,
    preservesOriginalGoal: true,
    requirementAnchors: ["goal-stage-confirmation.md#goal"],
    evidenceRefs: ["evidence/fixture-repository-facts.json"],
    userConfirmationRefs: ["controller-events.jsonl#explicit-pod"],
    landingPlan: [
      { repositoryWindow: "RepoA", responsibility: "Exercise the isolated fixture." },
    ],
    designIntent: "Keep the Pod result loop isolated from the mainline demand.",
    testDecision: "No separate environment test is required for this state-isolation fixture.",
    environmentSpec: { authority: "fixture", scope: "pod-worktree" },
    demandAuthority: {
      demandKey,
      demandType: "requirement",
      entryMode: "pod-design",
      authorityRefs: [
        { role: "original-plan", ref: "goal-stage-confirmation.md#goal" },
        { role: "requirement-design", ref: "goal-stage-confirmation.md#requirement-design" },
        { role: "code-facts", ref: "goal-stage-confirmation.md#code-facts" },
        { role: "landing-plan", ref: "goal-stage-confirmation.md#landing-plan" },
        { role: "non-goals", ref: "goal-stage-confirmation.md#non-goals" },
        { role: "user-confirmation", ref: "goal-stage-confirmation.md#user-confirmation" },
      ],
      testDecision: {
        mode: "controller-only",
        summary: "Controller verifies this isolated state-loop fixture.",
      },
    },
  });
  assert.equal(handoff.status, 0, handoff.stderr || handoff.stdout);

  const expanded = podCommand(root, "open", "--request-json", {
    demandKey,
    host: "codex",
    repositories: [
      { windowName: "RepoA", expectedBaseHead, basePolicy: "local-head" },
    ],
  });
  assert.equal(expanded.status, 0, expanded.stderr || expanded.stdout);
  const productOperation = JSON.parse(expanded.stdout).operations
    .find((operation) => operation.role === "product");
  assert.ok(productOperation);
  const worktree = path.join(root, ".host-worktrees", `${demandKey}-RepoA`);
  mkdirSync(path.dirname(worktree), { recursive: true });
  git(repositoryRoot, ["worktree", "add", "--detach", worktree, expectedBaseHead]);
  const actualCwd = realpathSync(worktree);
  registerPodWindow(root, stateRoot, productOperation, 4);
  const commonDirRaw = git(actualCwd, ["rev-parse", "--git-common-dir"]);
  bindPodReceipt(root, {
    launchCorrelationId: productOperation.launchCorrelationId,
    windowName: productOperation.windowName,
    host: "codex",
    bindingId: productOperation.registrationBindingId,
    handleRegistered: true,
    handleKind: "final",
    stateRootRelative: path.relative(root, stateRoot).split(path.sep).join("/"),
    actualCwd,
    gitTopLevel: realpathSync(git(actualCwd, ["rev-parse", "--show-toplevel"])),
    gitCommonDir: realpathSync(path.resolve(actualCwd, commonDirRaw)),
    head: expectedBaseHead,
    branch: null,
    detached: true,
    mainCheckout: false,
    createdAt: new Date().toISOString(),
  });
  return productOperation.windowName;
}

function driveToAccepted(root, stateRoot, id, targetWindow = "RepoA") {
  for (const args of [
    ["add-task-package", "--root", root, "--state-root", stateRoot, "--task-package-id", `tp-${id}`, "--summary", `Work ${id}`, "--target-window", targetWindow, "--write", "--json"],
    ["import-target-result", "--root", root, "--state-root", stateRoot, "--target-task-id", `tp-${id}__${targetWindow}`, "--target-window", targetWindow, "--status", "completed", "--summary", `Work ${id} completed.`, "--write", "--json"],
    ["reduce-results", "--root", root, "--state-root", stateRoot, "--write", "--json"],
  ]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    if (args[0] === "reduce-results") return JSON.parse(result.stdout).candidateId;
  }
  return null;
}

test("explicit pod controller identity is stamped in canonical state", () => {
  const root = makeRoot();
  const initialized = initPod(root, "POD-DK");
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  const stateRoot = path.join(root, ".wakeflow-active/current/POD-DK");
  const podState = readJson(path.join(stateRoot, "wakeflow-state.json"));
  assert.equal(podState.controllerWindow, "Controller__POD-DK");
  assert.equal(podState.executionPlacement.selection, "explicit-user-pod");
});

test("ordinary second demand waits; explicitly authorized pods have no numeric ceiling", () => {
  const root = makeRoot({ maxActiveDemands: 1 });
  assert.equal(initDemand(root, "MAIN").status, 0);
  const ordinary = initDemand(root, "ORDINARY");
  assert.equal(ordinary.status, 1, ordinary.stdout);
  assert.equal(JSON.parse(ordinary.stdout).errorCode, "mainline-busy");

  for (const demandKey of ["POD-1", "POD-2", "POD-3", "POD-4"]) {
    const pod = initPod(root, demandKey);
    assert.equal(pod.status, 0, pod.stderr || pod.stdout);
  }
});

test("mainline and isolated demand loops remain independent when interleaved", () => {
  const { root, repositoryRoot, head } = configuredRepositoryRoot();
  assert.equal(initDemand(root, "MAIN").status, 0);
  assert.equal(initPod(root, "POD").status, 0);
  const mainRoot = path.join(root, ".wakeflow-active/current/MAIN");
  const podRoot = path.join(root, ".wakeflow-active/current/POD");
  const podTargetWindow = materializeReadyPod(root, "POD", repositoryRoot, head);
  const mainRevisionBeforeWork = readJson(path.join(mainRoot, "wakeflow-state.json")).revision;
  const podRevisionBeforeWork = readJson(path.join(podRoot, "wakeflow-state.json")).revision;

  const mainCandidate = driveToAccepted(root, mainRoot, "main");
  const podCandidate = driveToAccepted(root, podRoot, "pod", podTargetWindow);
  assert.equal(run([
    "decide-review", "--root", root, "--state-root", podRoot,
    "--candidate-id", podCandidate, "--decision", "accept",
    "--reason", "independent pod", "--write", "--json",
  ]).status, 0);
  assert.equal(run([
    "decide-review", "--root", root, "--state-root", mainRoot,
    "--candidate-id", mainCandidate, "--decision", "accept",
    "--reason", "independent main", "--write", "--json",
  ]).status, 0);

  const mainState = readJson(path.join(mainRoot, "wakeflow-state.json"));
  const podState = readJson(path.join(podRoot, "wakeflow-state.json"));
  assert.equal(mainState.executionPlacement.mode, "main");
  assert.equal(podState.executionPlacement.mode, "isolated");
  assert.equal(mainState.revision, mainRevisionBeforeWork + 3);
  assert.equal(podState.revision, podRevisionBeforeWork + 3);
  assert.equal(mainState.targetTasks[0].status, "accepted");
  assert.equal(podState.targetTasks[0].status, "accepted");
});

test("completed mainline still waits until archive, while pods never hold the lane", () => {
  const root = makeRoot({
    projectLedgerRoot: "wakeflow-ledger",
    workspaceArchiveDir: "wakeflow-ledger/workspace/archive",
  });
  assert.equal(initDemand(root, "MAIN").status, 0);
  assert.equal(initPod(root, "POD").status, 0);
  const mainRoot = path.join(root, ".wakeflow-active/current/MAIN");
  const candidate = driveToAccepted(root, mainRoot, "main");
  assert.equal(run([
    "decide-review", "--root", root, "--state-root", mainRoot,
    "--candidate-id", candidate, "--decision", "accept",
    "--reason", "done", "--write", "--json",
  ]).status, 0);
  assert.equal(run([
    "complete-demand", "--root", root, "--state-root", mainRoot,
    "--reason", "done", "--evidence-ref", "controller-events.jsonl",
    "--write", "--json",
  ]).status, 0);

  const waiting = initDemand(root, "NEXT");
  assert.equal(waiting.status, 1, waiting.stdout);
  assert.match(JSON.parse(waiting.stdout).error, /completed but not archived/);
  assert.equal(run([
    "archive-demand", "--root", root, "--state-root", mainRoot,
    "--reason", "shipped", "--redact", "--write", "--json",
  ]).status, 0);
  const next = initDemand(root, "NEXT");
  assert.equal(next.status, 0, next.stderr || next.stdout);
  assert.equal(
    readJson(path.join(root, ".wakeflow-active/current/NEXT/wakeflow-state.json"))
      .executionPlacement.mode,
    "main",
  );
});
