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
      reason: state?.state === "completed"
        ? "demand is completed but not archived"
        : `demand is still ${state?.state ?? "unknown"}`,
    });
  }

  return conflicts;
}

export function activeDemandConflictSummary(conflicts = []) {
  return conflicts
    .map((item) => `${item.demandKey} (${item.state ?? "unreadable"} at ${item.stateRoot}: ${item.reason})`)
    .join("; ");
}

// Multi-active demands: the workspace runs up to maxActiveDemands unarchived
// demands side by side (workspace.config.json, top-level, host-neutral).
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
    `workspace is at its active-demand capacity (${capacity.active.length}/${capacity.max}): ${activeDemandConflictSummary(capacity.active)}. Complete and archive one, or raise maxActiveDemands in workspace.config.json.`,
  ];
}
