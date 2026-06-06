#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const script = path.join(workspaceRoot, "scripts/codex-automation-loop.mjs");

function writeText(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${content.trimEnd()}\n`);
}

function writeJson(file, value) {
  writeText(file, JSON.stringify(value, null, 2));
}

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "codex-loop-state-only-"));
  writeJson(path.join(root, "workspace.config.json"), {
    workspaceName: "ControlWorkspace",
    controlWindow: "AlembicWorkspace",
    repositories: [
      { windowName: "AlembicWorkspace", path: ".", role: "controller" },
      { windowName: "AlembicPlugin", path: "../AlembicPlugin", role: "plugin" },
    ],
    dispatchWindows: ["AlembicWorkspace", "AlembicPlugin"],
  });
  const stateRoot = path.join(root, ".workspace-active/workspace/current/CSMR-FIXTURE");
  mkdirSync(path.join(stateRoot, "task-packages"), { recursive: true });
  mkdirSync(path.join(stateRoot, "target-results"), { recursive: true });
  writeJson(path.join(stateRoot, "controller-state.json"), {
    schemaVersion: 1,
    demandKey: "CSMR-FIXTURE",
    title: "Controller State Fixture",
    state: "planned",
    stateReason: "test",
    revision: 3,
    activeStageId: null,
    updatedAt: "2026-06-05T00:00:00.000Z",
    allowedActions: [],
    blockers: [],
    decisionsRequired: [],
    stages: [],
    taskPackages: [{
      taskPackageId: "CSMR-PKG-1",
      summary: "Fixture package",
      status: "pending",
      createdAt: "2026-06-05T00:00:00.000Z",
    }],
    targetTasks: [{
      targetTaskId: "CSMR-TASK-1",
      taskPackageId: "CSMR-PKG-1",
      targetWindow: "AlembicPlugin",
      summary: "Run fixture target task",
      status: "pending",
      createdAt: "2026-06-05T00:00:00.000Z",
    }],
    windows: [{
      windowName: "AlembicPlugin",
      windowState: "pending",
      taskPackageIds: ["CSMR-PKG-1"],
      targetTaskIds: ["CSMR-TASK-1"],
    }],
    review: {
      status: "none",
      readyResultIds: [],
      blockedResultIds: [],
      missingResultIds: [],
    },
    automation: {
      enabled: false,
      activeRunIds: [],
      lastReviewPack: null,
    },
    projection: {
      status: "synced",
      lastRenderedAt: "2026-06-05T00:00:00.000Z",
      progressDoc: "developer-progress.md",
    },
  });
  writeJson(path.join(stateRoot, "task-packages/CSMR-PKG-1.json"), {
    schemaVersion: 1,
    taskPackageId: "CSMR-PKG-1",
    demandKey: "CSMR-FIXTURE",
    summary: "Fixture package",
    status: "pending",
    targetTasks: [{
      targetTaskId: "CSMR-TASK-1",
      taskPackageId: "CSMR-PKG-1",
      targetWindow: "AlembicPlugin",
      summary: "Run fixture target task",
      status: "pending",
    }],
    createdAt: "2026-06-05T00:00:00.000Z",
  });
  writeText(path.join(stateRoot, "developer-progress.md"), "# Controller State Fixture");
  return {
    root,
    stateRootRef: ".workspace-active/workspace/current/CSMR-FIXTURE",
    stateRoot,
  };
}

function run(root, args) {
  return spawnSync("node", [script, ...args, "--root", root, "--json"], {
    cwd: root,
    encoding: "utf8",
  });
}

function parseOk(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function registerThread(root, windowName, role = "target") {
  return parseOk(run(root, [
    "register-thread",
    "--window",
    windowName,
    "--thread-id",
    `0192fac-${windowName}`,
    "--role",
    role,
    "--write",
  ]));
}

function prepareDispatch(root, stateRootRef, options = {}) {
  const config = Array.isArray(options) ? { extra: options } : options;
  const group = config.group || "GROUP-STATE";
  const extra = config.extra || [];
  return parseOk(run(root, [
    "prepare-dispatch-from-state",
    "--state-root",
    stateRootRef,
    "--target-task-id",
    "CSMR-TASK-1",
    "--group",
    group,
    "--controller-window",
    "AlembicWorkspace",
    "--human-context-ref",
    `${stateRootRef}/developer-progress.md`,
    "--require-thread",
    "--write",
    ...extra,
  ]));
}

test("help exposes state-root commands and rejects old dispatch routes", () => {
  const { root } = makeFixture();
  const help = spawnSync("node", [script, "--help", "--root", root], { cwd: root, encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /prepare-dispatch-from-state/);
  assert.doesNotMatch(help.stdout, /create-dispatch/);
  assert.doesNotMatch(help.stdout, /prepare-dispatch --target-window/);
  assert.doesNotMatch(help.stdout, /--control-plan/);

  for (const command of ["create-dispatch", "prepare-dispatch"]) {
    const result = run(root, [command, "--write"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Unknown command/);
  }
});

test("registers threads locally and redacts thread ids", () => {
  const { root } = makeFixture();
  const payload = registerThread(root, "AlembicPlugin");
  assert.equal(payload.ok, true);
  assert.equal(payload.windowName, "AlembicPlugin");
  assert.equal(payload.threadIdRedacted, true);
  assert.doesNotMatch(JSON.stringify(payload), /0192fac-AlembicPlugin/);

  const config = parseOk(run(root, ["build-window-config", "--window", "AlembicPlugin", "--require-thread", "--write"]));
  assert.equal(config.config.threadRegistered, true);
  assert.equal(config.config.dispatchable, true);
  assert.equal(config.config.delivery.transport, "direct-thread");
});

test("prepare-dispatch-from-state writes packet, group, and delivery without control plan authority", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  const payload = prepareDispatch(root, stateRootRef);

  assert.equal(payload.ok, true);
  assert.equal(payload.command, "prepare-dispatch-from-state");
  assert.equal(payload.packet.controlPlan, undefined);
  assert.equal(payload.dispatchGroup.controlPlan, undefined);
  assert.equal(payload.envelope.controlPlan, undefined);
  assert.equal(payload.packet.stateRef.stateRoot, stateRootRef);
  assert.equal(payload.packet.stateRef.taskPackageId, "CSMR-PKG-1");
  assert.equal(payload.packet.stateRef.stateRevision, 3);
  assert.equal(payload.dispatchGroup.stateRef.stateRoot, stateRootRef);
  assert.equal(payload.envelope.stateRef.targetTaskId, "CSMR-TASK-1");
  assert.match(payload.packet.prompt, /- stateRoot: \.workspace-active\/workspace\/current\/CSMR-FIXTURE/);
  assert.match(payload.packet.prompt, /- dispatchGroup: GROUP-STATE/);
  assert.doesNotMatch(payload.packet.prompt, /humanContextRef:/);
  assert.doesNotMatch(payload.packet.prompt, /stateRevision:/);
  assert.doesNotMatch(payload.packet.prompt, /taskPackageId:/);
  assert.doesNotMatch(payload.packet.prompt, /demandKey:/);
  assert.doesNotMatch(payload.packet.prompt, /controllerWindow:/);
  assert.doesNotMatch(payload.packet.prompt, /rules:/);
  assert.doesNotMatch(payload.packet.prompt, /controlPlan:/);
  assert.doesNotMatch(payload.packet.prompt, /<codex_delegation>|<input>|source_thread_id/);
  assert.equal(payload.envelope.prompt, payload.packet.prompt);
  assert.doesNotMatch(readFileSync(path.join(root, payload.packetFile), "utf8"), /controlPlan/);
  assert.doesNotMatch(readFileSync(path.join(root, payload.deliveryFile), "utf8"), /controlPlan/);
  assert.doesNotMatch(readFileSync(path.join(root, payload.deliveryFile), "utf8"), /0192fac-AlembicPlugin/);
});

test("prepare-dispatch-from-state rejects completed and accepted state-root tasks", () => {
  const { root, stateRootRef, stateRoot } = makeFixture();
  const stateFile = path.join(stateRoot, "controller-state.json");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  state.state = "completed";
  state.review.status = "demand-completed";
  state.taskPackages[0].status = "accepted";
  state.targetTasks[0].status = "accepted";
  writeJson(stateFile, state);

  const completed = run(root, [
    "prepare-dispatch-from-state",
    "--state-root",
    stateRootRef,
    "--target-task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-STATE",
    "--controller-window",
    "AlembicWorkspace",
    "--write",
  ]);
  assert.notEqual(completed.status, 0);
  assert.match(completed.stdout, /cannot prepare dispatch while controller state is completed/);

  state.state = "planned";
  writeJson(stateFile, state);
  const accepted = run(root, [
    "prepare-dispatch-from-state",
    "--state-root",
    stateRootRef,
    "--target-task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-STATE",
    "--controller-window",
    "AlembicWorkspace",
    "--write",
  ]);
  assert.notEqual(accepted.status, 0);
  assert.match(accepted.stdout, /target task CSMR-TASK-1 is accepted/);

  state.state = "blocked";
  state.taskPackages[0].status = "pending";
  state.targetTasks[0].status = "pending";
  writeJson(stateFile, state);
  const blocked = run(root, [
    "prepare-dispatch-from-state",
    "--state-root",
    stateRootRef,
    "--target-task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-STATE",
    "--controller-window",
    "AlembicWorkspace",
    "--write",
  ]);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stdout, /cannot prepare dispatch while controller state is blocked/);
});

test("build-delivery rejects legacy packets without stateRef", () => {
  const { root } = makeFixture();
  const packetFile = path.join(root, "legacy-packet.json");
  writeJson(packetFile, {
    kind: "ControllerDispatchPacket",
    version: 1,
    id: "legacy-packet",
    targetWindow: "AlembicPlugin",
    taskId: "TASK-LEGACY",
    prompt: "继续当前窗口任务：AlembicPlugin / TASK-LEGACY。",
  });
  const result = run(root, ["build-delivery", "--packet-file", "legacy-packet.json", "--write"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /missing stateRef/);
});

test("review-results and controller return require state-root group evidence", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  registerThread(root, "AlembicWorkspace", "controller");
  const prepared = prepareDispatch(root, stateRootRef);

  const waiting = parseOk(run(root, ["review-results", "--group", "GROUP-STATE"]));
  assert.equal(waiting.decision, "wait");
  assert.equal(waiting.groupSnapshot.missingTargets[0], "AlembicPlugin");

  const completed = parseOk(run(root, [
    "submit-result",
    "--target-window",
    "AlembicPlugin",
    "--task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-STATE",
    "--status",
    "completed",
    "--evidence-ref",
    "reports/result.json",
    "--verification",
    "focused smoke passed",
    "--write",
  ]));
  assert.equal(completed.result.status, "completed");

  const ready = parseOk(run(root, ["review-results", "--group", "GROUP-STATE"]));
  assert.equal(ready.decision, "needs-controller-review");
  assert.equal(ready.groupSnapshot.readyTargets[0], "AlembicPlugin");

  const returned = parseOk(run(root, [
    "build-controller-return",
    "--group",
    "GROUP-STATE",
    "--trigger-target",
    "AlembicPlugin",
    "--trigger-task-id",
    "CSMR-TASK-1",
    "--require-thread",
    "--write",
  ]));
  assert.equal(returned.envelope.controlPlan, undefined);
  assert.equal(returned.envelope.stateRef.stateRoot, stateRootRef);
  assert.equal(returned.envelope.humanContextRef, `${stateRootRef}/developer-progress.md`);
  assert.match(returned.envelope.prompt, /- stateRoot: \.workspace-active\/workspace\/current\/CSMR-FIXTURE/);
  assert.match(returned.envelope.prompt, /- trigger: AlembicPlugin \/ CSMR-TASK-1/);
  assert.doesNotMatch(returned.envelope.prompt, /controllerWindow:/);
  assert.doesNotMatch(returned.envelope.prompt, /returnPolicy:/);
  assert.doesNotMatch(returned.envelope.prompt, /reviewScope:/);
  assert.doesNotMatch(returned.envelope.prompt, /groupStatus:/);
  assert.doesNotMatch(returned.envelope.prompt, /humanContextRef:/);
  assert.doesNotMatch(returned.envelope.prompt, /stateRevision:/);
  assert.doesNotMatch(returned.envelope.prompt, /taskPackageId:/);
  assert.doesNotMatch(returned.envelope.prompt, /demandKey:/);
  assert.doesNotMatch(returned.envelope.prompt, /rules:/);
  assert.doesNotMatch(returned.envelope.prompt, /controlPlan:/);
  assert.doesNotMatch(returned.envelope.prompt, /<codex_delegation>|<input>|source_thread_id/);
  assert.doesNotMatch(readFileSync(path.join(root, returned.returnFile), "utf8"), /controlPlan/);
  assert.equal(returned.envelope.dispatchGroup, prepared.packet.dispatchGroup);

  const duplicateReturn = run(root, [
    "build-controller-return",
    "--group",
    "GROUP-STATE",
    "--trigger-target",
    "AlembicPlugin",
    "--trigger-task-id",
    "CSMR-TASK-1",
    "--require-thread",
    "--write",
  ]);
  assert.notEqual(duplicateReturn.status, 0);
  assert.match(duplicateReturn.stdout, /already has controller-return delivery status pending-host-send/);
});

test("target results are scoped by dispatch group to avoid parallel run collisions", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  prepareDispatch(root, stateRootRef, { group: "GROUP-A" });
  prepareDispatch(root, stateRootRef, { group: "GROUP-B" });

  const resultA = parseOk(run(root, [
    "submit-result",
    "--target-window",
    "AlembicPlugin",
    "--task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-A",
    "--status",
    "completed",
    "--evidence-ref",
    "reports/group-a.json",
    "--write",
  ]));
  const resultB = parseOk(run(root, [
    "submit-result",
    "--target-window",
    "AlembicPlugin",
    "--task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-B",
    "--status",
    "blocked",
    "--evidence-ref",
    "reports/group-b.json",
    "--risk",
    "group B is intentionally blocked",
    "--write",
  ]));

  assert.match(resultA.resultFile, /GROUP-A__AlembicPlugin__CSMR-TASK-1\.json$/);
  assert.match(resultB.resultFile, /GROUP-B__AlembicPlugin__CSMR-TASK-1\.json$/);
  assert.notEqual(resultA.resultFile, resultB.resultFile);

  const reviewA = parseOk(run(root, ["review-results", "--group", "GROUP-A"]));
  assert.equal(reviewA.decision, "needs-controller-review");
  assert.equal(reviewA.groupSnapshot.ready[0].status, "completed");

  const reviewB = parseOk(run(root, ["review-results", "--group", "GROUP-B"]));
  assert.equal(reviewB.decision, "blocked");
  assert.equal(reviewB.groupSnapshot.blocked[0].status, "blocked");
});

test("review-pack gates missing path evidence refs before controller verdict", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  prepareDispatch(root, stateRootRef);

  parseOk(run(root, [
    "submit-result",
    "--target-window",
    "AlembicPlugin",
    "--task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-STATE",
    "--status",
    "completed",
    "--evidence-ref",
    "reports/missing-result.json",
    "--verification",
    "focused smoke passed",
    "--write",
  ]));

  const missing = parseOk(run(root, ["review-pack", "--group", "GROUP-STATE"]));
  assert.equal(missing.reviewPack.decision, "needs-controller-review");
  assert.equal(missing.reviewPack.gates.controllerReviewReady, false);
  assert.equal(missing.reviewPack.gates.missingEvidenceRefsPresent, true);
  assert.equal(missing.reviewPack.gates.evidenceRepairRequired, true);
  assert.equal(missing.reviewPack.gates.totalControlVerdictRequired, false);
  assert.deepEqual(missing.reviewPack.missingEvidenceRefs, [{
    targetWindow: "AlembicPlugin",
    taskId: "CSMR-TASK-1",
    ref: "reports/missing-result.json",
  }]);
  assert.match(missing.reviewPack.nextAction, /fix-missing-evidence-refs/);

  writeText(path.join(root, "reports/missing-result.json"), "{\"ok\": true}");
  const repaired = parseOk(run(root, ["review-pack", "--group", "GROUP-STATE"]));
  assert.equal(repaired.reviewPack.gates.controllerReviewReady, true);
  assert.equal(repaired.reviewPack.gates.missingEvidenceRefsPresent, false);
  assert.deepEqual(repaired.reviewPack.missingEvidenceRefs, []);
});

test("controller-return blocked delivery records controller window evidence", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  prepareDispatch(root, stateRootRef);
  parseOk(run(root, [
    "submit-result",
    "--target-window",
    "AlembicPlugin",
    "--task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-STATE",
    "--status",
    "completed",
    "--evidence-ref",
    "reports/result.json",
    "--verification",
    "focused smoke passed",
    "--write",
  ]));

  const returned = parseOk(run(root, [
    "build-controller-return",
    "--group",
    "GROUP-STATE",
    "--trigger-target",
    "AlembicPlugin",
    "--trigger-task-id",
    "CSMR-TASK-1",
    "--write",
  ]));
  assert.equal(returned.threadReady, false);

  const recorded = parseOk(run(root, [
    "record-delivery-run",
    "--delivery-file",
    returned.returnFile,
    "--status",
    "blocked",
    "--error",
    "controller thread missing",
    "--write",
  ]));
  assert.equal(recorded.run.targetWindow, "AlembicWorkspace");
  assert.equal(recorded.run.thread.windowName, "AlembicWorkspace");
  assert.equal(recorded.run.status, "blocked");
});

test("state-root review-pack reads target results from controller state root", () => {
  const { root, stateRootRef, stateRoot } = makeFixture();
  const absoluteEvidence = path.join(root, "absolute-evidence.json");
  writeText(path.join(stateRoot, "reports/plugin-result.json"), "{\"ok\": true}");
  writeText(path.join(root, "workspace-ledger/evidence/plugin-result.json"), "{\"workspaceRelative\": true}");
  writeText(absoluteEvidence, "{\"absolute\": true}");
  writeJson(path.join(stateRoot, "target-results/result-1.json"), {
    schemaVersion: 1,
    resultId: "result-1",
    demandKey: "CSMR-FIXTURE",
    taskPackageId: "CSMR-PKG-1",
    targetTaskId: "CSMR-TASK-1",
    targetWindow: "AlembicPlugin",
    status: "completed",
    evidenceRefs: ["reports/plugin-result.json", "workspace-ledger/evidence/plugin-result.json", absoluteEvidence],
    verification: ["unit tests passed"],
    risks: [],
    createdAt: "2026-06-05T00:01:00.000Z",
  });

  const payload = parseOk(run(root, ["review-pack", "--state-root", stateRootRef]));
  assert.equal(payload.source, "controller-state-root");
  assert.equal(payload.decision, "needs-controller-review");
  assert.equal(payload.reviewPack.gates.stateRootBased, true);
  assert.equal(payload.reviewPack.gates.controllerReviewReady, true);
  assert.equal(payload.reviewPack.gates.missingEvidenceRefsPresent, false);
  assert.equal(payload.reviewPack.targetResults[0].stateRootResult, true);
  assert.equal(payload.reviewPack.rawEvidenceRequired[0].evidenceRefs[0], "reports/plugin-result.json");
  const summaries = payload.reviewPack.targetResults[0].evidenceRefSummaries;
  assert.equal(summaries[0].stateRootRelativePath, `${stateRootRef}/reports/plugin-result.json`);
  assert.equal(summaries[0].resolvedAgainst, "state-root");
  assert.equal(summaries[1].ref, "workspace-ledger/evidence/plugin-result.json");
  assert.equal(summaries[1].exists, true);
  assert.equal(summaries[1].path, "workspace-ledger/evidence/plugin-result.json");
  assert.equal(summaries[1].resolvedAgainst, "workspace-root");
  assert.equal(summaries[2].ref, absoluteEvidence);
  assert.equal(summaries[2].exists, true);
  assert.equal(summaries[2].stateRootRelativePath, undefined);
});

test("state-root review-pack does not mark empty target lists as review ready", () => {
  const { root, stateRootRef, stateRoot } = makeFixture();
  const stateFile = path.join(stateRoot, "controller-state.json");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  state.taskPackages = [];
  state.targetTasks = [];
  state.windows = [];
  writeJson(stateFile, state);

  const payload = parseOk(run(root, ["review-pack", "--state-root", stateRootRef]));
  assert.equal(payload.decision, "no-target-tasks");
  assert.equal(payload.groupStatus, "empty");
  assert.equal(payload.reviewPack.gates.noTargetTasks, true);
  assert.equal(payload.reviewPack.gates.controllerReviewReady, false);
  assert.equal(payload.reviewPack.gates.totalControlVerdictRequired, false);
  assert.equal(payload.reviewPack.nextAction, "add-task-package-before-review");
  assert.equal(payload.agentNext, "No target tasks are reviewable; add a task package before dispatch or review.");
});

test("completed state-root review-pack stops instead of asking for another verdict", () => {
  const { root, stateRootRef, stateRoot } = makeFixture();
  writeText(path.join(stateRoot, "reports/plugin-result.json"), "{\"ok\": true}");
  writeJson(path.join(stateRoot, "target-results/result-1.json"), {
    schemaVersion: 1,
    resultId: "result-1",
    demandKey: "CSMR-FIXTURE",
    taskPackageId: "CSMR-PKG-1",
    targetTaskId: "CSMR-TASK-1",
    targetWindow: "AlembicPlugin",
    status: "completed",
    evidenceRefs: ["reports/plugin-result.json"],
    verification: ["unit tests passed"],
    risks: [],
    createdAt: "2026-06-05T00:01:00.000Z",
  });
  const stateFile = path.join(stateRoot, "controller-state.json");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  state.state = "completed";
  state.stateReason = "done";
  state.revision = 5;
  state.taskPackages[0].status = "accepted";
  state.targetTasks[0].status = "accepted";
  state.targetTasks[0].resultId = "result-1";
  state.targetTasks[0].reviewDecision = "accept";
  state.windows[0].windowState = "accepted";
  state.review = {
    status: "demand-completed",
    readyResultIds: ["result-1"],
    blockedResultIds: [],
    missingResultIds: [],
  };
  writeJson(stateFile, state);

  const payload = parseOk(run(root, ["review-pack", "--state-root", stateRootRef]));
  assert.equal(payload.decision, "completed");
  assert.equal(payload.groupStatus, "completed");
  assert.equal(payload.reviewPack.controllerState, "completed");
  assert.equal(payload.reviewPack.gates.controllerReviewReady, false);
  assert.equal(payload.reviewPack.gates.totalControlVerdictRequired, false);
  assert.equal(payload.reviewPack.gates.rawEvidencePullRequired, false);
  assert.equal(payload.reviewPack.nextAction, "demand-completed-stop-without-next-dispatch");
  assert.equal(payload.agentNext, "Demand is completed; stop without creating new deliveries.");
});

test("completed target results require reviewable evidence", () => {
  const { root } = makeFixture();
  const result = run(root, [
    "submit-result",
    "--target-window",
    "AlembicPlugin",
    "--task-id",
    "CSMR-TASK-1",
    "--status",
    "completed",
    "--write",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /completed results require/);
});

test("record-delivery-run enforces sent readback evidence", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  const prepared = prepareDispatch(root, stateRootRef);

  const missingEvidence = run(root, [
    "record-delivery-run",
    "--delivery-file",
    prepared.deliveryFile,
    "--status",
    "sent",
    "--readback-ok",
    "true",
    "--write",
  ]);
  assert.notEqual(missingEvidence.status, 0);
  assert.match(missingEvidence.stdout, /sent delivery runs require/);

  const recorded = parseOk(run(root, [
    "record-delivery-run",
    "--delivery-file",
    prepared.deliveryFile,
    "--status",
    "sent",
    "--readback-ok",
    "true",
    "--evidence",
    "read_thread latest turn is inProgress",
    "--write",
  ]));
  assert.equal(recorded.status, "sent");
  assert.equal(recorded.run.readback.ok, true);
  assert.match(recorded.agentNext, /Controller-side delivery is complete/);
  assert.match(recorded.agentNext, /Do not poll, sleep, or run review-results/);
  assert.doesNotMatch(recorded.agentNext, /Wait for the target result envelope/);
  assert.doesNotMatch(JSON.stringify(recorded), /0192fac-AlembicPlugin/);
});

test("waiting review results tell total control to stop instead of polling", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  prepareDispatch(root, stateRootRef);

  const waiting = parseOk(run(root, [
    "review-results",
    "--group",
    "GROUP-STATE",
  ]));

  assert.equal(waiting.decision, "wait");
  assert.match(waiting.agentNext, /stop this turn/);
  assert.match(waiting.agentNext, /instead of polling or sleeping/);
  assert.doesNotMatch(waiting.agentNext, /Wait for missing target result envelopes/);
});

test("stop-loop writes a stop marker without creating new delivery state", () => {
  const { root } = makeFixture();
  const payload = parseOk(run(root, [
    "stop-loop",
    "--reason",
    "test complete",
    "--write",
  ]));
  assert.equal(payload.command, "stop-loop");
  assert.equal(payload.reason, "test complete");
  assert.equal(payload.keepLive.active, false);
});
