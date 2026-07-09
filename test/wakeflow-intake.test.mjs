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
  const resolvedStateRootArg = stateRootArg === "project-ledger"
    ? `../wakeflow-ledger/current/LEDGER-FIXTURE-${path.basename(root)}`
    : stateRootArg;
  writeText(path.join(root, "wakeflow.config.json"), JSON.stringify({
    workspaceName: "Wakeflow",
    controllerWindow: "AlembicWorkspace",
    designWindow: "DesignWindow",
    testWindow: "TestWindow",
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
  assert.equal(card.suggestedTaskPackage.sourceRef, "test-cards/REAL-SCENARIO-T1.json");
  assert.match(card.forbiddenConclusions.join("\n"), /test-card-is-dispatch/);
});

test("W-Test: test-card records strategySource and reminds (never blocks) when absent", () => {
  // recorded -> persists on the card, no reminder
  const withF = makeFixture();
  const withPayload = parseOk(run(intakeScript, withF.root, [
    ...testCardArgs(withF.stateRootRef, ["--strategy-source", "../wakeflow-ledger/requirement-designs/feat.md#testing"]),
    "--write",
  ]));
  assert.equal(withPayload.strategySourceReminder, undefined, "no reminder when strategySource is recorded");
  const withCard = readJson(path.join(withF.root, withPayload.cardFile));
  assert.equal(withCard.strategySource, "../wakeflow-ledger/requirement-designs/feat.md#testing", "strategySource persists on the card");

  // absent -> reminder surfaces, but test-card still succeeds (reminder-first, not a gate)
  const withoutF = makeFixture();
  const rawResult = run(intakeScript, withoutF.root, [...testCardArgs(withoutF.stateRootRef), "--write"]);
  assert.equal(rawResult.status, 0, "test-card succeeds without strategySource (reminder, not a gate)");
  const withoutPayload = parseOk(rawResult);
  assert.match(withoutPayload.strategySourceReminder, /strateg/i, "a reminder surfaces when strategySource is absent");
  const withoutCard = readJson(path.join(withoutF.root, withoutPayload.cardFile));
  assert.equal("strategySource" in withoutCard, false, "absent strategySource leaves no field (zero trace)");
});

test("test-card supports controller state roots in the configured project ledger", () => {
  const fixture = makeFixture({ stateRootArg: "project-ledger" });
  const payload = parseOk(run(intakeScript, fixture.root, [
    ...testCardArgs(fixture.stateRootRef),
    "--write",
  ]));

  assert.equal(payload.ok, true);
  assert.match(payload.stateRoot, /^\.\.\/wakeflow-ledger\/current\/LEDGER-FIXTURE-wakeflow-intake-/);
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
