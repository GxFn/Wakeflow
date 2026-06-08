#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadWorkspaceConfig } from "./lib/wakeflow-config.mjs";

const workspaceRoot = process.cwd();
const args = process.argv.slice(2);
const writeInbox = args.includes("--write");
const json = args.includes("--json");
const targetId = getArgValue("--id", null);
const workspaceConfig = loadWorkspaceConfig({ workspaceRoot, args });
const allowedStatuses = new Set([
  "draft",
  "ready-for-workspace",
  "accepted-by-workspace",
  "needs-design",
  "paused",
  "archived",
  "research",
  "absorbed-by-codex-loop",
]);
const requiredColumns = [
  "ID",
  "Status",
  "Title",
  "Original Plan",
  "Requirement Design",
  "Handoff",
  "User Confirmation",
  "Current Mainline Relation",
  "Suggested TODO",
  "Priority",
  "Next Step",
];
const optionalEnumColumns = {
  "User Confirmation Status": new Set(["unconfirmed", "confirmed", "needs-confirmation", "not-required", "superseded"]),
  "Mainline Relation Status": new Set(["none", "todo-candidate", "next-mainline", "blocks-current", "interrupts-current", "after-current"]),
  "Priority Enum": new Set(["P0", "P1", "P2", "P3"]),
};
const readyConfirmationStatuses = new Set(["confirmed", "not-required"]);
const designKeyPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\d{4}-\d{2}-\d{2}(?:-\d{2})?$/;

function getArgValue(name, fallback) {
  const eq = args.find((arg) => arg.startsWith(`${name}=`));
  if (eq) {
    return eq.slice(name.length + 1);
  }
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) {
    return args[index + 1];
  }
  return fallback;
}

const boardPath = path.resolve(
  workspaceRoot,
  getArgValue("--board", workspaceConfig.designHandoffBoard),
);
const inboxPath = path.resolve(
  workspaceRoot,
  getArgValue("--inbox", workspaceConfig.designHandoffInbox),
);

function splitMarkdownRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    return [];
  }
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function extractSection(content, heading) {
  const start = content.indexOf(`## ${heading}`);
  if (start < 0) {
    return "";
  }
  const rest = content.slice(start);
  const next = rest.slice(1).search(/\n## /);
  return next >= 0 ? rest.slice(0, next + 1) : rest;
}

function extractLinks(cell) {
  const links = [];
  const regex = /\[[^\]]+]\(([^)]+)\)/g;
  let match;
  while ((match = regex.exec(cell))) {
    links.push(match[1]);
  }
  return links;
}

function stripLinkTarget(target) {
  let clean = target.trim();
  if (clean.startsWith("<") && clean.endsWith(">")) {
    clean = clean.slice(1, -1);
  }
  const hashIndex = clean.indexOf("#");
  if (hashIndex >= 0) {
    clean = clean.slice(0, hashIndex);
  }
  try {
    clean = decodeURI(clean);
  } catch {
    // Keep the raw path if it is not valid URI encoding.
  }
  return clean;
}

function isExternalTarget(target) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#");
}

function firstLink(cell) {
  return extractLinks(cell)[0] ?? null;
}

function linkedTargets(entry, column) {
  const boardDir = path.dirname(boardPath);
  return extractLinks(entry[column] ?? "")
    .map((rawTarget) => {
      const target = stripLinkTarget(rawTarget);
      if (!target || isExternalTarget(target)) {
        return null;
      }
      const absoluteTarget = path.resolve(boardDir, target);
      return {
        absoluteTarget,
        column,
        relativeTarget: path.relative(workspaceRoot, absoluteTarget),
      };
    })
    .filter(Boolean);
}

function extractDesignKey(content) {
  const match = content.match(/^Design Key:\s*([A-Za-z0-9-]+)\s*$/m);
  return match?.[1] ?? null;
}

function parseBoard(content) {
  const section = extractSection(content, "Handoff Board");
  const lines = section.split("\n");
  const rows = lines.map(splitMarkdownRow).filter((row) => row.length > 0);
  const header = rows.find((row) => row.includes("ID") && row.includes("Status"));
  if (!header) {
    return { entries: [], issues: ["Handoff board is missing a table headed by ID / Status."] };
  }

  const missingColumns = requiredColumns.filter((column) => !header.includes(column));
  const issues = missingColumns.map((column) => `Handoff board is missing required column: ${column}`);
  const entries = [];
  for (const row of rows) {
    if (row === header || row.every((cell) => /^:?-{3,}:?$/.test(cell))) {
      continue;
    }
    const entry = {};
    for (const [index, column] of header.entries()) {
      entry[column] = row[index] ?? "";
    }
    if (entry.ID) {
      entries.push(entry);
    }
  }

  return { entries, issues };
}

function validateEntry(entry, seenIds) {
  const issues = [];
  const id = entry.ID;
  if (seenIds.has(id)) {
    issues.push(`${id}: duplicated handoff ID.`);
  }
  seenIds.add(id);

  if (!allowedStatuses.has(entry["Status"])) {
    issues.push(`${id}: unsupported status "${entry["Status"]}".`);
  }
  issues.push(...validateEnumColumns(entry));

  const boardDir = path.dirname(boardPath);
  for (const column of ["Original Plan", "Requirement Design", "Handoff"]) {
    for (const rawTarget of extractLinks(entry[column] ?? "")) {
      const target = stripLinkTarget(rawTarget);
      if (!target || isExternalTarget(target)) {
        continue;
      }
      const absoluteTarget = path.resolve(boardDir, target);
      if (!existsSync(absoluteTarget)) {
        issues.push(`${id}: ${column} links to missing ${path.relative(workspaceRoot, absoluteTarget)}.`);
      }
    }
  }

  if (entry["Status"] === "ready-for-workspace") {
    if (!firstLink(entry["Original Plan"])) {
      issues.push(`${id}: ready entry must link an original plan.`);
    }
    if (!firstLink(entry["Requirement Design"])) {
      issues.push(`${id}: ready entry must link a requirement design.`);
    }
    const confirmation = userConfirmationState(entry);
    if (!readyConfirmationStatuses.has(confirmation.status)) {
      issues.push(
        `${id}: ready entry must record user confirmation status confirmed or not-required.`,
      );
    }
    for (const column of ["Current Mainline Relation", "Suggested TODO", "Priority", "Next Step"]) {
      if (!entry[column] || entry[column].trim().length === 0) {
        issues.push(`${id}: ready entry is missing ${column}.`);
      }
    }
    for (const column of ["User Confirmation Status", "Mainline Relation Status", "Priority Enum"]) {
      if (hasColumn(entry, column) && !String(entry[column] ?? "").trim()) {
        issues.push(`${id}: ready entry is missing ${column}.`);
      }
    }
  }

  return issues;
}

function validateTargetDesignKey(entry) {
  const issues = [];
  const id = entry.ID;

  if (!designKeyPattern.test(id)) {
    issues.push(`${id}: Design Key must use lowercase kebab-case <readable-topic>-YYYY-MM-DD format.`);
  }

  const linkedDocs = ["Original Plan", "Requirement Design", "Handoff"].flatMap((column) => linkedTargets(entry, column));
  const docsWithDesignKey = [];
  for (const doc of linkedDocs) {
    if (!existsSync(doc.absoluteTarget)) {
      continue;
    }
    const designKey = extractDesignKey(readFileSync(doc.absoluteTarget, "utf8"));
    if (!designKey) {
      issues.push(`${id}: ${doc.column} ${doc.relativeTarget} is missing Design Key metadata.`);
      continue;
    }
    docsWithDesignKey.push(doc.relativeTarget);
    if (designKey !== id) {
      issues.push(`${id}: ${doc.column} ${doc.relativeTarget} has Design Key ${designKey}, expected ${id}.`);
    }
  }

  if (linkedDocs.length > 0 && docsWithDesignKey.length === 0) {
    issues.push(`${id}: linked Design docs did not expose any Design Key metadata.`);
  }

  return issues;
}

function hasColumn(entry, column) {
  return Object.prototype.hasOwnProperty.call(entry, column);
}

function normalizeEnumValue(value, column) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  return column === "Priority Enum" ? text.toUpperCase() : text.toLowerCase();
}

function validateEnumColumns(entry) {
  const issues = [];
  const id = entry.ID;
  for (const [column, allowed] of Object.entries(optionalEnumColumns)) {
    if (!hasColumn(entry, column)) {
      continue;
    }
    const value = normalizeEnumValue(entry[column], column);
    if (value && !allowed.has(value)) {
      issues.push(`${id}: ${column} has unsupported enum "${entry[column]}"; allowed: ${[...allowed].join(", ")}.`);
    }
  }

  if (hasColumn(entry, "User Confirmation Status")) {
    const status = normalizeEnumValue(entry["User Confirmation Status"], "User Confirmation Status");
    if (status && optionalEnumColumns["User Confirmation Status"].has(status)) {
      const legacyText = String(entry["User Confirmation"] ?? "").trim();
      const legacyPositive = hasPositiveUserConfirmation(entry["User Confirmation"]);
      const legacyNegative = legacyText ? hasNegativeUserConfirmation(entry["User Confirmation"]) : false;
      if (readyConfirmationStatuses.has(status) && legacyNegative) {
        issues.push(`${id}: User Confirmation Status=${status} conflicts with User Confirmation text.`);
      }
      if (!readyConfirmationStatuses.has(status) && legacyPositive) {
        issues.push(`${id}: User Confirmation Status=${status} conflicts with User Confirmation text.`);
      }
    }
  }
  return issues;
}

function userConfirmationState(entry) {
  if (hasColumn(entry, "User Confirmation Status")) {
    const status = normalizeEnumValue(entry["User Confirmation Status"], "User Confirmation Status");
    return {
      source: status ? "enum" : "missing-enum",
      status: status || "unconfirmed",
    };
  }
  return {
    source: "legacy-text",
    status: hasPositiveUserConfirmation(entry["User Confirmation"]) ? "confirmed" : "unconfirmed",
  };
}

function optionalEnumState(entry, column) {
  if (!hasColumn(entry, column)) {
    return null;
  }
  const value = normalizeEnumValue(entry[column], column);
  return value || null;
}

function hasNegativeUserConfirmation(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return true;
  }
  return /(unconfirmed|pending-confirmation|not confirmed|no confirmation|not confirmed|unconfirmed|pending confirmation)/i.test(text);
}

function hasPositiveUserConfirmation(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return false;
  }
  if (hasNegativeUserConfirmation(text)) {
    return false;
  }
  return /(user[^|.;]*confirmed|yes|confirmed)/i.test(text);
}

function summarizeLinkedDoc(entry, column) {
  const target = firstLink(entry[column] ?? "");
  if (!target) {
    return {
      cell: entry[column] ?? "",
      exists: false,
      path: null,
      designKey: null,
    };
  }

  const cleanTarget = stripLinkTarget(target);
  if (!cleanTarget || isExternalTarget(cleanTarget)) {
    return {
      cell: entry[column] ?? "",
      exists: false,
      path: target,
      designKey: null,
    };
  }

  const absoluteTarget = path.resolve(path.dirname(boardPath), cleanTarget);
  const exists = existsSync(absoluteTarget);
  const designKey = exists ? extractDesignKey(readFileSync(absoluteTarget, "utf8")) : null;
  return {
    cell: entry[column] ?? "",
    exists,
    path: path.relative(workspaceRoot, absoluteTarget),
    designKey,
  };
}

function summarizeTargetEntry(entry) {
  if (!entry) {
    return null;
  }
  return {
    id: entry.ID,
    status: entry["Status"],
    title: entry["Title"],
    readyForWorkspace: entry["Status"] === "ready-for-workspace",
    userConfirmation: entry["User Confirmation"],
    userConfirmationStatus: userConfirmationState(entry),
    currentMainlineRelation: entry["Current Mainline Relation"],
    mainlineRelationStatus: optionalEnumState(entry, "Mainline Relation Status"),
    suggestedTodo: entry["Suggested TODO"],
    priority: entry["Priority"],
    priorityStatus: optionalEnumState(entry, "Priority Enum"),
    nextStep: entry["Next Step"],
    originalPlan: summarizeLinkedDoc(entry, "Original Plan"),
    requirementDesign: summarizeLinkedDoc(entry, "Requirement Design"),
    handoff: summarizeLinkedDoc(entry, "Handoff"),
  };
}

function relativeLink(fromFile, targetFile) {
  const relative = path.relative(path.dirname(fromFile), targetFile).replaceAll(path.sep, "/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function formatCell(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function rewriteLinksForInbox(cell) {
  const boardDir = path.dirname(boardPath);
  return String(cell ?? "").replace(/\[([^\]]+)]\(([^)]+)\)/g, (match, label, rawTarget) => {
    const target = stripLinkTarget(rawTarget);
    if (!target || isExternalTarget(target)) {
      return match;
    }
    const absoluteTarget = path.resolve(boardDir, target);
    return `[${label}](${relativeLink(inboxPath, absoluteTarget)})`;
  });
}

function renderInbox(entries, issues) {
  const date = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).format(new Date());
  const boardLink = relativeLink(inboxPath, boardPath);
  const readyEntries = entries.filter((entry) => entry["Status"] === "ready-for-workspace");
  const acceptedEntries = entries.filter((entry) => entry["Status"] === "accepted-by-workspace");
  const otherEntries = entries.filter(
    (entry) => entry["Status"] !== "ready-for-workspace" && entry["Status"] !== "accepted-by-workspace",
  );

  const rows = readyEntries
    .map((entry) => {
      return `| ${formatCell(entry.ID)} | ${formatCell(entry["Title"])} | ${formatCell(
        entry["Priority"],
      )} | ${formatCell(userConfirmationState(entry).status)} | ${formatCell(entry["Current Mainline Relation"])} | ${formatCell(entry["Suggested TODO"])} | ${formatCell(
        rewriteLinksForInbox(entry["Original Plan"]),
      )} | ${formatCell(rewriteLinksForInbox(entry["Requirement Design"]))} | ${formatCell(entry["Next Step"])} |`;
    })
    .join("\n");
  const allRows = entries
    .map((entry) => `| ${formatCell(entry.ID)} | ${formatCell(entry["Status"])} | ${formatCell(entry["Title"])} |`)
    .join("\n");

  return `# Design Handoff Inbox

Updated Date: ${date}
Maintained By: ${workspaceConfig.controllerWindow}
Source board: [${workspaceConfig.designWindow} workspace handoff board](${boardLink})

## Purpose

This file is generated from \`scripts/wakeflow-import-design-handoffs.mjs --write\` using the ${workspaceConfig.designWindow} board. It alerts the controller to Design demands that are ready for intake. It is not Global TODO and not an execution plan. After controller intake, entries still need to be written into \`global-todo-board\`, the current plan \`TODO / Backlog\`, or the demand directory, then advanced according to the current mainline, priority, dependencies, and goal-stage confirmation.

## Pending Controller Intake

${
  readyEntries.length > 0
    ? `| ID | Title | Priority | User Confirmation Status | Current Mainline Relation | Suggested TODO | Original Plan | Requirement Design | Next Step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows}`
    : "There are no `ready-for-workspace` entries."
}

## Intake Boundary

- Automatic generation only discovers and validates; it does not dispatch implementation windows.
- \`ready-for-workspace\` entries must be checked for current-mainline impact after controller intake.
- Complete demands that do not affect the current mainline normally enter TODO/Backlog or the demand directory and are claimed by priority after the current mainline completes.
- Entries that affect the current mainline must be marked blocked, pending-confirmation, or rework-candidate; do not bypass controller confirmation gates.

## Stats

- Ready for workspace: ${readyEntries.length}
- Accepted by workspace: ${acceptedEntries.length}
- Other statuses: ${otherEntries.length}
- Validation issues: ${issues.length}

## All Design Board Entries

${
  entries.length > 0
    ? `| ID | Status | Title |
| --- | --- | --- |
${allRows}`
    : "The Design board has no entries."
}
`;
}

const boardExists = existsSync(boardPath);
if (!boardExists && !json) {
  console.error(`Design handoff board not found: ${path.relative(workspaceRoot, boardPath)}`);
}

const boardContent = boardExists ? readFileSync(boardPath, "utf8") : "";
const parsed = boardExists
  ? parseBoard(boardContent)
  : {
      entries: [],
      issues: [`Design handoff board not found: ${path.relative(workspaceRoot, boardPath)}`],
    };
const seenIds = new Set();
const entryIssues = parsed.entries.flatMap((entry) => validateEntry(entry, seenIds));
const targetEntry = targetId ? parsed.entries.find((entry) => entry.ID === targetId) : null;
const targetIssues = targetId
  ? targetEntry
    ? validateTargetDesignKey(targetEntry)
    : [`${targetId}: handoff ID not found.`]
  : [];
const issues = [...parsed.issues, ...entryIssues, ...targetIssues];
const readyEntries = parsed.entries.filter((entry) => entry["Status"] === "ready-for-workspace");

if (writeInbox) {
  mkdirSync(path.dirname(inboxPath), { recursive: true });
  writeFileSync(inboxPath, renderInbox(parsed.entries, issues));
}

const result = {
  agentNext: issues.length === 0
    ? "Review ready Design handoffs in total-control context; do not dispatch until accepted into a current plan or TODO ledger."
    : "Resolve Design handoff validation issues before accepting or dispatching.",
  board: path.relative(workspaceRoot, boardPath),
  inbox: path.relative(workspaceRoot, inboxPath),
  issueCount: issues.length,
  issues,
  readyCount: readyEntries.length,
  readyIds: readyEntries.map((entry) => entry.ID),
  target: targetId ? summarizeTargetEntry(targetEntry) : null,
  scriptComplete: true,
  totalCount: parsed.entries.length,
  wroteInbox: writeInbox,
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Design handoff import ${issues.length === 0 ? "passed" : "failed"}.`);
  console.log(`Board: ${result.board}`);
  console.log(`Ready for workspace: ${readyEntries.length}`);
  if (readyEntries.length > 0) {
    console.log(`Ready IDs: ${readyEntries.map((entry) => entry.ID).join(", ")}`);
  }
  if (writeInbox) {
    console.log(`Inbox written: ${result.inbox}`);
  }
  if (targetId) {
    if (targetEntry) {
      console.log(`Target: ${targetEntry.ID} (${targetEntry["Status"]})`);
    } else {
      console.log(`Target: ${targetId} (not found)`);
    }
  }
  for (const issue of issues) {
    console.log(`- ${issue}`);
  }
  console.log(`Agent next: ${result.agentNext}`);
}

if (issues.length > 0) {
  process.exitCode = 1;
}
