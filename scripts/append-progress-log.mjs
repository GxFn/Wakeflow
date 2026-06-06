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

const sectionByType = new Map([
  ["task-package", "Task Packages"],
  ["backfill", "Backfill Summaries"],
  ["decision", "Decisions And Append Log"],
]);

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
      ? "Continue by total-control judgment; appended log entries are not state transitions."
      : "Stop and inspect the reported append-only progress log issue.";
  }
  if (json) {
    console.log(JSON.stringify(complete, null, 2));
    return;
  }
  for (const line of textLines) console.log(line);
  console.log(`Agent next: ${complete.agentNext}`);
}

function usageLines() {
  return [
    "Append an entry to a controller state-root developer progress document.",
    "",
    "Usage:",
    "  node scripts/append-progress-log.mjs --state-root <path> --type task-package --task-package-id <id> --summary <text> [--source-ref <ref>] [--write] [--json]",
    "  node scripts/append-progress-log.mjs --state-root <path> --type backfill --target-task-id <id> --target-window <window> [--evidence-ref <ref>] [--write] [--json]",
    "  node scripts/append-progress-log.mjs --state-root <path> --type decision --decision <text> [--event-id <id>] [--evidence-ref <ref>] [--write] [--json]",
    "",
    "Notes:",
    "  The script appends human-readable log entries only; it does not change machine state, dispatch work, or accept evidence.",
  ];
}

function fail(message) {
  output({ ok: false, command: "append-progress-log", error: message });
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

function readTemplate(name) {
  return readFileSync(path.join(templateRoot, name), "utf8");
}

function render(template, data) {
  return template.replace(/\{\{([A-Za-z0-9_]+)}}/g, (match, key) => String(data[key] ?? ""));
}

function timestamp() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date()).replace(",", "") + " CST";
}

function entryForType(type) {
  const stamp = getValue("--timestamp", timestamp());
  if (getValue("--entry")) {
    return `- ${stamp}: ${getValue("--entry")}`;
  }
  if (type === "task-package") {
    return render(readTemplate("task-package-entry.template.md"), {
      timestamp: stamp,
      taskPackageId: requireValue("--task-package-id"),
      summary: requireValue("--summary"),
      sourceRef: getValue("--source-ref", "none"),
    }).trimEnd();
  }
  if (type === "backfill") {
    return render(readTemplate("backfill-summary-entry.template.md"), {
      timestamp: stamp,
      targetTaskId: requireValue("--target-task-id"),
      targetWindow: requireValue("--target-window"),
      evidenceRef: getValue("--evidence-ref", "none"),
    }).trimEnd();
  }
  if (type === "decision") {
    return render(readTemplate("decision-log-entry.template.md"), {
      timestamp: stamp,
      decision: requireValue("--decision"),
      eventId: getValue("--event-id", "none"),
      evidenceRef: getValue("--evidence-ref", "none"),
    }).trimEnd();
  }
  fail(`Unsupported append type: ${type}`);
  return "";
}

function appendToSection(content, heading, entry) {
  const sectionRegex = new RegExp(`(^## ${heading}\\s*$)`, "m");
  const match = content.match(sectionRegex);
  if (!match || typeof match.index !== "number") {
    fail(`progress doc is missing section: ${heading}`);
  }
  const start = match.index;
  const rest = content.slice(start);
  const nextMatch = rest.slice(1).match(/\n## /);
  const end = nextMatch && typeof nextMatch.index === "number" ? start + 1 + nextMatch.index : content.length;
  const section = content.slice(start, end).trimEnd();
  const suffix = content.slice(end);
  return `${content.slice(0, start)}${section}\n\n${entry.trimEnd()}\n${suffix}`;
}

try {
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    output(
      {
        ok: true,
        command: "append-progress-log",
        usage: usageLines(),
        agentNext: "Use the matching append type after total-control judgment; help does not modify files.",
      },
      usageLines(),
    );
    throw new CliExit("help");
  }

  const type = requireValue("--type");
  const heading = sectionByType.get(type);
  if (!heading) fail(`--type must be one of: ${[...sectionByType.keys()].join(", ")}`);
  const stateRoot = stateRootFromArg();
  const state = readJson(path.join(stateRoot, "controller-state.json"), "controller state");
  const progressDoc = state.projection?.progressDoc ?? "developer-progress.md";
  const progressFile = path.join(stateRoot, progressDoc);
  if (!existsSync(progressFile)) fail(`progress doc does not exist: ${relative(progressFile)}`);
  const entry = entryForType(type);
  const previous = readFileSync(progressFile, "utf8");
  const next = appendToSection(previous, heading, entry);

  if (write) {
    atomicWrite(progressFile, next.endsWith("\n") ? next : `${next}\n`);
  }

  output(
    {
      ok: true,
      command: "append-progress-log",
      wrote: write,
      type,
      section: heading,
      stateRoot: relative(stateRoot),
      progressDoc: relative(progressFile),
      entry,
    },
    [
      `${write ? "Appended" : "Would append"} ${type} entry to ${heading}.`,
      "No state transition, dispatch, or acceptance was performed.",
    ],
  );
} catch (error) {
  if (!(error instanceof CliExit)) {
    throw error;
  }
}
