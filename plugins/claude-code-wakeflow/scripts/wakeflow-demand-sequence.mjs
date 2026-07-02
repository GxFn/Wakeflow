#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSync } from "../lib/wakeflow-process.mjs";
import {
  activeDemandCapacity,
  activeDemandConflictSummary,
  scanUnarchivedDemandStateRoots,
} from "./lib/wakeflow-active-demands.mjs";
import { trackedWorkspaceConfigPath } from "./lib/wakeflow-config.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptPath);
const wakeflowRoot = path.dirname(scriptsDir);
const rawArgs = process.argv.slice(2);
const command = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs[0] : "status";
const options = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs.slice(1) : rawArgs;
const workspaceRoot = path.resolve(getValue("--root", wakeflowRoot));
const write = hasFlag("--write");
const json = hasFlag("--json");
let cachedWorkspaceConfig = undefined;

const helpText = `
Controller demand sequence runner

Usage:
  node scripts/wakeflow-demand-sequence.mjs status --manifest <manifest.json> [--root <workspace>] [--json]
  node scripts/wakeflow-demand-sequence.mjs claim-next --manifest <manifest.json> [--root <workspace>] [--write] [--json]
  node scripts/wakeflow-demand-sequence.mjs sync-doc --manifest <manifest.json> --demand-key <key> [--root <workspace>] [--write] [--json]

Design:
  A sequence manifest is tracked, machine-readable demand order. This script
  claims at most one next demand by creating its controller state root and
  initial task package definitions. Each item must point at one standard
  developer-readable demand document with a single Unified Status marker block.
  The script may sync that marker block from machine state; it does not dispatch
  windows, send thread messages, accept evidence, or complete demands.
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
      ? "Use total-control judgment to dispatch from the claimed state root, or rerun claim-next after the active demand is completed."
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

function unarchivedDemandConflicts(excludeDemandKeys = []) {
  return scanUnarchivedDemandStateRoots({ workspaceRoot, excludeDemandKeys });
}

function failOnUnarchivedDemandConflicts(excludeDemandKeys = []) {
  // Multi-active demands: claiming is refused only AT capacity, not on the
  // mere existence of another active demand.
  const capacity = activeDemandCapacity({ workspaceRoot, config: readWorkspaceConfig(), excludeDemandKeys });
  if (!capacity.atCapacity) return capacity.active;
  fail(
    `cannot claim a new demand: workspace is at its active-demand capacity (${capacity.active.length}/${capacity.max}): ${activeDemandConflictSummary(capacity.active)}. Complete and archive one, or raise maxActiveDemands in wakeflow.config.json.`,
  );
  return capacity.active;
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

function atomicWrite(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temp, content);
    renameSync(temp, file);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
}

function readManifest() {
  const manifestPath = resolveFromWorkspace(requireValue("--manifest"));
  if (!existsSync(manifestPath)) {
    fail(`manifest does not exist: ${relative(manifestPath)}`);
  }
  const manifest = readJson(manifestPath, "demand sequence manifest");
  if (manifest.kind !== "ControllerDemandSequenceManifest") {
    fail("manifest.kind must be ControllerDemandSequenceManifest.");
  }
  if (manifest.schemaVersion !== 1) {
    fail("manifest.schemaVersion must be 1.");
  }
  if (!Array.isArray(manifest.items) || manifest.items.length === 0) {
    fail("manifest.items must contain at least one demand.");
  }
  const seenOrders = new Set();
  const seenDemandKeys = new Set();
  for (const item of manifest.items) {
    if (!Number.isInteger(item.order) || item.order < 1) {
      fail(`manifest item has invalid order: ${item.demandKey ?? "unknown"}`);
    }
    if (seenOrders.has(item.order)) {
      fail(`manifest has duplicate order: ${item.order}`);
    }
    seenOrders.add(item.order);
    if (!item.demandKey || !item.title) {
      fail(`manifest item ${item.order} requires demandKey and title.`);
    }
    if (seenDemandKeys.has(item.demandKey)) {
      fail(`manifest has duplicate demandKey: ${item.demandKey}`);
    }
    seenDemandKeys.add(item.demandKey);
    for (const field of ["goal", "completionDefinition", "stagePlan"]) {
      if (!item[field]) {
        fail(`manifest item ${item.demandKey} requires ${field}.`);
      }
    }
    const sourceRefs = sourceRefsFor(item);
    for (const sourceRef of sourceRefs) {
      const sourcePath = resolveFromWorkspace(sourceRef);
      if (!existsSync(sourcePath)) {
        fail(`manifest item ${item.demandKey} references missing source: ${sourceRef}`);
      }
    }
    validateDeveloperDoc(item);
  }
  return {
    manifestPath,
    manifest: {
      ...manifest,
      items: [...manifest.items].sort((left, right) => left.order - right.order),
    },
  };
}

function readWorkspaceConfig() {
  if (cachedWorkspaceConfig !== undefined) return cachedWorkspaceConfig;
  const configPath = trackedWorkspaceConfigPath(workspaceRoot);
  cachedWorkspaceConfig = existsSync(configPath) ? readJson(configPath, "workspace config") : null;
  return cachedWorkspaceConfig;
}

function controllerWindowFor(item) {
  const config = readWorkspaceConfig();
  const controllerWindow = item.controllerWindow ?? config?.controllerWindow ?? config?.workspaceName;
  if (!controllerWindow) {
    fail(`manifest item ${item.demandKey} requires controllerWindow or wakeflow.config.json controllerWindow.`);
  }
  return controllerWindow;
}

function sourceRefsFor(item) {
  return [developerDocRef(item), item.landingDoc, item.sourceRef, ...(item.sourceRefs ?? [])].filter(Boolean);
}

function developerDocRef(item) {
  return item.developerDoc ?? item.progressDoc ?? item.landingDoc ?? null;
}

function developerDocPath(item) {
  const ref = developerDocRef(item);
  return ref ? resolveFromWorkspace(ref) : null;
}

function validateDeveloperDoc(item) {
  const docPath = developerDocPath(item);
  if (!docPath) {
    fail(`manifest item ${item.demandKey} requires developerDoc.`);
  }
  const content = readFileSync(docPath, "utf8");
  const markers = content.match(/<!-- unified-status:start -->[\s\S]*?<!-- unified-status:end -->/g) ?? [];
  if (markers.length !== 1) {
    fail(`developerDoc for ${item.demandKey} must contain exactly one unified-status marker block; found ${markers.length}.`);
  }
  for (const heading of [
    "## Goal",
    "## Completion Definition",
    "## Stage Plan",
    "## Task Packages",
    "## Backfill Summaries",
    "## Decisions And Append Log",
  ]) {
    if (!content.includes(heading)) {
      fail(`developerDoc for ${item.demandKey} is missing standard section: ${heading}`);
    }
  }
}

function stateRootFor(item) {
  return resolveFromWorkspace(item.stateRoot ?? `.wakeflow-active/current/${slug(item.demandKey)}`);
}

function stateFor(item) {
  const stateRoot = stateRootFor(item);
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  if (!existsSync(stateFile)) {
    return {
      demandKey: item.demandKey,
      order: item.order,
      title: item.title,
      stateRoot: relative(stateRoot),
      status: "not-created",
      terminal: false,
      active: false,
    };
  }
  const state = readJson(stateFile, "controller state");
  const terminal = state.state === "completed" || state.state === "archived";
  return {
    demandKey: item.demandKey,
    order: item.order,
    title: item.title,
    stateRoot: relative(stateRoot),
    status: state.state,
    terminal,
    active: !terminal,
    revision: state.revision,
    reviewStatus: state.review?.status ?? "none",
    taskPackages: (state.taskPackages ?? []).map((pkg) => ({
      taskPackageId: pkg.taskPackageId,
      status: pkg.status,
    })),
    targetTasks: (state.targetTasks ?? []).map((task) => ({
      targetTaskId: task.targetTaskId,
      targetWindow: task.targetWindow,
      status: task.status,
    })),
  };
}

function sequenceSummary(manifest) {
  const items = manifest.items.map(stateFor);
  const active = items.find((item) => item.active);
  const nextClaimable = active ? null : items.find((item) => item.status === "not-created") ?? null;
  const completedCount = items.filter((item) => item.terminal).length;
  return {
    items,
    active,
    nextClaimable,
    completedCount,
    totalCount: items.length,
    sequenceComplete: completedCount === items.length,
  };
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

function statusBlockFromStateRoot(stateRoot) {
  const state = readJson(path.join(resolveFromWorkspace(stateRoot), "wakeflow-state.json"), "controller state");
  const progressDoc = state.projection?.progressDoc ?? "developer-progress.md";
  const progressPath = path.join(resolveFromWorkspace(stateRoot), progressDoc);
  if (!existsSync(progressPath)) {
    fail(`state-root progress doc does not exist: ${relative(progressPath)}`);
  }
  const progress = readFileSync(progressPath, "utf8");
  const matches = progress.match(/<!-- unified-status:start -->[\s\S]*?<!-- unified-status:end -->/g) ?? [];
  if (matches.length !== 1) {
    fail(`state-root progress doc must contain exactly one unified-status marker block; found ${matches.length}.`);
  }
  return matches[0];
}

function syncDeveloperDoc(item, stateRoot) {
  const docPath = developerDocPath(item);
  if (!docPath) {
    fail(`manifest item ${item.demandKey} requires developerDoc.`);
  }
  const statusBlock = statusBlockFromStateRoot(stateRoot);
  const previous = readFileSync(docPath, "utf8");
  const matches = previous.match(/<!-- unified-status:start -->[\s\S]*?<!-- unified-status:end -->/g) ?? [];
  if (matches.length !== 1) {
    fail(`developerDoc for ${item.demandKey} must contain exactly one unified-status marker block; found ${matches.length}.`);
  }
  const next = previous.replace(/<!-- unified-status:start -->[\s\S]*?<!-- unified-status:end -->/, statusBlock);
  if (write) {
    atomicWrite(docPath, next.endsWith("\n") ? next : `${next}\n`);
  }
  return {
    developerDoc: relative(docPath),
    changed: next !== previous,
  };
}

function initialTaskPackagesFor(item) {
  return Array.isArray(item.initialTaskPackages) ? item.initialTaskPackages : [];
}

function dispatchCandidatesFor(item, stateRoot) {
  return initialTaskPackagesFor(item)
    .filter((pkg) => pkg.targetWindow && pkg.targetTaskId)
    .map((pkg) => {
      const dispatchGroup = pkg.dispatchGroup ?? `${slug(item.demandKey)}-GROUP`;
      return {
        demandKey: item.demandKey,
        stateRoot,
        taskPackageId: pkg.taskPackageId,
        targetWindow: pkg.targetWindow,
        targetTaskId: pkg.targetTaskId,
        dispatchGroup,
        prepareCommand: [
          "node",
          "scripts/wakeflow-cli.mjs",
          "loop",
          "prepare-dispatch-from-state",
          "--root",
          workspaceRoot,
          "--state-root",
          stateRoot,
          "--task-package-id",
          pkg.taskPackageId,
          "--target-task-id",
          pkg.targetTaskId,
          "--group",
          dispatchGroup,
          "--controller-window",
          controllerWindowFor(item),
          "--return-policy",
          pkg.returnPolicy ?? item.returnPolicy ?? "group-ready",
          "--write",
          "--json",
        ].join(" "),
      };
    });
}

function claimItem(item) {
  const stateRoot = relative(stateRootFor(item));
  const initArgs = [
    "init",
    "--root",
    workspaceRoot,
    "--state-root",
    stateRoot,
    "--demand-key",
    item.demandKey,
    "--title",
    item.title,
    "--goal",
    item.goal,
    "--completion-definition",
    item.completionDefinition,
    "--stage-plan",
    item.stagePlan,
    "--write",
    "--json",
  ];
  const outputs = [];
  outputs.push(runControllerState(initArgs));

  for (const pkg of initialTaskPackagesFor(item)) {
    if (!pkg.taskPackageId || !pkg.summary) {
      fail(`initial task package for ${item.demandKey} requires taskPackageId and summary.`);
    }
    const addArgs = [
      "add-task-package",
      "--root",
      workspaceRoot,
      "--state-root",
      stateRoot,
      "--task-package-id",
      pkg.taskPackageId,
      "--summary",
      pkg.summary,
    ];
    const sourceRef = pkg.sourceRef ?? developerDocRef(item) ?? item.sourceRef;
    if (sourceRef) addArgs.push("--source-ref", sourceRef);
    if (pkg.targetWindow) addArgs.push("--target-window", pkg.targetWindow);
    if (pkg.targetTaskId) addArgs.push("--target-task-id", pkg.targetTaskId);
    if (pkg.targetSummary) addArgs.push("--target-summary", pkg.targetSummary);
    if (pkg.designIntent) addArgs.push("--design-intent", pkg.designIntent);
    addArgs.push("--write", "--json");
    outputs.push(runControllerState(addArgs));
  }

  outputs.push(runRenderProgressDoc(stateRoot));
  const developerDocSync = syncDeveloperDoc(item, stateRoot);
  return {
    stateRoot,
    outputs,
    developerDocSync,
    dispatchCandidates: dispatchCandidatesFor(item, stateRoot),
  };
}

function commandStatus() {
  const { manifestPath, manifest } = readManifest();
  const summary = sequenceSummary(manifest);
  output(
    {
      ok: true,
      command: "status",
      manifest: relative(manifestPath),
      sequenceId: manifest.sequenceId,
      title: manifest.title,
      completedCount: summary.completedCount,
      totalCount: summary.totalCount,
      sequenceComplete: summary.sequenceComplete,
      active: summary.active,
      nextClaimable: summary.nextClaimable,
      items: summary.items,
    },
    [
      `Demand sequence: ${manifest.sequenceId}`,
      `Completed: ${summary.completedCount}/${summary.totalCount}`,
      summary.active
        ? `Active demand: ${summary.active.demandKey} (${summary.active.status})`
        : (summary.nextClaimable ? `Next claimable: ${summary.nextClaimable.demandKey}` : "No next demand."),
    ],
  );
}

function commandClaimNext() {
  const { manifestPath, manifest } = readManifest();
  const summary = sequenceSummary(manifest);
  if (summary.sequenceComplete) {
    output({
      ok: true,
      command: "claim-next",
      wrote: false,
      manifest: relative(manifestPath),
      sequenceId: manifest.sequenceId,
      sequenceComplete: true,
      claimed: null,
      agentNext: "Stop: all demands in this sequence are already completed.",
    }, ["All demands in this sequence are completed."]);
    return;
  }
  if (summary.active) {
    output({
      ok: true,
      command: "claim-next",
      wrote: false,
      manifest: relative(manifestPath),
      sequenceId: manifest.sequenceId,
      sequenceComplete: false,
      active: summary.active,
      claimed: null,
      agentNext: "Continue or review the active state root before claiming the next demand.",
    }, [`Active demand already exists: ${summary.active.demandKey} (${summary.active.status}).`]);
    return;
  }

  const nextItem = manifest.items.find((item) => stateFor(item).status === "not-created");
  if (!nextItem) {
    fail("sequence has no active demand and no uncreated demand; inspect state roots.");
  }
  failOnUnarchivedDemandConflicts([nextItem.demandKey]);
  const stateRoot = relative(stateRootFor(nextItem));
  if (!write) {
    output({
      ok: true,
      command: "claim-next",
      wrote: false,
      manifest: relative(manifestPath),
      sequenceId: manifest.sequenceId,
      wouldClaim: {
        demandKey: nextItem.demandKey,
        title: nextItem.title,
        stateRoot,
        developerDoc: relative(developerDocPath(nextItem)),
        taskPackages: initialTaskPackagesFor(nextItem).map((pkg) => pkg.taskPackageId),
        dispatchCandidates: dispatchCandidatesFor(nextItem, stateRoot),
      },
      agentNext: "Rerun with --write after total-control confirms this is the next safe demand.",
    }, [`Would claim next demand: ${nextItem.demandKey}`]);
    return;
  }

  const claimed = claimItem(nextItem);
  output({
    ok: true,
    command: "claim-next",
    wrote: true,
    manifest: relative(manifestPath),
    sequenceId: manifest.sequenceId,
    claimed: {
      demandKey: nextItem.demandKey,
      title: nextItem.title,
      stateRoot: claimed.stateRoot,
      progressDoc: `${claimed.stateRoot}/developer-progress.md`,
      developerDoc: claimed.developerDocSync.developerDoc,
      developerDocChanged: claimed.developerDocSync.changed,
      taskPackages: initialTaskPackagesFor(nextItem).map((pkg) => pkg.taskPackageId),
      dispatchCandidates: claimed.dispatchCandidates,
    },
    controllerOutputs: claimed.outputs,
    forbiddenConclusions: [
      "claim-next-is-dispatch",
      "claim-next-is-acceptance",
      "sequence-manifest-is-progress-doc",
    ],
  }, [
    `Claimed next demand: ${nextItem.demandKey}`,
    `State root: ${claimed.stateRoot}`,
    "No dispatch, delivery, automation loop, or evidence acceptance was performed.",
  ]);
}

function commandSyncDoc() {
  const demandKey = requireValue("--demand-key");
  const { manifestPath, manifest } = readManifest();
  const item = manifest.items.find((candidate) => candidate.demandKey === demandKey);
  if (!item) {
    fail(`manifest does not contain demandKey: ${demandKey}`);
  }
  const stateRoot = relative(stateRootFor(item));
  if (!existsSync(path.join(resolveFromWorkspace(stateRoot), "wakeflow-state.json"))) {
    fail(`cannot sync developerDoc before state root exists: ${stateRoot}`);
  }
  const result = syncDeveloperDoc(item, stateRoot);
  output({
    ok: true,
    command: "sync-doc",
    wrote: write,
    manifest: relative(manifestPath),
    sequenceId: manifest.sequenceId,
    demandKey,
    stateRoot,
    developerDoc: result.developerDoc,
    changed: result.changed,
    forbiddenConclusions: [
      "sync-doc-is-dispatch",
      "sync-doc-is-acceptance",
      "developer-doc-is-state-authority",
    ],
  }, [
    `${write ? "Synced" : "Would sync"} Unified Status for ${demandKey}.`,
    "No dispatch, delivery, automation loop, or evidence acceptance was performed.",
  ]);
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

  if (todoId) {
    const scan = runNextWorkTodo(todoId);
    const candidate = (scan.candidates ?? []).find((entry) => entry.id === todoId)
      ?? (scan.recommended && scan.recommended.id === todoId ? scan.recommended : null);
    if (!candidate) {
      fail(`TODO row ${todoId} is not an eligible candidate (missing, blocked, or not controller-recommended); inspect it with wakeflow_next_work source=todo first.`);
    }
    title = title ?? candidate.title;
    const documents = candidate.documents ?? "";
    if (!goal) {
      goal = documents
        ? `Deliver the requirement described by the delivered docs: ${documents}`
        : `Deliver TODO ${todoId}: ${title}`;
    }
    if (!completionDefinition) {
      completionDefinition = "Total control confirms the completion definition from the delivered docs before dispatch.";
    }
    if (!stagePlan && documents) {
      stagePlan = `Derive the stage plan from the delivered docs: ${documents}`;
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
  if (goal) initArgs.push("--goal", goal);
  if (completionDefinition) initArgs.push("--completion-definition", completionDefinition);
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
    forbiddenConclusions: ["create-demand-is-dispatch", "create-demand-is-acceptance"],
    agentNext: "Demand created and any delivered TODO row consumed. Dispatch is a separate step; no dispatch, delivery, or acceptance was performed.",
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
  if (command === "status") {
    commandStatus();
    return;
  }
  if (command === "claim-next") {
    commandClaimNext();
    return;
  }
  if (command === "sync-doc") {
    commandSyncDoc();
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
