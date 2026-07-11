#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildWakeflowTrace } from "../lib/wakeflow-trace.mjs";
import { loadWorkspaceConfig, testWindowNames, workspaceLedgerPaths } from "./lib/wakeflow-config.mjs";
import {
  detectInterfaceLanguage,
  localizedTemplateName,
  normalizeInterfaceLanguage,
  wakeflowStateLocale,
} from "./lib/wakeflow-language.mjs";
import { controllerReviewScope, hasPendingReworkDecision, reductionStatusForTargetTask } from "./lib/wakeflow-review-scope.mjs";
import { hostProfile } from "./lib/wakeflow-host-profile.mjs";
import { releaseWindowLockForResult } from "./lib/wakeflow-delivery-store.mjs";
import { scanStateRootForRealIds, redactStateRootIntoCopy } from "./lib/wakeflow-redaction.mjs";
import { WakeflowStateLockTimeoutError, withFileLock, withStateRootLock } from "./lib/wakeflow-state-lock.mjs";
import { PROGRESS_SECTIONS, appendProgressTimeline } from "./lib/wakeflow-progress-appends.mjs";
import {
  activeDemandCapacity,
  activeDemandConflictSummary,
} from "./lib/wakeflow-active-demands.mjs";
import { archiveWorkspaceTodo, refreshWorkspaceProjection } from "./lib/wakeflow-workspace-projection.mjs";
import {
  currentStateRootResults,
  readStateRootTargetResultItems,
  selectCurrentStateRootResults,
} from "./lib/wakeflow-state-results.mjs";

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
  node scripts/wakeflow-state.mjs init --demand-key <key> --title <title> [--goal <text>] [--completion-definition <text>] [--test-decision <text>] [--stage-plan <text>] [--controller-window <window>] [--language <auto|zh|en>] [--root <workspace>] [--state-root <path>] [--write] [--json]
  node scripts/wakeflow-state.mjs add-task-package --state-root <path> --task-package-id <id> --summary <text> [--source-ref <ref>] [--design-intent <text>] [--evidence-contract <json>] [--target-window <window>] [--target-task-id <id>] [--target-summary <text>] [--test-card-id <id>] [--test-continuation-of <task-id>] [--restart-test --test-restart-reason <text>] [--write] [--json]
  node scripts/wakeflow-state.mjs import-target-result --state-root <path> --target-task-id <id> --target-window <window> --status <completed|blocked|needs-review> [--result-id <id>] [--dispatch-group <id>] [--supersede-result] [--evidence-ref <ref>] [--verification <text>] [--risk <text>] [--craft-evidence <json>] [--summary <text>] [--write] [--json]
  node scripts/wakeflow-state.mjs reduce-results --state-root <path> [--write] [--json]
  node scripts/wakeflow-state.mjs decide-review --state-root <path> --candidate-id <id> --decision <accept|rework|blocked|redesign> --reason <text> [--evidence-ref <ref>] [--accept-blocked] [--write] [--json]
  node scripts/wakeflow-state.mjs complete-demand --state-root <path> --reason <text> --evidence-ref <ref> [--write] [--json]
  node scripts/wakeflow-state.mjs cancel-demand --state-root <path> --reason <text> [--write] [--json]
  node scripts/wakeflow-state.mjs archive-demand --state-root <path> --reason <text> [--redact] [--evidence-ref <ref>] [--write] [--json]
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
      ? "Continue by total-control judgment using the returned allowed actions; this command performed no additional follow-up action."
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

// Optional JSON-valued flag (e.g. --evidence-contract). Returns null when absent;
// fails closed on malformed JSON rather than silently dropping the argument.
function parseOptionalJsonArg(name) {
  const raw = (getValue(name, "") || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`${name} must be valid JSON: ${error.message}`);
  }
}

// Optional JSON-array flag (e.g. --craft-evidence). Returns [] when absent; a single
// object is wrapped into a one-element array so callers always get an array.
function parseOptionalJsonArrayArg(name) {
  const parsed = parseOptionalJsonArg(name);
  if (parsed == null) return [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

// The evidence contract is the AUTHORITY SOURCE for the only hard craft gate
// (craft-evidence-required). A malformed shape must fail intake here (fail-closed),
// never silently disable the gate at reduce time: reduce's Array.isArray guard
// treats a mis-shaped `required` as "no required kinds" — a fail-open on the gate.
function validateEvidenceContractShape(contract) {
  if (contract == null) return null;
  if (typeof contract !== "object" || Array.isArray(contract)) {
    fail("--evidence-contract must be a JSON object like { version, required: [{kind, verify}], advisory: [{kind}] }.");
  }
  for (const listName of ["required", "advisory"]) {
    const list = contract[listName];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      fail(`--evidence-contract ${listName} must be an ARRAY of {kind, ...} entries (got ${Array.isArray(list) ? "array" : typeof list}); a mis-shaped list would silently disable the craft gate.`);
    }
    for (const entry of list) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.kind !== "string" || !entry.kind.trim()) {
        fail(`--evidence-contract ${listName} entries must be objects with a non-empty string kind.`);
      }
    }
  }
  return contract;
}

function readTestCardForTask(stateRoot, testCardId) {
  const cardFile = path.join(stateRoot, "test-cards", `${slug(testCardId)}.json`);
  if (!existsSync(cardFile)) {
    fail(`configured Test work requires an existing Test card: ${relative(cardFile)}`);
  }
  const card = readJson(cardFile, "Test boundary card");
  const contract = card.executionContract;
  if (!contract || typeof contract.requirementGoal !== "string" || !contract.requirementGoal.trim() || !Array.isArray(contract.approvedPlan) || contract.approvedPlan.length === 0) {
    fail(`Test card ${testCardId} has no authoritative executionContract. Create a new bounded Test card; Test must not invent the missing approach.`);
  }
  if (!Array.isArray(contract.allowedSkills) || !Array.isArray(contract.restartConditions)) {
    fail(`Test card ${testCardId} has a malformed executionContract skill/restart list.`);
  }
  if (!["reuse-existing", "fresh-once", "fresh-per-attempt"].includes(contract.setupPolicy)) {
    fail(`Test card ${testCardId} has an invalid executionContract.setupPolicy.`);
  }
  if (!Number.isInteger(contract.maxAttempts) || contract.maxAttempts < 1 || contract.maxAttempts > 10) {
    fail(`Test card ${testCardId} has an invalid executionContract.maxAttempts.`);
  }
  return { card, cardFile, contract };
}

function testExecutionForNewTask({ stateRoot, state, targetWindow, targetTaskId }) {
  const config = loadWorkspaceConfig({ workspaceRoot, args: options });
  const configuredTestWindow = testWindowNames(config)[0] || "";
  const isTestTarget = Boolean(configuredTestWindow)
    && (targetWindow === configuredTestWindow || targetWindow.startsWith(`${configuredTestWindow}__`));
  const testCardId = (getValue("--test-card-id", "") || "").trim();
  const continuationOf = (getValue("--test-continuation-of", "") || "").trim();
  const restart = hasFlag("--restart-test");
  const restartReason = (getValue("--test-restart-reason", "") || "").trim();
  if (!isTestTarget) {
    if (testCardId || continuationOf || restart || restartReason) {
      fail("--test-card-id/continuation/restart options are valid only for the configured Test window.");
    }
    return null;
  }
  if (!testCardId) {
    fail(`target window ${targetWindow} is the configured Test window; --test-card-id is required.`);
  }
  const { card, cardFile, contract } = readTestCardForTask(stateRoot, testCardId);
  if (card.targetWindow !== targetWindow) {
    fail(`Test card ${testCardId} belongs to ${card.targetWindow}, not ${targetWindow}.`);
  }
  if (!card.strategySource) {
    fail(`Test card ${testCardId} has no strategySource; Test approach authority is missing.`);
  }
  const priorTasks = (state.targetTasks ?? [])
    .filter((task) => task.testExecution?.testCardId === testCardId)
    .sort((left, right) => Number(left.testExecution?.lineageStep ?? 0) - Number(right.testExecution?.lineageStep ?? 0));
  const dispatchCount = priorTasks.reduce((sum, task) => sum + Number(task.counts?.dispatchCount ?? 0), 0);
  if (dispatchCount >= contract.maxAttempts) {
    fail(`Test card ${testCardId} already used ${dispatchCount}/${contract.maxAttempts} authorized attempts. Stop and return to the user/Design instead of creating another Test task id.`);
  }
  if (priorTasks.length === 0) {
    const expectedTaskId = card.suggestedTaskPackage?.targetTaskId;
    if (expectedTaskId && targetTaskId !== expectedTaskId) {
      fail(`first Test task for card ${testCardId} must use targetTaskId ${expectedTaskId}.`);
    }
    if (continuationOf || restart || restartReason) {
      fail(`first Test task for card ${testCardId} cannot declare continuation or restart.`);
    }
    return {
      testCardId,
      testCardRef: relative(cardFile),
      strategySource: card.strategySource,
      lineageStep: 1,
      dispatchAttempt: dispatchCount + 1,
      mode: "initial",
      ...contract,
    };
  }
  const latest = priorTasks.at(-1);
  if (!continuationOf) {
    fail(`later Test work for card ${testCardId} must declare --test-continuation-of ${latest.targetTaskId}; a new task id does not start a new plan.`);
  }
  if (continuationOf !== latest.targetTaskId) {
    fail(`Test continuation must follow the latest lineage task ${latest.targetTaskId}, not ${continuationOf}.`);
  }
  if (latest.status !== "accepted") {
    fail(`Test continuation cannot be added while ${latest.targetTaskId} is ${latest.status}; review it first or re-dispatch that same task.`);
  }
  if (restart) {
    if (contract.setupPolicy !== "fresh-per-attempt" || contract.restartConditions.length === 0) {
      fail(`Test card ${testCardId} does not authorize fresh environment restarts; resume prior evidence or request a new card.`);
    }
    if (!restartReason) {
      fail("--restart-test requires --test-restart-reason from the controller's explicit decision.");
    }
  } else if (restartReason) {
    fail("--test-restart-reason requires --restart-test.");
  }
  return {
    testCardId,
    testCardRef: relative(cardFile),
    strategySource: card.strategySource,
    lineageStep: priorTasks.length + 1,
    dispatchAttempt: dispatchCount + 1,
    mode: restart ? "restart" : "resume",
    continuationOfTaskId: continuationOf,
    ...(restart ? { restartReason } : {}),
    ...contract,
  };
}

// Craft evidence entries land in the durable target-result artifact (evidence is
// never deleted); reject junk shapes at the door instead of archiving them.
function validateCraftEvidenceEntries(entries) {
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.kind !== "string" || !entry.kind.trim()) {
      fail("--craft-evidence entries must be objects with a non-empty string kind (e.g. {\"kind\":\"tests\",\"ref\":\"...\"}).");
    }
  }
  return entries;
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
  if (!existsSync(path.join(stateRoot, "wakeflow-state.json"))) {
    fail(`state root is missing wakeflow-state.json: ${relative(stateRoot)}`);
  }
  withLockedStateRoot(stateRoot, () => commandAdoptDemandHostLocked(stateRoot));
}

function commandAdoptDemandHostLocked(stateRoot) {
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
    appendJsonLine(eventsFile, event);
    writeJson(stateFile, nextState);
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

// Cross-process mutex for every state-root read-modify-write command. Parallel MCP
// calls from one controller turn (e.g. two add-task-package) otherwise both read
// revision N and the second write silently drops the first. The state readJson must
// happen INSIDE fn so the whole read-modify-write is one critical section.
function withLockedStateRoot(stateRoot, fn) {
  try {
    return withStateRootLock(stateRoot, fn, {
      onWarn: (message) => process.stderr.write(`wakeflow-state: ${message}\n`),
    });
  } catch (error) {
    if (error instanceof WakeflowStateLockTimeoutError) fail(error.message);
    throw error;
  }
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

function evidenceRefLooksLikePath(ref) {
  const text = String(ref ?? "");
  return text.includes("/") || /\.(json|md|log|txt|png|jpg|jpeg|webp|html|csv)$/i.test(text);
}

// Map each work window to its repository root from config, so a target's evidence refs
// resolve against the repo where the work + commit happened. Loaded once. This mirrors the
// review-pack resolver: reduce-results HARD-FAILS on "missing" evidence, so resolving a
// target's repo-relative refs only against the state/workspace root false-fails the reducer
// and stalls the loop (the controller cannot form a review candidate).
let evidenceRepoRootByWindow = null;
function evidenceRepoRootForWindow(windowName) {
  if (!windowName) return null;
  if (!evidenceRepoRootByWindow) {
    evidenceRepoRootByWindow = new Map();
    const cfg = loadWorkspaceConfig({ workspaceRoot, args: options });
    for (const repo of cfg.repositories ?? []) {
      if (repo?.windowName && repo?.path) {
        evidenceRepoRootByWindow.set(repo.windowName, path.resolve(workspaceRoot, repo.path));
      }
    }
  }
  const direct = evidenceRepoRootByWindow.get(windowName);
  if (direct) return direct;
  // Pod-suffixed windows (Repo__pod, Test__pod) have no repositories[] entry of
  // their own once the overlay entry is gone (or never existed, for Test/
  // Controller pod windows): resolve against the base window's repo so their
  // repo-relative evidence refs do not false-fail the reducer.
  const base = String(windowName).split("__")[0];
  return (base && base !== windowName ? evidenceRepoRootByWindow.get(base) : null) ?? null;
}

function evidenceRefResolutionCandidates(stateRoot, ref, targetWindow) {
  const text = String(ref ?? "");
  if (!evidenceRefLooksLikePath(text)) return [];
  if (path.isAbsolute(text)) return [path.resolve(text)];
  // Most-specific first: the state root, the producing window's repo, then the workspace root.
  return [stateRoot, evidenceRepoRootForWindow(targetWindow), workspaceRoot]
    .filter(Boolean)
    .map((root) => path.resolve(root, text));
}

function missingEvidenceRefsForTargetResult(stateRoot, task, result) {
  const refs = Array.isArray(result?.evidenceRefs) ? result.evidenceRefs : [];
  return refs
    .map((ref) => {
      const candidates = evidenceRefResolutionCandidates(stateRoot, ref, task.targetWindow);
      return {
        targetWindow: task.targetWindow,
        targetTaskId: task.targetTaskId,
        taskPackageId: task.taskPackageId,
        resultId: result.resultId,
        ref: String(ref ?? ""),
        candidatePaths: candidates.map(relative),
        exists: candidates.some((candidate) => existsSync(candidate)),
      };
    })
    .filter((item) => item.candidatePaths.length > 0)
    .filter((item) => !item.exists)
    .map(({ exists, ...item }) => item);
}

// W-Target execution-craft gate: a COMPLETED target result must satisfy its task
// package's evidence contract — each `required` kind present in craftEvidence, and any
// declared craft-artifact path resolves on disk. Absent contract => no gap. Only
// completed results are enforced: blocked / needs-review honestly report an incomplete
// task and must never be wedged by the contract.
function craftEvidenceGapsForTargetResult(stateRoot, state, task, result) {
  const pkg = (state.taskPackages ?? []).find((item) => item.taskPackageId === task.taskPackageId);
  const required = Array.isArray(pkg?.evidenceContract?.required) ? pkg.evidenceContract.required : [];
  if (required.length === 0) return [];
  const provided = Array.isArray(result?.craftEvidence) ? result.craftEvidence : [];
  const byKind = new Map();
  for (const item of provided) {
    if (item && typeof item.kind === "string") {
      byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item]);
    }
  }
  const gaps = [];
  for (const req of required) {
    const kind = typeof req?.kind === "string" ? req.kind : "";
    if (!kind) continue;
    const base = { targetWindow: task.targetWindow, targetTaskId: task.targetTaskId, taskPackageId: task.taskPackageId, kind, verify: req.verify ?? null };
    const entries = byKind.get(kind) ?? [];
    if (entries.length === 0) {
      gaps.push({ ...base, reason: "missing-kind" });
      continue;
    }
    for (const entry of entries) {
      const ref = typeof entry?.ref === "string" ? entry.ref : "";
      if (!ref) continue;
      const candidates = evidenceRefResolutionCandidates(stateRoot, ref, task.targetWindow);
      if (candidates.length > 0 && !candidates.some((candidate) => existsSync(candidate))) {
        gaps.push({ ...base, ref, reason: "artifact-missing" });
      }
    }
  }
  return gaps;
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
  // The demand's OWN controller window (demand pods: Controller__<pod>). Every
  // dispatch's controller-return defaults to this, so a pod controller never
  // mis-routes wake-ups to the workspace-level controller by forgetting a flag.
  const explicitControllerWindow = (getValue("--controller-window", "") || "").trim();
  const configuredControllerWindow = (config.controllerWindow || "").trim();
  let demandControllerWindow = explicitControllerWindow || configuredControllerWindow || null;
  let executionPlacement = null;
  const completionDefinition = getValue("--completion-definition", locale.defaultCompletionDefinition);
  // Design's testing decision (which validation / real-Test approach). Optional and
  // advisory: surfaced as a REMINDER when absent, never a gate — the controller/Design
  // decide whether real Test is needed (reminder-first per the user's design philosophy).
  const testDecision = (getValue("--test-decision", "") || "").trim() || null;
  const stagePlan = getValue("--stage-plan", locale.defaultStagePlan);
  // Provenance: the design key (usually the delivered TODO row id) and the
  // source documents (requirement design / original plan links) persist on
  // demand.json so the archived story can thread back to its requirement
  // without relying on prose.
  const designKey = (getValue("--design-key", "") || "").trim() || null;
  const sourceDocuments = valuesFor("--source-doc");
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
  const existingInitFiles = Object.values(files).filter((file) => existsSync(file));
  if (existingInitFiles.length > 0) {
    fail(`state root already contains Wakeflow state file(s): ${existingInitFiles.map(relative).join(", ")}; refuse to re-initialize ${demandKey}.`);
  }
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
      ...(designKey ? { designKey } : {}),
      ...(sourceDocuments.length ? { documents: sourceDocuments } : {}),
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
    controllerWindow: demandControllerWindow,
    ...(testDecision ? { testDecision } : {}),
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

  // Capacity is a CROSS-root invariant, so the per-root lock cannot guard it:
  // serialize the scan against the state-file write on a workspace-scoped lock,
  // or two parallel claims both scan at N-1 and overshoot maxActiveDemands.
  mkdirSync(path.dirname(ledgerPaths.workspaceCurrentDir), { recursive: true });
  try {
    withFileLock(`${ledgerPaths.workspaceCurrentDir}.capacity-lock`, () => {
      const capacity = activeDemandCapacity({
        workspaceRoot,
        config,
        excludeDemandKeys: [demandKey],
      });
      if (capacity.atCapacity) {
        fail(`cannot initialize ${demandKey}: workspace is at its active-demand capacity (${capacity.active.length}/${capacity.max}): ${activeDemandConflictSummary(capacity.active)}. Complete and archive one, or raise maxActiveDemands in wakeflow.config.json.`);
      }
      const explicitPodController = explicitControllerWindow.includes("__");
      const placementMode = explicitPodController || capacity.active.length > 0 ? "isolated" : "main";
      executionPlacement = placementMode === "isolated"
        ? { mode: "isolated", podId: slug(demandKey) }
        : { mode: "main", podId: null };
      if (placementMode === "isolated" && !explicitControllerWindow) {
        demandControllerWindow = `Controller__${slug(demandKey)}`;
      }
      demand.executionPlacement = executionPlacement;
      state.executionPlacement = executionPlacement;
      state.controllerWindow = demandControllerWindow;
      if (write) {
        // wakeflow-state.json makes the demand visible to other scanners, so
        // it must land inside the same critical section as the scan.
        writeJson(files.demand, demand);
        writeJson(files.state, state);
      }
    });
  } catch (error) {
    if (error instanceof WakeflowStateLockTimeoutError) fail(error.message);
    throw error;
  }

  if (write) {
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
      generatedRuntimeBoundary: ".wakeflow-active is ignored by the Wakeflow repository; tracked assets are templates, schemas, scripts, skills, and tests.",
      lazyStateDirectories: lazyStateDirectories.map(relative),
      localDeliveryRuntime: ".wakeflow-local/wakeflow-delivery",
      executionPlacement,
      controllerWindow: demandControllerWindow,
      outputs: outputs.map(relative),
      agentNext: executionPlacement?.mode === "isolated"
        ? `Demand created in isolated placement. Open or resume its demand pod before dispatch (wakeflow_pod_open for pod ${executionPlacement.podId}); no dispatch, delivery, or acceptance was performed.`
        : "Demand created in main placement. Dispatch is a separate step; no dispatch, delivery, or acceptance was performed.",
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
  withLockedStateRoot(stateRoot, () => commandAddTaskPackageLocked(stateRoot));
}

function commandAddTaskPackageLocked(stateRoot) {
  const taskPackageId = requireValue("--task-package-id");
  const summary = requireValue("--summary");
  const sourceRef = getValue("--source-ref", null);
  // Design's one-line implementation intent ("roughly how"). Optional and
  // advisory: it is surfaced side-by-side with the controller's objective at
  // dispatch and review for the agent's own alignment check — never a gate.
  const designIntent = (getValue("--design-intent", "") || "").trim() || null;
  // Design-authored execution-craft evidence contract (W-Target). Optional JSON
  // { version, required:[{kind,verify}], advisory:[{kind}] }; kept OUT of the dispatch
  // idempotency comparable (like designIntent) so it can be authored/adjusted without
  // breaking replay. Absent = zero behavior change.
  const evidenceContract = validateEvidenceContractShape(parseOptionalJsonArg("--evidence-contract"));
  const targetWindow = getValue("--target-window", null);
  const targetTaskId = getValue("--target-task-id", targetWindow ? `${taskPackageId}__${slug(targetWindow)}` : null);
  const targetSummary = getValue("--target-summary", summary);
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const packageFile = path.join(stateRoot, "task-packages", `${slug(taskPackageId)}.json`);
  const state = readJson(stateFile, "controller state");
  const hostOwnership = ensureDemandHostOwnership(state);

  if (["completed", "archived", "cancelled"].includes(state.state)) {
    fail(`cannot add task package while demand is ${state.state}: ${state.demandKey}`);
  }
  if (["review-ready", "waiting-results"].includes(state.state)) {
    fail(`cannot add task package while demand is ${state.state}; reduce or decide current results before adding more work.`);
  }
  if (state.state === "blocked" || (state.blockers ?? []).length > 0) {
    fail(`cannot add task package while demand is blocked; record an explicit rework or unblock decision first.`);
  }
  const existingReviewScope = controllerReviewScope(state.targetTasks ?? []);
  const reworkRouteActive = existingReviewScope.mode === "rework-first-controller-review-targets";
  if (reworkRouteActive && !["needs-rework", "planned"].includes(state.state)) {
    fail(`cannot add task package while rework route is active; finish or explicitly extend the rework route before adding ordinary next-step work.`);
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
  if (targetTaskId && (state.targetTasks ?? []).some((item) => item.targetTaskId === targetTaskId)) {
    fail(`controller state already contains target task: ${targetTaskId}`);
  }
  const testExecution = targetWindow
    ? testExecutionForNewTask({ stateRoot, state, targetWindow, targetTaskId })
    : null;

  const createdAt = nowIso();
  const nextRevision = Number(state.revision ?? 0) + 1;
  const eventId = nextEventId(createdAt, nextRevision);
  const nextMainState = state.state === "intake" || state.state === "needs-rework"
    ? "planned"
    : state.state;
  const reviewRoute = state.state === "needs-rework" || reworkRouteActive ? "rework" : null;
  const targetTasks = targetWindow
    ? [
        {
          targetTaskId,
          taskPackageId,
          targetWindow,
          summary: targetSummary,
          status: "pending",
          createdAt,
          ...(testExecution ? { testExecution } : {}),
          ...(reviewRoute ? { reviewRoute } : {}),
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
    ...(designIntent ? { designIntent } : {}),
    ...(evidenceContract ? { evidenceContract } : {}),
    ...(testExecution ? { testExecution } : {}),
    createdAt,
    ...(reviewRoute ? { reviewRoute } : {}),
    targetTasks,
  };
  // Reminder-first (never a gate): a dispatchable package without an evidence
  // contract leaves the craft gate dormant — the same forgotten-decision failure
  // mode testDecisionReminder fixes at create-demand. Surface it; authoring stays
  // Design's / the controller's judgment (doc-only packages legitimately skip it).
  const evidenceContractReminder = targetWindow && !testExecution && !evidenceContract
    ? "No evidence contract on this package: the craft gate stays dormant. If this is implementation work, consider authoring one (required kinds like tests/change-scope; see wakeflow-target-craft). Reminder only — not a gate."
    : null;
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
        ...(designIntent ? { designIntent } : {}),
        ...(evidenceContract ? { evidenceContract } : {}),
        ...(testExecution ? { testExecution } : {}),
        createdAt,
        ...(reviewRoute ? { reviewRoute } : {}),
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
    appendJsonLine(eventsFile, event);
    writeJson(stateFile, nextState);
    appendProgressTimeline(stateRoot, nextState, PROGRESS_SECTIONS.taskPackages,
      `${createdAt} ${taskPackageId} → ${targetWindow || "(unassigned)"} — ${summary}${designIntent ? ` (intent: ${designIntent})` : ""}`);
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
      ...(testExecution ? { testExecution } : {}),
      ...(evidenceContractReminder ? { evidenceContractReminder } : {}),
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
  return path.join(workspaceRoot, ".wakeflow-local/wakeflow-delivery/delivery-envelopes", `${slug(deliveryId)}.json`);
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
  if (
    !deliveryContext.controllerReturnRequired
    && reviewReadiness?.reviewScope?.mode === "rework-first-controller-review-targets"
    && !reviewReadiness.readyForReduce
  ) {
    return `Target result is recorded, but rework is still open. Continue the rework route before reducing ordinary next-step results; missing rework target(s): ${reviewReadiness.remainingTaskIds.join(", ") || "none"}.`;
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

function reviewReadinessAfterImport(state, stateRoot, importedTargetTaskId, importedCurrentResult = true) {
  const reviewScope = controllerReviewScope(state.targetTasks ?? []);
  const targetTasks = reviewScope.reviewableTargetTasks;
  const results = latestResultsByTargetTask(readTargetResults(stateRoot));
  const taskIdsWithResults = new Set(results.keys());
  if (importedCurrentResult) taskIdsWithResults.add(importedTargetTaskId);
  const reworkCompanionPresent = reviewScope.mode === "rework-first-controller-review-targets"
    && targetTasks.some((task) => task.reviewRoute === "rework" && !hasPendingReworkDecision(task));
  const remainingTaskIds = [];

  for (const task of targetTasks) {
    if (hasPendingReworkDecision(task)) {
      if (!reworkCompanionPresent) {
        remainingTaskIds.push(task.targetTaskId);
      }
      continue;
    }
    if (!taskIdsWithResults.has(task.targetTaskId)) {
      remainingTaskIds.push(task.targetTaskId);
    }
  }

  return {
    remainingTaskIds,
    readyForReduce: remainingTaskIds.length === 0,
    reviewScope: {
      mode: reviewScope.mode,
      targetTaskIds: reviewScope.targetTaskIds,
      excludedTargetTaskIds: reviewScope.excludedTargetTaskIds,
    },
  };
}

function commandImportTargetResult() {
  const stateRoot = stateRootFromArg();
  withLockedStateRoot(stateRoot, () => commandImportTargetResultLocked(stateRoot));
}

function targetResultComparable(result = {}) {
  return JSON.stringify({
    targetTaskId: result.targetTaskId,
    targetWindow: result.targetWindow,
    dispatchGroup: result.dispatchGroup || null,
    status: result.status,
    summary: result.summary || "",
    evidenceRefs: result.evidenceRefs ?? [],
    verification: result.verification ?? [],
    risks: result.risks ?? [],
    craftEvidence: result.craftEvidence ?? [],
  });
}

function targetResultsEquivalent(left, right) {
  return targetResultComparable(left) === targetResultComparable(right);
}

function readTargetResultHistory(stateRoot) {
  const dir = path.join(stateRoot, "target-results", "history");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const file = path.join(dir, name);
      return { file, result: readJson(file, "target result history") };
    });
}

function targetResultHistoryFile(stateRoot, result, revision, historyKind = "current") {
  const group = result.dispatchGroup || "ungrouped";
  return path.join(
    stateRoot,
    "target-results",
    "history",
    `${slug(result.resultId)}__${slug(group)}__${slug(historyKind)}-r${String(revision).padStart(4, "0")}.json`,
  );
}

function commandImportTargetResultLocked(stateRoot) {
  const targetTaskId = requireValue("--target-task-id");
  const targetWindow = requireValue("--target-window");
  const status = requireValue("--status");
  const allowedStatuses = new Set(["completed", "blocked", "needs-review"]);
  if (!allowedStatuses.has(status)) {
    fail(`--status must be one of: ${[...allowedStatuses].join(", ")}`);
  }
  const state = readJson(path.join(stateRoot, "wakeflow-state.json"), "controller state");
  const hostOwnership = ensureDemandHostOwnership(state, { claim: false });
  if (["completed", "archived", "cancelled"].includes(state.state)) {
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
  const supersedeResult = hasFlag("--supersede-result");
  // The dispatch group the incoming RESULT ENVELOPE claims (optional): late or
  // duplicate results from a superseded round carry their original group, and
  // must not be allowed to touch the in-flight round's window lock.
  const resultDispatchGroup = getValue("--dispatch-group", null);
  const resultId = explicitResultId ?? `tr-${slug(targetTaskId)}`;
  const createdAt = nowIso();
  const evidenceRefs = valuesFor("--evidence-ref");
  const verification = valuesFor("--verification");
  const risks = valuesFor("--risk");
  // Typed craft evidence for the execution-craft contract (W-Target). Optional JSON array
  // of { kind, ref|value|commit, verify }. Absent = zero behavior change.
  const craftEvidence = validateCraftEvidenceEntries(parseOptionalJsonArrayArg("--craft-evidence"));
  const deliveryContext = targetTaskDeliveryContext(targetTask);
  const incomingDispatchGroup = resultDispatchGroup ?? deliveryContext.dispatchGroup ?? undefined;
  const currentDispatchGroup = targetTask.delivery?.dispatchGroup || deliveryContext.dispatchGroup || "";
  const historyOnly = Boolean(currentDispatchGroup && incomingDispatchGroup && incomingDispatchGroup !== currentDispatchGroup);
  const currentResults = selectCurrentStateRootResults({
    items: readStateRootTargetResultItems(stateRoot, readJson),
    state,
    fail,
  });
  const currentItem = currentResults.get(targetTaskId) ?? null;
  const baseResult = {
    schemaVersion,
    resultId,
    demandKey: state.demandKey,
    taskPackageId: targetTask.taskPackageId,
    dispatchGroup: incomingDispatchGroup,
    stateRoot: relative(stateRoot),
    targetWindow,
    targetTaskId,
    status,
    summary: getValue("--summary", ""),
    evidenceRefs,
    verification,
    risks,
    ...(craftEvidence.length ? { craftEvidence } : {}),
    deliveryContext,
    controllerActionRequired: Boolean(deliveryContext.controllerReturnRequired),
    wakeflowTrace: artifactTrace({
      artifactKind: "target-result",
      createdAt,
      demandKey: state.demandKey,
      dispatchGroup: incomingDispatchGroup,
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

  let result = baseResult;
  let resultFile = path.join(stateRoot, "target-results", `${slug(resultId)}.json`);
  let historyFile = "";
  let duplicate = false;
  let superseded = false;
  if (historyOnly) {
    const priorHistory = readTargetResultHistory(stateRoot)
      .filter((item) => (item.result.targetTaskId || item.result.taskId) === targetTaskId)
      .filter((item) => (item.result.dispatchGroup || "") === (incomingDispatchGroup || ""));
    const equivalent = priorHistory.find((item) => targetResultsEquivalent(item.result, baseResult));
    if (equivalent) {
      duplicate = true;
      result = equivalent.result;
      resultFile = equivalent.file;
    } else {
      if (priorHistory.length > 0 && !supersedeResult) {
        fail(`late target result already exists for ${targetTaskId} in dispatch group ${incomingDispatchGroup}; use --supersede-result to append an explicit corrected history revision.`);
      }
      const resultRevision = priorHistory.reduce(
        (max, item) => Math.max(max, Number(item.result.resultRevision ?? 0)),
        0,
      ) + 1;
      result = {
        ...baseResult,
        currentResult: false,
        historyReason: "late-dispatch-group",
        resultRevision,
      };
      resultFile = targetResultHistoryFile(stateRoot, result, resultRevision, "late");
      if (existsSync(resultFile)) {
        fail(`target result history already exists with different content: ${relative(resultFile)}`);
      }
    }
  } else if (currentItem) {
    if (targetResultsEquivalent(currentItem.result, baseResult)) {
      duplicate = true;
      result = currentItem.result;
      resultFile = currentItem.file;
    } else {
      const sameRound = (currentItem.result.dispatchGroup || "") === (incomingDispatchGroup || "");
      if (sameRound && !supersedeResult) {
        fail(`current target result already exists for ${targetTaskId}${incomingDispatchGroup ? ` in dispatch group ${incomingDispatchGroup}` : ""}; use --supersede-result to replace it explicitly.`);
      }
      const priorRevision = Number(currentItem.result.resultRevision ?? 1);
      historyFile = targetResultHistoryFile(stateRoot, currentItem.result, priorRevision, "current");
      if (existsSync(historyFile)) {
        const existingHistory = readJson(historyFile, "target result history");
        if (JSON.stringify(existingHistory) !== JSON.stringify(currentItem.result)) {
          fail(`target result history already exists with different content: ${relative(historyFile)}`);
        }
      }
      // Keep one stable top-level current file for the task. The resultId may
      // change, but readers use the actual file path; changing the file name
      // would create a two-current crash window while replacing it.
      resultFile = currentItem.file;
      result = {
        ...baseResult,
        currentResult: true,
        resultRevision: priorRevision + 1,
        supersedes: {
          resultId: currentItem.result.resultId,
          dispatchGroup: currentItem.result.dispatchGroup,
          historyFile: relative(historyFile),
        },
      };
      superseded = true;
    }
  } else {
    const colliding = readStateRootTargetResultItems(stateRoot, readJson)
      .find((item) => item.file === resultFile);
    if (colliding) {
      fail(`target result file already exists for another current result: ${relative(resultFile)}`);
    }
    result = {
      ...baseResult,
      currentResult: true,
      resultRevision: 1,
    };
  }

  if (write && !duplicate) {
    mkdirSync(path.dirname(resultFile), { recursive: true });
    if (historyFile) {
      mkdirSync(path.dirname(historyFile), { recursive: true });
      if (!existsSync(historyFile)) writeJson(historyFile, currentItem.result);
    }
    writeJson(resultFile, result);
    appendProgressTimeline(stateRoot, state, PROGRESS_SECTIONS.backfill,
      `${createdAt} ${targetWindow}/${targetTaskId} returned ${status} (result ${resultId}${historyOnly ? ", history only" : ""})`);
  }
  // Release the shared in-flight window lock when this result answers the
  // delivery that locked it. This is the only release point reachable from the
  // MCP-only flow (wakeflow_record_target_result maps here), so without it
  // codex-side locks would linger the full TTL after the work finished.
  let lockReleased = false;
  if (write && !historyOnly) {
    const lockFile = path.join(workspaceRoot, ".wakeflow-local/wakeflow-delivery/locks", `${slug(targetWindow)}.json`);
    const taskDeliveryId = targetTask.delivery?.deliveryId;
    const taskDispatchGroup = targetTask.delivery?.dispatchGroup;
    // Release only when this result answers the round the lock guards: a late
    // result that declares an OLDER dispatch group (rework re-dispatched the
    // task) must leave the in-flight round's lock alone. Results without a
    // group claim keep the task-current match (legacy imports).
    const answersCurrentRound = !resultDispatchGroup || !taskDispatchGroup || resultDispatchGroup === taskDispatchGroup;
    lockReleased = releaseWindowLockForResult(
      lockFile,
      (lock) => !lock.deliveryId || (taskDeliveryId && lock.deliveryId === taskDeliveryId && answersCurrentRound),
    );
  }

  // Review readiness mirrors reduce-results scope, including rework-first rules,
  // so a stale old result never tells the controller to reduce the wrong lane.
  const reviewReadiness = reviewReadinessAfterImport(state, stateRoot, targetTaskId, !historyOnly);

  output(
    {
      ok: true,
      command: "import-target-result",
      reviewReadiness,
      lockReleased,
      hostOwnership,
      wrote: write && !duplicate,
      duplicate: duplicate || undefined,
      currentResult: result.currentResult,
      historyOnly: historyOnly || undefined,
      superseded: superseded || undefined,
      resultRevision: result.resultRevision,
      historyFile: historyFile ? relative(historyFile) : undefined,
      demandKey: state.demandKey,
      stateRoot: relative(stateRoot),
      resultId,
      resultFile: relative(resultFile),
      targetTaskId,
      status,
      dispatchGroup: incomingDispatchGroup,
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
  withLockedStateRoot(stateRoot, () => commandReduceResultsLocked(stateRoot));
}

function commandReduceResultsLocked(stateRoot) {
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const state = readJson(stateFile, "controller state");
  const hostOwnership = ensureDemandHostOwnership(state);
  if (["completed", "archived", "cancelled"].includes(state.state)) {
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
  const reworkCompanionPresent = reviewScope.mode === "rework-first-controller-review-targets"
    && targetTasks.some((task) => task.reviewRoute === "rework" && !hasPendingReworkDecision(task));
  const readyResultIds = [];
  const blockedResultIds = [];
  const missingTargetTaskIds = [];
  const missingEvidenceRefs = [];
  const craftEvidenceGaps = [];
  const evidenceRefs = [];

  for (const task of targetTasks) {
    if (hasPendingReworkDecision(task)) {
      if (!reworkCompanionPresent) {
        missingTargetTaskIds.push(task.targetTaskId);
      }
      continue;
    }
    const result = results.get(task.targetTaskId);
    if (!result) {
      missingTargetTaskIds.push(task.targetTaskId);
      continue;
    }
    missingEvidenceRefs.push(...missingEvidenceRefsForTargetResult(stateRoot, task, result));
    if (result.status === "completed") {
      craftEvidenceGaps.push(...craftEvidenceGapsForTargetResult(stateRoot, state, task, result));
    }
    evidenceRefs.push(
      ...(result.evidenceRefs ?? []),
      result._resultFile || `target-results/${slug(result.resultId)}.json`,
    );
    if (result.status === "blocked") {
      blockedResultIds.push(result.resultId);
    } else {
      readyResultIds.push(result.resultId);
    }
  }

  if (missingTargetTaskIds.length === 0 && missingEvidenceRefs.length > 0) {
    output({
      ok: false,
      command: "reduce-results",
      wrote: false,
      demandKey: state.demandKey,
      stateRoot: relative(stateRoot),
      previousState: state.state,
      stateRevisionUnchanged: state.revision,
      reviewGate: "evidence-repair-required",
      missingEvidenceRefs,
      forbiddenConclusions: [
        "all-results-present-is-not-evidence-ready",
        "missing-evidence-ref-can-enter-transition-candidate",
        "reduce-results-repairs-target-result",
      ],
      agentNext: "Stop: target results are present, but path-like evidence refs are missing. Run wakeflow_review_pack, repair or re-record the target result evidence, then rerun reduce-results; no state was changed.",
    });
    process.exitCode = 1;
    throw new CliExit("missing evidence refs block reduce-results");
  }

  if (missingTargetTaskIds.length === 0 && missingEvidenceRefs.length === 0 && craftEvidenceGaps.length > 0) {
    output({
      ok: false,
      command: "reduce-results",
      wrote: false,
      demandKey: state.demandKey,
      stateRoot: relative(stateRoot),
      previousState: state.state,
      stateRevisionUnchanged: state.revision,
      reviewGate: "craft-evidence-required",
      craftEvidenceGaps,
      forbiddenConclusions: [
        "completed-result-without-required-craft-evidence-is-acceptable",
        "craft-evidence-gap-can-enter-transition-candidate",
        "reduce-results-produces-craft-evidence",
      ],
      // NOTE: do NOT say "re-dispatch" here — the gated task is `sent`, and dispatch
      // eligibility only admits pending/needs-rework/missing-result. The recovery path
      // (same as evidence-repair) is a CORRECTED IMPORT: a sent task accepts a new result.
      agentNext: "Stop: a completed target result does not satisfy its task package's evidence contract (a required craft-evidence kind is absent, or a declared craft artifact does not resolve). Have the target window produce the required evidence (the wakeflow-target-craft skill lists how) and record a corrected result — a sent task accepts a new import — or record the honest blocked/needs-review status; then rerun reduce-results. No state was changed.",
    });
    process.exitCode = 1;
    throw new CliExit("craft evidence gaps block reduce-results");
  }

  const createdAt = nowIso();
  const nextRevision = Number(state.revision ?? 0) + 1;
  const eventId = nextEventId(createdAt, nextRevision);
  const reworkRouteWaiting = reviewScope.mode === "rework-first-controller-review-targets" && missingTargetTaskIds.length > 0;
  const reviewStatus = reworkRouteWaiting
    ? "rework-route-waiting-results"
    : missingTargetTaskIds.length > 0
    ? "waiting-results"
    : blockedResultIds.length > 0
      ? "blocked-results-ready"
      : "ready-for-controller-review";
  const nextMainState = reworkRouteWaiting
    ? "needs-rework"
    : missingTargetTaskIds.length > 0
      ? "waiting-results"
      : "review-ready";
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
    allowedDecisions: ["accept", "rework", "blocked", "redesign"],
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
    allowedActions: candidateId
      ? ["decide-review"]
      : reworkRouteWaiting
        ? ["prepare-dispatch-from-state", "add-task-package", "import-target-result", "reduce-results", "wakeflow-render-progress"]
        : ["import-target-result", "reduce-results"],
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
    // F41: write secondaries + the event first and flip state.json (the authoritative
    // snapshot) LAST, so a crash mid-commit leaves at most a harmless extra event, never a
    // revision-without-event audit gap.
    if (candidate) {
      writeJson(path.join(stateRoot, "transition-candidates", `${slug(candidate.candidateId)}.json`), candidate);
    }
    appendJsonLine(eventsFile, event);
    writeJson(stateFile, nextState);
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
  withLockedStateRoot(stateRoot, () => commandDecideReviewLocked(stateRoot));
}

function commandDecideReviewLocked(stateRoot) {
  const candidateId = requireValue("--candidate-id");
  const decision = requireValue("--decision");
  const reason = requireValue("--reason");
  const allowedDecisions = new Set(["accept", "rework", "blocked", "redesign"]);
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
  // redesign parks the task like rework (needs-rework), but routes to Design rather than re-dispatch.
  const reworkLike = decision === "rework" || decision === "redesign";
  const nextMainState = decision === "accept" ? "planned" : reworkLike ? "needs-rework" : "blocked";
  const nextTaskStatus = decision === "accept" ? "accepted" : reworkLike ? "needs-rework" : "blocked";
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
  const outputExcludedTargetTaskIds = [
    ...new Set([
      ...(candidate.excludedTargetTaskIds ?? []),
      ...decisionScope.excludedTargetTaskIds,
    ]),
  ];
  const nextTargetTasks = (state.targetTasks ?? []).map((item) => {
    if (!candidateTaskIds.has(item.targetTaskId)) return item;
    // RA2 / redesign-route: per-task handling counts. A rework decision is one rework cycle (same
    // product window, re-dispatched). A redesign decision is one Design-rethink cycle: the task is
    // parked needs-rework like rework, but it is routed back to Design (reviewDecision="redesign"
    // + redesignCount), not re-dispatched to a product window — the controller's next package is a
    // Design outcome-redesign, not a product point-fix.
    if (decision === "rework") {
      return { ...item, status: nextTaskStatus, reviewDecision: decision, counts: { ...(item.counts ?? {}), reworkCount: (item.counts?.reworkCount ?? 0) + 1 } };
    }
    if (decision === "redesign") {
      return { ...item, status: nextTaskStatus, reviewDecision: decision, counts: { ...(item.counts ?? {}), redesignCount: (item.counts?.redesignCount ?? 0) + 1 } };
    }
    return { ...item, status: nextTaskStatus, reviewDecision: decision };
  });
  const nextState = {
    ...state,
    state: nextMainState,
    stateReason: reason,
    revision: nextRevision,
    updatedAt: createdAt,
    allowedActions: decision === "accept"
      ? ["add-task-package", "complete-demand", "wakeflow-render-progress"]
      : decision === "rework"
        ? ["prepare-dispatch-from-state", "add-task-package", "wakeflow-render-progress"]
        : decision === "redesign"
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
    decision,
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
    appendJsonLine(eventsFile, event);
    writeJson(stateFile, nextState);
    appendProgressTimeline(stateRoot, nextState, PROGRESS_SECTIONS.decisions,
      `${createdAt} decision ${decision} (candidate ${candidateId}) — ${reason}`);
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
      excludedTargetTaskIds: outputExcludedTargetTaskIds,
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
  withLockedStateRoot(stateRoot, () => commandCompleteDemandLocked(stateRoot));
}

function commandCompleteDemandLocked(stateRoot) {
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
  if (state.state === "cancelled") {
    fail(`demand is cancelled: ${state.demandKey}; archive it instead of completing.`);
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
    appendJsonLine(eventsFile, event);
    writeJson(stateFile, nextState);
    appendProgressTimeline(stateRoot, nextState, PROGRESS_SECTIONS.decisions,
      `${createdAt} demand completed — ${reason}`);
    refreshWorkspaceProjection({ workspaceRoot, updatedAt: createdAt });
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

// Cancel is the controller's escape hatch for an in-flight demand: the flow
// stops being active WITHOUT pretending completion — no acceptance, no
// evidence gate, open tasks stay in their last honest status as history. A
// cancelled root still occupies active-demand capacity until it is archived
// (same rule as completed-but-not-archived), and open isolation windows must
// still stream-close first: the archive gate is unchanged.
function commandCancelDemand() {
  const stateRoot = stateRootFromArg();
  withLockedStateRoot(stateRoot, () => commandCancelDemandLocked(stateRoot));
}

function commandCancelDemandLocked(stateRoot) {
  const reason = requireValue("--reason");
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const state = readJson(stateFile, "controller state");
  const hostOwnership = ensureDemandHostOwnership(state);
  if (state.state === "archived") {
    fail(`demand is already archived: ${state.demandKey}`);
  }
  if (state.state === "completed") {
    fail(`demand is already completed: ${state.demandKey}; archive it instead of cancelling.`);
  }
  if (state.state === "cancelled") {
    fail(`demand is already cancelled: ${state.demandKey}; archive it to free capacity.`);
  }

  const createdAt = nowIso();
  const nextRevision = Number(state.revision ?? 0) + 1;
  const eventId = nextEventId(createdAt, nextRevision);
  const openTasks = (state.targetTasks ?? []).filter((task) => !["accepted", "completed"].includes(task.status));
  const nextState = {
    ...state,
    state: "cancelled",
    stateReason: reason,
    revision: nextRevision,
    updatedAt: createdAt,
    allowedActions: ["wakeflow-render-progress"],
    decisionsRequired: [],
    review: {
      ...(state.review ?? {}),
      status: "demand-cancelled",
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
    type: "demand.cancelled",
    from: state.state,
    to: "cancelled",
    reason,
    ...(openTasks.length ? { openTargetTasks: openTasks.map((task) => task.targetTaskId) } : {}),
    allowedWrites: [
      "wakeflow-state.json",
      "controller-events.jsonl",
    ],
    forbiddenConclusions: [
      "cancel-is-acceptance",
      "cancel-deletes-evidence",
      "cancel-frees-capacity-before-archive",
    ],
    stateRevision: nextRevision,
    ...(hostOwnership.claimed || hostOwnership.transferredFrom ? { hostOwnership } : {}),
  };

  // Cancel is a real stop: the demand's in-flight window delivery locks are
  // released NOW, or the documented close order (stream-close / pod close ->
  // archive) dead-ends on "fresh in-flight delivery lock" for up to the lock
  // TTL while a zombie demand holds an active-demand slot. Only locks whose
  // deliveryId belongs to this demand's tasks are touched.
  const releasedWindowLocks = [];
  if (write) {
    for (const task of state.targetTasks ?? []) {
      const deliveryId = task.delivery?.deliveryId;
      if (!deliveryId || !task.targetWindow) continue;
      const lockFile = path.join(workspaceRoot, ".wakeflow-local/wakeflow-delivery/locks", `${slug(task.targetWindow)}.json`);
      const released = releaseWindowLockForResult(
        lockFile,
        (lock) => !lock.deliveryId || lock.deliveryId === deliveryId,
      );
      if (released) releasedWindowLocks.push(task.targetWindow);
    }
  }

  if (write) {
    appendJsonLine(eventsFile, event);
    writeJson(stateFile, nextState);
    appendProgressTimeline(stateRoot, nextState, PROGRESS_SECTIONS.decisions,
      `${createdAt} demand cancelled — ${reason}`);
    refreshWorkspaceProjection({ workspaceRoot, updatedAt: createdAt });
  }

  output(
    {
      ok: true,
      command: "cancel-demand",
      hostOwnership,
      wrote: write,
      demandKey: state.demandKey,
      stateRoot: relative(stateRoot),
      previousState: state.state,
      nextState: "cancelled",
      stateRevision: nextRevision,
      eventId,
      openTargetTasks: openTasks.map((task) => task.targetTaskId),
      releasedWindowLocks,
      projectionStatus: "stale",
      agentNext: "Demand is cancelled, not archived: it still occupies active-demand capacity. Its in-flight window delivery locks were released; a window mid-task may still finish and return a late result (recorded as history only). Close any open isolation windows (stream-close / pod close), then run archive-demand to free the slot. Recorded evidence stays untouched.",
      appendLog: {
        type: "decision",
        decision: `cancelled: ${reason}`,
        eventId,
      },
    },
    [
      `${write ? "Recorded" : "Would record"} demand cancellation for ${state.demandKey}.`,
      "No acceptance, dispatch, or evidence deletion was performed; archive to free capacity.",
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
  const state = readJson(path.join(stateRoot, "wakeflow-state.json"), "controller state");
  return [...currentStateRootResults({ stateRoot, state, readJson, fail }).values()]
    .map((item) => ({ ...item.result, _resultFile: path.relative(stateRoot, item.file) }));
}

function latestResultsByTargetTask(results) {
  const latest = new Map();
  for (const result of results) {
    if (latest.has(result.targetTaskId)) {
      fail(`multiple current target results were selected for ${result.targetTaskId}.`);
    }
    latest.set(result.targetTaskId, result);
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

// RA4: a read-only per-window orientation card. One call returns the tasks that belong to
// a window plus where its files live (both the state-root tier and the .wakeflow-local
// transport tier), so a sub-window stops hunting for its task and file area. No write, no
// revision bump, no event, no host-ownership claim.
function buildWindowCard(state, stateRoot, window) {
  const myTasks = (state.targetTasks ?? []).filter((task) => task.targetWindow === window);
  const myPackageIds = new Set(myTasks.map((task) => task.taskPackageId));
  const myPackages = (state.taskPackages ?? []).filter((pkg) => myPackageIds.has(pkg.taskPackageId));
  const windowRollup = (state.windows ?? []).find((entry) => entry.windowName === window) ?? null;
  const stateRootRel = relative(stateRoot);
  const transportRoot = ".wakeflow-local/wakeflow-delivery";
  const hostDir = hostProfile.runtime.hostDirName;
  // Transport dirs are emitted as directories (per-result filenames need a dispatchGroup,
  // so they are not fabricated); per-window registry/config files are slug-derivable.
  const fileAreas = {
    stateRoot: stateRootRel,
    taskPackagesDir: `${stateRootRel}/task-packages`,
    targetResultsDir: `${stateRootRel}/target-results`,
    intakeDir: `${stateRootRel}/intake`,
    testCardsDir: `${stateRootRel}/test-cards`,
    transport: {
      dispatchPacketsDir: `${transportRoot}/dispatch-packets`,
      targetResultsDir: `${transportRoot}/target-results`,
      deliveryEnvelopesDir: `${transportRoot}/delivery-envelopes`,
      deliveryRunsDir: `${transportRoot}/delivery-runs`,
      lockFile: `${transportRoot}/locks/${slug(window)}.json`,
    },
    host: {
      threadRegistryFile: `${transportRoot}/hosts/${hostDir}/thread-registry/${slug(window)}.json`,
      windowConfigFile: `${transportRoot}/hosts/${hostDir}/window-config/${slug(window)}.json`,
    },
  };
  const testWindows = new Set(testWindowNames(loadWorkspaceConfig({ workspaceRoot, args: options })));
  const tasks = myTasks.map((task) => {
    const persisted = task.counts ?? {};
    const dispatchCount = persisted.dispatchCount ?? 0;
    const reworkCount = persisted.reworkCount ?? 0;
    return {
      targetTaskId: task.targetTaskId,
      taskPackageId: task.taskPackageId,
      status: task.status,
      reviewDecision: task.reviewDecision ?? null,
      summary: task.summary,
      // Full handling counts so the controller's brake signals (redesignCount, recurringProblem)
      // and the retest hint stay visible on the per-window card too, not only in task-ledger.
      counts: {
        dispatchCount,
        reworkCount,
        redesignCount: persisted.redesignCount ?? 0,
        retestCount: testWindows.has(task.targetWindow ?? window) ? dispatchCount : 0,
      },
      recurringProblem: reworkCount >= 2,
    };
  });
  return {
    window,
    demandKey: state.demandKey,
    stateRoot: stateRootRel,
    windowState: windowRollup?.windowState ?? null,
    counts: { open: tasks.filter((task) => task.status !== "accepted").length, total: tasks.length },
    tasks,
    taskPackages: myPackages.map((pkg) => ({ taskPackageId: pkg.taskPackageId, status: pkg.status, summary: pkg.summary })),
    fileAreas,
  };
}

function commandWindowView() {
  const stateRoot = stateRootFromArg();
  const state = readJson(path.join(stateRoot, "wakeflow-state.json"), "controller state");
  const window = requireValue("--window");
  const card = buildWindowCard(state, stateRoot, window);
  output(
    { ok: true, command: "window-view", ...card },
    [
      `Window ${window}: ${card.tasks.length} task(s) in demand ${card.demandKey}`,
      ...card.tasks.map((task) => `- ${task.targetTaskId} [${task.status}]`),
      `Files: ${card.stateRoot} (+ transport under .wakeflow-local/wakeflow-delivery)`,
    ],
  );
}

function renderWindowFocusMarkdown(card) {
  const lines = [
    `# Focus: ${card.window} — ${card.demandKey}`,
    "",
    `> Generated focus card (regenerable artifact, not state authority). Window state: ${card.windowState ?? "n/a"}; ${card.counts.open} open / ${card.counts.total} total task(s).`,
    "",
    "## My tasks",
    "",
  ];
  if (card.tasks.length === 0) {
    lines.push("_None._");
  } else {
    for (const task of card.tasks) {
      lines.push(`- \`${task.targetTaskId}\` [${task.status}] (dispatch x${task.counts?.dispatchCount ?? 0}, rework x${task.counts?.reworkCount ?? 0}, redesign x${task.counts?.redesignCount ?? 0}, retest x${task.counts?.retestCount ?? 0}${task.recurringProblem ? ", recurring" : ""}) — ${task.summary ?? ""}`);
    }
  }
  lines.push("", "## My file areas", "");
  lines.push(`- state root: \`${card.fileAreas.stateRoot}\``);
  lines.push(`- task packages: \`${card.fileAreas.taskPackagesDir}\``);
  lines.push(`- my results: \`${card.fileAreas.targetResultsDir}\``);
  lines.push(`- transport packets: \`${card.fileAreas.transport.dispatchPacketsDir}\``);
  lines.push(`- my thread registry: \`${card.fileAreas.host.threadRegistryFile}\``);
  lines.push("");
  return lines.join("\n");
}

// RA5: distill the big state into a focused, regenerable sub-document for one window (or,
// best-effort, one phase). Dry-run by default; --write rewrites focus/ artifacts under the
// owning-host gate. Focus docs are never state authority.
function commandFocusDoc() {
  const stateRoot = stateRootFromArg();
  const state = readJson(path.join(stateRoot, "wakeflow-state.json"), "controller state");
  const window = getValue("--window");
  const phase = getValue("--phase");
  if (!window && !phase) fail("focus-doc requires --window or --phase.");
  if (write && state.controllerHost && state.controllerHost !== hostProfile.runtime.hostDirName) {
    fail(`demand ${state.demandKey} is owned by controller host ${state.controllerHost}; this runtime is ${hostProfile.runtime.hostDirName}. Generate focus docs from the owning controller.`);
  }
  if (window) {
    const card = buildWindowCard(state, stateRoot, window);
    const markdown = renderWindowFocusMarkdown(card);
    const mdFile = path.join(stateRoot, "focus", `window-${slug(window)}.md`);
    const jsonFile = path.join(stateRoot, "focus", `window-${slug(window)}.json`);
    if (write) {
      atomicWrite(mdFile, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
      writeJson(jsonFile, { kind: "WakeflowWindowFocus", ...card });
    }
    output(
      { ok: true, command: "focus-doc", scope: "window", window, wrote: write, files: [relative(mdFile), relative(jsonFile)], card },
      [`Focus doc for window ${window}: ${write ? "wrote" : "would write"} ${relative(mdFile)} + ${relative(jsonFile)}`],
    );
    return;
  }
  // Best-effort phase brief: target tasks are not yet per-phase tagged, so this is a
  // demand-stage-level list (G11(a) per-task stageId is a separate, larger change).
  const stageId = phase === "active" ? (state.activeStageId ?? "active") : phase;
  const tasks = state.targetTasks ?? [];
  const markdown = [
    `# Focus: phase ${stageId} — ${state.demandKey}`,
    "",
    `> Best-effort phase brief (regenerable, not state authority). Target tasks are not yet per-phase tagged, so this lists the demand's tasks at active stage ${state.activeStageId ?? "n/a"}.`,
    "",
    "## Tasks",
    "",
    ...(tasks.length ? tasks.map((task) => `- \`${task.targetTaskId}\` -> \`${task.targetWindow}\` [${task.status}]`) : ["_None._"]),
    "",
  ].join("\n");
  const mdFile = path.join(stateRoot, "focus", `phase-${slug(stageId)}.md`);
  if (write) atomicWrite(mdFile, `${markdown}\n`);
  output(
    { ok: true, command: "focus-doc", scope: "phase", phase: stageId, wrote: write, files: [relative(mdFile)] },
    [`Focus doc for phase ${stageId}: ${write ? "wrote" : "would write"} ${relative(mdFile)}`],
  );
}

function scanDanglingEnvelopeRefs(stateRoot) {
  // Best-effort: any persisted delivery envelope still referencing the pre-move state-root path.
  const envDir = path.join(workspaceRoot, ".wakeflow-local/wakeflow-delivery/delivery-envelopes");
  if (!existsSync(envDir)) return [];
  const stateRootRel = relative(stateRoot);
  const refs = [];
  for (const name of readdirSync(envDir)) {
    if (!name.endsWith(".json")) continue;
    try {
      if (readFileSync(path.join(envDir, name), "utf8").includes(stateRootRel)) refs.push(name);
    } catch {
      // unreadable envelope: skip
    }
  }
  return refs;
}

// archive-demand: relocate a completed demand's state root into the committed ledger. The P1-0
// redaction guard is a HARD precondition — it refuses on any real-id-shaped string unless
// --redact relocates a cleaned COPY (the original is preserved in the gitignored active tier
// for a human audit). Dry-run unless --write. The archive copy is fully staged before
// the ledger is committed, so a filesystem failure cannot half-flip the active state root.
function commandArchiveDemand() {
  const stateRoot = stateRootFromArg();
  withLockedStateRoot(stateRoot, () => commandArchiveDemandLocked(stateRoot));
}

function commandArchiveDemandLocked(stateRoot) {
  const reason = requireValue("--reason");
  const redact = options.includes("--redact");
  const evidenceRefs = valuesFor("--evidence-ref");
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const state = readJson(stateFile, "controller state");
  // Archive relocates and (with --redact) rewrites the root — the most
  // destructive controller mutation, so it honors the same cross-host
  // fail-closed invariant as every other driving command.
  if (state.controllerHost && state.controllerHost !== hostProfile.runtime.hostDirName) {
    fail(`demand ${state.demandKey} is owned by controller host ${state.controllerHost}; this runtime is ${hostProfile.runtime.hostDirName}. Archive it from the owning host or transfer ownership first (wakeflow_adopt_demand_host).`);
  }

  if (state.state !== "completed" && state.state !== "cancelled") {
    fail(`archive-demand requires state=completed or state=cancelled; ${state.demandKey} is ${state.state}.`);
  }

  // A demand with live isolation worktree windows must not archive: their worktrees and
  // branches would orphan with no owner. Stream entries are plain config facts
  // (repositories[].stream, host-neutral) surfaced through the derived local
  // overlay that loadWorkspaceConfig already prefers.
  const openStreams = (loadWorkspaceConfig({ workspaceRoot, args: options }).repositories ?? [])
    .filter((repo) => repo?.stream?.demandKey === state.demandKey);
  if (openStreams.length > 0) {
    fail(`archive-demand refuses: ${openStreams.length} isolation worktree window(s) are still open for ${state.demandKey}: ${openStreams.map((repo) => repo.windowName).join(", ")}. Close them (stream-close) before archiving.`);
  }

  const scan = scanStateRootForRealIds(stateRoot, { hostProfile });
  if (!scan.clean && !redact) {
    fail([
      `archive-demand refuses: ${scan.findings.length} possible real id(s) in the state-root tree.`,
      "Audit them, then re-run with --redact to relocate a cleaned COPY (original preserved for audit).",
      ...scan.findings.slice(0, 5).map((finding) => `  ${finding.file ?? "?"}:${finding.line ?? "?"} ${finding.match ?? finding.reason ?? ""}`),
    ].join("\n"));
  }

  const config = loadWorkspaceConfig({ workspaceRoot, args: options });
  const ledgerPaths = workspaceLedgerPaths({ workspaceRoot, args: options, config });
  const createdAt = nowIso();
  const month = createdAt.slice(0, 7);
  const ledgerDest = path.join(ledgerPaths.projectLedgerRoot, "workspace", "archive", month, slug(state.demandKey));
  ensureInsideAllowedRoots(ledgerDest, "archive destination", [ledgerPaths.projectLedgerRoot]);
  if (existsSync(ledgerDest)) {
    fail(`archive destination already exists: ${relative(ledgerDest)}; refuse to overwrite.`);
  }

  const danglingRefs = scanDanglingEnvelopeRefs(stateRoot);
  if (!write) {
    output({
      ok: true,
      command: "archive-demand",
      wrote: false,
      wouldArchive: {
        demandKey: state.demandKey,
        sourceStateRoot: relative(stateRoot),
        ledgerDest: relative(ledgerDest),
        redactNeeded: !scan.clean,
        findingCount: scan.findings.length,
        danglingRefs,
      },
      forbiddenConclusions: ["archive-is-deletion", "archive-is-acceptance"],
      agentNext: scan.clean
        ? "Dry-run only. Re-run with --write to flip the demand to archived and relocate it into the committed ledger."
        : "Dry-run only. Real ids found — audit them, then re-run with --redact --write to relocate a cleaned copy.",
    }, [`Would archive ${state.demandKey} -> ${relative(ledgerDest)}${scan.clean ? "" : " (redaction required)"}`]);
    return;
  }

  const nextRevision = Number(state.revision ?? 0) + 1;
  const eventId = nextEventId(createdAt, nextRevision);
  const nextState = {
    ...state,
    state: "archived",
    stateReason: reason,
    revision: nextRevision,
    updatedAt: createdAt,
    allowedActions: [],
    decisionsRequired: [],
    projection: { ...(state.projection ?? {}), status: "stale" },
  };
  const event = {
    eventId,
    createdAt,
    actor: "controller",
    type: "demand.archived",
    from: state.state,
    to: "archived",
    reason,
    evidenceRefs,
    allowedWrites: ["wakeflow-state.json", "controller-events.jsonl"],
    forbiddenConclusions: ["archive-is-deletion", "archive-creates-dispatch", "archive-skips-redaction-audit"],
    stateRevision: nextRevision,
  };

  let redactedFields = [];
  const preservedOriginal = redact && !scan.clean;
  // Archive spine: thread the whole demand story into the manifest so the
  // archived tree is navigable without archaeology — provenance (design key +
  // source docs), the completion conclusion, the per-task handling rollup,
  // and the test cards.
  const demandFile = path.join(stateRoot, "demand.json");
  const demandRecord = existsSync(demandFile) ? JSON.parse(readFileSync(demandFile, "utf8")) : {};
  let conclusion = null;
  try {
    const eventLines = readFileSync(eventsFile, "utf8").split("\n").filter(Boolean);
    for (let i = eventLines.length - 1; i >= 0; i -= 1) {
      const parsed = JSON.parse(eventLines[i]);
      if (parsed.to === "completed") {
        conclusion = { reason: parsed.reason ?? null, evidenceRefs: parsed.evidenceRefs ?? [], completedAt: parsed.createdAt ?? null };
        break;
      }
    }
  } catch {
    conclusion = null;
  }
  const taskLedger = (state.targetTasks ?? []).map((task) => ({
    targetTaskId: task.targetTaskId,
    targetWindow: task.targetWindow ?? null,
    status: task.status ?? null,
    reviewDecision: task.reviewDecision ?? null,
    dispatchCount: task.counts?.dispatchCount ?? 0,
    reworkCount: task.counts?.reworkCount ?? 0,
    redesignCount: task.counts?.redesignCount ?? 0,
  }));
  const testCardsDir = path.join(stateRoot, "test-cards");
  const testCards = existsSync(testCardsDir)
    ? readdirSync(testCardsDir).filter((name) => name.endsWith(".json") || name.endsWith(".md"))
    : [];
  const archiveManifest = {
    kind: "WakeflowArchiveManifest",
    version: 2,
    demandKey: state.demandKey,
    title: state.title ?? demandRecord.title ?? null,
    archivedAt: createdAt,
    reason,
    redactedFields,
    sourceStateRoot: relative(stateRoot),
    preservedOriginal,
    designKey: demandRecord.source?.designKey ?? null,
    sourceDocuments: demandRecord.source?.documents ?? [],
    conclusion,
    taskLedger,
    testCards,
  };
  const stagingDest = `${ledgerDest}.tmp-${process.pid}-${Date.now()}`;
  // Written before the copy so the ARCHIVED progress doc closes its own story.
  appendProgressTimeline(stateRoot, state, PROGRESS_SECTIONS.decisions,
    `${createdAt} archived → ${relative(ledgerDest)} — ${reason}`);

  try {
    mkdirSync(path.dirname(ledgerDest), { recursive: true });
    if (preservedOriginal) {
      ({ redactedFields } = redactStateRootIntoCopy(stateRoot, stagingDest, { hostProfile }));
      archiveManifest.redactedFields = redactedFields;
    } else {
      cpSync(stateRoot, stagingDest, { recursive: true });
    }
    appendJsonLine(path.join(stagingDest, "controller-events.jsonl"), event);
    writeJson(path.join(stagingDest, "wakeflow-state.json"), nextState);
    writeJson(path.join(stagingDest, "archive-manifest.json"), archiveManifest);
    // The human one-pager: the archived story in reading order — requirement
    // provenance, conclusion, per-task handling, tests, execution timeline
    // pointer, audit-hold pointer.
    writeText(path.join(stagingDest, "archive-summary.md"), [
      `# ${state.demandKey} — Archive Summary`,
      "",
      `- Title: ${archiveManifest.title ?? state.demandKey}`,
      `- Archived: ${createdAt} — ${reason}`,
      `- Demand goal: ${demandRecord.goal ?? "(see demand.json)"}`,
      `- Completion definition: ${demandRecord.completionDefinition ?? "(see demand.json)"}`,
      "",
      "## Provenance",
      "",
      `- Design key: ${archiveManifest.designKey ?? "(none recorded)"}`,
      ...(archiveManifest.sourceDocuments.length
        ? archiveManifest.sourceDocuments.map((doc) => `- Source document: ${doc}`)
        : ["- Source documents: (none recorded)"]),
      "",
      "## Conclusion",
      "",
      conclusion
        ? `- Completed ${conclusion.completedAt ?? "?"} — ${conclusion.reason ?? "(no reason recorded)"}`
        : "- (no completion event found)",
      ...(conclusion?.evidenceRefs?.length ? conclusion.evidenceRefs.map((ref) => `- Evidence: ${ref}`) : []),
      "",
      "## Task Ledger",
      "",
      "| Task | Window | Final | Decision | Dispatches | Reworks | Redesigns |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...taskLedger.map((task) => `| ${task.targetTaskId} | ${task.targetWindow ?? "-"} | ${task.status ?? "-"} | ${task.reviewDecision ?? "-"} | ${task.dispatchCount} | ${task.reworkCount} | ${task.redesignCount} |`),
      "",
      "## Test Cards",
      "",
      ...(testCards.length ? testCards.map((name) => `- test-cards/${name}`) : ["- (none)"]),
      "",
      "## Where The Rest Lives",
      "",
      "- Execution timeline: developer-progress.md (Task Packages / Backfill Summaries / Decisions And Append Log)",
      "- Machine audit trail: controller-events.jsonl + wakeflow-state.json",
      `- Un-redacted original: ${preservedOriginal ? "moved to .wakeflow-local/preserved/ (see archive-manifest.json originalPreservedAt)" : "not needed (archive copy is complete)"}`,
      "",
    ].join("\n"));
    renameSync(stagingDest, ledgerDest);
  } catch (error) {
    if (existsSync(stagingDest)) rmSync(stagingDest, { recursive: true, force: true });
    fail(`archive-demand failed before ledger commit; active state root was left unchanged: ${error.message}`);
  }

  let originalPreservedAt = null;
  let originalPreserveWarning = null;
  try {
    if (preservedOriginal) {
      appendJsonLine(eventsFile, event);
      writeJson(stateFile, nextState);
    } else {
      rmSync(stateRoot, { recursive: true, force: true });
    }
  } catch (error) {
    fail(`archive-demand committed ledger at ${relative(ledgerDest)} but could not finalize the active state root: ${error.message}`);
  }
  if (preservedOriginal) {
    // Canonical audit hold: move the un-redacted original OUT of current/
    // (keeping the active layer clean without manual moves — the historical
    // source of unowned residue trees) into preserved/<date>-archive-original-
    // <demand>/ with a manifest; prune-preserved lists it once it ages.
    const preservedRoot = path.join(workspaceRoot, ".wakeflow-local", "preserved");
    const dateSlug = createdAt.slice(0, 10);
    let preservedDest = path.join(preservedRoot, `${dateSlug}-archive-original-${slug(state.demandKey)}`);
    for (let n = 2; existsSync(preservedDest); n += 1) {
      preservedDest = path.join(preservedRoot, `${dateSlug}-archive-original-${slug(state.demandKey)}-${n}`);
    }
    try {
      mkdirSync(preservedRoot, { recursive: true });
      renameSync(stateRoot, preservedDest);
      writeFileSync(path.join(preservedDest, "MANIFEST.md"), [
        `# Preserved: ${path.basename(preservedDest)}`,
        "",
        `- Preserved at: ${createdAt}`,
        `- Source: ${relative(stateRoot)}`,
        `- Reason: un-redacted original of archived demand ${state.demandKey} (redacted copy committed at ${relative(ledgerDest)})`,
        "- Preserved by: archive-demand --redact",
        "- Retention: audit hold; prune-preserved lists it once aged past preservedRetentionDays",
        "",
      ].join("\n"));
      originalPreservedAt = relative(preservedDest);
      try {
        writeJson(path.join(ledgerDest, "archive-manifest.json"), { ...archiveManifest, originalPreservedAt });
      } catch {
        // manifest enrichment is best-effort; the archive itself is committed
      }
    } catch (error) {
      // The ledger commit already succeeded; a failed move degrades to the
      // old in-place behavior instead of failing the archive.
      originalPreserveWarning = `original left at ${relative(stateRoot)} (move to preserved/ failed: ${error.message}); move it with wakeflow-storage preserve.`;
    }
  }

  const todoArchive = archiveWorkspaceTodo({
    workspaceRoot,
    config,
    designKey: state.designKey ?? demandRecord.designKey ?? demandRecord.source?.designKey,
    archiveMount: relative(ledgerDest),
    // The board must not report a cancelled demand as delivered.
    rowStatus: state.state === "cancelled" ? "cancelled / archived" : "completed / archived",
  });
  refreshWorkspaceProjection({ workspaceRoot, config, updatedAt: createdAt });
  const archiveWarnings = [
    originalPreserveWarning,
    todoArchive.reason && !["no-design-key", "row-missing"].includes(todoArchive.reason)
      ? `Global TODO archive projection was not updated: ${todoArchive.reason}`
      : null,
  ].filter(Boolean);

  output({
    ok: true,
    command: "archive-demand",
    wrote: true,
    archived: {
      demandKey: state.demandKey,
      ledgerDest: relative(ledgerDest),
      manifest: relative(path.join(ledgerDest, "archive-manifest.json")),
      redactedFields,
      preservedOriginal,
      originalPreservedAt,
      danglingRefs,
      todoArchive,
    },
    ...(archiveWarnings.length ? { warnings: archiveWarnings } : {}),
    indexRefreshNeeded: false,
    forbiddenConclusions: ["archive-is-deletion", "archive-is-acceptance"],
    agentNext: "The active workspace projection was refreshed. Review redactedFields before committing the ledger to git.",
  }, [
    `Archived ${state.demandKey} -> ${relative(ledgerDest)}`,
    redactedFields.length
      ? `Redacted ${redactedFields.reduce((total, field) => total + field.count, 0)} id(s) into the committed copy; original preserved for audit${originalPreservedAt ? ` at ${originalPreservedAt}` : ""}.`
      : "No redaction needed.",
    danglingRefs.length ? `WARNING: ${danglingRefs.length} delivery envelope(s) still reference the old path.` : "",
  ].filter(Boolean));
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
    case "cancel-demand":
      commandCancelDemand();
      break;
    case "archive-demand":
      commandArchiveDemand();
      break;
    case "window-view":
      commandWindowView();
      break;
    case "focus-doc":
      commandFocusDoc();
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
