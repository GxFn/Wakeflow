#!/usr/bin/env node

// Wakeflow unified-surface TODO writer.
//
// `deliver` appends one Design-ready item (requirement / bug / supplement / research)
// as a `pending-claim` row on the global TODO board. It is the ONE controller-surface
// write Design may perform: append-only — it never edits or re-statuses an existing row,
// and it sets the immutable `Auto Claim` delivery property exactly once. The controller
// then reads the row (wakeflow-next-work) and claims it; Design tracks no further status.

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadWorkspaceConfig, resolveWorkspaceRoot, workspaceLedgerPaths } from "./lib/wakeflow-config.mjs";
import { WakeflowStateLockTimeoutError, withFileLock } from "./lib/wakeflow-state-lock.mjs";
import {
  formatTodoRow,
  normalizeTodoBoard,
  parseTodoBoard,
  replaceTodoSection,
  todoBoardLockPath,
} from "./lib/wakeflow-todo-table.mjs";
import {
  assertDemandAuthorityReady,
  normalizeDemandAuthority,
} from "./lib/wakeflow-demand-authority.mjs";

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

function parseJsonArg(name) {
  const raw = getArgValue(name);
  if (!raw) fail(`${name} is required`);
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`${name} must be valid JSON: ${error.message}`);
  }
}

function output(payload) {
  if (json) console.log(JSON.stringify(payload));
  else console.log(payload.error ?? payload.command ?? "");
}

class CliError extends Error {}

function fail(message) {
  throw new CliError(message);
}

function atomicWrite(file, content) {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temp, content);
    renameSync(temp, file);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
}

function boardRelativeDocumentRef(value, { existingBoardLink = false } = {}) {
  const text = String(value ?? "").trim();
  if (!text || /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(text)) return text;
  const boardAbsolute = path.resolve(path.dirname(todoPath), text);
  const workspaceAbsolute = path.resolve(workspaceRoot, text);
  const absolute = path.isAbsolute(text)
    ? path.resolve(text)
    : existingBoardLink && (text.startsWith(".") || (existsSync(boardAbsolute) && !existsSync(workspaceAbsolute)))
      ? boardAbsolute
      : workspaceAbsolute;
  return path.relative(path.dirname(todoPath), absolute).split(path.sep).join("/") || ".";
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
  let demandAuthority;
  try {
    demandAuthority = normalizeDemandAuthority(parseJsonArg("--demand-authority"), {
      demandKey: designKey,
      entryMode: "design-delivery",
    });
    demandAuthority = assertDemandAuthorityReady(demandAuthority, {
      workspaceRoot,
      demandKey: designKey,
      demandType: type,
      entryMode: "design-delivery",
    }).authority;
  } catch (error) {
    if (error instanceof CliError) throw error;
    fail(error.message);
  }
  if (demandAuthority.demandType !== type) {
    fail(`--type ${type} does not match demandAuthority.demandType ${demandAuthority.demandType}`);
  }
  if (demandAuthority.entryMode !== "design-delivery") {
    fail("Design TODO delivery requires demandAuthority.entryMode=design-delivery");
  }
  if (originalPlan && !demandAuthority.authorityRefs.some((entry) => entry.role === "original-plan" && entry.ref === originalPlan)) {
    fail("--original-plan must match the role=original-plan ref in demandAuthority");
  }
  if (requirementDesign && !demandAuthority.authorityRefs.some((entry) => entry.role === "requirement-design" && entry.ref === requirementDesign)) {
    fail("--requirement-design must match the role=requirement-design ref in demandAuthority");
  }

  if (!existsSync(todoPath)) fail(`global TODO board missing: ${todoPath}`);
  const content = readFileSync(todoPath, "utf8");
  const initial = parseTodoBoard(content);
  if (!initial.range || initial.headerIndex === undefined) fail(initial.issues[0]);
  const normalized = normalizeTodoBoard(content, {
    mapCell: ({ column, value }) => column === "Documents" && !initial.canonical
      ? value.replace(/\]\(([^)]+)\)/g, (_match, target) => `](${boardRelativeDocumentRef(target, { existingBoardLink: true })})`)
      : value,
  });
  if (!normalized.ok) fail(normalized.issues[0]);
  const lines = [...normalized.lines];

  // Refuse duplicate ID (append-only; never restates an existing row).
  if (normalized.rows.some((row) => row.value.ID === designKey)) fail(`ID already on the board: ${designKey}`);

  const documents = [
    ...demandAuthority.authorityRefs.map(({ role, ref }) => `[${role}](${boardRelativeDocumentRef(ref)})`),
  ].filter(Boolean).join(" ");
  const testingDecision = `${demandAuthority.testDecision.mode}: ${demandAuthority.testDecision.summary}`;
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
    "Testing Decision": testingDecision,
    "Documents": documents,
  };
  const newRow = formatTodoRow(cellByName);

  // Insert after the last existing data row (or right after the divider when empty).
  const insertAt = normalized.rows.length > 0
    ? normalized.rows.at(-1).lineIndex + 1
    : normalized.dividerIndex + 1;
  const newLines = [...lines.slice(0, insertAt), newRow, ...lines.slice(insertAt)];
  const newContent = replaceTodoSection(normalized.content, normalized, newLines);

  if (apply) atomicWrite(todoPath, newContent);
  output({
    ok: true,
    command: "deliver",
    wrote: apply,
    designKey,
    type,
    autoClaim,
    priority,
    demandAuthority,
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
  const normalized = normalizeTodoBoard(content);
  if (!normalized.ok) fail(normalized.issues[0]);
  const record = normalized.rows.find((row) => row.value.ID === designKey);
  if (!record) fail(`no TODO row with ID ${designKey}`);
  const lines = [...normalized.lines];
  // Consume = the delivery is taken up by a demand: mark it claimed and link the state
  // root in Current Mount. The demand's own state machine carries the execution lifecycle
  // from here, so the row is no longer a pending candidate (it will archive via the
  // existing completed-row path). A side effect of create-demand, never a standalone edit.
  const value = {
    ...record.value,
    Status: "completed / claimed",
    "Current Mount": mount,
  };
  lines[record.lineIndex] = formatTodoRow(value);
  const newContent = replaceTodoSection(normalized.content, normalized, lines);

  if (apply) atomicWrite(todoPath, newContent);
  output({
    ok: true,
    command: "consume",
    wrote: apply,
    designKey,
    mount,
    row: lines[record.lineIndex],
    board: path.relative(workspaceRoot, todoPath).split(path.sep).join("/"),
  });
}

// H-9: the board is a lockless markdown read-modify-write. With demand pods,
// multiple controllers deliver/consume concurrently — serialize the WHOLE
// command (read inside the lock) or parallel writers drop each other's rows.
function withBoardLock(fn) {
  try {
    mkdirSync(path.dirname(todoPath), { recursive: true });
    withFileLock(todoBoardLockPath(todoPath), fn);
  } catch (error) {
    if (error instanceof WakeflowStateLockTimeoutError) fail(error.message);
    throw error;
  }
}

try {
  switch (command) {
    case "deliver":
      withBoardLock(commandDeliver);
      break;
    case "consume":
      withBoardLock(commandConsume);
      break;
    default:
      fail(`unknown wakeflow-todo command: ${command ?? "(none)"}; use deliver or consume`);
  }
} catch (error) {
  if (!(error instanceof CliError)) throw error;
  output({ ok: false, command, error: error.message });
  process.exitCode = 1;
}
