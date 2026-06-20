#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSync } from "../lib/wakeflow-process.mjs";
import { updateDesignHandoffStatus } from "./lib/wakeflow-design-board.mjs";

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
  node scripts/wakeflow-demand-sequence.mjs claim-from-design [--design-key <key>] [--root <workspace>] [--write] [--json]

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
  const configPath = path.join(workspaceRoot, "workspace.config.json");
  cachedWorkspaceConfig = existsSync(configPath) ? readJson(configPath, "workspace config") : null;
  return cachedWorkspaceConfig;
}

function controllerWindowFor(item) {
  const config = readWorkspaceConfig();
  const controllerWindow = item.controllerWindow ?? config?.controllerWindow ?? config?.workspaceName;
  if (!controllerWindow) {
    fail(`manifest item ${item.demandKey} requires controllerWindow or workspace.config.json controllerWindow.`);
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

function runNextWorkDesign() {
  const result = runSync(process.execPath, [
    path.join(scriptsDir, "wakeflow-next-work.mjs"),
    "--root", workspaceRoot, "--source", "design", "--json",
  ], { cwd: workspaceRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!result.stdout) {
    fail(["wakeflow-next-work produced no output during the Design scan.", result.stderr?.trim()].filter(Boolean).join("\n"));
  }
  return JSON.parse(result.stdout);
}

function runImportRevalidate(designKey) {
  // import exits non-zero when ANY board row has issues; the JSON payload on stdout is
  // still authoritative, and the caller keeps only the targeted row's issues so an
  // unrelated invalid row never blocks a legitimate single-row claim.
  const result = runSync(process.execPath, [
    path.join(scriptsDir, "wakeflow-import-design-handoffs.mjs"),
    "--root", workspaceRoot, "--id", designKey, "--json",
  ], { cwd: workspaceRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!result.stdout) {
    fail([`wakeflow-import-design-handoffs produced no output revalidating ${designKey}.`, result.stderr?.trim()].filter(Boolean).join("\n"));
  }
  return JSON.parse(result.stdout);
}

// claim-from-design is the manifest-free, Design-gated controller auto-claim: it inits at
// most one demand from a Design-set controller-claimable row. It never dispatches, accepts,
// or weakens per-demand user confirmation. Eligibility lives in the typed Design status.
function commandClaimFromDesign() {
  const designKeyArg = getValue("--design-key", null);
  const scan = runNextWorkDesign();
  const designCandidates = scan.candidates ?? [];
  const autoClaimable = designCandidates.filter((candidate) => candidate.controllerClaimable === true);

  if (!designKeyArg && autoClaimable.length === 0) {
    output({
      ok: true,
      command: "claim-from-design",
      wrote: false,
      claimable: [],
      claimed: null,
      agentNext: "No controller-claimable Design row. Ask Design to set controller-claimable on a user-confirmed deliverable.",
    }, ["No controller-claimable Design row is available."]);
    return;
  }

  let target;
  if (designKeyArg) {
    target = designCandidates.find((candidate) => candidate.id === designKeyArg);
    if (!target) {
      fail(`--design-key ${designKeyArg} is not an eligible Design row; candidates: ${designCandidates.map((c) => `${c.id}:${c.status}`).join(", ") || "none"}.`);
    }
    if (!target.controllerClaimable && target.status !== "ready-for-workspace") {
      fail(`--design-key ${designKeyArg} is ${target.status}; expected ready-for-workspace or controller-claimable.`);
    }
  } else if (autoClaimable.length === 1) {
    target = autoClaimable[0];
  } else {
    fail(`multiple controller-claimable rows (${autoClaimable.map((c) => c.id).join(", ")}); pass --design-key to choose exactly one.`);
  }

  const stateRootAbs = resolveFromWorkspace(`.wakeflow-active/current/${slug(target.id)}`);
  const stateRoot = relative(stateRootAbs);
  const requirementDesign = target.documents?.requirementDesign?.path ?? null;
  const originalPlan = target.documents?.originalPlan?.path ?? null;

  if (!write) {
    output({
      ok: true,
      command: "claim-from-design",
      wrote: false,
      wouldClaim: { demandKey: target.id, title: target.title, stateRoot, requirementDesign, originalPlan },
      claimMode: target.controllerClaimable ? "design-auto-claimable" : "explicit-ready-design-key",
      agentNext: "Rerun with --write after total control confirms this Design-confirmed demand is the next safe demand to init.",
    }, [`Would claim Design demand: ${target.id}`]);
    return;
  }

  // Apply-time fail-closed single-row revalidation (TOCTOU guard): the row must still pass
  // its own import validation and still be typed controller-claimable.
  const reval = runImportRevalidate(target.id);
  const rowIssues = (reval.issues ?? []).filter((issue) => issue.startsWith(`${target.id}:`));
  if (rowIssues.length > 0) {
    fail([`Design row ${target.id} failed fail-closed revalidation:`, ...rowIssues].join("\n"));
  }
  if (!reval.target || !(reval.target.controllerClaimable === true || (designKeyArg && reval.target.readyForWorkspace === true))) {
    fail(`row ${target.id} is no longer claimable at apply time; expected controller-claimable or an explicitly named ready-for-workspace row.`);
  }
  const claimSourceStatus = reval.target.status;

  // demandKey-collision guard: never re-init over an existing demand state root.
  if (existsSync(path.join(stateRootAbs, "wakeflow-state.json"))) {
    fail(`a demand state root already exists at ${stateRoot}; refuse to re-init ${target.id}.`);
  }

  const boardUpdatePreview = updateDesignHandoffStatus({
    boardPath: getValue("--board", readWorkspaceConfig()?.designHandoffBoard ?? ".wakeflow-active/current/design-handoff-board.md"),
    designKey: target.id,
    nextStatus: "accepted-by-workspace",
    expectedStatuses: [claimSourceStatus],
    nextStepNote: `accepted by workspace; state root ${stateRoot}`,
    write: false,
    workspaceRoot,
  });
  if (!boardUpdatePreview.ok) {
    fail(`cannot advance Design handoff ${target.id} to accepted-by-workspace: ${boardUpdatePreview.reason ?? "unknown"}.`);
  }

  const goal = requirementDesign
    ? `Deliver per Design requirement design: ${requirementDesign}`
    : `Deliver Design demand ${target.id}: ${target.title}`;
  const completionDefinition = requirementDesign
    ? `Completion per requirement design ${requirementDesign}; total control confirms scope before dispatch.`
    : "Total control confirms the completion definition from linked Design docs before dispatch.";
  const stagePlan = originalPlan
    ? `Derive stages from original plan ${originalPlan} and requirement design ${requirementDesign ?? "(linked)"}.`
    : "Total control derives the stage plan from the linked Design docs.";

  const initOut = runControllerState([
    "init",
    "--root", workspaceRoot,
    "--state-root", stateRoot,
    "--demand-key", target.id,
    "--title", target.title,
    "--goal", goal,
    "--completion-definition", completionDefinition,
    "--stage-plan", stagePlan,
    "--write", "--json",
  ]);
  const renderOut = runRenderProgressDoc(stateRoot);
  const boardUpdate = updateDesignHandoffStatus({
    boardPath: getValue("--board", readWorkspaceConfig()?.designHandoffBoard ?? ".wakeflow-active/current/design-handoff-board.md"),
    designKey: target.id,
    nextStatus: "accepted-by-workspace",
    expectedStatuses: [claimSourceStatus],
    nextStepNote: `accepted by workspace; state root ${stateRoot}`,
    write: true,
    workspaceRoot,
  });

  output({
    ok: true,
    command: "claim-from-design",
    wrote: true,
    claimed: {
      demandKey: target.id,
      title: target.title,
      stateRoot,
      progressDoc: `${stateRoot}/developer-progress.md`,
      requirementDesign,
      originalPlan,
      claimMode: target.controllerClaimable ? "design-auto-claimable" : "explicit-ready-design-key",
    },
    designBoardUpdate: boardUpdate,
    controllerOutputs: [initOut, renderOut],
    forbiddenConclusions: [
      "claim-from-design-is-dispatch",
      "claim-from-design-is-acceptance",
      "controller-claim-bypasses-per-demand-confirmation",
    ],
    agentNext: "Read the linked Design docs, then confirm dispatch as a separate step. No dispatch, delivery, or acceptance was performed.",
  }, [
    `Claimed Design demand: ${target.id}`,
    `State root: ${stateRoot}`,
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
  if (command === "claim-from-design") {
    commandClaimFromDesign();
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
