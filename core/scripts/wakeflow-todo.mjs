#!/usr/bin/env node

// Wakeflow unified-surface TODO writer.
//
// `deliver` appends one Design-ready item (requirement / bug / supplement / research)
// as a `pending-claim` row on the global TODO board. It is the ONE controller-surface
// write Design may perform: append-only — it never edits or re-statuses an existing row,
// and it sets the immutable `Auto Claim` delivery property exactly once. The controller
// then reads the row (wakeflow-next-work) and claims it; Design tracks no further status.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadWorkspaceConfig, resolveWorkspaceRoot, workspaceLedgerPaths } from "./lib/wakeflow-config.mjs";

const args = process.argv.slice(2);
const workspaceRoot = resolveWorkspaceRoot(args);
const command = args[0] && !args[0].startsWith("--") ? args[0] : null;
const config = loadWorkspaceConfig({ workspaceRoot, args });
const ledgerPaths = workspaceLedgerPaths({ workspaceRoot, args, config });
const todoPath = ledgerPaths.globalTodoPath;
const apply = args.includes("--apply");
const json = args.includes("--json");

const ALLOWED_TYPES = new Set(["requirement", "bug", "supplement", "research"]);
// Same shape the Design board uses for its row IDs / demand keys.
const DESIGN_KEY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\d{4}-\d{2}-\d{2}(?:-\d{2})?$/;

function getArgValue(name, fallback = null) {
  const eq = args.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] !== undefined && !args[index + 1].startsWith("--")
    ? args[index + 1]
    : fallback;
}

function output(payload) {
  if (json) console.log(JSON.stringify(payload));
  else console.log(payload.error ?? payload.command ?? "");
}

class CliError extends Error {}

function fail(message) {
  throw new CliError(message);
}

function splitRow(line) {
  const t = line.trim();
  if (!t.startsWith("|") || !t.endsWith("|")) return [];
  return t.slice(1, -1).split("|").map((cell) => cell.trim());
}

function sectionRange(content, heading) {
  const start = content.indexOf(`## ${heading}`);
  if (start < 0) return null;
  const rest = content.slice(start + 1);
  const next = rest.search(/\n## /);
  return { start, end: next >= 0 ? start + 1 + next : content.length };
}

function commandDeliver() {
  const type = getArgValue("--type");
  if (!ALLOWED_TYPES.has(type)) fail(`--type must be one of ${[...ALLOWED_TYPES].join(", ")}; got ${type ?? "(missing)"}`);
  const designKey = getArgValue("--design-key");
  if (!designKey || !DESIGN_KEY_PATTERN.test(designKey)) {
    fail(`--design-key must match <topic>-YYYY-MM-DD; got ${designKey ?? "(missing)"}`);
  }
  const title = getArgValue("--title");
  if (!title) fail("--title is required");
  const item = getArgValue("--item", title);
  const autoClaim = args.includes("--auto-claim");
  const priority = getArgValue("--priority", "P2");
  const originalPlan = getArgValue("--original-plan");
  const requirementDesign = getArgValue("--requirement-design");

  // Ready invariants: a requirement that authorizes unattended auto-claim must carry both
  // design documents (so create_demand can synthesize goal/completion). A not-fully-designed
  // requirement cannot satisfy this, so it cannot be delivered as auto-claimable — by design.
  if (type === "requirement" && autoClaim) {
    if (!originalPlan) fail("type=requirement with --auto-claim requires --original-plan");
    if (!requirementDesign) fail("type=requirement with --auto-claim requires --requirement-design");
  }

  if (!existsSync(todoPath)) fail(`global TODO board missing: ${todoPath}`);
  const content = readFileSync(todoPath, "utf8");
  const range = sectionRange(content, "Global TODO");
  if (!range) fail("global TODO board is missing ## Global TODO");
  const lines = content.slice(range.start, range.end).split("\n");
  const headerIndex = lines.findIndex((line) => {
    const cells = splitRow(line);
    return cells.includes("ID") && cells.includes("Status");
  });
  if (headerIndex < 0) fail("global TODO board is missing the ID/Status table header");
  const header = splitRow(lines[headerIndex]);
  if (!header.includes("Auto Claim")) {
    fail("global TODO board is missing the 'Auto Claim' column; migrate the board to the unified schema first");
  }

  // Refuse duplicate ID (append-only; never restates an existing row).
  for (let i = headerIndex + 2; i < lines.length; i += 1) {
    const cells = splitRow(lines[i]);
    if (cells.length && cells[0] === designKey) fail(`ID already on the board: ${designKey}`);
  }

  const documents = [
    originalPlan ? `[plan](${originalPlan})` : null,
    requirementDesign ? `[design](${requirementDesign})` : null,
  ].filter(Boolean).join(" ");
  const cellByName = {
    "ID": designKey,
    "Status": "pending-claim",
    "Type": type,
    "Priority": priority,
    "Owner": config.designWindow,
    "Item / Goal": item,
    "Affects Retest / Dispatch": "no",
    "Dependency / Trigger": getArgValue("--dependency", "none"),
    "Recommended Window": config.controllerWindow,
    "Current Mount": "none",
    "Auto Claim": autoClaim ? "yes" : "no",
    "Documents": documents,
  };
  const newRow = `| ${header.map((name) => cellByName[name] ?? "").join(" | ")} |`;

  // Insert after the last existing data row (or right after the divider when empty).
  let insertAt = headerIndex + 2;
  for (let i = headerIndex + 2; i < lines.length; i += 1) {
    if (splitRow(lines[i]).length) insertAt = i + 1;
  }
  const newLines = [...lines.slice(0, insertAt), newRow, ...lines.slice(insertAt)];
  const newContent = content.slice(0, range.start) + newLines.join("\n") + content.slice(range.end);

  if (apply) writeFileSync(todoPath, newContent);
  output({
    ok: true,
    command: "deliver",
    wrote: apply,
    designKey,
    type,
    autoClaim,
    priority,
    row: newRow,
    board: path.relative(workspaceRoot, todoPath).split(path.sep).join("/"),
  });
}

function commandConsume() {
  const designKey = getArgValue("--design-key");
  if (!designKey) fail("--design-key is required");
  const mount = getArgValue("--mount");
  if (!mount) fail("--mount (the demand state root) is required");

  if (!existsSync(todoPath)) fail(`global TODO board missing: ${todoPath}`);
  const content = readFileSync(todoPath, "utf8");
  const range = sectionRange(content, "Global TODO");
  if (!range) fail("global TODO board is missing ## Global TODO");
  const lines = content.slice(range.start, range.end).split("\n");
  const headerIndex = lines.findIndex((line) => {
    const cells = splitRow(line);
    return cells.includes("ID") && cells.includes("Status");
  });
  if (headerIndex < 0) fail("global TODO board is missing the ID/Status table header");
  const header = splitRow(lines[headerIndex]);
  const statusIdx = header.indexOf("Status");
  const mountIdx = header.indexOf("Current Mount");

  let rowIndex = -1;
  for (let i = headerIndex + 2; i < lines.length; i += 1) {
    const cells = splitRow(lines[i]);
    if (cells.length && cells[0] === designKey) {
      rowIndex = i;
      break;
    }
  }
  if (rowIndex < 0) fail(`no TODO row with ID ${designKey}`);
  const cells = splitRow(lines[rowIndex]);
  // Consume = the delivery is taken up by a demand: mark it claimed and link the state
  // root in Current Mount. The demand's own state machine carries the execution lifecycle
  // from here, so the row is no longer a pending candidate (it will archive via the
  // existing completed-row path). A side effect of create-demand, never a standalone edit.
  cells[statusIdx] = "completed / claimed";
  if (mountIdx >= 0) cells[mountIdx] = mount;
  lines[rowIndex] = `| ${cells.join(" | ")} |`;
  const newContent = content.slice(0, range.start) + lines.join("\n") + content.slice(range.end);

  if (apply) writeFileSync(todoPath, newContent);
  output({
    ok: true,
    command: "consume",
    wrote: apply,
    designKey,
    mount,
    row: lines[rowIndex],
    board: path.relative(workspaceRoot, todoPath).split(path.sep).join("/"),
  });
}

try {
  switch (command) {
    case "deliver":
      commandDeliver();
      break;
    case "consume":
      commandConsume();
      break;
    default:
      fail(`unknown wakeflow-todo command: ${command ?? "(none)"}; use deliver or consume`);
  }
} catch (error) {
  if (!(error instanceof CliError)) throw error;
  output({ ok: false, command, error: error.message });
  process.exitCode = 1;
}
