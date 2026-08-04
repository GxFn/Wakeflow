#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadWorkspaceConfig, resolveWorkspaceRoot, workspaceLedgerPaths } from "./lib/wakeflow-config.mjs";
import { isCompletedState, isPausedLikeState, normalizeStateId } from "./lib/wakeflow-status-machine.mjs";
import {
  activeDemandConflictSummary,
  activeDemandPlacementSummary,
  scanUnarchivedDemandStateRoots,
  summarizeAuthoritativeDemandState,
} from "./lib/wakeflow-active-demands.mjs";
import { parseTodoBoard } from "./lib/wakeflow-todo-table.mjs";
import { demandAuthorityReadiness } from "./lib/wakeflow-demand-authority.mjs";

const args = process.argv.slice(2);
const workspaceRoot = resolveWorkspaceRoot(args);
const json = args.includes("--json");
const write = args.includes("--write");
const afterCompletion = args.includes("--after-completion");
const sourceMode = getArgValue("--source", "all");
const targetId = getArgValue("--id", null);
const limit = Number.parseInt(getArgValue("--limit", "8"), 10);
const workspaceConfig = loadWorkspaceConfig({ workspaceRoot, args });
const ledgerPaths = workspaceLedgerPaths({ workspaceRoot, args, config: workspaceConfig });

const todoBoardPath = path.resolve(workspaceRoot, getArgValue("--todo", ledgerPaths.globalTodoPath));
const currentStatusPath = path.resolve(workspaceRoot, getArgValue("--status", ledgerPaths.workspaceCurrentStatusPath));
const outputPath = path.resolve(
  workspaceRoot,
  getArgValue("--out", ".wakeflow-local/wakeflow-intake/wakeflow-next-work.json"),
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

function slug(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "demand";
}

function todoDocumentRefs(documents) {
  const targets = [...String(documents ?? "").matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1].trim());
  return targets.map((target) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) return target;
    const boardAbsolute = path.resolve(path.dirname(todoBoardPath), target);
    const legacyWorkspaceAbsolute = path.resolve(workspaceRoot, target);
    const absolute = path.isAbsolute(target)
      ? path.resolve(target)
      : target.startsWith(".") || (existsSync(boardAbsolute) && !existsSync(legacyWorkspaceAbsolute))
        ? boardAbsolute
        : legacyWorkspaceAbsolute;
    const relative = path.relative(workspaceRoot, absolute);
    return relative.startsWith("..") || path.isAbsolute(relative)
      ? absolute
      : relative.split(path.sep).join("/");
  });
}

function todoAuthorityRefs(documents) {
  return [...String(documents ?? "").matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((match) => ({
    role: match[1].trim(),
    ref: todoDocumentRefs(`[${match[1]}](${match[2]})`)[0],
  }));
}

function todoTestDecision(value, authorityRefs) {
  const match = String(value ?? "").trim().match(/^(controller-only|real-environment|not-applicable)\s*:\s*(.+)$/u);
  if (!match) return null;
  const environmentSpecRef = authorityRefs.find((entry) => entry.role === "test-environment")?.ref;
  return {
    mode: match[1],
    summary: match[2].trim(),
    ...(match[1] === "real-environment" && environmentSpecRef ? { environmentSpecRef } : {}),
  };
}

function read(file) {
  return readFileSync(file, "utf8");
}

function normalizePriority(value) {
  const text = String(value ?? "").trim().toUpperCase();
  if (priorityRank.has(text)) {
    return text;
  }
  const prefix = text.match(/^P[0-3](?=$|[\s_-])/u)?.[0];
  return priorityRank.has(prefix) ? prefix : "P3";
}

function parseTodoCandidates(warnings) {
  if (sourceMode !== "all" && sourceMode !== "todo") {
    return [];
  }
  if (!existsSync(todoBoardPath)) {
    warnings.push(`Global TODO board missing: ${relativePosix(workspaceRoot, todoBoardPath)}`);
    return [];
  }

  const parsed = parseTodoBoard(read(todoBoardPath));
  if (!parsed.range || parsed.headerIndex === undefined) {
    warnings.push(`${parsed.issues[0]}.`);
    return [];
  }
  if (parsed.issues.length > 0) warnings.push(...parsed.issues);

  return parsed.rows
    .map((row) => row.value)
    .map((entry) => {
      const status = entry["Status"];
      const stateId = normalizeStateId(status);
      const recommendedWindow = entry["Recommended Window"] ?? "";
      const statusText = `${status} ${entry["Owner"] ?? ""} ${recommendedWindow}`;
      const blockers = [];
      if (isCompletedState(status)) {
        blockers.push("already completed");
      }
      if (isPausedLikeState(status)) {
        blockers.push(`status is not claimable: ${status}`);
      }
      if (statusText.includes(`${workspaceConfig.controllerWindow}-Aux`) || /Aux claimed|Aux progressing/.test(statusText)) {
        blockers.push("owned by Aux controller");
      }
      if (!recommendedWindow.includes(workspaceConfig.controllerWindow)) {
        blockers.push(`recommended window is ${recommendedWindow || "missing"}`);
      }
      if (!/(pending automation|pending-schedule|candidate|independent track|pending P\d|pending Stage|pending-claim|pending-follow-up)/i.test(status)) {
        blockers.push("status is not an explicit next-work candidate");
      }
      // Unified-surface delivery property: an immutable yes/no the Design deliver sets
      // once. yes = Design+user authorized unattended auto-claim; absent/no = controller
      // confirms first. Mirrors the design-row controllerClaimable computation.
      const autoClaim = /^yes$/i.test((entry["Auto Claim"] ?? "").trim());
      const authorityRefs = todoAuthorityRefs(entry["Documents"] ?? "");
      const structuredTestDecision = todoTestDecision(entry["Testing Decision"] ?? "", authorityRefs);
      const demandAuthority = structuredTestDecision
        ? {
            schemaVersion: 1,
            artifactKind: "wakeflow-demand-authority",
            demandKey: entry.ID,
            demandType: entry["Type"],
            entryMode: "design-delivery",
            authorityRefs,
            testDecision: structuredTestDecision,
          }
        : null;
      const authorityReadiness = demandAuthorityReadiness(demandAuthority, {
        workspaceRoot,
        demandKey: entry.ID,
        demandType: entry["Type"],
        entryMode: "design-delivery",
      });
      if (!authorityReadiness.ready) {
        blockers.push(`demand authority is incomplete: ${authorityReadiness.errors.join("; ")}`);
      }
      return {
        source: "todo",
        id: entry.ID,
        title: entry["Item / Goal"],
        status,
        stateId,
        type: entry["Type"],
        priority: normalizePriority(entry["Priority"]),
        owner: entry["Owner"],
        effect: entry["Affects Retest / Dispatch"],
        dependency: entry["Dependency / Trigger"],
        recommendedWindow,
        mount: entry["Current Mount"],
        documents: entry["Documents"] ?? "",
        documentRefs: todoDocumentRefs(entry["Documents"] ?? ""),
        testDecision: entry["Testing Decision"] ?? "",
        demandAuthority: authorityReadiness.authority ?? demandAuthority,
        demandAuthorityReadiness: {
          ready: authorityReadiness.ready,
          errors: authorityReadiness.errors,
          digest: authorityReadiness.digest,
        },
        autoClaim,
        blockers,
        eligible: blockers.length === 0,
        controllerClaimable: autoClaim && blockers.length === 0,
      };
    });
}

function currentStatus(activeDemands) {
  const authority = summarizeAuthoritativeDemandState(activeDemands);
  let projectionStatus = null;
  let projectionIssue = null;
  if (existsSync(currentStatusPath)) {
    const content = read(currentStatusPath);
    projectionStatus = content.match(/^Status:\s*(.+?)\s*$/m)?.[1]?.trim() ?? null;
    if (!projectionStatus) projectionIssue = "current status projection is missing its Status line";
  } else {
    projectionIssue = "current status projection is missing";
  }
  return {
    path: relativePosix(workspaceRoot, currentStatusPath),
    status: authority.status,
    stateId: authority.stateId,
    source: "wakeflow-state-roots",
    eligibleForAfterCompletion: authority.eligibleForAfterCompletion,
    issue: authority.issues[0] ?? null,
    authorityIssues: authority.issues,
    projection: {
      status: projectionStatus,
      stateId: normalizeStateId(projectionStatus),
      issue: projectionIssue,
    },
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

function applyWorkspaceDemandGuard(candidate, conflicts, placementSummary) {
  // A candidate whose OWN demand already has an unarchived state root is in
  // flight, not claimable — re-claiming it would double-create the demand.
  const own = conflicts.find((item) => item.demandKey === candidate.id);
  if (own) {
    return {
      ...candidate,
      blockers: [
        ...(candidate.blockers ?? []),
        `demand ${candidate.id} already has an unarchived state root (${own.stateRoot}, ${own.state}); it is in flight — continue it there instead of re-claiming`,
      ],
      eligible: false,
      placementStatus: "identity-active",
      ...(candidate.source === "design" ? { controllerClaimable: false } : {}),
    };
  }
  if (!placementSummary.authoritySafe) {
    return {
      ...candidate,
      blockers: [
        ...(candidate.blockers ?? []),
        `active demand authority is unreadable: ${activeDemandConflictSummary(placementSummary.unreadable)}`,
      ],
      eligible: false,
      placementStatus: "authority-blocked",
      ...(candidate.source === "design" ? { controllerClaimable: false } : {}),
    };
  }
  if (!placementSummary.mainlineBusy) {
    return { ...candidate, placementStatus: "mainline-ready" };
  }
  return {
    ...candidate,
    blockers: [
      ...(candidate.blockers ?? []),
      `mainline is busy: ${activeDemandConflictSummary(placementSummary.mainline)}`,
    ],
    eligible: false,
    placementStatus: "waiting-mainline",
    ...(candidate.source === "design" ? { controllerClaimable: false } : {}),
  };
}

const issues = [];
const warnings = [];
const workspaceDemandConflicts = scanUnarchivedDemandStateRoots({
  workspaceRoot,
  currentDir: ledgerPaths.workspaceCurrentDir,
});
const status = currentStatus(workspaceDemandConflicts);
issues.push(...(status.authorityIssues ?? []));
if (status.projection.issue) warnings.push(status.projection.issue);
if (status.projection.status && normalizeStateId(status.projection.status) !== status.stateId) {
  warnings.push(`current status projection is stale (${status.projection.status}); authoritative state roots report ${status.status}`);
}
if (afterCompletion && !status.eligibleForAfterCompletion) {
  issues.push(
    `--after-completion requires current state completed or idle, got ${status.stateId || "missing"}`,
  );
}
if (!["all", "todo"].includes(sourceMode)) {
  issues.push(`unsupported --source ${sourceMode}; use all or todo`);
}
warnings.push(...(workspaceConfig.configMigrationWarnings ?? []));
const placementSummary = activeDemandPlacementSummary(workspaceDemandConflicts);
if (placementSummary.mainlineBusy) {
  warnings.push(`mainline is busy: ${activeDemandConflictSummary(placementSummary.mainline)}; ordinary candidates remain visible as waiting until the mainline demand archives`);
}

const todoCandidates = parseTodoCandidates(warnings)
  .map((candidate) => applyWorkspaceDemandGuard(candidate, workspaceDemandConflicts, placementSummary));
const allCandidates = [...todoCandidates].sort(compareCandidates);
const matchedCandidates = targetId ? allCandidates.filter((candidate) => candidate.id === targetId) : allCandidates;
if (targetId && matchedCandidates.length === 0) {
  issues.push(`target candidate not found: ${targetId}`);
}
if (targetId) {
  for (const candidate of matchedCandidates.filter((item) => (
    !item.eligible && item.placementStatus !== "waiting-mainline"
  ))) {
    issues.push(`${targetId} is not claimable: ${candidate.blockers.join("; ") || "unknown blocker"}`);
  }
}
const candidates = matchedCandidates
  .filter((candidate) => candidate.eligible)
  .sort(compareCandidates)
  .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 8);
const waitingCandidates = matchedCandidates
  .filter((candidate) => candidate.placementStatus === "waiting-mainline")
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
  workspaceDemandConflicts,
  // Active roots are observation, not a numeric capacity gate.
  activeDemands: workspaceDemandConflicts.map((item) => ({
    demandKey: item.demandKey,
    state: item.state,
    stateRoot: item.stateRoot,
    controllerWindow: item.controllerWindow,
    executionPlacement: item.executionPlacement,
  })),
  placement: {
    mainlineBusy: placementSummary.mainlineBusy,
    authoritySafe: placementSummary.authoritySafe,
    activeMainlineDemandKeys: placementSummary.mainline.map((item) => item.demandKey),
    activeIsolatedDemandKeys: placementSummary.isolated.map((item) => item.demandKey),
  },
  candidateCount: candidates.length,
  candidates,
  waitingCandidateCount: waitingCandidates.length,
  waitingCandidates,
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
        : waitingCandidates.length > 0
          ? "Ordinary candidates are waiting for the mainline lane. Continue the active mainline demand, or request an isolated pod only with explicit user authorization."
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
