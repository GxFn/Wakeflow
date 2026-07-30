#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { hostProfile } from "./lib/wakeflow-host-profile.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspaceConfig, workspaceLedgerPaths } from "./lib/wakeflow-config.mjs";
import {
  detectInterfaceLanguage,
  localizedTemplateName,
  normalizeInterfaceLanguage,
  wakeflowStateLocale,
} from "./lib/wakeflow-language.mjs";
import { WakeflowStateLockTimeoutError, withStateRootLock } from "./lib/wakeflow-state-lock.mjs";
import { refreshWorkspaceProjection } from "./lib/wakeflow-workspace-projection.mjs";
import {
  controllerEventStateAlignment,
  futureControllerEvents,
  readControllerEventsStrict,
  WakeflowControllerEventLogError,
} from "./lib/wakeflow-controller-events.mjs";
import {
  assertStateAuthorityPaths,
  recoverPendingStateTransition,
  WakeflowPendingTransitionError,
} from "./lib/wakeflow-state-transition.mjs";
import {
  resolveStateRootFilePath,
  WakeflowStatePathError,
} from "./lib/wakeflow-state-paths.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const wakeflowRoot = path.dirname(path.dirname(scriptPath));
const rawArgs = process.argv.slice(2);
const workspaceRoot = path.resolve(getValue("--root", wakeflowRoot));
const write = rawArgs.includes("--write");
const json = rawArgs.includes("--json");
const templateRoot = path.join(wakeflowRoot, "templates/wakeflow-state-machine");
const templateBundlePath = path.join(wakeflowRoot, "templates/wakeflow-template-bundle.json");
let templateBundle = undefined;

class CliExit extends Error {}

function getValue(name, fallback = null) {
  const eq = rawArgs.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = rawArgs.indexOf(name);
  if (index >= 0 && rawArgs[index + 1] && !rawArgs[index + 1].startsWith("--")) {
    return rawArgs[index + 1];
  }
  return fallback;
}

function output(payload, textLines = []) {
  const complete = { scriptComplete: true, ...payload };
  if (!complete.agentNext) {
    complete.agentNext = complete.ok
      ? "Continue by total-control judgment; rendering does not dispatch or accept work."
      : "Stop and inspect the reported progress projection issue.";
  }
  if (json) {
    console.log(JSON.stringify(complete, null, 2));
    return;
  }
  for (const line of textLines) console.log(line);
  console.log(`Agent next: ${complete.agentNext}`);
}

function fail(message, options = {}) {
  output({
    ok: false,
    command: "wakeflow-render-progress",
    error: message,
    ...(options.errorCode ? { errorCode: options.errorCode } : {}),
    ...(options.errorCode || options.retryable !== undefined || options.recovery
      ? {
          diagnostics: {
            code: options.errorCode || "wakeflow-render-progress-error",
            severity: "error",
            plane: "projection",
            retryable: options.retryable ?? false,
            ...(options.recovery ? { recovery: options.recovery } : {}),
          },
        }
      : {}),
  });
  process.exitCode = 1;
  throw new CliExit(message);
}

function requireValue(name) {
  const value = getValue(name);
  if (!value) fail(`${name} is required.`);
  return value;
}

function relative(file) {
  const rel = path.relative(workspaceRoot, file).split(path.sep).join("/");
  return rel || ".";
}

function ensureInsideAllowedRoots(file, label, allowedRoots) {
  const absolute = path.resolve(file);
  const resolved = realPathWithMissingTail(absolute);
  if (allowedRoots.some((root) => {
    const resolvedRoot = realPathWithMissingTail(path.resolve(root));
    const rel = path.relative(resolvedRoot, resolved);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  })) {
    return;
  }
  fail(`${label} must stay inside the Wakeflow runtime or configured project ledger: ${absolute}`);
}

function realPathWithMissingTail(file) {
  const tail = [];
  let cursor = path.resolve(file);
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) return path.resolve(file);
    tail.unshift(path.basename(cursor));
    cursor = parent;
  }
  return path.resolve(realpathSync(cursor), ...tail);
}

function resolveFromWorkspace(value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspaceRoot, value);
}

function stateRootFromArg() {
  const stateRoot = resolveFromWorkspace(requireValue("--state-root"));
  const config = loadWorkspaceConfig({ workspaceRoot, args: rawArgs });
  const ledgerPaths = workspaceLedgerPaths({ workspaceRoot, args: rawArgs, config });
  ensureInsideAllowedRoots(stateRoot, "state root", [
    workspaceRoot,
    ledgerPaths.projectLedgerRoot,
    ledgerPaths.workspaceDocsDir,
    ledgerPaths.workspaceCurrentDir,
    ledgerPaths.workspaceArchiveDir,
  ]);
  try {
    assertStateAuthorityPaths({ stateRoot });
  } catch (error) {
    if (error instanceof WakeflowPendingTransitionError) {
      fail(`${error.message}. Refusing to follow a non-canonical state authority path.`);
    }
    throw error;
  }
  return stateRoot;
}

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`Invalid ${label} ${relative(file)}: ${error.message}`);
  }
  return null;
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

function eventsForSnapshot(stateRoot, state, eventsFile) {
  let events;
  try {
    events = readControllerEventsStrict(eventsFile);
  } catch (error) {
    if (error instanceof WakeflowControllerEventLogError) {
      fail(
        `${error.message} (${relative(eventsFile)}). Repair the controller event log before rendering; no projection was written.`,
        {
          errorCode: "delivery-event-log-repair-required",
          retryable: true,
          recovery: {
            strategy: "repair-event-log-then-render",
            stateRoot: relative(stateRoot),
            eventsFile: relative(eventsFile),
            stateRevision: state.revision,
            lineNumber: error.lineNumber,
          },
        },
      );
    }
    throw error;
  }
  let pendingRecovery;
  try {
    pendingRecovery = recoverPendingStateTransition({
      stateRoot,
      state,
      events,
      write: false,
    });
  } catch (error) {
    if (error instanceof WakeflowPendingTransitionError) {
      fail(
        `${error.message}. Inspect ${relative(stateRoot)} before rendering; no projection was written.`,
        {
          errorCode: "controller-event-manual-recovery-required",
          retryable: false,
          recovery: {
            strategy: "inspect-state-event-transition-journal",
            stateRoot: relative(stateRoot),
            eventsFile: relative(eventsFile),
            stateRevision: state.revision,
          },
        },
      );
    }
    throw error;
  }
  if (pendingRecovery.status !== "none") {
    fail(
      `pending controller transition ${pendingRecovery.eventId ?? "(unknown)"} must be recovered explicitly before rendering. No projection was written.`,
      {
        errorCode: "state-transition-recovery-required",
        retryable: true,
        recovery: {
          strategy: "run-recover-state-transition",
          stateRoot: relative(stateRoot),
          eventsFile: relative(eventsFile),
          stateRevision: state.revision,
          reservedRevision: pendingRecovery.targetRevision,
          eventId: pendingRecovery.eventId,
          reason: pendingRecovery.reason,
        },
      },
    );
  }
  const alignment = controllerEventStateAlignment(events, state.revision);
  if (alignment.status === "event-ahead") {
    const firstReserved = futureControllerEvents(events, state.revision)[0]
      ?? alignment.latestEvent;
    const reservedRun = firstReserved.wakeflowTrace?.deliveryRunId;
    fail(
      `controller event revision ${firstReserved.stateRevision} is reserved ahead of state revision ${state.revision}; ${
        reservedRun
          ? `replay delivery run ${reservedRun}`
          : "no matching transition journal exists, so manual recovery is required"
      } before rendering. No projection was written.`,
      {
        errorCode: reservedRun
          ? "delivery-state-recovery-required"
          : "controller-event-manual-recovery-required",
        retryable: Boolean(reservedRun),
        recovery: {
          strategy: reservedRun
            ? "replay-reserved-delivery-run-first"
            : "inspect-state-event-transition-journal",
          stateRoot: relative(stateRoot),
          eventsFile: relative(eventsFile),
          stateRevision: state.revision,
          reservedRevision: firstReserved.stateRevision,
          reservedDeliveryRunId: reservedRun,
        },
      },
    );
  }
  if (alignment.status === "state-ahead") {
    fail(
      `controller state revision ${state.revision} is ahead of event log revision ${alignment.latestEventRevision}; no matching transition journal exists, so manual recovery is required before rendering. No projection was written.`,
      {
        errorCode: "controller-event-manual-recovery-required",
        retryable: false,
        recovery: {
          strategy: "inspect-state-event-transition-journal",
          stateRoot: relative(stateRoot),
          eventsFile: relative(eventsFile),
          stateRevision: state.revision,
          latestEventRevision: alignment.latestEventRevision,
        },
      },
    );
  }
  return events;
}

function selectInterfaceLanguage(state, config) {
  const requested = normalizeInterfaceLanguage(
    getValue("--language", state.interfaceLanguage ?? state.projection?.interfaceLanguage ?? config.interfaceLanguage ?? "auto"),
  );
  if (!requested) fail("--language must be auto, zh, or en.");
  return detectInterfaceLanguage({ requested });
}

function summarizeItems(items, idKey, statusKey = "status", locale = wakeflowStateLocale("en")) {
  if (!Array.isArray(items) || items.length === 0) return locale.none;
  return items.map((item) => `${item[idKey] ?? "unknown"}(${item[statusKey] ?? "unknown"})`).join(", ");
}

function summarizeWindows(windows, locale = wakeflowStateLocale("en")) {
  if (!Array.isArray(windows) || windows.length === 0) return locale.none;
  return windows.map((item) => `${item.windowName ?? "unknown"}(${item.windowState ?? "unknown"})`).join(", ");
}

function summarizeBlockers(blockers, locale = wakeflowStateLocale("en")) {
  if (!Array.isArray(blockers) || blockers.length === 0) return locale.none;
  return blockers.map((item) => item.summary ?? item.reason ?? item.id ?? "blocker").join(", ");
}

// RA5: a generated, navigable state-root index. State-driven and stamped with revision +
// eventId (no wall-clock), so regenerating against the same state is idempotent. Links the
// fixed core records, lists task packages / target tasks, and links the evidence subdirs so
// an agent can find any record from one entry point.
function buildStateRootIndex(state, stateRoot, progressDoc, eventId) {
  const lines = [
    `# ${state.demandKey} — ${state.title}`,
    "",
    `> State-root index. Generated from wakeflow-state.json (revision ${state.revision}, event ${eventId}). Regenerate with wakeflow-render-progress; do not hand-edit.`,
    "",
    "## Core records",
    "",
    "- [demand.json](demand.json) — immutable demand record",
    `- [wakeflow-state.json](wakeflow-state.json) — authoritative state machine (state: ${state.state}, revision ${state.revision})`,
    "- [controller-events.jsonl](controller-events.jsonl) — append-only controller event log",
    "- [projection.json](projection.json) — machine-readable projection + structured slices",
    `- [${progressDoc}](${progressDoc}) — human progress document`,
    "",
    "## Task packages",
    "",
  ];
  const packages = state.taskPackages ?? [];
  if (packages.length === 0) {
    lines.push("_None yet._");
  } else {
    for (const pkg of packages) {
      lines.push(`- \`${pkg.taskPackageId}\` (${pkg.status ?? "unknown"}) — ${pkg.summary ?? ""}`);
    }
  }
  lines.push("", "## Target tasks", "");
  const tasks = state.targetTasks ?? [];
  if (tasks.length === 0) {
    lines.push("_None yet._");
  } else {
    for (const task of tasks) {
      lines.push(`- \`${task.targetTaskId}\` -> window \`${task.targetWindow}\` (${task.status ?? "unknown"})`);
    }
  }
  lines.push("", "## Sub-directories", "");
  for (const dir of ["task-packages", "target-results", "transition-candidates", "intake", "test-cards", "evidence", "focus"]) {
    const present = existsSync(path.join(stateRoot, dir));
    lines.push(present ? `- [${dir}/](${dir}/)` : `- \`${dir}/\` — _(not present)_`);
  }
  lines.push("");
  return lines.join("\n");
}

function nextActionFor(state, locale) {
  if (Array.isArray(state.allowedActions) && state.allowedActions.length > 0) {
    return state.allowedActions.join(", ");
  }
  if (state.projection?.status === "stale") {
    return locale.staleNextAction;
  }
  return locale.initialNextAction;
}

function displayMachineNone(value, locale) {
  return value && value !== "none" ? value : locale.none;
}

try {
  const stateRoot = stateRootFromArg();
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const projectionFile = path.join(stateRoot, "projection.json");
  const state = readJson(stateFile, "controller state");
  const config = loadWorkspaceConfig({ workspaceRoot, args: rawArgs });
  const language = selectInterfaceLanguage(state, config);
  const locale = wakeflowStateLocale(language);
  const event = eventsForSnapshot(stateRoot, state, eventsFile).at(-1) ?? null;
  const configuredProgressDoc = state.projection?.progressDoc ?? "developer-progress.md";
  let progressFile;
  try {
    progressFile = resolveStateRootFilePath(stateRoot, configuredProgressDoc, {
      label: "progress document",
      requireExisting: true,
    });
  } catch (error) {
    if (error instanceof WakeflowStatePathError) {
      fail(`${error.message}. Refusing to render a progress document outside the state root.`);
    }
    throw error;
  }
  const progressDoc = path.relative(stateRoot, progressFile).split(path.sep).join("/");

  const renderedAt = new Date().toISOString();
  const statusValues = {
    demandKey: state.demandKey,
    title: state.title,
    state: state.state,
    stage: state.activeStageId ?? locale.none,
    taskPackages: summarizeItems(state.taskPackages, "taskPackageId", "status", locale),
    windows: summarizeWindows(state.windows, locale),
    blockers: summarizeBlockers(state.blockers, locale),
    nextAction: nextActionFor(state, locale),
    review: displayMachineNone(state.review?.status, locale),
    automation: state.automation?.enabled ? locale.automationEnabled : locale.automationDisabled,
    decisionsRequired: summarizeBlockers(state.decisionsRequired, locale),
    updatedAt: beijingTimestamp(renderedAt),
    revision: state.revision,
    eventId: event?.eventId ?? locale.none,
  };
  const unifiedStatus = render(readTemplate("unified-status.template.md", { language }), statusValues).trimEnd();
  const projection = {
    schemaVersion: 1,
    demandKey: state.demandKey,
    title: state.title,
    interfaceLanguage: language,
    sourceRevision: state.revision,
    sourceEventId: event?.eventId ?? "none",
    progressDoc,
    unifiedStatus: {
      demand: `${state.demandKey} - ${state.title}`,
      mainState: state.state,
      stage: statusValues.stage,
      currentTaskPackages: statusValues.taskPackages,
      windows: statusValues.windows,
      blockers: statusValues.blockers,
      nextAction: statusValues.nextAction,
      review: statusValues.review,
      automation: statusValues.automation,
      userDecisionsNeeded: statusValues.decisionsRequired,
      lastUpdated: renderedAt,
    },
    // RA5: structured machine-extractable slices alongside the lossy display strings, so a
    // consumer can pull per-window/per-task data as JSON without re-parsing wakeflow-state.json.
    slices: {
      windows: (state.windows ?? []).map((item) => ({
        windowName: item.windowName,
        windowState: item.windowState ?? null,
        taskPackageIds: item.taskPackageIds ?? [],
        targetTaskIds: item.targetTaskIds ?? [],
      })),
      taskPackages: (state.taskPackages ?? []).map((item) => ({
        taskPackageId: item.taskPackageId,
        status: item.status ?? null,
        summary: item.summary ?? null,
      })),
      targetTasks: (state.targetTasks ?? []).map((item) => ({
        targetTaskId: item.targetTaskId,
        taskPackageId: item.taskPackageId,
        targetWindow: item.targetWindow,
        status: item.status ?? null,
        reviewDecision: item.reviewDecision ?? null,
        counts: item.counts ?? null,
      })),
      blockers: (state.blockers ?? []).map((item) => ({
        id: item.id ?? null,
        summary: item.summary ?? item.reason ?? null,
      })),
      decisionsRequired: (state.decisionsRequired ?? []).map((item) => ({
        id: item.id ?? null,
        summary: item.summary ?? item.reason ?? null,
      })),
    },
  };
  const stateRootIndex = buildStateRootIndex(state, stateRoot, progressDoc, event?.eventId ?? "none");
  const indexFile = path.join(stateRoot, "index.md");
  const progress = readFileSync(progressFile, "utf8");
  const matches = progress.match(/<!-- unified-status:start -->[\s\S]*?<!-- unified-status:end -->/g) ?? [];
  if (matches.length !== 1) {
    fail(`progress doc must contain exactly one unified-status marker block; found ${matches.length}.`);
  }
  const nextProgress = progress.replace(
    /<!-- unified-status:start -->[\s\S]*?<!-- unified-status:end -->/,
    `<!-- unified-status:start -->\n${unifiedStatus}\n<!-- unified-status:end -->`,
  );
  const nextState = {
    ...state,
    projection: {
      ...(state.projection ?? {}),
      status: "synced",
      lastRenderedAt: renderedAt,
      interfaceLanguage: language,
      progressDoc,
    },
  };

  // Ownership gate: rendering rewrites wakeflow-state.json, so the non-owning
  // host must not run it (it would race the owner's writes). Unclaimed demands
  // render freely; rendering never claims.
  if (state.controllerHost && state.controllerHost !== hostProfile.runtime.hostDirName) {
    fail(`demand ${state.demandKey} is owned by controller host ${state.controllerHost}; this runtime is ${hostProfile.runtime.hostDirName}. Render from the owning controller.`);
  }

  if (write) {
    // Lost-update guard, under the shared cross-process state lock: the FRESH
    // re-read happens inside the lock, so a concurrent revision bump between our
    // read and this write is impossible rather than merely detected.
    try {
      withStateRootLock(stateRoot, () => {
        const fresh = readJson(stateFile, "controller state");
        if (fresh.revision !== state.revision) {
          fail(`controller state changed while rendering (revision ${state.revision} -> ${fresh.revision}); re-run wakeflow-render-progress against the current state.`);
        }
        const freshEvent = eventsForSnapshot(stateRoot, fresh, eventsFile).at(-1) ?? null;
        if ((freshEvent?.eventId ?? "none") !== (event?.eventId ?? "none")) {
          fail("controller event log changed while rendering; re-run wakeflow-render-progress against the current state.");
        }
        writeJson(projectionFile, projection);
        atomicWrite(indexFile, stateRootIndex.endsWith("\n") ? stateRootIndex : `${stateRootIndex}\n`);
        atomicWrite(progressFile, nextProgress.endsWith("\n") ? nextProgress : `${nextProgress}\n`);
        // Flip the authority marker only after every projection file succeeds.
        // A failed progress/index write may leave replaceable projection bytes,
        // but the state remains stale and cannot falsely report "synced".
        writeJson(stateFile, { ...fresh, projection: nextState.projection });
      }, { onWarn: (message) => process.stderr.write(`wakeflow-render-progress: ${message}\n`) });
    } catch (error) {
      if (error instanceof WakeflowStateLockTimeoutError) fail(error.message);
      throw error;
    }
    refreshWorkspaceProjection({ workspaceRoot, config, updatedAt: renderedAt });
  }

  output(
    {
      ok: true,
      command: "wakeflow-render-progress",
      wrote: write,
      stateRoot: relative(stateRoot),
      progressDoc: relative(progressFile),
      projectionFile: relative(projectionFile),
      sourceRevision: state.revision,
      sourceEventId: event?.eventId ?? "none",
      changed: nextProgress !== progress || state.projection?.status !== "synced",
    },
    [
      `${write ? "Rendered" : "Would render"} Unified Status for ${state.demandKey}.`,
      "Only the unified-status marker block is updated in the progress doc.",
    ],
  );
} catch (error) {
  if (!(error instanceof CliExit)) {
    throw error;
  }
}
