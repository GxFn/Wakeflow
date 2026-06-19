#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildWakeflowTrace } from "../lib/wakeflow-trace.mjs";
import { loadWorkspaceConfig, workspaceLedgerPaths } from "./lib/wakeflow-config.mjs";
import {
  detectInterfaceLanguage,
  localizedTemplateName,
  normalizeInterfaceLanguage,
  wakeflowStateLocale,
} from "./lib/wakeflow-language.mjs";
import { controllerReviewScope, reductionStatusForTargetTask } from "./lib/wakeflow-review-scope.mjs";
import { hostProfile } from "./lib/wakeflow-host-profile.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const wakeflowRoot = path.dirname(path.dirname(scriptPath));
const rawArgs = process.argv.slice(2);
const command = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs[0] : "help";
const options = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs.slice(1) : rawArgs;
const workspaceRoot = path.resolve(getValue("--root", wakeflowRoot));
const write = hasFlag("--write");
const json = hasFlag("--json");
const schemaVersion = 1;
const templateRoot = path.join(wakeflowRoot, "templates/wakeflow-state-machine");
const templateBundlePath = path.join(wakeflowRoot, "templates/wakeflow-template-bundle.json");
let templateBundle = undefined;

const helpText = `
Controller state-machine manager

Usage:
  node scripts/wakeflow-state.mjs init --demand-key <key> --title <title> [--goal <text>] [--completion-definition <text>] [--stage-plan <text>] [--language <auto|zh|en>] [--root <workspace>] [--state-root <path>] [--write] [--json]
  node scripts/wakeflow-state.mjs add-task-package --state-root <path> --task-package-id <id> --summary <text> [--source-ref <ref>] [--target-window <window>] [--target-task-id <id>] [--target-summary <text>] [--write] [--json]
  node scripts/wakeflow-state.mjs import-target-result --state-root <path> --target-task-id <id> --target-window <window> --status <completed|blocked|needs-review> [--result-id <id>] [--evidence-ref <ref>] [--verification <text>] [--risk <text>] [--summary <text>] [--write] [--json]
  node scripts/wakeflow-state.mjs reduce-results --state-root <path> [--write] [--json]
  node scripts/wakeflow-state.mjs decide-review --state-root <path> --candidate-id <id> --decision <accept|rework|blocked> --reason <text> [--evidence-ref <ref>] [--accept-blocked] [--write] [--json]
  node scripts/wakeflow-state.mjs complete-demand --state-root <path> --reason <text> --evidence-ref <ref> [--write] [--json]
  node scripts/wakeflow-state.mjs adopt-demand-host --state-root <path> [--reason <text>] [--write] [--json]

Design:
  This script manages the machine state root for the Wakeflow state-machine
  flow. Tracked templates and schemas live in the Wakeflow repository.
  Per-demand state roots are generated under the configured active workspace
  directory by default, which is ignored local/project runtime state.
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
      : "Stop and inspect the reported wakeflow-state issue.";
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

function artifactTrace({ artifactKind, createdAt, ...fields } = {}) {
  return buildWakeflowTrace({
    artifactKind,
    command,
    createdAt,
    root: workspaceRoot,
    source: "wakeflow-state",
    ...fields,
  });
}

function relative(file) {
  const rel = path.relative(workspaceRoot, file).split(path.sep).join("/");
  return rel || ".";
}

function assertWorkspaceRootResolved() {
  // workspaceRoot defaults to the plugin runtime dir when --root is omitted and
  // no host env (WAKEFLOW_DEFAULT_ROOT / CLAUDE_PROJECT_DIR) resolved it. Writing
  // a demand state root there would silently land work inside the installed
  // plugin cache. Real workspaces never carry a plugin manifest at their root,
  // so refuse to write when the resolved root looks like the plugin itself.
  for (const manifest of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
    if (existsSync(path.join(workspaceRoot, manifest))) {
      fail(
        `Refusing to write into the Wakeflow plugin directory (${workspaceRoot}). `
        + "Pass --root <workspace>, or start the MCP server with WAKEFLOW_DEFAULT_ROOT/CLAUDE_PROJECT_DIR set to the workspace.",
      );
    }
  }
}

// Demand-level controller-host ownership. Demand CREATION is host-neutral:
// either platform may init a demand. The binding happens at CLAIM time — the
// first mutating drive command (add-task-package and onward) stamps the
// current host as controllerHost. From then on the other host's controller
// fails closed, and ownership moves only via an explicit --adopt-host.
// Demands from before this feature are simply unclaimed and follow the same
// first-claim rule.
function ensureDemandHostOwnership(state, { claim = true } = {}) {
  const currentHost = hostProfile.runtime.hostDirName;
  const owner = state.controllerHost;
  if (!owner) {
    if (!claim) {
      // Non-state-writing commands (import/intake) must not claim: a stamp
      // they cannot persist would report a transfer that never happened.
      return { controllerHost: null, unclaimed: true };
    }
    state.controllerHost = currentHost;
    return { controllerHost: currentHost, claimed: "first-driving-command" };
  }
  if (owner !== currentHost) {
    if (hasFlag("--adopt-host")) {
      if (!claim) {
        fail(`--adopt-host cannot persist from ${command}; transfer ownership with a state-writing command first (e.g. add-task-package --adopt-host or decide-review --adopt-host).`);
      }
      state.controllerHost = currentHost;
      return { controllerHost: currentHost, transferredFrom: owner };
    }
    fail(`demand ${state.demandKey} is owned by controller host ${owner}; this runtime is ${currentHost}. Continue on the ${owner} controller, or transfer ownership explicitly with adopt-demand-host (MCP: wakeflow_adopt_demand_host), or pass --adopt-host on a state-writing command.`);
  }
  return { controllerHost: owner };
}

function commandAdoptDemandHost() {
  const stateRoot = resolveFromWorkspace(requireValue("--state-root"));
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  if (!existsSync(stateFile)) fail(`state root is missing wakeflow-state.json: ${relative(stateRoot)}`);
  const state = readJson(stateFile, "controller state");
  const currentHost = hostProfile.runtime.hostDirName;
  const previousOwner = state.controllerHost ?? null;
  if (previousOwner === currentHost) {
    output({ ok: true, command: "adopt-demand-host", wrote: false, controllerHost: currentHost, note: "this host already owns the demand" });
    return;
  }
  const reason = getValue("--reason", previousOwner ? `ownership transferred from ${previousOwner}` : "unclaimed demand adopted");
  const createdAt = nowIso();
  const nextRevision = Number(state.revision ?? 0) + 1;
  const eventId = nextEventId(createdAt, nextRevision);
  const nextState = {
    ...state,
    controllerHost: currentHost,
    revision: nextRevision,
    updatedAt: createdAt,
  };
  const event = {
    eventId,
    createdAt,
    actor: "controller",
    type: previousOwner ? "demand.host-transferred" : "demand.host-adopted",
    from: previousOwner,
    to: currentHost,
    reason,
    evidenceRefs: [],
    allowedWrites: ["wakeflow-state.json", "controller-events.jsonl"],
    forbiddenConclusions: [
      "host-transfer-is-acceptance",
      "host-transfer-changes-task-status",
    ],
    stateRevision: nextRevision,
  };
  if (write) {
    writeJson(stateFile, nextState);
    appendJsonLine(eventsFile, event);
  }
  output({
    ok: true,
    command: "adopt-demand-host",
    wrote: write,
    previousOwner,
    controllerHost: currentHost,
    stateRevision: write ? nextRevision : state.revision,
    note: write
      ? undefined
      : "dry-run: pass --write to record the transfer. Existing transition candidates become stale after the revision bump; re-run reduce-results on this host.",
  });
}

function ensureInsideAllowedRoots(file, label, allowedRoots) {
  const absolute = path.resolve(file);
  if (allowedRoots.some((root) => {
    const rel = path.relative(root, absolute);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  })) {
    return;
  }
  fail(`${label} must stay inside the Wakeflow runtime or configured project ledger: ${absolute}`);
}

function readTemplate(name, { language = "en" } = {}) {
  const localizedName = localizedTemplateName(name, language);
  if (localizedName !== name) {
    const localized = readTemplateContent(localizedName);
    if (localized !== null) return localized;
  }
  const content = readTemplateContent(name);
  if (content !== null) return content;
  return readFileSync(path.join(templateRoot, name), "utf8");
}

function readTemplateContent(name) {
  const file = path.join(templateRoot, name);
  if (existsSync(file)) {
    return readFileSync(file, "utf8");
  }
  const bundled = readBundledTemplate(`templates/wakeflow-state-machine/${name}`);
  if (bundled !== null) {
    return bundled;
  }
  return null;
}

function readBundledTemplate(relativePath) {
  const bundle = readTemplateBundle();
  const content = bundle?.files?.[relativePath];
  return typeof content === "string" ? content : null;
}

function readTemplateBundle() {
  if (templateBundle !== undefined) return templateBundle;
  if (!existsSync(templateBundlePath)) {
    templateBundle = null;
    return templateBundle;
  }
  templateBundle = readJson(templateBundlePath, "template bundle");
  return templateBundle;
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

function readJsonIfExists(file, label = "JSON file") {
  if (!existsSync(file)) return null;
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
  if (!existsSync(path.join(stateRoot, "wakeflow-state.json"))) {
    fail(`state root is missing wakeflow-state.json: ${relative(stateRoot)}`);
  }
  return stateRoot;
}

function appendJsonLine(file, value) {
  // Append-mode (O_APPEND) so concurrent writers cannot drop each other's
  // lines, matching the delivery-store implementation.
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value)}\n`, { flag: "a" });
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

function selectInterfaceLanguage(config) {
  const requested = normalizeInterfaceLanguage(getValue("--language", config.interfaceLanguage ?? "auto"));
  if (!requested) fail("--language must be auto, zh, or en.");
  return detectInterfaceLanguage({ requested });
}

function unifiedStatusText({ demandKey, title, state, updatedAt, revision, eventId, language }) {
  const locale = wakeflowStateLocale(language);
  return render(readTemplate("unified-status.template.md", { language }), {
    demandKey,
    title,
    state,
    stage: locale.none,
    taskPackages: locale.none,
    windows: locale.none,
    blockers: locale.none,
    nextAction: locale.initialNextAction,
    review: locale.none,
    automation: locale.automationDisabled,
    decisionsRequired: locale.none,
    updatedAt: beijingTimestamp(updatedAt),
    revision,
    eventId,
  }).trimEnd();
}

function progressDocText({ demandKey, title, goal, completionDefinition, stagePlan, unifiedStatus, language }) {
  const template = readTemplate("developer-progress.template.md", { language });
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
  assertWorkspaceRootResolved();
  const demandKey = requireValue("--demand-key");
  const title = requireValue("--title");
  const config = loadWorkspaceConfig({ workspaceRoot, args: options });
  const language = selectInterfaceLanguage(config);
  const locale = wakeflowStateLocale(language);
  const goal = getValue("--goal", locale.defaultGoal);
  const completionDefinition = getValue("--completion-definition", locale.defaultCompletionDefinition);
  const stagePlan = getValue("--stage-plan", locale.defaultStagePlan);
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
    state: path.join(stateRoot, "wakeflow-state.json"),
    events: path.join(stateRoot, "controller-events.jsonl"),
    projection: path.join(stateRoot, "projection.json"),
    progress: path.join(stateRoot, progressDoc),
  };

  const demand = {
    schemaVersion,
    demandKey,
    title,
    interfaceLanguage: language,
    goal,
    completionDefinition,
    createdAt,
    source: {
      kind: "wakeflow-state-init",
      trackedTemplates: "templates/wakeflow-state-machine",
      generatedStateRoot: relative(stateRoot),
    },
  };
  const state = {
    schemaVersion,
    demandKey,
    title,
    interfaceLanguage: language,
    // Demand creation is host-neutral: controllerHost stays unset until the
    // first driving command claims the demand for its platform.
    controllerHost: null,
    state: "intake",
    stateReason: "wakeflow-state-init",
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
      interfaceLanguage: language,
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
    reason: "wakeflow-state-init",
    evidenceRefs: [],
    allowedWrites: [
      "demand.json",
      "wakeflow-state.json",
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
    language,
  });
  const projection = {
    schemaVersion,
    demandKey,
    title,
    interfaceLanguage: language,
    sourceRevision: state.revision,
    sourceEventId: eventId,
    progressDoc,
    unifiedStatus: {
      demand: `${demandKey} - ${title}`,
      mainState: state.state,
      stage: locale.none,
      currentTaskPackages: locale.none,
      windows: locale.none,
      blockers: locale.none,
      nextAction: locale.initialNextAction,
      review: locale.none,
      automation: locale.automationDisabled,
      userDecisionsNeeded: locale.none,
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
    language,
  });
  const lazyStateDirectories = [
    path.join(stateRoot, "intake"),
    path.join(stateRoot, "test-cards"),
    path.join(stateRoot, "task-packages"),
    path.join(stateRoot, "target-results"),
    path.join(stateRoot, "evidence"),
    path.join(stateRoot, "transition-candidates"),
  ];
  const outputs = [
    files.demand,
    files.state,
    files.events,
    files.projection,
    files.progress,
  ];

  if (write) {
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
      generatedRuntimeBoundary: ".workspace-active is ignored by the Wakeflow repository; tracked assets are templates, schemas, scripts, skills, and tests.",
      lazyStateDirectories: lazyStateDirectories.map(relative),
      localDeliveryRuntime: ".workspace-local/wakeflow-delivery",
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
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const packageFile = path.join(stateRoot, "task-packages", `${slug(taskPackageId)}.json`);
  const state = readJson(stateFile, "controller state");
  const hostOwnership = ensureDemandHostOwnership(state);

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
      ? ["prepare-dispatch-from-state", "add-task-package", "wakeflow-render-progress"]
      : ["add-task-package", "wakeflow-render-progress"],
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
      "wakeflow-state.json",
      "controller-events.jsonl",
      `task-packages/${slug(taskPackageId)}.json`,
    ],
    forbiddenConclusions: [
      "task-package-is-dispatch",
      "task-package-is-acceptance",
      "task-package-updates-progress-doc-status",
    ],
    stateRevision: nextRevision,
    ...(hostOwnership.claimed || hostOwnership.transferredFrom ? { hostOwnership } : {}),
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
      hostOwnership,
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
      "Projection is stale until wakeflow-render-progress updates Unified Status.",
      "No automation, thread registration, dispatch, or acceptance was performed.",
    ],
  );
}

function deliveryEnvelopeFileForId(deliveryId) {
  return path.join(workspaceRoot, ".workspace-local/wakeflow-delivery/delivery-envelopes", `${slug(deliveryId)}.json`);
}

function targetTaskDeliveryContext(targetTask) {
  const delivery = targetTask.delivery ?? null;
  const deliveryId = delivery?.deliveryId ?? null;
  const envelopeFile = delivery?.deliveryFile
    ? resolveFromWorkspace(delivery.deliveryFile)
    : deliveryId
      ? deliveryEnvelopeFileForId(deliveryId)
      : null;
  if (envelopeFile) {
    ensureInsideAllowedRoots(envelopeFile, "delivery envelope", [workspaceRoot]);
  }
  const envelope = envelopeFile ? readJsonIfExists(envelopeFile, "delivery envelope") : null;
  const returnRoute = envelope?.returnRoute ?? null;
  const returnPolicy = envelope?.returnPolicy ?? null;
  const dispatchGroup = envelope?.dispatchGroup ?? delivery?.dispatchGroup ?? null;

  return {
    deliveryId,
    deliveryFile: delivery?.deliveryFile ?? null,
    deliveryRunId: delivery?.deliveryRunId ?? null,
    dispatchGroup,
    deliveryEnvelopeFile: envelope ? relative(envelopeFile) : null,
    deliveryEnvelopeFound: Boolean(envelope),
    resolution: !deliveryId
      ? "state-only-result"
      : !envelope
        ? "missing-delivery-envelope"
        : returnRoute === "controller"
          ? "controller-return-required"
          : "no-controller-return",
    returnRoute,
    returnPolicy,
    controllerWindow: envelope?.controllerWindow ?? null,
    controllerReturnRequired: returnRoute === "controller",
  };
}

function targetResultAgentNext(deliveryContext, reviewReadiness) {
  // The controller-return is the loop's wake-up: when the envelope requires
  // it, that guidance always wins; the reduce hint only applies otherwise.
  if (!deliveryContext.controllerReturnRequired && reviewReadiness && reviewReadiness.readyForReduce) {
    return "Target result is recorded, but this is not controller acceptance. All open target tasks now have results: run reduce-results to form the review candidate, then decide.";
  }
  if (deliveryContext.controllerReturnRequired) {
    return "Target result is recorded, but this is not controller acceptance. The resolved delivery envelope has returnRoute=controller; run wakeflow_review_pack, prepare a controller-return delivery, send it with the host thread tool, then run wakeflow_record_delivery for that controller-return envelope.";
  }
  if (deliveryContext.deliveryId && !deliveryContext.deliveryEnvelopeFound) {
    return "Target result is recorded, but this is not controller acceptance. The target task references a delivery id, but the local delivery envelope was not found; stop and report the missing local delivery envelope instead of assuming no controller callback.";
  }
  if (!deliveryContext.deliveryId) {
    // state-only results (controller/self tasks, direct imports) are a normal
    // shape, not an anomaly worth a stop-and-report tone
    return "State-only target result recorded (no delivery metadata on this task - normal for controller/self tasks). Reduce when the demand remaining results are in.";
  }
  return "Target result is recorded, but this is not controller acceptance. The resolved delivery envelope does not require a controller return; stop unless the controller sends another task.";
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
  const state = readJson(path.join(stateRoot, "wakeflow-state.json"), "controller state");
  const hostOwnership = ensureDemandHostOwnership(state, { claim: false });
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
  const explicitResultId = getValue("--result-id", null);
  let resultId = explicitResultId ?? `tr-${slug(targetTaskId)}`;
  let resultFile = path.join(stateRoot, "target-results", `${slug(resultId)}.json`);
  if (existsSync(resultFile)) {
    if (explicitResultId) {
      fail(`target result already exists: ${relative(resultFile)}`);
    }
    // Default-id collision is the normal rework cycle (decide-review rework ->
    // re-dispatch -> new result for the same target task). Auto-disambiguate
    // with a timestamp; reduce-results already picks the latest by createdAt.
    const stamp = nowIso().replace(/[^0-9]/g, "").slice(0, 14);
    resultId = `tr-${slug(targetTaskId)}-${stamp}`;
    resultFile = path.join(stateRoot, "target-results", `${slug(resultId)}.json`);
    if (existsSync(resultFile)) {
      fail(`target result already exists: ${relative(resultFile)}`);
    }
  }
  const createdAt = nowIso();
  const evidenceRefs = valuesFor("--evidence-ref");
  const verification = valuesFor("--verification");
  const risks = valuesFor("--risk");
  const deliveryContext = targetTaskDeliveryContext(targetTask);
  const result = {
    schemaVersion,
    resultId,
    demandKey: state.demandKey,
    taskPackageId: targetTask.taskPackageId,
    dispatchGroup: deliveryContext.dispatchGroup ?? undefined,
    stateRoot: relative(stateRoot),
    targetWindow,
    targetTaskId,
    status,
    summary: getValue("--summary", ""),
    evidenceRefs,
    verification,
    risks,
    deliveryContext,
    controllerActionRequired: Boolean(deliveryContext.controllerReturnRequired),
    wakeflowTrace: artifactTrace({
      artifactKind: "target-result",
      createdAt,
      demandKey: state.demandKey,
      dispatchGroup: deliveryContext.dispatchGroup ?? undefined,
      resultId,
      stateRevision: state.revision,
      stateRoot: relative(stateRoot),
      targetTaskId,
      targetWindow,
      taskPackageId: targetTask.taskPackageId,
    }),
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
  // Release the shared in-flight window lock when this result answers the
  // delivery that locked it. This is the only release point reachable from the
  // MCP-only flow (wakeflow_record_target_result maps here), so without it
  // codex-side locks would linger the full TTL after the work finished.
  let lockReleased = false;
  if (write) {
    const lockFile = path.join(workspaceRoot, ".workspace-local/wakeflow-delivery/locks", `${slug(targetWindow)}.json`);
    if (existsSync(lockFile)) {
      try {
        const lock = JSON.parse(readFileSync(lockFile, "utf8"));
        const taskDeliveryId = targetTask.delivery?.deliveryId;
        if (!lock.deliveryId || (taskDeliveryId && lock.deliveryId === taskDeliveryId)) {
          unlinkSync(lockFile);
          lockReleased = true;
        }
      } catch {
        // unreadable lock: leave it for release-window-lock recovery
      }
    }
  }

  // Review readiness: which open tasks still lack a result AFTER this import,
  // so the controller never runs speculative reduce rounds to find out.
  const resultsScanDir = path.join(stateRoot, "target-results");
  const taskIdsWithResults = new Set([targetTaskId]);
  if (existsSync(resultsScanDir)) {
    for (const name of readdirSync(resultsScanDir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const recorded = JSON.parse(readFileSync(path.join(resultsScanDir, name), "utf8"));
        if (recorded && recorded.targetTaskId) taskIdsWithResults.add(recorded.targetTaskId);
      } catch {
        // unreadable results are reduce concern, not readiness
      }
    }
  }
  const remainingTaskIds = (state.targetTasks ?? [])
    .filter((task) => task.status !== "accepted" && !taskIdsWithResults.has(task.targetTaskId))
    .map((task) => task.targetTaskId);
  const reviewReadiness = {
    remainingTaskIds,
    readyForReduce: remainingTaskIds.length === 0,
  };

  output(
    {
      ok: true,
      command: "import-target-result",
      reviewReadiness,
      lockReleased,
      hostOwnership,
      wrote: write,
      demandKey: state.demandKey,
      stateRoot: relative(stateRoot),
      resultId,
      resultFile: relative(resultFile),
      targetTaskId,
      status,
      dispatchGroup: deliveryContext.dispatchGroup,
      deliveryContext,
      controllerReturn: {
        required: Boolean(deliveryContext.controllerReturnRequired),
        route: deliveryContext.returnRoute,
        policy: deliveryContext.returnPolicy,
        deliveryEnvelopeFile: deliveryContext.deliveryEnvelopeFile,
        nextCommands: deliveryContext.controllerReturnRequired
          ? [
              "wakeflow_review_pack",
              "wakeflow_prepare_delivery direction=controller-return",
              "send envelope.prompt with the host thread tool",
              "wakeflow_record_delivery",
            ]
          : [],
      },
      stateRevisionUnchanged: state.revision,
      nextSuggestedCommand: "reduce-results",
      forbiddenConclusions: result.forbiddenConclusions,
      agentNext: targetResultAgentNext(deliveryContext, reviewReadiness),
    },
    [
      `${write ? "Imported" : "Would import"} target result ${resultId}.`,
      "Controller state was not changed; return to the controller when the delivery policy allows it.",
    ],
  );
}

function commandReduceResults() {
  const stateRoot = stateRootFromArg();
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const state = readJson(stateFile, "controller state");
  const hostOwnership = ensureDemandHostOwnership(state);
  if (["completed", "archived"].includes(state.state)) {
    fail(`cannot reduce results while demand is ${state.state}: ${state.demandKey}`);
  }
  const allTargetTasks = state.targetTasks ?? [];
  if (allTargetTasks.length === 0) {
    fail("controller state has no target tasks to reduce.");
  }
  const reviewScope = controllerReviewScope(allTargetTasks);
  const targetTasks = reviewScope.reviewableTargetTasks;
  if (targetTasks.length === 0) {
    fail("controller state has no open target tasks to reduce; complete the demand or add the next task package by total-control judgment.");
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
    reviewScope: reviewScope.mode,
    targetTaskIds: reviewScope.targetTaskIds,
    excludedTargetTaskIds: reviewScope.excludedTargetTaskIds,
    allowedDecisions: ["accept", "rework", "blocked"],
    evidenceRefs: [...new Set(evidenceRefs)],
    wakeflowTrace: artifactTrace({
      artifactKind: "transition-candidate",
      candidateId,
      createdAt,
      demandKey: state.demandKey,
      stateRevision: nextRevision,
      stateRoot: relative(stateRoot),
    }),
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
    targetTasks: allTargetTasks.map((task) => {
      if (!reviewScope.targetTaskIds.includes(task.targetTaskId)) return task;
      const result = results.get(task.targetTaskId);
      return {
        ...task,
        status: reductionStatusForTargetTask(task, result),
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
      "wakeflow-state.json",
      "controller-events.jsonl",
      ...(candidate ? [`transition-candidates/${slug(candidate.candidateId)}.json`] : []),
    ],
    forbiddenConclusions: [
      "review-reduction-is-acceptance",
      "review-reduction-is-dispatch",
      "review-reduction-closes-task-package",
    ],
    stateRevision: nextRevision,
    ...(hostOwnership.claimed || hostOwnership.transferredFrom ? { hostOwnership } : {}),
    wakeflowTrace: artifactTrace({
      artifactKind: "controller-event",
      createdAt,
      demandKey: state.demandKey,
      stateRevision: nextRevision,
      stateRoot: relative(stateRoot),
    }),
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
      hostOwnership,
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
      reviewScope: reviewScope.mode,
      targetTaskIds: reviewScope.targetTaskIds,
      excludedTargetTaskIds: reviewScope.excludedTargetTaskIds,
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
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const state = readJson(stateFile, "controller state");
  const hostOwnership = ensureDemandHostOwnership(state);
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
  if (decision === "accept" && (candidate.blockedResultIds?.length ?? 0) > 0 && !hasFlag("--accept-blocked")) {
    // Accepting over a blocked target result must be an explicit controller
    // override, never a silent sweep into "accepted".
    fail(`transition candidate ${candidateId} contains blocked target results (${candidate.blockedResultIds.join(", ")}); decide rework or blocked, or pass --accept-blocked to explicitly accept over them.`);
  }
  const createdAt = nowIso();
  const nextRevision = Number(state.revision ?? 0) + 1;
  const eventId = nextEventId(createdAt, nextRevision);
  const evidenceRefs = [...new Set([...(candidate.evidenceRefs ?? []), ...valuesFor("--evidence-ref")])];
  const nextMainState = decision === "accept" ? "planned" : decision === "rework" ? "needs-rework" : "blocked";
  const nextTaskStatus = decision === "accept" ? "accepted" : decision === "rework" ? "needs-rework" : "blocked";
  const rawCandidateTaskIds = new Set(candidate.targetTaskIds ?? []);
  const knownCandidateTasks = (state.targetTasks ?? []).filter((item) => rawCandidateTaskIds.has(item.targetTaskId));
  const unknownCandidateTaskIds = [...rawCandidateTaskIds].filter((targetTaskId) => !knownCandidateTasks.some((item) => item.targetTaskId === targetTaskId));
  if (unknownCandidateTaskIds.length > 0) {
    fail(`transition candidate ${candidateId} references unknown target tasks: ${unknownCandidateTaskIds.join(", ")}`);
  }
  const decisionScope = controllerReviewScope(knownCandidateTasks);
  if (decisionScope.targetTaskIds.length === 0) {
    fail(`transition candidate ${candidateId} has no open target tasks to decide; complete the demand or add the next task package by total-control judgment.`);
  }
  const candidateTaskIds = new Set(decisionScope.targetTaskIds);
  const nextTargetTasks = (state.targetTasks ?? []).map((item) => candidateTaskIds.has(item.targetTaskId)
    ? (decision === "rework"
        ? {
            ...item,
            status: nextTaskStatus,
            reviewDecision: decision,
            // RA2: per-task handling count — a rework decision is one rework cycle.
            counts: { ...(item.counts ?? {}), reworkCount: (item.counts?.reworkCount ?? 0) + 1 },
          }
        : {
            ...item,
            status: nextTaskStatus,
            reviewDecision: decision,
          })
    : item);
  const nextState = {
    ...state,
    state: nextMainState,
    stateReason: reason,
    revision: nextRevision,
    updatedAt: createdAt,
    allowedActions: decision === "accept"
      ? ["add-task-package", "complete-demand", "wakeflow-render-progress"]
      : decision === "rework"
        ? ["add-task-package", "wakeflow-render-progress"]
        : ["wakeflow-render-progress"],
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
      // An explicit accept/rework decision IS the unblock decision the
      // review-blocker waits for: clear review-blockers so the demand can
      // move again; non-review blockers stay.
      : (state.blockers ?? []).filter((blocker) => blocker?.kind !== "review-blocker"),
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
      "wakeflow-state.json",
      "controller-events.jsonl",
    ],
    forbiddenConclusions: [
      "decision-creates-dispatch",
      "decision-updates-progress-doc-body",
      "decision-starts-automation",
    ],
    stateRevision: nextRevision,
    ...(hostOwnership.claimed || hostOwnership.transferredFrom ? { hostOwnership } : {}),
  };

  if (write) {
    writeJson(stateFile, nextState);
    appendJsonLine(eventsFile, event);
  }

  output(
    {
      ok: true,
      command: "decide-review",
      hostOwnership,
      wrote: write,
      demandKey: state.demandKey,
      stateRoot: relative(stateRoot),
      candidateId,
      decision,
      previousState: state.state,
      nextState: nextMainState,
      targetTaskIds: decisionScope.targetTaskIds,
      excludedTargetTaskIds: decisionScope.excludedTargetTaskIds,
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
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const state = readJson(stateFile, "controller state");
  const hostOwnership = ensureDemandHostOwnership(state);
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
    allowedActions: ["wakeflow-render-progress"],
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
      "wakeflow-state.json",
      "controller-events.jsonl",
    ],
    forbiddenConclusions: [
      "completion-creates-dispatch",
      "completion-skips-evidence-review",
      "completion-updates-progress-doc-body",
    ],
    stateRevision: nextRevision,
    ...(hostOwnership.claimed || hostOwnership.transferredFrom ? { hostOwnership } : {}),
  };

  if (write) {
    writeJson(stateFile, nextState);
    appendJsonLine(eventsFile, event);
  }

  output(
    {
      ok: true,
      command: "complete-demand",
      hostOwnership,
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
    if (tasks.length === 0) return window;
    const statuses = tasks.map((task) => reductionStatusForTargetTask(task, results.get(task.targetTaskId)));
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
    case "adopt-demand-host":
      commandAdoptDemandHost();
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
      fail(`Unknown wakeflow-state command: ${command}`);
  }
} catch (error) {
  if (!(error instanceof CliExit)) {
    throw error;
  }
}
