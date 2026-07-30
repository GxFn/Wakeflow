import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  controllerEventStateAlignment,
  futureControllerEvents,
  readControllerEventsStrict,
} from "./wakeflow-controller-events.mjs";
import { resolveStateRootFilePath } from "./wakeflow-state-paths.mjs";
import {
  pendingStateTransitionFile,
  readPendingStateTransition,
  recoverPendingStateTransition,
} from "./wakeflow-state-transition.mjs";

export const WAKEFLOW_INIT_STAGING_PREFIX = ".wakeflow-init-";

function relativePosix(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

export function isWakeflowInitStagingEntry(name) {
  return String(name ?? "").startsWith(WAKEFLOW_INIT_STAGING_PREFIX);
}

function oneLineError(error) {
  return String(error?.message ?? error).replace(/\s+/g, " ");
}

function inspectionIssue(kind, file, error) {
  return { kind, file, error: oneLineError(error) };
}

/**
 * Inspect one current demand root without mutating or recovering it.
 *
 * Projection and delivery status both consume this result so the human-facing
 * workspace status cannot report "active" while the runtime status reports
 * the same authority chain as blocked.
 */
export function inspectActiveDemandStateRoot({ workspaceRoot, stateRoot } = {}) {
  const root = path.resolve(workspaceRoot ?? process.cwd());
  const demandRoot = path.resolve(stateRoot);
  const stateRootRef = relativePosix(root, demandRoot);
  const stateFile = path.join(demandRoot, "wakeflow-state.json");
  const stateFileRef = relativePosix(root, stateFile);
  const base = {
    stateRoot: demandRoot,
    stateRootRef,
    stateFile,
    stateFileRef,
    state: null,
    progressFile: null,
    issues: [],
    missingState: false,
  };

  let rootStat;
  try {
    rootStat = lstatSync(demandRoot);
  } catch (error) {
    return {
      ...base,
      issues: [inspectionIssue(
        "unreadable-state-root",
        stateRootRef,
        `cannot inspect active demand state root: ${oneLineError(error)}`,
      )],
    };
  }
  if (rootStat.isSymbolicLink()) {
    return {
      ...base,
      issues: [inspectionIssue(
        "symlink-state-root",
        stateRootRef,
        "active demand state root is a symbolic link and was not followed",
      )],
    };
  }
  if (!rootStat.isDirectory()) {
    return {
      ...base,
      issues: [inspectionIssue(
        "invalid-state-root",
        stateRootRef,
        "active demand state root is not a directory",
      )],
    };
  }

  let stateStat;
  try {
    stateStat = lstatSync(stateFile);
  } catch (error) {
    if (error?.code === "ENOENT") return { ...base, missingState: true };
    return {
      ...base,
      issues: [inspectionIssue(
        "unreadable-state",
        stateFileRef,
        `cannot inspect active demand state: ${oneLineError(error)}`,
      )],
    };
  }
  if (stateStat.isSymbolicLink()) {
    return {
      ...base,
      issues: [inspectionIssue(
        "unreadable-state",
        stateFileRef,
        "wakeflow-state.json is a symbolic link and was not followed",
      )],
    };
  }
  if (!stateStat.isFile()) {
    return {
      ...base,
      issues: [inspectionIssue(
        "unreadable-state",
        stateFileRef,
        "wakeflow-state.json is not a regular file",
      )],
    };
  }

  let state;
  try {
    state = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch (error) {
    return {
      ...base,
      issues: [inspectionIssue("unreadable-state", stateFileRef, oneLineError(error))],
    };
  }

  const issues = [];
  const progressRef = state?.projection?.progressDoc ?? "developer-progress.md";
  let progressFile = null;
  try {
    progressFile = resolveStateRootFilePath(demandRoot, progressRef, {
      label: "progress document",
      requireExisting: true,
    });
  } catch (error) {
    issues.push(inspectionIssue(
      "invalid-progress-document",
      stateFileRef,
      `invalid progress document reference "${progressRef}": ${oneLineError(error)}`,
    ));
  }
  if (progressFile) {
    try {
      const progress = readFileSync(progressFile, "utf8");
      const startMarker = "<!-- unified-status:start -->";
      const endMarker = "<!-- unified-status:end -->";
      const startCount = (progress.match(/<!-- unified-status:start -->/g) ?? []).length;
      const endCount = (progress.match(/<!-- unified-status:end -->/g) ?? []).length;
      if (
        startCount !== 1
        || endCount !== 1
        || progress.indexOf(startMarker) >= progress.indexOf(endMarker)
      ) {
        issues.push(inspectionIssue(
          "invalid-progress-marker",
          relativePosix(root, progressFile),
          `progress document must contain exactly one unified-status start marker followed by exactly one end marker; found start=${startCount}, end=${endCount}`,
        ));
      }
    } catch (error) {
      issues.push(inspectionIssue(
        "unreadable-progress-document",
        relativePosix(root, progressFile),
        `cannot read progress document: ${oneLineError(error)}`,
      ));
    }
  }

  const projectionFile = path.join(demandRoot, "projection.json");
  const projectionFileRef = relativePosix(root, projectionFile);
  let projection = null;
  try {
    const projectionStat = lstatSync(projectionFile);
    if (projectionStat.isSymbolicLink()) {
      throw new Error("projection.json is a symbolic link and was not followed");
    }
    if (!projectionStat.isFile()) {
      throw new Error("projection.json is not a regular file");
    }
    projection = JSON.parse(readFileSync(projectionFile, "utf8"));
    if (!projection || typeof projection !== "object" || Array.isArray(projection)) {
      throw new Error("projection.json must contain a JSON object");
    }
  } catch (error) {
    issues.push(inspectionIssue(
      "invalid-projection-document",
      projectionFileRef,
      `invalid projection document: ${oneLineError(error)}`,
    ));
  }

  const eventsFile = path.join(demandRoot, "controller-events.jsonl");
  const eventsFileRef = relativePosix(root, eventsFile);
  let controllerEvents = null;
  try {
    controllerEvents = readControllerEventsStrict(eventsFile);
  } catch (error) {
    issues.push(inspectionIssue("malformed-controller-events", eventsFileRef, error));
  }

  const pendingFile = pendingStateTransitionFile(demandRoot);
  const pendingFileRef = relativePosix(root, pendingFile);
  let pendingTransition = null;
  try {
    pendingTransition = readPendingStateTransition(demandRoot);
  } catch (error) {
    issues.push(inspectionIssue(
      "inconsistent-pending-transition",
      pendingFileRef,
      `pending state transition is inconsistent: ${oneLineError(error)}`,
    ));
  }

  if (controllerEvents) {
    if (projection && state?.projection?.status === "synced") {
      if (projection.sourceRevision !== state?.revision) {
        issues.push(inspectionIssue(
          "stale-projection-revision",
          projectionFileRef,
          `projection sourceRevision ${projection.sourceRevision ?? "(missing)"} does not match active state revision ${state?.revision ?? "(missing)"}`,
        ));
      }
      const latestEventId = controllerEvents.at(-1)?.eventId ?? "none";
      if (projection.sourceEventId !== latestEventId) {
        issues.push(inspectionIssue(
          "stale-projection-event",
          projectionFileRef,
          `projection sourceEventId ${projection.sourceEventId ?? "(missing)"} does not match latest controller eventId ${latestEventId}`,
        ));
      }
    }
    try {
      const alignment = controllerEventStateAlignment(controllerEvents, state?.revision);
      if (alignment.status === "state-ahead") {
        issues.push(inspectionIssue(
          "state-ahead-of-events",
          stateFileRef,
          `active state revision ${state?.revision ?? 0} is ahead of controller event revision ${alignment.latestEventRevision}; no transition journal can account for the missing audit event`,
        ));
      }
      const futureEvents = futureControllerEvents(controllerEvents, state?.revision);
      if (futureEvents.length > 0) {
        const first = futureEvents[0];
        issues.push(inspectionIssue(
          "events-ahead-of-state",
          eventsFileRef,
          `controller event ${first.eventId ?? "(unknown)"} at revision ${first.stateRevision} is ahead of active state revision ${state?.revision ?? 0}; recover the interrupted state transition before continuing`,
        ));
      }
    } catch (error) {
      issues.push(inspectionIssue(
        "invalid-state-revision",
        stateFileRef,
        `cannot align controller events with active state: ${oneLineError(error)}`,
      ));
    }

    if (pendingTransition) {
      try {
        const recovery = recoverPendingStateTransition({
          stateRoot: demandRoot,
          state,
          events: controllerEvents,
          write: false,
        });
        if (recovery.status !== "none") {
          issues.push(inspectionIssue(
            "pending-transition-recovery-required",
            pendingFileRef,
            `pending state transition requires recovery (${recovery.reason ?? recovery.status}); status is read-only and did not recover it`,
          ));
        }
      } catch (error) {
        issues.push(inspectionIssue(
          "inconsistent-pending-transition",
          pendingFileRef,
          `pending state transition is inconsistent: ${oneLineError(error)}`,
        ));
      }
    }
  }

  return {
    ...base,
    state,
    progressFile,
    issues,
  };
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
    if (isWakeflowInitStagingEntry(entry.name)) continue;
    if (entry.isSymbolicLink()) {
      conflicts.push({
        demandKey: entry.name,
        state: null,
        stateRoot: relativePosix(root, path.join(activeDir, entry.name)),
        reason: "active demand state root is a symbolic link and was not followed",
      });
      continue;
    }
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
export function mainCheckoutOccupancy({
  workspaceRoot,
  config = {},
  repos = [],
  excludeDemandKeys = [],
} = {}) {
  if (repos.length === 0) return [];
  const repoSet = new Set(repos);
  const occupancy = [];
  for (const conflict of scanUnarchivedDemandStateRoots({
    workspaceRoot,
    currentDir: config.workspaceCurrentDir ?? ".wakeflow-active/current",
    excludeDemandKeys,
  })) {
    if (!conflict.state || conflict.state === "unknown") continue;
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
  const active = scanUnarchivedDemandStateRoots({
    workspaceRoot,
    currentDir: config.workspaceCurrentDir ?? ".wakeflow-active/current",
    excludeDemandKeys,
  });
  const max = maxActiveDemandsFor(config);
  return { active, max, atCapacity: active.length >= max };
}

export function activeDemandCapacityBlockers(capacity) {
  if (!capacity?.atCapacity) return [];
  return [
    `workspace is at its active-demand capacity (${capacity.active.length}/${capacity.max}): ${activeDemandConflictSummary(capacity.active)}. Complete and archive one, or raise maxActiveDemands in wakeflow.config.json.`,
  ];
}
