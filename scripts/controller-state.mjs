#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspaceConfig, workspaceLedgerPaths } from "./lib/workspace-config.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const controlRoot = path.dirname(path.dirname(scriptPath));
const rawArgs = process.argv.slice(2);
const command = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs[0] : "help";
const options = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs.slice(1) : rawArgs;
const workspaceRoot = path.resolve(getValue("--root", controlRoot));
const write = hasFlag("--write");
const json = hasFlag("--json");
const schemaVersion = 1;
const templateRoot = path.join(controlRoot, "templates/control-state-machine");

const helpText = `
Controller state-machine manager

Usage:
  node scripts/controller-state.mjs init --demand-key <key> --title <title> [--goal <text>] [--completion-definition <text>] [--stage-plan <text>] [--root <workspace>] [--state-root <path>] [--write] [--json]
  node scripts/controller-state.mjs add-task-package --state-root <path> --task-package-id <id> --summary <text> [--source-ref <ref>] [--target-window <window>] [--target-task-id <id>] [--target-summary <text>] [--write] [--json]
  node scripts/controller-state.mjs import-target-result --state-root <path> --target-task-id <id> --target-window <window> --status <completed|blocked|needs-review> [--result-id <id>] [--evidence-ref <ref>] [--verification <text>] [--risk <text>] [--summary <text>] [--write] [--json]
  node scripts/controller-state.mjs reduce-results --state-root <path> [--write] [--json]
  node scripts/controller-state.mjs decide-review --state-root <path> --candidate-id <id> --decision <accept|rework|blocked> --reason <text> [--evidence-ref <ref>] [--write] [--json]
  node scripts/controller-state.mjs complete-demand --state-root <path> --reason <text> --evidence-ref <ref> [--write] [--json]

Design:
  This script manages the machine state root for the new control state-machine
  flow. Tracked templates and schemas live in the open-source control
  workspace. Per-demand state roots are generated under the configured active
  workspace directory by default, which is ignored local/project runtime state.
`.trim();

class CliExit extends Error {}

function hasFlag(name) {
  return options.includes(name);
}

function getValue(name, fallback = null) {
  const eq = options.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = options.indexOf(name);
  if (index >= 0 && options[index + 1] && !options[index + 1].startsWith("--")) {
    return options[index + 1];
  }
  return fallback;
}

function output(payload, textLines = []) {
  const complete = { scriptComplete: true, ...payload };
  if (!complete.agentNext) {
    complete.agentNext = complete.ok
      ? "Continue by total-control judgment; this script does not dispatch or accept work."
      : "Stop and inspect the reported controller-state issue.";
  }
  if (json) {
    console.log(JSON.stringify(complete, null, 2));
    return;
  }
  for (const line of textLines) {
    console.log(line);
  }
  console.log(`Agent next: ${complete.agentNext}`);
}

function fail(message) {
  output({ ok: false, command, error: message });
  process.exitCode = 1;
  throw new CliExit(message);
}

function requireValue(name) {
  const value = getValue(name);
  if (!value) fail(`${name} is required.`);
  return value;
}

function slug(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "demand";
}

function nowIso() {
  return new Date().toISOString();
}

function relative(file) {
  const rel = path.relative(workspaceRoot, file).split(path.sep).join("/");
  return rel || ".";
}

function ensureInsideAllowedRoots(file, label, allowedRoots) {
  const absolute = path.resolve(file);
  if (allowedRoots.some((root) => {
    const rel = path.relative(root, absolute);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  })) {
    return;
  }
  fail(`${label} must stay inside the control workspace or configured project ledger: ${absolute}`);
}

function readTemplate(name) {
  return readFileSync(path.join(templateRoot, name), "utf8");
}

function render(template, data) {
  return template.replace(/\{\{([A-Za-z0-9_]+)}}/g, (match, key) => String(data[key] ?? ""));
}

function atomicWrite(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temp, content);
    renameSync(temp, file);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
}

function writeJson(file, value) {
  atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(file, value) {
  atomicWrite(file, `${value.trimEnd()}\n`);
}

function readJson(file, label = "JSON file") {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`Invalid ${label} ${relative(file)}: ${error.message}`);
  }
  return null;
}

function stateRootFromArg() {
  const stateRoot = resolveFromWorkspace(requireValue("--state-root"));
  const config = loadWorkspaceConfig({ workspaceRoot, args: options });
  const ledgerPaths = workspaceLedgerPaths({ workspaceRoot, args: options, config });
  ensureInsideAllowedRoots(stateRoot, "state root", [
    workspaceRoot,
    ledgerPaths.projectLedgerRoot,
    ledgerPaths.workspaceDocsDir,
  ]);
  if (!existsSync(path.join(stateRoot, "controller-state.json"))) {
    fail(`state root is missing controller-state.json: ${relative(stateRoot)}`);
  }
  return stateRoot;
}

function appendJsonLine(file, value) {
  const previous = existsSync(file) ? readFileSync(file, "utf8").trimEnd() : "";
  const next = `${previous ? `${previous}\n` : ""}${JSON.stringify(value)}\n`;
  atomicWrite(file, next);
}

function nextEventId(createdAt, revision) {
  return `evt-${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}-${String(revision).padStart(4, "0")}`;
}

function beijingTimestamp(iso) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso)).replace(",", "") + " CST";
}

function defaultStateRoot({ demandKey, ledgerPaths }) {
  return path.join(ledgerPaths.workspaceCurrentDir, slug(demandKey));
}

function resolveFromWorkspace(value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspaceRoot, value);
}

function unifiedStatusText({ demandKey, title, state, updatedAt, revision, eventId }) {
  return render(readTemplate("unified-status.template.md"), {
    demandKey,
    title,
    state,
    stage: "none",
    taskPackages: "none",
    windows: "none",
    blockers: "none",
    nextAction: "Define stages and task packages by total-control judgment.",
    review: "none",
    automation: "disabled",
    decisionsRequired: "none",
    updatedAt: beijingTimestamp(updatedAt),
    revision,
    eventId,
  }).trimEnd();
}

function progressDocText({ demandKey, title, goal, completionDefinition, stagePlan, unifiedStatus }) {
  const template = readTemplate("developer-progress.template.md");
  const body = render(template, {
    title,
    goal,
    completionDefinition,
    stagePlan,
  });
  return body.replace(
    /<!-- unified-status:start -->([\s\S]*?)<!-- unified-status:end -->/,
    `<!-- unified-status:start -->\n${unifiedStatus}\n<!-- unified-status:end -->`,
  );
}

function commandInit() {
  const demandKey = requireValue("--demand-key");
  const title = requireValue("--title");
  const goal = getValue("--goal", "TBD by total-control judgment.");
  const completionDefinition = getValue("--completion-definition", "TBD by total-control judgment.");
  const stagePlan = getValue("--stage-plan", "TBD by total-control judgment.");
  const config = loadWorkspaceConfig({ workspaceRoot, args: options });
  const ledgerPaths = workspaceLedgerPaths({ workspaceRoot, args: options, config });
  const stateRoot = resolveFromWorkspace(getValue("--state-root", defaultStateRoot({ demandKey, ledgerPaths })));
  ensureInsideAllowedRoots(stateRoot, "state root", [
    workspaceRoot,
    ledgerPaths.projectLedgerRoot,
    ledgerPaths.workspaceDocsDir,
  ]);

  const createdAt = nowIso();
  const eventId = `evt-${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}-0001`;
  const progressDoc = "developer-progress.md";
  const files = {
    demand: path.join(stateRoot, "demand.json"),
    state: path.join(stateRoot, "controller-state.json"),
    events: path.join(stateRoot, "controller-events.jsonl"),
    projection: path.join(stateRoot, "projection.json"),
    progress: path.join(stateRoot, progressDoc),
    intake: path.join(stateRoot, "intake"),
    testCards: path.join(stateRoot, "test-cards"),
    taskPackages: path.join(stateRoot, "task-packages"),
    targetResults: path.join(stateRoot, "target-results"),
    evidence: path.join(stateRoot, "evidence"),
    transitionCandidates: path.join(stateRoot, "transition-candidates"),
    automation: path.join(stateRoot, "automation"),
    archive: path.join(stateRoot, "archive"),
  };

  const demand = {
    schemaVersion,
    demandKey,
    title,
    goal,
    completionDefinition,
    createdAt,
    source: {
      kind: "controller-state-init",
      trackedTemplates: "templates/control-state-machine",
      generatedStateRoot: relative(stateRoot),
    },
  };
  const state = {
    schemaVersion,
    demandKey,
    title,
    state: "intake",
    stateReason: "controller-state-init",
    revision: 1,
    activeStageId: null,
    updatedAt: createdAt,
    allowedActions: [],
    blockers: [],
    decisionsRequired: [],
    stages: [],
    taskPackages: [],
    targetTasks: [],
    windows: [],
    review: {
      status: "none",
      readyResultIds: [],
      blockedResultIds: [],
      missingResultIds: [],
    },
    automation: {
      enabled: false,
      activeRunIds: [],
      lastReviewPack: null,
    },
    projection: {
      status: "synced",
      lastRenderedAt: createdAt,
      progressDoc,
    },
  };
  const event = {
    eventId,
    createdAt,
    actor: "controller",
    type: "state.initialized",
    from: null,
    to: "intake",
    reason: "controller-state-init",
    evidenceRefs: [],
    allowedWrites: [
      "demand.json",
      "controller-state.json",
      "controller-events.jsonl",
      "projection.json",
      "developer-progress.md",
    ],
    forbiddenConclusions: [
      "initialization-is-dispatch",
      "initialization-is-acceptance",
      "progress-doc-is-state-source",
    ],
    stateRevision: 1,
  };
  const unifiedStatus = unifiedStatusText({
    demandKey,
    title,
    state: state.state,
    updatedAt: createdAt,
    revision: state.revision,
    eventId,
  });
  const projection = {
    schemaVersion,
    demandKey,
    title,
    sourceRevision: state.revision,
    sourceEventId: eventId,
    progressDoc,
    unifiedStatus: {
      demand: `${demandKey} - ${title}`,
      mainState: state.state,
      stage: "none",
      currentTaskPackages: "none",
      windows: "none",
      blockers: "none",
      nextAction: "Define stages and task packages by total-control judgment.",
      review: "none",
      automation: "disabled",
      userDecisionsNeeded: "none",
      lastUpdated: createdAt,
    },
  };
  const progress = progressDocText({
    demandKey,
    title,
    goal,
    completionDefinition,
    stagePlan,
    unifiedStatus,
  });
  const directories = [
    files.intake,
    files.testCards,
    files.taskPackages,
    files.targetResults,
    files.evidence,
    path.join(files.automation, "dispatch-groups"),
    path.join(files.automation, "dispatch-packets"),
    path.join(files.automation, "delivery-envelopes"),
    path.join(files.automation, "delivery-runs"),
    path.join(files.automation, "review-packs"),
    files.transitionCandidates,
    files.archive,
  ];
  const outputs = [
    files.demand,
    files.state,
    files.events,
    files.projection,
    files.progress,
    ...directories,
  ];

  if (write) {
    for (const dir of directories) {
      mkdirSync(dir, { recursive: true });
    }
    writeJson(files.demand, demand);
    writeJson(files.state, state);
    writeText(files.events, JSON.stringify(event));
    writeJson(files.projection, projection);
    writeText(files.progress, progress);
  }

  output(
    {
      ok: true,
      command: "init",
      wrote: write,
      demandKey,
      stateRoot: relative(stateRoot),
      progressDoc: relative(files.progress),
      stateFile: relative(files.state),
      eventFile: relative(files.events),
      projectionFile: relative(files.projection),
      templateRoot: relative(templateRoot),
      generatedRuntimeBoundary: ".workspace-active is ignored by the open-source control repository; tracked assets are templates, schemas, scripts, skills, and tests.",
      outputs: outputs.map(relative),
    },
    [
      `${write ? "Initialized" : "Would initialize"} controller state root for ${demandKey}.`,
      `State root: ${relative(stateRoot)}`,
      "No automation, thread registration, dispatch, or acceptance was performed.",
    ],
  );
}

function commandAddTaskPackage() {
  const stateRoot = stateRootFromArg();
  const taskPackageId = requireValue("--task-package-id");
  const summary = requireValue("--summary");
  const sourceRef = getValue("--source-ref", null);
  const targetWindow = getValue("--target-window", null);
  const targetTaskId = getValue("--target-task-id", targetWindow ? `${taskPackageId}__${slug(targetWindow)}` : null);
  const targetSummary = getValue("--target-summary", summary);
  const stateFile = path.join(stateRoot, "controller-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const packageFile = path.join(stateRoot, "task-packages", `${slug(taskPackageId)}.json`);
  const state = readJson(stateFile, "controller state");

  if (["completed", "archived", "paused"].includes(state.state)) {
    fail(`cannot add task package while demand is ${state.state}: ${state.demandKey}`);
  }
  if (["review-ready", "accepting", "waiting-results"].includes(state.state)) {
    fail(`cannot add task package while demand is ${state.state}; reduce or decide current results before adding more work.`);
  }
  if (state.state === "blocked" || (state.blockers ?? []).length > 0) {
    fail(`cannot add task package while demand is blocked; record an explicit rework or unblock decision first.`);
  }
  if (existsSync(packageFile)) {
    fail(`task package already exists: ${relative(packageFile)}`);
  }
  if ((state.taskPackages ?? []).some((item) => item.taskPackageId === taskPackageId)) {
    fail(`controller state already contains task package: ${taskPackageId}`);
  }
  if (targetWindow && !targetTaskId) {
    fail("--target-task-id is required when --target-window is provided.");
  }

  const createdAt = nowIso();
  const nextRevision = Number(state.revision ?? 0) + 1;
  const eventId = nextEventId(createdAt, nextRevision);
  const nextMainState = state.state === "intake" || state.state === "needs-rework"
    ? "planned"
    : state.state;
  const targetTasks = targetWindow
    ? [
        {
          targetTaskId,
          taskPackageId,
          targetWindow,
          summary: targetSummary,
          status: "pending",
          createdAt,
        },
      ]
    : [];
  const taskPackage = {
    schemaVersion,
    taskPackageId,
    demandKey: state.demandKey,
    summary,
    status: "pending",
    sourceRef,
    createdAt,
    targetTasks,
  };
  const nextState = {
    ...state,
    state: nextMainState,
    stateReason: `task package added: ${taskPackageId}`,
    revision: nextRevision,
    updatedAt: createdAt,
    allowedActions: targetTasks.length > 0
      ? ["prepare-dispatch-from-state", "add-task-package", "render-progress-doc"]
      : ["add-task-package", "render-progress-doc"],
    taskPackages: [
      ...(state.taskPackages ?? []),
      {
        taskPackageId,
        summary,
        status: "pending",
        sourceRef,
        createdAt,
      },
    ],
    targetTasks: [
      ...(state.targetTasks ?? []),
      ...targetTasks,
    ],
    windows: targetWindow ? upsertWindowState(state.windows ?? [], {
      windowName: targetWindow,
      windowState: "pending",
      taskPackageId,
      targetTaskId,
    }) : (state.windows ?? []),
    projection: {
      ...(state.projection ?? {}),
      status: "stale",
    },
  };
  const event = {
    eventId,
    createdAt,
    actor: "controller",
    type: "task-package.added",
    from: state.state,
    to: nextMainState,
    reason: `task package added: ${taskPackageId}`,
    evidenceRefs: sourceRef ? [sourceRef] : [],
    allowedWrites: [
      "controller-state.json",
      "controller-events.jsonl",
      `task-packages/${slug(taskPackageId)}.json`,
    ],
    forbiddenConclusions: [
      "task-package-is-dispatch",
      "task-package-is-acceptance",
      "task-package-updates-progress-doc-status",
    ],
    stateRevision: nextRevision,
  };

  if (write) {
    mkdirSync(path.dirname(packageFile), { recursive: true });
    writeJson(packageFile, taskPackage);
    writeJson(stateFile, nextState);
    appendJsonLine(eventsFile, event);
  }

  output(
    {
      ok: true,
      command: "add-task-package",
      wrote: write,
      demandKey: state.demandKey,
      stateRoot: relative(stateRoot),
      taskPackageId,
      taskPackageFile: relative(packageFile),
      stateRevision: nextRevision,
      eventId,
      projectionStatus: "stale",
      appendLog: {
        type: "task-package",
        section: "Task Packages",
        taskPackageId,
        summary,
        sourceRef,
      },
    },
    [
      `${write ? "Added" : "Would add"} task package ${taskPackageId}.`,
      "Projection is stale until render-progress-doc updates Unified Status.",
      "No automation, thread registration, dispatch, or acceptance was performed.",
    ],
  );
}

function commandImportTargetResult() {
  const stateRoot = stateRootFromArg();
  const targetTaskId = requireValue("--target-task-id");
  const targetWindow = requireValue("--target-window");
  const status = requireValue("--status");
  const allowedStatuses = new Set(["completed", "blocked", "needs-review"]);
  if (!allowedStatuses.has(status)) {
    fail(`--status must be one of: ${[...allowedStatuses].join(", ")}`);
  }
  const state = readJson(path.join(stateRoot, "controller-state.json"), "controller state");
  if (["completed", "archived"].includes(state.state)) {
    fail(`cannot import target result while demand is ${state.state}: ${state.demandKey}`);
  }
  const targetTask = (state.targetTasks ?? []).find((item) => item.targetTaskId === targetTaskId);
  if (!targetTask) {
    fail(`unknown target task: ${targetTaskId}`);
  }
  if (targetTask.targetWindow !== targetWindow) {
    fail(`target task ${targetTaskId} belongs to ${targetTask.targetWindow}, not ${targetWindow}`);
  }
  if (["accepted"].includes(targetTask.status)) {
    fail(`target task ${targetTaskId} is already ${targetTask.status}; create a new task package for follow-up work.`);
  }
  const resultId = getValue("--result-id", `tr-${slug(targetTaskId)}`);
  const resultFile = path.join(stateRoot, "target-results", `${slug(resultId)}.json`);
  if (existsSync(resultFile)) {
    fail(`target result already exists: ${relative(resultFile)}`);
  }
  const createdAt = nowIso();
  const evidenceRefs = valuesFor("--evidence-ref");
  const verification = valuesFor("--verification");
  const risks = valuesFor("--risk");
  const result = {
    schemaVersion,
    resultId,
    demandKey: state.demandKey,
    taskPackageId: targetTask.taskPackageId,
    targetWindow,
    targetTaskId,
    status,
    summary: getValue("--summary", ""),
    evidenceRefs,
    verification,
    risks,
    createdAt,
    stateRevisionObserved: state.revision,
    forbiddenConclusions: [
      "target-result-is-controller-acceptance",
      "target-result-closes-task-package",
      "target-result-creates-next-dispatch",
      "target-result-updates-progress-doc-status",
    ],
  };

  if (write) {
    mkdirSync(path.dirname(resultFile), { recursive: true });
    writeJson(resultFile, result);
  }

  output(
    {
      ok: true,
      command: "import-target-result",
      wrote: write,
      demandKey: state.demandKey,
      stateRoot: relative(stateRoot),
      resultId,
      resultFile: relative(resultFile),
      targetTaskId,
      status,
      stateRevisionUnchanged: state.revision,
      nextSuggestedCommand: "reduce-results",
      forbiddenConclusions: result.forbiddenConclusions,
    },
    [
      `${write ? "Imported" : "Would import"} target result ${resultId}.`,
      "Controller state was not changed; run reduce-results to build a review candidate.",
    ],
  );
}

function commandReduceResults() {
  const stateRoot = stateRootFromArg();
  const stateFile = path.join(stateRoot, "controller-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const state = readJson(stateFile, "controller state");
  if (["completed", "archived"].includes(state.state)) {
    fail(`cannot reduce results while demand is ${state.state}: ${state.demandKey}`);
  }
  const targetTasks = state.targetTasks ?? [];
  if (targetTasks.length === 0) {
    fail("controller state has no target tasks to reduce.");
  }
  const results = latestResultsByTargetTask(readTargetResults(stateRoot));
  const readyResultIds = [];
  const blockedResultIds = [];
  const missingTargetTaskIds = [];
  const evidenceRefs = [];

  for (const task of targetTasks) {
    const result = results.get(task.targetTaskId);
    if (!result) {
      missingTargetTaskIds.push(task.targetTaskId);
      continue;
    }
    evidenceRefs.push(...(result.evidenceRefs ?? []), `target-results/${slug(result.resultId)}.json`);
    if (result.status === "blocked") {
      blockedResultIds.push(result.resultId);
    } else {
      readyResultIds.push(result.resultId);
    }
  }

  const createdAt = nowIso();
  const nextRevision = Number(state.revision ?? 0) + 1;
  const eventId = nextEventId(createdAt, nextRevision);
  const reviewStatus = missingTargetTaskIds.length > 0
    ? "waiting-results"
    : blockedResultIds.length > 0
      ? "blocked-results-ready"
      : "ready-for-controller-review";
  const nextMainState = missingTargetTaskIds.length > 0 ? "waiting-results" : "review-ready";
  const candidateId = missingTargetTaskIds.length > 0 ? null : `tc-${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}-${String(nextRevision).padStart(4, "0")}`;
  const decision = candidateId ? {
    kind: "review-decision",
    candidateId,
    summary: blockedResultIds.length > 0
      ? "Target results include blocked evidence; total-control decision is required."
      : "All target results are present; total-control acceptance/rework decision is required.",
  } : null;
  const candidate = candidateId ? {
    schemaVersion,
    candidateId,
    demandKey: state.demandKey,
    fromRevision: nextRevision,
    candidateState: blockedResultIds.length > 0 ? "blocked" : "accepting",
    reason: decision.summary,
    reviewStatus,
    readyResultIds,
    blockedResultIds,
    missingResultIds: [],
    targetTaskIds: targetTasks.map((item) => item.targetTaskId),
    allowedDecisions: ["accept", "rework", "blocked"],
    evidenceRefs: [...new Set(evidenceRefs)],
    forbiddenConclusions: [
      "transition-candidate-is-acceptance",
      "reducer-decision-closes-task-package",
      "reducer-decision-creates-next-dispatch",
    ],
  } : null;
  const nextState = {
    ...state,
    state: nextMainState,
    stateReason: reviewStatus,
    revision: nextRevision,
    updatedAt: createdAt,
    allowedActions: candidateId ? ["decide-review"] : ["import-target-result", "reduce-results"],
    decisionsRequired: decision ? [decision] : [],
    review: {
      status: reviewStatus,
      readyResultIds,
      blockedResultIds,
      missingResultIds: missingTargetTaskIds,
    },
    targetTasks: targetTasks.map((task) => {
      const result = results.get(task.targetTaskId);
      return {
        ...task,
        status: result ? result.status : "missing-result",
        resultId: result?.resultId ?? null,
      };
    }),
    windows: reduceWindowStates(state.windows ?? [], targetTasks, results),
    projection: {
      ...(state.projection ?? {}),
      status: "stale",
    },
  };
  const event = {
    eventId,
    createdAt,
    actor: "controller-reducer",
    type: "review.reduced",
    from: state.state,
    to: nextMainState,
    reason: reviewStatus,
    evidenceRefs: [...new Set(evidenceRefs)],
    allowedWrites: [
      "controller-state.json",
      "controller-events.jsonl",
      ...(candidate ? [`transition-candidates/${slug(candidate.candidateId)}.json`] : []),
    ],
    forbiddenConclusions: [
      "review-reduction-is-acceptance",
      "review-reduction-is-dispatch",
      "review-reduction-closes-task-package",
    ],
    stateRevision: nextRevision,
  };

  if (write) {
    writeJson(stateFile, nextState);
    appendJsonLine(eventsFile, event);
    if (candidate) {
      writeJson(path.join(stateRoot, "transition-candidates", `${slug(candidate.candidateId)}.json`), candidate);
    }
  }

  output(
    {
      ok: true,
      command: "reduce-results",
      wrote: write,
      demandKey: state.demandKey,
      stateRoot: relative(stateRoot),
      previousState: state.state,
      nextState: nextMainState,
      stateRevision: nextRevision,
      eventId,
      reviewStatus,
      readyResultIds,
      blockedResultIds,
      missingResultIds: missingTargetTaskIds,
      candidateId,
      projectionStatus: "stale",
    },
    [
      `${write ? "Reduced" : "Would reduce"} target results for ${state.demandKey}.`,
      candidateId
        ? `Transition candidate ${candidateId} requires total-control decide-review.`
        : "Missing target results remain; no decision candidate was created.",
    ],
  );
}

function commandDecideReview() {
  const stateRoot = stateRootFromArg();
  const candidateId = requireValue("--candidate-id");
  const decision = requireValue("--decision");
  const reason = requireValue("--reason");
  const allowedDecisions = new Set(["accept", "rework", "blocked"]);
  if (!allowedDecisions.has(decision)) {
    fail(`--decision must be one of: ${[...allowedDecisions].join(", ")}`);
  }
  const stateFile = path.join(stateRoot, "controller-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const state = readJson(stateFile, "controller state");
  const candidateFile = path.join(stateRoot, "transition-candidates", `${slug(candidateId)}.json`);
  if (!existsSync(candidateFile)) {
    fail(`transition candidate does not exist: ${relative(candidateFile)}`);
  }
  const candidate = readJson(candidateFile, "transition candidate");
  if (candidate.demandKey !== state.demandKey) {
    fail(`transition candidate demand mismatch: ${candidate.demandKey} != ${state.demandKey}`);
  }
  if (candidate.fromRevision !== state.revision) {
    fail(`transition candidate ${candidateId} is stale: candidate revision ${candidate.fromRevision}, current revision ${state.revision}`);
  }
  const createdAt = nowIso();
  const nextRevision = state.revision + 1;
  const eventId = nextEventId(createdAt, nextRevision);
  const evidenceRefs = [...new Set([...(candidate.evidenceRefs ?? []), ...valuesFor("--evidence-ref")])];
  const nextMainState = decision === "accept" ? "planned" : decision === "rework" ? "needs-rework" : "blocked";
  const nextTaskStatus = decision === "accept" ? "accepted" : decision === "rework" ? "needs-rework" : "blocked";
  const candidateTaskIds = new Set(candidate.targetTaskIds ?? []);
  const nextTargetTasks = (state.targetTasks ?? []).map((item) => candidateTaskIds.has(item.targetTaskId)
    ? {
        ...item,
        status: nextTaskStatus,
        reviewDecision: decision,
      }
    : item);
  const nextState = {
    ...state,
    state: nextMainState,
    stateReason: reason,
    revision: nextRevision,
    updatedAt: createdAt,
    allowedActions: decision === "accept"
      ? ["add-task-package", "complete-demand", "render-progress-doc"]
      : decision === "rework"
        ? ["add-task-package", "render-progress-doc"]
        : ["render-progress-doc"],
    blockers: decision === "blocked"
      ? [
          ...(state.blockers ?? []),
          {
            kind: "review-blocker",
            candidateId,
            summary: reason,
            evidenceRefs,
            createdAt,
          },
        ]
      : (state.blockers ?? []),
    decisionsRequired: [],
    review: {
      ...(state.review ?? {}),
      status: `decision-${decision}`,
    },
    taskPackages: updatePackageStatusesForDecision(state.taskPackages ?? [], nextTargetTasks, candidateTaskIds, nextTaskStatus),
    targetTasks: nextTargetTasks,
    windows: (state.windows ?? []).map((item) => ({
      ...item,
      windowState: (item.targetTaskIds ?? []).some((targetTaskId) => candidateTaskIds.has(targetTaskId))
        ? nextTaskStatus
        : item.windowState,
    })),
    projection: {
      ...(state.projection ?? {}),
      status: "stale",
    },
  };
  const event = {
    eventId,
    createdAt,
    actor: "controller",
    type: "review.decided",
    from: state.state,
    to: nextMainState,
    reason,
    evidenceRefs,
    allowedWrites: [
      "controller-state.json",
      "controller-events.jsonl",
    ],
    forbiddenConclusions: [
      "decision-creates-dispatch",
      "decision-updates-progress-doc-body",
      "decision-starts-automation",
    ],
    stateRevision: nextRevision,
  };

  if (write) {
    writeJson(stateFile, nextState);
    appendJsonLine(eventsFile, event);
  }

  output(
    {
      ok: true,
      command: "decide-review",
      wrote: write,
      demandKey: state.demandKey,
      stateRoot: relative(stateRoot),
      candidateId,
      decision,
      previousState: state.state,
      nextState: nextMainState,
      stateRevision: nextRevision,
      eventId,
      projectionStatus: "stale",
      appendLog: {
        type: "decision",
        decision: `${decision}: ${reason}`,
        eventId,
        evidenceRef: evidenceRefs.join(", ") || "none",
      },
    },
    [
      `${write ? "Recorded" : "Would record"} controller review decision ${decision}.`,
      "No dispatch, automation, or progress doc body update was performed.",
    ],
  );
}

function commandCompleteDemand() {
  const stateRoot = stateRootFromArg();
  const reason = requireValue("--reason");
  const evidenceRefs = valuesFor("--evidence-ref");
  if (evidenceRefs.length === 0) {
    fail("complete-demand requires at least one --evidence-ref.");
  }
  const stateFile = path.join(stateRoot, "controller-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const state = readJson(stateFile, "controller state");
  if (state.state === "completed") {
    fail(`demand is already completed: ${state.demandKey}`);
  }
  const openTasks = (state.targetTasks ?? []).filter((task) => task.status !== "accepted");
  const openPackages = (state.taskPackages ?? []).filter((taskPackage) => taskPackage.status !== "accepted");
  if (openTasks.length > 0 || openPackages.length > 0) {
    fail(`complete-demand requires all task packages and target tasks to be accepted; open tasks: ${openTasks.map((item) => item.targetTaskId).join(", ") || "none"}; open packages: ${openPackages.map((item) => item.taskPackageId).join(", ") || "none"}`);
  }
  if ((state.blockers ?? []).length > 0) {
    fail("complete-demand cannot close a demand with active blockers.");
  }

  const createdAt = nowIso();
  const nextRevision = Number(state.revision ?? 0) + 1;
  const eventId = nextEventId(createdAt, nextRevision);
  const nextState = {
    ...state,
    state: "completed",
    stateReason: reason,
    revision: nextRevision,
    updatedAt: createdAt,
    allowedActions: ["render-progress-doc"],
    decisionsRequired: [],
    review: {
      ...(state.review ?? {}),
      status: "demand-completed",
    },
    projection: {
      ...(state.projection ?? {}),
      status: "stale",
    },
  };
  const event = {
    eventId,
    createdAt,
    actor: "controller",
    type: "demand.completed",
    from: state.state,
    to: "completed",
    reason,
    evidenceRefs,
    allowedWrites: [
      "controller-state.json",
      "controller-events.jsonl",
    ],
    forbiddenConclusions: [
      "completion-creates-dispatch",
      "completion-skips-evidence-review",
      "completion-updates-progress-doc-body",
    ],
    stateRevision: nextRevision,
  };

  if (write) {
    writeJson(stateFile, nextState);
    appendJsonLine(eventsFile, event);
  }

  output(
    {
      ok: true,
      command: "complete-demand",
      wrote: write,
      demandKey: state.demandKey,
      stateRoot: relative(stateRoot),
      previousState: state.state,
      nextState: "completed",
      stateRevision: nextRevision,
      eventId,
      projectionStatus: "stale",
      appendLog: {
        type: "decision",
        decision: `completed: ${reason}`,
        eventId,
        evidenceRef: evidenceRefs.join(", "),
      },
    },
    [
      `${write ? "Recorded" : "Would record"} demand completion for ${state.demandKey}.`,
      "No dispatch, automation, or progress doc body update was performed.",
    ],
  );
}

function upsertWindowState(windows, next) {
  const existing = windows.find((item) => item.windowName === next.windowName);
  if (!existing) {
    return [
      ...windows,
      {
        windowName: next.windowName,
        windowState: next.windowState,
        taskPackageIds: [next.taskPackageId],
        targetTaskIds: [next.targetTaskId],
      },
    ];
  }
  return windows.map((item) => {
    if (item.windowName !== next.windowName) return item;
    return {
      ...item,
      windowState: next.windowState,
      taskPackageIds: [...new Set([...(item.taskPackageIds ?? []), next.taskPackageId])],
      targetTaskIds: [...new Set([...(item.targetTaskIds ?? []), next.targetTaskId])],
    };
  });
}

function valuesFor(name) {
  const values = [];
  for (let index = 0; index < options.length; index += 1) {
    const arg = options[index];
    if (arg === name && options[index + 1] && !options[index + 1].startsWith("--")) {
      values.push(options[index + 1]);
      index += 1;
    } else if (arg.startsWith(`${name}=`)) {
      values.push(arg.slice(name.length + 1));
    }
  }
  return values;
}

function readTargetResults(stateRoot) {
  const dir = path.join(stateRoot, "target-results");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(path.join(dir, name), "target result"));
}

function latestResultsByTargetTask(results) {
  const latest = new Map();
  for (const result of results) {
    const existing = latest.get(result.targetTaskId);
    if (!existing || String(result.createdAt ?? "") >= String(existing.createdAt ?? "")) {
      latest.set(result.targetTaskId, result);
    }
  }
  return latest;
}

function reduceWindowStates(windows, targetTasks, results) {
  return windows.map((window) => {
    const tasks = targetTasks.filter((task) => task.targetWindow === window.windowName);
    const statuses = tasks.map((task) => results.get(task.targetTaskId)?.status ?? "missing-result");
    const windowState = statuses.includes("missing-result")
      ? "waiting-results"
      : statuses.includes("blocked")
        ? "blocked-result"
        : "result-ready";
    return { ...window, windowState };
  });
}

function updatePackageStatusesForDecision(taskPackages, targetTasks, candidateTaskIds, nextTaskStatus) {
  return taskPackages.map((item) => {
    const packageTasks = targetTasks.filter((task) => task.taskPackageId === item.taskPackageId);
    const touched = packageTasks.some((task) => candidateTaskIds.has(task.targetTaskId));
    if (!touched) return item;
    const allPackageTasksDecided = packageTasks.length > 0 && packageTasks.every((task) => task.status === nextTaskStatus);
    return {
      ...item,
      status: allPackageTasksDecided ? nextTaskStatus : item.status,
    };
  });
}

try {
  switch (command) {
    case "init":
      commandInit();
      break;
    case "add-task-package":
      commandAddTaskPackage();
      break;
    case "import-target-result":
      commandImportTargetResult();
      break;
    case "reduce-results":
      commandReduceResults();
      break;
    case "decide-review":
      commandDecideReview();
      break;
    case "complete-demand":
      commandCompleteDemand();
      break;
    case "help":
    case "--help":
    case "-h":
      output({ ok: true, command: "help", wrote: false }, [helpText]);
      break;
    default:
      fail(`Unknown controller-state command: ${command}`);
  }
} catch (error) {
  if (!(error instanceof CliExit)) {
    throw error;
  }
}
