import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const schemaVersion = 1;

export function nowIso() {
  return new Date().toISOString();
}

export function slug(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

export function workspaceRoot(value = process.cwd()) {
  return path.resolve(value);
}

export function activeRoot(root) {
  return path.join(root, ".wakeflow", "active");
}

export function localRoot(root) {
  return path.join(root, ".wakeflow", "local");
}

export function ensureInside(root, file, label = "path") {
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(file);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside workspace root: ${resolvedFile}`);
  }
  return resolvedFile;
}

export function atomicWrite(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temp, content);
    renameSync(temp, file);
  } catch (error) {
    if (existsSync(temp)) rmSync(temp, { force: true });
    throw error;
  }
}

export function writeJson(file, value) {
  atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson(file, label = "JSON") {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Invalid ${label} at ${file}: ${error.message}`);
  }
}

export function appendJsonLine(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const previous = existsSync(file) ? readFileSync(file, "utf8").trimEnd() : "";
  atomicWrite(file, `${previous ? `${previous}\n` : ""}${JSON.stringify(value)}\n`);
}

export function demandStateRoot(root, demandKey) {
  return path.join(activeRoot(root), slug(demandKey));
}

export function resolveStateRoot(root, stateRoot) {
  if (!stateRoot) throw new Error("stateRoot is required.");
  const resolved = path.isAbsolute(stateRoot) ? path.resolve(stateRoot) : path.resolve(root, stateRoot);
  ensureInside(root, resolved, "stateRoot");
  if (!existsSync(path.join(resolved, "state.json"))) {
    throw new Error(`stateRoot is missing state.json: ${resolved}`);
  }
  return resolved;
}

export function progressText({ title, goal, completionDefinition, createdAt }) {
  return `# ${title}

## Goal

${goal}

## Completion Definition

${completionDefinition}

## Current Status

- state: planned
- createdAt: ${createdAt}
- next: add task packages or import target results

## Task Packages

No task packages yet.

## Target Results

No target results yet.

## Controller Decisions

No decisions yet.
`;
}

export function initDemand({
  root = process.cwd(),
  demandKey,
  title,
  goal = "Unspecified goal.",
  completionDefinition = "The controller has reviewed evidence and marked the demand complete.",
  controllerWindow = "controller",
  write = false,
}) {
  if (!demandKey) throw new Error("demandKey is required.");
  if (!title) throw new Error("title is required.");
  const base = workspaceRoot(root);
  const stateRoot = demandStateRoot(base, demandKey);
  ensureInside(base, stateRoot, "stateRoot");
  const createdAt = nowIso();
  const state = {
    schemaVersion,
    demandKey,
    title,
    goal,
    completionDefinition,
    controllerWindow,
    status: "planned",
    createdAt,
    updatedAt: createdAt,
    revision: 1,
    taskPackages: [],
    deliveries: [],
    targetResults: [],
    decisions: [],
  };
  if (write) {
    mkdirSync(path.join(stateRoot, "task-packages"), { recursive: true });
    mkdirSync(path.join(stateRoot, "delivery-intents"), { recursive: true });
    mkdirSync(path.join(stateRoot, "delivery-runs"), { recursive: true });
    mkdirSync(path.join(stateRoot, "target-results"), { recursive: true });
    writeJson(path.join(stateRoot, "demand.json"), {
      schemaVersion,
      demandKey,
      title,
      goal,
      completionDefinition,
      controllerWindow,
      createdAt,
    });
    writeJson(path.join(stateRoot, "state.json"), state);
    atomicWrite(path.join(stateRoot, "developer-progress.md"), progressText({
      title,
      goal,
      completionDefinition,
      createdAt,
    }));
    appendJsonLine(path.join(stateRoot, "events.jsonl"), {
      type: "demand.initialized",
      createdAt,
      demandKey,
      stateRoot: path.relative(base, stateRoot),
    });
  }
  return {
    ok: true,
    stateRoot,
    stateRootRef: path.relative(base, stateRoot),
    state,
  };
}

export function loadState(stateRoot) {
  return readJson(path.join(stateRoot, "state.json"), "Wakeflow state");
}

export function saveState(stateRoot, state) {
  const next = {
    ...state,
    revision: Number(state.revision || 0) + 1,
    updatedAt: nowIso(),
  };
  writeJson(path.join(stateRoot, "state.json"), next);
  return next;
}

export function addTask({
  root = process.cwd(),
  stateRoot,
  taskId,
  targetWindow,
  summary,
  packageId,
  write = false,
}) {
  const base = workspaceRoot(root);
  const resolvedStateRoot = resolveStateRoot(base, stateRoot);
  if (!taskId) throw new Error("taskId is required.");
  if (!targetWindow) throw new Error("targetWindow is required.");
  if (!summary) throw new Error("summary is required.");
  const state = loadState(resolvedStateRoot);
  const taskPackageId = packageId || `${slug(taskId)}-package`;
  if (state.taskPackages.some((task) => task.taskId === taskId)) {
    throw new Error(`task already exists: ${taskId}`);
  }
  const createdAt = nowIso();
  const task = {
    schemaVersion,
    packageId: taskPackageId,
    taskId,
    targetWindow,
    summary,
    status: "pending",
    createdAt,
    updatedAt: createdAt,
  };
  if (write) {
    writeJson(path.join(resolvedStateRoot, "task-packages", `${slug(taskId)}.json`), task);
    const next = saveState(resolvedStateRoot, {
      ...state,
      taskPackages: [...state.taskPackages, task],
    });
    appendJsonLine(path.join(resolvedStateRoot, "events.jsonl"), {
      type: "task.added",
      createdAt,
      taskId,
      targetWindow,
      packageId: taskPackageId,
    });
    return { ok: true, stateRoot: resolvedStateRoot, task, state: next };
  }
  return { ok: true, stateRoot: resolvedStateRoot, task, state };
}

export function targetSkillPath() {
  return "skills/wakeflow-target/SKILL.md";
}

export function deliveryPrompt({ targetWindow, taskId, stateRootRef, dispatchGroup, skill = targetSkillPath() }) {
  return `Continue current window task: ${targetWindow} / ${taskId}.

Variables:
- currentWindow: ${targetWindow}
- taskId: ${taskId}
- stateRoot: ${stateRootRef}
- dispatchGroup: ${dispatchGroup}
- skill: ${skill}

Rules:
- Read the skill and state root first.
- Do only this target task.
- Return a target result envelope with evidence refs.
- Do not create a next-hop delivery.
`;
}

export function prepareDelivery({
  root = process.cwd(),
  stateRoot,
  taskId,
  dispatchGroup,
  controllerWindow,
  write = false,
}) {
  const base = workspaceRoot(root);
  const resolvedStateRoot = resolveStateRoot(base, stateRoot);
  if (!taskId) throw new Error("taskId is required.");
  const state = loadState(resolvedStateRoot);
  const task = state.taskPackages.find((item) => item.taskId === taskId);
  if (!task) throw new Error(`task does not exist: ${taskId}`);
  if (task.status !== "pending" && task.status !== "deferred") {
    throw new Error(`task is not eligible for delivery: ${taskId} (${task.status})`);
  }
  const group = dispatchGroup || `${slug(taskId)}-${Date.now()}`;
  const deliveryId = `${slug(group)}-${slug(taskId)}`;
  const createdAt = nowIso();
  const stateRootRef = path.relative(base, resolvedStateRoot);
  const intent = {
    schemaVersion,
    deliveryId,
    dispatchGroup: group,
    controllerWindow: controllerWindow || state.controllerWindow,
    targetWindow: task.targetWindow,
    taskId,
    stateRoot: stateRootRef,
    transport: "host-thread-intent",
    hostSendRequired: true,
    sentByWakeflow: false,
    prompt: deliveryPrompt({
      targetWindow: task.targetWindow,
      taskId,
      stateRootRef,
      dispatchGroup: group,
    }),
    createdAt,
  };
  if (write) {
    writeJson(path.join(resolvedStateRoot, "delivery-intents", `${slug(deliveryId)}.json`), intent);
    const deliveries = state.deliveries.filter((item) => item.deliveryId !== deliveryId);
    const tasks = state.taskPackages.map((item) => item.taskId === taskId
      ? { ...item, status: "delivery-ready", dispatchGroup: group, updatedAt: createdAt }
      : item);
    const next = saveState(resolvedStateRoot, {
      ...state,
      deliveries: [...deliveries, intent],
      taskPackages: tasks,
    });
    appendJsonLine(path.join(resolvedStateRoot, "events.jsonl"), {
      type: "delivery.prepared",
      createdAt,
      deliveryId,
      dispatchGroup: group,
      taskId,
      targetWindow: task.targetWindow,
    });
    return { ok: true, stateRoot: resolvedStateRoot, intent, state: next };
  }
  return { ok: true, stateRoot: resolvedStateRoot, intent, state };
}

export function recordDelivery({
  root = process.cwd(),
  stateRoot,
  deliveryId,
  status,
  evidence = "",
  write = false,
}) {
  const base = workspaceRoot(root);
  const resolvedStateRoot = resolveStateRoot(base, stateRoot);
  if (!deliveryId) throw new Error("deliveryId is required.");
  if (!["sent", "blocked", "failed", "deferred"].includes(status)) {
    throw new Error("status must be sent, blocked, failed, or deferred.");
  }
  const state = loadState(resolvedStateRoot);
  const delivery = state.deliveries.find((item) => item.deliveryId === deliveryId);
  if (!delivery) throw new Error(`delivery does not exist: ${deliveryId}`);
  const createdAt = nowIso();
  const run = {
    schemaVersion,
    deliveryId,
    status,
    evidence,
    createdAt,
  };
  if (write) {
    writeJson(path.join(resolvedStateRoot, "delivery-runs", `${slug(deliveryId)}-${slug(status)}.json`), run);
    const taskStatus = status === "sent" ? "sent" : status === "deferred" ? "deferred" : "blocked";
    const tasks = state.taskPackages.map((item) => item.taskId === delivery.taskId
      ? { ...item, status: taskStatus, updatedAt: createdAt }
      : item);
    const next = saveState(resolvedStateRoot, { ...state, taskPackages: tasks });
    appendJsonLine(path.join(resolvedStateRoot, "events.jsonl"), {
      type: "delivery.recorded",
      createdAt,
      deliveryId,
      status,
    });
    return { ok: true, stateRoot: resolvedStateRoot, run, state: next };
  }
  return { ok: true, stateRoot: resolvedStateRoot, run, state };
}

export function submitResult({
  root = process.cwd(),
  stateRoot,
  taskId,
  targetWindow,
  status,
  summary = "",
  evidenceRefs = [],
  write = false,
}) {
  const base = workspaceRoot(root);
  const resolvedStateRoot = resolveStateRoot(base, stateRoot);
  if (!taskId) throw new Error("taskId is required.");
  if (!targetWindow) throw new Error("targetWindow is required.");
  if (!["completed", "blocked", "needs-review"].includes(status)) {
    throw new Error("status must be completed, blocked, or needs-review.");
  }
  const createdAt = nowIso();
  const resultId = `${slug(taskId)}-${slug(targetWindow)}-${Date.now()}`;
  const result = {
    schemaVersion,
    resultId,
    taskId,
    targetWindow,
    status,
    summary,
    evidenceRefs: Array.isArray(evidenceRefs) ? evidenceRefs : [evidenceRefs].filter(Boolean),
    createdAt,
  };
  const state = loadState(resolvedStateRoot);
  if (write) {
    writeJson(path.join(resolvedStateRoot, "target-results", `${slug(resultId)}.json`), result);
    const tasks = state.taskPackages.map((item) => item.taskId === taskId
      ? { ...item, status: status === "completed" ? "review-ready" : status, updatedAt: createdAt }
      : item);
    const next = saveState(resolvedStateRoot, {
      ...state,
      targetResults: [...state.targetResults, result],
      taskPackages: tasks,
    });
    appendJsonLine(path.join(resolvedStateRoot, "events.jsonl"), {
      type: "result.submitted",
      createdAt,
      taskId,
      targetWindow,
      status,
      resultId,
    });
    return { ok: true, stateRoot: resolvedStateRoot, result, state: next };
  }
  return { ok: true, stateRoot: resolvedStateRoot, result, state };
}

export function review({ root = process.cwd(), stateRoot }) {
  const base = workspaceRoot(root);
  const resolvedStateRoot = resolveStateRoot(base, stateRoot);
  const state = loadState(resolvedStateRoot);
  const resultByTask = new Map(state.targetResults.map((result) => [result.taskId, result]));
  const tasks = state.taskPackages.map((task) => {
    const result = resultByTask.get(task.taskId);
    return {
      taskId: task.taskId,
      targetWindow: task.targetWindow,
      taskStatus: task.status,
      resultStatus: result?.status || "missing",
      evidenceRefs: result?.evidenceRefs || [],
    };
  });
  const completed = tasks.filter((task) => task.resultStatus === "completed");
  const blocked = tasks.filter((task) => task.resultStatus === "blocked" || task.taskStatus === "blocked");
  const missing = tasks.filter((task) => task.resultStatus === "missing" && !blocked.includes(task));
  const decision = tasks.length === 0
    ? "no-tasks"
    : blocked.length > 0
      ? "blocked"
      : missing.length > 0
        ? "waiting"
        : "review-ready";
  return {
    ok: true,
    stateRoot: resolvedStateRoot,
    demandKey: state.demandKey,
    status: state.status,
    decision,
    tasks,
    completedTargets: completed.map((task) => task.targetWindow),
    blockedTargets: blocked.map((task) => task.targetWindow),
    missingTargets: missing.map((task) => task.targetWindow),
    agentNext: decision === "review-ready"
      ? "Controller must pull raw evidence and decide acceptance."
      : decision === "waiting"
        ? "Wait for target results or prepare eligible deliveries."
        : "Return to controller judgment.",
  };
}

export function status({ root = process.cwd() }) {
  const base = workspaceRoot(root);
  const active = activeRoot(base);
  const demands = existsSync(active)
    ? readdirSync(active, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
          const stateFile = path.join(active, entry.name, "state.json");
          if (!existsSync(stateFile)) return null;
          const state = readJson(stateFile, "Wakeflow state");
          return {
            demandKey: state.demandKey,
            title: state.title,
            status: state.status,
            taskCount: state.taskPackages.length,
            resultCount: state.targetResults.length,
            stateRoot: path.relative(base, path.join(active, entry.name)),
            updatedAt: state.updatedAt,
          };
        })
        .filter(Boolean)
    : [];
  return {
    ok: true,
    root: base,
    activeRoot: path.relative(base, active),
    localRoot: path.relative(base, localRoot(base)),
    demands,
  };
}
