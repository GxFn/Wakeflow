#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSync } from "../lib/wakeflow-process.mjs";
import { trackedWorkspaceConfigPath } from "./lib/wakeflow-config.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptPath);
const wakeflowRoot = path.dirname(scriptsDir);
const rawArgs = process.argv.slice(2);
const command = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs[0] : "help";
const options = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs.slice(1) : rawArgs;
const workspaceRoot = path.resolve(getValue("--root", wakeflowRoot));
const write = hasFlag("--write");
const json = hasFlag("--json");
let cachedWorkspaceConfig = undefined;

const helpText = `
Controller demand claim/create runner

Usage:
  node scripts/wakeflow-demand-sequence.mjs create-demand --todo-id <id> | --demand-key <key> --title <title> [--controller-window <window>] [--root <workspace>] [--write] [--json]
  node scripts/wakeflow-demand-sequence.mjs claim-todo [--design-key <id>] [--controller-window <window>] [--root <workspace>] [--write] [--json]

Design:
  Claims or creates at most one demand from the global TODO board: create-demand
  inits the state root (adopting this host), adds any initial task packages,
  renders the progress doc, and consumes the originating TODO row; claim-todo
  auto-claims the single controller-claimable row (Auto Claim = yes and
  eligible) or an explicitly named eligible row by delegating to create-demand.
  Claiming past maxActiveDemands fails closed at the state init gate. It does
  not dispatch windows, send thread messages, accept evidence, or complete
  demands.
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

function output(payload, textLines = []) {
  const complete = { scriptComplete: true, ...payload };
  if (!complete.agentNext) {
    complete.agentNext = complete.ok
      ? "Use total-control judgment to dispatch from the claimed state root; claim the next TODO row after this demand completes and archives."
      : "Stop and inspect the reported demand sequence issue.";
  }
  if (json) {
    console.log(JSON.stringify(complete, null, 2));
    return;
  }
  for (const line of textLines) console.log(line);
  console.log(`Agent next: ${complete.agentNext}`);
}

function fail(message) {
  output({ ok: false, command, error: message });
  process.exitCode = 1;
  throw new CliExit(message);
}

function requireValue(name) {
  const value = getValue(name);
  if (!value) fail(`${name} is required.`);
  return value;
}

function resolveFromWorkspace(value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspaceRoot, value);
}

function relative(file) {
  const rel = path.relative(workspaceRoot, file).split(path.sep).join("/");
  return rel || ".";
}
function slug(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "demand";
}

function readJson(file, label = "JSON file") {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`Invalid ${label} ${relative(file)}: ${error.message}`);
  }
  return null;
}
function readWorkspaceConfig() {
  if (cachedWorkspaceConfig !== undefined) return cachedWorkspaceConfig;
  const configPath = trackedWorkspaceConfigPath(workspaceRoot);
  cachedWorkspaceConfig = existsSync(configPath) ? readJson(configPath, "workspace config") : null;
  return cachedWorkspaceConfig;
}
function runControllerState(argsForScript) {
  const result = runSync(process.execPath, [path.join(scriptsDir, "wakeflow-state.mjs"), ...argsForScript], {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail([
      `wakeflow-state failed: node scripts/wakeflow-state.mjs ${argsForScript.join(" ")}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join("\n"));
  }
  return result.stdout ? JSON.parse(result.stdout) : null;
}

function runRenderProgressDoc(stateRoot) {
  const result = runSync(process.execPath, [
    path.join(scriptsDir, "wakeflow-render-progress.mjs"),
    "--root",
    workspaceRoot,
    "--state-root",
    stateRoot,
    "--write",
    "--json",
  ], {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail([
      `wakeflow-render-progress failed for ${stateRoot}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join("\n"));
  }
  return result.stdout ? JSON.parse(result.stdout) : null;
}
function runTodoConsume(designKey, mount) {
  return runSync(process.execPath, [
    path.join(scriptsDir, "wakeflow-todo.mjs"),
    "consume", "--root", workspaceRoot, "--design-key", designKey, "--mount", mount, "--apply", "--json",
  ], { cwd: workspaceRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function runNextWorkTodo(todoId = null) {
  const result = runSync(process.execPath, [
    path.join(scriptsDir, "wakeflow-next-work.mjs"),
    "--root", workspaceRoot, "--source", "todo",
    ...(todoId ? ["--id", todoId] : []),
    "--json",
  ], { cwd: workspaceRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { candidates: [], recommended: null };
  }
}

function runCreateDemandTodo(todoId, { controllerWindow = "" } = {}) {
  return runSync(process.execPath, [
    path.join(scriptsDir, "wakeflow-demand-sequence.mjs"),
    "create-demand", "--root", workspaceRoot, "--todo-id", todoId,
    ...(controllerWindow ? ["--controller-window", controllerWindow] : []),
    "--write", "--json",
  ], { cwd: workspaceRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// Unified create: replaces init_demand + intake_design_handoff + add_task + adopt_demand_host.
// From a delivered TODO row (--todo-id) it reads the title + Documents and synthesizes the
// goal/completion from them (or takes them explicitly); it inits the state root, adopts host,
// adds any initial task packages, renders progress, and consumes the TODO row (writing the
// state root into its Current Mount). The demand execution state machine is unchanged.
function commandCreateDemand() {
  const todoId = getValue("--todo-id");
  let demandKey = getValue("--demand-key", todoId);
  let title = getValue("--title");
  let goal = getValue("--goal");
  let completionDefinition = getValue("--completion-definition");
  let testDecision = getValue("--test-decision");
  let stagePlan = getValue("--stage-plan");

  const taskPackagesRaw = getValue("--task-packages");
  let taskPackages = [];
  if (taskPackagesRaw) {
    try {
      taskPackages = JSON.parse(taskPackagesRaw);
    } catch {
      fail("--task-packages must be a valid JSON array of {taskPackageId, summary, targetWindow, targetTaskId}.");
    }
  }

  let sourceDocumentRefs = [];
  if (todoId) {
    const scan = runNextWorkTodo(todoId);
    const candidate = (scan.candidates ?? []).find((entry) => entry.id === todoId)
      ?? (scan.recommended && scan.recommended.id === todoId ? scan.recommended : null);
    if (!candidate) {
      fail(`TODO row ${todoId} is not an eligible candidate (missing, blocked, or not controller-recommended); inspect it with wakeflow_next_work source=todo first.`);
    }
    title = title ?? candidate.title;
    const documents = candidate.documents ?? "";
    // next-work resolves board-relative Markdown targets back to workspace refs.
    // Keep the fallback for older next-work payloads and hand-authored rows.
    sourceDocumentRefs = Array.isArray(candidate.documentRefs) ? candidate.documentRefs : [];
    if (sourceDocumentRefs.length === 0) {
      sourceDocumentRefs = [...documents.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
    }
    if (sourceDocumentRefs.length === 0 && documents.trim()) sourceDocumentRefs = [documents.trim()];
    if (!testDecision && candidate.testDecision?.trim()) testDecision = candidate.testDecision.trim();
    const documentSummary = sourceDocumentRefs.map((ref) => `\`${ref}\``).join(", ");
    if (!goal) {
      goal = documentSummary
        ? `Deliver the requirement described by the delivered docs: ${documentSummary}`
        : `Deliver TODO ${todoId}: ${title}`;
    }
    if (!completionDefinition) {
      completionDefinition = "Total control confirms the completion definition from the delivered docs before dispatch.";
    }
    if (!stagePlan && documentSummary) {
      stagePlan = `Derive the stage plan from the delivered docs: ${documentSummary}`;
    }
  }

  if (!demandKey) fail("--demand-key or --todo-id is required.");
  if (!title) fail("--title is required (or pass --todo-id pointing at a titled delivered row).");

  const stateRootAbs = resolveFromWorkspace(`.wakeflow-active/current/${slug(demandKey)}`);
  const stateRoot = relative(stateRootAbs);
  if (existsSync(path.join(stateRootAbs, "wakeflow-state.json"))) {
    fail(`a demand state root already exists at ${stateRoot}; refuse to re-create ${demandKey}.`);
  }

  if (!write) {
    output({
      ok: true,
      command: "create-demand",
      wrote: false,
      wouldCreate: { demandKey, title, stateRoot, todoId: todoId ?? null, taskPackageCount: taskPackages.length },
    }, [`Would create demand ${demandKey} at ${stateRoot}`]);
    return;
  }

  const initArgs = ["init", "--root", workspaceRoot, "--state-root", stateRoot, "--demand-key", demandKey, "--title", title];
  if (todoId) initArgs.push("--design-key", todoId);
  for (const doc of sourceDocumentRefs) initArgs.push("--source-doc", doc);
  if (goal) initArgs.push("--goal", goal);
  if (completionDefinition) initArgs.push("--completion-definition", completionDefinition);
  if (testDecision) initArgs.push("--test-decision", testDecision);
  if (stagePlan) initArgs.push("--stage-plan", stagePlan);
  const demandControllerWindow = getValue("--controller-window", "");
  if (demandControllerWindow) initArgs.push("--controller-window", demandControllerWindow);
  initArgs.push("--write", "--json");
  const initOut = runControllerState(initArgs);

  runControllerState(["adopt-demand-host", "--root", workspaceRoot, "--state-root", stateRoot, "--reason", "create-demand", "--write", "--json"]);

  const addedPackages = [];
  for (const pkg of taskPackages) {
    const packageId = pkg.taskPackageId ?? pkg.targetTaskId;
    if (!packageId) fail("each --task-packages entry needs taskPackageId or targetTaskId.");
    const tpArgs = ["add-task-package", "--root", workspaceRoot, "--state-root", stateRoot, "--task-package-id", packageId, "--summary", pkg.summary ?? title];
    if (pkg.targetWindow) tpArgs.push("--target-window", pkg.targetWindow);
    if (pkg.targetTaskId) tpArgs.push("--target-task-id", pkg.targetTaskId);
    if (pkg.sourceRef) tpArgs.push("--source-ref", pkg.sourceRef);
    if (pkg.designIntent) tpArgs.push("--design-intent", pkg.designIntent);
    if (pkg.evidenceContract) tpArgs.push("--evidence-contract", JSON.stringify(pkg.evidenceContract));
    if (pkg.executionMode) tpArgs.push("--execution-mode", pkg.executionMode);
    if (pkg.commitExpectation) tpArgs.push("--commit-expectation", pkg.commitExpectation);
    tpArgs.push("--write", "--json");
    runControllerState(tpArgs);
    addedPackages.push(packageId);
  }

  const renderOut = runRenderProgressDoc(stateRoot);

  let consumedTodoId = null;
  if (todoId) {
    const consumeResult = runTodoConsume(todoId, stateRoot);
    if (consumeResult.status !== 0) {
      fail(`demand ${demandKey} created, but consuming TODO row ${todoId} failed: ${(consumeResult.stdout || consumeResult.stderr || "").trim()}`);
    }
    consumedTodoId = todoId;
  }

  output({
    ok: true,
    command: "create-demand",
    wrote: true,
    created: { demandKey, title, stateRoot, taskPackages: addedPackages, consumedTodoId },
    controllerOutputs: [initOut, renderOut].filter(Boolean),
    // Reminder-first (never a gate): if no testing decision was recorded, surface a
    // one-line advisory so the Design-stage test approach is not silently forgotten.
    // Whether real Test is needed is the controller's / Design's judgment, not a gate.
    ...(testDecision ? {} : { testDecisionReminder: "No testing decision recorded for this demand. Confirm the test approach was decided at Design (requirement-design testing decision), or record it with --test-decision. Reminder only — not a gate." }),
    // Reminder-first: dispatchable initial packages without an evidence contract
    // leave the craft gate dormant (same forgotten-decision failure mode as the
    // testing decision). Doc-only demands legitimately skip contracts — judgment
    // stays with Design / the controller.
    ...(taskPackages.length > 0 && taskPackages.every((pkg) => !pkg.evidenceContract)
      ? { evidenceContractReminder: "None of the initial task packages carries an evidence contract: the craft gate stays dormant for this demand. If this is implementation work, author one per package (required kinds like tests/change-scope; see wakeflow-target-craft). Reminder only — not a gate." }
      : {}),
    forbiddenConclusions: ["create-demand-is-dispatch", "create-demand-is-acceptance"],
    agentNext: `Demand created and any delivered TODO row consumed. Dispatch is a separate step; no dispatch, delivery, or acceptance was performed.${testDecision ? "" : " Reminder: no testing decision recorded — confirm the Design-stage test approach or record it."}`,
  }, [`Created demand ${demandKey} at ${stateRoot}`]);
}

// Unified controller auto-claim: the global-TODO-board successor to claim-from-design.
// Unattended (no key), it claims the single controller-claimable row (Auto Claim = yes and
// eligible). With an explicit --design-key/--todo-id, a user-confirmed eligible row may be
// claimed even when not auto-claimable. It delegates to create-demand, so it inits a state
// root and consumes the row only — no dispatch, evidence acceptance, or per-demand
// confirmation bypass.
function commandClaimTodo() {
  const explicitId = getValue("--todo-id") ?? getValue("--design-key");
  const candidates = runNextWorkTodo().candidates ?? [];

  let target;
  if (explicitId) {
    target = candidates.find((entry) => entry.id === explicitId);
    if (!target) {
      fail(`TODO row ${explicitId} is not an eligible candidate (missing, blocked, or not controller-recommended); inspect it with wakeflow_next_work source=todo first.`);
    }
  } else {
    const claimable = candidates.filter((entry) => entry.controllerClaimable);
    if (claimable.length === 0) {
      output({
        ok: true,
        command: "claim-todo",
        wrote: false,
        claimed: null,
        agentNext: "No controller-claimable TODO row (Auto Claim = yes and eligible). Deliver one with Auto Claim, or claim a specific eligible row explicitly with --design-key.",
      }, ["No controller-claimable TODO row to auto-claim."]);
      return;
    }
    if (claimable.length > 1) {
      fail(`multiple controller-claimable TODO rows (${claimable.map((entry) => entry.id).join(", ")}); claim one explicitly with --design-key.`);
    }
    target = claimable[0];
  }

  if (!write) {
    output({
      ok: true,
      command: "claim-todo",
      wrote: false,
      wouldClaim: { id: target.id, title: target.title, autoClaim: target.controllerClaimable },
    }, [`Would claim TODO ${target.id}`]);
    return;
  }

  // Pods claim with their own controller window so returns route to the pod,
  // not the default controller.
  const created = runCreateDemandTodo(target.id, { controllerWindow: getValue("--controller-window", "") });
  if (created.status !== 0) {
    fail(`failed to create the demand from TODO row ${target.id}: ${(created.stdout || created.stderr || "").trim()}`);
  }
  const createdPayload = created.stdout ? JSON.parse(created.stdout) : null;
  const stateRoot = createdPayload?.created?.stateRoot ?? null;
  output({
    ok: true,
    command: "claim-todo",
    wrote: true,
    claimed: { id: target.id, title: target.title, stateRoot },
    claimMode: explicitId ? "explicit-eligible-todo" : "auto-claimable-todo",
    controllerOutputs: [createdPayload].filter(Boolean),
    forbiddenConclusions: [
      "claim-todo-is-dispatch",
      "claim-todo-is-acceptance",
      "controller-claim-bypasses-per-demand-confirmation",
    ],
    agentNext: "Demand created from the TODO row; confirm dispatch as a separate step. No dispatch, delivery, or acceptance was performed.",
  }, [
    `Claimed TODO ${target.id}`,
    `State root: ${stateRoot ?? "(see create-demand output)"}`,
    "Init-only: no dispatch, delivery, automation loop, or evidence acceptance was performed.",
  ]);
}

function main() {
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(helpText);
    return;
  }
  if (command === "create-demand") {
    commandCreateDemand();
    return;
  }
  if (command === "claim-todo") {
    commandClaimTodo();
    return;
  }
  fail(`Unknown wakeflow-demand-sequence command: ${command}\n\n${helpText}`);
}

try {
  main();
} catch (error) {
  if (!(error instanceof CliExit)) {
    throw error;
  }
}
