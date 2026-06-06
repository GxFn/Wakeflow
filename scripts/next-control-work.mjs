#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadWorkspaceConfig, workspaceLedgerPaths } from "./lib/workspace-config.mjs";
import { isCompletedState, isPausedLikeState, normalizeStateId } from "./lib/status-machine.mjs";

const workspaceRoot = process.cwd();
const args = process.argv.slice(2);
const json = args.includes("--json");
const write = args.includes("--write");
const afterCompletion = args.includes("--after-completion");
const sourceMode = getArgValue("--source", "all");
const targetId = getArgValue("--id", null);
const limit = Number.parseInt(getArgValue("--limit", "8"), 10);
const workspaceConfig = loadWorkspaceConfig({ workspaceRoot, args });
const ledgerPaths = workspaceLedgerPaths({ workspaceRoot, args, config: workspaceConfig });

const designBoardPath = path.resolve(workspaceRoot, getArgValue("--board", workspaceConfig.designHandoffBoard));
const todoBoardPath = path.resolve(workspaceRoot, getArgValue("--todo", ledgerPaths.globalTodoPath));
const currentStatusPath = path.resolve(workspaceRoot, getArgValue("--status", ledgerPaths.workspaceCurrentStatusPath));
const outputPath = path.resolve(
  workspaceRoot,
  getArgValue("--out", ".workspace-local/control-intake/next-control-work.json"),
);

const priorityRank = new Map([
  ["P0", 0],
  ["P1", 1],
  ["P2", 2],
  ["P3", 3],
]);
const relationRank = new Map([
  ["blocks-current", 0],
  ["interrupts-current", 1],
  ["next-mainline", 2],
  ["after-current", 3],
  ["todo-candidate", 4],
  ["none", 5],
]);

function getArgValue(name, fallback) {
  const eq = args.find((arg) => arg.startsWith(`${name}=`));
  if (eq) {
    return eq.slice(name.length + 1);
  }
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")) {
    return args[index + 1];
  }
  return fallback;
}

function relativePosix(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

function read(file) {
  return readFileSync(file, "utf8");
}

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

function tableRows(section) {
  return section
    .split("\n")
    .map(splitMarkdownRow)
    .filter((row) => row.length > 0 && !row.every((cell) => /^:?-{3,}:?$/.test(cell)));
}

function sectionContent(content, heading) {
  const start = content.indexOf(`## ${heading}`);
  if (start < 0) {
    return "";
  }
  const rest = content.slice(start);
  const next = rest.slice(1).search(/\n## /);
  return next >= 0 ? rest.slice(0, next + 1) : rest;
}

function rowObject(header, row) {
  const out = {};
  for (const [index, column] of header.entries()) {
    out[column] = row[index] ?? "";
  }
  return out;
}

function normalizePriority(value) {
  const text = String(value ?? "").trim().toUpperCase();
  if (priorityRank.has(text)) {
    return text;
  }
  const prefix = text.match(/^P[0-3](?=$|[\s_-])/u)?.[0];
  return priorityRank.has(prefix) ? prefix : "P3";
}

function normalizeEnumValue(value) {
  return String(value ?? "").trim().toLowerCase();
}

function hasNegativeUserConfirmation(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return true;
  }
  return /(未确认|待确认|没有确认|无确认|not confirmed|unconfirmed|pending confirmation)/i.test(text);
}

function hasPositiveUserConfirmation(value) {
  const text = String(value ?? "").trim();
  if (!text || hasNegativeUserConfirmation(text)) {
    return false;
  }
  return /(用户[^|。；;]*确认|已[^|。；;]*确认|yes|confirmed)/i.test(text);
}

function userConfirmationStatus(entry) {
  const enumValue = normalizeEnumValue(entry["用户确认状态"]);
  if (enumValue) {
    return enumValue;
  }
  return hasPositiveUserConfirmation(entry["用户确认"]) ? "confirmed" : "unconfirmed";
}

function firstLink(cell) {
  const match = String(cell ?? "").match(/\[[^\]]+]\(([^)]+)\)/);
  return match?.[1] ?? null;
}

function stripLinkTarget(rawTarget) {
  let clean = String(rawTarget ?? "").trim();
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
    // Keep raw target if it is not URI-encoded.
  }
  return clean;
}

function isExternalTarget(target) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || String(target ?? "").trim().startsWith("#");
}

function linkedDoc(entry, column, boardPath) {
  const rawTarget = firstLink(entry[column]);
  if (!rawTarget) {
    return { path: null, exists: null, external: false, optionalMissing: true };
  }
  const target = stripLinkTarget(rawTarget);
  if (!target || isExternalTarget(target)) {
    return { path: rawTarget, exists: false, external: true };
  }
  const absolutePath = path.resolve(path.dirname(boardPath), target);
  return {
    path: relativePosix(workspaceRoot, absolutePath),
    exists: existsSync(absolutePath),
    external: false,
  };
}

function parseDesignCandidates(issues, warnings) {
  if (sourceMode !== "all" && sourceMode !== "design") {
    return [];
  }
  if (!existsSync(designBoardPath)) {
    warnings.push(`Design handoff board missing: ${relativePosix(workspaceRoot, designBoardPath)}`);
    return [];
  }

  const content = read(designBoardPath);
  const section = sectionContent(content, "Handoff 清单");
  const rows = tableRows(section);
  const header = rows.find((row) => row.includes("ID") && row.includes("状态"));
  if (!header) {
    issues.push("Design handoff board is missing a table headed by ID / 状态.");
    return [];
  }

  return rows
    .filter((row) => row !== header)
    .filter((row) => row.some((cell) => cell && !/^:?-{3,}:?$/.test(cell)))
    .map((row) => rowObject(header, row))
    .filter((entry) => entry.ID && entry["状态"] === "ready-for-workspace")
    .map((entry) => {
      const confirmation = userConfirmationStatus(entry);
      const relation = normalizeEnumValue(entry["主线关系状态"]) || "todo-candidate";
      const priority = normalizePriority(entry["优先级枚举"] || entry["优先级"]);
      const docs = {
        originalPlan: linkedDoc(entry, "原始计划", designBoardPath),
        requirementDesign: linkedDoc(entry, "需求设计", designBoardPath),
        handoff: linkedDoc(entry, "Handoff", designBoardPath),
      };
      const blockers = [];
      if (!["confirmed", "not-required"].includes(confirmation)) {
        blockers.push(`user confirmation is ${confirmation}`);
      }
      for (const name of ["originalPlan", "requirementDesign"]) {
        const doc = docs[name];
        if (!doc || !doc.exists) {
          blockers.push(`${name} document is missing`);
        }
      }
      if (docs.handoff?.exists === false) {
        blockers.push("handoff document is missing");
      }
      return {
        source: "design",
        id: entry.ID,
        title: entry["标题"],
        status: entry["状态"],
        priority,
        relation,
        recommendedWindow: workspaceConfig.controlWindow,
        nextStep: entry["下一步"],
        suggestedTodo: entry["建议 TODO"],
        documents: docs,
        blockers,
        eligible: blockers.length === 0,
      };
    });
}

function parseTodoCandidates(warnings) {
  if (sourceMode !== "all" && sourceMode !== "todo") {
    return [];
  }
  if (!existsSync(todoBoardPath)) {
    warnings.push(`Global TODO board missing: ${relativePosix(workspaceRoot, todoBoardPath)}`);
    return [];
  }

  const content = read(todoBoardPath);
  const section = sectionContent(content, "全局 TODO");
  const rows = tableRows(section);
  const header = rows.find((row) => row.includes("ID") && row.includes("状态"));
  if (!header) {
    warnings.push("Global TODO board is missing a table headed by ID / 状态.");
    return [];
  }

  return rows
    .filter((row) => row !== header)
    .filter((row) => row.some((cell) => cell && !/^:?-{3,}:?$/.test(cell)))
    .map((row) => rowObject(header, row))
    .filter((entry) => entry.ID)
    .map((entry) => {
      const status = entry["状态"];
      const stateId = normalizeStateId(status);
      const recommendedWindow = entry["推荐窗口"] ?? "";
      const statusText = `${status} ${entry["归属"] ?? ""} ${recommendedWindow}`;
      const blockers = [];
      if (isCompletedState(status)) {
        blockers.push("already completed");
      }
      if (isPausedLikeState(status)) {
        blockers.push(`status is not claimable: ${status}`);
      }
      if (statusText.includes(`${workspaceConfig.controlWindow}-Aux`) || /Aux 已领取|Aux 推进/.test(statusText)) {
        blockers.push("owned by Aux controller");
      }
      if (!recommendedWindow.includes(workspaceConfig.controlWindow)) {
        blockers.push(`recommended window is ${recommendedWindow || "missing"}`);
      }
      if (!/(待自动化|待排期|候选|独立线路|待 P\d|待 Stage|待领取|待后续)/.test(status)) {
        blockers.push("status is not an explicit next-work candidate");
      }
      return {
        source: "todo",
        id: entry.ID,
        title: entry["事项 / 目标"],
        status,
        stateId,
        type: entry["类型"],
        priority: normalizePriority(entry["优先级"]),
        owner: entry["归属"],
        effect: entry["影响复测 / 派发"],
        dependency: entry["依赖 / 触发"],
        recommendedWindow,
        mount: entry["当前挂载"],
        blockers,
        eligible: blockers.length === 0,
      };
    });
}

function currentStatus() {
  if (!existsSync(currentStatusPath)) {
    return {
      path: relativePosix(workspaceRoot, currentStatusPath),
      status: null,
      primaryStatus: null,
      eligibleForAfterCompletion: false,
      issue: "current status file is missing",
    };
  }
  const content = read(currentStatusPath);
  const match = content.match(/^状态[：:]\s*(.+?)\s*$/m);
  const status = match?.[1]?.trim() ?? null;
  const stateId = normalizeStateId(status);
  return {
    path: relativePosix(workspaceRoot, currentStatusPath),
    status,
    stateId,
    eligibleForAfterCompletion: ["completed", "idle"].includes(stateId),
    issue: status ? null : "current status line is missing",
  };
}

function candidateSortKey(candidate) {
  return [
    priorityRank.get(candidate.priority) ?? 99,
    relationRank.get(candidate.relation ?? "todo-candidate") ?? 50,
    candidate.source === "design" ? 0 : 1,
    candidate.id,
  ];
}

function compareCandidates(left, right) {
  const a = candidateSortKey(left);
  const b = candidateSortKey(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] < b[index]) {
      return -1;
    }
    if (a[index] > b[index]) {
      return 1;
    }
  }
  return 0;
}

const issues = [];
const warnings = [];
const status = currentStatus();
if (status.issue) {
  issues.push(status.issue);
}
if (afterCompletion && !status.eligibleForAfterCompletion) {
  issues.push(
    `--after-completion requires current state completed or idle, got ${status.stateId || "missing"}`,
  );
}
if (!["all", "design", "todo"].includes(sourceMode)) {
  issues.push(`unsupported --source ${sourceMode}; use all, design, or todo`);
}

const designCandidates = parseDesignCandidates(issues, warnings);
const todoCandidates = parseTodoCandidates(warnings);
const allCandidates = [...designCandidates, ...todoCandidates].sort(compareCandidates);
const matchedCandidates = targetId ? allCandidates.filter((candidate) => candidate.id === targetId) : allCandidates;
if (targetId && matchedCandidates.length === 0) {
  issues.push(`target candidate not found: ${targetId}`);
}
if (targetId) {
  for (const candidate of matchedCandidates.filter((item) => !item.eligible)) {
    issues.push(`${targetId} is not claimable: ${candidate.blockers.join("; ") || "unknown blocker"}`);
  }
}
const candidates = matchedCandidates
  .filter((candidate) => candidate.eligible)
  .sort(compareCandidates)
  .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 8);
const recommended = candidates[0] ?? null;
const autoClaimable = issues.length === 0 && candidates.length === 1 && Boolean(recommended);

const result = {
  ok: issues.length === 0,
  scriptComplete: true,
  sourceMode,
  afterCompletion,
  targetId,
  currentStatus: status,
  candidateCount: candidates.length,
  candidates,
  recommended,
  autoClaimable,
  wrote: false,
  output: write ? relativePosix(workspaceRoot, outputPath) : null,
  issues,
  warnings,
  agentNext: issues.length > 0
    ? "Resolve the blocking intake issues before claiming or dispatching the next requirement."
    : autoClaimable
      ? "Total control may claim the single eligible candidate by creating or updating a current plan; scripts still must not accept evidence or dispatch without the plan gate."
      : candidates.length > 1
        ? "Multiple eligible candidates exist; total control must choose one before creating a current plan or continuing unattended automation."
        : "No eligible Design/TODO candidate was found; stop the unattended loop or wait for a new handoff/TODO.",
};

if (write) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  result.wrote = true;
}

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log("Next control work scan complete.");
  console.log(`Current status: ${status.status ?? "missing"}`);
  console.log(`Eligible candidates: ${candidates.length}`);
  if (recommended) {
    console.log(`Recommended: [${recommended.source}] ${recommended.id} (${recommended.priority})`);
  }
  if (write) {
    console.log(`Output: ${relativePosix(workspaceRoot, outputPath)}`);
  }
  for (const issue of issues) {
    console.log(`- issue: ${issue}`);
  }
  for (const warning of warnings) {
    console.log(`- warning: ${warning}`);
  }
  console.log(`Agent next: ${result.agentNext}`);
}

if (!result.ok) {
  process.exitCode = 1;
}
