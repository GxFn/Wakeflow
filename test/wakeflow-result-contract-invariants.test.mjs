#!/usr/bin/env node

// Result-contract regressions execute a temporary, self-contained Codex runtime:
// copy the installable bundle, then overlay core/ (while restoring its host-local
// profile). This keeps the test pinned to core source without running sync-core
// or changing either checked-in plugin bundle.

import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { transportArtifactFileName } from "../core/scripts/lib/wakeflow-artifact-identity.mjs";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const coreRoot = path.join(repoRoot, "core");
const codexBundleRoot = path.join(repoRoot, "plugins", "codex-wakeflow");

function makeRuntime() {
  const runtime = mkdtempSync(path.join(os.tmpdir(), "wakeflow-result-contract-runtime-"));
  const hostProfile = readFileSync(path.join(codexBundleRoot, "scripts/lib/wakeflow-host-profile.mjs"));
  cpSync(codexBundleRoot, runtime, { recursive: true });
  cpSync(coreRoot, runtime, { recursive: true, force: true });
  writeFileSync(path.join(runtime, "scripts/lib/wakeflow-host-profile.mjs"), hostProfile);
  return runtime;
}

function makeRoot(config = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-result-contract-state-"));
  writeJson(path.join(root, "wakeflow.config.json"), {
    workspaceName: "Result contract regression",
    controllerWindow: "Controller",
    repositories: [
      { windowName: "Controller", path: ".", role: "controller" },
      { windowName: "Target", path: ".", role: "implementation" },
    ],
    dispatchWindows: ["Target"],
    ...config,
  });
  return root;
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function run(runtime, script, args) {
  return spawnSync(process.execPath, [path.join(runtime, "scripts", script), ...args], {
    cwd: runtime,
    encoding: "utf8",
  });
}

function runAsync(runtime, script, args) {
  const child = spawn(process.execPath, [path.join(runtime, "scripts", script), ...args], {
    cwd: runtime,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
  return { child, completion };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseOk(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function initDemand(runtime, root, demandKey, extra = []) {
  return parseOk(run(runtime, "wakeflow-state.mjs", [
    "init", "--root", root, "--demand-key", demandKey, "--title", demandKey,
    ...extra, "--write", "--json",
  ]));
}

function addContractedTask(runtime, root, stateRoot, { packageId, taskId, targetWindow = "Target" }) {
  return parseOk(run(runtime, "wakeflow-state.mjs", [
    "add-task-package", "--root", root, "--state-root", stateRoot,
    "--task-package-id", packageId, "--summary", packageId,
    "--evidence-contract", JSON.stringify({ required: [{ kind: "tests" }] }),
    "--target-window", targetWindow, "--target-task-id", taskId, "--target-summary", taskId,
    "--write", "--json",
  ]));
}

function fullContextArgs({
  workType = "implementation",
  commitExpectation = "leave-uncommitted",
  acceptanceAnchors = [{ id: "AC-1", claim: "The confirmed behavior works.", probe: "Run the focused probe.", expected: "The probe passes." }],
} = {}) {
  return [
    "--work-type", workType,
    "--objective", "Implement only the confirmed behavior.",
    "--context-summary", JSON.stringify(["The requirement and validation target are confirmed."]),
    "--requirement-refs", JSON.stringify([{ ref: "requirements.md#goal", role: "goal" }]),
    "--boundaries", JSON.stringify({ inScope: ["Confirmed behavior"], outOfScope: ["Unrelated behavior"], forbidden: ["Do not expand scope"] }),
    "--completion-expectations", JSON.stringify(["Return reviewable evidence."]),
    "--depends-on-task-ids", "[]",
    "--commit-expectation", commitExpectation,
    ...(acceptanceAnchors ? ["--acceptance-anchors", JSON.stringify(acceptanceAnchors)] : []),
  ];
}

function addFullContextTask(runtime, root, stateRoot, {
  packageId = "PKG",
  taskId = "TASK",
  targetWindow = "Target",
  workType = "implementation",
  commitExpectation = "leave-uncommitted",
  acceptanceAnchors,
  extra = [],
} = {}) {
  writeFileSync(path.join(root, "requirements.md"), "# Goal\n\nConfirmed behavior.\n");
  return parseOk(run(runtime, "wakeflow-state.mjs", [
    "add-task-package", "--root", root, "--state-root", stateRoot,
    "--task-package-id", packageId, "--summary", packageId,
    ...fullContextArgs({ workType, commitExpectation, acceptanceAnchors }),
    "--target-window", targetWindow, "--target-task-id", taskId, "--target-summary", taskId,
    ...extra,
    "--write", "--json",
  ]));
}

function importResult(runtime, root, stateRoot, args) {
  return run(runtime, "wakeflow-state.mjs", [
    "import-target-result", "--root", root, "--state-root", stateRoot,
    "--target-task-id", args.taskId, "--target-window", args.targetWindow || "Target", "--status", "completed",
    ...args.extra,
    "--write", "--json",
  ]);
}

function registerAndSend(runtime, root, stateRoot, group, targetWindow = "Target") {
  const registered = run(runtime, "wakeflow-delivery.mjs", [
    "register-thread", "--root", root, "--window", targetWindow, "--thread-id", `0192fac-${targetWindow}`, "--write", "--json",
  ]);
  assert.equal(registered.status, 0, registered.stderr || registered.stdout);
  const prepareArgs = [
    "prepare-dispatch-from-state", "--root", root, "--state-root", stateRoot,
    "--target-task-id", "TASK", "--group", group, "--controller-window", "Controller",
    "--require-thread", "--json",
  ];
  const preview = parseOk(run(runtime, "wakeflow-delivery.mjs", prepareArgs));
  const prepared = parseOk(run(runtime, "wakeflow-delivery.mjs", [
    ...prepareArgs,
    "--expected-preview-digest", preview.previewDigest,
    "--write",
  ]));
  const recorded = parseOk(run(runtime, "wakeflow-delivery.mjs", [
    "record-delivery-run", "--root", root, "--delivery-file", prepared.deliveryFile,
    "--status", "sent", "--readback-ok", "true", "--evidence", `${group} sent`, "--write", "--json",
  ]));
  return { prepared, recorded };
}

function targetResultSnapshot(root, stateRoot) {
  const directory = path.join(root, stateRoot, "target-results");
  const snapshot = {};
  if (!existsSync(directory)) return snapshot;
  const visit = (dir, prefix = "") => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute, relative);
      else snapshot[relative] = readFileSync(absolute, "utf8");
    }
  };
  visit(directory);
  return snapshot;
}

test("P0: after sent G1 → result → rework → sent G2, an ungrouped import cannot overwrite G1", () => {
  const runtime = makeRuntime();
  const root = makeRoot();
  const init = initDemand(runtime, root, "RESULT-GROUP-INVARIANT");
  addContractedTask(runtime, root, init.stateRoot, { packageId: "PKG", taskId: "TASK" });

  registerAndSend(runtime, root, init.stateRoot, "G1");
  writeJson(path.join(root, init.stateRoot, "reports/g1.json"), { group: "G1" });
  const first = parseOk(importResult(runtime, root, init.stateRoot, {
    taskId: "TASK",
    extra: ["--dispatch-group", "G1", "--evidence-ref", "reports/g1.json", "--craft-evidence", JSON.stringify([{ kind: "tests", value: "G1 tests passed" }])],
  }));
  assert.equal(first.dispatchGroup, "G1");
  const reduced = parseOk(run(runtime, "wakeflow-state.mjs", [
    "reduce-results", "--root", root, "--state-root", init.stateRoot, "--write", "--json",
  ]));
  const candidateId = reduced.candidateId ?? reduced.candidate?.candidateId;
  assert.ok(candidateId, reduced.stdout);
  parseOk(run(runtime, "wakeflow-state.mjs", [
    "decide-review", "--root", root, "--state-root", init.stateRoot, "--candidate-id", candidateId,
    "--decision", "rework", "--reason", "needs one more pass", "--write", "--json",
  ]));
  registerAndSend(runtime, root, init.stateRoot, "G2");

  const beforeG2Result = parseOk(run(runtime, "wakeflow-state.mjs", [
    "reduce-results", "--root", root, "--state-root", init.stateRoot, "--write", "--json",
  ]));
  assert.equal(beforeG2Result.candidateId, null, "G1 must not be reduced as G2's current result");
  assert.deepEqual(beforeG2Result.missingResultIds, ["TASK"], "the sent G2 round still needs its own result");

  const currentFile = path.join(root, first.resultFile);
  const currentBefore = readFileSync(currentFile, "utf8");
  const resultsBefore = targetResultSnapshot(root, init.stateRoot);
  const omittedGroup = importResult(runtime, root, init.stateRoot, {
    taskId: "TASK",
    extra: ["--summary", "ambiguous callback"],
  });
  assert.notEqual(omittedGroup.status, 0, "a callback after redispatch must explicitly claim G1 or G2");
  assert.match(omittedGroup.stdout + omittedGroup.stderr, /dispatch-group/i);
  assert.equal(readFileSync(currentFile, "utf8"), currentBefore, "failed import never overwrites G1 current result");
  assert.deepEqual(targetResultSnapshot(root, init.stateRoot), resultsBefore, "failed import writes no result or history artifact");

  const lateG1 = parseOk(importResult(runtime, root, init.stateRoot, {
    taskId: "TASK",
    extra: ["--dispatch-group", "G1", "--result-id", "G1-LATE", "--summary", "late G1 callback"],
  }));
  assert.equal(lateG1.historyOnly, true, "an explicitly old G1 callback is audit history only");
  assert.equal(lateG1.currentResult, false);
  assert.equal(readFileSync(currentFile, "utf8"), currentBefore, "late G1 cannot replace the current result");
  const lateResult = readJson(path.join(root, lateG1.resultFile));
  assert.equal(lateResult.dispatchGroup, "G1");
  assert.equal(lateResult.historyReason, "late-dispatch-group");

  writeJson(path.join(root, init.stateRoot, "reports/g2.json"), { group: "G2" });
  const currentG2 = parseOk(importResult(runtime, root, init.stateRoot, {
    taskId: "TASK",
    extra: ["--dispatch-group", "G2", "--evidence-ref", "reports/g2.json", "--craft-evidence", JSON.stringify([{ kind: "tests", value: "G2 tests passed" }])],
  }));
  assert.equal(readJson(path.join(root, currentG2.resultFile)).dispatchGroup, "G2");
  const groupReview = parseOk(run(runtime, "wakeflow-delivery.mjs", [
    "review-pack", "--root", root, "--group", "G2", "--json",
  ]));
  assert.deepEqual(
    groupReview.reviewPack.targetResults[0].craftEvidence,
    [{ kind: "tests", value: "G2 tests passed" }],
    "group review must preserve state-root craft evidence during result normalization",
  );
  assert.deepEqual(groupReview.reviewPack.craftEvidenceGaps, []);
  const staleGroupReview = parseOk(run(runtime, "wakeflow-delivery.mjs", [
    "review-pack", "--root", root, "--group", "G1", "--json",
  ]));
  assert.equal(staleGroupReview.decision, "wait", "G2's current result cannot satisfy G1 review");
  assert.equal(staleGroupReview.reviewPack.targetResults[0].resultStatus, "missing");
  assert.equal(staleGroupReview.reviewPack.targetResults[0].craftEvidence, undefined);
  const afterG2Result = parseOk(run(runtime, "wakeflow-state.mjs", [
    "reduce-results", "--root", root, "--state-root", init.stateRoot, "--write", "--json",
  ]));
  assert.ok(afterG2Result.candidateId, "only a G2 result may make this review candidate available");
});

test("P1: a known dispatched task rejects an explicit result group that has no dispatch record", () => {
  const runtime = makeRuntime();
  const root = makeRoot();
  const init = initDemand(runtime, root, "RESULT-GROUP-UNKNOWN");
  addContractedTask(runtime, root, init.stateRoot, { packageId: "PKG", taskId: "TASK" });
  registerAndSend(runtime, root, init.stateRoot, "G1");
  writeJson(path.join(root, init.stateRoot, "reports/g1.json"), { group: "G1" });
  parseOk(importResult(runtime, root, init.stateRoot, {
    taskId: "TASK",
    extra: ["--dispatch-group", "G1", "--evidence-ref", "reports/g1.json", "--craft-evidence", JSON.stringify([{ kind: "tests", value: "G1 tests passed" }])],
  }));

  const before = targetResultSnapshot(root, init.stateRoot);
  const unknownGroup = importResult(runtime, root, init.stateRoot, {
    taskId: "TASK",
    extra: ["--dispatch-group", "G-TYPO", "--summary", "unknown dispatch callback"],
  });
  assert.notEqual(unknownGroup.status, 0, "a result group must name a real dispatch record for this task");
  assert.match(unknownGroup.stdout + unknownGroup.stderr, /dispatch group|known group|--dispatch-group/i);
  assert.deepEqual(targetResultSnapshot(root, init.stateRoot), before, "an unknown group cannot create audit history");
});

test("P1: two demands can reuse the same package, task, and group ids without merging transport history", () => {
  const runtime = makeRuntime();
  const root = makeRoot({
    repositories: [
      { windowName: "Controller", path: ".", role: "controller" },
      { windowName: "Target", path: ".", role: "implementation" },
      { windowName: "TargetB", path: ".", role: "implementation" },
    ],
    dispatchWindows: ["Target", "TargetB"],
  });
  const first = initDemand(runtime, root, "GROUP-SCOPE-A");
  const second = initDemand(runtime, root, "GROUP-SCOPE-B", [
    "--placement", "pod",
    "--authorization-ref", "user://result-contract/GROUP-SCOPE-B",
  ]);
  addContractedTask(runtime, root, first.stateRoot, { packageId: "PKG", taskId: "TASK" });
  addContractedTask(runtime, root, second.stateRoot, { packageId: "PKG", taskId: "TASK", targetWindow: "TargetB" });
  registerAndSend(runtime, root, first.stateRoot, "G-SAME");
  registerAndSend(runtime, root, second.stateRoot, "G-SAME", "TargetB");

  for (const directory of ["dispatch-packets", "dispatch-groups", "delivery-envelopes", "delivery-runs"]) {
    const files = readdirSync(path.join(root, ".wakeflow-local/wakeflow-delivery", directory))
      .filter((name) => name.endsWith(".json"));
    assert.equal(files.length, 2, `${directory} keeps one canonical artifact per demand`);
  }
  const ambiguousReview = run(runtime, "wakeflow-delivery.mjs", [
    "review-results", "--root", root, "--group", "G-SAME", "--json",
  ]);
  assert.notEqual(ambiguousReview.status, 0);
  assert.match(ambiguousReview.stdout + ambiguousReview.stderr, /matches multiple demands.*--state-root/i);
  parseOk(run(runtime, "wakeflow-delivery.mjs", [
    "review-results", "--root", root, "--group", "G-SAME", "--state-root", first.stateRoot, "--json",
  ]));
  parseOk(run(runtime, "wakeflow-delivery.mjs", [
    "review-results", "--root", root, "--group", "G-SAME", "--state-root", second.stateRoot, "--json",
  ]));

  const crossDemandGroup = importResult(runtime, root, second.stateRoot, {
    taskId: "TASK",
    targetWindow: "TargetB",
    extra: ["--dispatch-group", "G-UNKNOWN", "--summary", "must not cross demand roots"],
  });
  assert.notEqual(crossDemandGroup.status, 0);
  assert.match(crossDemandGroup.stdout + crossDemandGroup.stderr, /unknown.*group|known groups/i);
  assert.deepEqual(targetResultSnapshot(root, second.stateRoot), {});
});

test("P1: required craft evidence requires proof before a target result can land", () => {
  const runtime = makeRuntime();
  const root = makeRoot();
  const init = initDemand(runtime, root, "CRAFT-PROOF-INVARIANT");
  addContractedTask(runtime, root, init.stateRoot, { packageId: "VALUE-PKG", taskId: "VALUE-TASK" });

  const proofless = importResult(runtime, root, init.stateRoot, {
    taskId: "VALUE-TASK",
    extra: ["--summary", "tests ran", "--craft-evidence", JSON.stringify([{ kind: "tests" }])],
  });
  assert.notEqual(proofless.status, 0, "kind-only evidence must fail at import, before reduce can observe it");
  assert.match(proofless.stdout + proofless.stderr, /ref, value, or commit|kind alone is not evidence/i);
  assert.equal(existsSync(path.join(root, init.stateRoot, "target-results", "tr-VALUE-TASK.json")), false);

  const withValue = parseOk(importResult(runtime, root, init.stateRoot, {
    taskId: "VALUE-TASK",
    extra: ["--summary", "tests ran", "--craft-evidence", JSON.stringify([{ kind: "tests", value: "12 tests passed" }])],
  }));
  assert.equal(withValue.currentResult, true, "a required kind with a value is accepted");
  assert.equal(
    readJson(path.join(root, withValue.resultFile)).resultMapping.status,
    "legacy-unenforced",
    "legacy packages remain readable but newly recorded results identify that mapping was not enforced",
  );

  addContractedTask(runtime, root, init.stateRoot, { packageId: "REF-PKG", taskId: "REF-TASK" });
  writeJson(path.join(root, init.stateRoot, "reports/tests.json"), { passed: 12 });
  const withExistingRef = parseOk(importResult(runtime, root, init.stateRoot, {
    taskId: "REF-TASK",
    extra: ["--summary", "tests ran", "--craft-evidence", JSON.stringify([{ kind: "tests", ref: "reports/tests.json" }])],
  }));
  assert.equal(withExistingRef.currentResult, true, "a required kind with an existing ref is accepted");
});

test("P1: full-context implementation completion maps every acceptance anchor exactly once", () => {
  const runtime = makeRuntime();
  const root = makeRoot();
  const init = initDemand(runtime, root, "RESULT-MAPPING-IMPLEMENTATION");
  addFullContextTask(runtime, root, init.stateRoot);

  const missing = importResult(runtime, root, init.stateRoot, {
    taskId: "TASK",
    extra: [
      "--summary", "Implementation is complete.",
      "--commit-disposition", "left-uncommitted",
      "--verification", "Focused probe passed.",
    ],
  });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stdout + missing.stderr, /acceptance-anchor-missing/);

  const duplicate = importResult(runtime, root, init.stateRoot, {
    taskId: "TASK",
    extra: [
      "--summary", "Implementation is complete.",
      "--commit-disposition", "left-uncommitted",
      "--craft-evidence", JSON.stringify([
        { kind: "acceptance-anchor", anchorId: "AC-1", red: "Failed before.", green: "Passed after.", ref: "reports/ac-1.json" },
        { kind: "acceptance-anchor", anchorId: "AC-1", red: "Failed before.", green: "Passed after.", ref: "reports/ac-1-again.json" },
      ]),
    ],
  });
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stdout + duplicate.stderr, /acceptance-anchor-duplicate/);

  writeJson(path.join(root, init.stateRoot, "reports/ac-1.json"), { red: "failed", green: "passed" });
  const accepted = parseOk(importResult(runtime, root, init.stateRoot, {
    taskId: "TASK",
    extra: [
      "--summary", "Implementation is complete.",
      "--changed-repo", "Target",
      "--commit-disposition", "left-uncommitted",
      "--craft-evidence", JSON.stringify([
        { kind: "acceptance-anchor", anchorId: "AC-1", red: "Failed before.", green: "Passed after.", ref: "reports/ac-1.json" },
      ]),
    ],
  }));
  const result = readJson(path.join(root, accepted.resultFile));
  assert.deepEqual(result.changedRepos, ["Target"]);
  assert.equal(result.commitDisposition, "left-uncommitted");
  assert.equal(result.resultMapping.status, "complete");
  assert.deepEqual(result.resultMapping.acceptanceAnchorIds, ["AC-1"]);

  const review = parseOk(run(runtime, "wakeflow-delivery.mjs", [
    "review-pack", "--root", root, "--state-root", init.stateRoot, "--json",
  ])).reviewPack;
  assert.deepEqual(review.resultContractGaps, []);
  assert.equal(review.gates.controllerReviewReady, true);
  assert.equal(review.targetResults[0].resultMapping.status, "complete");
});

test("P1: commit expectation mismatch blocks review without pretending mapping is acceptance", () => {
  const runtime = makeRuntime();
  const root = makeRoot();
  const init = initDemand(runtime, root, "RESULT-COMMIT-EXPECTATION");
  addFullContextTask(runtime, root, init.stateRoot, { commitExpectation: "commit" });
  writeJson(path.join(root, init.stateRoot, "reports/ac-1.json"), { green: true });

  parseOk(importResult(runtime, root, init.stateRoot, {
    taskId: "TASK",
    extra: [
      "--summary", "Behavior is implemented but intentionally left uncommitted.",
      "--commit-disposition", "left-uncommitted",
      "--craft-evidence", JSON.stringify([
        { kind: "acceptance-anchor", anchorId: "AC-1", red: "Failed.", green: "Passed.", ref: "reports/ac-1.json" },
      ]),
    ],
  }));

  const review = parseOk(run(runtime, "wakeflow-delivery.mjs", [
    "review-pack", "--root", root, "--state-root", init.stateRoot, "--json",
  ])).reviewPack;
  assert.equal(review.gates.controllerReviewReady, false);
  assert.equal(review.resultContractGaps[0].reason, "commit-expectation-not-met");
  assert.equal(review.targetResults[0].resultMapping.status, "complete", "complete mapping is still only review input");

  const reduced = run(runtime, "wakeflow-state.mjs", [
    "reduce-results", "--root", root, "--state-root", init.stateRoot, "--write", "--json",
  ]);
  assert.notEqual(reduced.status, 0);
  assert.match(reduced.stdout + reduced.stderr, /target-result-contract-required|commit-expectation-not-met/);
});

test("P1: blocked full-context results allow an honest partial map with a blocker summary", () => {
  const runtime = makeRuntime();
  const root = makeRoot();
  const init = initDemand(runtime, root, "RESULT-MAPPING-BLOCKED");
  addFullContextTask(runtime, root, init.stateRoot);

  const noSummary = run(runtime, "wakeflow-state.mjs", [
    "import-target-result", "--root", root, "--state-root", init.stateRoot,
    "--target-task-id", "TASK", "--target-window", "Target", "--status", "blocked",
    "--write", "--json",
  ]);
  assert.notEqual(noSummary.status, 0);
  assert.match(noSummary.stdout + noSummary.stderr, /blocker-summary-missing/);

  const blocked = parseOk(run(runtime, "wakeflow-state.mjs", [
    "import-target-result", "--root", root, "--state-root", init.stateRoot,
    "--target-task-id", "TASK", "--target-window", "Target", "--status", "blocked",
    "--summary", "The required external fixture is unavailable.",
    "--craft-evidence", JSON.stringify([
      { kind: "acceptance-anchor", anchorId: "AC-1", red: "Failure reproduced.", ref: "reports/blocker.json" },
    ]),
    "--write", "--json",
  ]));
  const result = readJson(path.join(root, blocked.resultFile));
  assert.equal(result.resultMapping.status, "partial");
  assert.ok(result.resultMapping.partialIssues.some((entry) => entry.reason === "acceptance-anchor-green-missing"));
});

test("P1: full-context Test completion covers only the approved plan indices", () => {
  const runtime = makeRuntime();
  const root = makeRoot({
    testWindow: "Test",
    repositories: [
      { windowName: "Controller", path: ".", role: "controller" },
      { windowName: "Test", path: ".", role: "test" },
    ],
    dispatchWindows: ["Test"],
  });
  const init = initDemand(runtime, root, "RESULT-MAPPING-TEST");
  const cardFile = path.join(root, init.stateRoot, "test-cards/TEST-CARD.json");
  writeJson(cardFile, {
    kind: "TestBoundaryCard",
    schemaVersion: 1,
    testId: "TEST-CARD",
    targetWindow: "Test",
    strategySource: "requirements.md#goal",
    executionContract: {
      version: 1,
      requirementGoal: "Explore the confirmed environment boundary.",
      approvedPlan: ["Run the public entry.", "Capture the raw response."],
      allowedSkills: [],
      setupPolicy: "reuse-existing",
      maxAttempts: 2,
      restartConditions: [],
      changeControl: { testMayChangeGoal: false, testMayAddUnmappedSteps: false },
    },
    suggestedTaskPackage: { targetTaskId: "TEST-TASK" },
  });
  addFullContextTask(runtime, root, init.stateRoot, {
    packageId: "TEST-PKG",
    taskId: "TEST-TASK",
    targetWindow: "Test",
    workType: "test",
    acceptanceAnchors: null,
    extra: ["--test-card-id", "TEST-CARD"],
  });

  const invented = importResult(runtime, root, init.stateRoot, {
    taskId: "TEST-TASK",
    targetWindow: "Test",
    extra: [
      "--summary", "Test completed.",
      "--commit-disposition", "no-changes",
      "--craft-evidence", JSON.stringify([
        { kind: "test-step", planIndex: 0, step: "Run the public entry.", ref: "reports/test-0.json" },
        { kind: "test-step", planIndex: 2, step: "Invented extra gate.", ref: "reports/test-2.json" },
      ]),
    ],
  });
  assert.notEqual(invented.status, 0);
  assert.match(invented.stdout + invented.stderr, /unknown-test-step|test-step-missing/);

  const completed = parseOk(importResult(runtime, root, init.stateRoot, {
    taskId: "TEST-TASK",
    targetWindow: "Test",
    extra: [
      "--summary", "The approved real-environment plan completed.",
      "--commit-disposition", "no-changes",
      "--craft-evidence", JSON.stringify([
        { kind: "test-step", planIndex: 0, step: "Run the public entry.", ref: "reports/test-0.json" },
        { kind: "test-step", planIndex: 1, step: "Capture the raw response.", ref: "reports/test-1.json" },
      ]),
    ],
  }));
  const result = readJson(path.join(root, completed.resultFile));
  assert.equal(result.resultMapping.status, "complete");
  assert.deepEqual(result.resultMapping.testPlanIndices, [0, 1]);
});

test("P1: transport result recording preserves contracted craft evidence instead of silently dropping it", () => {
  const runtime = makeRuntime();
  const root = makeRoot();
  const init = initDemand(runtime, root, "TRANSPORT-CRAFT-INVARIANT");
  addContractedTask(runtime, root, init.stateRoot, { packageId: "PKG", taskId: "TASK" });
  registerAndSend(runtime, root, init.stateRoot, "G-TRANSPORT");
  writeJson(path.join(root, "reports/transport-tests.json"), { passed: 12 });
  const craftEvidence = [{ kind: "tests", ref: "reports/transport-tests.json" }];

  const recorded = parseOk(run(runtime, "wakeflow-delivery.mjs", [
    "record-target-result", "--root", root, "--target-window", "Target", "--task-id", "TASK",
    "--group", "G-TRANSPORT", "--status", "completed", "--evidence-ref", "reports/transport-tests.json",
    "--craft-evidence", JSON.stringify(craftEvidence), "--write", "--json",
  ]));
  assert.deepEqual(recorded.result.craftEvidence, craftEvidence, "transport CLI must persist --craft-evidence for packet evidenceContract review");
});

test("P1: transport recording enforces the full-context packet result contract", () => {
  const runtime = makeRuntime();
  const root = makeRoot();
  const init = initDemand(runtime, root, "TRANSPORT-FULL-CONTEXT");
  addFullContextTask(runtime, root, init.stateRoot);
  const sent = registerAndSend(runtime, root, init.stateRoot, "G-FULL");
  const packet = readJson(path.join(root, sent.prepared.packetFile));
  assert.equal(packet.resultContract, "target-result-envelope-v2");

  const missingMap = run(runtime, "wakeflow-delivery.mjs", [
    "record-target-result", "--root", root, "--target-window", "Target", "--task-id", "TASK",
    "--group", "G-FULL", "--status", "completed", "--summary", "Implementation complete.",
    "--commit-disposition", "left-uncommitted", "--verification", "Focused verification passed.",
    "--write", "--json",
  ]);
  assert.notEqual(missingMap.status, 0);
  assert.match(missingMap.stdout + missingMap.stderr, /acceptance-anchor-missing/);

  const recorded = parseOk(run(runtime, "wakeflow-delivery.mjs", [
    "record-target-result", "--root", root, "--target-window", "Target", "--task-id", "TASK",
    "--group", "G-FULL", "--status", "completed", "--summary", "Implementation complete.",
    "--changed-repo", "Target", "--commit-disposition", "left-uncommitted",
    "--craft-evidence", JSON.stringify([
      { kind: "acceptance-anchor", anchorId: "AC-1", red: "Failed.", green: "Passed.", ref: "reports/ac-1.json" },
    ]),
    "--write", "--json",
  ]));
  assert.equal(recorded.result.resultMapping.status, "complete");
  assert.equal(recorded.result.commitDisposition, "left-uncommitted");
});

test("P1: transport result recording fails closed while the same result is locked", () => {
  const runtime = makeRuntime();
  const root = makeRoot();
  const init = initDemand(runtime, root, "TRANSPORT-RESULT-LOCK");
  addContractedTask(runtime, root, init.stateRoot, { packageId: "PKG", taskId: "TASK" });
  registerAndSend(runtime, root, init.stateRoot, "G-LOCK");

  const resultFile = path.join(
    root,
    ".wakeflow-local/wakeflow-delivery/target-results",
    transportArtifactFileName("G-LOCK__Target__TASK", {
      demandKey: "TRANSPORT-RESULT-LOCK",
      stateRoot: init.stateRoot,
    }),
  );
  const resultLock = `${resultFile}.record-lock`;
  writeJson(resultLock, {
    kind: "WakeflowStateLock",
    version: 1,
    pid: process.pid,
    token: "held-by-result-contract-test",
    createdAt: new Date().toISOString(),
  });
  try {
    const blocked = run(runtime, "wakeflow-delivery.mjs", [
      "record-target-result", "--root", root, "--target-window", "Target", "--task-id", "TASK",
      "--group", "G-LOCK", "--status", "completed", "--verification", "must wait for the writer",
      "--write", "--json",
    ]);
    assert.notEqual(blocked.status, 0, "a live writer lock must fail closed after the bounded wait");
    assert.match(blocked.stdout + blocked.stderr, /locked by another Wakeflow process|retry after it finishes/i);
    assert.equal(existsSync(resultFile), false, "a timed-out contender must not write the result");
    assert.equal(existsSync(resultLock), true, "a contender must not remove a lock it does not own");
  } finally {
    rmSync(resultLock, { force: true });
  }
});

test("P1: concurrent transport result writers serialize conflict checks and preserve every superseded revision", async () => {
  const runtime = makeRuntime();
  const root = makeRoot();
  const init = initDemand(runtime, root, "TRANSPORT-RESULT-CONCURRENCY");
  addContractedTask(runtime, root, init.stateRoot, { packageId: "PKG", taskId: "TASK" });
  registerAndSend(runtime, root, init.stateRoot, "G-CONCURRENT");

  const resultFile = path.join(
    root,
    ".wakeflow-local/wakeflow-delivery/target-results",
    transportArtifactFileName("G-CONCURRENT__Target__TASK", {
      demandKey: "TRANSPORT-RESULT-CONCURRENCY",
      stateRoot: init.stateRoot,
    }),
  );
  const resultLock = `${resultFile}.record-lock`;
  const commandArgs = (verification, supersede = false) => [
    "record-target-result", "--root", root, "--target-window", "Target", "--task-id", "TASK",
    "--group", "G-CONCURRENT", "--status", "completed", "--verification", verification,
    ...(supersede ? ["--supersede-result"] : []),
    "--write", "--json",
  ];
  const holdWriters = () => writeJson(resultLock, {
    kind: "WakeflowStateLock",
    version: 1,
    pid: process.pid,
    token: `held-${Date.now()}-${Math.random()}`,
    createdAt: new Date().toISOString(),
  });

  holdWriters();
  const first = runAsync(runtime, "wakeflow-delivery.mjs", commandArgs("writer A"));
  const second = runAsync(runtime, "wakeflow-delivery.mjs", commandArgs("writer B"));
  try {
    await delay(500);
    assert.equal(first.child.exitCode, null, "writer A must wait for the same-result mutex");
    assert.equal(second.child.exitCode, null, "writer B must wait for the same-result mutex");
  } finally {
    rmSync(resultLock, { force: true });
  }
  const initialWrites = await Promise.all([first.completion, second.completion]);
  assert.deepEqual(
    initialWrites.map((item) => item.status).sort(),
    [0, 1],
    "without explicit supersession exactly one conflicting first writer may commit",
  );
  const rejected = initialWrites.find((item) => item.status !== 0);
  assert.match(rejected.stdout + rejected.stderr, /already exists.*--supersede-result/i);
  assert.equal(readJson(resultFile).resultRevision, 1);
  assert.equal(existsSync(resultLock), false, "the writer-owned mutex must be released");

  holdWriters();
  const third = runAsync(runtime, "wakeflow-delivery.mjs", commandArgs("writer C", true));
  const fourth = runAsync(runtime, "wakeflow-delivery.mjs", commandArgs("writer D", true));
  try {
    await delay(500);
    assert.equal(third.child.exitCode, null, "first explicit supersession must wait for the mutex");
    assert.equal(fourth.child.exitCode, null, "second explicit supersession must wait for the mutex");
  } finally {
    rmSync(resultLock, { force: true });
  }
  const supersedingWrites = await Promise.all([third.completion, fourth.completion]);
  assert.deepEqual(
    supersedingWrites.map((item) => item.status).sort(),
    [0, 0],
    supersedingWrites.map((item) => item.stderr || item.stdout).join("\n"),
  );

  const current = readJson(resultFile);
  assert.equal(current.resultRevision, 3, "both explicit supersessions must advance one serialized revision");
  const supersededDir = path.join(path.dirname(resultFile), "superseded");
  const archivedFiles = readdirSync(supersededDir).filter((name) => name.endsWith(".json")).sort();
  assert.equal(archivedFiles.length, 2, "both prior revisions must remain as distinct audit artifacts");
  assert.deepEqual(
    archivedFiles.map((name) => readJson(path.join(supersededDir, name)).resultRevision).sort(),
    [1, 2],
  );
  assert.match(archivedFiles[0], /__revision-000[12]\.json$/);
  assert.match(archivedFiles[1], /__revision-000[12]\.json$/);
  assert.notEqual(archivedFiles[0], archivedFiles[1]);
  assert.equal(existsSync(resultLock), false);
});
