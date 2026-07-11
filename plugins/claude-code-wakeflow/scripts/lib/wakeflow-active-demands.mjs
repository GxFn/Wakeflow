import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function relativePosix(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

export function scanUnarchivedDemandStateRoots({
  workspaceRoot,
  currentDir = ".wakeflow-active/current",
  excludeDemandKeys = [],
} = {}) {
  const root = path.resolve(workspaceRoot ?? process.cwd());
  const activeDir = path.resolve(root, currentDir);
  const excluded = new Set(excludeDemandKeys.filter(Boolean));
  if (!existsSync(activeDir)) {
    return [];
  }

  const conflicts = [];
  for (const entry of readdirSync(activeDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const stateRoot = path.join(activeDir, entry.name);
    const stateFile = path.join(stateRoot, "wakeflow-state.json");
    if (!existsSync(stateFile)) continue;

    let state;
    try {
      state = JSON.parse(readFileSync(stateFile, "utf8"));
    } catch (error) {
      conflicts.push({
        demandKey: entry.name,
        state: null,
        stateRoot: relativePosix(root, stateRoot),
        reason: `unreadable state root: ${error.message}`,
      });
      continue;
    }

    const demandKey = state?.demandKey ?? entry.name;
    if (excluded.has(demandKey)) continue;
    if (state?.state === "archived") continue;

    conflicts.push({
      demandKey,
      state: state?.state ?? "unknown",
      stateRoot: relativePosix(root, stateRoot),
      controllerWindow: state?.controllerWindow ?? null,
      executionPlacement: demandExecutionPlacement(state),
      reason: state?.state === "completed"
        ? "demand is completed but not archived"
        : `demand is still ${state?.state ?? "unknown"}`,
    });
  }

  return conflicts;
}

export function demandExecutionPlacement(state = {}) {
  if (state?.executionPlacement?.mode === "main") {
    return { mode: "main", podId: null, source: "state" };
  }
  if (state?.executionPlacement?.mode === "isolated") {
    return {
      mode: "isolated",
      podId: state.executionPlacement.podId || state.demandKey || null,
      source: "state",
    };
  }
  const legacyIsolated = String(state?.controllerWindow || "").includes("__");
  return legacyIsolated
    ? { mode: "isolated", podId: state.demandKey || null, source: "legacy-controller-window" }
    : { mode: "main", podId: null, source: "legacy-default" };
}

// Which of these plain repo windows are occupied by an UNARCHIVED demand's
// tasks on the MAIN checkout (pod-0 work)? Streams only warn against other
// streams; without this, a new pod opening onto a repo the incumbent demand
// is editing in place gets no merge-conflict foresight at all.
export function mainCheckoutOccupancy({ workspaceRoot, repos = [], excludeDemandKeys = [] } = {}) {
  if (repos.length === 0) return [];
  const repoSet = new Set(repos);
  const occupancy = [];
  for (const conflict of scanUnarchivedDemandStateRoots({ workspaceRoot, excludeDemandKeys })) {
    let state;
    try {
      state = JSON.parse(readFileSync(path.resolve(workspaceRoot, conflict.stateRoot, "wakeflow-state.json"), "utf8"));
    } catch {
      continue;
    }
    if (demandExecutionPlacement(state).mode !== "main") continue;
    for (const task of state?.targetTasks ?? []) {
      if (repoSet.has(task.targetWindow)) {
        occupancy.push({ repo: task.targetWindow, occupiedBy: state.demandKey ?? conflict.demandKey, taskStatus: task.status });
      }
    }
  }
  return occupancy;
}

export function activeDemandConflictSummary(conflicts = []) {
  return conflicts
    .map((item) => `${item.demandKey} (${item.state ?? "unreadable"} at ${item.stateRoot}: ${item.reason})`)
    .join("; ");
}

export function summarizeAuthoritativeDemandState(activeDemands = []) {
  const unreadable = activeDemands.filter((item) => !item.state || item.state === "unknown");
  if (unreadable.length > 0) {
    return {
      stateId: null,
      status: null,
      eligibleForAfterCompletion: false,
      issues: unreadable.map((item) => `authoritative demand state is unreadable: ${item.demandKey} at ${item.stateRoot}`),
    };
  }
  if (activeDemands.length === 0) {
    return { stateId: "idle", status: "idle", eligibleForAfterCompletion: true, issues: [] };
  }
  if (activeDemands.every((item) => item.state === "completed")) {
    return { stateId: "completed", status: "completed", eligibleForAfterCompletion: true, issues: [] };
  }
  if (activeDemands.length === 1) {
    return {
      stateId: activeDemands[0].state,
      status: activeDemands[0].state,
      eligibleForAfterCompletion: false,
      issues: [],
    };
  }
  return { stateId: "active", status: "active", eligibleForAfterCompletion: false, issues: [] };
}

// Multi-active demands: the workspace runs up to maxActiveDemands unarchived
// demands side by side (wakeflow.config.json, top-level, host-neutral).
// Unreadable and completed-but-not-archived roots still occupy capacity —
// archiving is the only way a demand stops counting.
export const DEFAULT_MAX_ACTIVE_DEMANDS = 2;

export function maxActiveDemandsFor(config = {}) {
  const value = config?.maxActiveDemands;
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_ACTIVE_DEMANDS;
}

export function activeDemandCapacity({ workspaceRoot, config = {}, excludeDemandKeys = [] } = {}) {
  const active = scanUnarchivedDemandStateRoots({ workspaceRoot, excludeDemandKeys });
  const max = maxActiveDemandsFor(config);
  return { active, max, atCapacity: active.length >= max };
}

export function activeDemandCapacityBlockers(capacity) {
  if (!capacity?.atCapacity) return [];
  return [
    `workspace is at its active-demand capacity (${capacity.active.length}/${capacity.max}): ${activeDemandConflictSummary(capacity.active)}. Complete and archive one, or raise maxActiveDemands in wakeflow.config.json.`,
  ];
}
