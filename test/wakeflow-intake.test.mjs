#!/usr/bin/env node

import assert from "node:assert/strict";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const intakeScript = path.join(workspaceRoot, "scripts/wakeflow-intake.mjs");
const controllerScript = path.join(workspaceRoot, "scripts/wakeflow-state.mjs");
const renderScript = path.join(workspaceRoot, "scripts/wakeflow-render-progress.mjs");

function writeText(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${content.trimEnd()}\n`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function run(script, root, args) {
  return runSync(process.execPath, [script, ...args, "--root", root, "--json"], {
    cwd: root,
    encoding: "utf8",
  });
}

function parseOk(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function designDoc(id, title) {
  return `# ${title}

Design Key: ${id}

## Goal

Fixture only.
`;
}

function makeFixture({ demandKey = "enum-flow-2026-05-30", state = "intake", stateRootArg = null } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-intake-"));
  const externalLedgerRoot = `../wakeflow-ledger-${path.basename(root)}`;
  const externalCurrentDir = `${externalLedgerRoot}/current`;
  const resolvedStateRootArg = stateRootArg === "project-ledger"
    ? `${externalCurrentDir}/LEDGER-FIXTURE-${path.basename(root)}`
    : stateRootArg;
  writeText(path.join(root, "wakeflow.config.json"), JSON.stringify({
    workspaceName: "Wakeflow",
    controllerWindow: "AlembicWorkspace",
    designWindow: "DesignWindow",
    testWindow: "TestWindow",
    ...(stateRootArg === "project-ledger"
      ? { workspaceCurrentDir: externalCurrentDir }
      : {}),
    designHandoffBoard: "DesignWindow/docs/current/workspace-handoff-board.md",
    repositories: [
      { windowName: "AlembicWorkspace", path: ".", role: "controller" },
      { windowName: "DesignWindow", path: "DesignWindow", role: "design", managedAgents: false },
      { windowName: "TestWindow", path: "TestWindow", role: "test", managedAgents: false },
    ],
  }, null, 2));

  const designKey = "enum-flow-2026-05-30";
  const designDir = path.join(root, "DesignWindow/docs/current/enum-flow");
  writeText(path.join(designDir, "original-plan-2026-05-30.md"), designDoc(designKey, "Original Plan"));
  writeText(path.join(designDir, "requirement-design-2026-05-30.md"), designDoc(designKey, "Requirement Design"));
  writeText(path.join(designDir, "workspace-handoff-2026-05-30.md"), designDoc(designKey, "Workspace Handoff"));
  writeText(
    path.join(root, "DesignWindow/docs/current/workspace-handoff-board.md"),
    `# Workspace Handoff Board

## Handoff Board

| ID | Status | Title | Original Plan | Requirement Design | Handoff | User Confirmation Status | User Confirmation | Mainline Relation Status | Current Mainline Relation | Suggested TODO | Priority Enum | Priority | Next Step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ${designKey} | ready-for-workspace | Enum fixture | [original](enum-flow/original-plan-2026-05-30.md) | [design](enum-flow/requirement-design-2026-05-30.md) | [handoff](enum-flow/workspace-handoff-2026-05-30.md) | confirmed | user confirmed | todo-candidate | does not affect current mainline | TODO | P1 | P1 | controller intake |
`,
  );

  const init = parseOk(run(controllerScript, root, [
    "init",
    "--demand-key",
    demandKey,
    "--title",
    "Fixture Demand",
    "--goal",
    "Fixture goal.",
    "--completion-definition",
    "Fixture complete.",
    ...(resolvedStateRootArg ? ["--state-root", resolvedStateRootArg] : []),
    "--write",
  ]));
  const stateRoot = path.join(root, init.stateRoot);
  if (state !== "intake") {
    const stateFile = path.join(stateRoot, "wakeflow-state.json");
    const controllerState = readJson(stateFile);
    controllerState.state = state;
    writeText(stateFile, JSON.stringify(controllerState, null, 2));
  }
  return {
    root,
    designKey,
    stateRoot,
    stateRootRef: init.stateRoot,
  };
}

function testCardArgs(stateRootRef, extra = []) {
  return [
    "test-card",
    "--state-root",
    stateRootRef,
    "--test-id",
    "REAL-SCENARIO-T1",
    "--target-window",
    "TestWindow",
    "--strategy-source",
    "Design/requirements.md#confirmed-test-plan",
    "--approved-test-step",
    "Call the configured runtime entry once and capture its raw response.",
    "--approved-test-step",
    "Compare the response with the confirmed success and failure meanings.",
    "--setup-policy",
    "fresh-once",
    "--max-attempts",
    "2",
    "--question",
    "Does the real scenario produce the expected runtime signal?",
    "--object-boundary",
    "Only the configured fixture project and this state root.",
    "--controller-self-check",
    "Unit and state-machine checks already passed.",
    "--real-scenario-condition",
    "Requires the TestWindow real project runtime.",
    "--success-means",
    "The runtime signal is observed with raw evidence.",
    "--failure-means",
    "The real scenario cannot prove the runtime signal.",
    "--cannot-conclude",
    "This does not prove unrelated UI behavior.",
    "--stop-condition",
    "Stop if the real project has unexpected dirty product changes.",
    "--evidence-required",
    "Report path and command output.",
    "--allowed-operation",
    "Run the configured smoke command.",
    "--forbidden-operation",
    "Do not change product source.",
    ...extra,
  ];
}

test("test-card writes machine boundary card and leaves controller state unchanged", () => {
  const fixture = makeFixture();
  const before = readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json"), "utf8");
  const payload = parseOk(run(intakeScript, fixture.root, [
    ...testCardArgs(fixture.stateRootRef),
    "--write",
  ]));

  assert.equal(payload.ok, true);
  assert.equal(payload.command, "test-card");
  assert.equal(payload.targetWindow, "TestWindow");
  assert.match(payload.cardFile, /test-cards\/REAL-SCENARIO-T1\.json/);
  assert.equal(readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json"), "utf8"), before);

  const card = readJson(path.join(fixture.root, payload.cardFile));
  assert.equal(card.kind, "TestBoundaryCard");
  assert.equal(card.status, "draft");
  assert.equal(card.boundaryGate.question, "Does the real scenario produce the expected runtime signal?");
  assert.equal(card.boundaryGate.cannotConclude[0], "This does not prove unrelated UI behavior.");
  assert.equal(card.executionContract.requirementGoal, "Fixture goal.");
  assert.deepEqual(card.executionContract.approvedPlan, [
    "Call the configured runtime entry once and capture its raw response.",
    "Compare the response with the confirmed success and failure meanings.",
  ]);
  assert.deepEqual(card.executionContract.allowedSkills, []);
  assert.equal(card.executionContract.setupPolicy, "fresh-once");
  assert.equal(card.executionContract.maxAttempts, 2);
  assert.equal(card.suggestedTaskPackage.sourceRef, "test-cards/REAL-SCENARIO-T1.json");
  assert.match(card.forbiddenConclusions.join("\n"), /test-card-is-dispatch/);
});

test("W-Test: test-card requires strategySource and persists the requirement/test-plan anchors", () => {
  const withF = makeFixture();
  const withPayload = parseOk(run(intakeScript, withF.root, [
    ...testCardArgs(withF.stateRootRef),
    "--write",
  ]));
  const withCard = readJson(path.join(withF.root, withPayload.cardFile));
  assert.equal(withCard.strategySource, "Design/requirements.md#confirmed-test-plan");
  assert.equal(withCard.executionContract.changeControl.testMayChangeGoal, false);
  assert.equal(withCard.executionContract.changeControl.testMayAddUnmappedSteps, false);

  const withoutF = makeFixture();
  const args = testCardArgs(withoutF.stateRootRef);
  const rawResult = run(intakeScript, withoutF.root, args.filter((value, index) => value !== "--strategy-source" && args[index - 1] !== "--strategy-source"));
  assert.notEqual(rawResult.status, 0);
  assert.match(rawResult.stdout, /--strategy-source is required/);
});

test("test-card makes PCV opt-in and requires explicit restart conditions", () => {
  const fixture = makeFixture();
  const args = testCardArgs(fixture.stateRootRef);
  args[args.indexOf("--setup-policy") + 1] = "fresh-per-attempt";
  args.push(
    "--allowed-test-skill", "progressive-chain-validation",
    "--restart-condition", "The accepted artifact version changed after a product repair.",
  );
  const payload = parseOk(run(intakeScript, fixture.root, [
    ...args,
    "--write",
  ]));
  const card = readJson(path.join(fixture.root, payload.cardFile));
  assert.deepEqual(card.executionContract.allowedSkills, ["progressive-chain-validation"]);
  assert.equal(card.executionContract.setupPolicy, "fresh-per-attempt");
  assert.deepEqual(card.executionContract.restartConditions, ["The accepted artifact version changed after a product repair."]);
});

test("test-card supports controller state roots in a configured external current ledger", () => {
  const fixture = makeFixture({ stateRootArg: "project-ledger" });
  parseOk(run(controllerScript, fixture.root, [
    "add-task-package",
    "--state-root", fixture.stateRootRef,
    "--task-package-id", "EXTERNAL-PKG",
    "--summary", "Exercise the configured external current ledger.",
    "--target-window", "AlembicWorkspace",
    "--target-task-id", "EXTERNAL-TASK",
    "--target-summary", "Keep state, render, and intake on one configured root.",
    "--write",
  ]));
  const rendered = parseOk(run(renderScript, fixture.root, [
    "--state-root", fixture.stateRootRef,
    "--write",
  ]));
  assert.equal(rendered.wrote, true);
  const payload = parseOk(run(intakeScript, fixture.root, [
    ...testCardArgs(fixture.stateRootRef),
    "--write",
  ]));

  assert.equal(payload.ok, true);
  assert.match(payload.stateRoot, /^\.\.\/wakeflow-ledger-wakeflow-intake-[^/]+\/current\/LEDGER-FIXTURE-wakeflow-intake-/);
  assert.equal(existsSync(path.join(fixture.stateRoot, "test-cards/REAL-SCENARIO-T1.json")), true);
});

test("test-card requires the full pre-test boundary gate", () => {
  const fixture = makeFixture();
  const args = testCardArgs(fixture.stateRootRef);
  const result = run(intakeScript, fixture.root, args.filter((arg) => arg !== "--cannot-conclude" && arg !== "This does not prove unrelated UI behavior."));
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /--cannot-conclude is required at least once/);
});

test("test-card fails closed while controller state is blocked", () => {
  const fixture = makeFixture({ state: "blocked" });
  const result = run(intakeScript, fixture.root, testCardArgs(fixture.stateRootRef));
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /cannot create a new test card while demand is blocked/);
});
