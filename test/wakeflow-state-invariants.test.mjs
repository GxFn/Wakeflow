#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runSync } from "../core/lib/wakeflow-process.mjs";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const runtimeTemp = mkdtempSync(path.join(os.tmpdir(), "wakeflow-state-runtime-"));
const wakeflowRoot = path.join(runtimeTemp, "runtime");

cpSync(path.join(repositoryRoot, "core"), wakeflowRoot, { recursive: true });
cpSync(
  path.join(repositoryRoot, "plugins/codex-wakeflow/templates"),
  path.join(wakeflowRoot, "templates"),
  { recursive: true },
);
const stateScript = path.join(wakeflowRoot, "scripts/wakeflow-state.mjs");
const renderScript = path.join(wakeflowRoot, "scripts/wakeflow-render-progress.mjs");

test.after(() => {
  rmSync(runtimeTemp, { recursive: true, force: true });
});

function makeRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-state-invariant-"));
  mkdirSync(root, { recursive: true });
  return root;
}

function run(args) {
  return runSync(process.execPath, [stateScript, ...args], {
    cwd: wakeflowRoot,
    encoding: "utf8",
  });
}

function runRender(args) {
  return runSync(process.execPath, [renderScript, ...args], {
    cwd: wakeflowRoot,
    encoding: "utf8",
  });
}

function runAsync(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [stateScript, ...args], {
      cwd: wakeflowRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function initDemand(root, demandKey, title = "State invariant fixture") {
  const result = run([
    "init",
    "--root",
    root,
    "--demand-key",
    demandKey,
    "--title",
    title,
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function snapshotTree(root) {
  const snapshot = {};
  const walk = (directory, prefix = "") => {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, relative);
      } else {
        snapshot[relative] = readFileSync(absolute).toString("base64");
      }
    }
  };
  walk(root);
  return snapshot;
}

test("state invariant: concurrent same-key init has one winner and one coherent five-file root", async () => {
  const root = makeRoot();
  const demandKey = "SAME-KEY-INVARIANT";
  const titles = Array.from({ length: 16 }, (_, index) => `Concurrent title ${String(index).padStart(2, "0")}`);

  // Hold the identity lock long enough for every child to reach the current
  // lock-external existence check. Once released, they contend on the real
  // production lock, making the same-key race deterministic.
  const identityLock = path.join(root, ".wakeflow-active", "current.identity-lock");
  mkdirSync(path.dirname(identityLock), { recursive: true });
  writeFileSync(
    identityLock,
    `${JSON.stringify({
      kind: "WakeflowStateLock",
      version: 1,
      pid: process.pid,
      token: "state-invariant-identity-barrier",
      createdAt: new Date().toISOString(),
    })}\n`,
    { flag: "wx" },
  );

  const pending = titles.map((title) => runAsync([
    "init",
    "--root",
    root,
    "--demand-key",
    demandKey,
    "--title",
    title,
    "--write",
    "--json",
  ]));
  await new Promise((resolve) => setTimeout(resolve, 1000));
  unlinkSync(identityLock);
  const results = await Promise.all(pending);

  const winnerIndexes = results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result.status === 0)
    .map(({ index }) => index);
  assert.equal(
    winnerIndexes.length,
    1,
    `exactly one init may succeed for one demand key; winners=${JSON.stringify(winnerIndexes)}`,
  );

  const winningTitle = titles[winnerIndexes[0]];
  const stateRoot = path.join(root, ".wakeflow-active", "current", demandKey);
  const expectedFiles = [
    "demand.json",
    "wakeflow-state.json",
    "controller-events.jsonl",
    "projection.json",
    "developer-progress.md",
  ];
  for (const name of expectedFiles) {
    assert.equal(existsSync(path.join(stateRoot, name)), true, `${name} must exist`);
  }

  const demand = readJson(path.join(stateRoot, "demand.json"));
  const state = readJson(path.join(stateRoot, "wakeflow-state.json"));
  const projection = readJson(path.join(stateRoot, "projection.json"));
  const events = readFileSync(path.join(stateRoot, "controller-events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  const progress = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");
  assert.equal(demand.title, winningTitle);
  assert.equal(state.title, winningTitle);
  assert.equal(projection.title, winningTitle);
  assert.match(progress, new RegExp(winningTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "state.initialized");
  assert.equal(events[0].stateRevision, 1);
});

test("state invariant: init cannot create an unscanned authority root outside configured current", () => {
  const root = makeRoot();
  const outsideRoot = "alternate/hidden-demand-root";
  const result = run([
    "init",
    "--root",
    root,
    "--state-root",
    outsideRoot,
    "--demand-key",
    "OUTSIDE-CURRENT-INVARIANT",
    "--title",
    "Outside current",
    "--write",
    "--json",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /workspaceCurrentDir|configured.*current/i);
  assert.equal(existsSync(path.join(root, outsideRoot, "wakeflow-state.json")), false);
});

test("state invariant: an empty demand cannot complete", () => {
  const root = makeRoot();
  const init = initDemand(root, "EMPTY-COMPLETE-INVARIANT");
  const stateFile = path.join(root, init.stateRoot, "wakeflow-state.json");
  const before = readJson(stateFile);

  const completed = run([
    "complete-demand",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--reason",
    "No task was ever delivered.",
    "--evidence-ref",
    "controller-events.jsonl",
    "--write",
    "--json",
  ]);

  assert.notEqual(completed.status, 0, completed.stdout);
  const after = readJson(stateFile);
  assert.equal(after.revision, before.revision);
  assert.equal(after.state, "intake");
  assert.deepEqual(after.taskPackages, []);
  assert.deepEqual(after.targetTasks, []);
});

test("state invariant: accepted-looking tasks cannot bypass pending review or decisions", () => {
  const root = makeRoot();
  const init = initDemand(root, "PENDING-REVIEW-COMPLETE-INVARIANT");
  const added = run([
    "add-task-package",
    "--root", root,
    "--state-root", init.stateRoot,
    "--task-package-id", "PKG",
    "--summary", "Pending review fixture.",
    "--target-window", "Product",
    "--target-task-id", "TASK",
    "--write", "--json",
  ]);
  assert.equal(added.status, 0, added.stderr || added.stdout);
  const stateFile = path.join(root, init.stateRoot, "wakeflow-state.json");
  const state = readJson(stateFile);
  const inconsistent = {
    ...state,
    state: "waiting-results",
    taskPackages: state.taskPackages.map((item) => ({ ...item, status: "accepted" })),
    targetTasks: state.targetTasks.map((item) => ({ ...item, status: "accepted" })),
    decisionsRequired: [{ id: "DECISION-1", summary: "Controller verdict is still pending." }],
  };
  writeJson(stateFile, inconsistent);
  const before = readFileSync(stateFile, "utf8");
  const completed = run([
    "complete-demand",
    "--root", root,
    "--state-root", init.stateRoot,
    "--reason", "Must not bypass review.",
    "--evidence-ref", "controller-events.jsonl",
    "--write", "--json",
  ]);
  assert.notEqual(completed.status, 0);
  assert.match(completed.stdout + completed.stderr, /pending controller decisions|review cycle/i);
  assert.equal(readFileSync(stateFile, "utf8"), before);
});

test("state invariant: complete requires explicit accept decisions and valid replacement lineage", () => {
  const forgedRoot = makeRoot();
  const forgedInit = initDemand(forgedRoot, "FORGED-ACCEPT-INVARIANT");
  assert.equal(run([
    "add-task-package",
    "--root", forgedRoot,
    "--state-root", forgedInit.stateRoot,
    "--task-package-id", "PKG-FORGED",
    "--summary", "Forged acceptance.",
    "--target-window", "Product",
    "--target-task-id", "TASK-FORGED",
    "--write", "--json",
  ]).status, 0);
  const forgedStateFile = path.join(forgedRoot, forgedInit.stateRoot, "wakeflow-state.json");
  const forgedState = readJson(forgedStateFile);
  forgedState.state = "planned";
  forgedState.taskPackages[0].status = "accepted";
  forgedState.targetTasks[0].status = "accepted";
  writeJson(forgedStateFile, forgedState);
  const forgedBefore = readFileSync(forgedStateFile, "utf8");
  const forgedComplete = run([
    "complete-demand",
    "--root", forgedRoot,
    "--state-root", forgedInit.stateRoot,
    "--reason", "Forged labels are not a verdict.",
    "--evidence-ref", "controller-events.jsonl",
    "--write", "--json",
  ]);
  assert.notEqual(forgedComplete.status, 0);
  assert.match(forgedComplete.stdout + forgedComplete.stderr, /no explicit accept decision/);
  assert.equal(readFileSync(forgedStateFile, "utf8"), forgedBefore);

  const orphanRoot = makeRoot();
  const orphanInit = initDemand(orphanRoot, "ORPHAN-SUPERSEDED-INVARIANT");
  assert.equal(run([
    "add-task-package",
    "--root", orphanRoot,
    "--state-root", orphanInit.stateRoot,
    "--task-package-id", "PKG-ORPHAN",
    "--summary", "Orphan superseded task.",
    "--target-window", "Product",
    "--target-task-id", "TASK-ORPHAN",
    "--write", "--json",
  ]).status, 0);
  const orphanStateFile = path.join(orphanRoot, orphanInit.stateRoot, "wakeflow-state.json");
  const orphanState = readJson(orphanStateFile);
  orphanState.state = "planned";
  orphanState.taskPackages[0].status = "superseded";
  orphanState.targetTasks[0].status = "superseded";
  writeJson(orphanStateFile, orphanState);
  const orphanComplete = run([
    "complete-demand",
    "--root", orphanRoot,
    "--state-root", orphanInit.stateRoot,
    "--reason", "Orphan lineage must not close.",
    "--evidence-ref", "controller-events.jsonl",
    "--write", "--json",
  ]);
  assert.notEqual(orphanComplete.status, 0);
  assert.match(orphanComplete.stdout + orphanComplete.stderr, /has no replacement/);
});

test("state invariant: complete accepts a fully linked transitive replacement chain", () => {
  const root = makeRoot();
  const init = initDemand(root, "TRANSITIVE-REPLACEMENT-INVARIANT");
  for (const id of ["A", "B", "C"]) {
    const added = run([
      "add-task-package",
      "--root", root,
      "--state-root", init.stateRoot,
      "--task-package-id", `PKG-${id}`,
      "--summary", `Task ${id}.`,
      "--target-window", "Product",
      "--target-task-id", `TASK-${id}`,
      "--write", "--json",
    ]);
    assert.equal(added.status, 0, added.stderr || added.stdout);
  }
  const stateFile = path.join(root, init.stateRoot, "wakeflow-state.json");
  const state = readJson(stateFile);
  state.state = "planned";
  const taskA = state.targetTasks.find((task) => task.targetTaskId === "TASK-A");
  const taskB = state.targetTasks.find((task) => task.targetTaskId === "TASK-B");
  const taskC = state.targetTasks.find((task) => task.targetTaskId === "TASK-C");
  Object.assign(taskA, { status: "superseded", reviewDecision: "redesign", replacedByTargetTaskId: "TASK-B" });
  Object.assign(taskB, {
    status: "superseded",
    reviewDecision: "redesign",
    replacesTargetTaskId: "TASK-A",
    replacedByTargetTaskId: "TASK-C",
  });
  Object.assign(taskC, { status: "accepted", reviewDecision: "accept", replacesTargetTaskId: "TASK-B" });
  state.taskPackages.find((pkg) => pkg.taskPackageId === "PKG-A").status = "superseded";
  state.taskPackages.find((pkg) => pkg.taskPackageId === "PKG-B").status = "superseded";
  state.taskPackages.find((pkg) => pkg.taskPackageId === "PKG-C").status = "accepted";
  writeJson(stateFile, state);

  const completed = run([
    "complete-demand",
    "--root", root,
    "--state-root", init.stateRoot,
    "--reason", "The final replacement is explicitly accepted.",
    "--evidence-ref", "controller-events.jsonl",
    "--write", "--json",
  ]);
  assert.equal(completed.status, 0, completed.stderr || completed.stdout);
  assert.equal(readJson(stateFile).state, "completed");
});

test("state invariant: an archived ledger root rejects every ordinary write surface", () => {
  const root = makeRoot();
  writeJson(path.join(root, "wakeflow.config.json"), {
    workspaceName: "Archive invariant",
    controllerWindow: "Controller",
    projectLedgerRoot: "wakeflow-ledger",
    workspaceArchiveDir: "wakeflow-ledger/workspace/archive",
  });
  const init = initDemand(root, "ARCHIVED-COMPLETE-INVARIANT");
  const activeStateFile = path.join(root, init.stateRoot, "wakeflow-state.json");
  const activeState = readJson(activeStateFile);
  // This fixture only needs a valid archive command input. Record the matching
  // terminal event explicitly instead of forging a completed state that the
  // archive authority must now reject.
  const completedAt = new Date().toISOString();
  writeJson(activeStateFile, {
    ...activeState,
    state: "completed",
    stateReason: "archive fixture setup",
    revision: activeState.revision + 1,
    updatedAt: completedAt,
    allowedActions: ["archive-demand", "wakeflow-render-progress"],
  });
  const eventsFile = path.join(root, init.stateRoot, "controller-events.jsonl");
  const existingEvents = readFileSync(eventsFile, "utf8").trimEnd();
  const completedEvent = {
    eventId: `evt-${completedAt.replace(/[^0-9]/g, "").slice(0, 17)}-${activeState.revision + 1}`,
    createdAt: completedAt,
    actor: "controller",
    type: "demand.completed",
    from: activeState.state,
    to: "completed",
    reason: "archive fixture setup",
    evidenceRefs: ["controller-events.jsonl"],
    allowedWrites: ["wakeflow-state.json", "controller-events.jsonl"],
    forbiddenConclusions: ["completion-implies-archive"],
    stateRevision: activeState.revision + 1,
  };
  writeFileSync(eventsFile, `${existingEvents}\n${JSON.stringify(completedEvent)}\n`);

  const archived = run([
    "archive-demand",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--reason",
    "Archive fixture",
    "--write",
    "--json",
  ]);
  assert.equal(archived.status, 0, archived.stderr || archived.stdout);
  const archiveRoot = path.join(root, JSON.parse(archived.stdout).archived.ledgerDest);
  const before = snapshotTree(archiveRoot);

  const attempts = [
    run([
      "complete-demand",
      "--root", root,
      "--state-root", archiveRoot,
      "--reason", "Archived history must not reopen.",
      "--evidence-ref", "controller-events.jsonl",
      "--write", "--json",
    ]),
    run([
      "adopt-demand-host",
      "--root", root,
      "--state-root", archiveRoot,
      "--reason", "Archived ownership must not change.",
      "--write", "--json",
    ]),
    run([
      "recover-state-transition",
      "--root", root,
      "--state-root", archiveRoot,
      "--write", "--json",
    ]),
    run([
      "focus-doc",
      "--root", root,
      "--state-root", archiveRoot,
      "--window", "Product",
      "--write", "--json",
    ]),
    runRender([
      "--root", root,
      "--state-root", archiveRoot,
      "--write", "--json",
    ]),
  ];

  for (const attempt of attempts) {
    assert.notEqual(attempt.status, 0, attempt.stdout);
    assert.match(attempt.stdout + attempt.stderr, /archived|immutable/i);
    assert.deepEqual(snapshotTree(archiveRoot), before, "every archived file must remain byte-identical");
  }
});

test("state invariant: a completed target result needs a summary or review evidence", () => {
  const root = makeRoot();
  const init = initDemand(root, "EMPTY-RESULT-INVARIANT");
  const added = run([
    "add-task-package",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--task-package-id",
    "PKG-EMPTY-RESULT",
    "--summary",
    "Return a result with real review material.",
    "--target-window",
    "Product",
    "--target-task-id",
    "TASK-EMPTY-RESULT",
    "--write",
    "--json",
  ]);
  assert.equal(added.status, 0, added.stderr || added.stdout);

  const imported = run([
    "import-target-result",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--target-task-id",
    "TASK-EMPTY-RESULT",
    "--target-window",
    "Product",
    "--status",
    "completed",
    "--result-id",
    "RESULT-WITHOUT-REVIEW-MATERIAL",
    "--write",
    "--json",
  ]);

  assert.notEqual(imported.status, 0, imported.stdout);
  const resultsDir = path.join(root, init.stateRoot, "target-results");
  const resultFiles = existsSync(resultsDir)
    ? readdirSync(resultsDir).filter((name) => name.endsWith(".json"))
    : [];
  assert.deepEqual(resultFiles, [], "a rejected empty completed result must not leave a result file");
});

test("state invariant: redesign never reuses the old product result as a new candidate", () => {
  const root = makeRoot();
  const init = initDemand(root, "REDESIGN-OLD-RESULT-INVARIANT");
  assert.equal(run([
    "add-task-package",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--task-package-id",
    "PKG-ORIGINAL",
    "--summary",
    "Original product package.",
    "--target-window",
    "Product",
    "--target-task-id",
    "TASK-ORIGINAL",
    "--write",
    "--json",
  ]).status, 0);

  const evidenceRef = "evidence/original-result.json";
  const evidenceFile = path.join(root, init.stateRoot, evidenceRef);
  mkdirSync(path.dirname(evidenceFile), { recursive: true });
  writeFileSync(evidenceFile, "{}\n");
  assert.equal(run([
    "import-target-result",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--target-task-id",
    "TASK-ORIGINAL",
    "--target-window",
    "Product",
    "--status",
    "completed",
    "--summary",
    "Original implementation completed under the pre-redesign requirement.",
    "--evidence-ref",
    evidenceRef,
    "--write",
    "--json",
  ]).status, 0);

  const initialReduction = run([
    "reduce-results",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--write",
    "--json",
  ]);
  assert.equal(initialReduction.status, 0, initialReduction.stderr || initialReduction.stdout);
  const initialCandidateId = JSON.parse(initialReduction.stdout).candidateId;
  assert.ok(initialCandidateId);
  const redesign = run([
    "decide-review",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--candidate-id",
    initialCandidateId,
    "--decision",
    "redesign",
    "--reason",
    "The delivered effect exposes a requirement-level mismatch; wait for Design to deliver the corrected requirement.",
    "--write",
    "--json",
  ]);
  assert.equal(redesign.status, 0, redesign.stderr || redesign.stdout);

  // Design is deliver-only: while the corrected requirement has not yet
  // arrived through wakeflow_deliver, repeated reduction must keep the product
  // task parked. Its pre-redesign result is history, not a fresh candidate.
  const firstWaitingReduction = run([
    "reduce-results",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--write",
    "--json",
  ]);
  assert.equal(firstWaitingReduction.status, 0, firstWaitingReduction.stderr || firstWaitingReduction.stdout);
  assert.equal(JSON.parse(firstWaitingReduction.stdout).candidateId, null);

  const secondWaitingReduction = run([
    "reduce-results",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--write",
    "--json",
  ]);
  assert.equal(secondWaitingReduction.status, 0, secondWaitingReduction.stderr || secondWaitingReduction.stdout);
  assert.equal(
    JSON.parse(secondWaitingReduction.stdout).candidateId,
    null,
    "the old product result must remain parked until Design delivers a corrected requirement and the controller adds corrected work",
  );
});

test("state invariant: decide-review rejects legacy or superseded result snapshots", () => {
  const root = makeRoot();
  const init = initDemand(root, "CANDIDATE-RESULT-IDENTITY");
  const stateRoot = path.join(root, init.stateRoot);

  const added = run([
    "add-task-package",
    "--root", root,
    "--state-root", init.stateRoot,
    "--task-package-id", "PKG",
    "--summary", "Implement the audited behavior.",
    "--target-window", "RepoA",
    "--target-task-id", "TASK",
    "--write",
    "--json",
  ]);
  assert.equal(added.status, 0, added.stderr || added.stdout);

  const imported = run([
    "import-target-result",
    "--root", root,
    "--state-root", init.stateRoot,
    "--target-task-id", "TASK",
    "--target-window", "RepoA",
    "--status", "completed",
    "--summary", "The first result reports completion.",
    "--write",
    "--json",
  ]);
  assert.equal(imported.status, 0, imported.stderr || imported.stdout);

  const reduced = run([
    "reduce-results",
    "--root", root,
    "--state-root", init.stateRoot,
    "--write",
    "--json",
  ]);
  assert.equal(reduced.status, 0, reduced.stderr || reduced.stdout);
  const reducedPayload = JSON.parse(reduced.stdout);
  const candidateFile = path.join(
    stateRoot,
    "transition-candidates",
    `${reducedPayload.candidateId}.json`,
  );
  const candidate = readJson(candidateFile);
  assert.deepEqual(candidate.resultSnapshots, [{
    targetTaskId: "TASK",
    resultId: "tr-TASK",
    resultRevision: 1,
    dispatchGroup: null,
    status: "completed",
  }]);

  const legacyCandidate = { ...candidate };
  delete legacyCandidate.resultSnapshots;
  writeJson(candidateFile, legacyCandidate);
  const legacyDecision = run([
    "decide-review",
    "--root", root,
    "--state-root", init.stateRoot,
    "--candidate-id", reducedPayload.candidateId,
    "--decision", "accept",
    "--reason", "A legacy candidate must not be guessed through.",
    "--write",
    "--json",
  ]);
  assert.notEqual(legacyDecision.status, 0);
  assert.match(legacyDecision.stdout, /predates immutable result snapshots/);
  writeJson(candidateFile, candidate);

  const corrected = run([
    "import-target-result",
    "--root", root,
    "--state-root", init.stateRoot,
    "--target-task-id", "TASK",
    "--target-window", "RepoA",
    "--status", "blocked",
    "--summary", "A late correction reports that the task is blocked.",
    "--supersede-result",
    "--write",
    "--json",
  ]);
  assert.equal(corrected.status, 0, corrected.stderr || corrected.stdout);
  assert.equal(JSON.parse(corrected.stdout).stateRevisionUnchanged, reducedPayload.stateRevision);

  const staleDecision = run([
    "decide-review",
    "--root", root,
    "--state-root", init.stateRoot,
    "--candidate-id", reducedPayload.candidateId,
    "--decision", "accept",
    "--reason", "The old completed result must not remain acceptable.",
    "--write",
    "--json",
  ]);
  assert.notEqual(staleDecision.status, 0);
  assert.match(staleDecision.stdout, /current target result identity changed/);
  assert.notEqual(readJson(path.join(stateRoot, "wakeflow-state.json")).targetTasks[0].status, "accepted");

  const reReduced = run([
    "reduce-results",
    "--root", root,
    "--state-root", init.stateRoot,
    "--write",
    "--json",
  ]);
  assert.equal(reReduced.status, 0, reReduced.stderr || reReduced.stdout);
  assert.deepEqual(JSON.parse(reReduced.stdout).blockedResultIds, ["tr-TASK"]);
});

test("state invariant: an event-first non-delivery crash is replayed from its exact transition journal", () => {
  const root = makeRoot();
  const init = initDemand(root, "STATE-TRANSITION-RECOVERY-INVARIANT");
  const stateRoot = path.join(root, init.stateRoot);
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const before = readJson(stateFile);
  const createdAt = new Date().toISOString();
  const recoveredRevision = before.revision + 1;
  const recoveredPackage = {
    schemaVersion: 1,
    taskPackageId: "RECOVERED-PACKAGE",
    demandKey: before.demandKey,
    summary: "Package whose state commit was interrupted.",
    status: "pending",
    sourceRef: null,
    createdAt,
    targetTasks: [],
  };
  const nextState = {
    ...before,
    state: "planned",
    stateReason: "task package added: RECOVERED-PACKAGE",
    revision: recoveredRevision,
    updatedAt: createdAt,
    taskPackages: [{
      taskPackageId: recoveredPackage.taskPackageId,
      summary: recoveredPackage.summary,
      status: "pending",
      sourceRef: null,
      createdAt,
    }],
    projection: {
      ...(before.projection ?? {}),
      status: "stale",
    },
  };
  const event = {
    eventId: "evt-state-transition-recovery-0002",
    createdAt,
    actor: "controller",
    type: "task-package.added",
    from: before.state,
    to: "planned",
    reason: "task package added: RECOVERED-PACKAGE",
    evidenceRefs: [],
    allowedWrites: [
      "wakeflow-state.json",
      "controller-events.jsonl",
      "task-packages/RECOVERED-PACKAGE.json",
    ],
    forbiddenConclusions: [],
    stateRevision: recoveredRevision,
  };
  writeJson(path.join(stateRoot, "wakeflow-state.pending-transition.json"), {
    kind: "WakeflowPendingStateTransition",
    version: 1,
    command: "add-task-package",
    createdAt,
    event,
    nextState,
    artifacts: [{
      path: "task-packages/RECOVERED-PACKAGE.json",
      value: recoveredPackage,
    }],
  });
  writeFileSync(eventsFile, `${JSON.stringify(event)}\n`, { flag: "a" });

  const blocked = run([
    "cancel-demand",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--reason",
    "The next write first recovers the interrupted package transition.",
    "--write",
    "--json",
  ]);
  assert.notEqual(blocked.status, 0);
  assert.equal(JSON.parse(blocked.stdout).errorCode, "state-transition-recovery-required");
  assert.deepEqual(readJson(stateFile), before);

  const recovered = run([
    "recover-state-transition",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--write",
    "--json",
  ]);
  assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
  assert.equal(readJson(stateFile).revision, recoveredRevision);
  assert.equal(readJson(stateFile).taskPackages[0].taskPackageId, "RECOVERED-PACKAGE");

  const cancelled = run([
    "cancel-demand",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--reason",
    "The independent cancellation runs only after explicit recovery.",
    "--write",
    "--json",
  ]);
  assert.equal(cancelled.status, 0, cancelled.stderr || cancelled.stdout);
  const after = readJson(stateFile);
  assert.equal(after.state, "cancelled");
  assert.equal(after.revision, recoveredRevision + 1);
  assert.equal(after.taskPackages[0].taskPackageId, "RECOVERED-PACKAGE");
  assert.equal(
    existsSync(path.join(stateRoot, "task-packages", "RECOVERED-PACKAGE.json")),
    true,
    "recovery must replay the transition's secondary authority artifact",
  );
  assert.equal(
    existsSync(path.join(stateRoot, "wakeflow-state.pending-transition.json")),
    false,
    "the journal is removed only after state and event agree",
  );
  const events = readFileSync(eventsFile, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(
    events.filter((item) => item.eventId === event.eventId).length,
    1,
    "recovery must not duplicate an event that already survived",
  );
  assert.deepEqual(
    events.map((item) => item.stateRevision),
    [before.revision, recoveredRevision, recoveredRevision + 1],
  );
});

test("state invariant: a journal-first crash is completed before the next state write", () => {
  const root = makeRoot();
  const init = initDemand(root, "JOURNAL-FIRST-RECOVERY-INVARIANT");
  const stateRoot = path.join(root, init.stateRoot);
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const before = readJson(stateFile);
  const createdAt = new Date().toISOString();
  const recoveredRevision = before.revision + 1;
  const event = {
    eventId: "evt-journal-first-recovery-0002",
    createdAt,
    actor: "controller",
    type: "demand.cancelled",
    from: before.state,
    to: "cancelled",
    reason: "The process stopped immediately after committing its transition journal.",
    evidenceRefs: [],
    allowedWrites: ["wakeflow-state.json", "controller-events.jsonl"],
    forbiddenConclusions: ["cancel-is-acceptance"],
    stateRevision: recoveredRevision,
  };
  const nextState = {
    ...before,
    state: "cancelled",
    stateReason: event.reason,
    revision: recoveredRevision,
    updatedAt: createdAt,
    allowedActions: ["wakeflow-render-progress"],
    projection: {
      ...(before.projection ?? {}),
      status: "stale",
    },
  };
  writeJson(path.join(stateRoot, "wakeflow-state.pending-transition.json"), {
    kind: "WakeflowPendingStateTransition",
    version: 1,
    command: "cancel-demand",
    createdAt,
    event,
    nextState,
    artifacts: [],
  });

  const blockedRender = runSync(process.execPath, [
    renderScript,
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--write",
    "--json",
  ], {
    cwd: wakeflowRoot,
    encoding: "utf8",
  });
  assert.notEqual(blockedRender.status, 0);
  const renderFailure = JSON.parse(blockedRender.stdout);
  assert.equal(renderFailure.errorCode, "state-transition-recovery-required");
  assert.equal(renderFailure.diagnostics?.retryable, true);

  const blockedWriter = run([
    "cancel-demand",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--reason",
    "A normal state writer must not recover this journal.",
    "--write",
    "--json",
  ]);
  assert.notEqual(blockedWriter.status, 0);
  assert.equal(JSON.parse(blockedWriter.stdout).errorCode, "state-transition-recovery-required");

  const recovered = run([
    "recover-state-transition",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--write",
    "--json",
  ]);
  assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
  const after = readJson(stateFile);
  assert.equal(after.state, "cancelled");
  assert.equal(after.revision, recoveredRevision);
  assert.equal(existsSync(path.join(stateRoot, "wakeflow-state.pending-transition.json")), false);
  const events = readFileSync(eventsFile, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(
    events.map((item) => item.stateRevision),
    [before.revision, recoveredRevision],
  );
  assert.equal(events.filter((item) => item.eventId === event.eventId).length, 1);
});

test("state invariant: an unjournaled non-delivery future event fails closed as manual recovery", () => {
  const root = makeRoot();
  const init = initDemand(root, "UNJOURNALED-EVENT-INVARIANT");
  const stateRoot = path.join(root, init.stateRoot);
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const before = readJson(stateFile);
  writeFileSync(eventsFile, `${JSON.stringify({
    eventId: "evt-legacy-orphan-0002",
    createdAt: new Date().toISOString(),
    actor: "controller",
    type: "task-package.added",
    from: before.state,
    to: "planned",
    reason: "legacy crash residue without a transition journal",
    evidenceRefs: [],
    stateRevision: before.revision + 1,
  })}\n`, { flag: "a" });

  const blocked = run([
    "cancel-demand",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--reason",
    "Must not guess a legacy orphan transition.",
    "--write",
    "--json",
  ]);
  assert.notEqual(blocked.status, 0);
  const payload = JSON.parse(blocked.stdout);
  assert.equal(payload.errorCode, "controller-event-manual-recovery-required");
  assert.equal(payload.diagnostics?.retryable, false);
  assert.equal(readJson(stateFile).revision, before.revision);
  assert.equal(readJson(stateFile).state, before.state);
});

test("state invariant: recovery never overwrites different state already occupying the journal revision", () => {
  const root = makeRoot();
  const init = initDemand(root, "STATE-CONTENT-COLLISION-INVARIANT");
  const stateRoot = path.join(root, init.stateRoot);
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const before = readJson(stateFile);
  const event = {
    eventId: "evt-state-content-collision",
    createdAt: new Date().toISOString(),
    actor: "controller",
    type: "fixture.collision",
    from: before.state,
    to: before.state,
    reason: "This journal must not replace different state at the same revision.",
    evidenceRefs: [],
    stateRevision: before.revision,
  };
  writeJson(path.join(stateRoot, "wakeflow-state.pending-transition.json"), {
    kind: "WakeflowPendingStateTransition",
    version: 1,
    command: "fixture",
    createdAt: event.createdAt,
    event,
    nextState: {
      ...before,
      title: "Different state content at the same revision",
    },
    artifacts: [],
  });

  const blocked = run([
    "recover-state-transition",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--write",
    "--json",
  ]);
  assert.notEqual(blocked.status, 0);
  const payload = JSON.parse(blocked.stdout);
  assert.equal(payload.errorCode, "controller-event-manual-recovery-required");
  assert.equal(payload.diagnostics?.retryable, false);
  assert.deepEqual(readJson(stateFile), before);
  assert.equal(
    readFileSync(path.join(stateRoot, "controller-events.jsonl"), "utf8").trim().split("\n").length,
    1,
    "a colliding pending event must not be appended",
  );
});

test("state invariant: recovery rejects an eventId already recorded with different content", () => {
  const root = makeRoot();
  const init = initDemand(root, "EVENT-CONTENT-COLLISION-INVARIANT");
  const stateRoot = path.join(root, init.stateRoot);
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const before = readJson(stateFile);
  const createdAt = new Date().toISOString();
  const targetRevision = before.revision + 1;
  const event = {
    eventId: "evt-event-content-collision",
    createdAt,
    actor: "controller",
    type: "demand.cancelled",
    from: before.state,
    to: "cancelled",
    reason: "Journal-authored reason.",
    evidenceRefs: [],
    stateRevision: targetRevision,
  };
  writeJson(path.join(stateRoot, "wakeflow-state.pending-transition.json"), {
    kind: "WakeflowPendingStateTransition",
    version: 1,
    command: "cancel-demand",
    createdAt,
    event,
    nextState: {
      ...before,
      state: "cancelled",
      stateReason: event.reason,
      revision: targetRevision,
      updatedAt: createdAt,
    },
    artifacts: [],
  });
  writeFileSync(eventsFile, `${JSON.stringify({
    ...event,
    type: "task-package.added",
    reason: "Different event body using the same id and revision.",
  })}\n`, { flag: "a" });

  const blocked = run([
    "recover-state-transition",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--write",
    "--json",
  ]);
  assert.notEqual(blocked.status, 0);
  const payload = JSON.parse(blocked.stdout);
  assert.equal(payload.errorCode, "controller-event-manual-recovery-required");
  assert.match(payload.error, /different content/i);
  assert.deepEqual(readJson(stateFile), before);
  assert.equal(
    readFileSync(eventsFile, "utf8").trim().split("\n").length,
    2,
    "recovery must leave the conflicting audit log untouched for inspection",
  );
});

test("state invariant: transition artifact recovery refuses a symlink escape", () => {
  const root = makeRoot();
  const init = initDemand(root, "ARTIFACT-SYMLINK-INVARIANT");
  const stateRoot = path.join(root, init.stateRoot);
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const before = readJson(stateFile);
  const external = makeRoot();
  symlinkSync(external, path.join(stateRoot, "task-packages"));
  const createdAt = new Date().toISOString();
  const targetRevision = before.revision + 1;
  const event = {
    eventId: "evt-artifact-symlink-escape",
    createdAt,
    actor: "controller",
    type: "task-package.added",
    from: before.state,
    to: "planned",
    reason: "A recovered artifact must stay inside the state root.",
    evidenceRefs: [],
    stateRevision: targetRevision,
  };
  writeJson(path.join(stateRoot, "wakeflow-state.pending-transition.json"), {
    kind: "WakeflowPendingStateTransition",
    version: 1,
    command: "add-task-package",
    createdAt,
    event,
    nextState: {
      ...before,
      state: "planned",
      stateReason: event.reason,
      revision: targetRevision,
      updatedAt: createdAt,
    },
    artifacts: [{
      path: "task-packages/ESCAPE.json",
      value: { taskPackageId: "ESCAPE" },
    }],
  });

  const blocked = run([
    "recover-state-transition",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--write",
    "--json",
  ]);
  assert.notEqual(blocked.status, 0);
  const payload = JSON.parse(blocked.stdout);
  assert.equal(payload.errorCode, "controller-event-manual-recovery-required");
  assert.match(payload.error, /symbolic link/i);
  assert.deepEqual(readdirSync(external), [], "no artifact may be written through the symlink");
  assert.deepEqual(readJson(stateFile), before);
});

test("state invariant: transition artifacts cannot alias authority names by case", () => {
  const root = makeRoot();
  const init = initDemand(root, "ARTIFACT-AUTHORITY-ALIAS-INVARIANT");
  const stateRoot = path.join(root, init.stateRoot);
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const pendingFile = path.join(stateRoot, "wakeflow-state.pending-transition.json");
  const beforeState = readJson(stateFile);
  const beforeEvents = readFileSync(eventsFile, "utf8");
  const createdAt = new Date().toISOString();
  const targetRevision = beforeState.revision + 1;
  const event = {
    eventId: "evt-artifact-authority-alias",
    createdAt,
    actor: "controller",
    type: "task-package.added",
    from: beforeState.state,
    to: "planned",
    reason: "A case variant must not replace the controller event log.",
    evidenceRefs: [],
    stateRevision: targetRevision,
  };
  writeJson(pendingFile, {
    kind: "WakeflowPendingStateTransition",
    version: 1,
    command: "add-task-package",
    createdAt,
    event,
    nextState: {
      ...beforeState,
      state: "planned",
      stateReason: event.reason,
      revision: targetRevision,
      updatedAt: createdAt,
    },
    artifacts: [{
      path: "CONTROLLER-EVENTS.JSONL",
      value: { poison: true },
    }],
  });

  const blocked = run([
    "recover-state-transition",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--write",
    "--json",
  ]);
  assert.notEqual(blocked.status, 0);
  const payload = JSON.parse(blocked.stdout);
  assert.equal(payload.errorCode, "controller-event-manual-recovery-required");
  assert.match(payload.error, /cannot replace an authority file/i);
  assert.deepEqual(readJson(stateFile), beforeState);
  assert.equal(readFileSync(eventsFile, "utf8"), beforeEvents);
  assert.equal(existsSync(pendingFile), true, "the rejected journal remains available for inspection");
});

test("state invariant: a journaled artifact write failure returns structured recovery and replays once", {
  skip: typeof process.getuid === "function" && process.getuid() === 0
    ? "chmod is bypassed when running as root"
    : false,
}, () => {
  const root = makeRoot();
  const init = initDemand(root, "STRUCTURED-TRANSITION-FAILURE-INVARIANT");
  const stateRoot = path.join(root, init.stateRoot);
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const pendingFile = path.join(stateRoot, "wakeflow-state.pending-transition.json");
  const packageDir = path.join(stateRoot, "task-packages");
  const beforeState = readJson(stateFile);
  const beforeEvents = readFileSync(eventsFile, "utf8");
  mkdirSync(packageDir);
  chmodSync(packageDir, 0o500);
  let failed;
  try {
    failed = run([
      "add-task-package",
      "--root",
      root,
      "--state-root",
      init.stateRoot,
      "--task-package-id",
      "RECOVERABLE-PACKAGE",
      "--summary",
      "Recover a package after its artifact write fails.",
      "--target-window",
      "Product",
      "--target-task-id",
      "RECOVERABLE-TASK",
      "--write",
      "--json",
    ]);
  } finally {
    chmodSync(packageDir, 0o700);
  }

  assert.notEqual(failed.status, 0);
  const failure = JSON.parse(failed.stdout);
  assert.equal(failure.errorCode, "state-transition-recovery-required");
  assert.equal(failure.diagnostics?.retryable, true);
  assert.equal(failure.diagnostics?.recovery?.strategy, "run-recover-state-transition");
  assert.deepEqual(readJson(stateFile), beforeState);
  assert.equal(readFileSync(eventsFile, "utf8"), beforeEvents);
  assert.equal(existsSync(pendingFile), true);

  const recovered = run([
    "recover-state-transition",
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--write",
    "--json",
  ]);
  assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
  const afterState = readJson(stateFile);
  assert.equal(afterState.revision, beforeState.revision + 1);
  assert.equal(afterState.taskPackages.at(-1)?.taskPackageId, "RECOVERABLE-PACKAGE");
  assert.equal(existsSync(path.join(packageDir, "RECOVERABLE-PACKAGE.json")), true);
  assert.equal(existsSync(pendingFile), false);
  const events = readFileSync(eventsFile, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(events.map((item) => item.stateRevision), [1, 2]);
});
