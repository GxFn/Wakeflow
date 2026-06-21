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

export function activeDemandConflictBlockers(conflicts = []) {
  if (conflicts.length === 0) return [];
  return [`workspace has unarchived demand state root(s): ${activeDemandConflictSummary(conflicts)}`];
}
