#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { hostProfile } from "./lib/wakeflow-host-profile.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSync } from "../lib/wakeflow-process.mjs";
import { loadWorkspaceConfig, workspaceLedgerPaths } from "./lib/wakeflow-config.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const wakeflowRoot = path.dirname(path.dirname(scriptPath));
const rawArgs = process.argv.slice(2);
const command = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs[0] : "help";
const options = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs.slice(1) : rawArgs;
const workspaceRoot = path.resolve(getValue("--root", wakeflowRoot));
const workspaceConfig = loadWorkspaceConfig({ workspaceRoot, args: options });
const ledgerPaths = workspaceLedgerPaths({ workspaceRoot, args: options, config: workspaceConfig });
const write = hasFlag("--write");
const json = hasFlag("--json");
const schemaVersion = 1;

const helpText = `
Control intake bridge for Design and Test surfaces

Usage:
  node scripts/wakeflow-intake.mjs test-card --state-root <path> --test-id <id> --target-window <window> --question <text> --object-boundary <text> --controller-self-check <text> --real-scenario-condition <text> --success-means <text> --failure-means <text> --cannot-conclude <text> --stop-condition <text> [--source-ref <ref>] [--strategy-source <ref>] [--evidence-required <text>...] [--allowed-operation <text>...] [--forbidden-operation <text>...] [--write] [--json]

Design:
  This script attaches Design handoff intake and Test boundary cards to an
  existing controller state root as machine-readable evidence. It does not
  create dispatches, accept results, complete demands, mutate controller state,
  or treat Markdown as state authority.
`.trim();

class CliExit extends Error {}

function hasFlag(name) {
  return options.includes(name);
}

function getValue(name, fallback = null) {
  const eq = options.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = options.indexOf(name);
  if (index >= 0 && options[index + 1] && !options[index + 1].startsWith("--")) {
    return options[index + 1];
  }
  return fallback;
}

function valuesFor(name) {
  const values = [];
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === name && options[index + 1] && !options[index + 1].startsWith("--")) {
      values.push(options[index + 1]);
      index += 1;
    } else if (option.startsWith(`${name}=`)) {
      values.push(option.slice(name.length + 1));
    }
  }
  return values;
}

function requireValue(name) {
  const value = getValue(name);
  if (!value) fail(`${name} is required.`);
  return value;
}

function nowIso() {
  return new Date().toISOString();
}

function slug(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

function relative(file) {
  const rel = path.relative(workspaceRoot, file).split(path.sep).join("/");
  return rel || ".";
}

function resolveFromWorkspace(value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspaceRoot, value);
}

function allowedStateRoots() {
  return [
    workspaceRoot,
    ledgerPaths.projectLedgerRoot,
    ledgerPaths.workspaceDocsDir,
  ];
}

function ensureInsideAllowedRoots(file, label) {
  const absolute = path.resolve(file);
  if (allowedStateRoots().some((root) => {
    const rel = path.relative(root, absolute);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  })) {
    return;
  }
  fail(`${label} must stay inside the Wakeflow runtime or configured project ledger: ${absolute}`);
}

function output(payload, textLines = []) {
  const complete = { scriptComplete: true, ...payload };
  if (!complete.agentNext) {
    complete.agentNext = complete.ok
      ? "Continue by total-control judgment; intake evidence is not dispatch or acceptance."
      : "Stop and inspect the reported intake issue.";
  }
  if (json) {
    console.log(JSON.stringify(complete, null, 2));
    return;
  }
  for (const line of textLines) {
    console.log(line);
  }
  console.log(`Agent next: ${complete.agentNext}`);
}

function fail(message) {
  output({ ok: false, command, error: message });
  process.exitCode = 1;
  throw new CliExit(message);
}

function readJson(file, label = "JSON file") {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`Invalid ${label} ${relative(file)}: ${error.message}`);
  }
  return null;
}

function atomicWriteJson(file, value) {
  ensureInsideAllowedRoots(file, "intake output");
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(temp, file);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
}

function resolveStateRoot() {
  const stateRoot = resolveFromWorkspace(requireValue("--state-root"));
  ensureInsideAllowedRoots(stateRoot, "state root");
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  if (!existsSync(stateFile)) {
    fail(`state root is missing wakeflow-state.json: ${relative(stateRoot)}`);
  }
  const state = readJson(stateFile, "controller state");
  if (["completed", "archived"].includes(state.state)) {
    fail(`cannot attach intake while demand is ${state.state}: ${state.demandKey}`);
  }
  // Intake attaches records into the state root: the non-owning host must not
  // write here. Unclaimed demands accept intake without claiming.
  if (state.controllerHost && state.controllerHost !== hostProfile.runtime.hostDirName) {
    fail(`demand ${state.demandKey} is owned by controller host ${state.controllerHost}; this runtime is ${hostProfile.runtime.hostDirName}. Run intake on the owning controller.`);
  }
  return { stateRoot, state };
}

function commandTestCard() {
  const { stateRoot, state } = resolveStateRoot();
  if (["blocked", "paused", "cancelled", "review-ready", "accepting", "waiting-results"].includes(state.state)) {
    fail(`cannot create a new test card while demand is ${state.state}; resolve the current state-machine gate first.`);
  }
  const testId = requireValue("--test-id");
  const targetWindow = requireValue("--target-window");
  const question = requireValue("--question");
  const objectBoundary = requireValue("--object-boundary");
  const controllerSelfChecks = valuesFor("--controller-self-check");
  const realScenarioConditions = valuesFor("--real-scenario-condition");
  const successMeans = valuesFor("--success-means");
  const failureMeans = valuesFor("--failure-means");
  const cannotConclude = valuesFor("--cannot-conclude");
  const stopConditions = valuesFor("--stop-condition");
  for (const [label, values] of [
    ["--controller-self-check", controllerSelfChecks],
    ["--real-scenario-condition", realScenarioConditions],
    ["--success-means", successMeans],
    ["--failure-means", failureMeans],
    ["--cannot-conclude", cannotConclude],
    ["--stop-condition", stopConditions],
  ]) {
    if (values.length === 0) {
      fail(`${label} is required at least once.`);
    }
  }

  const createdAt = nowIso();
  const sourceRef = getValue("--source-ref", null);
  // W-Test: where the test approach came from (the Design-stage testing decision / test-strategy).
  // Optional and advisory: when absent, the card is flagged as an approach not decided at Design,
  // surfaced as a REMINDER (never a gate) so a path-dependent wrong approach is visible.
  const strategySource = (getValue("--strategy-source", "") || "").trim() || null;
  const cardFile = path.join(stateRoot, "test-cards", `${slug(testId)}.json`);
  if (existsSync(cardFile)) {
    fail(`test card already exists: ${relative(cardFile)}`);
  }
  const card = {
    kind: "TestBoundaryCard",
    schemaVersion,
    testId,
    demandKey: state.demandKey,
    targetWindow,
    status: "draft",
    createdAt,
    stateRevisionObserved: state.revision,
    sourceRef,
    ...(strategySource ? { strategySource } : {}),
    boundaryGate: {
      question,
      objectBoundary,
      controllerSelfChecks,
      realScenarioConditions,
      successMeans,
      failureMeans,
      cannotConclude,
      stopConditions,
    },
    evidenceRequired: valuesFor("--evidence-required"),
    allowedOperations: valuesFor("--allowed-operation"),
    forbiddenOperations: valuesFor("--forbidden-operation"),
    suggestedTaskPackage: {
      targetWindow,
      targetTaskId: testId,
      summary: question,
      sourceRef: `test-cards/${slug(testId)}.json`,
    },
    allowedNextActions: [
      "total-control-review-test-boundary",
      "wakeflow-state add-task-package",
      "wakeflow-delivery prepare-dispatch-from-state",
    ],
    forbiddenConclusions: [
      "test-card-is-dispatch",
      "test-card-is-test-result",
      "test-card-is-controller-acceptance",
      "test-card-updates-wakeflow-state",
      "test-result-closes-demand-without-controller-review",
    ],
  };

  if (write) {
    atomicWriteJson(cardFile, card);
  }

  output(
    {
      ok: true,
      command: "test-card",
      wrote: write,
      testId,
      demandKey: state.demandKey,
      targetWindow,
      stateRoot: relative(stateRoot),
      cardFile: relative(cardFile),
      suggestedTaskPackage: card.suggestedTaskPackage,
      // Reminder-first (never a gate): if the approach was not sourced from a Design testing
      // decision, surface a one-line advisory so a path-dependent wrong approach is visible.
      ...(strategySource ? {} : { strategySourceReminder: "No strategySource recorded: this test approach was not sourced from a Design testing decision. Confirm it fits the demand's risk (challenge path-dependent reuse), or link the Design decision with --strategy-source. Reminder only — not a gate." }),
      forbiddenConclusions: card.forbiddenConclusions,
    },
    [
      `${write ? "Created" : "Would create"} Test boundary card ${testId}.`,
      `State root: ${relative(stateRoot)}`,
      "No controller state, dispatch, or acceptance was changed.",
    ],
  );
}

try {
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(helpText);
  } else if (command === "test-card") {
    commandTestCard();
  } else {
    fail(`Unknown wakeflow-intake command: ${command}\n\n${helpText}`);
  }
} catch (error) {
  if (!(error instanceof CliExit)) {
    throw error;
  }
}
