#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const intakeScript = path.join(workspaceRoot, "scripts/control-intake.mjs");
const controllerScript = path.join(workspaceRoot, "scripts/controller-state.mjs");

function writeText(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${content.trimEnd()}\n`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function run(script, root, args) {
  return spawnSync("node", [script, ...args, "--root", root, "--json"], {
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

## 目标

Fixture only.
`;
}

function makeFixture({ demandKey = "ENUM-FLOW-2026-05-30", state = "intake", stateRootArg = null } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "control-intake-"));
  const resolvedStateRootArg = stateRootArg === "project-ledger"
    ? `../workspace-ledger/current/LEDGER-FIXTURE-${path.basename(root)}`
    : stateRootArg;
  writeText(path.join(root, "workspace.config.json"), JSON.stringify({
    workspaceName: "ControlWorkspace",
    controlWindow: "AlembicWorkspace",
    designWindow: "DesignWindow",
    testWindow: "TestWindow",
    designHandoffBoard: "DesignWindow/docs/current/workspace-handoff-board.md",
    repositories: [
      { windowName: "AlembicWorkspace", path: ".", role: "controller" },
      { windowName: "DesignWindow", path: "DesignWindow", role: "design", managedAgents: false },
      { windowName: "TestWindow", path: "TestWindow", role: "test", managedAgents: false },
    ],
  }, null, 2));

  const designKey = "ENUM-FLOW-2026-05-30";
  const designDir = path.join(root, "DesignWindow/docs/current/enum-flow");
  writeText(path.join(designDir, "original-plan-2026-05-30.md"), designDoc(designKey, "Original Plan"));
  writeText(path.join(designDir, "requirement-design-2026-05-30.md"), designDoc(designKey, "Requirement Design"));
  writeText(path.join(designDir, "workspace-handoff-2026-05-30.md"), designDoc(designKey, "Workspace Handoff"));
  writeText(
    path.join(root, "DesignWindow/docs/current/workspace-handoff-board.md"),
    `# Workspace Handoff Board

## Handoff 清单

| ID | 状态 | 标题 | 原始计划 | 需求设计 | Handoff | 用户确认状态 | 用户确认 | 主线关系状态 | 当前主线关系 | 建议 TODO | 优先级枚举 | 优先级 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ${designKey} | ready-for-workspace | Enum fixture | [original](enum-flow/original-plan-2026-05-30.md) | [design](enum-flow/requirement-design-2026-05-30.md) | [handoff](enum-flow/workspace-handoff-2026-05-30.md) | confirmed | 用户已确认 | todo-candidate | 不影响主线 | TODO | P1 | P1 | 总控接收 |
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
    const stateFile = path.join(stateRoot, "controller-state.json");
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

test("design-handoff attaches ready Design source without mutating controller state", () => {
  const fixture = makeFixture();
  const before = readFileSync(path.join(fixture.stateRoot, "controller-state.json"), "utf8");
  const payload = parseOk(run(intakeScript, fixture.root, [
    "design-handoff",
    "--state-root",
    fixture.stateRootRef,
    "--design-key",
    fixture.designKey,
    "--write",
  ]));

  assert.equal(payload.ok, true);
  assert.equal(payload.command, "design-handoff");
  assert.equal(payload.wrote, true);
  assert.equal(payload.demandKeyMatchesDesignKey, true);
  assert.match(payload.intakeFile, /intake\/design-handoff-ENUM-FLOW-2026-05-30\.json/);
  assert.deepEqual(JSON.parse(readFileSync(path.join(fixture.stateRoot, "controller-state.json"), "utf8")), JSON.parse(before));

  const intake = readJson(path.join(fixture.root, payload.intakeFile));
  assert.equal(intake.kind, "DesignHandoffIntake");
  assert.equal(intake.designKey, fixture.designKey);
  assert.equal(intake.sourceStatus, "ready-for-workspace");
  assert.equal(intake.userConfirmationStatus.status, "confirmed");
  assert.equal(intake.linkedDocs.requirementDesign.exists, true);
  assert.match(intake.forbiddenConclusions.join("\n"), /design-intake-is-dispatch/);
});

test("design-handoff warns when Design source key differs from demand key", () => {
  const fixture = makeFixture({ demandKey: "CONTROL-DEMAND-2026-05-30" });
  const payload = parseOk(run(intakeScript, fixture.root, [
    "design-handoff",
    "--state-root",
    fixture.stateRootRef,
    "--design-key",
    fixture.designKey,
  ]));

  assert.equal(payload.wrote, false);
  assert.equal(payload.demandKeyMatchesDesignKey, false);
  assert.match(payload.warnings[0], /differs from Design Key/);
  assert.equal(existsSync(path.join(fixture.root, payload.intakeFile)), false);
});

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
  const before = readFileSync(path.join(fixture.stateRoot, "controller-state.json"), "utf8");
  const payload = parseOk(run(intakeScript, fixture.root, [
    ...testCardArgs(fixture.stateRootRef),
    "--write",
  ]));

  assert.equal(payload.ok, true);
  assert.equal(payload.command, "test-card");
  assert.equal(payload.targetWindow, "TestWindow");
  assert.match(payload.cardFile, /test-cards\/REAL-SCENARIO-T1\.json/);
  assert.equal(readFileSync(path.join(fixture.stateRoot, "controller-state.json"), "utf8"), before);

  const card = readJson(path.join(fixture.root, payload.cardFile));
  assert.equal(card.kind, "TestBoundaryCard");
  assert.equal(card.status, "draft");
  assert.equal(card.boundaryGate.question, "Does the real scenario produce the expected runtime signal?");
  assert.equal(card.boundaryGate.cannotConclude[0], "This does not prove unrelated UI behavior.");
  assert.equal(card.suggestedTaskPackage.sourceRef, "test-cards/REAL-SCENARIO-T1.json");
  assert.match(card.forbiddenConclusions.join("\n"), /test-card-is-dispatch/);
});

test("test-card supports controller state roots in the configured project ledger", () => {
  const fixture = makeFixture({ stateRootArg: "project-ledger" });
  const payload = parseOk(run(intakeScript, fixture.root, [
    ...testCardArgs(fixture.stateRootRef),
    "--write",
  ]));

  assert.equal(payload.ok, true);
  assert.match(payload.stateRoot, /^\.\.\/workspace-ledger\/current\/LEDGER-FIXTURE-control-intake-/);
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
