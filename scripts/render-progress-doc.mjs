#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspaceConfig, workspaceLedgerPaths } from "./lib/workspace-config.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const controlRoot = path.dirname(path.dirname(scriptPath));
const rawArgs = process.argv.slice(2);
const workspaceRoot = path.resolve(getValue("--root", controlRoot));
const write = rawArgs.includes("--write");
const json = rawArgs.includes("--json");
const templateRoot = path.join(controlRoot, "templates/control-state-machine");

class CliExit extends Error {}

function getValue(name, fallback = null) {
  const eq = rawArgs.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = rawArgs.indexOf(name);
  if (index >= 0 && rawArgs[index + 1] && !rawArgs[index + 1].startsWith("--")) {
    return rawArgs[index + 1];
  }
  return fallback;
}

function output(payload, textLines = []) {
  const complete = { scriptComplete: true, ...payload };
  if (!complete.agentNext) {
    complete.agentNext = complete.ok
      ? "Continue by total-control judgment; rendering does not dispatch or accept work."
      : "Stop and inspect the reported progress projection issue.";
  }
  if (json) {
    console.log(JSON.stringify(complete, null, 2));
    return;
  }
  for (const line of textLines) console.log(line);
  console.log(`Agent next: ${complete.agentNext}`);
}

function fail(message) {
  output({ ok: false, command: "render-progress-doc", error: message });
  process.exitCode = 1;
  throw new CliExit(message);
}

function requireValue(name) {
  const value = getValue(name);
  if (!value) fail(`${name} is required.`);
  return value;
}

function relative(file) {
  const rel = path.relative(workspaceRoot, file).split(path.sep).join("/");
  return rel || ".";
}

function ensureInsideAllowedRoots(file, label, allowedRoots) {
  const absolute = path.resolve(file);
  if (allowedRoots.some((root) => {
    const rel = path.relative(root, absolute);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  })) {
    return;
  }
  fail(`${label} must stay inside the control workspace or configured project ledger: ${absolute}`);
}

function resolveFromWorkspace(value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspaceRoot, value);
}

function stateRootFromArg() {
  const stateRoot = resolveFromWorkspace(requireValue("--state-root"));
  const config = loadWorkspaceConfig({ workspaceRoot, args: rawArgs });
  const ledgerPaths = workspaceLedgerPaths({ workspaceRoot, args: rawArgs, config });
  ensureInsideAllowedRoots(stateRoot, "state root", [
    workspaceRoot,
    ledgerPaths.projectLedgerRoot,
    ledgerPaths.workspaceDocsDir,
  ]);
  return stateRoot;
}

function readJson(file, label) {
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

function writeJson(file, value) {
  atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readTemplate(name) {
  return readFileSync(path.join(templateRoot, name), "utf8");
}

function render(template, data) {
  return template.replace(/\{\{([A-Za-z0-9_]+)}}/g, (match, key) => String(data[key] ?? ""));
}

function beijingTimestamp(iso) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso)).replace(",", "") + " CST";
}

function lastEvent(eventsFile) {
  if (!existsSync(eventsFile)) return null;
  const lines = readFileSync(eventsFile, "utf8").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return null;
  return JSON.parse(lines.at(-1));
}

function summarizeItems(items, idKey, statusKey = "status") {
  if (!Array.isArray(items) || items.length === 0) return "none";
  return items.map((item) => `${item[idKey] ?? "unknown"}(${item[statusKey] ?? "unknown"})`).join(", ");
}

function summarizeWindows(windows) {
  if (!Array.isArray(windows) || windows.length === 0) return "none";
  return windows.map((item) => `${item.windowName ?? "unknown"}(${item.windowState ?? "unknown"})`).join(", ");
}

function summarizeBlockers(blockers) {
  if (!Array.isArray(blockers) || blockers.length === 0) return "none";
  return blockers.map((item) => item.summary ?? item.reason ?? item.id ?? "blocker").join(", ");
}

function nextActionFor(state) {
  if (Array.isArray(state.allowedActions) && state.allowedActions.length > 0) {
    return state.allowedActions.join(", ");
  }
  if (state.projection?.status === "stale") {
    return "Review state changes and choose the next total-control action.";
  }
  return "Define stages and task packages by total-control judgment.";
}

try {
  const stateRoot = stateRootFromArg();
  const stateFile = path.join(stateRoot, "controller-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const projectionFile = path.join(stateRoot, "projection.json");
  const state = readJson(stateFile, "controller state");
  const event = lastEvent(eventsFile);
  const progressDoc = state.projection?.progressDoc ?? "developer-progress.md";
  const progressFile = path.join(stateRoot, progressDoc);
  if (!existsSync(progressFile)) {
    fail(`progress doc does not exist: ${relative(progressFile)}`);
  }

  const renderedAt = new Date().toISOString();
  const statusValues = {
    demandKey: state.demandKey,
    title: state.title,
    state: state.state,
    stage: state.activeStageId ?? "none",
    taskPackages: summarizeItems(state.taskPackages, "taskPackageId"),
    windows: summarizeWindows(state.windows),
    blockers: summarizeBlockers(state.blockers),
    nextAction: nextActionFor(state),
    review: state.review?.status ?? "none",
    automation: state.automation?.enabled ? "enabled" : "disabled",
    decisionsRequired: summarizeBlockers(state.decisionsRequired),
    updatedAt: beijingTimestamp(renderedAt),
    revision: state.revision,
    eventId: event?.eventId ?? "none",
  };
  const unifiedStatus = render(readTemplate("unified-status.template.md"), statusValues).trimEnd();
  const projection = {
    schemaVersion: 1,
    demandKey: state.demandKey,
    title: state.title,
    sourceRevision: state.revision,
    sourceEventId: event?.eventId ?? "none",
    progressDoc,
    unifiedStatus: {
      demand: `${state.demandKey} - ${state.title}`,
      mainState: state.state,
      stage: statusValues.stage,
      currentTaskPackages: statusValues.taskPackages,
      windows: statusValues.windows,
      blockers: statusValues.blockers,
      nextAction: statusValues.nextAction,
      review: statusValues.review,
      automation: statusValues.automation,
      userDecisionsNeeded: statusValues.decisionsRequired,
      lastUpdated: renderedAt,
    },
  };
  const progress = readFileSync(progressFile, "utf8");
  const matches = progress.match(/<!-- unified-status:start -->[\s\S]*?<!-- unified-status:end -->/g) ?? [];
  if (matches.length !== 1) {
    fail(`progress doc must contain exactly one unified-status marker block; found ${matches.length}.`);
  }
  const nextProgress = progress.replace(
    /<!-- unified-status:start -->[\s\S]*?<!-- unified-status:end -->/,
    `<!-- unified-status:start -->\n${unifiedStatus}\n<!-- unified-status:end -->`,
  );
  const nextState = {
    ...state,
    projection: {
      ...(state.projection ?? {}),
      status: "synced",
      lastRenderedAt: renderedAt,
      progressDoc,
    },
  };

  if (write) {
    writeJson(projectionFile, projection);
    writeJson(stateFile, nextState);
    atomicWrite(progressFile, nextProgress.endsWith("\n") ? nextProgress : `${nextProgress}\n`);
  }

  output(
    {
      ok: true,
      command: "render-progress-doc",
      wrote: write,
      stateRoot: relative(stateRoot),
      progressDoc: relative(progressFile),
      projectionFile: relative(projectionFile),
      sourceRevision: state.revision,
      sourceEventId: event?.eventId ?? "none",
      changed: nextProgress !== progress || state.projection?.status !== "synced",
    },
    [
      `${write ? "Rendered" : "Would render"} Unified Status for ${state.demandKey}.`,
      "Only the unified-status marker block is updated in the progress doc.",
    ],
  );
} catch (error) {
  if (!(error instanceof CliExit)) {
    throw error;
  }
}
