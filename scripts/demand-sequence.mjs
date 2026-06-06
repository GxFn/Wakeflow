#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptPath);
const controlRoot = path.dirname(scriptsDir);
const rawArgs = process.argv.slice(2);
const command = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs[0] : "status";
const options = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs.slice(1) : rawArgs;
const workspaceRoot = path.resolve(getValue("--root", controlRoot));
const write = hasFlag("--write");
const json = hasFlag("--json");

const helpText = `
Controller demand sequence runner

Usage:
  node scripts/demand-sequence.mjs status --manifest <manifest.json> [--root <workspace>] [--json]
  node scripts/demand-sequence.mjs claim-next --manifest <manifest.json> [--root <workspace>] [--write] [--json]
  node scripts/demand-sequence.mjs sync-doc --manifest <manifest.json> --demand-key <key> [--root <workspace>] [--write] [--json]

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
  return resolveFromWorkspace(item.stateRoot ?? `.workspace-active/workspace/current/${slug(item.demandKey)}`);
}

function stateFor(item) {
  const stateRoot = stateRootFor(item);
  const stateFile = path.join(stateRoot, "controller-state.json");
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
  const result = spawnSync(process.execPath, [path.join(scriptsDir, "controller-state.mjs"), ...argsForScript], {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail([
      `controller-state failed: node scripts/controller-state.mjs ${argsForScript.join(" ")}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join("\n"));
  }
  return result.stdout ? JSON.parse(result.stdout) : null;
}

function runRenderProgressDoc(stateRoot) {
  const result = spawnSync(process.execPath, [
    path.join(scriptsDir, "render-progress-doc.mjs"),
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
      `render-progress-doc failed for ${stateRoot}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join("\n"));
  }
  return result.stdout ? JSON.parse(result.stdout) : null;
}

function statusBlockFromStateRoot(stateRoot) {
  const state = readJson(path.join(resolveFromWorkspace(stateRoot), "controller-state.json"), "controller state");
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
          "scripts/workspace-control.mjs",
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
          item.controllerWindow ?? "AlembicWorkspace",
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
  if (!existsSync(path.join(resolveFromWorkspace(stateRoot), "controller-state.json"))) {
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
  fail(`Unknown demand-sequence command: ${command}\n\n${helpText}`);
}

try {
  main();
} catch (error) {
  if (!(error instanceof CliExit)) {
    throw error;
  }
}
